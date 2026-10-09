"""
The MIDI ports: the one module that talks to the MIDI library.

Everything the app does with ports goes through PortSystem and OpenPort, so
the library (libremidi, through its Python package pylibremidi) could be
swapped here and nowhere else. Nothing else imports it, and the suites block
it (`sys.modules["pylibremidi"] = None` beside their sounddevice stubs), so no
test opens a real port. tests/midi_live.py is the one script that does.

What pylibremidi 5.4.3 really does, which is not always what libremidi's own
documentation says. Read this before changing anything below.

  - Its callbacks do not run on a thread of the library's. The native side
    puts each event on a queue and the Python call `poll()` hands the queued
    ones to your callbacks, on whichever thread called it. So the observer
    has a thread of its own that only polls (WATCH_POLL_SEC) and each open
    port has one that only polls and calls `on_event` (INPUT_POLL_SEC). The
    time on an event is taken natively when it arrives, so a poll that runs
    late delays the callback and not the time.
  - `poll()` calls the callbacks from a function that may not throw, so a
    Python callback that raises ends the whole process, not just the call.
    Every callback here catches. And `on_error` and `on_warning` are never
    set: they are handed a C++ type Python cannot make, so the first error the
    library reports aborts the process ("terminate called after throwing
    std::bad_cast", tried with the JACK observer on Linux).
  - Constructors: `Observer(conf)` or `Observer(conf, api)`, `MidiIn(conf)`
    or `MidiIn(conf, api)`, with `api` one of the `API` values and not a
    configuration object. An API that is not in this build does not raise: it
    quietly gives a "dummy" one with no ports, so `get_current_api()` is
    checked against what was asked for.
  - A port's fields (`PortInformation`): client, port, manufacturer,
    device_name, port_name, display_name. `port` is the OS's own number for
    it: on CoreMIDI its unique ID, which is kept; on classic Windows MIDI its
    index in the list, which changes when a device is pulled, so it is not.
  - `InputConfiguration.timestamps` is 0 none, 1 relative, 2 absolute, 3
    system monotonic, 4 audio frame, 5 custom (libremidi's
    include/libremidi/input_configuration.hpp). It cannot be set from Python:
    the setter wants a C++ enum the package does not register, and any
    number is a TypeError. Every port therefore runs at the default, 2:
      CoreMIDI              the packet's host time, in nanoseconds;
      classic Windows MIDI  milliseconds since the port was started;
      Windows MIDI Services the MIDI Services clock as the library finds it,
                            with `absolute_timestamp()` answering 0.
    The first two are a steady clock of their own, so the offset to Python's
    clock (OpenPort.resync) turns them into `perf_counter_ns()` time. The
    third gives nothing to take an offset from, so a port on it is stamped
    with `perf_counter_ns()` as its events are read, up to INPUT_POLL_SEC
    late, until it has been measured on a real machine.
  - `Message.bytes` cannot be read from Python (there is no converter for its
    container: TypeError) and `len(message)` fails too, because its
    `__len__` takes a stray argument. The bytes are read one by one: see
    bytes_of.
  - `MidiIn.is_port_connected()` is true from a successful open to
    `close_port()` and nothing else: pulling the device does not change it.
    OpenPort.connected() is answered from the list of ports instead.
  - CoreMIDI sends its notices of a port coming or going to the run loop of
    the thread that made the observer, and libremidi runs that loop only
    inside `get_input_ports()`. So the observer is made on its own thread,
    and on CoreMIDI that thread lists the ports each WATCH_POLL_SEC.
  - The macOS and Linux wheels for Python 3.12 and later are one file
    (cp312-abi3) whose compiled module is named for 3.12 alone, so Python 3.13
    installs it and cannot import it: open_system() then says MIDI is not
    available. Windows has a wheel for each version. The build and CI use 3.12.

Fields seen on macOS / Windows CI: to be filled from the first CI run.
"""

import logging
import sys
import threading
import time
from dataclasses import dataclass
from typing import Callable

log = logging.getLogger(__name__)

# How often an open port asks the library for the events it has queued. An
# event waits at most this long for on_event; its time is already fixed.
INPUT_POLL_SEC = 0.002

# How often the observer is asked for the ports that came or went, and how
# long a port's answer to "am I still listed" may be.
WATCH_POLL_SEC = 0.1
LISTING_FRESH_SEC = 0.25

# How long to wait for the observer to start before saying it did not.
START_PATIENCE_SEC = 10

# Readings of both clocks side by side, of which the tightest is kept.
OFFSET_READS = 5

# What the app calls each system, whatever the library does.
_NAMES = {
    "COREMIDI": "CoreMIDI",
    "WINDOWS_MIDI_SERVICES": "Windows MIDI Services",
    "WINDOWS_MM": "Windows MIDI",
}


