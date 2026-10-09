"""
A MIDI system with nothing behind it, for the suites: ports are plugged in and
pulled out by the test, and events arrive when the test sends them.

It has the methods midi/ports.py's PortSystem has and nothing the app does not
call, so code written against this one runs against the real one. The extra
calls are the test's: plug(), pull(), send(); and two settings: `exclusive`,
for a system that opens a port only once (classic Windows MIDI), and `notify`,
False for an observer that misses a change.

    fake = FakePortSystem()
    fake.plug(PortInfo("TD-17"))
    port = fake.open(fake.inputs()[0], lambda ns, data: heard.append(data))
    fake.send("TD-17", 1_000_000, bytes([0x90, 38, 100]))
    fake.pull("TD-17")          # port.connected() is now False

Importing it needs `src/` on sys.path, as every suite arranges.
"""

from rehearsal_recorder.midi.ports import PortBusy


class FakeOpenPort:
    """What FakePortSystem.open() gives back: OpenPort's methods, and a record."""

    def __init__(self, system, info, on_event):
        self.info = info
        self.on_event = on_event
        self.closed = False
        self.resyncs = 0
        self._system = system
        self._connected = True

    def connected(self):
        return self._connected and not self.closed

    def resync(self):
        self.resyncs += 1

    def close(self):
        self.closed = True
        self._system.open_ports.discard(self)


class FakePortSystem:
    name = "Fake MIDI"
    # How often the library's own observer called back: only
    # tests/midi_live.py reads it, to print it.
    observer_notices = 0

    def __init__(self, ports=(), exclusive=False):
        self._ports = list(ports)
        self._watchers = []
        self._closed = False
        # Every port opened and not yet closed.
        self.open_ports = set()
        # Names whose open() raises PortBusy, as a port another app holds does.
        self.refuse = set()
        # True: a port already open cannot be opened again, not even by the
        # same app, as on classic Windows MIDI (spec P5). CoreMIDI lets it be.
        self.exclusive = exclusive
        # False: plug() and pull() tell no watcher, as an observer that misses
        # a change does (spec P6).
        self.notify = True
        # How many times each port name has been opened, closed ones too:
        # a port that was kept open between two screens was opened once.
        self.opens = {}

    def inputs(self):
        return [] if self._closed else list(self._ports)

    def watch(self, on_change):
        self._watchers.append(on_change)

    def open(self, port, on_event):
        if self._closed:
            raise PortBusy("the MIDI system was closed")
        if port.name in self.refuse:
            raise PortBusy(f"{port.name} is in use")
        if port not in self._ports:
            raise PortBusy(f"{port.name} is not in the list of ports")
        if self.exclusive and any(opened.info == port for opened in self.open_ports):
            raise PortBusy(f"{port.name} is already open")
        self.opens[port.name] = self.opens.get(port.name, 0) + 1
        opened = FakeOpenPort(self, port, on_event)
        self.open_ports.add(opened)
        return opened

    def close(self):
        """As the real one: its ports close, and it lists and opens nothing."""
        self._closed = True
        for port in list(self.open_ports):
            port.close()

    # What only a test does.

    def plug(self, info):
        """A port appears, and every watcher is told."""
        self._ports.append(info)
        self._tell()

    def pull(self, name):
        """
        A port goes: the ports open on it are no longer connected (they stay
        open until closed, as a real one does), and every watcher is told.
        """
        self._ports = [p for p in self._ports if p.name != name]
        for port in self.open_ports:
            if port.info.name == name:
                port._connected = False
        self._tell()

    def send(self, name, ns, data):
        """
        An event from the instrument on the port of that name, handed straight
        to the on_event of every port open on it, as the OS gives it to each
        input that listens. True if a port was listening, False if none was.
        """
        heard = False
        for port in list(self.open_ports):
            if port.info.name == name and port.connected():
                port.on_event(ns, data)
                heard = True
        return heard

    def _tell(self):
        if self._closed or not self.notify:
            return
        for on_change in list(self._watchers):
            on_change()
