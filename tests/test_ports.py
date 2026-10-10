"""
midi/ports.py, the one module that talks to the MIDI library, against a
stand-in for the library that has the real one's quirks (fake_libremidi.py):
callbacks only inside poll(), no settable timestamps, unreadable message
bytes, a port that stays "connected" when the device is pulled, a dummy
instead of an error for what is not there.

What this cannot say is how CoreMIDI or Windows behave: tests/midi_live.py
does, on the machines CI runs on. What it can say is that ports.py does the
right thing with each of those quirks, and keeps doing it.

Separate from the suites that block the library (sys.modules["pylibremidi"] =
None): this one puts the stand-in there instead.
"""

import contextlib
import ctypes
import inspect
import logging
import sys
import threading
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import fake_libremidi  # noqa: E402
import fake_midi  # noqa: E402

from rehearsal_recorder.midi import ports  # noqa: E402

problems = []

REAL_PLATFORM = sys.platform
# The observer is polled every tenth of a second and, off CoreMIDI, the ports
# listed once a second. Most checks wait on those, so they are made quicker
# here; one check below runs on the real ones.
REAL_WATCH_SEC = ports.WATCH_POLL_SEC
REAL_RELIST_SEC = ports.RELIST_SEC


def ok(label, cond):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def wait_for(condition, seconds=2.0):
    """True as soon as the condition holds, False if it never does."""
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        if condition():
            return True
        time.sleep(0.005)
    return condition()


class Logged(logging.Handler):
    """What ports.py wrote to its log, so that it is not printed here."""

    def __init__(self):
        super().__init__()
        self.records = []

    def emit(self, record):
        self.records.append(record)


log = logging.getLogger(ports.__name__)
logged = Logged()
log.addHandler(logged)
log.propagate = False

systems = []


def start(platform="darwin", quick=True):
    """A fresh stand-in library and the system ports.py makes from it."""
    world = fake_libremidi.install()
    sys.platform = platform
    ports.WATCH_POLL_SEC = 0.02 if quick else REAL_WATCH_SEC
    ports.RELIST_SEC = 0.1 if quick else REAL_RELIST_SEC
    system, why = ports.open_system()
    sys.platform = REAL_PLATFORM
    if system is not None:
        systems.append(system)
    return world, system, why


def finish():
    for system in systems:
        system.close()
    systems.clear()
    fake_libremidi.remove()


@contextlib.contextmanager
def windows_com(answer=0, platform="win32"):
    """
    A fresh stand-in library on a machine whose COM is a list of what was
    asked of it (in world.order), `answer` being what CoInitializeEx says.
    The platform stays patched for the whole block, as it would be for real.
    """
    world = fake_libremidi.install()

    class Ole32:
        @staticmethod
        def CoInitializeEx(reserved, mode):
            world.order.append(("com-init", mode, threading.current_thread()))
            return answer

        @staticmethod
        def CoUninitialize():
            world.order.append(("com-uninit", None, threading.current_thread()))

    had = hasattr(ctypes, "windll")
    before = getattr(ctypes, "windll", None)
    ctypes.windll = type("Windll", (), {"ole32": Ole32})()
    sys.platform = platform
    try:
        yield world
    finally:
        sys.platform = REAL_PLATFORM
        if had:
            ctypes.windll = before
        else:
            del ctypes.windll


def names_of(world):
    return [o[0] for o in world.order]


def let_go_inside(world, kind):
    """
    Whether an object of the library of that kind was let go of on a thread
    before that thread left its COM apartment. A destructor that runs after
    CoUninitialize runs outside the apartment the object was made in.
    """
    for i, o in enumerate(world.order):
        if o[0] == "destroyed" and o[1] == kind:
            leaving = [j for j, p in enumerate(world.order)
                       if p[0] == "com-uninit" and p[2] is o[2]]
            return bool(leaving) and i < leaving[0]
    return False


def threads_named(prefix):
    return [t for t in threading.enumerate() if t.name.startswith(prefix)]


