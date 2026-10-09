"""
Recording notes beside the audio. So far this is what stops Start (A1, P2 and
P3), what the audio card check then holds, which saved port is found again
(P1), the order a device's ports are listed in (P7), the .mid file (F2 and
F4): what one can hold, written and read back, and what a port has set and
holds (F6 and F7); later sections are added here as the rest of it is built.

Python side, no browser, no MIDI: nothing here opens a port. The MIDI library
is blocked the way the other suites block it, and the pieces that decide what
is allowed are plain functions over plain dictionaries, so they are called
directly.
"""

import logging
import sys
import tempfile
import threading
import time
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

import mido  # noqa: E402  (to read the files back; src imports it only in midi/smf.py)

from rehearsal_recorder.audio.devices import channels_available  # noqa: E402
from rehearsal_recorder.midi import smf  # noqa: E402
from rehearsal_recorder.midi.identity import bare_name, find_port, in_order  # noqa: E402
from rehearsal_recorder.midi.ports import PortInfo  # noqa: E402
from rehearsal_recorder.midi.rules import notes_problem  # noqa: E402
from rehearsal_recorder.midi.state import PortState  # noqa: E402
from rehearsal_recorder.midi.smf import read_events, storable, write_mid  # noqa: E402

problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else,
    # such as "★" or "▶", taking the whole suite down with it.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def read_back(path):
    """The file as mido reads it (names in UTF-8), and its messages with the
    tick each is on, counted from the start of the file."""
    mid = mido.MidiFile(path, charset="utf-8")
    timed, tick = [], 0
    for msg in mid.tracks[0]:
        tick += msg.time
        timed.append((tick, msg))
    return mid, timed


def port_state(*messages):
    """A PortState that has been fed these messages, one by one."""
    state = PortState()
    for message in messages:
        state.feed(message)
    return state


