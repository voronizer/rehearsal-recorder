"""
The real MIDI library on this machine, not a stand-in:

    python tests/midi_live.py

Not one of the suites and not in run_all.py: the suites block the library on
purpose so they never touch a port, and this is the one script that does. CI
runs it on its own, on the two systems the app is built for, because what it
asks can only be answered by the system itself:

    macOS    watch() is told when a port appears and goes (a hard check, as
             on_change does not wait for the library's own observer), the
             OS's time on an event is the same clock Python reads, and an open
             port knows it has been pulled. A virtual port stands in for the
             instrument: this script makes one, plays 100 notes into it, and
             closes it again; then a second system opened after the first
             was closed is shown the same. Whether the library's own
             observer called back is printed beside each step, as
             information and not as a check.
    Windows  there are no virtual ports without a driver of someone else's,
             so the check is smaller: which MIDI system answered, which the
             library knows, and the ports there are. Playing a note is for
             a real device and a person (the hand list at the end of the
             plan).
    other    nothing: the app is not built for them.

Everything it prints is also what the notes in midi/ports.py are copied from.
Output is Latin letters only in the labels: Windows CI prints in cp1252. The
library is imported by ports.py's own thread first (open_system()), and only
then here, so what this script does cannot hide what the app would meet.
"""

import gc
import sys
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the script runs from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))

from rehearsal_recorder.midi import ports  # noqa: E402

# A port name that cannot be anyone's real device.
PROBE = "Reha probe"
NOTES = 100
GAP_SEC = 0.010
# How far from the time Python read just before sending an event's time may be.
TOLERANCE_NS = 5_000_000
PATIENCE_SEC = 2.0

problems = []
step = ["0"]


def section(number, title):
    step[0] = str(number)
    print(f"\n[{number}] {title}")


def ok(label, cond):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(f"[{step[0]}] {label}")


def wait_for(condition, seconds=PATIENCE_SEC):
    """True as soon as the condition holds, False if it never does."""
    end = time.perf_counter() + seconds
    while time.perf_counter() < end:
        if condition():
            return True
        time.sleep(0.01)
    return condition()


def show(info):
    """Every field of a port, as the app keeps it."""
    print(f"    name={info.name!r} device={info.device!r} "
          f"maker={info.maker!r} id={info.id!r}")


def show_raw(lm, api):
    """
    What the library itself says about each input, before ports.py picks from
    it. This is where to look if a field the app keeps comes out empty.
    """
    conf = lm.ObserverConfiguration()
    conf.track_hardware = True
    conf.track_virtual = True
    conf.notify_in_constructor = False
    observer = lm.Observer(conf, api)
    for p in observer.get_input_ports():
        print(f"    client={p.client} port={p.port} "
              f"manufacturer={p.manufacturer!r} device_name={p.device_name!r} "
              f"port_name={p.port_name!r} display_name={p.display_name!r}")
    del observer


def try_observers(lm, apis):
    """
    Start an observer on each API on its own, as ports.py does, and say what
    came of it: open_system() takes the first that starts and does not say why
    the others did not. Last of all, because on CoreMIDI the first client a
    process makes is the one whose run loop gets the notices, and this makes
    one with a callback of its own on the main thread.
    """
    for api in apis:
        conf = lm.ObserverConfiguration()
        conf.input_added = lambda port: None
        conf.notify_in_constructor = False
        print(f"    trying {api.name} ...", flush=True)
        try:
            observer = lm.Observer(conf, api)
            print(f"    {api.name}: an observer on {observer.get_current_api().name}, "
                  f"{len(observer.get_input_ports())} inputs")
            del observer
        except Exception as e:  # what the library raises is the finding
            print(f"    {api.name}: no observer: {type(e).__name__}: {e}")


def virtual_output(lm):
    """A MIDI output nobody owns: to the system it is a source of notes."""
    out = lm.MidiOut(lm.OutputConfiguration(), lm.API.COREMIDI)
    error = out.open_virtual_port(PROBE)
    if error:
        raise RuntimeError(f"could not make the virtual port: {error}")
    return out


def listed(system):
    return [p for p in system.inputs() if p.name == PROBE]


def library():
    """
    The library module. open_system() has imported it on a thread of its own
    by now, so this is only a lookup, on the main thread; None if it is not
    there to be had.
    """
    try:
        import pylibremidi as lm
    except Exception as e:  # not installed, or not for this Python
        print(f"    the library cannot be imported here: {type(e).__name__}: {e}")
        return None
    return lm


def start(label):
    """open_system(), checked; the system or None."""
    system, why = ports.open_system()
    ok(label, system is not None)
    if why:
        print(f"    reason given: {why}")
    return system


def notices(system):
    print(f"    notices from the library's own observer so far: "
          f"{system.observer_notices} (information, not a check)")


