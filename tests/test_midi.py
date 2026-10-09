"""
Recording notes beside the audio. So far this is what stops Start (A1, P2 and
P3), what the audio card check then holds, and which saved port is found again
(P1) and the order a device's ports are listed in (P7); later sections are added
here as the rest of it is built.

Python side, no browser, no MIDI: nothing here opens a port. The MIDI library
is blocked the way the other suites block it, and the pieces that decide what
is allowed are plain functions over plain dictionaries, so they are called
directly.
"""

import sys
import types
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))

# Stub sounddevice: there is no real card here.
_sd = types.ModuleType("sounddevice")

# Device 0 is a proper interface with room for the tracks below.
_DEVICES = [
    {"name": "Interface", "max_output_channels": 2, "max_input_channels": 8,
     "hostapi": 0, "default_samplerate": 48000},
]


def _query_devices(index=None, kind=None):
    if index is None:
        return _DEVICES
    return _DEVICES[index]  # IndexError for a stale index, like the real one


_sd.query_devices = _query_devices
_sd.query_hostapis = lambda: [{"name": "CoreAudio"}]
_sd.OutputStream = _sd.InputStream = None
sys.modules["sounddevice"] = _sd
# No suite opens a real MIDI port. With None in sys.modules, importing the
# library raises ImportError, which midi/ports.open_system() answers as "MIDI is
# not available" — whatever is plugged into the machine running them.
sys.modules["pylibremidi"] = None

from rehearsal_recorder.audio.devices import channels_available  # noqa: E402
from rehearsal_recorder.midi.identity import bare_name, find_port, in_order  # noqa: E402
from rehearsal_recorder.midi.ports import PortInfo  # noqa: E402
from rehearsal_recorder.midi.rules import notes_problem  # noqa: E402

problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else,
    # such as "★" or "▶", taking the whole suite down with it.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def main():
    print("\n[1] What stops Start")
    gtr = {"name": "Gtr", "channel": 1}
    keys = {"name": "Keys", "mode": "midi", "channel": None, "midi_port": {"name": "Launchkey Mini MK3"}}
    ok("all on MIDI is refused", notes_problem([keys]) ==
       "At least one track has to record sound, so the takes can be heard.")
    ok("a MIDI track with no port is refused", notes_problem([gtr, {**keys, "midi_port": None}]) ==
       "Keys has no MIDI port yet. Pick one, or set it to Audio.")
    ok("and two", notes_problem([gtr, {**keys, "midi_port": None},
                                 {**keys, "name": "Synth", "midi_port": None}]) ==
       "Keys, Synth have no MIDI port yet. Pick one, or set them to Audio.")
    drums = {"name": "Drums", "mode": "both", "channel": 2, "midi_port": {"name": "TD-17"}}
    ok("two tracks on one port are refused",
       notes_problem([gtr, drums, {**keys, "midi_port": {"name": "TD-17"}}]) ==
       "Drums and Keys both take notes from TD-17.")
    ok("a port picked but not plugged in stops nothing", notes_problem([gtr, drums, keys]) is None)
    ok("an old band is fine", notes_problem([gtr, {"name": "Bass", "channel": 2}]) is None)
    ok("the card check passes a MIDI track with no input",
       channels_available(0, [gtr, keys]) is None)
    ok("and says A1 before anything about inputs", channels_available(0, [keys]).startswith("At least one"))

    # The order they are asked in, the edges of each, and what a track that
    # does not take notes is never charged with.
    no_port = {**keys, "midi_port": None}
    ok("A1 is said before P3: all on MIDI and none with a port is the first",
       notes_problem([no_port]) == "At least one track has to record sound, so the takes can be heard.")
    ok("P3 is said before P2: a missing port is named while two others share one",
       notes_problem([gtr, no_port,
                      {**drums, "name": "Pad"}, drums]) ==
       "Keys has no MIDI port yet. Pick one, or set it to Audio.")
    ok("a Both track with no port is refused like a MIDI one",
       notes_problem([gtr, {**drums, "midi_port": None}]) ==
       "Drums has no MIDI port yet. Pick one, or set it to Audio.")
    ok("a port with no name finds nothing, so it is no port",
       notes_problem([gtr, {**keys, "midi_port": {"name": "  "}}]) ==
       "Keys has no MIDI port yet. Pick one, or set it to Audio.")
    ok("the tracks with no port are named in band order",
       notes_problem([gtr, {**no_port, "name": "Zed"}, {**no_port, "name": "Ann"}]) ==
       "Zed, Ann have no MIDI port yet. Pick one, or set them to Audio.")
    ok("a Both track alone satisfies A1",
       notes_problem([drums]) is None)
    stray = {"name": "TD-17"}
    ok("an Audio track carrying a stray port equal to another track's is not counted for P2",
       notes_problem([{**gtr, "midi_port": stray}, drums]) is None
       and notes_problem([drums, {**gtr, "midi_port": stray}]) is None
       and notes_problem([{**gtr, "mode": "audio", "midi_port": stray}, drums]) is None)
    ok("and an Audio track with a blank or no port is not one that is missing a port",
       notes_problem([{**gtr, "midi_port": None}, drums]) is None
       and notes_problem([{**gtr, "mode": "audio", "midi_port": {"name": " "}}, drums]) is None)
    ok("three on one port name the first two met, in band order",
       notes_problem([gtr, {**keys, "name": "Pad", "midi_port": {"name": "TD-17"}}, drums,
                      {**keys, "midi_port": {"name": "TD-17"}}]) ==
       "Pad and Drums both take notes from TD-17.")
    # R13: the first collision met walking the band is the one named, not the
    # first track that has a partner. A and D share p1, B and C share p2; C
    # is where the walk first meets a port already taken.
    ok("the first collision met walking the band is the one named",
       notes_problem([{**drums, "name": name, "midi_port": {"name": port}}
                      for name, port in (("A", "p1"), ("B", "p2"), ("C", "p2"), ("D", "p1"))]) ==
       "B and C both take notes from p2.")
    ok("a port is the same port when its name is the same, whatever else is known of it",
       notes_problem([gtr, {**drums, "midi_port": {"name": "TD-17", "id": "a"}},
                      {**keys, "midi_port": {"name": "TD-17", "id": "b"}}]) ==
       "Drums and Keys both take notes from TD-17.")
    ok("a different name is a different port",
       notes_problem([gtr, {**drums, "midi_port": {"name": "TD-17"}},
                      {**keys, "midi_port": {"name": "TD-17 MIDI 2"}}]) is None)
    ok("a port saved as a bare name counts as that port",
       notes_problem([gtr, {**drums, "midi_port": "TD-17"},
                      {**keys, "midi_port": {"name": "TD-17"}}]) ==
       "Drums and Keys both take notes from TD-17.")
    ok("no tracks is not this check's to refuse", notes_problem([]) is None)
    band = [gtr, dict(no_port)]
    notes_problem(band)
    ok("the tracks given are left as they were", band == [gtr, no_port])

    # Asked first, before the card is looked at at all.
    ok("the card check asks before it looks for a device",
       channels_available(None, [keys]).startswith("At least one")
       and channels_available(None, [gtr, no_port]) ==
       "Keys has no MIDI port yet. Pick one, or set it to Audio.")
    ok("on a device nobody can describe the notes are still asked",
       channels_available(99, [keys]).startswith("At least one"))
    ok("the card check says nothing for no device and a band that is fine",
       channels_available(None, [gtr, keys]) is None)
    ok("the card check says nothing for no tracks", channels_available(0, []) is None)
    ok("two tracks on one port stop the card check too",
       channels_available(0, [gtr, drums, {**keys, "midi_port": {"name": "TD-17"}}]) ==
       "Drums and Keys both take notes from TD-17.")

    # What is left of the card check is about the tracks that record audio.
    # A MIDI track has no input, and says so only in the notes check.
    ok("the card check never names a MIDI track as having no input",
       channels_available(0, [{"name": "Bass", "channel": None}, keys]) ==
       "Bass has no input yet. “Interface” has 8 inputs — give them one, or take them out of this rehearsal.")
    ok("a MIDI track's stray input number is not counted against the card",
       channels_available(0, [gtr, {**keys, "channel": 1}]) is None
       and channels_available(0, [gtr, {**keys, "channel": 99}]) is None)
    ok("a Both track still uses its input",
       channels_available(0, [{**drums, "channel": 1}, gtr]) ==
       "“Drums” and “Gtr” are both on input 1. Two tracks cannot share one — a stereo track "
       "takes the input after its own as well.")
    ok("a Both track with no input is the one named",
       channels_available(0, [gtr, {**drums, "channel": None}]) ==
       "Drums has no input yet. “Interface” has 8 inputs — give them one, or take them out of this rehearsal.")
    ok("the tracks that record audio are checked for fit",
       channels_available(0, [{"name": "Far", "channel": 12}, keys]) ==
       "“Interface” has 8 inputs, but the tracks go up to 12. They were set up for another "
       "interface — give them inputs this one has.")
    ok("MIDI tracks do not count toward more tracks than inputs",
       channels_available(0, [{"name": f"T{n}", "channel": n + 1} for n in range(7)] +
                          [{"name": "Far", "channel": 9}] +
                          [{**keys, "name": f"K{n}", "midi_port": {"name": f"Port {n}"}} for n in range(5)]) ==
       "“Interface” has 8 inputs, but the tracks go up to 9. They were set up for another "
       "interface — give them inputs this one has.")

    # A saved port is found by its id, then its name, then its name without
    # what Windows adds to it, and two alike are never picked between. Then
    # the order a device's ports are listed in: its playing port first.
    print("\n[2] A saved port found again")
    P = PortInfo
    here = [P("TD-17", "TD-17", "Roland", "1001"), P("Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3", "Novation")]
    ok("found by its id first", find_port({"name": "renamed", "id": "1001"}, here)[0] is here[0])
    ok("then by its name", find_port({"name": "TD-17"}, here)[0] is here[0])
    ok("then by its name as Windows renumbers it", find_port({"name": "TD-17 1"}, [P("TD-17 2")])[0].name == "TD-17 2")
    ok("and with a second device's 2- in front", find_port({"name": "2- TD-17"}, [P("TD-17")])[0].name == "TD-17")
    ok("two alike are not guessed between", find_port({"name": "TD-17"}, [P("TD-17"), P("TD-17")]) == (None, True))
    ok("nor two alike once the numbers are taken off",
       find_port({"name": "TD-17"}, [P("TD-17 1"), P("2- TD-17 2")]) == (None, True))
    ok("one not there is just missing", find_port({"name": "TD-17"}, []) == (None, False))
    ok("bare_name takes off both", bare_name("2- TD-17 1") == "TD-17")
    lk = [P("Launchkey Mini MK3 DAW Port", "Launchkey Mini MK3"), P("TD-17", "TD-17"),
          P("Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3")]
    ok("a keyboard's playing port comes before its DAW port",
       [p.name for p in in_order(lk)] ==
       ["Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3 DAW Port", "TD-17"])
    ok("and Windows' MIDIIN2 after the first",
       [p.name for p in in_order([P("MIDIIN2 (Launchkey Mini MK3)", "Launchkey Mini MK3"),
                                  P("Launchkey Mini MK3", "Launchkey Mini MK3")])][0] == "Launchkey Mini MK3")
    # Beyond the brief's own checks: the edges of each rule.
    ok("a port with no device is a group of its own, not lumped with the others",
       [p.name for p in in_order([P("A"), P("B", "X"), P("C"), P("D", "X")])] == ["A", "B", "D", "C"])
    ok("each control word moves a port after the others, in any case",
       all([p.name for p in in_order([P(f"Keys {word}", "Keys"), P("Keys", "Keys")])] == ["Keys", f"Keys {word}"]
           for word in ("DAW", "daw", "MIDIIN2", "InControl", "CONTROL", "ctrl")))
    ok("an id only counts where the port has one too",
       find_port({"name": "renamed", "id": "1001"}, [P("TD-17")]) == (None, False))
    ok("two ports alike by id are not guessed between",
       find_port({"name": "renamed", "id": "1001"}, [P("TD-17", id="1001"), P("Keys", id="1001")]) == (None, True))
    ok("a saved port with no usable name and no id finds nothing",
       find_port({"device": "TD-17"}, here) == (None, False) and find_port({"name": "  "}, here) == (None, False))

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("MIDI recording: every check passes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
