"""
A stand-in for the `pylibremidi` module, with the real one's quirks, so that
midi/ports.py can be checked on any machine. Not to be confused with
fake_midi.py, which stands in for ports.py itself.

What the real package does that this copies, each found by reading its source
or trying it (the notes at the top of ports.py say how):

  - Callbacks run only inside `poll()`, on the thread that called it.
  - `InputConfiguration.timestamps` cannot be set: any number is a TypeError.
  - `Message.bytes` cannot be read and `len(message)` fails; `message[i]` and
    `message.__len__(0)` work.
  - `MidiIn.is_port_connected()` is true from a good open until close_port().
  - An API that is not in the build gives a "dummy" observer, not an error.
  - A MIDI input on an API that cannot be made is a dummy one too, and its
    open_port() works.
  - `on_error` and `on_warning` abort the process when they are called; here
    setting either is written down in `world.error_callbacks_set`, which no
    test of ports.py may find true.
  - `absolute_timestamp()` answers 0 on Windows MIDI Services.
  - The OS's notice of a port coming or going reaches a CoreMIDI observer only
    when its thread lists the ports; any other gets it when the port comes or
    goes. Either way the callback runs inside `poll()` (`world.silent` turns
    the notices off, as when the OS delivers none at all).

`install()` puts it where `import pylibremidi` finds it and returns the
`World` a test moves things in; `remove()` takes it away. The module is built
when it is first imported, by whichever thread imports it, and that thread is
written down: ports.py must never be that of its caller.
"""

import enum
import importlib.abc
import importlib.machinery
import queue
import sys
import threading
import time
import types


class World:
    """Everything a test arranges: ports, which APIs exist, who did what."""

    def __init__(self):
        self.ports = []
        self.present_apis = {"COREMIDI", "WINDOWS_MM", "WINDOWS_MIDI_SERVICES", "ALSA_RAW"}
        # API names whose observer raises when made, as Windows MIDI Services
        # does where its runtime is not installed.
        self.observer_raises = set()
        # API names whose MIDI input is the dummy one.
        self.dummy_in = set()
        # Port names whose open_port() fails, as a port another app holds.
        self.refuse = set()
        self.silent = False
        self.error_callbacks_set = False
        self.imported_on = []
        self.made_on = []
        self.inputs = []
        self.observers = []
        # What happened, in order, as tuples whose first item says what:
        # ("import",), ("observer",), ("minput",). A test that fakes
        # Windows' COM adds its own calls (see test_ports.py).
        self.order = []

    def add_port(self, name, port_id, device="", maker=""):
        port = self.module.InputPort(name, port_id, device, maker)
        self.ports.append(port)
        for observer in self.observers:
            observer.notice("input_added", port)
        return port

    def remove_port(self, name):
        gone = [p for p in self.ports if p.port_name == name]
        self.ports = [p for p in self.ports if p.port_name != name]
        for port in gone:
            for observer in self.observers:
                observer.notice("input_removed", port)

    def send(self, name, data, ago_ns=0):
        """What the OS does when the instrument plays: every input open on
        that port gets the message, stamped with the library's own clock."""
        for midi_in in self.inputs:
            if midi_in.open and midi_in.port.port_name == name:
                midi_in.q.put(self.module.Message(data, midi_in.absolute_timestamp() - ago_ns))


