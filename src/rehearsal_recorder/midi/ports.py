"""
The MIDI ports: the one module that talks to the MIDI library.

Everything the app does with ports goes through PortSystem and OpenPort, so
the library (libremidi, through its Python package pylibremidi) could be
swapped here and nowhere else. Nothing else imports it, and the suites block
it (`sys.modules["pylibremidi"] = None` beside their sounddevice stubs), so no
test opens a real port. tests/test_ports.py runs this module against a
stand-in with the library's quirks, and tests/midi_live.py is the one script
that opens real ports.

The library is only ever used on threads this module starts, not on the
caller's: the observer's thread imports it and makes the observer, and each
open port's thread makes its input, polls it and closes it. Where the caller
is the GUI's thread that matters (see COM below). The one exception is
OpenPort.resync(), which the owner may call from its own thread and which reads
a clock of the library's input (`absolute_timestamp()`), nothing that makes or
frees anything.

What pylibremidi 5.4.3 really does, which is not always what libremidi's own
documentation says. Read this before changing anything below.

  - Its callbacks do not run on a thread of the library's. The native side
    puts each event on a queue and the Python call `poll()` hands the queued
    ones to your callbacks, on whichever thread called it. So the observer
    has a thread of its own that polls (WATCH_POLL_SEC) and each open port
    has one that polls and calls `on_event` (INPUT_POLL_SEC). The time on an
    event is taken natively when it arrives, so a poll that runs late delays
    the callback and not the time.
  - `poll()` calls the callbacks from a function that may not throw, so a
    Python callback that raises ends the whole process, not just the call.
    Every callback here catches. And `on_error` and `on_warning` are never
    set: they are handed a C++ type Python cannot make, so the first error the
    library reports aborts the process ("terminate called after throwing
    std::bad_cast", tried with the JACK observer on Linux).
  - Constructors: `Observer(conf)` or `Observer(conf, api)`, `MidiIn(conf)`
    or `MidiIn(conf, api)`, with `api` one of the `API` values and not a
    configuration object. An API that is not in this build does not raise: it
    quietly gives a "dummy" one, with no ports for an observer and an input
    whose open_port() works and which never delivers anything. So
    `get_current_api()` of both is checked against what was asked for.
  - A port's fields (`PortInformation`): client, port, manufacturer,
    device_name, port_name, display_name. `port` is the OS's own number for
    it: on CoreMIDI its unique ID, which is kept; on classic Windows MIDI its
    index in the list, which changes when a device is pulled, so it is not.
  - `InputConfiguration.timestamps` is 0 none, 1 relative, 2 absolute, 3
    system monotonic, 4 audio frame, 5 custom (libremidi's
    include/libremidi/input_configuration.hpp). It cannot be set from Python:
    the setter wants a C++ enum the package does not register, and any
    number is a TypeError. Every port therefore runs at the default, 2:
      CoreMIDI              the packet's host time, in nanoseconds, the clock
                            `absolute_timestamp()` reads too;
      classic Windows MIDI  milliseconds since the port was started (the
                            event times are WinMM's millisecond counter times
                            1e6), while `absolute_timestamp()` is steady_clock
                            (QPC) since the start. So resync() compares QPC
                            with QPC and cannot follow a drift between the
                            two over a long take (winmm/midi_in.hpp:173-176,
                            216);
      Windows MIDI Services the raw time is `ump.Timestamp()` in MidiClock
                            (QPC) ticks (winmidi/midi_in.hpp:151), and
                            `absolute_timestamp()` answers 0. It may need
                            scaling and not just an offset to land on
                            perf_counter_ns: for the hand checks on a real
                            machine. Until then a port on it is stamped with
                            `perf_counter_ns()` as its events are read, up to
                            STAMPED_POLL_SEC late.
    The first two are a steady clock of their own, so the offset to Python's
    clock (OpenPort.resync) turns them into `perf_counter_ns()` time.
  - `Message.bytes` cannot be read from Python (there is no converter for its
    container: TypeError) and `len(message)` fails too, because its
    `__len__` takes a stray argument. The bytes are read one by one: see
    bytes_of.
  - `MidiIn.is_port_connected()` is true from a successful open to
    `close_port()` and nothing else: pulling the device does not change it.
    OpenPort.connected() is answered from the list of ports instead.
  - The objects the library makes are held through the callbacks given to
    their configuration, which makes a loop Python's collector cannot see.
    They are let go of by hand when a port or the system closes. And an error
    from the library is kept as its text and never as the error: the error's
    traceback holds the frame that made the library's objects, they hold the
    callbacks, and the callbacks hold this module's, so one kept error is a
    loop nothing can free, and nanobind reports it when the process ends
    ("nanobind: leaked 1 instances!"). CI showed that on Windows, where MIDI
    Services is absent and its observer fails; the same happens on Linux with
    a failed constructor and a kept exception, and does not once only the text
    is kept (_reason). The objects are also let go of on the thread that made
    them and before it leaves its COM apartment, not after.
  - CoreMIDI sends its notices of a port coming or going to the run loop of
    the thread that made the client ("first called", says Apple's
    MIDIServices.h for MIDIClientCreate), and libremidi runs that loop only
    inside `get_input_ports()`. So the observer is made on its own thread,
    and on CoreMIDI that thread lists the ports each WATCH_POLL_SEC. In the
    first CI run the library's observer never called back on a Mac, in a
    script that had made another observer on its main thread first, which
    would have been the first client of the process and so the one whose loop
    gets the notices. Whether that was the reason is not settled, and it does
    not matter to the app: `on_change` does not wait for the library's
    notice (see PortSystem.watch). Nor does this module make sure that its
    own thread is the first to call MIDIClientCreate, as nothing else in the
    app uses the library; tests/midi_live.py makes its own observers last and
    prints how many notices the library gave (PortSystem.observer_notices).
  - COM, on Windows. PortAudio (sounddevice) puts the thread that loaded it
    in a single-threaded COM apartment, and the library, when it is first
    imported, tries to join a multithreaded one. That is not an error it
    survives: the exception that comes out (a winrt::hresult_error, not a
    std::exception) is one nanobind does not catch, and the process aborts
    with its output unwritten. This is how the self-test of the first CI run
    ended on Windows (test_platform.py's `[selftest]` check got no output at
    all). So every thread of this module's that uses the library first joins
    a multithreaded apartment itself (_com), and the caller's thread, which
    may be in any state, never touches the library. This is read from that
    log and not yet seen to be the whole cause: the next Windows run says.
  - The macOS and Linux wheels for Python 3.12 and later are one file
    (cp312-abi3) whose compiled module is named for 3.12 alone, so Python 3.13
    installs it and cannot import it: open_system() then says MIDI is not
    available. Windows has a wheel for each version. The build and CI use 3.12.

Fields seen on CI. macOS (libremidi 5.4.3, `available_apis()` giving
[COREMIDI, KEYBOARD, DUMMY]), for a virtual port made by the script and named
'Reha probe':
    as the library lists it:
      client=0 port=3615898196 manufacturer='' device_name=''
      port_name='Reha probe' display_name='Reha probe'
    as the app keeps it:
      name='Reha probe' device='' maker='' id='3615898196'
A virtual port has no device and no maker. Its id is CoreMIDI's unique ID, and
a virtual port made again gets a new one (4000197376 for the same name).
Windows (the CI runner, which has no MIDI ports and no MIDI Services): the
observer on WINDOWS_MIDI_SERVICES fails to start with "SystemError:
nanobind::detail::nb_func_error_except(): exception could not be translated!",
a C++ exception the binding cannot turn into a Python one, which is caught here
like any other; the one on WINDOWS_MM starts ("an observer on WINDOWS_MM, 0
inputs"), so the app uses classic Windows MIDI (the self-test says "Windows
MIDI up, 0 inputs"). So there are no Windows port fields to copy yet: those
are for the hand list, with a real device (what name, device and maker WinMM
gives it; its id is empty by design).
"""

