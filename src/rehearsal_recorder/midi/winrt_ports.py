"""
The controller's ports on Windows, through WinRT itself (pywinrt) and not
through the MIDI library.

Why not pylibremidi, as for every other port: its WinRT input and output open
a port with `get(MidiInPort::FromIdAsync(id))` (libremidi's
backends/winuwp/helpers.hpp), a wait with no end, and its Python binding
holds the GIL for the whole call (pylibremidi 5.4.3 has no
gil_scoped_release anywhere). A Bluetooth controller that was paired and is
now switched off stays in WinRT's list, and Windows can take forever to open
it: Steinberg documents the same hang for Cubase starting with a Bluetooth
MIDI device off. So the app opened it about 50 ms after starting and then no
Python ran at all, the startup screen's included, until the user took the
controller out of the config.

pywinrt (winrt-runtime 4.0.3) lets go of the GIL for every call into WinRT
(interp.cpp, around the vtable call), and an operation's result is handed
over by its Completed handler, so this waits for an open on a
threading.Event for at most OPEN_PATIENCE_SEC and then gives it up. The
controller says it does not answer, and the rest of the app goes on.

What it lists is what libremidi's WinRT observer listed (observer.hpp): a
DeviceWatcher on MidiInPort's and MidiOutPort's selectors, with a port's name
the DeviceInformation's Name and its id the Id, and no device or maker. So a
controller saved before this module was written is found again.

Threads and COM. WinRT is used from threads that never chose an apartment,
which use the process's multithreaded one: this system's own thread joins it
(ports._com) and stays in it until close(), so it is there for the others.
Only the controller's own threads open ports; the interface's calls read the
listing, which the watchers' handlers keep.

On a Mac and Linux this is never made (ports.open_controller_system).
"""

import logging
import threading
import time

from rehearsal_recorder.midi.ports import (
    LISTING_PATIENCE_SEC,
    START_PATIENCE_SEC,
    PortBusy,
    PortInfo,
    _com,
    _reason,
)

log = logging.getLogger(__name__)

# How long an open may take before it is given up. Windows opens a controller
# that is on in a second or two; one that is off it may never open.
OPEN_PATIENCE_SEC = START_PATIENCE_SEC

# After an open was given up, how long no port is tried again. The
# controller tries every 50 ms, and holds its lock while it waits: without a
# pause it would be waiting nearly all the time. For every port and not the
# one: the controller opens its output first, and an output that opens and
# an input that does not would have the output opened and closed each time.
RETRY_SEC = 5.0

# How often the system's thread looks whether Windows stopped a watcher.
WATCH_LOOK_SEC = 1.0

# How often a wait looks whether the system was closed meanwhile, so that
# closing the window does not wait out an open.
CLOSE_LOOK_SEC = 0.1

NAME = "Windows MIDI (WinRT)"

# What Settings › Controls says, once, when the controller does not answer.
NOT_ANSWERING = "The controller does not answer. Check that it is on and nearby. РЭХА keeps trying."


def _load():
    """pywinrt's three namespaces this uses. Imported on the system's thread."""
    from winrt.windows.devices import enumeration, midi
    from winrt.windows import foundation

    return enumeration, midi, foundation


def _close_quietly(native):
    try:
        if native is not None:
            native.close()
    except Exception:
        pass


def _close_result(operation):
    """Close the port a finished FromIdAsync opened, if it opened one."""
    try:
        native = operation.get_results()
    except Exception:
        return
    _close_quietly(native)


class _NoAnswer(PortBusy):
    """An open Windows did not answer in time, as against one it refused."""


