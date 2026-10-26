"""
A stand-in for the parts of pywinrt that midi/winrt_ports.py uses, so that it
can be checked on any machine. Not the library's WinRT, which fake_libremidi.py
stands in for: this is WinRT as pywinrt hands it to Python.

What it copies of pywinrt (winrt-runtime 4.0.3, read in its source):

  - An async operation's result comes through its Completed handler, on
    another thread, or at once when the handler is set on one already done.
    `status` is STARTED until then; `cancel()` on one still going makes it
    CANCELED and calls the handler. `get_results()` of one that failed
    raises OSError.
  - FromIdAsync of a port Windows cannot open completes with None, and of one
    that is switched off it may never complete at all: World.hang.
  - A DeviceWatcher calls Added for each port there is, then
    EnumerationCompleted, then Added and Removed as ports come and go, each
    on a thread of its own. Windows can stop one (its status Aborted), and
    then it says nothing more until it is started again: World.abort.
  - A received message's raw_data is a buffer that bytes() reads.

`install()` puts it where `from winrt.windows.devices import midi` finds it
and returns the World a test moves things in; `remove()` takes it away.
`modules(world)` gives the three namespaces without installing them, for
WinRTSystem's `load`.
"""

import enum
import itertools
import sys
import threading
import time
import types

NAMES = ("winrt", "winrt.windows", "winrt.windows.devices",
         "winrt.windows.devices.midi", "winrt.windows.devices.enumeration",
         "winrt.windows.foundation")


class AsyncStatus(enum.IntEnum):
    STARTED = 0
    COMPLETED = 1
    CANCELED = 2
    ERROR = 3


class DeviceWatcherStatus(enum.IntEnum):
    CREATED = 0
    STARTED = 1
    ENUMERATION_COMPLETED = 2
    STOPPING = 3
    STOPPED = 4
    ABORTED = 5


class World:
    """The ports there are, how each open goes, and what was done."""

    def __init__(self):
        self.ports = {"in": {}, "out": {}}
        # Port ids whose open never completes, completes with None, or fails.
        self.hang, self.refuse, self.fail = set(), set(), set()
        self.open_delay = 0.01
        self.asked = []  # (kind, id) of each FromIdAsync
        self.cancelled = 0
        self.ignore_cancel = False
        self.sent = []  # (id, bytes)
        self.closed = []  # ids of ports closed
        self.handlers_left = 0
        self.watchers = []
        self.stopped_watchers = 0
        self.send_fails = False
        self._tokens = itertools.count(1)
        self._hung = []

    def plug(self, kind, port_id, name):
        self.ports[kind][port_id] = name
        for watcher in self.watchers:
            if watcher.kind == kind and watcher.started:
                watcher._later(watcher._added, DeviceInformation(port_id, name))

    def pull(self, kind, port_id):
        self.ports[kind].pop(port_id, None)
        for watcher in self.watchers:
            if watcher.kind == kind and watcher.started:
                watcher._later(watcher._removed, DeviceInformationUpdate(port_id))

    def abort(self, kind):
        """Windows stops the watcher of `kind`, which hears no more."""
        for watcher in self.watchers:
            if watcher.kind == kind:
                watcher.started = False
                watcher.status = DeviceWatcherStatus.ABORTED

    def answer_late(self):
        """Windows opens, after all, every port whose open hung, as a
        controller switched on at last would be."""
        hung, self._hung = self._hung, []
        for operation, make, port_id in hung:
            operation._finish(AsyncStatus.COMPLETED, make(port_id))

    def play(self, port_id, data):
        """A message from the device on input `port_id`, to whoever listens."""
        for port in list(_open_inputs):
            if port.port_id == port_id:
                for handler in list(port.handlers.values()):
                    handler(port, MidiMessageReceivedEventArgs(bytes(data)))


_open_inputs = []


def _thread(fn, *args):
    threading.Thread(target=fn, args=args, daemon=True).start()


class Operation:
    def __init__(self):
        self.status = AsyncStatus.STARTED
        self._lock = threading.Lock()
        self._handler = None
        self._result = None

    @property
    def completed(self):
        return self._handler

    @completed.setter
    def completed(self, handler):
        with self._lock:
            self._handler = handler
            done = self.status != AsyncStatus.STARTED
        if done:
            handler(self, self.status)

    def _finish(self, status, result=None):
        with self._lock:
            if self.status != AsyncStatus.STARTED:
                return
            self.status, self._result = status, result
            handler = self._handler
        if handler is not None:
            handler(self, status)

    def cancel(self):
        """As FromIdAsync may: counted, and then ignored when World.ignore_cancel
        says so, which leaves the open to finish later."""
        if self.status == AsyncStatus.STARTED:
            _world.cancelled += 1
            if not _world.ignore_cancel:
                self._finish(AsyncStatus.CANCELED)

    def get_results(self):
        if self.status == AsyncStatus.ERROR:
            raise OSError(-2147023728, "Element not found.")
        if self.status != AsyncStatus.COMPLETED:
            raise OSError(-2147418113, "Illegal method call")
        return self._result