import collections
import contextlib
import ctypes
import logging
import sys
import threading
import time
from dataclasses import dataclass
from typing import Callable

log = logging.getLogger(__name__)

# How often an open port asks the library for the events it has queued, when
# the event times are the library's own and a late poll costs nothing but the
# wait, and when they are not (Windows MIDI Services) and the time an event is
# read is its time. An event waits about this long for on_event, and more when
# the interpreter is busy: a thread that wakes still waits for its turn at the
# lock (5 ms by default).
INPUT_POLL_SEC = 0.01
STAMPED_POLL_SEC = 0.002

# How often the observer's thread polls the library for notices, which on
# CoreMIDI is also how often it lists the ports; on other systems it lists
# them once in RELIST_SEC, or at once when the library gave a notice or a
# caller asked.
WATCH_POLL_SEC = 0.1
RELIST_SEC = 1.0

# How old a listing may be when OpenPort.connected() answers from it, and how
# long a caller waits for the observer's thread to make a newer one.
LISTING_FRESH_SEC = 0.25
LISTING_PATIENCE_SEC = 2

# How long to wait for the observer, or a port, to start before saying it
# did not.
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


class _NoLibrary(Exception):
    """The MIDI library cannot be imported: no other system will do better."""


def _reason(error) -> str:
    """
    What to keep of an error from the library: its text. Never the error
    itself: its traceback holds the frames, the frames hold the library's
    objects, and those hold the callbacks and so this module's objects, in a
    loop the collector cannot see (see the notes at the top).
    """
    return str(error) or type(error).__name__