class WinRTSystem:
    """
    The controller's ports on Windows: the part of ports.PortSystem the
    controller uses (`name`, `inputs`, `outputs`, `open`, `open_output`,
    `close`). Raises if WinRT will not start, and open_controller_system then
    keeps the instruments' system.
    """

    def __init__(self, load=_load):
        self.name = NAME
        self._load = load
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._failure = None
        self._listed = {"in": {}, "out": {}}
        self._enumerated = {"in": threading.Event(), "out": threading.Event()}
        self._open = set()
        self._waiting = set()
        # How many times interrupt() was called: an open that sees it change
        # gives up.
        self._interrupts = 0
        # When a port is tried again after one did not answer, and which of
        # them, by (kind, id), the log has been told of.
        self._quiet_until = 0.0
        self._told = set()
        self._revived = set()
        self._thread = threading.Thread(target=self._run, name="winrt-ports", daemon=True)
        self._thread.start()
        if not self._ready.wait(START_PATIENCE_SEC):
            self._stop.set()
            raise RuntimeError("WinRT MIDI did not start")
        if self._failure is not None:
            raise RuntimeError(self._failure)

    # The system's thread.

    def _run(self):
        with _com():
            watchers = []
            try:
                enumeration, midi, foundation = self._load()
                self._midi, self._done = midi, foundation.AsyncStatus
                status = enumeration.DeviceWatcherStatus
                stopped = (status.STOPPED, status.ABORTED)
                for kind, port_class in (("in", midi.MidiInPort), ("out", midi.MidiOutPort)):
                    watcher = enumeration.DeviceInformation.create_watcher_aqs_filter(
                        port_class.get_device_selector())
                    watcher.add_added(lambda _, info, kind=kind: self._added(kind, info))
                    watcher.add_removed(lambda _, update, kind=kind: self._removed(kind, update))
                    # Microsoft's DeviceWatcher says a watcher with no Updated
                    # handler is not told of devices added after enumeration.
                    watcher.add_updated(lambda _, update: None)
                    watcher.add_enumeration_completed(
                        lambda _, __, kind=kind: self._enumerated[kind].set())
                    watcher.start()
                    watchers.append((kind, watcher))
            except Exception as e:  # pywinrt missing, or WinRT refused
                self._stop_watchers(watchers)
                self._failure = _reason(e)
                self._ready.set()
                return
            self._ready.set()
            while not self._stop.wait(WATCH_LOOK_SEC):
                for kind, watcher in watchers:
                    self._revive(kind, watcher, stopped)
            self._stop_watchers(watchers)

    @staticmethod
    def _stop_watchers(watchers):
        for _, watcher in watchers:
            try:
                watcher.stop()
            except Exception:
                log.exception("stopping a WinRT MIDI watcher")

    def _revive(self, kind, watcher, stopped):
        """
        Start again a watcher that Windows stopped, which it may do (its
        status Aborted). What it listed is let go first: a port that went
        meanwhile was not said, and the new listing says what there is. A
        port that is open is then gone for a moment, and the controller opens
        it again. A listing asked for meanwhile does not wait for the new one.
        The log is told the first time only: a watcher that will not stay
        started would otherwise fill it.
        """
        try:
            if watcher.status not in stopped:
                return
        except Exception:
            return
        first = kind not in self._revived
        self._revived.add(kind)
        if first:
            log.error("Controller MIDI: Windows stopped listing %s ports; listing again", kind)
        with self._lock:
            self._listed[kind] = {}
            ports = [p for p in self._open if p.kind == kind]
        for port in ports:
            port._gone = True
        self._enumerated[kind].set()
        try:
            watcher.start()
        except Exception:
            if first:
                log.exception("starting a WinRT MIDI watcher again")

    # The watchers' handlers, on WinRT's threads. They never raise into it.

    def _added(self, kind, info):
        try:
            port = PortInfo(name=info.name or info.id, id=info.id)
            with self._lock:
                self._listed[kind][info.id] = port
        except Exception:
            log.exception("a WinRT MIDI port that came")

    def _removed(self, kind, update):
        try:
            with self._lock:
                gone = self._listed[kind].pop(update.id, None)
                ports = [p for p in self._open if p.kind == kind and p.info == gone]
            for port in ports:
                port._gone = True
        except Exception:
            log.exception("a WinRT MIDI port that went")

    # What the controller asks.

    def _list(self, kind):
        if self._stop.is_set():
            return []
        self._enumerated[kind].wait(LISTING_PATIENCE_SEC)
        with self._lock:
            return list(self._listed[kind].values())

    def inputs(self) -> list[PortInfo]:
        return self._list("in")

    def outputs(self) -> list[PortInfo]:
        return self._list("out")

    def open(self, port: PortInfo, on_event) -> "WinRTPort":
        """Start listening to a port: `on_event(ns, data)` for each message,
        on a thread of WinRT's. Raises PortBusy if it will not open."""
        native = self._open_native("in", port, self._midi.MidiInPort)
        return self._keep(self._wrap("in", port, native, on_event))

    def open_output(self, port: PortInfo) -> "WinRTPort":
        native = self._open_native("out", port, self._midi.MidiOutPort)
        return self._keep(self._wrap("out", port, native, None))

    def interrupt(self) -> None:
        """
        Give up every open still waiting, at its next look (CLOSE_LOOK_SEC),
        and let the next one be tried at once. Controller.configure calls it
        when the controller is changed in Controls, so that the change does
        not wait for an open of the one before.
        """
        with self._lock:
            self._interrupts += 1
            self._quiet_until = 0.0
            waiting = list(self._waiting)
        self._cancel(waiting)

    def close(self) -> None:
        """Let go of every port and stop listing. An open still waiting gives
        up at its next look (CLOSE_LOOK_SEC)."""
        with self._lock:
            self._stop.set()
            ports, self._open = list(self._open), set()
            waiting = list(self._waiting)
        self._cancel(waiting)
        for port in ports:
            port.close()
        if self._thread is not threading.current_thread():
            self._thread.join(timeout=2)

    @staticmethod
    def _cancel(operations):
        for operation in operations:
            try:
                operation.cancel()
            except Exception:
                pass

    # Opening.

    def _open_native(self, kind, port, port_class):
        if self._stop.is_set():
            raise PortBusy("the MIDI system was closed")
        key = (kind, port.id)
        with self._lock:
            listed = port.id in self._listed[kind]
            quiet = self._quiet_until > time.monotonic()
        if not listed:
            raise PortBusy(f"{port.name} is not in the list of ports")
        if quiet:
            raise _NoAnswer(NOT_ANSWERING)
        try:
            native = self._wait_open(port_class, port)
        except _NoAnswer:
            with self._lock:
                self._quiet_until = time.monotonic() + RETRY_SEC
                first = key not in self._told
                self._told.add(key)
            # Once until it opens: a controller left off all evening would
            # otherwise put a line in the crash log every few seconds.
            if first:
                log.error("Controller MIDI: %s did not open in %d s; trying again every %d s",
                          port.name, OPEN_PATIENCE_SEC, OPEN_PATIENCE_SEC + RETRY_SEC)
            raise
        with self._lock:
            self._told.discard(key)
        return native

    def _wait_open(self, port_class, port):
        """
        FromIdAsync for `port`, waited for at most OPEN_PATIENCE_SEC on a
        threading.Event, which waits without the GIL. Raises _NoAnswer when
        Windows has not answered by then, PortBusy when it said no.
        """
        try:
            operation = port_class.from_id_async(port.id)
        except Exception as e:
            raise PortBusy(_reason(e)) from None
        done = threading.Event()
        # An open given up on can still finish later, with a port Windows
        # opened for nobody: whoever sees it last closes it, so that it does
        # not hold the controller against the next try.
        gate = threading.Lock()
        given_up = []

        def completed(_operation, status):
            done.set()
            with gate:
                late = bool(given_up)
            if late and status == self._done.COMPLETED:
                _close_result(operation)

        operation.completed = completed
        with self._lock:
            self._waiting.add(operation)
            interrupts = self._interrupts

        def let_go():
            return self._stop.is_set() or self._interrupts != interrupts

        try:
            deadline = time.monotonic() + OPEN_PATIENCE_SEC
            while not done.wait(CLOSE_LOOK_SEC):
                if let_go() or time.monotonic() >= deadline:
                    break
        finally:
            with self._lock:
                self._waiting.discard(operation)
        with gate:
            status = operation.status
            dropped = let_go()
            if status == self._done.STARTED or dropped:
                given_up.append(True)
        if status == self._done.STARTED:
            # Windows may let a cancelled open run on. The next try starts a
            # new one all the same: an open that hung may never end, even once
            # the controller is on, while a new one can. One that runs on
            # costs a little memory until it ends.
            self._cancel([operation])
        if dropped:
            # close() and interrupt() cancel what waits; a port that came as
            # they did goes too.
            if status == self._done.COMPLETED:
                _close_result(operation)
            if self._stop.is_set():
                raise PortBusy("the MIDI system was closed")
            raise PortBusy(f"{port.name} was let go: the controller was changed")
        if status == self._done.STARTED:
            raise _NoAnswer(NOT_ANSWERING)
        if status == self._done.CANCELED:
            raise PortBusy(f"{port.name} did not open")
        try:
            # Raises with Windows' words for an open that failed.
            native = operation.get_results()
        except Exception as e:
            raise PortBusy(_reason(e)) from None
        if native is None:
            # FromIdAsync's answer for a port it could not open.
            raise PortBusy(f"{port.name} did not open")
        return native

    def _wrap(self, kind, info, native, on_event):
        try:
            return WinRTPort(self, kind, info, native, on_event)
        except Exception as e:  # WinRT refused the message handler
            _close_quietly(native)
            raise PortBusy(_reason(e)) from None

    def _keep(self, port):
        with self._lock:
            if not self._stop.is_set():
                self._open.add(port)
                return port
        port.close()
        raise PortBusy("the MIDI system was closed")

    def _forget(self, port):
        with self._lock:
            self._open.discard(port)

    def _is_listed(self, kind, info):
        with self._lock:
            return self._listed[kind].get(info.id) == info