def played(timed):
    """The channel messages and SysEx among a file's messages: all but the metas."""
    return [(tick, msg) for tick, msg in timed if not msg.is_meta]


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
    for word in ("DAW", "daw", "MIDIIN2", "InControl", "CONTROL", "ctrl"):
        ok(f"the word {word} in a port's name moves it after the others",
           [p.name for p in in_order([P(f"Keys {word}", "Keys"), P("Keys", "Keys")])] == ["Keys", f"Keys {word}"])
    ok("devices are listed in the order the OS meets them, not by name",
       [p.name for p in in_order([P("Z1", "Zoom"), P("A1", "Alesis"), P("Z2", "Zoom")])] == ["Z1", "Z2", "A1"])
    ok("a control word in the device's own name does not flag its playing port",
       [p.name for p in in_order([P("Keystation Controller DAW Port", "Keystation Controller"),
                                  P("Keystation Controller MIDI Port", "Keystation Controller")])] ==
       ["Keystation Controller MIDI Port", "Keystation Controller DAW Port"])
    ok("nor Launch Control XL's, whose playing port is named for the device",
       [p.name for p in in_order([P("Launch Control XL DAW Port", "Launch Control XL"),
                                  P("Launch Control XL", "Launch Control XL")])] ==
       ["Launch Control XL", "Launch Control XL DAW Port"])
    ok("an id only counts where the port has one too",
       find_port({"name": "renamed", "id": "1001"}, [P("TD-17")]) == (None, False))
    ok("two ports alike by id are not guessed between",
       find_port({"name": "renamed", "id": "1001"}, [P("TD-17", id="1001"), P("Keys", id="1001")]) == (None, True))
    ok("a saved port with no usable name and no id finds nothing",
       find_port({"device": "TD-17"}, here) == (None, False) and find_port({"name": "  "}, here) == (None, False))
    ok("the exact name comes before the bare one: TD-17 1 among TD-17 1 and TD-17 2",
       find_port({"name": "TD-17 1"}, [P("TD-17 1"), P("TD-17 2")])[0].name == "TD-17 1")
    ok("bare_name ignores the space around a name", bare_name("  2- TD-17 1 ") == "TD-17")
    ok("a saved 2- with nothing after it matches no port", find_port({"name": "2- "}, [P("3-")]) == (None, False))
    ok("a saved KeyLab 49 is not bound to a KeyLab 61 by its bare name",
       find_port({"name": "KeyLab 49", "device": "KeyLab 49"}, [P("KeyLab 61", "KeyLab 61")]) == (None, False))
    ok("Windows' renumbered name is still found on its own device",
       find_port({"name": "TD-17 1", "device": "TD-17"}, [P("TD-17 2", "TD-17")])[0].name == "TD-17 2")

    # What a Standard MIDI File can hold (F2) and how it is written (F4): format
    # 0, 960 ticks to the beat, 120 bpm, every name in UTF-8, every event on the
    # tick its own time gives. Read back with mido, which is not this module's
    # to trust: the files are opened here the way a DAW would open them.
    print("\n[3] The .mid file")
    said = []  # what smf says to the log, so a warning is checked and not printed
    catcher = logging.Handler(level=logging.INFO)
    catcher.emit = said.append
    logging.getLogger(smf.__name__).addHandler(catcher)
    ok("960 ticks to the beat, 120 bpm, 1920 ticks a second",
       (smf.TICKS_PER_BEAT, smf.TEMPO, smf.TICKS_PER_SEC) == (960, 500_000, 1920))
    events = [(0.0, b"\x99\x24\x64"), (0.1, b"\x89\x24\x00"), (0.5, b"\xB9\x04\x5A"),
              (1.0, b"\xF0\x41\x10\x42\xF7"), (1.2, b"\xF8"), (1.3, b"\xFE"), (1.4, b"\xFF"),
              (1.5, b"\xF2\x00\x10"), (1.6, b"\xF1\x20"), (1.7, b"\xF6"), (1.8, b"\x90\x40"),
              (1.9, b"\xF0\x41\x10"), (2.0, b"\x99\x26\x50")]
    start = [b"\xB9\x04\x5A"]
    with tempfile.TemporaryDirectory() as folder:
        folder = Path(folder)
        path = folder / "take.mid"
        skipped = write_mid(path, track_name="Pałyn", port_name="TD-17", start=start, events=events)
        mid, timed = read_back(path)
        ok("it is a format 0 file with 960 ticks to the beat",
           mid.type == 0 and mid.ticks_per_beat == 960 and len(mid.tracks) == 1)
        ok("120 bpm is stated at tick 0",
           any(tick == 0 and msg.type == "set_tempo" and msg.tempo == 500_000 for tick, msg in timed))
        ok("the track is named in UTF-8", mid.tracks[0].name == "Pałyn")
        ok("the port's name is the device name",
           [msg.name for _, msg in timed if msg.type == "device_name"] == ["TD-17"])
        ok("at tick 0 come the track name, the device name and the tempo, then the start",
           [(tick, msg.type) for tick, msg in timed[:4]] ==
           [(0, "track_name"), (0, "device_name"), (0, "set_tempo"), (0, "control_change")])
        ok("the channel messages and SysEx are there in order",
           [msg.type for _, msg in played(timed)] ==
           ["control_change", "note_on", "note_off", "control_change", "sysex", "note_on"])
        ok("what the file cannot hold is skipped and counted: clock, sensing, reset, song position, "
           "time code, tune request, a cut note, a cut SysEx", skipped == 8)
        ok("the notes are on channel 9 as the device sent them",
           {msg.channel for _, msg in played(timed) if msg.type.startswith("note")} == {9})
        ok("each event is on the tick of its time: 0.1 s is 192, 2.0 s is 3840",
           [tick for tick, _ in played(timed)] == [0, 0, 192, 960, 1920, 3840])
        ok("a SysEx is kept whole", [msg.data for _, msg in played(timed) if msg.type == "sysex"] == [(0x41, 0x10, 0x42)])

        # Read back by this module: the same bytes, the same seconds.
        meta, back = read_events(path)
        ok("read_events gives the names", meta == {"track_name": "Pałyn", "device_name": "TD-17"})
        ok("read_events gives every event with the start first, the SysEx whole",
           [data for _, data in back] ==
           [b"\xB9\x04\x5A", b"\x99\x24\x64", b"\x89\x24\x00", b"\xB9\x04\x5A",
            b"\xF0\x41\x10\x42\xF7", b"\x99\x26\x50"])
        ok("and the seconds within one tick of what was written",
           all(abs(got - want) <= 1 / 1920 for (got, _), want in zip(back, [0.0, 0.0, 0.1, 0.5, 1.0, 2.0])))

        # Names that are not Latin-1: mido's own default fails the save on them.
        cyrillic = folder / "drums.mid"
        write_mid(cyrillic, track_name="Барабаны", port_name="Электронная установка", start=[], events=[])
        ok("a Cyrillic name is saved and read back",
           mido.MidiFile(cyrillic, charset="utf-8").tracks[0].name == "Барабаны"
           and read_events(cyrillic)[0] == {"track_name": "Барабаны", "device_name": "Электронная установка"})

        # A port that sent nothing still leaves a file: its name and tempo.
        empty = folder / "empty.mid"
        ok("nothing played writes a file with its name and tempo, and skips nothing",
           write_mid(empty, track_name="Keys", port_name="Launchkey", start=[], events=[]) == 0
           and [msg.type for _, msg in read_back(empty)[1]] ==
           ["track_name", "device_name", "set_tempo", "end_of_track"]
           and read_events(empty) == ({"track_name": "Keys", "device_name": "Launchkey"}, []))

        # Ticks come from the time since the start, not from the one before.
        late = folder / "late.mid"
        write_mid(late, track_name="T", port_name="P", start=[], events=[(3600.0005, b"\x99\x24\x64")])
        ok("a note at 3600.0005 s is on tick 6912001",
           [tick for tick, _ in played(read_back(late)[1])] == [6912001])
        many = folder / "many.mid"
        long_take = [(i * 0.037, b"\x99\x24\x64" if i % 2 == 0 else b"\x89\x24\x00") for i in range(100_000)]
        began = time.monotonic()
        skipped_many = write_mid(many, track_name="T", port_name="P", start=[], events=long_take)
        meta_many, back_many = read_events(many)
        took = time.monotonic() - began
        ok("100000 events 0.037 s apart are each on round(t * 1920), none off by the rounding of the ones before",
           skipped_many == 0
           and [tick for tick, _ in played(read_back(many)[1])] == [round(t * 1920) for t, _ in long_take])
        ok("and read_events gives them back within one tick, in the same order",
           len(back_many) == 100_000
           and all(abs(got - t) <= 1 / 1920 and data == sent
                   for (got, data), (t, sent) in zip(back_many, long_take)))
        ok("an app-written file reads back as exactly its tick over 1920",
           [seconds for seconds, _ in back_many] == [round(t * 1920) / 1920 for t, _ in long_take])
        ok("writing and reading 100000 events is quick (under 20 s; a quadratic one takes minutes)", took < 20)

        # Edges: what a caller can get wrong must not cost the take its file.
        odd = folder / "odd.mid"
        skipped_odd = write_mid(odd, track_name="T", port_name="P", start=[b"\xFA", b"\xB9\x04\x5A"],
                                events=[(-0.5, b"\x99\x24\x64"), (1.0, b"\x89\x24\x00"),
                                        (0.9, b"\x99\x26\x50")])
        odd_events = read_events(odd)[1]
        ok("a start message the file cannot hold is skipped and counted too", skipped_odd == 1)
        ok("a time before the start is put at the start",
           odd_events[1] == (0.0, b"\x99\x24\x64"))
        ok("an event that comes out of order is held at the one before, so the file still saves",
           [seconds for seconds, _ in odd_events] == [0.0, 0.0, 1.0, 1.0])
        ok("and no event is lost for it", [data for _, data in odd_events] ==
           [b"\xB9\x04\x5A", b"\x99\x24\x64", b"\x89\x24\x00", b"\x99\x26\x50"])

        # An event held at the one before is said, once per file, with how many.
        warnings = [r for r in said if r.levelno >= logging.WARNING]
        ok("events held at the one before are said once, with their number",
           len(warnings) == 1 and "2 event(s)" in warnings[0].getMessage())
        said.clear()
        write_mid(folder / "inorder.mid", track_name="T", port_name="P", start=[],
                  events=[(0.0, b"\x99\x24\x64"), (0.0, b"\x89\x24\x00"), (1.0, b"\x99\x26\x50")])
        ok("and a file in order says nothing", not [r for r in said if r.levelno >= logging.WARNING])

        # A delta is at most 0x0FFFFFFF ticks (about 38 hours): mido writes a longer one as
        # five bytes, which is not a Standard MIDI File. Such a time costs only its own event.
        far = folder / "far.mid"
        said.clear()
        skipped_far = write_mid(far, track_name="T", port_name="P", start=[],
                                events=[(0.0, b"\x99\x24\x64"), (1e6, b"\x89\x24\x00"),
                                        (1.0, b"\x89\x24\x00"), (2.0, b"\x99\x26\x50")])
        ok("a time too far ahead for a delta is skipped and counted",
           skipped_far == 1 and [data for _, data in read_events(far)[1]] ==
           [b"\x99\x24\x64", b"\x89\x24\x00", b"\x99\x26\x50"])
        ok("and does not drag the events after it", [seconds for seconds, _ in read_events(far)[1]] == [0.0, 1.0, 2.0])
        ok("and holds nothing back, so says nothing of order",
           not [r for r in said if r.levelno >= logging.WARNING])
        limit = 0x0FFFFFFF
        edge, over = folder / "edge.mid", folder / "over.mid"
        ok("a delta of exactly 0x0FFFFFFF ticks is kept",
           write_mid(edge, track_name="T", port_name="P", start=[], events=[(limit / 1920, b"\x99\x24\x64")]) == 0
           and [tick for tick, _ in played(read_back(edge)[1])] == [limit])
        ok("and one tick more is not",
           write_mid(over, track_name="T", port_name="P", start=[], events=[((limit + 1) / 1920, b"\x99\x24\x64")]) == 1
           and read_events(over)[1] == [])
        ok("the gap is counted from the last event written, not from one skipped",
           write_mid(folder / "gap.mid", track_name="T", port_name="P", start=[],
                     events=[(0.0, b"\x99\x24\x64"), (1e6, b"\x89\x24\x00"), (limit / 1920, b"\x89\x24\x00")]) == 1)

        # Messages that follow one another with the same status are written
        # without it (running status) and must come back exactly as sent.
        run = ([(0.0, b"\x90\x3C\x40"), (0.1, b"\x90\x3E\x40"), (0.2, b"\x90\x40\x40")]
               + [(0.3 + k * 0.01, bytes([0xB9, 0x04, 5 * k])) for k in range(20)]
               + [(0.6, b"\xC0\x05"), (0.61, b"\xC0\x06"), (0.62, b"\xC0\x07"),
                  (0.7, b"\xD0\x40"), (0.71, b"\xD0\x41"), (0.72, b"\xD0\x00"),
                  (0.8, b"\xE0\x00\x40"), (0.81, b"\xE0\x01\x40"), (0.9, b"\xA0\x40\x20"),
                  (0.91, b"\xA0\x41\x21"), (1.0, b"\xF0\x7D\x01\xF7"), (1.1, b"\xB9\x04\x7F"),
                  (1.2, b"\xB9\x04\x7E"), (1.3, b"\xC9\x00"), (1.4, b"\xC9\x01")])
        runs = folder / "runs.mid"
        ok("a run of same-status messages is written without loss",
           write_mid(runs, track_name="T", port_name="P", start=[], events=run) == 0)
        ok("three notes in a row, a stream of CC 4, program changes and pressures come back exactly",
           read_events(runs)[1] == [(round(t * 1920) / 1920, data) for t, data in run])
        ok("mido reads the same types back",
           [msg.type for _, msg in played(read_back(runs)[1])] ==
           ["note_on"] * 3 + ["control_change"] * 20 + ["program_change"] * 3 + ["aftertouch"] * 3
           + ["pitchwheel"] * 2 + ["polytouch"] * 2 + ["sysex"] + ["control_change"] * 2 + ["program_change"] * 2)

        # A file a DAW has saved again has its own ticks to the beat and its own
        # tempo, and changes of it: the seconds follow the file's tempo map.
        foreign = folder / "foreign.mid"
        daw = mido.MidiFile(type=1, ticks_per_beat=480, charset="utf-8")
        daw.tracks.append(mido.MidiTrack([mido.MetaMessage("set_tempo", tempo=500_000, time=0),
                                          mido.MetaMessage("set_tempo", tempo=1_000_000, time=960)]))
        daw.tracks.append(mido.MidiTrack([
            mido.MetaMessage("track_name", name="Клавиши"),
            mido.Message("note_on", note=60, velocity=64, time=480),    # tick 480
            mido.Message("note_off", note=60, velocity=0, time=480),    # tick 960, where the tempo halves
            mido.Message("note_on", note=62, velocity=64, time=480),    # tick 1440
            mido.Message("note_off", note=62, velocity=0, time=960)]))  # tick 2400
        daw.save(foreign)
        ok("a file with 480 ticks to the beat and a tempo change reads in the file's seconds",
           read_events(foreign) == ({"track_name": "Клавиши", "device_name": ""},
                                    [(0.5, b"\x90\x3C\x40"), (1.0, b"\x80\x3C\x00"),
                                     (2.0, b"\x90\x3E\x40"), (4.0, b"\x80\x3E\x00")]))
        bare = folder / "bare.mid"
        plain = mido.MidiFile(type=0, ticks_per_beat=96, charset="utf-8")
        plain.tracks.append(mido.MidiTrack([mido.Message("note_on", note=60, velocity=64, time=96),
                                            mido.Message("note_off", note=60, velocity=0, time=96)]))
        plain.save(bare)
        ok("a file that never states a tempo is at 120 bpm, as MIDI says",
           [seconds for seconds, _ in read_events(bare)[1]] == [0.5, 1.0])
        smpte = folder / "smpte.mid"
        timed_by_frames = mido.MidiFile(type=0, ticks_per_beat=-6360, charset="utf-8")  # 25 frames, 40 ticks
        timed_by_frames.tracks.append(mido.MidiTrack([mido.Message("note_on", note=60, velocity=64, time=1920)]))
        timed_by_frames.save(smpte)
        ok("a file timed in frames, not beats, is read as this module's own 1920 ticks a second",
           [seconds for seconds, _ in read_events(smpte)[1]] == [1.0])

        # The module's own way of opening and saving, which Task 12's crop goes through.
        again = folder / "again.mid"
        smf._save(smf._load(cyrillic), again)
        ok("a file loaded and saved again through the module keeps its names",
           read_events(again)[0] == {"track_name": "Барабаны", "device_name": "Электронная установка"})

        # If storable ever lets through what mido then refuses, that event is
        # one more skipped. Made to by letting everything through.
        real_storable = smf.storable
        smf.storable = lambda data: True
        try:
            refused = write_mid(folder / "refused.mid", track_name="T", port_name="P", start=[b"\x90\x40"],
                                events=[(0.0, b"\x99\x24\x64"), (0.1, b"\x90\x40"), (0.2, b"\x90\x40\xFF"),
                                        (0.3, b"\xF0\x41\x90\xF7"), (0.4, b"\x89\x24\x00")])
        finally:
            smf.storable = real_storable
        ok("an event mido refuses is skipped and the rest are kept",
           refused == 4 and [data for _, data in read_events(folder / "refused.mid")[1]] ==
           [b"\x99\x24\x64", b"\x89\x24\x00"])

        # The file is opened by a name that is not ASCII, too.
        ok("a file named in Cyrillic is written", write_mid(folder / "Барабаны.mid", track_name="T", port_name="P",
                                                          start=[], events=[(0.0, b"\x99\x24\x64")]) == 0
           and (folder / "Барабаны.mid").stat().st_size > 0)

        # A name no encoding holds, and a time that is no time: neither costs the file.
        lone = folder / "lone.mid"
        skipped_lone = write_mid(lone, track_name="A\ud800B", port_name="P", start=[],
                                  events=[(0.0, b"\x99\x24\x64"), (None, b"\x89\x24\x00"),
                                          (float("nan"), b"\x89\x24\x00"), (float("inf"), b"\x89\x24\x00"),
                                          ("1", b"\x89\x24\x00"), (0.1, b"\x89\x24\x00")])
        ok("a lone surrogate in a name is written as a question mark",
           read_events(lone)[0]["track_name"] == "A?B")
        ok("a time that is not a number is one more skipped",
           skipped_lone == 4 and [seconds for seconds, _ in read_events(lone)[1]] == [0.0, 0.1])

        # mido keeps the charset in one variable for the length of a save: ports'
        # files written at the same time must not put it back under each other.
        errors = []

        def write_some(n):
            try:
                for k in range(15):
                    one = folder / f"thread{n}-{k}.mid"
                    write_mid(one, track_name="Пałyn Барабаны", port_name="P", start=[],
                              events=[(0.0, b"\x99\x24\x64")])
                    if read_events(one)[0]["track_name"] != "Пałyn Барабаны":
                        errors.append(n)
            except Exception as e:
                errors.append(repr(e))

        threads = [threading.Thread(target=write_some, args=(n,)) for n in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        ok("files written and read at the same time keep their names in UTF-8", errors == [])

    ok("storable: every channel message of the right length",
       all(storable(data) for data in (b"\x80\x40\x00", b"\x99\x24\x64", b"\xA0\x40\x20", b"\xB9\x04\x5A",
                                       b"\xC0\x05", b"\xCF\x7F", b"\xD0\x40", b"\xDF\x00",
                                       b"\xE0\x00\x40", b"\xEF\x7F\x7F")))
    ok("storable: whole SysEx, empty or not",
       all(storable(data) for data in (b"\xF0\xF7", b"\xF0\x41\x10\x42\xF7", b"\xF0" + bytes(range(128)) + b"\xF7")))
    ok("storable: nothing else a port sends",
       not any(storable(data) for data in (b"", b"\xF8", b"\xFA", b"\xFB", b"\xFC", b"\xFE", b"\xFF",
                                           b"\xF1\x20", b"\xF2\x00\x10", b"\xF3\x01", b"\xF4", b"\xF5",
                                           b"\xF6", b"\xF7")))
    ok("storable: not a message cut short, or run on, or with a high data byte",
       not any(storable(data) for data in (b"\x90", b"\x90\x40", b"\x90\x40\x40\x40", b"\xC0", b"\xC0\x05\x05",
                                           b"\xE0\x00", b"\x90\x80\x40", b"\x90\x40\x80", b"\xC0\x80",
                                           b"\x40\x40", b"\x40")))
    ok("storable: not a SysEx that is cut, never ended, or has a status byte inside",
       not any(storable(data) for data in (b"\xF0", b"\xF0\x41\x10", b"\xF0\x41\x80\xF7", b"\xF0\xF0\xF7",
                                           b"\xF0\x41\xF8\x42\xF7", b"\x41\x10\xF7")))
    ok("the library's version is a number the selftest can print",
       isinstance(smf.library_version(), str) and smf.library_version()[:1].isdigit())
    ok("storable takes any bytes-like thing",
       storable(bytearray(b"\x99\x24\x64")) and storable(memoryview(b"\xF0\x41\xF7")))

    # What a port has set on each channel, so a take's file can begin with it
    # (the pedal, the patch, the hi-hat), and which keys and pedals it holds, so
    # nothing is left ringing when the take ends. Bytes in, bytes out.
    print("\n[4] Where everything was when the take started")
    s = PortState()
    for m in [b"\xB0\x00\x01", b"\xB0\x20\x02", b"\xC0\x05", b"\xB9\x04\x5A", b"\xE0\x00\x50", b"\xD0\x30",
              b"\xB0\x07\x64", b"\xB0\x79\x00", b"\xB0\x58\x10", b"\xB0\x06\x01", b"\xB0\x26\x01",
              b"\xB0\x62\x01", b"\xB0\x40\x7F", b"\x90\x3C\x40", b"\xA9\x31\x7F"]:
        s.feed(m)
    start = s.start_messages()
    ok("the bank comes before the program",
       start.index(b"\xB0\x00\x01") < start.index(b"\xB0\x20\x02") < start.index(b"\xC0\x05"))
    ok("the hi-hat, volume, sustain, bend and pressure are set",
       all(m in start for m in [b"\xB9\x04\x5A", b"\xB0\x07\x64", b"\xB0\x40\x7F", b"\xE0\x00\x50", b"\xD0\x30"]))
    ok("commands and parameter numbers are not repeated",
       not any(m[0] & 0xF0 == 0xB0 and m[1] in (0x79, 0x58, 0x06, 0x26, 0x62) for m in start))
    ok("nothing about keys: no note, no choke", not any(m[0] & 0xF0 in (0x90, 0xA0) for m in start))
    ok("only what arrived", not any(m[0] & 0x0F == 1 for m in start))
    ok("a held key is let go", s.releases()[0] == b"\x80\x3C\x00")
    ok("and the sustain let up", b"\xB0\x40\x00" in s.releases())
    s.feed(b"\x90\x3C\x00")
    ok("a note-on at velocity 0 is a release", b"\x80\x3C\x00" not in s.releases())
    ok("and the sustain is all that is left to let up", s.releases() == [b"\xB0\x40\x00"])

    s = port_state(b"\xB0\x00\x01", b"\xB0\x20\x02", b"\xC0\x05", b"\xB9\x04\x5A", b"\xE0\x00\x50", b"\xD0\x30",
                   b"\xB0\x07\x64", b"\xB0\x79\x00", b"\xB0\x40\x7F", b"\x90\x3C\x40")
    ok("a channel at a time, channels ascending: bank, program, controllers, bend, pressure",
       s.start_messages() == [b"\xB0\x00\x01", b"\xB0\x20\x02", b"\xC0\x05", b"\xB0\x07\x64", b"\xB0\x40\x7F",
                             b"\xE0\x00\x50", b"\xD0\x30", b"\xB9\x04\x5A"])
    ok("a port that has sent nothing has nothing to start with or let go",
       PortState().start_messages() == [] and PortState().releases() == [])
    ok("channels come in order whatever the order they were heard in",
       port_state(b"\xBF\x07\x01", b"\xB2\x07\x02", b"\xC5\x01").start_messages()
       == [b"\xB2\x07\x02", b"\xC5\x01", b"\xBF\x07\x01"])
    ok("the bank is written first even when it was heard last, the program before the other controllers",
       port_state(b"\xB2\x07\x64", b"\xB2\x20\x03", b"\xB2\x00\x01", b"\xC2\x09", b"\xB2\x01\x30").start_messages()
       == [b"\xB2\x00\x01", b"\xB2\x20\x03", b"\xC2\x09", b"\xB2\x01\x30", b"\xB2\x07\x64"])
    ok("a bank with no program, and a program with no bank, are written as they came",
       port_state(b"\xB2\x20\x03", b"\xB2\x00\x01").start_messages() == [b"\xB2\x00\x01", b"\xB2\x20\x03"]
       and port_state(b"\xC2\x07").start_messages() == [b"\xC2\x07"])
    ok("the last value is the one kept: a controller, the program, the bend with both its bytes, the pressure",
       port_state(b"\xB3\x0B\x20", b"\xB3\x0B\x7F", b"\xC3\x01", b"\xC3\x02", b"\xE3\x01\x02", b"\xE3\x05\x60",
                  b"\xD3\x10", b"\xD3\x11").start_messages()
       == [b"\xC3\x02", b"\xB3\x0B\x7F", b"\xE3\x05\x60", b"\xD3\x11"])
    ok("key pressure is about a key, not a state: it sets nothing and holds nothing",
       port_state(b"\xA3\x3C\x40", b"\xA0\x3C\x00").start_messages() == []
       and port_state(b"\xA3\x3C\x40").releases() == [])
    ok("the same controller on two channels is two values",
       port_state(b"\xB0\x07\x10", b"\xB1\x07\x20").start_messages() == [b"\xB0\x07\x10", b"\xB1\x07\x20"])

    # Not a state, never repeated: all of 120-127 (sound off, reset, local control, ...),
    # 88, and the data entry and parameter numbers (6, 38, 96-101).
    never = [*range(96, 102), 6, 38, 88, *range(120, 128)]
    kept = [5, 7, 37, 39, 87, 89, 95, 102, 119]
    ok("controllers 6, 38, 88, 96-101 and 120-127 are never kept, on any channel",
       port_state(*[bytes((0xB0 | n % 16, n, 0x10)) for n in never]).start_messages() == [])
    ok("and the ones beside them are",
       port_state(*[bytes((0xB0, n, 0x10)) for n in kept]).start_messages() == [bytes((0xB0, n, 0x10)) for n in kept])
    ok("not applied either: all notes off and reset all controllers change nothing that was set",
       port_state(b"\xB0\x07\x64", b"\xE0\x00\x50", b"\xD0\x30", b"\xB0\x7B\x00", b"\xB0\x79\x00",
                  b"\xB0\x78\x00").start_messages() == [b"\xB0\x07\x64", b"\xE0\x00\x50", b"\xD0\x30"])
    ok("the key stays held through all notes off: a note-off too many costs nothing, a missing one rings for ever",
       port_state(b"\x90\x3C\x40", b"\xB0\x7B\x00", b"\xB0\x78\x00").releases() == [b"\x80\x3C\x00"])

    # Releases: the keys in the order they were pressed, then the pedals that are down.
    ok("keys are let go in the order pressed, across channels",
       port_state(b"\x90\x3C\x40", b"\x91\x40\x40", b"\x90\x30\x40").releases()
       == [b"\x80\x3C\x00", b"\x81\x40\x00", b"\x80\x30\x00"])
    ok("a key struck twice and not let go is one release, where it was first struck",
       port_state(b"\x90\x3C\x40", b"\x90\x40\x40", b"\x90\x3C\x50").releases() == [b"\x80\x3C\x00", b"\x80\x40\x00"])
    ok("a key struck again after it was let go goes to the back of the line",
       port_state(b"\x90\x3C\x40", b"\x90\x40\x40", b"\x80\x3C\x00", b"\x90\x3C\x40").releases()
       == [b"\x80\x40\x00", b"\x80\x3C\x00"])
    ok("a note-off at any velocity lets a key go, and one for a key never struck does nothing",
       port_state(b"\x90\x3C\x40", b"\x90\x40\x40", b"\x80\x3C\x40", b"\x80\x50\x00", b"\x90\x51\x00").releases()
       == [b"\x80\x40\x00"])
    ok("the same key on another channel is another key",
       port_state(b"\x90\x3C\x40", b"\x81\x3C\x00").releases() == [b"\x80\x3C\x00"])
    ok("the pedals come after the keys: sustain, sostenuto, soft, a channel at a time",
       port_state(b"\xB1\x43\x40", b"\xB0\x42\x7F", b"\xB0\x40\x40", b"\xB0\x43\x7F", b"\x92\x3C\x40").releases()
       == [b"\x82\x3C\x00", b"\xB0\x40\x00", b"\xB0\x42\x00", b"\xB0\x43\x00", b"\xB1\x43\x00"])
    ok("a pedal is down from 64: 63 is up, and a pedal already let up is not let up again",
       port_state(b"\xB0\x40\x3F", b"\xB0\x42\x7F", b"\xB0\x42\x00").releases() == []
       and port_state(b"\xB0\x40\x40").releases() == [b"\xB0\x40\x00"])
    ok("the last value of a pedal still starts the take: it is a controller like the others",
       port_state(b"\xB0\x42\x7F", b"\xB0\x42\x00").start_messages() == [b"\xB0\x42\x00"])
    ok("only sustain, sostenuto and soft are let up: portamento and the other switches are left as they are",
       port_state(b"\xB0\x41\x7F", b"\xB0\x44\x7F", b"\xB0\x45\x7F").releases() == [])

    # Asking changes nothing; a copy is its own.
    s = port_state(b"\xB0\x40\x7F", b"\xC0\x05", b"\x90\x3C\x40", b"\x91\x40\x40")
    start, releases = s.start_messages(), s.releases()
    start.clear()
    releases.clear()
    ok("what start_messages and releases give is the caller's: emptying it empties nothing of the state",
       s.start_messages() == [b"\xC0\x05", b"\xB0\x40\x7F"]
       and s.releases() == [b"\x80\x3C\x00", b"\x81\x40\x00", b"\xB0\x40\x00"])
    s.releases()
    s.start_messages()
    ok("asking for the start and the releases, again and again, changes neither",
       s.start_messages() == [b"\xC0\x05", b"\xB0\x40\x7F"]
       and s.releases() == [b"\x80\x3C\x00", b"\x81\x40\x00", b"\xB0\x40\x00"])
    c = s.copy()
    ok("a copy starts and lets go as the original does",
       isinstance(c, PortState) and c is not s and c.start_messages() == s.start_messages() and c.releases() == s.releases())
    original = (s.start_messages(), s.releases())
    for m in [b"\xB0\x40\x00", b"\xC0\x06", b"\x80\x3C\x00", b"\x91\x20\x40", b"\xE0\x00\x50", b"\xD2\x01"]:
        c.feed(m)
    ok("what a copy is fed does not reach the original", (s.start_messages(), s.releases()) == original)
    changed = (c.start_messages(), c.releases())
    for m in [b"\xB0\x07\x01", b"\x90\x50\x40", b"\x81\x40\x00", b"\xC0\x01"]:
        s.feed(m)
    ok("and what the original is fed does not reach the copy", (c.start_messages(), c.releases()) == changed)
    ok("a copy made after the original had been asked is the same", s.copy().releases() == s.releases())

    # A port sends all sorts, and a library may hand over a message cut short.
    cut = [b"", b"\x90", b"\x90\x3C", b"\xB0\x07", b"\xC0", b"\xD0", b"\xE0\x00", b"\xA0\x3C"]
    high = [b"\x90\x80\x40", b"\x90\x3C\x80", b"\xB0\x07\x80", b"\xB0\x80\x07", b"\xC0\x80", b"\xE0\x00\x80", b"\xD0\xFF"]
    long = [b"\x90\x3C\x40\x40", b"\xC0\x05\x05", b"\xB0\x07\x64\x00"]
    nostatus = [b"\x3C\x40\x40", b"\x40", b"\x00\x00\x00"]
    s = port_state(*cut, *high, *long, *nostatus)
    ok("a message cut short, run on, with no status or with a data byte of 0x80 or more is ignored",
       s.start_messages() == [] and s.releases() == [])
    s = port_state(b"\x90\x3C\x40", b"\xB0\x07\x64", b"\x80\x3C", b"\x80\x3C\x80", b"\xB0\x07\x65\x66", b"\xB0\x07")
    ok("and it does not disturb what was kept",
       s.start_messages() == [b"\xB0\x07\x64"] and s.releases() == [b"\x80\x3C\x00"])
    raised = []
    for junk in (None, "abc", 3.5, [300], [-1], object()):
        try:
            PortState().feed(junk)
        except Exception as e:
            raised.append(repr(e))
    ok("and what is not even bytes is ignored too, never raised", raised == [])
    system = [b"\xF0\x41\x10\x42\xF7", b"\xF0\xF7", b"\xF0\x7F\x7F\x04\x01\x00\x7F\xF7", b"\xF1\x20", b"\xF2\x00\x10", b"\xF3\x01",
              b"\xF4", b"\xF5", b"\xF6", b"\xF7", b"\xF8", b"\xF9", b"\xFA", b"\xFB", b"\xFC", b"\xFD", b"\xFE", b"\xFF"]
    s = port_state(b"\x90\x3C\x40", b"\xB0\x40\x7F", b"\xC0\x05")
    before = (s.start_messages(), s.releases())
    for m in system:
        s.feed(m)
    ok("SysEx, realtime and system messages change nothing, a reset among them (it is not a channel's)",
       (s.start_messages(), s.releases()) == before)
    ok("and on a port that sent only those there is nothing",
       port_state(*system).start_messages() == [] and port_state(*system).releases() == [])
    s = port_state(bytearray(b"\x90\x3C\x40"), memoryview(b"\xC0\x05"))
    ok("it takes any bytes-like thing", s.start_messages() == [b"\xC0\x05"] and s.releases() == [b"\x80\x3C\x00"])

    # What it gives goes into a .mid as it is: the start at tick 0, the releases at the end.
    s = port_state(b"\xB0\x00\x01", b"\xB0\x20\x02", b"\xC0\x05", b"\xB9\x04\x5A", b"\xE0\x00\x50", b"\xD0\x30",
                   b"\xB0\x40\x7F", b"\x90\x3C\x40", b"\x93\x30\x40")
    ok("every message it gives is bytes that a .mid can hold",
       all(type(m) is bytes and storable(m) for m in s.start_messages() + s.releases()))
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "state.mid"
        left_out = write_mid(path, track_name="Keys", port_name="Port", start=s.start_messages(),
                             events=[(2.0, m) for m in s.releases()])
        _, back = read_events(path)
        ok("written as a take's start and its end, none is left out and all come back",
           left_out == 0 and back == [(0.0, m) for m in s.start_messages()] + [(2.0, m) for m in s.releases()])

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