def bytes_of(message) -> bytes:
    """
    A received message's bytes, which pylibremidi 5.4.3 will only give one at
    a time (see the notes at the top). If a newer one fixes `__len__` this
    fails on the first event, and the live check's count of notes shows it.
    """
    return bytes(message[i] for i in range(message.__len__(0)))


@contextlib.contextmanager
def _com():
    """
    For the life of the calling thread, on Windows, a multithreaded COM
    apartment: see the notes at the top. Where it cannot be had (the thread
    is in one of another kind already, or this is not Windows) the thread
    carries on without, and only what it joined it leaves.
    """
    ole32 = None
    if sys.platform == "win32":
        try:
            candidate = ctypes.windll.ole32
            # COINIT_MULTITHREADED. S_OK and S_FALSE (already in one) are
            # both counted and both owed a CoUninitialize.
            if candidate.CoInitializeEx(None, 0) >= 0:
                ole32 = candidate
        except Exception:
            log.exception("joining a COM apartment")
    try:
        yield
    finally:
        if ole32 is not None:
            ole32.CoUninitialize()


class OpenPort:
    """
    One port being listened to. Its thread polls the library and calls
    `on_event(ns, data)` for each event, `ns` on the `perf_counter_ns()` clock
    and `data` the message's bytes. Make one with PortSystem.open().
    """

    def __init__(self, system, lm, native, info, on_event):
        self.info = info
        self._system = system
        self._lm = lm
        self._native = native
        self._on_event = on_event
        # False when the port's own times are no use (see the notes above).
        self._library_time = system.api != lm.API.WINDOWS_MIDI_SERVICES
        self._offset = 0
        self._gone = False
        self._stop = threading.Event()
        self._started = threading.Event()
        self._failure = None
        self._in = None
        self._library_says_open = True

        self._thread = threading.Thread(
            target=self._run, name=f"midi-in {info.name}", daemon=True
        )
        self._thread.start()
        if not self._started.wait(START_PATIENCE_SEC):
            self._stop.set()
            raise PortBusy(f"{info.name} did not open")
        if self._failure is not None:
            raise PortBusy(self._failure)

    # The port's thread.

    def _run(self):
        with _com():
            try:
                self._serve()
            finally:
                # Whatever happened, open() stops waiting.
                self._started.set()
                self._system._forget(self)

    def _serve(self):
        """
        Make the input, open it, poll it until told to stop, and close it: all
        on this thread, where the library's objects are also let go of, when
        this returns and before the thread leaves its COM apartment.
        """
        midi_in = None
        try:
            midi_in = self._make()
            self._in = midi_in
            self.resync()
            interval = INPUT_POLL_SEC if self._library_time else STAMPED_POLL_SEC
            self._started.set()
            while True:
                # A sleep, not a wait on the stop event: on Windows a wait
                # with a timeout is rounded up to the system's timer tick
                # (15.6 ms), which time.sleep is not since Python 3.11, and a
                # port stamped when read needs to look every few milliseconds.
                time.sleep(interval)
                if self._stop.is_set():
                    break
                self._poll(midi_in)
        except Exception as e:  # anything, so that open() hears of it
            if self._started.is_set():
                log.exception("MIDI port %s", self.info.name)
            else:
                self._failure = _reason(e)
        finally:
            self._stop.set()
            if midi_in is not None:
                # What came in before it closed is still owed to on_event.
                try:
                    midi_in.close_port()
                    self._poll(midi_in)
                except Exception:
                    log.exception("closing MIDI port %s", self.info.name)
            # The library's object holds this one, through `conf.on_message`,
            # in a loop Python's collector cannot see. So it is let go of by
            # hand.
            self._in = None

    def _make(self):
        """The library's input, open on the port. Raises if it will not be."""
        lm = self._lm
        conf = lm.InputConfiguration()
        conf.on_message = self._receive
        # Everything the instrument says is kept (spec F2) except the clock
        # that only says the cable is in time.
        conf.ignore_sysex = False
        conf.ignore_sensing = False
        conf.ignore_timing = True
        midi_in = lm.MidiIn(conf, self._system.api)
        if midi_in.get_current_api() != self._system.api:
            # The library makes a dummy when it cannot make the one asked for,
            # and a dummy opens any port and hears nothing.
            raise PortBusy(f"{self.info.name}: no input could be made for it")
        error = midi_in.open_port(self._native)
        if error:
            raise PortBusy(str(error))
        return midi_in

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

    def _poll(self, midi_in):
        try:
            midi_in.poll()
            self._library_says_open = midi_in.is_port_connected()
        except Exception:
            log.exception("MIDI port %s", self.info.name)

    # What the port's user asks of it.

    def connected(self) -> bool:
        """
        Whether the instrument is still there. Once it has gone this stays
        False, even if it comes back: the port the OS made for it before is
        not the one that was opened, so a port to it is opened again.
        """
        if self._stop.is_set() or self._gone or not self._library_says_open:
            return False
        if not self._system._is_listed(self.info):
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
        midi_in = self._in
        if not self._library_time or midi_in is None:
            return
        best = None
        for _ in range(OFFSET_READS):
            before = time.perf_counter_ns()
            theirs = midi_in.absolute_timestamp()
            after = time.perf_counter_ns()
            if best is None or after - before < best[0]:
                best = (after - before, (before + after) // 2 - theirs)
        self._offset = best[1]

    def close(self) -> None:
        """Stop listening. A listener may close its own port."""
        self._stop.set()
        if self._thread is not threading.current_thread():
            self._thread.join(timeout=2)
        self._system._forget(self)

    def _mark_gone(self) -> None:
        self._gone = True


class PortSystem:
    """
    The MIDI system of this machine: its input ports, told when one comes or
    goes, and the ability to open one. Make one with open_system().

    The library is only used on this system's threads, so `inputs()` and
    `open()` ask the observer's thread for a listing and wait for it (a few
    milliseconds): they are fine on any thread, the GUI's included. In a
    `watch` callback, which runs on that thread, they answer with the listing
    the callback was called for.
    """

    def __init__(self, asked):
        """
        `asked` is the name of the API to use (a member of pylibremidi.API),
        or None for the library's own choice; if it will not start this
        raises, and open_system tries the next.
        """
        self._asked = asked
        self._lm = None
        self.api = None
        self.name = ""
        # How many times the library's own observer called back. Only
        # tests/midi_live.py and tests/test_ports.py read it, to print and to
        # check; nothing in the app does, and on_change does not depend on it.
        self.observer_notices = 0
        self._failure = None
        self._watchers = []
        self._open = set()
        self._askers = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._wake = threading.Event()
        # The observer's thread alone writes these two.
        self._found = (0, [])
        self._seen = collections.Counter()
        self._relist_at = 0

        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, name="midi-ports", daemon=True)
        self._thread.start()
        if not self._ready.wait(START_PATIENCE_SEC):
            self._shut()
            raise RuntimeError("the MIDI system did not start")
        if self._failure is not None:
            no_library, text = self._failure
            raise (_NoLibrary if no_library else RuntimeError)(text)

    def inputs(self) -> list[PortInfo]:
        """The input ports the OS lists now."""
        return [info for info, _ in self._fresh()]

    def watch(self, on_change: Callable[[], None]) -> None:
        """
        Call `on_change()` whenever the list of input ports changes. It runs
        on the observer's thread: do not stay in it. It is called whether or
        not the library's own observer gave a notice (on CoreMIDI the first
        run on CI showed it silent): the thread lists the ports every
        WATCH_POLL_SEC on CoreMIDI and every RELIST_SEC elsewhere, and says so
        when the list is not the one before, and a notice from the library
        only brings that listing forward. A change from before watch() was
        called is not told: call inputs() after it.
        """
        with self._lock:
            self._watchers.append(on_change)

    def open(self, port: PortInfo, on_event: Callable[[int, bytes], None]) -> OpenPort:
        """
        Start listening to a port. `on_event(ns, data)` is called on a thread
        of this module's for each event, so it should only pass the event on.
        Raises PortBusy if the OS will not open it.
        """
        native = next((n for info, n in self._fresh() if info == port), None)
        if native is None:
            raise PortBusy(f"{port.name} is not in the list of ports")
        opened = OpenPort(self, self._lm, native, port, on_event)
        with self._lock:
            if not self._stop.is_set():
                self._open.add(opened)
                return opened
        # The system closed while this port was opening.
        opened.close()
        raise PortBusy("the MIDI system was closed")

    def close(self) -> None:
        with self._lock:
            self._stop.set()
            ports = list(self._open)
            self._open.clear()
        self._wake.set()
        for port in ports:
            port.close()
        if self._thread is not threading.current_thread():
            self._thread.join(timeout=2)

    # What OpenPort asks of its system.

    def _is_listed(self, info: PortInfo) -> bool:
        """Whether a port is in the list, as of a moment ago."""
        when, found = self._found
        if time.perf_counter_ns() - when > LISTING_FRESH_SEC * 1e9:
            found = self._fresh()
        return any(i == info for i, _ in found)

    def _forget(self, port: OpenPort) -> None:
        with self._lock:
            self._open.discard(port)

    # The listing: made by the observer's thread, asked for by the others.

    def _fresh(self):
        """
        The ports as of now, each as PortInfo and the library's own object,
        listed by the observer's thread. Nothing when the system is closed.
        """
        if self._thread is threading.current_thread():
            # A watcher asking: the listing it was called for.
            return self._found[1]
        asked = threading.Event()
        with self._lock:
            if self._stop.is_set():
                return []
            self._askers.append(asked)
        self._wake.set()
        asked.wait(LISTING_PATIENCE_SEC)
        return [] if self._stop.is_set() else self._found[1]

    def _list(self, observer) -> bool:
        """List the ports (on the observer's thread). True if they differ from
        the listing before."""
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
        seen = collections.Counter(info for info, _ in found)
        changed = seen != self._seen
        self._seen = seen
        self._found = (time.perf_counter_ns(), found)
        self._relist_at = time.perf_counter() + RELIST_SEC
        return changed

    def _notice(self, _port):
        self.observer_notices += 1

    # The observer's thread.

    def _run(self):
        with _com():
            try:
                self._serve()
            finally:
                self._ready.set()
                self._shut()

    def _serve(self):
        """
        Start the observer and watch with it until closed. The library's
        objects are let go of when this returns, on this thread and before it
        leaves its COM apartment.
        """
        observer = self._start()
        self._ready.set()
        if observer is None:
            return
        while not self._stop.is_set():
            self._wake.wait(WATCH_POLL_SEC)
            self._wake.clear()
            if self._stop.is_set():
                break
            self._pass(observer)

    def _start(self):
        """The library's observer, listed once, or None and the reason."""
        try:
            try:
                import pylibremidi as lm
            except Exception as e:  # a missing or broken library, any way
                raise _NoLibrary(_reason(e)) from e
            asked = None if self._asked is None else getattr(lm.API, self._asked)
            conf = lm.ObserverConfiguration()
            conf.input_added = self._notice
            conf.input_removed = self._notice
            conf.track_hardware = True
            # A software instrument or a loopback cable is an input too.
            conf.track_virtual = True
            # Told of what changes; the ones already there are in inputs().
            conf.notify_in_constructor = False
            observer = lm.Observer(conf) if asked is None else lm.Observer(conf, asked)
            got = observer.get_current_api()
            if got == lm.API.DUMMY or (asked is not None and got != asked):
                if asked is None:
                    raise RuntimeError("the library has no MIDI system to use here")
                wanted = _NAMES.get(self._asked, self._asked)
                raise RuntimeError(f"{wanted} is not available to the library")
            self._lm = lm
            self.api = got
            self.name = _NAMES.get(got.name) or lm.get_api_display_name(got)
            self._list(observer)
            return observer
        except Exception as e:
            # The error's text, not the error: see _reason. A MIDI Services
            # that is not there fails here, and the error kept its traceback
            # alive, and with it the configuration whose callbacks hold this
            # system: nanobind reported the leak at exit.
            self._failure = (isinstance(e, _NoLibrary), _reason(e))
            return None

    def _pass(self, observer):
        """One look at the library: its notices, the ports, and who to tell."""
        with self._lock:
            askers, self._askers = self._askers, []
        try:
            changed = False
            listed = False
            # CoreMIDI's notices only come in while the ports are listed.
            if (self.api == self._lm.API.COREMIDI or askers
                    or time.perf_counter() >= self._relist_at):
                changed = self._list(observer)
                listed = True
            before = self.observer_notices
            observer.poll()
            if self.observer_notices != before and not listed:
                # The library says something moved: look now, not at the
                # next listing.
                changed = self._list(observer)
            if changed:
                self._sweep()
                self._tell()
        except Exception:
            log.exception("MIDI port watcher")
        finally:
            for asked in askers:
                asked.set()

    def _shut(self):
        """No more listings: answer whoever is waiting for one."""
        with self._lock:
            self._stop.set()
            askers, self._askers = self._askers, []
        for asked in askers:
            asked.set()

    def _sweep(self):
        """Mark the open ports whose instrument is no longer listed."""
        present = {info for info, _ in self._found[1]}
        with self._lock:
            ports = list(self._open)
        for port in ports:
            if port.info not in present:
                port._mark_gone()

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
    app without MIDI still records audio. Safe to call from any thread: the
    library is imported and used on threads of this module's, not the caller's.

    On Windows, Windows MIDI Services first (the newer, which lets apps share
    a port) if its observer starts, else the classic one.
    """
    if sys.platform == "win32":
        asked = ["WINDOWS_MIDI_SERVICES", "WINDOWS_MM"]
    elif sys.platform == "darwin":
        asked = ["COREMIDI"]
    else:
        asked = [None]

    reasons = []
    for api in asked:
        try:
            return PortSystem(api), None
        except _NoLibrary as e:
            return None, f"MIDI is not available: {e}"
        except Exception as e:
            reasons.append(_reason(e))
    return None, "MIDI is not available: " + "; ".join(reasons)