class WinRTPort:
    """
    An open input (`on_event`) or output (`send`). Like ports.OpenPort, once
    its device has gone it stays not connected, even if it comes back: the
    controller opens it again.
    """

    def __init__(self, system, kind, info, native, on_event):
        self.info = info
        self.kind = kind
        self._system = system
        self._native = native
        self._on_event = on_event
        self._closed = False
        self._gone = False
        self._token = None
        if on_event is not None:
            self._token = native.add_message_received(self._receive)

    def _receive(self, _port, args):
        """On a thread of WinRT's. Never raises into it. The time is when it
        is read: the controller does not use it."""
        try:
            self._on_event(time.perf_counter_ns(), bytes(args.message.raw_data))
        except Exception:
            log.exception("MIDI event from %s", self.info.name)

    def connected(self) -> bool:
        return (not self._closed and not self._gone
                and self._system._is_listed(self.kind, self.info))

    def send(self, data) -> None:
        if self._closed:
            raise PortBusy("MIDI output closed")
        try:
            self._native.send_buffer(bytes(data))
        except Exception as e:
            raise PortBusy(_reason(e)) from None

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        native, self._native = self._native, None
        try:
            if self._token is not None:
                native.remove_message_received(self._token)
            native.close()
        except Exception:
            log.exception("closing MIDI port %s", self.info.name)
        self._system._forget(self)