_world = None


def _open(kind, port_id, make):
    world = _world
    world.asked.append((kind, port_id))
    operation = Operation()
    if port_id in world.hang:
        world._hung.append((operation, make, port_id))
        return operation

    def finish():
        time.sleep(world.open_delay)
        if port_id in world.fail:
            operation._finish(AsyncStatus.ERROR)
        elif port_id in world.refuse:
            operation._finish(AsyncStatus.COMPLETED, None)
        else:
            operation._finish(AsyncStatus.COMPLETED, make(port_id))

    _thread(finish)
    return operation


class _Port:
    def __init__(self, port_id):
        self.port_id = port_id
        self.handlers = {}

    def close(self):
        _world.closed.append(self.port_id)
        if self in _open_inputs:
            _open_inputs.remove(self)
        _world.handlers_left = sum(len(p.handlers) for p in _open_inputs)


class MidiInPort(_Port):
    @classmethod
    def from_id_async(cls, port_id):
        def make(port_id):
            port = cls(port_id)
            _open_inputs.append(port)
            return port
        return _open("in", port_id, make)

    @classmethod
    def get_device_selector(cls):
        return "in-selector"

    def add_message_received(self, handler):
        token = next(_world._tokens)
        self.handlers[token] = handler
        return token

    def remove_message_received(self, token):
        self.handlers.pop(token, None)


class MidiOutPort(_Port):
    @classmethod
    def from_id_async(cls, port_id):
        return _open("out", port_id, cls)

    @classmethod
    def get_device_selector(cls):
        return "out-selector"

    def send_buffer(self, data):
        if _world.send_fails:
            raise OSError(-2147023174, "The RPC server is unavailable.")
        _world.sent.append((self.port_id, bytes(data)))


class _Message:
    def __init__(self, data):
        self.raw_data = memoryview(data)


class MidiMessageReceivedEventArgs:
    def __init__(self, data):
        self.message = _Message(data)


class DeviceInformation:
    def __init__(self, port_id, name):
        self.id, self.name = port_id, name

    @classmethod
    def create_watcher_aqs_filter(cls, selector):
        watcher = DeviceWatcher("in" if selector == "in-selector" else "out")
        _world.watchers.append(watcher)
        return watcher


class DeviceInformationUpdate:
    def __init__(self, port_id):
        self.id = port_id


class DeviceWatcher:
    def __init__(self, kind):
        self.kind = kind
        self.started = False
        self.status = DeviceWatcherStatus.CREATED
        self.starts = 0
        self._added = self._removed = self._completed = None
        self.updated_handled = False

    def add_added(self, handler):
        self._added = handler

    def add_removed(self, handler):
        self._removed = handler

    def add_updated(self, handler):
        self.updated_handled = True

    def add_enumeration_completed(self, handler):
        self._completed = handler

    def _later(self, handler, args):
        _thread(handler, self, args)

    def start(self):
        self.started = True
        self.starts += 1
        self.status = DeviceWatcherStatus.STARTED
        listed = [DeviceInformation(i, n) for i, n in _world.ports[self.kind].items()]

        def enumerate_():
            for info in listed:
                self._added(self, info)
            self.status = DeviceWatcherStatus.ENUMERATION_COMPLETED
            self._completed(self, None)

        _thread(enumerate_)

    def stop(self):
        self.started = False
        self.status = DeviceWatcherStatus.STOPPED
        _world.stopped_watchers += 1


def modules(world):
    """(enumeration, midi, foundation), as winrt_ports._load returns them."""
    global _world
    _world = world
    _open_inputs.clear()
    enumeration = types.SimpleNamespace(DeviceInformation=DeviceInformation,
                                        DeviceWatcherStatus=DeviceWatcherStatus)
    midi = types.SimpleNamespace(MidiInPort=MidiInPort, MidiOutPort=MidiOutPort)
    foundation = types.SimpleNamespace(AsyncStatus=AsyncStatus)
    return enumeration, midi, foundation


def install():
    world = World()
    enumeration, midi, foundation = modules(world)
    made = {name: types.ModuleType(name) for name in NAMES}
    made["winrt"].windows = made["winrt.windows"]
    made["winrt.windows"].devices = made["winrt.windows.devices"]
    made["winrt.windows"].foundation = made["winrt.windows.foundation"]
    made["winrt.windows.devices"].midi = made["winrt.windows.devices.midi"]
    made["winrt.windows.devices"].enumeration = made["winrt.windows.devices.enumeration"]
    made["winrt.windows.devices.midi"].__dict__.update(vars(midi))
    made["winrt.windows.devices.enumeration"].__dict__.update(vars(enumeration))
    made["winrt.windows.foundation"].__dict__.update(vars(foundation))
    sys.modules.update(made)
    return world


def remove():
    for name in NAMES:
        sys.modules.pop(name, None)