def make_and_lose(lm, system, label):
    """
    The probe port appears and goes while `system` is watching: on_change is
    told of both within PATIENCE_SEC, hard, and inputs() follows.
    """
    told = []
    system.watch(lambda: told.append(time.perf_counter_ns()))
    out = virtual_output(lm)
    ok(f"{label}: on_change fires within 2 s of the port appearing",
       wait_for(lambda: len(told) > 0))
    ok(f"{label}: inputs() lists the probe", wait_for(lambda: listed(system)))
    notices(system)
    before = len(told)
    out.close_port()
    gc.collect()
    ok(f"{label}: on_change fires within 2 s of the port going",
       wait_for(lambda: len(told) > before))
    ok(f"{label}: inputs() drops the probe", wait_for(lambda: not listed(system)))
    notices(system)


def macos():
    section(1, "CoreMIDI starts")
    system = start("a MIDI system answers")
    if system is None:
        return
    lm = library()
    if lm is None:
        system.close()
        return
    print(f"    libremidi {lm.get_version()}, available_apis(): {lm.available_apis()}")
    ok("it is CoreMIDI", system.name == "CoreMIDI")
    print(f"    {len(system.inputs())} inputs before the probe:")
    for info in system.inputs():
        show(info)
    print("    as the library lists them:")
    show_raw(lm, system.api)

    section(2, "A port made after watch() is told of and listed")
    told = []
    system.watch(lambda: told.append(time.perf_counter_ns()))
    out = virtual_output(lm)
    ok("on_change fires within 2 s", wait_for(lambda: len(told) > 0))
    ok("inputs() lists the probe", wait_for(lambda: listed(system)))
    notices(system)
    probe = listed(system)[0] if listed(system) else None
    if probe is None:
        out.close_port()
        system.close()
        return
    print("    the probe, as the app keeps it:")
    show(probe)
    print("    as the library lists it:")
    show_raw(lm, system.api)

    section(3, "100 notes arrive in order, on Python's clock")
    got = []
    rx = system.open(probe, lambda ns, data: got.append((ns, data)))
    ok("the open port says connected", rx.connected())
    sent = []
    for n in range(NOTES):
        sent.append(time.perf_counter_ns())
        out.send_message([0x90, n, 100])
        time.sleep(GAP_SEC)
    wait_for(lambda: len(got) >= NOTES)
    ok(f"all {NOTES} arrive", len(got) == NOTES)
    ok("each is a note-on, in the order sent",
       [data for _, data in got] == [bytes([0x90, n, 100]) for n in range(NOTES)])
    if len(got) == NOTES:
        late = [ns - before for (ns, _), before in zip(got, sent)]
        worst = max(abs(x) for x in late)
        print(f"    time after the send, ms: smallest {min(late) / 1e6:.3f}, "
              f"largest {max(late) / 1e6:.3f}")
        ok(f"each time is within {TOLERANCE_NS // 1_000_000} ms of the send",
           worst <= TOLERANCE_NS)
    rx.resync()
    ok("still connected after resync()", rx.connected())

    section(4, "The port is closed: told, dropped, and the open port knows")
    before = len(told)
    out.close_port()
    out = None
    gc.collect()
    ok("on_change fires within 2 s", wait_for(lambda: len(told) > before))
    ok("inputs() drops the probe", wait_for(lambda: not listed(system)))
    ok("the open port says it is not connected",
       wait_for(lambda: rx.connected() is False))
    notices(system)
    rx.close()

    section(5, "The same port made again is seen again")
    before = len(told)
    out = virtual_output(lm)
    ok("on_change fires within 2 s", wait_for(lambda: len(told) > before))
    ok("inputs() lists the probe again", wait_for(lambda: listed(system)))
    again = listed(system)
    if again:
        show(again[0])
    notices(system)
    out.close_port()
    out = None
    gc.collect()

    section(6, "A second system, made after the first was closed")
    system.close()
    system = start("a second MIDI system answers")
    if system is not None:
        make_and_lose(lm, system, "the second system")
        system.close()

    section(7, "Each API's own observer, on its own (information only)")
    try_observers(lm, [lm.API.COREMIDI])


def windows():
    section(1, "Which MIDI system answers")
    system = start("a MIDI system answers")
    lm = library()
    if lm is not None:
        print(f"    libremidi {lm.get_version()}")
        print(f"    available_apis(): {lm.available_apis()}")
        print(f"    available_ump_apis(): {lm.available_ump_apis()}")
    if system is None:
        return
    print(f"    the app uses: {system.name}")

    section(2, "The ports are listed")
    infos = system.inputs()
    print(f"    {len(infos)} inputs:")
    for info in infos:
        show(info)
    if lm is not None:
        print("    as the library lists them:")
        show_raw(lm, system.api)
    ok("listing the ports does not fail", isinstance(infos, list))
    notices(system)
    system.close()

    if lm is not None:
        section(3, "Each API's own observer, on its own (information only)")
        try_observers(lm, [lm.API.WINDOWS_MIDI_SERVICES, lm.API.WINDOWS_MM])


def main():
    # A port name with accents or Cyrillic must not stop a script that is
    # only here to print it.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    if sys.platform == "darwin":
        macos()
    elif sys.platform == "win32":
        windows()
    else:
        print("no live MIDI check on this system")
        return 0

    gc.collect()
    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("Live MIDI: every check passes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