def main():
    caller = threading.current_thread()

    print("\n[1] A port as the OS names it")
    ok("a name alone is kept as that", ports.PortInfo("TD-17").saved() == {"name": "TD-17"})
    ok("the other fields are kept when they say something",
       ports.PortInfo("TD-17", "TD-17", "Roland", "9").saved()
       == {"name": "TD-17", "device": "TD-17", "maker": "Roland", "id": "9"})
    ok("two ports with the same fields are the same port, and can be put in a set",
       len({ports.PortInfo("a", id="1"), ports.PortInfo("a", id="1")}) == 1)
    ok("a different id is a different port",
       ports.PortInfo("a", id="1") != ports.PortInfo("a", id="2"))

    print("\n[2] The library is only ever used on threads of ports.py's own")
    # On Windows the thread that loaded PortAudio is in a single-threaded COM
    # apartment, and the library, when it is first imported, tries to join a
    # multithreaded one: that is not an error the library survives, it ended
    # the self-test's process. So the caller's thread never imports it, never
    # makes an observer, never makes an input.
    world, system, why = start()
    ok("the system starts", system is not None and why is None)
    ok("the library was imported once", len(world.imported_on) == 1)
    ok("and not on the caller's thread", world.imported_on[0] is not caller)
    world.add_port("TD-17", 1234)
    rx = system.open(system.inputs()[0], lambda ns, d: None)
    made = dict(world.made_on)
    ok("a port is opened", rx.connected())
    ok("the observer was made on another thread", made.get("Observer") is not caller)
    ok("the input was made on another thread", made.get("MidiIn") is not caller)
    ok("which is not the observer's", made.get("MidiIn") is not made.get("Observer"))
    ok("neither callback that aborts the process on an error was set",
       world.error_callbacks_set is False)
    ok("and no timestamp mode was asked for (the library refuses any)", rx.connected())
    finish()

    print("\n[3] On Windows each of those threads joins a multithreaded COM apartment first")
    with windows_com() as world:
        system, why = ports.open_system()
        systems.append(system)
        world.add_port("TD-17", 1)
        rx = system.open(system.inputs()[0], lambda ns, d: None)
        names = names_of(world)
        ok("the observer's thread joins one, then imports, then makes the observer",
           names[:3] == ["com-init", "import", "observer"])
        ok("a multithreaded one (mode 0)", names[:1] == ["com-init"] and world.order[0][1] == 0)
        ok("the input's thread joins one, then makes the input",
           names[3:5] == ["com-init", "minput"])
        ok("its own, not the observer's",
           len(world.order) > 3 and names[0] == names[3] == "com-init"
           and world.order[3][2] is not world.order[0][2])
        system.close()
        ok("both leave when their threads end",
           wait_for(lambda: names_of(world).count("com-uninit") == 2))
        ok("each on the thread that joined",
           {o[2] for o in world.order if o[0] == "com-init"}
           == {o[2] for o in world.order if o[0] == "com-uninit"})
        wait_for(lambda: world.alive() == [])
        ok("the observer is let go of before its thread leaves the apartment",
           let_go_inside(world, "Observer"))
        ok("and the input before its thread leaves", let_go_inside(world, "MidiIn"))
        systems.clear()
        fake_libremidi.remove()
    with windows_com(answer=-2147417850) as world:
        system, why = ports.open_system()
        systems.append(system)
        ok("a thread that could not join carries on", system is not None and why is None)
        system.close()
        ok("and it ends", wait_for(lambda: not threads_named("midi")))
        ok("leaving nothing it never joined", "com-uninit" not in names_of(world))
        systems.clear()
        fake_libremidi.remove()
    with windows_com(platform="darwin") as world:
        system, why = ports.open_system()
        systems.append(system)
        ok("elsewhere COM is not touched", system is not None
           and not [n for n in names_of(world) if n.startswith("com")])
        finish()

    print("\n[4] Which MIDI system a machine gets")
    # And that the app's log says which, once. The crash log is the only log a
    # windowed build has and it keeps ERROR only (app.py), so that is the level.
    def said():
        # What the log says of the MIDI system since the last call. On a
        # pretend Windows it says too that COM could not be joined, which is
        # not about that.
        lines = [(r.getMessage(), r.levelno) for r in logged.records
                 if r.getMessage().startswith("MIDI")]
        logged.records.clear()
        return lines

    logged.records.clear()
    world, system, why = start("darwin")
    ok("a Mac gets CoreMIDI", system is not None and system.name == "CoreMIDI")
    ok("and the log says so in one line, at a level the crash log keeps",
       said() == [("MIDI: CoreMIDI", logging.ERROR)])
    finish()
    world, system, why = start("win32")
    ok("Windows gets MIDI Services where it can be had",
       system is not None and system.name == "Windows MIDI Services")
    ok("and the log names it", said() == [("MIDI: Windows MIDI Services", logging.ERROR)])
    finish()
    world = fake_libremidi.install()
    world.observer_raises.add("WINDOWS_MIDI_SERVICES")
    sys.platform = "win32"
    system, why = ports.open_system()
    sys.platform = REAL_PLATFORM
    systems.append(system)
    ok("and the classic one where its observer will not start",
       system is not None and system.name == "Windows MIDI")
    ok("the log names that one, and says nothing of the one that would not start",
       said() == [("MIDI: Windows MIDI", logging.ERROR)])
    finish()
    world = fake_libremidi.install()
    world.present_apis.discard("WINDOWS_MIDI_SERVICES")
    sys.platform = "win32"
    system, why = ports.open_system()
    sys.platform = REAL_PLATFORM
    systems.append(system)
    ok("and the classic one where the library quietly gives a dummy for it",
       system is not None and system.name == "Windows MIDI")
    ok("and the log names it, once", said() == [("MIDI: Windows MIDI", logging.ERROR)])
    finish()
    world = fake_libremidi.install()
    world.present_apis.clear()
    sys.platform = "win32"
    system, why = ports.open_system()
    sys.platform = REAL_PLATFORM
    ok("neither: no system, and why", system is None and why is not None)
    ok("the reason starts the same way every time", why.startswith("MIDI is not available: "))
    ok("and names both", "Windows MIDI Services" in why and "Windows MIDI is" in why)
    ok("the log has the reason, in one line", said() == [(why, logging.ERROR)])
    finish()
    world, system, why = start("linux")
    ok("another system gets what the library picks",
       system is not None and system.name != "")
    ok("and the log names it", said() == [(f"MIDI: {system.name}", logging.ERROR)])
    finish()
    world = fake_libremidi.install()
    world.present_apis.clear()
    sys.platform = "linux"
    system, why = ports.open_system()
    sys.platform = REAL_PLATFORM
    ok("another system with no MIDI API: none, and why", system is None and why is not None)
    ok("and the log has the reason", said() == [(why, logging.ERROR)])
    finish()
    sys.modules["pylibremidi"] = None
    system, why = ports.open_system()
    ok("without the library: none, never an exception", system is None)
    ok("and the reason says so", why.startswith("MIDI is not available: "))
    ok("and the log has that reason too", said() == [(why, logging.ERROR)])
    sys.modules.pop("pylibremidi", None)

    print("\n[5] The ports, as the app keeps them")
    world, system, why = start("darwin")
    world.add_port("TD-17", 1234, "TD-17", "Roland")
    ok("a CoreMIDI port keeps its name, device, maker and the OS's number",
       system.inputs() == [ports.PortInfo("TD-17", "TD-17", "Roland", "1234")]
       or wait_for(lambda: system.inputs()
                   == [ports.PortInfo("TD-17", "TD-17", "Roland", "1234")]))
    ok("virtual ports are listed too", world.observers[0].conf.track_virtual is True)
    ok("the ports there already are not announced as new",
       world.observers[0].conf.notify_in_constructor is False)
    world.ports[0].port_name = ""
    world.ports[0].display_name = "Display name"
    ok("a port with no name of its own has its display name",
       wait_for(lambda: [p.name for p in system.inputs()] == ["Display name"]))
    finish()
    world, system, why = start("linux")
    world.add_port("TD-17", 1234, "TD-17", "Roland")
    ok("elsewhere the number is not kept, as it is not the port's own",
       wait_for(lambda: system.inputs() == [ports.PortInfo("TD-17", "TD-17", "Roland", "")]))
    finish()

    print("\n[6] Events arrive in order, on Python's clock")
    world, system, why = start("darwin")
    world.add_port("TD-17", 1234)
    wait_for(lambda: system.inputs())
    got = []
    rx = system.open(system.inputs()[0], lambda ns, d: got.append((ns, d)))
    conf = world.inputs[-1].conf
    ok("the open port says it is connected", rx.connected())
    ok("SysEx and active sensing are kept", conf.ignore_sysex is False
       and conf.ignore_sensing is False)
    ok("the clock that only keeps time is not", conf.ignore_timing is True)
    before = time.perf_counter_ns()
    world.send("TD-17", [0x90, 38, 100])
    world.send("TD-17", [0x80, 38, 0])
    ok("both arrive", wait_for(lambda: len(got) == 2))
    ok("with their bytes, in the order sent",
       [d for _, d in got] == [bytes([0x90, 38, 100]), bytes([0x80, 38, 0])])
    ok("each time is Python's, within 5 ms of the send",
       all(abs(ns - before) < 5_000_000 for ns, _ in got))
    world.send("TD-17", [0x90, 39, 100], ago_ns=20_000_000)
    ok("an event the OS stamped 20 ms ago is 20 ms ago",
       wait_for(lambda: len(got) == 3)
       and 15_000_000 < time.perf_counter_ns() - got[2][0] < 60_000_000)
    world.inputs[-1].origin -= 40_000_000
    before = time.perf_counter_ns()
    world.send("TD-17", [0xB0, 4, 90])
    wait_for(lambda: len(got) == 4)
    ok("a clock that has moved away from Python's puts events off", abs(got[3][0] - before)
       > 30_000_000)
    rx.resync()
    before = time.perf_counter_ns()
    world.send("TD-17", [0xB0, 4, 91])
    wait_for(lambda: len(got) == 5)
    ok("and resync() puts them right again", abs(got[4][0] - before) < 5_000_000)
    finish()

    print("\n[7] A callback that raises does not end the port")
    world, system, why = start("darwin")
    world.add_port("TD-17", 1234)
    wait_for(lambda: system.inputs())
    heard = []

    def first_one_breaks(ns, data):
        heard.append(data)
        if len(heard) == 1:
            raise ValueError("a bug in the listener")

    logged.records.clear()
    rx = system.open(system.inputs()[0], first_one_breaks)
    world.send("TD-17", [0x90, 1, 1])
    world.send("TD-17", [0x90, 2, 2])
    ok("the next event still arrives", wait_for(lambda: len(heard) == 2))
    ok("the port is still connected", rx.connected())
    ok("the failure was written to the log", any(
        r.exc_info and isinstance(r.exc_info[1], ValueError) for r in logged.records))
    finish()

    print("\n[8] A port that cannot be opened")
    world, system, why = start("darwin")
    world.add_port("TD-17", 1234)
    world.add_port("Other", 5)
    wait_for(lambda: len(system.inputs()) == 2)
    td17 = [p for p in system.inputs() if p.name == "TD-17"][0]
    world.refuse.add("TD-17")
    try:
        system.open(td17, lambda ns, d: None)
        ok("a port another app holds raises PortBusy", False)
    except ports.PortBusy as e:
        ok("a port another app holds raises PortBusy, with the OS's words", "busy" in str(e))
    world.refuse.clear()
    world.dummy_in.add("COREMIDI")
    try:
        system.open(td17, lambda ns, d: None)
        ok("a dummy input, which opens and never delivers, raises PortBusy", False)
    except ports.PortBusy:
        ok("a dummy input, which opens and never delivers, raises PortBusy", True)
    world.dummy_in.clear()
    try:
        system.open(ports.PortInfo("Gone"), lambda ns, d: None)
        ok("a port that is not listed raises PortBusy", False)
    except ports.PortBusy as e:
        ok("a port that is not listed raises PortBusy", "Gone" in str(e))
    ok("none of them left a thread behind", wait_for(
        lambda: not threads_named("midi-in")))
    good = system.open(td17, lambda ns, d: None)
    ok("and the port opens when nothing is wrong", good.connected())
    finish()

    print("\n[9] A port is connected while the OS lists it")
    world, system, why = start("darwin")
    world.add_port("TD-17", 1234)
    wait_for(lambda: system.inputs())
    rx = system.open(system.inputs()[0], lambda ns, d: None)
    world.silent = True
    world.remove_port("TD-17")
    ok("pulled: not connected, though the library still says it is open",
       wait_for(lambda: rx.connected() is False))
    ok("and the list drops it", wait_for(lambda: system.inputs() == []))
    world.add_port("TD-17", 1234)
    ok("plugged back: listed again", wait_for(lambda: len(system.inputs()) == 1))
    ok("the port opened before stays not connected", rx.connected() is False)
    again = system.open(system.inputs()[0], lambda ns, d: None)
    ok("and a new one to it is connected", again.connected())
    finish()

    print("\n[10] on_change fires whether or not the library's observer says anything")
    for platform in ("darwin", "win32"):
        for silent in (True, False):
            world, system, why = start(platform)
            world.silent = silent
            told = []
            system.watch(lambda: told.append(1))
            who = f"{'a Mac' if platform == 'darwin' else 'Windows'}, " \
                  f"{'a silent observer' if silent else 'a talking one'}"
            time.sleep(0.15)
            ok(f"{who}: nothing changed, nothing said", told == [])
            world.add_port("TD-17", 1234)
            ok(f"{who}: a port plugged in is told", wait_for(lambda: len(told) >= 1))
            count = len(told)
            world.remove_port("TD-17")
            ok(f"{who}: a port pulled is told", wait_for(lambda: len(told) > count))
            ok(f"{who}: the library's own notices are counted",
               (system.observer_notices == 0) == silent)
            finish()
    # The library's notice, with the listing too far off to find the change.
    world, system, why = start("win32")
    told = []
    system.watch(lambda: told.append(1))
    time.sleep(0.25)
    ports.RELIST_SEC = 30
    time.sleep(0.15)
    world.add_port("TD-17", 1234)
    ok("on Windows, a notice from the library is told before the listing is due",
       wait_for(lambda: told, 1.0) and system.observer_notices == 1)
    finish()
    world, system, why = start("darwin")
    asked = []

    def asks_for_the_ports():
        began = time.perf_counter()
        asked.append((system.inputs(), time.perf_counter() - began))

    system.watch(asks_for_the_ports)
    world.add_port("TD-17", 1234)
    ok("a watcher may ask for the ports, and is not kept waiting for itself",
       wait_for(lambda: asked) and len(asked[0][0]) == 1 and asked[0][1] < 0.5)
    finish()
    world, system, why = start("darwin")
    told = []

    def breaks():
        raise ValueError("a bug in the watcher")

    system.watch(breaks)
    system.watch(lambda: told.append(1))
    world.add_port("TD-17", 1234)
    ok("a watcher that raises does not stop the next", wait_for(lambda: told))
    world.add_port("Other", 2)
    ok("or the ones after", wait_for(lambda: len(told) >= 2))
    finish()
    # The real intervals: what R8 asks, a hard 2 s on any system.
    world, system, why = start("win32", quick=False)
    world.silent = True
    told = []
    system.watch(lambda: told.append(1))
    began = time.perf_counter()
    world.add_port("TD-17", 1234)
    ok("on Windows, with the real intervals and a silent library, within 2 s",
       wait_for(lambda: told, 2.0))
    print(f"    after {time.perf_counter() - began:.2f} s")
    finish()
    world, system, why = start("darwin", quick=False)
    world.silent = True
    told = []
    system.watch(lambda: told.append(1))
    began = time.perf_counter()
    world.add_port("TD-17", 1234)
    ok("on a Mac, with the real intervals and a silent library, within 2 s",
       wait_for(lambda: told, 2.0))
    print(f"    after {time.perf_counter() - began:.2f} s")
    finish()

    print("\n[11] Windows MIDI Services gives no time to measure from")
    ok("a port whose times are the library's polls less often than one stamped when read",
       ports.INPUT_POLL_SEC > ports.STAMPED_POLL_SEC)
    world, system, why = start("win32")
    ok("on MIDI Services", system.name == "Windows MIDI Services")
    world.add_port("Synth", 7)
    wait_for(lambda: system.inputs())
    got = []
    rx = system.open(system.inputs()[0], lambda ns, d: got.append((ns, d)))
    before = time.perf_counter_ns()
    world.send("Synth", [0x90, 60, 100])
    ok("an event arrives", wait_for(lambda: got))
    ok("stamped on Python's clock when it was read, though the library's is 0",
       abs(got[0][0] - before) < 50_000_000)
    finish()
    # A wait on a lock with a timeout is rounded up to the system's timer tick
    # on Windows (15.6 ms); time.sleep is not, since Python 3.11. So a port
    # that is stamped when read, which has to look every 2 ms, sleeps.
    sleeps = []
    real_sleep = time.sleep

    def spy(seconds):
        sleeps.append((threading.current_thread().name, seconds))
        real_sleep(seconds)

    time.sleep = spy
    try:
        for platform, name in (("win32", "Synth"), ("darwin", "TD-17")):
            world, system, why = start(platform)
            world.add_port(name, 7)
            got = []
            system.open(system.inputs()[0], lambda ns, d: got.append(d))
            world.send(name, [0x90, 60, 100])
            wait_for(lambda: got)
            finish()
    finally:
        time.sleep = real_sleep
    port_sleeps = [sec for who, sec in sleeps if who.startswith("midi-in")]
    ok("a port stamped when read sleeps between polls for STAMPED_POLL_SEC",
       ports.STAMPED_POLL_SEC in port_sleeps)
    ok("one with the library's times sleeps for INPUT_POLL_SEC",
       ports.INPUT_POLL_SEC in port_sleeps)

    print("\n[12] Closing")
    world, system, why = start("darwin")
    world.add_port("TD-17", 1234)
    wait_for(lambda: system.inputs())
    got = []
    rx = system.open(system.inputs()[0], lambda ns, d: got.append(d))
    world.send("TD-17", [0x90, 9, 9])
    rx.close()
    ok("an event that came in before the port closed is not lost", got == [bytes([0x90, 9, 9])])
    ok("a closed port is not connected", rx.connected() is False)
    rx.close()
    ok("closing twice is fine", True)
    ok("a closed port leaves none of the library's objects", wait_for(
        lambda: "MidiIn" not in world.alive() and "InputConfiguration" not in world.alive()))
    try:
        rx.resync()
        ok("and measuring the clock of a closed port is harmless", True)
    except Exception:
        ok("and measuring the clock of a closed port is harmless", False)
    ok("its thread is gone", wait_for(
        lambda: not threads_named("midi-in")))
    rx2 = system.open(system.inputs()[0], lambda ns, d: None)
    system.close()
    ok("closing the system closes its ports", rx2.connected() is False)
    ok("and stops its threads", wait_for(
        lambda: not threads_named("midi")))
    ok("and none of the library's objects is left", wait_for(lambda: world.alive() == []))
    try:
        system.open(ports.PortInfo("TD-17"), lambda ns, d: None)
        ok("a closed system opens nothing", False)
    except ports.PortBusy:
        ok("a closed system opens nothing", True)
    ok("and lists nothing", system.inputs() == [])
    system.close()
    ok("closing twice is fine", True)
    finish()

    world, system, why = start("darwin")
    world.add_port("TD-17", 1234)
    wait_for(lambda: system.inputs())
    info = system.inputs()[0]
    asked = []

    def closes_itself(ns, data):
        asked.append(data)
        asked_port[0].close()

    asked_port = [None]
    asked_port[0] = system.open(info, closes_itself)
    world.send("TD-17", [0x90, 1, 1])
    ok("a listener may close its own port", wait_for(lambda: asked and asked_port[0].connected()
                                                      is False))
    opened = []

    def keep_opening():
        while True:
            try:
                opened.append(system.open(info, lambda ns, d: None))
            except ports.PortBusy:
                return

    racer = threading.Thread(target=keep_opening)
    racer.start()
    time.sleep(0.05)
    system.close()
    racer.join(5)
    ok("opening while the system closes ends, and leaves nothing open",
       not racer.is_alive() and all(p.connected() is False for p in opened))
    ok("and no thread", wait_for(
        lambda: not threads_named("midi")))
    finish()

    print("\n[13] What fails to start leaves nothing of the library behind")
    # The library holds the callbacks it is given where Python's collector
    # cannot see them, so a configuration that something keeps alive (a failed
    # start's traceback holds the frame that made it) keeps what the callbacks
    # point at alive, and the library reports it as a leak when the process
    # ends. CI showed that on Windows, where MIDI Services is absent.
    world = fake_libremidi.install()
    world.observer_raises.add("WINDOWS_MIDI_SERVICES")
    sys.platform = "win32"
    system, why = ports.open_system()
    sys.platform = REAL_PLATFORM
    systems.append(system)
    ok("the classic system starts where MIDI Services will not",
       system is not None and system.name == "Windows MIDI")
    ok("and only its own configuration is alive, not the failed attempt's",
       wait_for(lambda: world.alive().count("ObserverConfiguration") == 1))
    finish()
    ok("and nothing after it closes", wait_for(lambda: world.alive() == []))
    world = fake_libremidi.install()
    world.present_apis.clear()
    sys.platform = "win32"
    system, why = ports.open_system()
    sys.platform = REAL_PLATFORM
    ok("neither starts", system is None)
    ok("and nothing of the library is left", wait_for(lambda: world.alive() == []))
    ok("the reason is text", isinstance(why, str))
    finish()
    for knob, what in (("conf_raises", "making its configuration"),
                       ("clock_raises", "reading its clock")):
        world, system, why = start("darwin")
        world.add_port("TD-17", 1234)
        info = system.inputs()[0]
        setattr(world, knob, True)
        began = time.perf_counter()
        try:
            system.open(info, lambda ns, d: None)
            ok(f"a port that fails {what} raises PortBusy", False)
        except ports.PortBusy as e:
            ok(f"a port that fails {what} raises PortBusy, with the library's words",
               "could not be" in str(e))
        ok(f"and at once, not after waiting for it ({what})", time.perf_counter() - began < 2)
        setattr(world, knob, False)
        ok(f"and leaves no thread ({what})", wait_for(lambda: not threads_named("midi-in")))
        ok(f"or object of the library's but the observer's ({what})", wait_for(
            lambda: set(world.alive()) <= {"Observer", "ObserverConfiguration"}))
        good = system.open(info, lambda ns, d: None)
        ok(f"and the next open works ({what})", good.connected())
        finish()

    print("\n[14] fake_midi.py behaves as ports.py does")
    fake = fake_midi.FakePortSystem([ports.PortInfo("TD-17")])
    heard_a, heard_b = [], []
    fake.open(fake.inputs()[0], lambda ns, d: heard_a.append(d))
    fake.open(fake.inputs()[0], lambda ns, d: heard_b.append(d))
    ok("an event goes to every port open on that name",
       fake.send("TD-17", 1, b"x") is True and heard_a == [b"x"] and heard_b == [b"x"])
    ok("and False where none listens", fake.send("Other", 1, b"x") is False)
    told = []
    fake.watch(lambda: told.append(1))
    fake.plug(ports.PortInfo("Other"))
    ok("a plugged port is told to the watchers", told == [1])
    fake.close()
    ok("a closed system lists nothing", fake.inputs() == [])
    try:
        fake.open(ports.PortInfo("TD-17"), lambda ns, d: None)
        ok("and opens nothing", False)
    except ports.PortBusy:
        ok("and opens nothing", True)
    fake.plug(ports.PortInfo("Third"))
    ok("and tells no one", told == [1])
    ok("every port it opened is closed", not fake.open_ports)
    for real, stand_in, names in (
            (ports.PortSystem, fake_midi.FakePortSystem, ("inputs", "watch", "open", "close")),
            (ports.OpenPort, fake_midi.FakeOpenPort, ("connected", "resync", "close"))):
        for name in names:
            ok(f"{real.__name__}.{name} takes the parameters the stand-in's does",
               list(inspect.signature(getattr(real, name)).parameters)
               == list(inspect.signature(getattr(stand_in, name)).parameters))
    ok("it has the attribute the live check prints", fake.observer_notices == 0)

    print("\n" + "=" * 60)
    sys.platform = REAL_PLATFORM
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("MIDI ports: every check passes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