@dataclass(frozen=True)
class PortInfo:
    """
    A port as the OS describes it, which is also how a saved one is found
    again (spec P1): by `id` where the system gives one, else by `name`.
    """

    name: str
    device: str = ""
    maker: str = ""
    id: str = ""

    def saved(self) -> dict:
        """What is kept of a port: the fields that say something, name always."""
        kept = {"name": self.name}
        for key in ("device", "maker", "id"):
            if getattr(self, key):
                kept[key] = getattr(self, key)
        return kept


class PortBusy(Exception):
    """A port the OS would not open: another app has it, or it just went."""


def bytes_of(message) -> bytes:
    """
    A received message's bytes, which pylibremidi 5.4.3 will only give one at
    a time (see the notes at the top). If a newer one fixes `__len__` this
    fails on the first event, and the live check's count of notes shows it.
    """
    return bytes(message[i] for i in range(message.__len__(0)))


class OpenPort:
    """
    One port being listened to. Its thread polls the library and calls
    `on_event(ns, data)` for each event, `ns` on the `perf_counter_ns()` clock
    and `data` the message's bytes. Make one with PortSystem.open().
    """

    def __init__(self, system, lm, native, info, on_event):
        self.info = info
        self._system = system
        self._on_event = on_event
        # False when the port's own times are no use (see the notes above).
        self._library_time = system.api != lm.API.WINDOWS_MIDI_SERVICES
        self._offset = 0
        self._gone = False
        self._closed = False

        conf = lm.InputConfiguration()
        conf.on_message = self._receive
        # Everything the instrument says is kept (spec F2) except the clock
        # that only says the cable is in time.
        conf.ignore_sysex = False
        conf.ignore_sensing = False
        conf.ignore_timing = True
        try:
            midi_in = lm.MidiIn(conf, system.api)
            error = midi_in.open_port(native)
        except Exception as e:  # whatever the library raises
            raise PortBusy(str(e) or type(e).__name__) from e
        if error:
            raise PortBusy(str(error))

        # The library's object holds this one, through `conf.on_message`, in
        # a loop Python's collector cannot see. So it is let go of by hand:
        # a failed open drops it above, close() below.
        self._in = midi_in
        self.resync()
        self._thread = threading.Thread(
            target=self._run, name=f"midi-in {info.name}", daemon=True
        )
        self._thread.start()

    def _receive(self, message):
        """Runs inside poll(), on this port's thread. Never raises."""
        try:
            if self._library_time:
                ns = message.timestamp + self._offset
            else:
                ns = time.perf_counter_ns()
            self._on_event(ns, bytes_of(message))
        except Exception:  # see the notes at the top
            log.exception("MIDI event from %s", self.info.name)

    def _run(self):
        while not self._closed:
            time.sleep(INPUT_POLL_SEC)
            self._poll()

    def _poll(self):
        try:
            self._in.poll()
        except Exception:
            log.exception("MIDI port %s", self.info.name)

    def connected(self) -> bool:
        """
        Whether the instrument is still there. Once it has gone this stays
        False, even if it comes back: the port the OS made for it before is
        not the one that was opened, so a port to it is opened again.
        """
        midi_in = self._in
        if self._closed or self._gone or midi_in is None:
            return False
        if not midi_in.is_port_connected():
            return False
        if not self._system.is_listed(self.info):
            self._gone = True
            return False
        return True

    def resync(self) -> None:
        """
        Measure the offset between the library's clock and Python's again, so
        a clock that drifts from it is followed. Both are read around one
        another, a few times, and the tightest pair is kept: a pause between
        two reads shows as a wide pair and is thrown away.
        """
        if not self._library_time or self._closed:
            return
        best = None
        for _ in range(OFFSET_READS):
            before = time.perf_counter_ns()
            theirs = self._in.absolute_timestamp()
            after = time.perf_counter_ns()
            if best is None or after - before < best[0]:
                best = (after - before, (before + after) // 2 - theirs)
        self._offset = best[1]

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._thread is not threading.current_thread():
            self._thread.join(timeout=2)
        try:
            self._in.close_port()
            # What came in before the port closed is still owed to on_event.
            self._poll()
        except Exception:
            log.exception("closing MIDI port %s", self.info.name)
        self._in = None
        self._system.forget(self)


class PortSystem:
    """
    The MIDI system of this machine: its input ports, told when one comes or
    goes, and the ability to open one. Make one with open_system().
    """

    def __init__(self, lm, asked):
        """
        `asked` is the API to use, or None for the library's own choice; if
        it will not start this raises, and open_system tries the next.
        """
        self._lm = lm
        self._asked = asked
        self.api = None
        self.name = ""
        self._observer = None
        self._failure = None
        self._changed = False
        self._stopping = False
        self._watchers = []
        self._open = set()
        self._lock = threading.Lock()
        self._listing = (0, [])

        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, name="midi-ports", daemon=True)
        self._thread.start()
        if not self._ready.wait(START_PATIENCE_SEC):
            self._stopping = True
            raise RuntimeError("the MIDI system did not start")
        if self._failure is not None:
            raise self._failure

    def inputs(self) -> list[PortInfo]:
        """The input ports the OS lists now."""
        return [info for info, _ in self._read()]

    def watch(self, on_change: Callable[[], None]) -> None:
        """
        Call `on_change()` whenever an input port comes or goes. It runs on
        the observer's thread: do not stay in it.
        """
        with self._lock:
            self._watchers.append(on_change)

    def open(self, port: PortInfo, on_event: Callable[[int, bytes], None]) -> OpenPort:
        """
        Start listening to a port. `on_event(ns, data)` is called on a thread
        of this module's for each event, so it should only pass the event on.
        Raises PortBusy if the OS will not open it.
        """
        native = next((n for info, n in self._read() if info == port), None)
        if native is None:
            raise PortBusy(f"{port.name} is not in the list of ports")
        opened = OpenPort(self, self._lm, native, port, on_event)
        with self._lock:
            self._open.add(opened)
        return opened

    def close(self) -> None:
        self._stopping = True
        with self._lock:
            ports = list(self._open)
        for port in ports:
            port.close()
        if self._thread is not threading.current_thread():
            self._thread.join(timeout=2)

    # What OpenPort asks of its system.

    def is_listed(self, info: PortInfo) -> bool:
        """Whether a port is in the list, as of a moment ago."""
        when, infos = self._listing
        if time.perf_counter_ns() - when > LISTING_FRESH_SEC * 1e9:
            infos = [i for i, _ in self._read()]
        return info in infos

    def forget(self, port: OpenPort) -> None:
        with self._lock:
            self._open.discard(port)

    # The observer's thread.

    def _read(self):
        """The ports now, each as PortInfo with the library's own object."""
        observer = self._observer
        if observer is None:
            return []
        coremidi = self.api == self._lm.API.COREMIDI
        found = []
        for p in observer.get_input_ports():
            found.append((PortInfo(
                name=p.port_name or p.display_name,
                device=p.device_name,
                maker=p.manufacturer,
                # Only CoreMIDI's number is the port's own, kept while the
                # device is plugged in and across restarts.
                id=str(p.port) if coremidi else "",
            ), p))
        self._listing = (time.perf_counter_ns(), [info for info, _ in found])
        return found

    def _noticed(self, _port):
        self._changed = True

    def _run(self):
        lm = self._lm
        try:
            conf = lm.ObserverConfiguration()
            conf.input_added = self._noticed
            conf.input_removed = self._noticed
            conf.track_hardware = True
            # A software instrument or a loopback cable is an input too.
            conf.track_virtual = True
            # Told of what changes; the ones already there are in inputs().
            conf.notify_in_constructor = False
            if self._asked is None:
                observer = lm.Observer(conf)
            else:
                observer = lm.Observer(conf, self._asked)
            got = observer.get_current_api()
            if got == lm.API.DUMMY or (self._asked is not None and got != self._asked):
                if self._asked is None:
                    raise RuntimeError("the library has no MIDI system to use here")
                wanted = _NAMES.get(self._asked.name, self._asked.name)
                raise RuntimeError(f"{wanted} is not available to the library")
        except Exception as e:
            self._failure = e
            self._ready.set()
            return
        self.api = got
        self.name = _NAMES.get(got.name) or lm.get_api_display_name(got)
        self._observer = observer
        self._ready.set()

        pump = got == lm.API.COREMIDI
        while not self._stopping:
            time.sleep(WATCH_POLL_SEC)
            try:
                if pump:
                    observer.get_input_ports()
                observer.poll()
                if self._changed:
                    self._changed = False
                    self._sweep()
                    self._tell()
            except Exception:
                log.exception("MIDI port watcher")
        self._observer = None

    def _sweep(self):
        """Mark the open ports whose instrument is no longer listed."""
        present = [info for info, _ in self._read()]
        with self._lock:
            ports = list(self._open)
        for port in ports:
            if port.info not in present:
                port._gone = True

    def _tell(self):
        with self._lock:
            watchers = list(self._watchers)
        for on_change in watchers:
            try:
                on_change()
            except Exception:
                log.exception("a MIDI port watcher")


def open_system() -> tuple[PortSystem | None, str | None]:
    """
    The MIDI system of this machine, or None and why not. Never raises: an
    app without MIDI still records audio.

    On Windows, Windows MIDI Services first (the newer, which lets apps share
    a port) if its observer starts, else the classic one.
    """
    try:
        import pylibremidi as lm
    except Exception as e:  # a missing or broken library, any way
        return None, f"MIDI is not available: {e}"

    if sys.platform == "win32":
        asked = [lm.API.WINDOWS_MIDI_SERVICES, lm.API.WINDOWS_MM]
    elif sys.platform == "darwin":
        asked = [lm.API.COREMIDI]
    else:
        asked = [None]

    reasons = []
    for api in asked:
        try:
            return PortSystem(lm, api), None
        except Exception as e:
            reasons.append(str(e) or type(e).__name__)
    return None, "MIDI is not available: " + "; ".join(reasons)