def build(world):
    """The module itself."""
    lm = types.ModuleType("pylibremidi")

    class API(enum.Enum):
        UNSPECIFIED = 0
        COREMIDI = 1
        ALSA_RAW = 3
        WINDOWS_MM = 5
        WINDOWS_MIDI_SERVICES = 4099
        DUMMY = 65535

    class Error:
        def __init__(self, text=""):
            self.text = text

        def __bool__(self):
            return bool(self.text)

        def __str__(self):
            return self.text

    class InputPort:
        def __init__(self, name="", port=0, device="", maker=""):
            self.client = 0
            self.port = port
            self.port_name = name
            self.display_name = name
            self.device_name = device
            self.manufacturer = maker

    class Message:
        def __init__(self, data, timestamp):
            self._data = list(data)
            self.timestamp = timestamp

        @property
        def bytes(self):
            raise TypeError("Unable to convert function return value to a Python type!")

        def __len__(self, *stray):
            # The real one's takes an argument nobody means to give, so
            # len(message) fails and message.__len__(0) is the size.
            if not stray:
                raise TypeError("__len__(): incompatible function arguments")
            return len(self._data)

        def __getitem__(self, i):
            return self._data[i]

    class ObserverConfiguration:
        def __init__(self):
            self.track_hardware = True
            self.track_virtual = False
            self.notify_in_constructor = True
            self.input_added = None
            self.input_removed = None
            self._on_error = None
            self._on_warning = None

        @property
        def on_error(self):
            return self._on_error

        @on_error.setter
        def on_error(self, value):
            world.error_callbacks_set = True
            self._on_error = value

        @property
        def on_warning(self):
            return self._on_warning

        @on_warning.setter
        def on_warning(self, value):
            world.error_callbacks_set = True
            self._on_warning = value

    class Observer:
        def __init__(self, conf, api=None):
            world.made_on.append(("Observer", threading.current_thread()))
            world.order.append(("observer",))
            if api is not None and api.name in world.observer_raises:
                raise RuntimeError(f"{api.name}: the class is not registered")
            if api is None:
                api = API.ALSA_RAW if "ALSA_RAW" in world.present_apis else API.DUMMY
            elif api.name not in world.present_apis:
                api = API.DUMMY
            self.conf = conf
            self.api = api
            self.q = queue.SimpleQueue()
            self.known = list(world.ports)
            world.observers.append(self)

        def get_current_api(self):
            return self.api

        def get_input_ports(self):
            now = list(world.ports)
            if self.api == API.COREMIDI:
                # Its notices come in while the ports are listed.
                for p in now:
                    if p not in self.known:
                        self.notice("input_added", p, listing=True)
                for p in self.known:
                    if p not in now:
                        self.notice("input_removed", p, listing=True)
            self.known = now
            return now

        def notice(self, which, port, listing=False):
            if world.silent or (self.api == API.COREMIDI) != listing:
                return
            callback = getattr(self.conf, which)
            if callback:
                self.q.put((callback, port))

        def poll(self):
            while True:
                try:
                    callback, port = self.q.get_nowait()
                except queue.Empty:
                    return
                if callback:
                    callback(port)

    class InputConfiguration:
        def __init__(self):
            self.on_message = None
            self.ignore_sysex = True
            self.ignore_timing = True
            self.ignore_sensing = True

        @property
        def timestamps(self):
            return 2

        @timestamps.setter
        def timestamps(self, value):
            raise TypeError("incompatible function arguments: expected libremidi::timestamp_mode")

    class MidiIn:
        def __init__(self, conf, api=None):
            world.made_on.append(("MidiIn", threading.current_thread()))
            world.order.append(("minput",))
            self.conf = conf
            self.api = API.DUMMY if api.name in world.dummy_in else api
            self.q = queue.SimpleQueue()
            self.open = False
            self.port = None
            self.origin = time.perf_counter_ns() - 7_000_000_000
            world.inputs.append(self)

        def get_current_api(self):
            return self.api

        def open_port(self, port):
            if self.api == API.DUMMY:
                self.open = True
                return Error()
            if port.port_name in world.refuse:
                return Error("Device or resource busy")
            self.open = True
            self.port = port
            return Error()

        def is_port_connected(self):
            return self.open

        def close_port(self):
            self.open = False
            return Error()

        def absolute_timestamp(self):
            if self.api.name == "WINDOWS_MIDI_SERVICES":
                return 0
            return time.perf_counter_ns() - self.origin

        def poll(self):
            while True:
                try:
                    message = self.q.get_nowait()
                except queue.Empty:
                    return
                self.conf.on_message(message)

    lm.API = API
    lm.Error = Error
    lm.InputPort = InputPort
    lm.Message = Message
    lm.ObserverConfiguration = ObserverConfiguration
    lm.Observer = Observer
    lm.InputConfiguration = InputConfiguration
    lm.MidiIn = MidiIn
    lm.get_api_display_name = lambda api: api.name.title()
    lm.get_version = lambda: "stand-in"
    world.module = lm
    return lm


class _Finder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """Builds the module when it is imported, and notes on which thread."""

    def __init__(self, world):
        self.world = world

    def find_spec(self, name, path=None, target=None):
        if name == "pylibremidi":
            return importlib.machinery.ModuleSpec(name, self)
        return None

    def create_module(self, spec):
        return build(self.world)

    def exec_module(self, module):
        self.world.imported_on.append(threading.current_thread())
        self.world.order.append(("import",))


_installed = []


def install():
    remove()
    world = World()
    finder = _Finder(world)
    sys.modules.pop("pylibremidi", None)
    sys.meta_path.insert(0, finder)
    _installed.append(finder)
    return world


def remove():
    while _installed:
        sys.meta_path.remove(_installed.pop())
    sys.modules.pop("pylibremidi", None)
