"""
Recording notes beside the audio. So far this is what stops Start (A1, P2 and
P3), what the audio card check then holds, which saved port is found again
(P1), the order a device's ports are listed in (P7), the .mid file (F2 and
F4): what one can hold, written and read back, and what a port has set and
holds (F6 and F7); the audio's own clock, which puts a note on its sample (F1);
one take's notes on disk, written as they are played and made a .mid at Stop or
after a crash (F3, F5 and F7); the rehearsal's ports, which wait, come and go,
are held by another app or alike, go quiet, send the same notes twice and feed
a take (D7, P1, P4, P5, P7, P8, F7); a take's .mid read back as the notes the
player draws, in a drum grid or a piano roll (Part 6); a take's .mid cropped
with its audio (F4); the tool that measures how far the notes are from their
audio (F1, by hand); later sections are added here as the rest of it is built.

Python side, no browser, no MIDI: nothing here opens a port. The MIDI library
is blocked the way the other suites block it, and the pieces that decide what
is allowed are plain functions over plain dictionaries, so they are called
directly. The rig runs on fake_midi.py, a port system with nothing behind it
whose ports the checks plug in, pull out and play.
"""

import ast
import builtins
import contextlib
import importlib.util
import io
import itertools
import json
import logging
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import tracemalloc
import types
import wave
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

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
import numpy as np  # noqa: E402
from fake_midi import FakePortSystem  # noqa: E402

from rehearsal_recorder.audio.devices import channels_available  # noqa: E402
from rehearsal_recorder.midi import capture as notes_capture  # noqa: E402
from rehearsal_recorder.midi import rig as rig_mod  # noqa: E402
from rehearsal_recorder.midi import smf  # noqa: E402
from rehearsal_recorder.midi.capture import (  # noqa: E402
    CLOCK_FILE, MIDRAW_SUFFIX, MidiRecorder, NotesDropped, finish_draft, note_stems)
from rehearsal_recorder.midi.clock import AudioClock, MARK_EVERY_SEC, fit, load, save_line  # noqa: E402
from rehearsal_recorder.midi.identity import bare_name, find_port, in_order  # noqa: E402
from rehearsal_recorder.midi.notes import DRUM_MAP, DRUM_ROWS, read_notes  # noqa: E402
from rehearsal_recorder.midi.ports import PortInfo  # noqa: E402
from rehearsal_recorder.midi.rig import MidiRig  # noqa: E402
from rehearsal_recorder.midi.rules import notes_problem  # noqa: E402
from rehearsal_recorder.midi.smf import read_events, storable, write_mid  # noqa: E402
from rehearsal_recorder.midi.state import PortState  # noqa: E402

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
    # A set of small numbers does not always come out ascending: list({9, 1}) is [9, 1].
    ok("a channel heard first is written after a lower one heard later: controllers, program, bend, pressure",
       port_state(b"\xB9\x07\x01", b"\xB1\x07\x02").start_messages() == [b"\xB1\x07\x02", b"\xB9\x07\x01"]
       and port_state(b"\xC9\x01", b"\xC1\x02").start_messages() == [b"\xC1\x02", b"\xC9\x01"]
       and port_state(b"\xE9\x01\x01", b"\xE1\x02\x02").start_messages() == [b"\xE1\x02\x02", b"\xE9\x01\x01"]
       and port_state(b"\xD9\x01", b"\xD1\x02").start_messages() == [b"\xD1\x02", b"\xD9\x01"]
       and port_state(b"\xD9\x01", b"\xB1\x07\x02", b"\xE1\x02\x02").start_messages()
       == [b"\xB1\x07\x02", b"\xE1\x02\x02", b"\xD9\x01"])
    ok("and the pedals of a higher channel heard first are let up after a lower one's",
       port_state(b"\xB9\x40\x7F", b"\xB1\x40\x7F").releases() == [b"\xB1\x40\x00", b"\xB9\x40\x00"]
       and port_state(b"\xB9\x43\x7F", b"\xB1\x40\x7F", b"\xB9\x40\x7F").releases()
       == [b"\xB1\x40\x00", b"\xB9\x40\x00", b"\xB9\x43\x00"])
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
    class IntLike:
        def __index__(self):
            return 5  # bytes() of one of these is five zero bytes

    raised = []
    for junk in (None, "abc", 3.5, [300], [-1], [10**30], [1.5], ["a"], object(), 5, 10**30, -1, True, IntLike()):
        try:
            PortState().feed(junk)
        except Exception as e:
            raised.append(repr(junk) + " " + repr(e))
    ok("and what is not even bytes is ignored too, never raised", raised == [])
    s = port_state(b"\x90\x3C\x40", b"\xB0\x07\x64")
    before = (s.start_messages(), s.releases())
    for junk in (5, 10**30, -1, True, IntLike(), 0, 0x90):
        s.feed(junk)
    ok("a number is not a message: bytes(5) is five zero bytes, and none is made", (s.start_messages(), s.releases()) == before)
    tracemalloc.start()
    PortState().feed(10**8)
    made = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    ok("not even a hundred million of them, which would be a hundred megabytes", made < 1_000_000)
    s.feed([0xB0, 0x07, 0x65])
    s.feed((0xB0, 0x08, 0x01))
    ok("a list or a tuple of ints is one, as bytes are", s.start_messages() == [b"\xB0\x07\x65", b"\xB0\x08\x01"])
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

    # The state and the .mid agree on what a message is (state.py repeats the rule of
    # smf.storable, to stay clear of mido): every status, every length up to four bytes, data
    # bytes below 0x80 and above, and a message changes the state exactly when a .mid could hold
    # it, bar a key pressure (a key's, not a state) and the system messages (a SysEx the file
    # keeps and the state does not). "Changes" is seen on a port with nothing and on one holding
    # keys 0 and 0x40 on every channel, so that a note-off has something to let go.
    def every_message():
        yield b""
        for status in range(0x80, 0x100):
            for fill in ((0x00, 0x80), (0x40, 0xC0)):
                for length in range(1, 5):
                    for data in itertools.product(fill, repeat=length - 1):
                        yield bytes((status, *data))

    bases = [PortState(), port_state(*[bytes((0x90 | ch, note, 0x40)) for ch in range(16) for note in (0x00, 0x40)])]

    def changes_the_state(message):
        for base in bases:
            after = base.copy()
            after.feed(message)
            if (after.start_messages(), after.releases()) != (base.start_messages(), base.releases()):
                return True
        return False

    disagree, changing, unchanging = [], 0, 0
    for message in every_message():
        wanted = (storable(message) and 0x80 <= message[0] <= 0xEF and message[0] & 0xF0 != 0xA0)
        if changes_the_state(message) != wanted:
            disagree.append(message.hex(" "))
        changing += wanted
        unchanging += not wanted
    ok("a message changes the state exactly when a .mid could hold it (key pressure and system messages aside)",
       disagree == [] and changing > 150 and unchanging > 2000)

    # A port's thread feeds while another thread copies and reads: with the switch interval cut
    # to nothing, so that they change places in the middle of a loop.
    dice = random.Random(6)
    traffic = []
    for _ in range(20_000):
        channel, a, b = dice.randrange(16), dice.randrange(128), dice.randrange(128)
        traffic.append(dice.choice([bytes((0x90 | channel, a, b)), bytes((0x80 | channel, a, 0)),
                                    bytes((0xB0 | channel, a, b)), bytes((0xC0 | channel, a)),
                                    bytes((0xE0 | channel, a, b)), bytes((0xD0 | channel, a)),
                                    bytes((0x90 | channel, a, 0))]))
    shared, errors, fed = PortState(), [], threading.Event()

    def feeder():
        try:
            for message in traffic:
                shared.feed(message)
        except Exception as e:
            errors.append("feed " + repr(e))
        finally:
            fed.set()

    def reader():
        try:
            while True:
                last = fed.is_set()
                shared.copy().releases()
                shared.start_messages()
                shared.releases()
                if last:
                    break
        except Exception as e:
            errors.append("read " + repr(e))

    interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    try:
        # Daemon threads, joined with a limit: a lock that deadlocked would
        # fail the check below instead of keeping the suite from exiting.
        threads = [threading.Thread(target=feeder, daemon=True),
                   threading.Thread(target=reader, daemon=True)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)
    finally:
        sys.setswitchinterval(interval)
    ok("both threads finish within a minute", not any(t.is_alive() for t in threads))
    ok("one thread feeding 20000 messages while another copies and reads ends with no error", errors == [])
    alone = port_state(*traffic)
    ok("and nothing it was fed is lost",
       shared.start_messages() == alone.start_messages() and shared.releases() == alone.releases())

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

    # Where on the audio a moment on the computer's clock falls. Every audio block
    # says when it arrived and how many frames the take had by then; a line through
    # those turns a note's time into a sample, drift included. Fake blocks in, seconds out.
    print("\n[5] On the audio's own clock")
    SR = 48000
    c = AudioClock(SR); c.latency_sec = 0.010
    T0, rate = 5_000_000_000, SR * 1.0002          # an interface 200 ppm fast
    rnd = random.Random(7)
    for k in range(1, 3600 * SR // 1024):
        end = k * 1024
        c.mark(T0 + int(end / rate * 1e9) + 10_000_000 + rnd.randint(-2_000_000, 2_000_000), end, 1024, None)
    ok("a note an hour in lands on its sample", abs(c.to_seconds(T0 + 3_600_000_000_000) - 3600 * 1.0002) < 0.001)
    ok("and one at the start on time 0", abs(c.to_seconds(T0)) < 0.001)
    ok("and one half way on its sample too", abs(c.to_seconds(T0 + 1_800_000_000_000) - 1800 * 1.0002) < 0.001)
    ok("a note a little before the take began is a little before 0", abs(c.to_seconds(T0 - 50_000_000) + 0.05) < 0.001)
    ok("one mark a second is kept", 3590 < len(c.marks()) < 3610)
    ok("every mark is an ns and a frame, the frames going up",
       all(type(n) is int and type(f) is int for n, f in c.marks())
       and all(a[1] < b[1] for a, b in zip(c.marks(), c.marks()[1:])))
    ok("the first mark is the first block", c.marks()[0][1] == 0)
    ok("and the last is the latest block", c.marks()[-1][1] == (3600 * SR // 1024 - 2) * 1024)
    ok("the marks given are a list of its own", c.marks() is not c.marks() and c.marks() == c.marks())
    kept = len(c.marks())
    c.marks().clear()
    ok("so changing it changes nothing in the clock", len(c.marks()) == kept)

    a = AudioClock(SR); a.mark(T0 + 21_333_333 + 12_000_000, 1024, 1024, 0.012 + 1024 / SR)
    ok("a driver's own capture time is used", abs(a.marks()[0][0] - T0) < 100_000)
    b = AudioClock(SR); b.latency_sec = 0.005; b.mark(T0 + 21_333_333 + 5_000_000, 1024, 1024, -3.0)
    ok("a capture time that makes no sense is not", abs(b.marks()[0][0] - T0) < 100_000)
    z = AudioClock(SR); z.started_ns = T0
    ok("with no mark yet, from when the take started", z.to_seconds(T0 + 2_000_000_000) == 2.0)
    ok("a clock that has not even started says 0", AudioClock(SR).to_seconds(T0) == 0.0)
    ok("a new clock has no latency and has not started",
       AudioClock(SR).latency_sec == 0.0 and AudioClock(SR).started_ns is None)

    # The block arrived at T0 + 100 ms and has 1024 frames; the driver's word for
    # how old its first frame is, believed from now up to a second.
    def first_frame_at(age):
        t = AudioClock(SR); t.latency_sec = 0.005
        t.mark(T0 + 100_000_000, 1024, 1024, age)
        return t.marks()[0][0]
    by_its_length = T0 + 100_000_000 - 21_333_333 - 5_000_000
    ok("a capture time of exactly now is believed", first_frame_at(0.0) == T0 + 100_000_000)
    ok("one just under a second old is", first_frame_at(0.999) == T0 + 100_000_000 - 999_000_000)
    ok("one in the future is not: the block's length and the latency instead",
       abs(first_frame_at(-0.001) - by_its_length) <= 1)
    ok("one a second old is not", abs(first_frame_at(1.0) - by_its_length) <= 1)
    ok("a number that is not a number is not", abs(first_frame_at(float("nan")) - by_its_length) <= 1)
    ok("and none at all is the same", abs(first_frame_at(None) - by_its_length) <= 1)
    late = AudioClock(SR); late.mark(T0, 5000, 1024, None)
    ok("a first mark is kept whatever its frame is", [f for _, f in late.marks()] == [5000 - 1024])

    # One mark a second, the first and the latest always there.
    s10 = AudioClock(SR)
    for k in range(1, 10 * SR // 1024 + 1):
        s10.mark(T0 + k * 21_333_333, k * 1024, 1024, None)
    m10 = s10.marks()
    spaced = [f for _, f in m10[:-1]]
    ok("ten seconds of blocks keep a mark a second, and the latest", 10 <= len(m10) <= 12)
    ok("each kept a second or more after the one before",
       all(y - x >= MARK_EVERY_SEC * SR for x, y in zip(spaced, spaced[1:])))
    ok("and the latest is the newest block", m10[-1][1] == (10 * SR // 1024 - 1) * 1024)
    whole = AudioClock(SR)
    for k in range(1, 6):
        whole.mark(T0 + k * 1_000_000_000, k * SR, SR, None)
    ok("a latest that is a kept one is not there twice",
       [f for _, f in whole.marks()] == [0, SR, 2 * SR, 3 * SR, 4 * SR])
    ok("a clock with no block has no marks", AudioClock(SR).marks() == [])

    # The fit is a function of the marks alone, which is how a crashed take's
    # notes are placed again, from the marks that reached the disk.
    ok("fit, given the same marks, answers as the clock does",
       all(fit(c.marks(), SR, T0)(T0 + x) == c.to_seconds(T0 + x) for x in (0, 7_000_000_000, 3_600_000_000_000)))
    ok("with no marks it counts from the start", fit([], SR, T0)(T0 + 2_500_000_000) == 2.5)
    ok("and with no start either, from nothing", fit([], SR, None)(T0) == 0.0)
    ok("with one mark it runs at the rate it was asked for, through it",
       abs(fit([(T0 + 1_000_000_000, SR)], SR, T0)(T0 + 3_000_000_000) - 3.0) < 1e-9)
    ok("two marks under half a second apart make no slope, only an offset",
       abs(fit([(T0, 0), (T0 + 255_000_000, 12_000)], SR, T0)(T0 + 10_000_000_000) - (10 - 0.0025)) < 1e-6)
    ok("two marks half a second apart do",
       abs(fit([(T0, 0), (T0 + int(24_000 / rate * 1e9), 24_000)], SR, T0)(T0 + 100_000_000_000)
           - 100 * 1.0002) < 1e-6)
    ok("marks that stand still in time are not divided by",
       abs(fit([(T0, 0), (T0, 2 * SR)], SR, T0)(T0 + 1_000_000_000) - 2.0) < 1e-9)
    ok("nor are marks that run backwards",
       abs(fit([(T0 + 2_000_000_000, 0), (T0, 2 * SR)], SR, T0)(T0 + 2_000_000_000) - 2.0) < 1e-9)
    shuffled = c.marks()
    random.Random(3).shuffle(shuffled)
    ok("a fit does not mind the order the marks come in",
       abs(fit(shuffled, SR, T0)(T0 + 3_600_000_000_000) - c.to_seconds(T0 + 3_600_000_000_000)) < 1e-6)
    up = 120 * 86_400 * 10**9  # a machine up for months: past 2**53 ns, where floats skip whole nanoseconds
    ok("a reading from a machine up for months places a note as it would on a fresh one",
       abs(fit([(up + int(f / rate * 1e9), f) for f in range(0, 120 * SR, SR)], SR, None)(up + 100 * 10**9)
           - 100 * 1.0002) < 1e-6)

    # A take still going: a note asked about is placed with the marks so far, and
    # asked about again later, with the marks since. The interface slows down by
    # 1000 ppm half way through, so that a fit kept too long would show.
    live = AudioClock(SR)
    half = 50 * SR // 1024
    ns_at = T0
    for k in range(1, 2 * half):
        ns_at += int(1024 / (rate if k < half else rate * 0.999) * 1e9)
        live.mark(ns_at, k * 1024, 1024, None)
        if k == half - 1:
            early_marks, early_ns, early = live.marks(), ns_at, live.to_seconds(ns_at)
    late = live.to_seconds(ns_at)
    ok("asked mid-take, it answers from the marks it has", early == fit(early_marks, SR, None)(early_ns))
    ok("and later, from the marks since", late == fit(live.marks(), SR, None)(ns_at)
       and late != fit(early_marks, SR, None)(ns_at))

    # A mark a second goes to disk as a line (take.clock, spec F3), and the fit of
    # what reached the disk is the one the clock would have made.
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "take.clock"

        def put(text):
            # Bytes, so that a Windows console's newline does not change what is written.
            path.write_bytes(text.encode("utf-8"))

        marks = [(T0 + n * 1_000_000_000 + rnd.randint(-2_000_000, 2_000_000), n * SR) for n in range(3600)]
        put("".join(save_line(m) for m in marks))
        ok("a mark is a line of an ns, a space, a frame and a newline", save_line((123, 456)) == "123 456\n")
        ok("3600 marks saved and loaded are the same 3600", load(path) == marks)
        ok("and the fit of them is the fit of the originals",
           fit(load(path), SR, T0)(T0 + 1_800_000_000_000) == fit(marks, SR, T0)(T0 + 1_800_000_000_000))
        ok("a file that is not there has no marks", load(Path(tmp) / "none.clock") == [])
        (Path(tmp) / "empty.clock").write_bytes(b"")
        ok("nor has one that is empty", load(Path(tmp) / "empty.clock") == [])

        # The last line of a file that was being written when the app died is cut
        # anywhere. "12 48", cut from "12 4800", reads as a number, and a wrong one:
        # only a line that has its newline is a line.
        three = "".join(save_line(m) for m in marks[:3])
        wrong = []
        for tail in (save_line(marks[3])[:-1], "123456789 48", "123456789 ", "123456789", "1234", "-", "\r"):
            put(three + tail)
            if load(path) != marks[:3]:
                wrong.append(tail)
        ok("a last line cut short anywhere is left out and the rest loads", wrong == [])
        path.write_bytes(three.encode() + b"\x00" * 8)
        ok("a file ending in NUL bytes, as a crash can leave one, loads the rest", load(path) == marks[:3])
        junk = ["garbage", "1 2 3", "1.5 2", "1e9 2", "12 -3", "x" * 5000, "9" * 5000 + " 1", "\u00e9\x00 5", "1  2", ""]
        put(save_line(marks[0]) + "".join(j + "\n" for j in junk) + save_line(marks[1]) + save_line((-5, 0)))
        ok("a line that is not an ns and a frame is skipped, and the lines either side of it kept",
           load(path) == [marks[0], marks[1], (-5, 0)])
        path.write_bytes(save_line(marks[0]).encode() + b"\xff\xfe junk\n" + save_line(marks[1]).encode())
        ok("a line that is not text is skipped too", load(path) == [marks[0], marks[1]])
        path.write_bytes((save_line(marks[0]) + save_line(marks[1])).replace("\n", "\r\n").encode())
        ok("lines ended the Windows way load", load(path) == [marks[0], marks[1]])

    # mark() runs on the audio thread and marks() on others: with the switch
    # interval cut to nothing, the reader still sees the marks in order, none twice.
    shared, errors, done, sizes = AudioClock(SR), [], threading.Event(), []

    def writer():
        try:
            for k in range(1, 40_001):
                shared.mark(T0 + k * 21_333_333, k * 1024, 1024, None)
        except Exception as e:
            errors.append("mark " + repr(e))
        finally:
            done.set()

    def reader():
        try:
            while True:
                last = done.is_set()
                got = shared.marks()
                frames = [f for _, f in got]
                if frames != sorted(set(frames)):
                    errors.append("out of order or twice")
                    return
                sizes.append(len(got))
                shared.to_seconds(T0 + 5_000_000_000)
                if last:
                    break
        except Exception as e:
            errors.append("read " + repr(e))

    interval = sys.getswitchinterval()
    sys.setswitchinterval(1e-6)
    try:
        # Daemon threads, joined with a limit, as in [4].
        threads = [threading.Thread(target=writer, daemon=True), threading.Thread(target=reader, daemon=True)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(60)
    finally:
        sys.setswitchinterval(interval)
    ok("both threads finish within a minute", not any(t.is_alive() for t in threads))
    ok("a clock marked in one thread and read in another is read in order, with no error",
       errors == [] and sizes != [] and sizes == sorted(sizes))
    ok("and ends with a mark a second and the latest",
       abs(len(shared.marks()) - 40_000 * 1024 / (47 * 1024)) <= 2 and shared.marks()[-1][1] == 39_999 * 1024)

    # What the clock leaves behind on the audio thread: a mark a second, and nothing per call.
    quiet = AudioClock(SR)
    for k in range(1, 200):
        quiet.mark(T0 + k * 21_333_333, k * 1024, 1024, None)
    tracemalloc.start()
    before = tracemalloc.take_snapshot()
    for k in range(200, 20_200):
        quiet.mark(T0 + k * 21_333_333, k * 1024, 1024, None)
    grown = sum(d.size_diff for d in tracemalloc.take_snapshot().compare_to(before, "filename") if d.size_diff > 0)
    tracemalloc.stop()
    ok("20000 blocks, 430 seconds of them, leave a mark a second", 428 <= len(quiet.marks()) <= 433)
    ok("and under 16 bytes a block, where a mark kept for every block would leave over 100", grown < 20_000 * 16)

    imports = {n.names[0].name if isinstance(n, ast.Import) else n.module
               for n in ast.walk(ast.parse(Path(sys.modules[AudioClock.__module__].__file__).read_text(encoding="utf-8")))
               if isinstance(n, (ast.Import, ast.ImportFrom))}
    ok("the clock imports neither the MIDI library nor mido nor sounddevice",
       not imports & {"mido", "pylibremidi", "sounddevice", "rehearsal_recorder.midi.ports"})

    print("\n[6] A take's notes on disk")
    said6 = []  # what the recorder says to the log, so that it is checked and not printed
    catcher6 = logging.Handler(level=logging.INFO)
    catcher6.emit = said6.append
    logging.getLogger(notes_capture.__name__).addHandler(catcher6)
    S, MS, SR = 1_000_000_000, 1_000_000, 48000
    T0 = 5_000_000_000
    band = [{"name": "Drums", "port": "TD-17"},
            {"name": "Keys", "port": "Launchkey Mini MK3"},
            {"name": "Synth", "port": "Gone"}]
    kit_start = port_state(b"\xb9\x04\x5a")  # controller 4 at 90 on channel 10: the hi-hat pedal half down

    def clock_from(t0):
        c = AudioClock(SR)
        c.started_ns = t0
        return c

    def blocks(c, first, last):
        """Audio blocks `first` to `last` - 1 of 1024 frames, from an interface that keeps time exactly."""
        for k in range(first, last):
            at = k * 1024
            c.mark(T0 + int(at / SR * 1e9) + 10 * MS, at + 1024, 1024, 0.010)

    def in_ticks(path):
        """The channel messages of a .mid, each with its tick and its bytes."""
        return [(tick, bytes(msg.bytes())) for tick, msg in played(read_back(path)[1])]

    def play_kit(rec):
        rec.present("Drums", T0)
        rec.present("Keys", T0)
        rec.feed("Drums", T0 - 50 * MS, b"\x99\x24\x64")          # 36 on, 50 ms before the take
        rec.feed("Drums", T0 + 20 * MS, b"\x89\x24\x00")          # and off, 20 ms after its start
        rec.feed("Drums", T0 + 1 * S, b"\x99\x26\x50")            # 38 on
        rec.feed("Drums", T0 + 1 * S + 100 * MS, b"\x89\x26\x00")
        rec.feed("Drums", T0 + 2 * S, b"\x99\x2a\x40")            # 42 on, and never let go
        rec.feed("Synth", T0 + 2 * S, b"\x90\x3c\x40")            # a port that never appeared
        rec.feed("Nobody", T0 + 2 * S, b"\x90\x3c\x40")           # a track this take does not have
        rec.present("Nobody", T0)
        rec.gone("Nobody", T0)
        rec.gone("Synth", T0)                                     # it never came, so it cannot go
        for junk in (b"", 5, None, "text"):
            rec.feed("Drums", T0 + 2 * S, junk)                   # nothing a port sends

    with tempfile.TemporaryDirectory() as tmp:
        def fresh(name):
            folder = Path(tmp) / name
            folder.mkdir()
            return folder

        def files(folder):
            return sorted(p.name for p in folder.iterdir())

        one = fresh("one")
        rec = MidiRecorder(one, clock_from(T0), band, {"Drums": kit_start})
        ok("a recorder with no port there yet has made no file", files(one) == [])
        play_kit(rec)
        ok("a .midraw is made for each port that appeared, and for no other (F5)",
           files(one) == ["Drums.midraw", "Keys.midraw"])
        rec.flush()
        ok("flush leaves what was played on disk", (one / "Drums.midraw").stat().st_size > 0)
        lines = (one / "Drums.midraw").read_bytes().decode("ascii").split("\n")
        ok("a .midraw says when the take began, the state the port was in, then each event as it came",
           lines[:3] == [f"t {T0}", "s b9045a", f"n {T0 - 50 * MS} 992464"]
           and lines[-2] == f"n {T0 + 2 * S} 992a40" and lines[-1] == "" and len(lines) == 8)
        ok("a port that has sent nothing has only the first line",
           (one / "Keys.midraw").read_bytes() == f"t {T0}\n".encode())
        ok("with no mark on the clock there is no clock file", not (one / CLOCK_FILE).exists())
        made = rec.stop(3.0)
        ok("stop leaves the two .mid files and nothing else: no .midraw, no take.clock, no temporary",
           files(one) == ["Drums.mid", "Keys.mid"])
        ok("and says which, in the band's order, with their ports",
           made == [{"name": "Drums", "file": str(one / "Drums.mid"), "port": "TD-17"},
                    {"name": "Keys", "file": str(one / "Keys.mid"), "port": "Launchkey Mini MK3"}])
        names, events = read_events(one / "Keys.mid")
        ok("a port that was there and sent nothing has its .mid, with its names and no events (F5)",
           names == {"track_name": "Keys", "device_name": "Launchkey Mini MK3"} and events == [])
        kit = in_ticks(one / "Drums.mid")
        ok("Drums.mid has the track's name and its port's",
           read_events(one / "Drums.mid")[0] == {"track_name": "Drums", "device_name": "TD-17"})
        ok("it begins with the pedal as it was, on channel 9, at tick 0 (F6)", kit[0] == (0, b"\xb9\x04\x5a"))
        ok("a key struck before the take began is not in it, nor is its release (36)",
           all(data[1] != 0x24 for _, data in kit))
        ok("38 is on at tick 1920 and off at 2112", kit[1:3] == [(1920, b"\x99\x26\x50"), (2112, b"\x89\x26\x00")])
        ok("42 is on at 3840 and, held when the take stopped at 3 s, off at tick 5760 (F7)",
           kit[3:] == [(3840, b"\x99\x2a\x40"), (5760, b"\x89\x2a\x00")])
        rec.feed("Drums", T0 + 2500 * MS, b"\x99\x2c\x40")
        ok("a recorder that has stopped takes nothing more, and stopping again gives the same answer",
           files(one) == ["Drums.mid", "Keys.mid"] and rec.stop(3.0) == made)

        # A port that goes and comes back is one file, and what it held is let go
        # when it went.
        two = fresh("two")
        rec = MidiRecorder(two, clock_from(T0), band, {})
        rec.present("Drums", T0)
        rec.feed("Drums", T0 + 2 * S, b"\x99\x2a\x40")
        rec.gone("Drums", T0 + 2500 * MS)
        rec.feed("Drums", T0 + 2600 * MS, b"\x99\x2c\x40")        # the port is not there: nothing is heard
        rec.gone("Drums", T0 + 2700 * MS)                         # nor can it go twice
        rec.present("Drums", T0 + 2800 * MS)
        rec.feed("Drums", T0 + 2900 * MS, b"\x99\x28\x40")        # 40
        ok("a port that went and came back is one file", files(two) == ["Drums.midraw"])
        rec.stop(3.0)
        ok("42 is let go when its port went, at tick 4800, and 40 is there, let go at the end",
           in_ticks(two / "Drums.mid") == [(3840, b"\x99\x2a\x40"), (4800, b"\x89\x2a\x00"),
                                           (5568, b"\x99\x28\x40"), (5760, b"\x89\x28\x00")])

        # The state a port was in, the keys it was holding, and where the take ends.
        three = fresh("three")
        before_take = port_state(b"\xc0\x05", b"\x90\x3d\x40")    # program 5, and key 61 held down
        rec = MidiRecorder(three, clock_from(T0), band, {"Keys": before_take})
        rec.present("Keys", T0)
        for ns, data in ((T0 - 10 * MS, b"\xb0\x40\x7f"),          # the sustain pedal down just before the take
                         (T0 - 5 * MS, b"\x90\x3c\x40"),           # key 60 struck just before it
                         (T0 + 200 * MS, b"\x80\x3d\x00"),         # 61, held since long before, let go
                         (T0 + 500 * MS, b"\x80\x3c\x00"),         # 60 let go
                         (T0 + 1 * S, b"\x90\x3e\x40"),            # 62
                         (T0 + 2900 * MS, b"\x90\x40\x40"),        # 64
                         (T0 + 3 * S, b"\x90\x41\x40"),            # at the end: not in the take
                         (T0 + 3500 * MS, b"\x90\x42\x40")):       # after it
            rec.feed("Keys", ns, data)
        rec.stop(3.0)
        ok("the program is at tick 0 and the pedal that was down is down, as the port was at the start (F6)",
           in_ticks(three / "Keys.mid")[:2] == [(0, b"\xc0\x05"), (0, b"\xb0\x40\x7f")])
        ok("keys held before the take began, or struck just before it, are not in it, nor are their releases",
           b"\x80\x3d\x00" not in [d for _, d in in_ticks(three / "Keys.mid")]
           and b"\x80\x3c\x00" not in [d for _, d in in_ticks(three / "Keys.mid")])
        ok("at 3 s the keys the take pressed are let go in the order they were pressed, then the pedal (F7)",
           in_ticks(three / "Keys.mid")[2:] == [(1920, b"\x90\x3e\x40"), (5568, b"\x90\x40\x40"),
                                                (5760, b"\x80\x3e\x00"), (5760, b"\x80\x40\x00"),
                                                (5760, b"\xb0\x40\x00")])

        # A burst: 20000 notes on and off inside a second, none lost.
        four = fresh("four")
        rec = MidiRecorder(four, clock_from(T0), [{"name": "Pad", "port": "Pad"}], {})
        rec.present("Pad", T0)
        burst = []
        began = time.perf_counter()
        for i in range(20000):
            on, off = bytes((0x90, i % 128, 1 + i % 127)), bytes((0x80, i % 128, 0))
            at = T0 + 1 * S + i * 40_000
            rec.feed("Pad", at, on)
            rec.feed("Pad", at + 20_000, off)
            burst += [on, off]
        fed = time.perf_counter() - began
        began = time.perf_counter()
        rec.stop(3.0)
        stopped = time.perf_counter() - began
        got = [data for _, data in read_events(four / "Pad.mid")[1]]
        ok("all 40000 events of the burst are in the .mid, in order", got == burst)
        ok("and writing them as they came, and then the file, are quick (a limit that only a hang would pass)",
           fed < 10 and stopped < 60)

        # Review focus 2: the app dies. What is on disk becomes the same file stop would have made.
        stopped_at = fresh("stopped")
        rec = MidiRecorder(stopped_at, clock_from(T0), band, {"Drums": kit_start})
        play_kit(rec)
        rec.stop(3.0)
        crashed = fresh("crashed")
        rec = MidiRecorder(crashed, clock_from(T0), band, {"Drums": kit_start})
        play_kit(rec)
        rec.flush()
        rec.abandon()
        rec.feed("Drums", T0 + 2200 * MS, b"\x99\x2c\x40")
        ok("a recorder given up leaves its files as they are, and takes nothing more",
           files(crashed) == ["Drums.midraw", "Keys.midraw"])
        (crashed / CLOCK_FILE).unlink(missing_ok=True)
        (crashed / "take.json").write_text(json.dumps({
            "samplerate": SR, "bit_depth": 16, "tracks": [],
            "notes": [{"file": "Drums", "port": "TD-17"}, {"file": "Keys", "port": "Launchkey Mini MK3"}]}),
            encoding="utf-8")
        found = finish_draft(crashed, 3.0)
        ok("a crashed take is made the same files stop makes, byte for byte, from the take's start",
           all((stopped_at / f).read_bytes() == (crashed / f).read_bytes() for f in ("Drums.mid", "Keys.mid")))
        ok("and the list says which, with the ports take.json has",
           found == [{"name": "Drums", "file": str(crashed / "Drums.mid"), "port": "TD-17"},
                     {"name": "Keys", "file": str(crashed / "Keys.mid"), "port": "Launchkey Mini MK3"}])
        ok("the .midraw files are gone and take.json is left for the audio to use",
           files(crashed) == ["Drums.mid", "Keys.mid", "take.json"])
        again = {f: (crashed / f).read_bytes() for f in ("Drums.mid", "Keys.mid")}
        ok("a second go has nothing to convert: the .mid files are listed as they are, and unchanged",
           finish_draft(crashed, 3.0) == found and again == {f: (crashed / f).read_bytes() for f in again})

        unnamed = fresh("unnamed")
        rec = MidiRecorder(unnamed, clock_from(T0), band, {"Drums": kit_start})
        play_kit(rec)
        rec.abandon()
        ok("with no take.json a port is called what its file is",
           [m["port"] for m in finish_draft(unnamed, 3.0)] == ["Drums", "Keys"]
           and read_events(unnamed / "Keys.mid")[0]["device_name"] == "Keys")
        ok("and the notes are the same", read_events(unnamed / "Drums.mid")[1] == read_events(stopped_at / "Drums.mid")[1])

        # On the audio's own clock: an interface 1 percent fast, so that where a note
        # lands says which clock placed it.
        fast = AudioClock(SR)
        fast.started_ns = T0
        for k in range(4 * SR // 1024):
            at = k * 1024
            fast.mark(T0 + int(at / (SR * 1.01) * 1e9) + 10 * MS, at + 1024, 1024, 0.010)
        plays = [T0 + 500 * MS, T0 + 2 * S, T0 + 3400 * MS]

        def play_fast(folder):
            rec = MidiRecorder(folder, fast, band[1:2], {})
            rec.present("Keys", T0)
            for i, ns in enumerate(plays):
                rec.feed("Keys", ns, bytes((0x90, 60 + i, 64)))
            return rec

        live = fresh("live")
        play_fast(live).stop(3.9)
        ticks = [tick for tick, data in in_ticks(live / "Keys.mid") if data[0] == 0x90]
        ok("stop places a note on the sample the audio was at: each tick is the clock's second times 1920",
           ticks == [round(fast.to_seconds(ns) * 1920) for ns in plays])
        ok("which is not where the computer's own seconds would have put it",
           ticks != [round((ns - T0) / S * 1920) for ns in plays] and ticks[2] - round(3.4 * 1920) > 40)
        keys_note = [{"file": "Keys", "port": "Launchkey Mini MK3"}]
        for n, (label, record, kwarg, as_stop) in enumerate((
                ("take.json gives the samplerate: the marks on disk place the notes as stop did",
                 {"samplerate": SR}, None, True),
                ("take.json has none and the caller gives it: the same",
                 {}, SR, True),
                ("take.json and the caller disagree: take.json is believed",
                 {"samplerate": SR}, 12345, True),
                ("no samplerate anywhere: the notes are placed by the take's start alone",
                 {}, None, False))):
            draft = fresh(f"draft{n}")
            rec = play_fast(draft)
            rec.flush()
            rec.abandon()
            (draft / "take.json").write_text(json.dumps({**record, "notes": keys_note}), encoding="utf-8")
            finish_draft(draft, 3.9, samplerate=kwarg)
            ok("a crashed take: " + label, ((draft / "Keys.mid").read_bytes() == (live / "Keys.mid").read_bytes()) is as_stop)

        # What reaches take.clock, and how often (R25).
        class Watched(AudioClock):
            looked = 0

            def marks(self):
                Watched.looked += 1
                return super().marks()

        watched = Watched(SR)
        watched.started_ns = T0
        blocks(watched, 0, 20)                                     # 0.43 s of audio
        five = fresh("clock")
        rec = MidiRecorder(five, watched, [{"name": "Pad", "port": "Pad"}], {})
        rec.present("Pad", T0 + 430 * MS)
        asked = Watched.looked
        ok("the first call looks at the clock once and has its kept marks so far on disk, not its latest",
           asked == 1 and load(five / CLOCK_FILE) == watched.marks()[:-1] != [])
        asked = Watched.looked
        for i in range(20000):
            rec.feed("Pad", T0 + 430 * MS + i * 20_000, b"\x90\x3c\x40" if i % 2 == 0 else b"\x80\x3c\x00")
        ok("20000 events inside a second do not look at the clock again", Watched.looked == asked)
        blocks(watched, 20, 70)
        rec.feed("Pad", T0 + 1500 * MS, b"\x90\x3c\x40")
        ok("the first event more than a second later brings the marks made since, once",
           Watched.looked == asked + 1 and load(five / CLOCK_FILE) == watched.marks()[:-1])
        blocks(watched, 70, 100)
        rec.flush()
        on_disk = load(five / CLOCK_FILE)
        ok("flush brings the rest: the kept marks, once, the frames going up, and never the clock's latest",
           on_disk == watched.marks()[:-1] and len(on_disk) == 3 and watched.marks()[-1] not in on_disk
           and [f for _, f in on_disk] == sorted({f for _, f in on_disk}))
        ok("and the clock file is whole lines, an ns, a space and a frame",
           re.fullmatch(r"(-?[0-9]+ [0-9]+\n)+", (five / CLOCK_FILE).read_bytes().decode("ascii")) is not None)
        rec.stop(2.0)
        ok("stop puts no more marks in it, and deletes it", not (five / CLOCK_FILE).exists())

        # A crash, a torn last line, and what else a .midraw may have in it.
        odd = fresh("odd")
        cut = "\n".join([
            f"n {T0 + 1 * S} 903c40",             # an event before the first line
            f"t {T0}",
            "s b0045a",
            f"n {T0 + 2 * S} zz",                 # hex that is not hex
            f"n {T0 + 2 * S} 903",                # an odd number of digits
            "n abc 903c40",                       # a time that is not a number
            f"n {T0 + 3 * S}",                    # no bytes
            "g",                                  # no time
            "x 1 2 3",                            # no such line
            "",
            f"n {T0 + 1500 * MS} 803c00",
            f"n {T0 + 2900 * MS} 9040"])          # cut short by the crash: it has no newline
        (odd / "Keys.midraw").write_bytes(cut.encode("ascii"))
        finish_draft(odd, 3.0)
        ok("a line that is not a line is passed over, an event before the first line is kept, and a last line with no newline is not",
           read_events(odd / "Keys.mid")[1] == [(0.0, b"\xb0\x04\x5a"), (1.0, b"\x90\x3c\x40"), (1.5, b"\x80\x3c\x00")])
        wrong = []
        for n, tail in enumerate((b"\x00" * 16, b"n 123", b"\xff\xfe junk", b"\r", b"n 1 90\x00")):
            torn_dir = fresh(f"torn{n}")
            (torn_dir / "Keys.midraw").write_bytes(f"t {T0}\nn {T0 + 1 * S} 903c40\n".encode("ascii") + tail)
            finish_draft(torn_dir, 3.0)
            if read_events(torn_dir / "Keys.mid")[1] != [(1.0, b"\x90\x3c\x40"), (3.0, b"\x80\x3c\x00")]:
                wrong.append(tail)
        ok("a file the crash left ending in NUL bytes, a cut line or something that is not text loads the rest",
           wrong == [])
        headless = fresh("headless")
        (headless / "Keys.midraw").write_bytes(f"n {T0 + 7 * S} 903c40\nn {T0 + 8 * S} 803c00\n".encode("ascii"))
        finish_draft(headless, 9.0)
        ok("a file whose first line never reached the disk keeps its notes, counted from the first",
           read_events(headless / "Keys.mid")[1] == [(0.0, b"\x90\x3c\x40"), (1.0, b"\x80\x3c\x00")])
        empty = fresh("empty")
        (empty / "Keys.midraw").write_bytes(b"")
        ok("and an empty one is a .mid with its names and nothing else",
           finish_draft(empty, 3.0)[0]["name"] == "Keys" and read_events(empty / "Keys.mid")[1] == [])

        # A draft with no audio frames keeps everything and lets go at the last event (R24).
        bare = fresh("bare")
        rec = MidiRecorder(bare, clock_from(T0), band[:1], {})
        rec.present("Drums", T0)
        for ns, data in ((500, b"\x90\x3c\x40"), (1000, b"\x90\x3e\x40"), (1500, b"\x80\x3c\x00"),
                         (2000, b"\x90\x40\x40"), (2500, b"\xb0\x40\x7f")):
            rec.feed("Drums", T0 + ns * MS, data)
        rec.abandon()
        bare2 = Path(tmp) / "bare2"
        shutil.copytree(bare, bare2)
        finish_draft(bare, 0)
        finish_draft(bare2, None)
        ok("a draft with no audio frames keeps every event, and lets go of what is held at the last one",
           in_ticks(bare / "Drums.mid") == [(960, b"\x90\x3c\x40"), (1920, b"\x90\x3e\x40"), (2880, b"\x80\x3c\x00"),
                                            (3840, b"\x90\x40\x40"), (4800, b"\xb0\x40\x7f"),
                                            (4800, b"\x80\x3e\x00"), (4800, b"\x80\x40\x00"), (4800, b"\xb0\x40\x00")]
           and (bare / "Drums.mid").read_bytes() == (bare2 / "Drums.mid").read_bytes())

        # Names that make one file name each get a file of their own.
        same = fresh("same")
        rec = MidiRecorder(same, clock_from(T0), [{"name": "A/B", "port": "P1"}, {"name": "A:B", "port": "P2"},
                                                  {"name": "a_b", "port": "P3"}], {})
        for name, note in (("A/B", 60), ("A:B", 62), ("a_b", 64)):
            rec.present(name, T0)
            rec.feed(name, T0 + 1 * S, bytes((0x90, note, 64)))
        made = rec.stop(2.0)
        ok("tracks whose names make one file name each get a file, and none writes over another",
           set(files(same)) == {"A_B.mid", "A_B (2).mid", "a_b (3).mid"} and len({m["file"] for m in made}) == 3)
        ok("each has its own notes", [[d for _, d in in_ticks(m["file"]) if d[0] == 0x90][0][1] for m in made] == [60, 62, 64]
           and [m["port"] for m in made] == ["P1", "P2", "P3"])
        ok("the file names are the ones note_stems gives, which anyone who must know them before the recorder exists asks",
           [Path(m["file"]).stem for m in made] == [note_stems(["A/B", "A:B", "a_b"])[n] for n in ("A/B", "A:B", "a_b")])
        ok("note_stems: a name that is safe stays, an unsafe one is made safe, as the audio's file is",
           note_stems(["Drums", "Keys", "Pa\u0142yn", "A/B"]) == {"Drums": "Drums", "Keys": "Keys", "Pa\u0142yn": "Pa\u0142yn", "A/B": "A_B"}
           and note_stems(["  "]) == {"  ": "track"} and note_stems([]) == {})
        ok("note_stems: names that make one file name get (2), (3) in track order, whatever the case",
           note_stems(["Keys", "keys", "KEYS", "A/B", "A:B"]) == {"Keys": "Keys", "keys": "keys (2)", "KEYS": "KEYS (3)",
                                                                  "A/B": "A_B", "A:B": "A_B (2)"})
        ok("note_stems: a name met again is the same one, and a stem taken by a renamed one is not given twice",
           note_stems(["A/B", "A/B", "A:B", "A_B (2)"]) == {"A/B": "A_B", "A:B": "A_B (2)", "A_B (2)": "A_B (2) (2)"})

        ok("all of that was done without a word in the log", said6 == [])

        # The .mid is written under another name and moved into place, so a crash cannot leave half of it.
        half = fresh("half")
        rec = MidiRecorder(half, clock_from(T0), band[:2], {"Drums": kit_start})
        play_kit(rec)
        real_write, seen = notes_capture.write_mid, []

        def torn_write(path, **kw):
            seen.append(Path(path).name)
            Path(path).write_bytes(b"MThd half a file")
            raise OSError(28, "No space left on device")

        notes_capture.write_mid = torn_write
        try:
            made = rec.stop(3.0)
        finally:
            notes_capture.write_mid = real_write
        ok("a .mid is written under another name than its own", len(seen) == 2 and "Drums.mid" not in seen)
        ok("one that could not be written leaves no half file, keeps its .midraw, and stop still answers",
           made == [] and files(half) == ["Drums.midraw", "Keys.midraw"])
        ok("and each is said in the log, once, by its track's name, at ERROR which the app's log keeps (R37)",
           [r.levelno for r in said6] == [logging.ERROR] * 2
           and [r.getMessage().split(":")[0] for r in said6] == ["Drums", "Keys"])
        ok("and is made from the .midraw later, as after a crash",
           [m["name"] for m in finish_draft(half, 3.0)] == ["Drums", "Keys"] and files(half) == ["Drums.mid", "Keys.mid"]
           and in_ticks(half / "Drums.mid")[-1] == (5760, b"\x89\x2a\x00") and len(said6) == 2)

        # Review focus 4: a disk that refuses. The error comes out of the call that met it, what the disk
        # did not take is kept for when it does, and the recorder carries on.
        class Room:
            """A file on a disk with `room` bytes left (None: as many as it is asked), which takes the part of
            a write that fits and then refuses. A `hostile` disk raises for a write that does not fit once it
            has taken its first part, and says no count. A `silent` one takes nothing and answers None, as a file
            that cannot take a write now does."""
            room, hostile, silent = None, False, False
            only = None  # a part of the one file name the disk refuses; the rest it takes as asked

            def __init__(self, real):
                self.real = real

            def write(self, data):
                if Room.only is not None and Room.only not in str(self.real.name):
                    return self.real.write(data)
                if Room.silent:
                    return None
                if Room.room is None:
                    return self.real.write(data)
                taken = min(len(data), Room.room)
                if taken == 0 and len(data):
                    raise OSError(28, "No space left on device")
                self.real.write(data[:taken])
                Room.room -= taken
                if taken < len(data) and Room.hostile:
                    raise OSError(28, "No space left on device")
                return taken

            def __getattr__(self, name):
                return getattr(self.real, name)

        real_fsync = os.fsync

        def broken_fsync(fd):
            raise OSError(5, "Input/output error")

        def meets(call):
            try:
                call()
            except OSError as e:
                return e
            return None

        sysex = bytes((0xF0, *(1 + i % 100 for i in range(10000)), 0xF7))
        full = fresh("full")
        rec = MidiRecorder(full, clock_from(T0), band[:2], {})
        notes_capture.open = lambda *a, **k: Room(builtins.open(*a, **k))
        try:
            Room.room = 0
            met = meets(lambda: rec.present("Keys", T0))
            Room.room = None
            ok("a file that cannot be made says so, leaves nothing behind, and is made the next time",
               met is not None and files(full) == [])
            rec.present("Keys", T0)
            rec.present("Drums", T0)
            rec.feed("Drums", T0 + 1 * S, b"\x99\x26\x50")
            Room.room = 0
            met = [meets(lambda: rec.flush()), meets(lambda: rec.feed("Drums", T0 + 1100 * MS, sysex))]
            Room.room = None
            ok("a flush the disk refuses, and a write too big for the buffer, are OSErrors", all(met))
            rec.feed("Drums", T0 + 1200 * MS, b"\x99\x2a\x40")
            os.fsync = broken_fsync
            try:
                met = meets(lambda: rec.flush())
            finally:
                os.fsync = real_fsync
            ok("so is a flush whose fsync the disk refuses", met is not None)
            rec.flush()
            rec.feed("Drums", T0 + 1300 * MS, b"\x99\x2c\x40")
        finally:
            del notes_capture.open
        made = rec.stop(3.0)
        ok("the recorder was usable after each: what the disk refused is in the .mid, and what is left held is let go",
           in_ticks(full / "Drums.mid") == [(1920, b"\x99\x26\x50"), (2112, sysex), (2304, b"\x99\x2a\x40"),
                                            (2496, b"\x99\x2c\x40"), (5760, b"\x89\x26\x00"),
                                            (5760, b"\x89\x2a\x00"), (5760, b"\x89\x2c\x00")])
        ok("and for both ports", [m["name"] for m in made] == ["Drums", "Keys"] and files(full) == ["Drums.mid", "Keys.mid"])

        # A write the disk takes in part must not leave a fragment for the next line to join. A full disk does
        # this, and says how much it took or, on some systems, only that it failed.
        whole = re.compile(r"t -?[0-9]+|s ([0-9a-f]{2})+|n -?[0-9]+ ([0-9a-f]{2})+|g -?[0-9]+")
        big = bytes((0xF0, *(1 + i % 100 for i in range(6000)), 0xF7))
        for hostile in (False, True):
            part = fresh(f"part{int(hostile)}")
            rec = MidiRecorder(part, clock_from(T0), [{"name": "Pad", "port": "Pad"}], {})
            notes_capture.open = lambda *a, **k: Room(builtins.open(*a, **k))
            try:
                rec.present("Pad", T0)
                Room.room, Room.hostile = 3000, hostile
                met = meets(lambda: rec.feed("Pad", T0 + 1 * S, big))
                Room.room = None
                rec.feed("Pad", T0 + 2 * S, b"\x90\x3c\x40")
                rec.flush()
            finally:
                del notes_capture.open
                Room.room, Room.hostile = None, False
            text = (part / "Pad.midraw").read_bytes().decode("ascii")
            how = "that says how much it took" if not hostile else "that only fails"
            ok("a write too big for a disk " + how + " is an OSError, and the file is whole lines",
               met is not None and text.endswith("\n") and all(whole.fullmatch(x) for x in text[:-1].split("\n")))
            rec.stop(3.0)
            ok("and the note after it is in the .mid, with the event it came after",
               read_events(part / "Pad.mid")[1]
               == [(1.0, big), (2.0, b"\x90\x3c\x40"), (3.0, b"\x80\x3c\x00")])

        # A file that answers None has taken nothing, and what it was given waits for the next try.
        silent = fresh("silent")
        rec = MidiRecorder(silent, clock_from(T0), [{"name": "Pad", "port": "Pad"}], {})
        notes_capture.open = lambda *a, **k: Room(builtins.open(*a, **k))
        try:
            rec.present("Pad", T0)
            Room.silent = True
            met = meets(lambda: rec.feed("Pad", T0 + 1 * S, big))
            Room.silent = False
            rec.feed("Pad", T0 + 2 * S, b"\x90\x3c\x40")
            rec.flush()
        finally:
            del notes_capture.open
            Room.silent = False
        rec.stop(3.0)
        ok("a write answered with None is a refusal, and nothing it was given is lost",
           met is not None and read_events(silent / "Pad.mid")[1]
           == [(1.0, big), (2.0, b"\x90\x3c\x40"), (3.0, b"\x80\x3c\x00")])

        # A take.clock the disk refuses for longer than the buffer holds: each mark is written once when it takes it.
        longrun = clock_from(T0)
        refused_clock = fresh("clockrefused")
        rec = MidiRecorder(refused_clock, longrun, [{"name": "Pad", "port": "Pad"}], {})
        notes_capture.open = lambda *a, **k: Room(builtins.open(*a, **k))
        try:
            blocks(longrun, 0, 100)
            rec.present("Pad", T0 + 2 * S)
            Room.room, Room.only = 0, CLOCK_FILE
            refusals = 0
            for k in range(1, 701):
                blocks(longrun, 100 + 47 * (k - 1), 100 + 47 * k)
                refusals += meets(lambda: rec.feed("Pad", T0 + (2 + k) * S, b"\x90\x3c\x40")) is not None
            Room.room = None
            rec.feed("Pad", T0 + 1000 * S, b"\x80\x3c\x00")
            rec.flush()
        finally:
            del notes_capture.open
            Room.room, Room.only = None, None
        frames = [f for _, f in load(refused_clock / CLOCK_FILE)]
        ok("a take.clock refused for longer than 8 KB of marks: every look meets it", refusals == 700)
        ok("and when the disk takes them, each kept mark is in take.clock once, the frames going up",
           len(frames) > 690 and frames == [f for _, f in longrun.marks()[:-1]] and frames == sorted(set(frames)))

        # A megabyte waiting: lines are dropped, and the call and the log say so, which they do not for a line that waits.
        capped = fresh("capped")
        rec = MidiRecorder(capped, clock_from(T0), [{"name": "Pad", "port": "Pad"}], {})
        huge = bytes((0xF0, *(1 + i % 100 for i in range(20000)), 0xF7))
        notes_capture.open = lambda *a, **k: Room(builtins.open(*a, **k))
        said_before = len(said6)
        try:
            rec.present("Pad", T0)
            Room.room = 0
            kinds = [type(meets(lambda: rec.feed("Pad", T0 + (1 + k) * 10 * MS, huge))) for k in range(40)]
            Room.room = None
            rec.feed("Pad", T0 + 2 * S, b"\x90\x3c\x40")
            rec.flush()
        finally:
            del notes_capture.open
            Room.room = None
        queued = kinds.count(OSError)
        ok("a line that waits is a plain OSError; once a megabyte waits, a line dropped is a NotesDropped, and stays so",
           kinds[0] is OSError and kinds[-1] is NotesDropped and 20 < queued < 30
           and kinds == [OSError] * queued + [NotesDropped] * (40 - queued) and issubclass(NotesDropped, OSError))
        dropped_said = [r for r in said6[said_before:] if "dropped" in r.getMessage()]
        ok("and the log says so once for the file, not once for each line, at ERROR (R37)",
           len(dropped_said) == 1 and dropped_said[0].levelno == logging.ERROR and "Pad.midraw" in dropped_said[0].getMessage())
        rec.stop(3.0)
        notes_in = read_events(capped / "Pad.mid")[1]
        ok("the lines that waited are in the .mid once the disk takes them, the dropped ones are not, and the note after is",
           [d for _, d in notes_in].count(huge) == queued and (2.0, b"\x90\x3c\x40") in notes_in)

        # Keys struck again while down: a release for each strike (R29), not for the key.
        on, off = (lambda k: bytes((0x90, k, 64))), (lambda k: bytes((0x80, k, 0)))
        for label, played_at, goes, want in (
                ("a key struck twice and let go twice keeps both releases and has none to add",
                 [(1000, on(60)), (1100, on(60)), (1200, off(60)), (1300, off(60))], None,
                 [(1920, on(60)), (2112, on(60)), (2304, off(60)), (2496, off(60))]),
                ("one struck twice and let go once is let go once more at the end",
                 [(1000, on(60)), (1100, on(60)), (1200, off(60))], None,
                 [(1920, on(60)), (2112, on(60)), (2304, off(60)), (5760, off(60))]),
                ("one struck twice when its port goes is let go twice there, and a release after that is not kept",
                 [(1000, on(60)), (1100, on(60)), (1900, off(60))], 1500,
                 [(1920, on(60)), (2112, on(60)), (2880, off(60)), (2880, off(60))]),
                ("keys struck twice and once are let go as many times as struck, in the order first pressed",
                 [(1000, on(62)), (1100, on(60)), (1200, on(62)), (1300, on(62))], None,
                 [(1920, on(62)), (2112, on(60)), (2304, on(62)), (2496, on(62)),
                  (5760, off(62)), (5760, off(62)), (5760, off(62)), (5760, off(60))])):
            strikes = fresh(f"strikes{len(label)}")
            rec = MidiRecorder(strikes, clock_from(T0), [{"name": "Pad", "port": "Pad"}], {})
            rec.present("Pad", T0)
            for at, data in played_at:
                if goes is not None and at > goes:
                    rec.gone("Pad", T0 + goes * MS)
                    rec.present("Pad", T0 + (goes + 100) * MS)
                    goes = None
                rec.feed("Pad", T0 + at * MS, data)
            rec.stop(3.0)
            ok(label, in_ticks(strikes / "Pad.mid") == want)

        # Review: while a flush waits for the disk, or a stop for the conversion, the writer and the watcher
        # are not held up: the lock is let go of before either.
        waiting, let_go = threading.Event(), threading.Event()

        def slow_fsync(fd):
            waiting.set()
            let_go.wait(30)
            return real_fsync(fd)

        locks = fresh("locks")
        rec = MidiRecorder(locks, clock_from(T0), band[:2], {})
        rec.present("Drums", T0)
        rec.feed("Drums", T0 + 1 * S, b"\x99\x26\x50")
        outcome = {}

        def touches():
            rec.feed("Drums", T0 + 1100 * MS, b"\x89\x26\x00")
            rec.present("Keys", T0 + 1100 * MS)
            rec.gone("Keys", T0 + 1200 * MS)
            outcome["touched"] = True

        os.fsync = slow_fsync
        try:
            flusher = threading.Thread(target=lambda: outcome.setdefault("flush", meets(rec.flush)), daemon=True)
            flusher.start()
            asleep = waiting.wait(30)
            toucher = threading.Thread(target=touches, daemon=True)
            toucher.start()
            toucher.join(10)
            ok("a flush waiting on the disk does not hold up feed, present or gone",
               asleep and outcome.get("touched") is True and flusher.is_alive())
        finally:
            let_go.set()
            flusher.join(30)
            os.fsync = real_fsync
        ok("and finishes when the disk does, with no error", outcome.get("flush", "unset") is None)

        inside, go_on = threading.Event(), threading.Event()
        real_write = notes_capture.write_mid

        def slow_write(path, **kw):
            inside.set()
            go_on.wait(30)
            return real_write(path, **kw)

        answers = {}
        notes_capture.write_mid = slow_write
        try:
            first = threading.Thread(target=lambda: answers.setdefault("first", rec.stop(3.0)), daemon=True)
            first.start()
            busy_converting = inside.wait(30)
            outcome.clear()
            toucher = threading.Thread(
                target=lambda: (rec.feed("Drums", T0 + 1400 * MS, b"\x99\x2a\x40"), rec.present("Drums", T0),
                                rec.gone("Drums", T0), rec.flush(), outcome.setdefault("touched", True)), daemon=True)
            toucher.start()
            toucher.join(10)
            second = threading.Thread(target=lambda: answers.setdefault("second", rec.stop(3.0)), daemon=True)
            second.start()
            second.join(0.3)
            ok("while stop converts, feed, present, gone and flush are answered at once, and ignored",
               busy_converting and outcome.get("touched") is True)
            ok("and a second stop waits for the first", second.is_alive() and "first" not in answers)
        finally:
            go_on.set()
            first.join(30)
            second.join(30)
            notes_capture.write_mid = real_write
        ok("then gives the first one's answer",
           answers.get("first") == answers.get("second") and [m["name"] for m in answers.get("first", [])] == ["Drums", "Keys"])
        ok("and what was fed while it converted is not in the file",
           in_ticks(locks / "Drums.mid") == [(1920, b"\x99\x26\x50"), (2112, b"\x89\x26\x00")])

        # Review focus: the writer thread feeds while the watcher thread comes and goes and flushes (R26).
        busy = fresh("busy")
        rec = MidiRecorder(busy, clock_from(T0), [{"name": "A", "port": "A"}, {"name": "B", "port": "B"}], {})
        rec.present("A", T0)
        rec.present("B", T0)
        errors, finished = [], threading.Event()

        def writer():
            try:
                for i in range(20000):
                    rec.feed("A" if i % 2 else "B", T0 + i * 1000, b"\x90\x3c\x40" if i % 4 < 2 else b"\x80\x3c\x00")
            except Exception as e:
                errors.append("feed " + repr(e))
            finally:
                finished.set()

        def watcher():
            try:
                for i in range(40):
                    rec.gone("A", T0 + i * 500_000)
                    rec.present("A", T0 + i * 500_000)
                    rec.flush()
                    if finished.is_set():
                        break
            except Exception as e:
                errors.append("watch " + repr(e))

        interval = sys.getswitchinterval()
        sys.setswitchinterval(1e-6)
        try:
            threads = [threading.Thread(target=writer, daemon=True), threading.Thread(target=watcher, daemon=True)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(60)
        finally:
            sys.setswitchinterval(interval)
        ok("both threads finish within a minute, with no error", not any(t.is_alive() for t in threads) and errors == [])
        rec.flush()
        line = re.compile(r"t -?[0-9]+|s ([0-9a-f]{2})+|n -?[0-9]+ ([0-9a-f]{2})+|g -?[0-9]+")
        texts = [(busy / f"{n}{MIDRAW_SUFFIX}").read_bytes().decode("ascii") for n in "AB"]
        ok("what reached each file is whole lines, none cut or mixed with another's",
           all(t.endswith("\n") and all(line.fullmatch(x) for x in t[:-1].split("\n")) for t in texts))
        ok("every event fed to B while it was there is in its file", texts[1].count("\nn ") == 10000)
        rec.stop(1.0)
        ok("and stop makes both files", files(busy) == ["A.mid", "B.mid"])

    capture_source = Path(sys.modules[MidiRecorder.__module__].__file__).read_text(encoding="utf-8")
    capture_imports = {n.names[0].name if isinstance(n, ast.Import) else n.module
                       for n in ast.walk(ast.parse(capture_source)) if isinstance(n, (ast.Import, ast.ImportFrom))}
    ok("the recorder goes through smf for the .mid and never imports mido", "mido" not in capture_imports)

    print("\n[7] The rehearsal's ports")
    said7 = []  # what the rig says to the log, so that it is checked and not printed
    catcher7 = logging.Handler(level=logging.INFO)
    catcher7.emit = said7.append
    logging.getLogger(rig_mod.__name__).addHandler(catcher7)
    TICK = int(rig_mod.TICK_SEC * S)
    now = [100 * S]  # the rig's clock, which the checks move

    gtr = {"name": "Gtr", "channel": 1}
    drums = {"name": "Drums", "mode": "both", "channel": 2, "midi_port": {"name": "TD-17"}}
    keys = {"name": "Keys", "mode": "midi", "channel": None, "midi_port": {"name": "Launchkey Mini MK3"}}
    synth = {"name": "Synth", "mode": "midi", "channel": None, "midi_port": {"name": "Nord Stage 3 MIDI"}}
    td17 = PortInfo("TD-17", "TD-17", "Roland")
    launchkey = PortInfo("Launchkey Mini MK3", "Launchkey Mini MK3", "Novation")
    nord = PortInfo("Nord Stage 3 MIDI", "Nord Stage 3", "Clavia")

    def a_rig(*plugged):
        fake = FakePortSystem(list(plugged))
        return fake, MidiRig(fake, threads=False, now_ns=lambda: now[0])

    def open_now(fake):
        return sorted(port.info.name for port in fake.open_ports)

    def take_clock(t):
        c = AudioClock(SR)
        c.started_ns = t
        return c

    heard = []  # what the take's recorder was asked, in order

    class Spy(MidiRecorder):
        """The take's recorder, which says what it is asked before doing it."""

        def present(self, name, ns):
            heard.append(("present", name, ns))
            return super().present(name, ns)

        def feed(self, name, ns, data):
            heard.append(("feed", name, ns, bytes(data)))
            return super().feed(name, ns, data)

        def gone(self, name, ns):
            heard.append(("gone", name, ns))
            return super().gone(name, ns)

        def flush(self):
            heard.append(("flush",))
            return super().flush()

    def told(name):
        """What the recorder was asked about one track: (what, when)."""
        return [(call[0], call[2]) for call in heard if call[0] != "flush" and call[1] == name]

    real_recorder = rig_mod.MidiRecorder
    rig_mod.MidiRecorder = Spy
    try:
        with tempfile.TemporaryDirectory() as tmp7:
            def folder(name):
                made = Path(tmp7) / name
                made.mkdir()
                return made

            def files_in(path):
                return sorted(p.name for p in path.iterdir())

            # A port that is there and one that is not yet (D7).
            fake, rig = a_rig(td17)
            rig.use([gtr, drums, keys])
            act = rig.activity()
            ok("Drums on TD-17, which is plugged in, is ok and connected",
               act["Drums"]["state"] == "ok" and act["Drums"]["connected"] is True)
            ok("Keys on a Launchkey that is not plugged in is missing and not connected, and stops nothing (D7)",
               act["Keys"]["state"] == "missing" and act["Keys"]["connected"] is False)
            ok("a track that only records audio is not the rig's, and only TD-17 is open",
               sorted(act) == ["Drums", "Keys"] and open_now(fake) == ["TD-17"])
            fake.send("TD-17", now[0] + 10 * MS, b"\x99\x26\x64")
            rig.drain()
            act = rig.activity()
            ok("a note-on at velocity 100 is one note, and the meter shows 100/127",
               act["Drums"]["notes"] == 1 and act["Drums"]["vel"] == 100 / 127 and act["Keys"]["notes"] == 0)
            act = rig.activity()
            ok("read again, the meter is back at 0 and the count stays",
               act["Drums"]["vel"] == 0 and act["Drums"]["notes"] == 1)
            fake.send("TD-17", now[0] + 20 * MS, b"\x89\x26\x00")
            fake.send("TD-17", now[0] + 30 * MS, b"\x99\x26\x00")
            rig.drain()
            ok("a note-off, and a note-on at velocity 0, are not notes", rig.activity()["Drums"]["notes"] == 1)
            ok("ports() names the system and lists each port with the notes it sent, and no error",
               rig.ports() == {"system": "Fake MIDI", "error": None,
                               "ports": [{"name": "TD-17", "device": "TD-17", "maker": "Roland", "notes": 1}]})

            # A port plugged in during a take records from then on (D7, P4).
            one = folder("one")
            T1 = now[0] = 110 * S
            rig.begin_take(one, take_clock(T1))
            ok("the counts start again when a take begins",
               rig.activity()["Drums"]["notes"] == 0 and rig.ports()["ports"][0]["notes"] == 0)
            fake.plug(launchkey)
            now[0] += TICK
            rig.tick()
            ok("the Launchkey plugged in mid-take is opened at the next tick, and Keys is ok (D7, P4)",
               rig.activity()["Keys"]["state"] == "ok" and open_now(fake) == ["Launchkey Mini MK3", "TD-17"])
            fake.send("Launchkey Mini MK3", T1 + 500 * MS, b"\x90\x3c\x50")
            fake.send("Launchkey Mini MK3", T1 + 750 * MS, b"\x80\x3c\x00")
            fake.send("TD-17", T1 + 1 * S, b"\x99\x26\x40")
            made = rig.end_take(3.0)                                # what is still on the queue is written first
            ok("end_take lists Drums and Keys, each with the port it was saved with",
               made == [{"name": "Drums", "file": str(one / "Drums.mid"), "port": "TD-17"},
                        {"name": "Keys", "file": str(one / "Keys.mid"), "port": "Launchkey Mini MK3"}])
            ok("Keys has what was played on it once it was there",
               in_ticks(one / "Keys.mid") == [(960, b"\x90\x3c\x50"), (1440, b"\x80\x3c\x00")])
            ok("and Drums its note, let go when the take stopped (F7)",
               in_ticks(one / "Drums.mid") == [(1920, b"\x99\x26\x40"), (5760, b"\x89\x26\x00")])

            # What was set between two takes (F6), and a port pulled mid-take and plugged back.
            fake.send("TD-17", 112 * S, b"\xb9\x04\x5a")           # the hi-hat pedal half down
            rig.drain()
            fake.send("TD-17", 119 * S, b"\xb9\x07\x64")           # the volume, still on the queue at Start
            two = folder("two")
            T2 = now[0] = 120 * S
            heard.clear()
            rig.begin_take(two, take_clock(T2))
            fake.send("TD-17", T2 + 500 * MS, b"\x99\x2a\x40")      # 42, held
            fake.send("TD-17", T2 + 800 * MS, b"\xb9\x04\x14")      # the pedal: the last the port said
            now[0] = T2 + 900 * MS
            fake.pull("TD-17")                                     # with its events still on the queue
            rig.tick()
            rig.drain()
            ok("pulled mid-take, Drums is missing and its port is closed",
               rig.activity()["Drums"]["state"] == "missing" and "TD-17" not in open_now(fake))
            ok("and nothing it would send is heard", fake.send("TD-17", T2 + 950 * MS, b"\x99\x2b\x40") is False)
            now[0] = T2 + 1 * S
            fake.plug(td17)
            rig.tick()
            ok("plugged back, it is opened again and Drums is ok",
               rig.activity()["Drums"]["state"] == "ok" and fake.opens["TD-17"] == 2)
            fake.send("TD-17", T2 + 1500 * MS, b"\x99\x28\x40")     # 40
            rig.drain()
            ok("the recorder was told in order: present at Start (the event that was on the queue then is in the "
               "state it begins from), the events, gone when the port was last heard, after its events, present "
               "again, the next event (R33)",
               told("Drums") == [("present", T2), ("feed", T2 + 500 * MS), ("feed", T2 + 800 * MS),
                                 ("gone", T2 + 800 * MS), ("present", T2 + 1 * S), ("feed", T2 + 1500 * MS)])
            made = rig.end_take(3.0)
            ok("a port pulled and plugged back is one file", files_in(two) == ["Drums.mid", "Keys.mid"]
               and [m["name"] for m in made] == ["Drums", "Keys"])
            kit = in_ticks(two / "Drums.mid")
            ok("the take begins with the pedal as it was sent between the takes, and the volume sent as it began (F6)",
               kit[:2] == [(0, b"\xb9\x04\x5a"), (0, b"\xb9\x07\x64")])
            ok("42 is let go when the port was last heard before the pull, and 40 after the replug is there (F7)",
               kit[2:] == [(960, b"\x99\x2a\x40"), (1536, b"\xb9\x04\x14"), (1536, b"\x89\x2a\x00"),
                           (2880, b"\x99\x28\x40"), (5760, b"\x89\x28\x00")])
            ok("Keys, there all along and silent, has its .mid with no notes (F5)", in_ticks(two / "Keys.mid") == [])

            now[0] = 130 * S
            fake.pull("TD-17")
            fake.plug(td17)
            rig.tick()
            ok("pulled and plugged back between two ticks, the port is opened again, once",
               rig.activity()["Drums"]["state"] == "ok" and fake.opens["TD-17"] == 3
               and open_now(fake).count("TD-17") == 1)

            # Busy, alike, and no system (P5, P1).
            busy_fake, busy = a_rig(td17)
            busy_fake.refuse.add("TD-17")
            busy.use([gtr, drums])
            act = busy.activity()["Drums"]
            ok("a port another app holds is in use and not connected, and Start is not stopped (P5)",
               act["state"] == "in_use" and act["connected"] is False and notes_problem([gtr, drums]) is None)
            busy_take = folder("busy")
            busy.begin_take(busy_take, take_clock(now[0]))
            ok("a take begins and ends without it, and has no notes file for it (F5)",
               busy.end_take(1.0) == [] and files_in(busy_take) == [])
            busy_fake.refuse.clear()
            for _ in range(4):
                now[0] += TICK
                busy.tick()
            ok("once the other app lets go of it, the rig's next look opens it", busy.activity()["Drums"]["state"] == "ok")

            alike_fake, alike = a_rig(td17, td17)
            alike.use([gtr, drums])
            act = alike.activity()["Drums"]
            ok("two ports that nothing tells apart: ambiguous, not connected, and neither opened (P1)",
               act["state"] == "ambiguous" and act["connected"] is False and alike_fake.open_ports == set())

            nothing = MidiRig(None, "MIDI is not available: test", threads=False, now_ns=lambda: now[0])
            ok("with no MIDI system, ports() says why and lists nothing",
               nothing.ports() == {"system": None, "ports": [], "error": "MIDI is not available: test"})
            nothing.use([gtr, drums, {**keys, "midi_port": None}])
            act = nothing.activity()
            ok("and a track with a port is missing, one with none is none, neither connected",
               (act["Drums"]["state"], act["Drums"]["connected"], act["Keys"]["state"], act["Keys"]["connected"])
               == ("missing", False, "none", False))
            nothing_take = folder("nothing")
            nothing.begin_take(nothing_take, take_clock(now[0]))
            nothing.tick()
            ok("a take with it records no notes, and nothing raises",
               nothing.end_take(1.0) == [] and files_in(nothing_take) == [])
            nothing.shutdown()

            # Active sensing: a device behind an interface switched off (F7, R32).
            sense_fake, sense = a_rig(td17, launchkey)
            sense.use([gtr, drums, keys])
            sensing = folder("sensing")
            T3 = now[0] = 300 * S
            heard.clear()
            sense.begin_take(sensing, take_clock(T3))
            for at, data in ((0, b"\xfe"), (250, b"\xfe"), (300, b"\x99\x26\x40"), (500, b"\xfe"), (750, b"\xfe")):
                sense_fake.send("TD-17", T3 + at * MS, data)
            sense_fake.send("Launchkey Mini MK3", T3 + 100 * MS, b"\x90\x3c\x40")
            sense.drain()
            sense_fake.send("TD-17", T3 + 1 * S, b"\xfe")            # heard, and not yet drained
            now[0] = T3 + 1300 * MS
            sense.tick()
            ok("300 ms after the last active sensing the TD-17 is still there", sense.activity()["Drums"]["state"] == "ok")
            now[0] = T3 + 1400 * MS
            sense.tick()
            act = sense.activity()
            ok("400 ms after it, it counts as gone: missing and not connected (F7)",
               act["Drums"]["state"] == "missing" and act["Drums"]["connected"] is False)
            ok("a port that never sent active sensing is not gone for saying nothing", act["Keys"]["state"] == "ok")
            sense.drain()
            sense_fake.send("TD-17", T3 + 2 * S, b"\xfe")
            sense.drain()
            ok("heard again, it is ok", sense.activity()["Drums"]["state"] == "ok")
            sense_fake.send("TD-17", T3 + 2100 * MS, b"\x99\x24\x40")
            sense_fake.send("TD-17", T3 + 2250 * MS, b"\xfe")
            sense_fake.send("TD-17", T3 + 2500 * MS, b"\xfe")
            now[0] = T3 + 2700 * MS
            sense.tick()
            ok("a port whose events wait on the queue is not quiet: it is when it was last heard that counts",
               sense.activity()["Drums"]["state"] == "ok")
            sense.drain()
            sense.end_take(3.0)
            later = folder("sensing-later")
            now[0] = T3 + 10 * S
            sense.tick()
            sense.begin_take(later, take_clock(now[0]))
            ok("a take that begins while the TD-17 is quiet has no file for it until it is heard (F5)",
               [m["name"] for m in sense.end_take(1.0)] == ["Keys"])
            ok("38 is let go at the last active sensing, and 36 played after it came back is there",
               in_ticks(sensing / "Drums.mid") == [(576, b"\x99\x26\x40"), (1920, b"\x89\x26\x00"),
                                                     (4032, b"\x99\x24\x40"), (5760, b"\x89\x24\x00")])
            ok("the recorder was told gone at the last sensing and present when heard again, and never handed "
               "an active sensing (R32)",
               told("Drums") == [("present", T3), ("feed", T3 + 300 * MS), ("gone", T3 + 1 * S),
                                 ("present", T3 + 2 * S), ("feed", T3 + 2100 * MS)]
               and not any(call[0] == "feed" and call[3] == b"\xfe" for call in heard))

            # The same notes on two ports (P8).
            twice_fake, twice = a_rig(launchkey, nord)
            twice.use([gtr, keys, synth])

            def both_ports(start, times, gap, nord_first=False, nord_velocity=100):
                """The same notes on the Launchkey and the Nord, `gap` apart, one note every 200 ms."""
                for i in range(times):
                    at = start + i * 200 * MS
                    sent = {"Launchkey Mini MK3": bytes((0x90, 60 + i, 100)),
                            "Nord Stage 3 MIDI": bytes((0x90, 60 + i, nord_velocity))}
                    order = sorted(sent, reverse=nord_first)
                    twice_fake.send(order[0], at, sent[order[0]])
                    twice_fake.send(order[1], at + gap, sent[order[1]])
                twice.drain()

            both_ports(400 * S, 3, 2 * MS)
            ok("the same note at the same velocity within 2 ms, three times, is not yet the same notes twice",
               "echo" not in twice.activity()["Synth"])
            both_ports(401 * S, 1, 2 * MS)
            act = twice.activity()
            ok("the fourth time Synth's card names Keys, and Keys' card names nobody (P8)",
               act["Synth"].get("echo") == "Keys" and "echo" not in act["Keys"])
            twice.reset_counts()
            act = twice.activity()
            ok("reset_counts starts the counts again, and the echo with them",
               "echo" not in act["Synth"] and act["Keys"]["notes"] == 0 and twice.ports()["ports"][0]["notes"] == 0)
            both_ports(410 * S, 4, 6 * MS)
            ok("6 ms apart, four times, is not the same notes", "echo" not in twice.activity()["Synth"])
            both_ports(420 * S, 4, 1 * MS, nord_velocity=99)
            both_ports(430 * S, 4, 1 * MS, nord_first=True, nord_velocity=101)
            ok("nor are notes whose velocities differ", "echo" not in twice.activity()["Synth"])
            twice.reset_counts()
            both_ports(440 * S, 4, 2 * MS, nord_first=True)
            ok("whichever port is a hair faster, the later card in the band names the first",
               twice.activity()["Synth"].get("echo") == "Keys")
            twice.reset_counts()
            echo_take = folder("echo")
            twice.begin_take(echo_take, take_clock(450 * S))
            both_ports(450 * S, 4, 2 * MS)
            ok("while a take records the notes are not compared", "echo" not in twice.activity()["Synth"])
            twice.end_take(1.0)

            # A device's other ports during the check (P7).
            midi_port = PortInfo("Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3", "Novation")
            daw_port = PortInfo("Launchkey Mini MK3 DAW Port", "Launchkey Mini MK3", "Novation")
            check_fake, check = a_rig(daw_port, midi_port, td17)
            on_daw = {**keys, "midi_port": daw_port.saved()}
            check.use([gtr, on_daw], check=True)
            ok("checking Keys on the DAW Port opens it and the device's MIDI Port, and nothing else (P7)",
               open_now(check_fake) == ["Launchkey Mini MK3 DAW Port", "Launchkey Mini MK3 MIDI Port"])
            for i in range(3):
                check_fake.send("Launchkey Mini MK3 MIDI Port", 500 * S + i * 100 * MS, b"\x90\x3c\x40")
            check.drain()
            ok("notes played on the MIDI Port are counted on it, and not on the DAW Port, listed after it",
               [(p["name"], p["notes"]) for p in check.ports()["ports"]] ==
               [("Launchkey Mini MK3 MIDI Port", 3), ("Launchkey Mini MK3 DAW Port", 0), ("TD-17", 0)])
            ok("and Keys, on the DAW Port, has heard none", check.activity()["Keys"]["notes"] == 0)
            check.use([gtr, on_daw])
            ok("when the check ends the MIDI Port is closed, and the DAW Port stays open, opened once",
               open_now(check_fake) == ["Launchkey Mini MK3 DAW Port"]
               and check_fake.opens["Launchkey Mini MK3 DAW Port"] == 1)
            check.use([gtr, on_daw], check=True)
            check_take = folder("check")
            check.begin_take(check_take, take_clock(510 * S))
            ok("and when a take begins", open_now(check_fake) == ["Launchkey Mini MK3 DAW Port"])
            check.end_take(1.0)

            # The flush, the clocks, and a track set back to Audio.
            flushing = folder("flushing")
            T4 = now[0] = 600 * S
            heard.clear()
            rig.begin_take(flushing, take_clock(T4))
            fake.send("TD-17", T4 + 500 * MS, b"\x99\x26\x40")
            rig.drain()
            resyncs = {port.info.name: port.resyncs for port in fake.open_ports}
            flushes, on_disk = [], []
            for k in range(1, 61):
                now[0] = T4 + k * S
                rig.tick()
                flushes.append(heard.count(("flush",)))
                on_disk.append(f"n {T4 + 500 * MS} 99264" in (flushing / "Drums.midraw").read_text("ascii"))
            ok("a take's notes are flushed every 30 seconds of ticks, as the audio is",
               flushes[28] == 0 and flushes[29] == 1 and flushes[58] == 1 and flushes[59] == 2)
            ok("and what was played is on disk from the first flush", not on_disk[28] and on_disk[29])
            ok("every open port's clock is measured again every fourth tick",
               all(port.resyncs - resyncs[port.info.name] == 15 for port in fake.open_ports))
            rig.end_take(60.0)
            leaving = next(port for port in fake.open_ports if port.info.name == "Launchkey Mini MK3")
            rig.use([gtr, drums, {**keys, "mode": "audio"}])
            ok("Keys set back to Audio: its port is closed and it is no longer the rig's",
               open_now(fake) == ["TD-17"] and "Keys" not in rig.activity())
            leaving.on_event(T4 + 61 * S, b"\x90\x3c\x40")         # a port's thread that outlived its closing
            rig.drain()
            ok("and what a closed port says after its closing is not heard",
               [p["notes"] for p in rig.ports()["ports"] if p["name"] == "Launchkey Mini MK3"] == [0])

            # A band changed while a take records.
            moving = folder("moving")
            T5 = now[0] = 700 * S
            heard.clear()
            rig.use([gtr, drums, keys])
            rig.begin_take(moving, take_clock(T5))
            fake.send("Launchkey Mini MK3", T5 + 500 * MS, b"\x90\x3c\x40")
            rig.drain()
            fake.plug(nord)
            now[0] = T5 + 1 * S
            rig.use([gtr, drums, {**keys, "midi_port": nord.saved()}])
            fake.send("Nord Stage 3 MIDI", T5 + 1500 * MS, b"\x90\x3e\x40")
            rig.drain()
            made = rig.end_take(3.0)
            ok("Keys moved to another port mid-take: the old one is closed, the new one open",
               open_now(fake) == ["Nord Stage 3 MIDI", "TD-17"])
            ok("and Keys is one file, what it held let go when its port changed, not when it was last heard",
               [m["name"] for m in made] == ["Drums", "Keys"]
               and in_ticks(moving / "Keys.mid") == [(960, b"\x90\x3c\x40"), (1920, b"\x80\x3c\x00"),
                                                     (2880, b"\x90\x3e\x40"), (5760, b"\x80\x3e\x00")])

            # A burst between takes.
            rig.reset_counts()
            for i in range(10000):
                fake.send("TD-17", 800 * S + i * 100_000, bytes((0x99, i % 128, 1 + i % 127)))
            began = time.perf_counter()
            rig.drain()
            spent = time.perf_counter() - began
            ok("10000 notes from one port in one drain are all counted, quickly (a limit only a hang would pass)",
               rig.activity()["Drums"]["notes"] == 10000 and spent < 10
               and [p["notes"] for p in rig.ports()["ports"] if p["name"] == "TD-17"] == [10000])
            ok("all of that was done without a word in the log", said7 == [])

            # Review focus 4: a disk that refuses the take's notes.
            refused = {"present": {"Keys"}}

            class Refusing(MidiRecorder):
                """Refuses Keys' first present, and every line of Drums: half as if waiting, half dropped."""

                def present(self, name, ns):
                    if name in refused["present"]:
                        refused["present"].discard(name)
                        raise OSError(28, "No space left on device")
                    return super().present(name, ns)

                def feed(self, name, ns, data):
                    if name == "Drums":
                        raise (NotesDropped if ns % 2 else OSError)(28, "No space left on device")
                    return super().feed(name, ns, data)

            rig_mod.MidiRecorder = Refusing
            full = folder("full")
            T6 = now[0] = 900 * S
            rig.begin_take(full, take_clock(T6))
            rig.drain()
            for i in range(10):
                fake.send("TD-17", T6 + i * 100 * MS + i % 2, b"\x99\x26\x40")
                fake.send("Nord Stage 3 MIDI", T6 + i * 100 * MS, b"\x90\x3c\x40")
                fake.send("Nord Stage 3 MIDI", T6 + i * 100 * MS + 50 * MS, b"\x80\x3c\x00")
            rig.drain()
            act = rig.activity()
            ok("the writer goes on through a disk that refuses, and the counts go on",
               act["Drums"]["notes"] == 10 and act["Keys"]["notes"] == 10)
            made = rig.end_take(3.0)
            ok("Stop keeps what can still be made: Drums' file with no notes, and Keys' with every one, "
               "its present tried again",
               [m["name"] for m in made] == ["Drums", "Keys"]
               and not any(d[0] & 0xF0 == 0x90 for _, d in in_ticks(full / "Drums.mid"))
               and len(in_ticks(full / "Keys.mid")) == 20)
            ok("and the trouble is said once in the log, as an error the app's log keeps",
               len(said7) == 1 and said7[0].levelno == logging.ERROR)

            class Unfinished(MidiRecorder):
                def stop(self, duration_sec):
                    # A real stop lets go of its files before anything that can
                    # fail; Windows would not let the folder go otherwise.
                    self.abandon()
                    raise OSError(5, "Input/output error")

            rig_mod.MidiRecorder = Unfinished
            rig.begin_take(folder("unfinished"), take_clock(now[0]))
            ok("a stop that fails gives no notes, and is said in the log",
               rig.end_take(1.0) == [] and len(said7) == 2)
            rig_mod.MidiRecorder = Spy
            rig.shutdown()
            ok("shutdown closes every port and the system", fake.open_ports == set() and fake.inputs() == [])

            # A port belongs to itself, not to the name of the track it feeds (R36). First on a
            # system that lets a port be opened once, as classic Windows MIDI does (P5, P7).
            on_midi = {**keys, "midi_port": midi_port.saved()}
            one_fake = FakePortSystem([daw_port, midi_port], exclusive=True)
            once = MidiRig(one_fake, threads=False, now_ns=lambda: now[0])
            once.use([gtr, on_daw], check=True)
            for i in range(2):
                one_fake.send("Launchkey Mini MK3 MIDI Port", 1000 * S + i * 100 * MS, b"\x90\x3c\x40")
            once.drain()
            ok("where a port opens once, the check still opens the DAW Port and counts the MIDI Port",
               open_now(one_fake) == ["Launchkey Mini MK3 DAW Port", "Launchkey Mini MK3 MIDI Port"]
               and [p["notes"] for p in once.ports()["ports"]] == [2, 0])
            once.use([gtr, on_midi], check=True)
            ok("picking the port the check heard keeps it open, now Keys': ok, and opened once",
               once.activity()["Keys"]["state"] == "ok" and one_fake.opens["Launchkey Mini MK3 MIDI Port"] == 1
               and open_now(one_fake) == ["Launchkey Mini MK3 DAW Port", "Launchkey Mini MK3 MIDI Port"])
            once.use([gtr, on_daw], check=True)
            ok("and picking the DAW Port back takes it as it is, still open, opened once",
               once.activity()["Keys"]["state"] == "ok" and one_fake.opens["Launchkey Mini MK3 DAW Port"] == 1)
            once.use([gtr, on_midi], check=True)
            once.use([gtr, on_midi])
            ok("at Start the DAW Port closes and Keys is ok on the one port open",
               once.activity()["Keys"]["state"] == "ok" and open_now(one_fake) == ["Launchkey Mini MK3 MIDI Port"])
            picked = folder("picked")
            T7 = now[0] = 1010 * S
            once.begin_take(picked, take_clock(T7))
            one_fake.send("Launchkey Mini MK3 MIDI Port", T7 + 200 * MS, b"\x90\x3c\x40")
            ok("and a note played right after Start is in the take",
               [m["name"] for m in once.end_take(1.0)] == ["Keys"]
               and in_ticks(picked / "Keys.mid") == [(384, b"\x90\x3c\x40"), (1920, b"\x80\x3c\x00")])
            straight_fake = FakePortSystem([daw_port, midi_port], exclusive=True)
            straight = MidiRig(straight_fake, threads=False, now_ns=lambda: now[0])
            straight.use([gtr, on_daw], check=True)
            straight.use([gtr, on_midi])
            ok("picked and started at once, the port the check held is Keys' and ok, opened once",
               straight.activity()["Keys"]["state"] == "ok" and straight_fake.opens["Launchkey Mini MK3 MIDI Port"] == 1
               and open_now(straight_fake) == ["Launchkey Mini MK3 MIDI Port"])

            # Renamed, and two that swap names: the ports stay open and keep what was set (F6, R36).
            named_fake, named = a_rig(td17, launchkey)
            named.use([gtr, drums, keys])
            named_fake.send("TD-17", 1100 * S, b"\xc9\x05")          # kit 6 picked
            named_fake.send("TD-17", 1100 * S, b"\xb9\x04\x5a")      # the hi-hat half down
            named_fake.send("Launchkey Mini MK3", 1100 * S, b"\xc0\x07")
            named.drain()
            kit_track = {**drums, "name": "Kit"}
            named.use([gtr, kit_track, keys])
            act = named.activity()
            ok("a track renamed on the same port keeps the port open: opened once, and Kit is ok",
               named_fake.opens["TD-17"] == 1 and act["Kit"]["state"] == "ok" and "Drums" not in act)
            renamed = folder("renamed")
            T8 = now[0] = 1110 * S
            named.begin_take(renamed, take_clock(T8))
            named.end_take(1.0)
            ok("and the next take's Kit.mid begins with the kit and the pedal set before the rename (F6)",
               in_ticks(renamed / "Kit.mid") == [(0, b"\xc9\x05"), (0, b"\xb9\x04\x5a")])
            swapped = folder("swapped")
            named.use([gtr, {**kit_track, "midi_port": {"name": "Launchkey Mini MK3"}},
                       {**keys, "midi_port": {"name": "TD-17"}}])
            named.begin_take(swapped, take_clock(T8 + 10 * S))
            named.end_take(1.0)
            ok("two tracks that swap ports open nothing again, and each takes the state of the port it now has",
               named_fake.opens == {"TD-17": 1, "Launchkey Mini MK3": 1}
               and in_ticks(swapped / "Keys.mid") == [(0, b"\xc9\x05"), (0, b"\xb9\x04\x5a")]
               and in_ticks(swapped / "Kit.mid") == [(0, b"\xc0\x07")])

            # A track whose port is not there as the take begins starts from what that
            # port set, and not from what its old port did (F6, R36).
            away_fake, away = a_rig(td17, launchkey)
            away.use([gtr, drums, keys])
            T12 = now[0] = 1600 * S
            away_fake.send("Launchkey Mini MK3", T12, b"\xc0\x07")         # program 8 on the Launchkey
            away_fake.send("Launchkey Mini MK3", T12, b"\xb0\x07\x00")     # and its volume at 0
            away_fake.send("TD-17", T12, b"\xc9\x05")
            away.drain()
            away.use([gtr, drums, {**keys, "midi_port": {"name": "Nord Stage 3 MIDI"}}])  # not plugged in
            repicked = folder("repicked")
            now[0] = T12 + 1 * S
            away.begin_take(repicked, take_clock(now[0]))
            away_fake.plug(nord)
            away.tick()
            away_fake.send("Nord Stage 3 MIDI", now[0] + 200 * MS, b"\x90\x3c\x40")
            away.drain()
            away.end_take(1.0)
            ok("a track re-picked to a port not plugged in starts from that port, not from the one it had",
               in_ticks(repicked / "Keys.mid") == [(384, b"\x90\x3c\x40"), (1920, b"\x80\x3c\x00")])
            away_fake.send("Nord Stage 3 MIDI", now[0] + 2 * S, b"\xc1\x10")
            away.drain()
            away_fake.pull("TD-17")
            away.tick()
            away.drain()
            away.use([gtr, {**drums, "midi_port": {"name": "Nord Stage 3 MIDI"}},
                      {**keys, "midi_port": {"name": "TD-17"}}])
            crossed = folder("crossed")
            now[0] += 3 * S
            away.begin_take(crossed, take_clock(now[0]))
            away_fake.plug(td17)
            away.tick()
            away_fake.send("TD-17", now[0] + 200 * MS, b"\x99\x26\x40")
            away.drain()
            away.end_take(1.0)
            ok("two tracks that swap ports, one of them not plugged in, each start from the port it now has",
               in_ticks(crossed / "Drums.mid") == [(0, b"\xc1\x10")]
               and in_ticks(crossed / "Keys.mid") == [(0, b"\xc9\x05"), (384, b"\x99\x26\x40"),
                                                      (1920, b"\x89\x26\x00")])

            # Renamed while its port is not plugged in: the port's state is still the track's (F6).
            pulled_fake, pulled_rig = a_rig(td17)
            pulled_rig.use([gtr, drums])
            T13 = now[0] = 1700 * S
            pulled_fake.send("TD-17", T13, b"\xc9\x05")
            pulled_rig.drain()
            pulled_fake.pull("TD-17")
            pulled_rig.tick()
            pulled_rig.drain()
            pulled_rig.use([gtr, {**drums, "name": "Kit"}])
            absent = folder("renamed-absent")
            now[0] = T13 + 1 * S
            pulled_rig.begin_take(absent, take_clock(now[0]))
            pulled_fake.plug(td17)
            pulled_rig.tick()
            pulled_fake.send("TD-17", now[0] + 200 * MS, b"\x99\x26\x40")
            pulled_rig.drain()
            pulled_rig.end_take(1.0)
            ok("a track renamed while its port is not plugged in still starts from that port's state",
               in_ticks(absent / "Kit.mid") == [(0, b"\xc9\x05"), (384, b"\x99\x26\x40"), (1920, b"\x89\x26\x00")])

            # An event still waiting on the queue as the band changes and Start is
            # pressed is where the take begins from (F6).
            waiting_events = []
            for rename in (False, True):
                queued_fake, queued = a_rig(td17)
                queued.use([gtr, drums])
                queued.drain()
                T14 = now[0] = 1800 * S
                queued_fake.send("TD-17", T14 - 10 * MS, b"\xb9\x07\x40")   # the volume, not yet written
                queued.use([gtr, {**drums, "name": "Kit" if rename else "Drums"}])
                inflight = folder("inflight-kit" if rename else "inflight")
                queued.begin_take(inflight, take_clock(T14))
                queued_fake.send("TD-17", T14 + 100 * MS, b"\x99\x26\x40")
                queued.drain()
                queued.end_take(1.0)
                waiting_events.append(in_ticks(inflight / ("Kit.mid" if rename else "Drums.mid")))
            ok("an event still waiting as Start is pressed is in the take's start, renamed or not",
               waiting_events == [[(0, b"\xb9\x07\x40"), (192, b"\x99\x26\x40"), (1920, b"\x89\x26\x00")]] * 2)

            # Whether a port was there at Start goes by when it was last heard, also
            # when the watcher sees its silence only after Start (F7): one quiet
            # before it begins the take with what it held let go, and one heard
            # after it is in the take until it went quiet.
            lag_fake, lag = a_rig(td17)
            lag.use([gtr, drums])
            T15 = now[0] = 2000 * S
            lag_fake.send("TD-17", T15, b"\xfe")
            lag_fake.send("TD-17", T15 + 50 * MS, b"\xb9\x40\x7f")         # the pedal down, the last it says
            lag.drain()
            quiet_start = folder("quiet-at-start")
            now[0] = T15 + 200 * MS
            lag.begin_take(quiet_start, take_clock(now[0]))
            now[0] = T15 + 400 * MS
            lag.tick()                                                     # quiet since T15 + 50 ms, seen now
            lag.drain()
            lag_fake.send("TD-17", T15 + 1 * S, b"\xfe")
            lag_fake.send("TD-17", T15 + 1200 * MS, b"\x99\x26\x40")
            lag.drain()
            lag.end_take(2.0)
            ok("a port quiet since before Start, seen so only after, begins the take with its pedal let up",
               in_ticks(quiet_start / "Drums.mid") == [(0, b"\xb9\x40\x00"), (1920, b"\x99\x26\x40"),
                                                         (3840, b"\x89\x26\x00")])
            heard_after = folder("quiet-after-start")
            T16 = now[0] = 2100 * S
            lag_fake.send("TD-17", T16 - 100 * MS, b"\xfe")
            lag.drain()
            lag.begin_take(heard_after, take_clock(T16))
            lag_fake.send("TD-17", T16 + 100 * MS, b"\x99\x24\x40")      # after Start, the last it says
            now[0] = T16 + 500 * MS
            lag.tick()                                                     # quiet, before the writer reaches Start
            lag.drain()
            lag.end_take(1.0)
            ok("a port heard after Start that goes quiet before the writer reaches Start is in the take until then",
               (heard_after / "Drums.mid").exists()
               and in_ticks(heard_after / "Drums.mid") == [(0, b"\xb9\x40\x00"), (192, b"\x99\x24\x40"),
                                                         (192, b"\x89\x24\x00")])

            # Notes still waiting on the queue when the counts start again, or when
            # the rehearsal ends, are not counted.
            count_fake, counting = a_rig(td17)
            counting.use([gtr, drums])
            counting.drain()
            for i in range(3):
                count_fake.send("TD-17", 1900 * S + i * MS, b"\x99\x26\x40")
            counting.reset_counts()
            counting.drain()
            reset_to = (counting.ports()["ports"][0]["notes"], counting.activity()["Drums"]["notes"])
            count_fake.send("TD-17", 1900 * S + 10 * MS, b"\x99\x26\x40")
            counting.drain()
            one_more = (counting.ports()["ports"][0]["notes"], counting.activity()["Drums"]["notes"])
            for i in range(3):
                count_fake.send("TD-17", 1900 * S + (20 + i) * MS, b"\x99\x26\x40")
            counting.release()
            counting.drain()
            ok("notes still waiting when the counts start again, or when the rehearsal ends, are not counted",
               reset_to == (0, 0) and one_more == (1, 1) and counting.ports()["ports"][0]["notes"] == 0)

            # Two tracks on one port: one port open, counted once, and no echo between them.
            shared_fake = FakePortSystem([td17], exclusive=True)
            shared = MidiRig(shared_fake, threads=False, now_ns=lambda: now[0])
            pads = {"name": "Pads", "mode": "midi", "channel": None, "midi_port": {"name": "TD-17"}}
            shared.use([gtr, drums, pads])
            for i in range(5):
                shared_fake.send("TD-17", 1200 * S + i * 100 * MS, b"\x99\x26\x40")
            shared.drain()
            act = shared.activity()
            ok("two tracks on one port share it, open once and both ok, even where a port opens once",
               shared_fake.opens == {"TD-17": 1} and act["Drums"]["state"] == act["Pads"]["state"] == "ok")
            ok("its notes are counted once for the port, and are not the same notes twice (P8): P2 says it",
               shared.ports()["ports"][0]["notes"] == 5 and act["Drums"]["notes"] == act["Pads"]["notes"] == 5
               and "echo" not in act["Drums"] and "echo" not in act["Pads"]
               and notes_problem([gtr, drums, pads]) == "Drums and Pads both take notes from TD-17.")

            # A port that goes lets go of what it held, for the next take too (F7).
            held_fake, held = a_rig(td17, launchkey)
            held.use([gtr, drums, keys])
            pulled = folder("pulled")
            T9 = now[0] = 1300 * S
            held.begin_take(pulled, take_clock(T9))
            held_fake.send("Launchkey Mini MK3", T9 + 100 * MS, b"\xb0\x40\x7f")    # the sustain down
            held_fake.send("TD-17", T9 + 100 * MS, b"\xfe")
            held_fake.send("TD-17", T9 + 200 * MS, b"\xb9\x40\x7f")                 # and the kit's
            held.drain()
            now[0] = T9 + 600 * MS
            held_fake.pull("Launchkey Mini MK3")
            held.tick()                                                              # the TD-17 goes quiet too
            held.drain()
            held.end_take(3.0)
            ok("the sustain down when its port was pulled is let up there in the take",
               in_ticks(pulled / "Keys.mid") == [(192, b"\xb0\x40\x7f"), (192, b"\xb0\x40\x00")]
               and in_ticks(pulled / "Drums.mid") == [(384, b"\xb9\x40\x7f"), (384, b"\xb9\x40\x00")])
            held_fake.plug(launchkey)
            held_fake.send("TD-17", T9 + 4 * S, b"\xfe")
            now[0] = T9 + 4 * S
            held.tick()
            held.drain()
            after = folder("after")
            held.begin_take(after, take_clock(now[0]))
            held.end_take(1.0)
            ok("and the next take begins with it up, for a port pulled and for one that went quiet",
               in_ticks(after / "Keys.mid") == [(0, b"\xb0\x40\x00")]
               and in_ticks(after / "Drums.mid") == [(0, b"\xb9\x40\x00")])
            held_fake.send("Launchkey Mini MK3", now[0] + 100 * MS, b"\xb0\x40\x7f")
            held.drain()
            now[0] += 1 * S
            held_fake.pull("Launchkey Mini MK3")
            held.tick()                                              # closed, and the writer not there yet
            racing = folder("racing")
            held.begin_take(racing, take_clock(now[0]))
            held_fake.plug(launchkey)
            held.tick()
            held_fake.send("Launchkey Mini MK3", now[0] + 500 * MS, b"\x90\x3c\x40")
            held.drain()
            held.end_take(2.0)
            ok("a take that begins before the writer reaches the pull still begins with the pedal up",
               [data for _, data in in_ticks(racing / "Keys.mid") if data[0] == 0xB0] == [b"\xb0\x40\x00"])

            # abandon_take, begin_take over a running take, release and refresh.
            spare_fake, spare = a_rig(td17)
            spare.use([gtr, drums, keys])
            first_take, second_take = folder("first-take"), folder("second-take")
            T10 = now[0] = 1400 * S
            spare.begin_take(first_take, take_clock(T10))
            spare_fake.send("TD-17", T10 + 100 * MS, b"\x99\x26\x40")
            spare.drain()
            spare.abandon_take()
            ok("abandon_take leaves the notes as a crash would, for the drafts, and there is no take after it",
               files_in(first_take) == ["Drums.midraw"] and "992640" in (first_take / "Drums.midraw").read_text()
               and spare.end_take(1.0) == [])
            spare.begin_take(first_take, take_clock(T10 + 10 * S))
            spare_fake.send("TD-17", T10 + 10 * S + 100 * MS, b"\x99\x26\x40")
            spare.drain()
            spare.begin_take(second_take, take_clock(T10 + 20 * S))
            spare_fake.send("TD-17", T10 + 20 * S + 100 * MS, b"\x99\x26\x40")
            ok("begin_take while a take records abandons that one, as abandon_take would, and records the new one",
               files_in(first_take) == ["Drums.midraw"] and "992640" in (first_take / "Drums.midraw").read_text()
               and [m["name"] for m in spare.end_take(1.0)] == ["Drums"]
               and in_ticks(second_take / "Drums.mid") == [(192, b"\x99\x26\x40"), (1920, b"\x89\x26\x00")])
            spare_fake.notify = False                                                # the observer misses it
            spare_fake.plug(launchkey)
            spare.tick()
            missed = spare.activity()["Keys"]["state"]
            spare.refresh()
            ok("refresh reads the list again: a port plugged in that nothing told of is opened (Look again)",
               missed == "missing" and spare.activity()["Keys"]["state"] == "ok")
            spare.release()
            ok("release closes every port and forgets the tracks and the counts, and still lists the ports",
               spare_fake.open_ports == set() and spare.activity() == {}
               and [(p["name"], p["notes"]) for p in spare.ports()["ports"]] == [("TD-17", 0), ("Launchkey Mini MK3", 0)])
            spare.use([gtr, drums])
            ok("and the next rehearsal opens them again", spare.activity()["Drums"]["state"] == "ok")

            # A port heard again between a tick reading when it was last heard and
            # saying it went quiet: the silence that tick saw is over, and nothing
            # is said to have gone.
            late_fake, late = a_rig(td17)
            inner = late._queue

            class Racing:
                """The rig's queue, with an event that arrives just as a tick finds the port quiet."""
                arrive = None

                def put(self, item):
                    if item[0] is None and item[1] == "silent" and Racing.arrive is not None:
                        arrive, Racing.arrive = Racing.arrive, None
                        arrive()
                    inner.put(item)

                def get_nowait(self):
                    return inner.get_nowait()

            late._queue = Racing()
            late.use([gtr, drums])
            T11 = now[0] = 1500 * S
            heard.clear()
            late.begin_take(folder("stale"), take_clock(T11))
            late_fake.send("TD-17", T11 + 100 * MS, b"\xfe")
            late_fake.send("TD-17", T11 + 200 * MS, b"\x99\x26\x40")
            late.drain()
            now[0] = T11 + 600 * MS
            Racing.arrive = lambda: late_fake.send("TD-17", T11 + 590 * MS, b"\x99\x24\x40")
            late.tick()
            late.drain()
            act = late.activity()["Drums"]
            late.end_take(1.0)
            ok("a port heard again just as a tick finds it quiet is still there, and the take is not told it went",
               Racing.arrive is None and act["state"] == "ok"
               and [what for what, _ in told("Drums")] == ["present", "feed", "feed"])

            # Two failures that keep coming back are each said once.
            said_before = len(said7)

            def broken_clock():
                raise RuntimeError("the clock cannot be read")

            for port in spare_fake.open_ports:
                port.resync = broken_clock
            spare_fake.inputs = lambda: (_ for _ in ()).throw(RuntimeError("the list cannot be read"))
            for _ in range(12):
                spare.tick()
            ok("two failures that alternate are each said once in the log, not once each time",
               len(said7) - said_before == 2 and all(r.levelno == logging.ERROR for r in said7[said_before:]))
            for port in spare_fake.open_ports:
                del port.resync                                                      # it works again
            del spare_fake.inputs
            for _ in range(4):
                spare.tick()
            for port in spare_fake.open_ports:
                port.resync = broken_clock
            for _ in range(4):
                spare.tick()
            back_again = len(said7) - said_before
            spare.release()
            spare.use([gtr, drums])
            for port in spare_fake.open_ports:
                port.resync = broken_clock
            for _ in range(4):
                spare.tick()
            ok("a failure is said again once the same thing has worked in between, and after release",
               back_again == 3 and len(said7) - said_before == 4)
            spare.shutdown()

            # With its own threads, as the app runs it.
            live_fake = FakePortSystem([td17])
            live = MidiRig(live_fake)
            try:
                live.use([gtr, drums, keys])
                started = time.perf_counter_ns()
                live_take = folder("live")
                live.begin_take(live_take, take_clock(started))
                live_fake.plug(launchkey)
                deadline = time.monotonic() + 10
                while live.activity()["Keys"]["state"] != "ok" and time.monotonic() < deadline:
                    time.sleep(0.01)
                ok("with its own threads, a port plugged in is opened by the watcher as it is told (P4)",
                   live.activity()["Keys"]["state"] == "ok")
                at = time.perf_counter_ns()
                for k in range(5):
                    live_fake.send("TD-17", at + k * MS, bytes((0x99, 38 + k, 64)))
                    live_fake.send("Launchkey Mini MK3", at + k * MS, bytes((0x90, 60 + k, 64)))
                made = live.end_take(60.0)
                ok("the writer's thread has written every event that came before Stop",
                   [m["name"] for m in made] == ["Drums", "Keys"]
                   and [d[1] for _, d in in_ticks(live_take / "Drums.mid") if d[0] == 0x99] == [38, 39, 40, 41, 42]
                   and [d[1] for _, d in in_ticks(live_take / "Keys.mid") if d[0] == 0x90] == [60, 61, 62, 63, 64])
            finally:
                live.shutdown()
            left = [t.name for t in threading.enumerate() if t.name.startswith("midi-rig")]
            ok("shutdown stops both of its threads and closes every port and the system",
               left == [] and live_fake.open_ports == set() and live_fake.inputs() == [])

            # The watcher keeps time by the rig's clock: one that stands still has no ticks.
            paced_clock = [2000 * S]
            paced_fake = FakePortSystem([td17])
            paced = MidiRig(paced_fake, now_ns=lambda: paced_clock[0])
            try:
                paced.use([gtr, drums])
                paced_fake.send("TD-17", paced_clock[0], b"\xfe")
                time.sleep(1.2)                                   # more than four ticks of the computer's time
                still = [port.resyncs for port in paced_fake.open_ports] == [0]
                paced_clock[0] += 1 * S
                deadline = time.monotonic() + 10
                while paced.activity()["Drums"]["state"] != "missing" and time.monotonic() < deadline:
                    time.sleep(0.01)
                ok("the watcher's ticks follow the rig's clock: none while it stands still, one as it moves",
                   still and paced.activity()["Drums"]["state"] == "missing")
            finally:
                paced.shutdown()
    finally:
        rig_mod.MidiRecorder = real_recorder

    rig_source = Path(rig_mod.__file__).read_text(encoding="utf-8")
    rig_imports = {n.names[0].name if isinstance(n, ast.Import) else n.module
                   for n in ast.walk(ast.parse(rig_source)) if isinstance(n, (ast.Import, ast.ImportFrom))}
    ok("the rig imports neither the MIDI library nor mido", not rig_imports & {"pylibremidi", "mido"})

    print("\n[8] Cropping a .mid")
    # Keeping [start, end) of a take's notes (spec F4). What the instrument was set to
    # before the start is written at tick 0, a key held across the start is left out with
    # its release, and a key held across the end is let go at the end.

    def struck8(sec, note, ch=0, vel=100):
        return (sec, bytes((0x90 | ch, note, vel)))

    def freed8(sec, note, ch=0, vel=0x40):
        return (sec, bytes((0x80 | ch, note, vel)))

    def control8(sec, number, value, ch=0):
        return (sec, bytes((0xB0 | ch, number, value)))

    def ticks8(path):
        """A .mid's events as (tick, bytes), the start messages first."""
        return [(round(sec * 1920), data) for sec, data in read_events(path)[1]]

    def key8(timed, note):
        """The note-ons and note-offs of one key among (tick, bytes)."""
        return [(tick, data) for tick, data in timed if data[0] & 0xF0 in (0x80, 0x90) and data[1] == note]

    with tempfile.TemporaryDirectory() as folder8:
        folder8 = Path(folder8)
        # Written with write_mid, so a time in it is exactly a tick over 1920. The program change is
        # what the take began with; the SysEx is a whole one.
        sysex8 = b"\xF0\x7E\x7F\x09\x01\xF7"
        source8 = folder8 / "Клавиши.mid"
        write_mid(source8, track_name="Клавиши", port_name="Launchkey Mini", start=[b"\xC0\x05"], events=[
            control8(0.5, 4, 90), control8(0.6, 64, 127),
            struck8(1.0, 60),                                    # held across the start
            struck8(2.5, 62), freed8(2.6, 62),                   # inside
            freed8(3.0, 60),                                     # its release
            (3.5, sysex8),
            struck8(4.0, 64),                                    # held across the end
            control8(5.5, 64, 0), freed8(6.0, 64),
        ])
        target8 = folder8 / "Клавиши cut.mid"
        ok("crop_mid answers {ok: True}", smf.crop_mid(source8, target8, 2.0, 5.0) == {"ok": True})
        cut8 = ticks8(target8)
        ok("what was set before the start is at tick 0: the program, then the controllers by number",
           cut8[:3] == [(0, b"\xC0\x05"), (0, b"\xB0\x04\x5A"), (0, b"\xB0\x40\x7F")])
        ok("a key held across the start is left out, its release too", key8(cut8, 60) == [])
        ok("the key inside is at 0.5 and 0.6 s from the new start, its velocities as they were",
           key8(cut8, 62) == [(960, b"\x90\x3e\x64"), (1152, b"\x80\x3e\x40")])
        ok("a SysEx inside is kept whole, 1.5 s in", [(t, d) for t, d in cut8 if d[0] == 0xF0] == [(2880, sysex8)])
        ok("a key held across the end starts at 2.0 s and is let go at 3.0 s, the end",
           key8(cut8, 64) == [(3840, b"\x90\x40\x64"), (5760, b"\x80\x40\x00")])
        ok("the pedal that was still down is let up there too, and nothing after the end is in the file",
           cut8[-2:] == [(5760, b"\x80\x40\x00"), (5760, b"\xB0\x40\x00")] and len(cut8) == 9)
        ok("the track name and the port's name are kept",
           read_events(target8)[0] == {"track_name": "Клавиши", "device_name": "Launchkey Mini"})
        mid8, _ = read_back(target8)
        ok("it is the same kind of file: format 0, 960 ticks to the beat, 120 bpm",
           mid8.type == 0 and mid8.ticks_per_beat == 960 and len(mid8.tracks) == 1
           and any(m.type == "set_tempo" and m.tempo == 500_000 for m in mid8.tracks[0]))
        ok("the original is as it was", len(ticks8(source8)) == 11 and key8(ticks8(source8), 60)[0][0] == 1920)

        # Everything is the same take.
        whole8 = folder8 / "whole.mid"
        ok("a crop of all of it gives the same names and the same events",
           smf.crop_mid(source8, whole8, 0.0, 100.0) == {"ok": True} and read_events(whole8) == read_events(source8))

        # Keys by channel; a key struck again while held; a release as a note-on at velocity 0; a key's pressure.
        edge8 = folder8 / "edge.mid"
        write_mid(edge8, track_name="T", port_name="P", start=[], events=[
            struck8(0.5, 60, ch=0), struck8(0.6, 60, ch=1), struck8(0.7, 61),
            (2.2, b"\xA0\x3c\x30"),                             # pressure on a key held across the start
            struck8(2.5, 60, ch=0),                              # struck again before it was let go
            freed8(2.6, 60, ch=1),                               # channel 2's key, held across the start
            struck8(2.7, 61, vel=0),                             # the release of a key held across the start
            (2.8, b"\xA0\x3c\x31"),                             # pressure on the key struck again: kept
            (2.9, b"\xA1\x3c\x32"),                             # pressure on channel 2's key, never struck here
            freed8(3.0, 60, ch=0),
        ])
        edge_cut8 = folder8 / "edge cut.mid"
        smf.crop_mid(edge8, edge_cut8, 2.0, 5.0)
        ok("a key struck again after the start keeps its release; one the file never struck has none, "
           "on its own channel or as a note-on at velocity 0",
           [(t, d) for t, d in ticks8(edge_cut8) if d[0] & 0xF0 != 0xA0]
           == [(960, b"\x90\x3c\x64"), (1920, b"\x80\x3c\x40")])
        ok("a key's pressure goes the way its key does: kept for a key the file struck, left out for one it did not",
           [(t, d) for t, d in ticks8(edge_cut8) if d[0] & 0xF0 == 0xA0] == [(1536, b"\xA0\x3c\x31")])

        # A fast roll on a pad: the key is struck again before the first strike is let go. Its
        # strikes are counted, as a take's are (R29), so nothing is left hanging (F7).
        roll8 = folder8 / "roll.mid"
        write_mid(roll8, track_name="Kit", port_name="TD-17", start=[], events=[
            struck8(1.0, 38, ch=9), struck8(1.05, 38, ch=9), freed8(1.1, 38, ch=9), freed8(1.15, 38, ch=9),
            struck8(2.0, 40, ch=9), struck8(2.05, 40, ch=9), freed8(3.0, 40, ch=9), freed8(3.05, 40, ch=9),
        ])
        roll_cut8 = folder8 / "roll cut.mid"
        smf.crop_mid(roll8, roll_cut8, 0.5, 3.0)
        ok("a key struck twice before it is let go keeps both its releases",
           key8(ticks8(roll_cut8), 38) == [(960, b"\x99\x26\x64"), (1056, b"\x99\x26\x64"),
                                           (1152, b"\x89\x26\x40"), (1248, b"\x89\x26\x40")])
        ok("and one struck twice and held across the end is let go twice there",
           key8(ticks8(roll_cut8), 40) == [(2880, b"\x99\x28\x64"), (2976, b"\x99\x28\x64"),
                                           (4800, b"\x89\x28\x00"), (4800, b"\x89\x28\x00")])

        # Let go at the end: the keys, in the order they were struck, then the pedals.
        ends8 = folder8 / "ends.mid"
        smf.crop_mid(source8, ends8, 1.0, 2.0)
        ok("keys held at the end are let up first, then the pedals that are down",
           ticks8(ends8) == [(0, b"\xC0\x05"), (0, b"\xB0\x04\x5A"), (0, b"\xB0\x40\x7F"),
                             (0, b"\x90\x3c\x64"), (1920, b"\x80\x3c\x00"), (1920, b"\xB0\x40\x00")])

        # A range with nothing played in it is a file of its names and what was set.
        quiet8 = folder8 / "quiet.mid"
        smf.crop_mid(source8, quiet8, 7.0, 9.0)
        ok("a range with no notes keeps the names and what was set, the pedal as it last was",
           ticks8(quiet8) == [(0, b"\xC0\x05"), (0, b"\xB0\x04\x5A"), (0, b"\xB0\x40\x00")]
           and read_events(quiet8)[0] == {"track_name": "Клавиши", "device_name": "Launchkey Mini"})
        plain8 = folder8 / "plain.mid"
        write_mid(plain8, track_name="Keys", port_name="Launchkey", start=[], events=[struck8(1.0, 60), freed8(1.5, 60)])
        nothing8 = folder8 / "nothing.mid"
        smf.crop_mid(plain8, nothing8, 3.0, 4.0)
        ok("and a file that set nothing is the names alone",
           ticks8(nothing8) == [] and read_events(nothing8)[0] == {"track_name": "Keys", "device_name": "Launchkey"})

        # Ticks come from the time since the start, never from the deltas before: a long take is not off by a tick.
        long8 = [(i * 0.037, bytes((0x99 if i % 2 == 0 else 0x89, 36, 100 if i % 2 == 0 else 0))) for i in range(20_000)]
        many8 = folder8 / "many.mid"
        write_mid(many8, track_name="Kit", port_name="TD-17", start=[], events=long8)
        for start8, end8, shift8 in ((100.0, 400.0, 192000), (100.0003, 400.0003, 192001)):
            # 100.0003 s is not on a tick: 192000.576 ticks, so every tick moves by 192001.
            kept8 = [(round(t * 1920), data) for t, data in long8
                     if shift8 - 0.5 < round(t * 1920) <= shift8 - 0.5 + 300 * 1920]
            wanted8, held8 = [], False
            for tick, data in kept8:
                if data[0] == 0x99:
                    held8 = True
                elif not held8:
                    continue  # the release of a key struck before the start
                else:
                    held8 = False
                wanted8.append((tick - shift8, data))
            if held8:
                wanted8.append((round(300 * 1920), b"\x89\x24\x00"))
            many_cut8 = folder8 / f"many {start8}.mid"
            smf.crop_mid(many8, many_cut8, start8, end8)
            ok(f"20000 events cropped from {start8} s are each on round(seconds * 1920) from the new start, "
               "none off by the rounding of the ones before",
               len(wanted8) > 7000 and ticks8(many_cut8) == wanted8)

        # A file a DAW saved again: 480 ticks to the beat, 100 bpm, the tempo in a track of its own.
        daw8 = folder8 / "daw.mid"
        daw_file8 = mido.MidiFile(type=1, ticks_per_beat=480, charset="utf-8")
        daw_file8.tracks.append(mido.MidiTrack([mido.MetaMessage("set_tempo", tempo=600_000)]))
        daw_file8.tracks.append(mido.MidiTrack([
            mido.MetaMessage("track_name", name="Bass"),
            mido.Message("note_on", note=40, velocity=90, time=1600),     # 2.0 s at 100 bpm
            mido.Message("note_off", note=40, velocity=0, time=800)]))    # 3.0 s
        daw_file8.save(daw8)
        daw_cut8 = folder8 / "daw cut.mid"
        smf.crop_mid(daw8, daw_cut8, 1.0, 2.5)
        ok("a file with other ticks and another tempo is cut by its own seconds, and written as ours",
           ticks8(daw_cut8) == [(1920, b"\x90\x28\x5a"), (2880, b"\x80\x28\x00")]
           and read_events(daw_cut8)[0]["track_name"] == "Bass" and read_back(daw_cut8)[0].ticks_per_beat == 960)

        # What cannot be cropped is said, never raised, and writes nothing.
        bad8 = folder8 / "bad.mid"
        bad8.write_bytes(b"not a midi file")
        gone8 = smf.crop_mid(folder8 / "gone.mid", folder8 / "never1.mid", 0.0, 1.0)
        torn8 = smf.crop_mid(bad8, folder8 / "never2.mid", 0.0, 1.0)
        nowhere8 = smf.crop_mid(source8, folder8 / "no folder" / "never3.mid", 0.0, 1.0)
        ok("a file that is not there, one that is no .mid and a place that cannot be written to are each "
           "{ok: False, error}",
           all(r["ok"] is False and r["error"] for r in (gone8, torn8, nowhere8)))
        ok("and nothing is left behind", not any(p.name.startswith("never") for p in folder8.rglob("*")))

    print("\n[9] Notes for the player")
    # A take's .mid read back as what the player's lane draws (Part 6): a drum
    # grid for a kit, a piano roll for anything else. The files are made with
    # write_mid, so a time in them is a tick over 1920 as in a take.

    def on(sec, note, vel=100, ch=0):
        return (sec, bytes((0x90 | ch, note, vel)))

    def off(sec, note, ch=0, vel=0x40):
        return (sec, bytes((0x80 | ch, note, vel)))

    def cc(sec, number=4, value=90, ch=0):
        return (sec, bytes((0xB0 | ch, number, value)))

    with tempfile.TemporaryDirectory() as folder9:
        folder9 = Path(folder9)
        made9 = itertools.count()

        def read9(events, drums_icon=False):
            path = folder9 / f"take{next(made9)}.mid"
            # In time order, as write_mid is given them; the sort is stable, so
            # what is on one instant keeps the order it was written in.
            events = sorted(events, key=lambda event: event[0])
            write_mid(path, track_name="Keys", port_name="Port", start=[], events=events)
            return read_notes(path, drums_icon)

        ok("the drum rows are Crash, Ride, Hi-hat, Toms, Snare, Kick, in that order",
           DRUM_ROWS == ["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"])
        mapped = {36: "Kick", 35: "Kick", 38: "Snare", 40: "Snare", 37: "Snare",
                  42: "Hi-hat", 44: "Hi-hat", 46: "Hi-hat", 22: "Hi-hat", 26: "Hi-hat",
                  48: "Toms", 50: "Toms", 45: "Toms", 47: "Toms", 43: "Toms", 41: "Toms", 58: "Toms",
                  51: "Ride", 53: "Ride", 59: "Ride",
                  49: "Crash", 55: "Crash", 57: "Crash", 52: "Crash"}
        ok("the map: 36 and 35 Kick; 38, 40, 37 Snare; 42, 44, 46, 22, 26 Hi-hat; 48, 50, 45, 47, 43, 41, 58 Toms; "
           "51, 53, 59 Ride; 49, 55, 57, 52 Crash, and no note besides",
           {note: DRUM_ROWS[row] for note, row in DRUM_MAP.items()} == mapped)
        general_midi = read9([e for k, n in enumerate((35, 41)) for e in (on(k * 0.1, n, ch=9), off(k * 0.1 + 0.05, n, ch=9))])
        ok("General MIDI's acoustic bass drum (35) and low floor tom (41) are a Kick and a Tom, not Other",
           general_midi["rows"] == DRUM_ROWS and [n[2] for n in general_midi["notes"]] == [5, 3])

        # Drums: by the icon, or by notes on channel 10 without it.
        keys_ch1 = [on(0.0, 60), off(0.5, 60), on(1.0, 64), off(1.5, 64)]
        by_icon = read9([on(0.0, 36), off(0.5, 36), on(1.0, 38), off(1.5, 38)], True)
        ok("the drums icon makes it drums, whatever channel the notes are on",
           by_icon["drums"] is True and by_icon["rows"] == DRUM_ROWS
           and set(by_icon) == {"drums", "rows", "notes"} and len(by_icon["notes"]) == 2)
        ok("without the icon, notes on channel 10 are drums",
           read9([on(0.0, 36, ch=9), off(0.1, 36, ch=9)])["drums"] is True)
        piano = read9(keys_ch1)
        ok("without the icon, notes on another channel are a piano roll",
           piano["drums"] is False and set(piano) == {"drums", "low", "high", "notes"})
        ok("channel 10 is decided on every note-on: one note-on on another channel and it is pitched",
           read9([on(0.0, 36, ch=9), on(0.5, 60, ch=0), on(1.0, 38, ch=9)])["drums"] is False)
        ok("and a release, or a note-on at velocity 0, on another channel is not a note-on",
           read9([on(0.0, 36, ch=9), off(0.1, 36, ch=9), off(0.2, 60, ch=0),
                  on(0.3, 60, vel=0, ch=0)])["drums"] is True)
        ok("a file with no note-on at all is not channel 10's, controllers on channel 10 or not",
           read9([cc(0.0, ch=9), cc(1.0, ch=9)])["drums"] is False and read9([])["drums"] is False)
        nothing = read9([cc(0.0, ch=9)], True)
        ok("a drums icon with no notes in the file is an empty grid",
           nothing == {"drums": True, "rows": DRUM_ROWS, "notes": []})

        # The rows.
        hits = sorted(DRUM_MAP) + [99, 0, 127]
        grid = read9([e for k, n in enumerate(hits) for e in (on(k * 0.1, n, ch=9), off(k * 0.1 + 0.05, n, ch=9))])
        ok("every note of the map lands on its row, and every other note on Other, the row after Kick",
           [row for _, _, row, _ in grid["notes"]]
           == [DRUM_MAP.get(n, len(DRUM_ROWS)) for n in hits] and len(grid["notes"]) == len(hits))
        ok("Other is a row, the last, when a note outside the map is used",
           grid["rows"] == DRUM_ROWS + ["Other"] and len(DRUM_ROWS) == 6)
        ok("and it is not a row when every note is in the map",
           read9([on(0.0, n, ch=9) for n in DRUM_MAP], True)["rows"] == DRUM_ROWS)
        ok("reading a take with Other leaves the list of rows as it was",
           DRUM_ROWS == ["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"]
           and read9([on(0.0, 99, ch=9)], True)["rows"] is not DRUM_ROWS)
        ok("a note's row for a hit is the index into the rows: Kick 5, Snare 4, Crash 0",
           [row for _, _, row, _ in read9([on(0.0, 36), on(0.1, 38), on(0.2, 49)], True)["notes"]] == [5, 4, 0])

        # Pairing: a roll on one note, each release 0.1 s after its hit.
        roll = read9([e for k in range(6) for e in (on(k * 0.05, 38, 90 + k, ch=9), off(k * 0.05 + 0.1, 38, ch=9))])
        ok("a roll on 38 with hits 0.05 s apart and each release 0.1 s later: six notes, each 0.1 s long",
           [n[1] for n in roll["notes"]] == [0.1] * 6 and len(roll["notes"]) == 6)
        ok("their starts are the hits', their row Snare and their velocities their own",
           [n[0] for n in roll["notes"]] == [0.0, 0.05, 0.1, 0.15, 0.2, 0.25]
           and {n[2] for n in roll["notes"]} == {DRUM_MAP[38]}
           and [n[3] for n in roll["notes"]] == [90, 91, 92, 93, 94, 95])
        # Newest-first would have closed the second hit at 0.1 s for 0.05 s.
        ok("a release closes the oldest hit still sounding on that note",
           read9([on(0.0, 60), on(0.2, 60), off(0.5, 60), off(0.9, 60)])["notes"]
           == [[0.0, 0.5, 60, 100], [0.2, 0.7, 60, 100]])
        ok("a note-on at velocity 0 is a release",
           read9([on(0.0, 60), on(0.5, 60, vel=0), on(1.0, 62, vel=64), on(1.25, 62, vel=0)])["notes"]
           == [[0.0, 0.5, 60, 100], [1.0, 0.25, 62, 64]])
        ok("and it is no note of its own: a take of nothing else has none",
           read9([on(0.0, 60, vel=0), on(0.5, 60, vel=0)])["notes"] == [])
        ok("a release with nothing sounding is passed over, and the release velocity is not the note's",
           read9([off(0.0, 60), on(0.5, 60, vel=70), off(1.0, 60, vel=127), off(1.5, 60)])["notes"]
           == [[0.5, 0.5, 60, 70]])
        ok("the same note on two channels is two notes: a release closes the oldest of its own channel",
           read9([on(0.0, 60, ch=0), on(0.1, 60, ch=1), off(0.2, 60, ch=1), off(0.5, 60, ch=0)])["notes"]
           == [[0.0, 0.5, 60, 100], [0.1, 0.1, 60, 100]])
        # A format 1 file, as a DAW saves it: the notes are spread over its tracks and read as one, in time.
        # Struck in one track and let go in another, the oldest strike is closed first (a last-in-first-out
        # pairing would give 0.25 and 1.0 here).
        daw1 = mido.MidiFile(type=1, ticks_per_beat=480)
        daw1.tracks.append(mido.MidiTrack([mido.MetaMessage("set_tempo", tempo=500_000, time=0)]))
        daw1.tracks.append(mido.MidiTrack([mido.Message("note_on", note=60, velocity=100, time=0),
                                           mido.Message("note_on", note=60, velocity=100, time=240)]))
        daw1.tracks.append(mido.MidiTrack([mido.Message("note_off", note=60, velocity=0, time=480),
                                           mido.Message("note_off", note=60, velocity=0, time=480)]))
        daw1.save(folder9 / "daw1.mid")
        ok("a format 1 file's tracks are read together: a strike in one and its release in another are one note, "
           "oldest first",
           read_notes(folder9 / "daw1.mid", False)["notes"] == [[0.0, 0.5, 60, 100], [0.25, 0.75, 60, 100]])
        ok("notes come in the order they began, and a note held while others come and go is one note",
           [(n[0], n[1], n[2]) for n in read9([on(0.0, 60), on(0.1, 64), off(0.2, 64), on(0.3, 67),
                                               off(0.4, 67), off(1.0, 60)])["notes"]]
           == [(0.0, 1.0, 60), (0.1, 0.1, 64), (0.3, 0.1, 67)])
        ok("a note never released lasts to the file's last event, a controller's included",
           read9([on(0.5, 60), cc(2.0)])["notes"] == [[0.5, 1.5, 60, 100]])
        ok("and one struck as the file's last event is no longer than 0",
           read9([on(0.5, 60), off(1.0, 60), on(2.0, 62)])["notes"] == [[0.5, 0.5, 60, 100], [2.0, 0.0, 62, 100]])
        ok("velocity is the note-on's, 1 to 127",
           [n[3] for n in read9([on(0.0, 60, 1), off(0.1, 60), on(0.2, 61, 127), off(0.3, 61)])["notes"]] == [1, 127])
        ok("a time is in seconds and a note is [t, d, pitch, velocity], plain numbers",
           all(len(n) == 4 and isinstance(n, list) and isinstance(n[0], float) and isinstance(n[1], float)
               and isinstance(n[2], int) and isinstance(n[3], int) for n in roll["notes"] + piano["notes"])
           and json.loads(json.dumps(roll)) == roll)
        ok("a pitched note is its note number, the channel not part of it",
           [n[2] for n in read9([on(0.0, 60, ch=3), off(0.1, 60, ch=3), on(0.2, 72, ch=5), off(0.3, 72, ch=5)])["notes"]]
           == [60, 72])

        # The roll's range: whole octaves, C to B.
        def span9(*pitches):
            """(low, high) of a take that strikes these notes, one every 0.1 s."""
            got = read9([on(k * 0.1, n) for k, n in enumerate(pitches)])
            return got["low"], got["high"]

        ok("notes 61 and 74 give low 60 and high 83, whole octaves from C to B", span9(61, 74) == (60, 83))
        ok("a note on a C starts its octave, and a B ends it",
           span9(60, 71) == (60, 71) and span9(59, 72) == (48, 83))
        ok("a single note gives its octave", span9(66) == (60, 71))
        ok("the bottom of MIDI is C-1 to B-1, and the top ends at 127 and not at a B that no key sends",
           span9(0) == (0, 11) and span9(127) == (120, 127))
        ok("a take with no notes gets middle C's octave, 60 to 71, and no notes",
           read9([]) == {"drums": False, "low": 60, "high": 71, "notes": []}
           and read9([cc(0.0), cc(1.0)]) == {"drums": False, "low": 60, "high": 71, "notes": []})

        # The file's own seconds, as a DAW saved it: 480 ticks to the beat and a slower tempo from the second beat on.
        daw = mido.MidiFile(type=0, ticks_per_beat=480)
        daw.tracks.append(mido.MidiTrack([
            mido.MetaMessage("set_tempo", tempo=500_000, time=0),
            mido.Message("note_on", note=60, velocity=80, time=0),
            mido.MetaMessage("set_tempo", tempo=1_000_000, time=480),
            mido.Message("note_off", note=60, velocity=0, time=480)]))
        daw.save(folder9 / "daw.mid")
        ok("the seconds are the file's own, through its ticks to the beat and its tempo changes",
           read_notes(folder9 / "daw.mid", False)["notes"] == [[0.0, 1.5, 60, 80]])

        # A long take: an hour of 40000 notes. The player is sent all of it at once.
        hour = [e for k in range(40000) for e in (on(k * 0.09, 36 + k % 40, 1 + k % 127, ch=9),
                                                  off(k * 0.09 + 0.05, 36 + k % 40, ch=9))]
        long_take = read9(hour)
        ok("a take of an hour and 40000 notes reads in full, each as long as it was held",
           long_take["drums"] is True and len(long_take["notes"]) == 40000
           and {n[1] for n in long_take["notes"]} == {0.05}
           and abs(long_take["notes"][-1][0] - 39999 * 0.09) < 0.001)
        ok("and its answer is a megabyte or so of JSON, not tens",
           len(json.dumps(long_take)) < 2_000_000)

        notes_source = Path(sys.modules[read_notes.__module__].__file__).read_text(encoding="utf-8")
        notes_imports = {n.names[0].name if isinstance(n, ast.Import) else n.module
                         for n in ast.walk(ast.parse(notes_source)) if isinstance(n, (ast.Import, ast.ImportFrom))}
        ok("notes reads through smf and imports neither the MIDI library nor mido",
           not notes_imports & {"pylibremidi", "mido"})

    print("\n[10] The alignment tool")
    # tools/midi_alignment.py (F1): `python tools/midi_alignment.py "<take folder>"`
    # says how far each .mid's notes are from the onsets in the WAV they belong
    # to, so Alex can check the 10 ms aim with a click or an e-kit recorded as
    # audio and as MIDI at once. What it prints is read back. Four cases run it as
    # it is run by hand, a command on a folder (the brief's 3 ms case, a name
    # in another script, no folder given, a folder that is not there), because
    # only a command shows the exit code and the bytes on the pipe; the rest call
    # its main() in this process, which starts no interpreter for each. The WAVs
    # are made with numpy, and the .mid files with write_mid, so a time in them
    # is a tick over 1920 (0.52 ms): a note meant to be 3 ms late is 6 ticks,
    # 3.125 ms.
    tool10 = PROJECT / "tools" / "midi_alignment.py"

    def clicks10(seconds, *, first=0.0, every=0.5, rate=48000, amp=0.8, hiss=0.0, channels=1):
        """(samples as floats shaped frames by channels, click times in seconds):
        a click is the sharp start of a 2 kHz burst that dies away in a few ms,
        like a stick on a rim or a metronome's tick, every `every` s from
        `first`, over `hiss` of white noise."""
        samples = np.zeros(round(seconds * rate))
        if hiss:
            samples += np.random.default_rng(7).normal(0.0, hiss, len(samples))
        burst_t = np.arange(round(0.008 * rate)) / rate
        burst = amp * np.cos(2 * np.pi * 2000 * burst_t) * np.exp(-burst_t / 0.002)
        times = []
        t = first
        while t + 0.008 < seconds:
            at = round(t * rate)
            samples[at:at + len(burst)] += burst
            times.append(at / rate)
            t += every
        return np.repeat(samples[:, None], channels, axis=1), times

    def write_wav10(path, samples, rate=48000, kind="pcm16"):
        """`samples` (frames by channels, -1 to 1) as a WAV: 16 or 24 bits the way
        the app writes them, through the wave module, or 32-bit float."""
        samples = np.asarray(samples, dtype=np.float64)
        if kind == "float32":
            import soundfile
            soundfile.write(str(path), samples.astype(np.float32), rate, subtype="FLOAT")
            return
        width = 2 if kind == "pcm16" else 3
        ints = np.round(np.clip(samples, -1.0, 1.0) * ((1 << (8 * width - 1)) - 1)).astype("<i4")
        raw = (ints.astype("<i2").tobytes() if width == 2
               else ints.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())
        with wave.open(str(path), "wb") as wf:
            wf.setnchannels(samples.shape[1])
            wf.setsampwidth(width)
            wf.setframerate(rate)
            wf.writeframes(raw)

    def write_notes10(path, times, name="Drums"):
        """A .mid with a snare hit (note 38, channel 10) at each time, and its release."""
        events = []
        for sec in times:
            events += [(sec, bytes((0x99, 38, 100))), (sec + 0.05, bytes((0x89, 38, 0)))]
        write_mid(path, track_name=name, port_name="TD-17", start=[], events=sorted(events))

    spec10 = importlib.util.spec_from_file_location("midi_alignment", tool10)
    alignment = importlib.util.module_from_spec(spec10)
    spec10.loader.exec_module(alignment)

    def command10(*args):
        """The tool as a command: (exit code, what it printed, what it said as an
        error, whether all of both is plain ASCII, which a Windows console needs)."""
        done = subprocess.run([sys.executable, str(tool10), *map(str, args)], capture_output=True)
        plain = all(byte < 128 for byte in done.stdout + done.stderr)
        return (done.returncode, done.stdout.decode("ascii", "replace"),
                done.stderr.decode("ascii", "replace"), plain)

    def run10(*args):
        """The same, through main() in this process, its output caught."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = alignment.main([str(arg) for arg in args])
            except SystemExit as stopped:  # argparse
                code = stopped.code if isinstance(stopped.code, int) else 1
        return code, out.getvalue(), err.getvalue(), all(ord(c) < 128 for c in out.getvalue() + err.getvalue())

    def kit10(starts, amps, rise, decay, hiss=0.0005, seed=4, tone=None, rumble=None):
        """A burst at each of `starts` (seconds), `amps` loud, that takes `rise` s
        to rise and rings with a time constant of `decay` s, over a little hiss: a
        drum as the audio hears it, one column of samples. The burst is noise, or
        a struck tone of `tone` Hz. `rumble` is (Hz, loudness): noise low-passed
        at that frequency, as a stage floor or a passing lorry gives, under it all."""
        rng = np.random.default_rng(seed)
        ring = round(1.0 * 48000)
        shape = np.minimum(np.arange(ring) / 48000 / rise, 1.0) * np.exp(-np.arange(ring) / 48000 / decay)
        kit = rng.normal(0.0, hiss, round((starts[-1] + 1.0) * 48000))
        if rumble:
            cut, loud = rumble
            slow = np.fft.irfft(np.fft.rfft(rng.normal(0.0, 1.0, len(kit)))
                                / np.sqrt(1.0 + (np.fft.rfftfreq(len(kit), 1 / 48000) / cut) ** 4), len(kit))
            kit += loud * slow / slow.std()
        for sec, loud in zip(starts, amps):
            at = round(sec * 48000)
            if tone:
                burst = 0.7 * np.sin(2 * np.pi * tone * np.arange(ring) / 48000 + rng.uniform(0.0, 2 * np.pi))
            else:
                burst = rng.normal(0.0, 1.0, ring) / 3.0
            kit[at:at + ring] += (loud * shape * burst)[:len(kit) - at]
        return np.clip(kit, -1.0, 1.0)[:, None]

    seen10 = re.compile(r"matched (\d+) of (\d+) notes, median ([+-]\d+\.\d) ms, worst ([+-]\d+\.\d) ms")

    def windows10(text):
        """Each window the tool printed as (matched, of, median ms, worst ms)."""
        return [(int(m), int(n), float(med), float(worst)) for m, n, med, worst in seen10.findall(text)]

    with tempfile.TemporaryDirectory() as root10:
        root10 = Path(root10)
        made10 = itertools.count()

        def take10(files):
            """A take folder with these files, {name: (samples, rate, kind) for a
            WAV, [note times] for a .mid}."""
            folder = root10 / f"take{next(made10)}"
            folder.mkdir()
            for name, content in files.items():
                if name.lower().endswith(".wav"):
                    samples, rate, kind = content
                    write_wav10(folder / name, samples, rate, kind)
                else:
                    write_notes10(folder / name, content, name=Path(name).stem)
            return folder

        # The brief's check: clicks every 0.5 s, the notes 3 ms late.
        samples, clicks = clicks10(20.0)
        late = take10({"Drums.wav": (samples, 48000, "pcm16"),
                       "Drums.mid": [t + 0.003 for t in clicks]})
        code, out, err, plain = command10(late)
        got = windows10(out)
        ok("notes 3 ms late: it runs, and prints one window for a take of 20 s", code == 0 and len(got) == 1)
        ok("a median of 3 ms, within half a millisecond, and all 40 notes matched",
           bool(got) and abs(got[0][2] - 3.0) < 0.5 and got[0][:2] == (40, 40))
        ok("the worst is within a millisecond of the median, on clicks at 48000 Hz",
           bool(got) and abs(got[0][3] - got[0][2]) < 1.0)
        ok("it says which files it measured, and that plus means later",
           "Drums.mid" in out and "Drums.wav" in out and "later" in out)
        ok("and prints plain ASCII only, which a Windows console can show", plain and not err)

        # A note before the audio is negative; the take starts with a rest this time,
        # so the first note can be before its click.
        samples, clicks = clicks10(20.0, first=0.5)
        early = take10({"Drums.wav": (samples, 48000, "pcm16"),
                        "Drums.mid": [t - 0.003 for t in clicks]})
        got = windows10(run10(early)[1])
        ok("notes 3 ms early give a median of -3 ms, the sign kept",
           len(got) == 1 and abs(got[0][2] + 3.0) < 0.5 and abs(got[0][3] - got[0][2]) < 1.0)

        # The first minute and the last one. The notes keep up at the start and
        # are 7 ms behind by the end, as a clock that drifts would leave them.
        samples, clicks = clicks10(130.0, rate=16000)
        drift = take10({"Drums.wav": (samples, 16000, "pcm16"),
                        "Drums.mid": [t + (0.002 if t < 65 else 0.009) for t in clicks]})
        code, out, err, plain = run10(drift)
        got = windows10(out)
        ok("a take of 130 s reports two windows, the first minute and the last",
           code == 0 and len(got) == 2 and "first minute" in out and "last minute" in out)
        ok("each with its 120 notes matched and its own median, 2 ms and then 9 ms",
           len(got) == 2 and got[0][:2] == (120, 120) and got[1][:2] == (120, 120)
           and abs(got[0][2] - 2.0) < 0.5 and abs(got[1][2] - 9.0) < 0.5)
        ok("the windows are said in minutes and seconds of the take",
           "0:00-1:00" in out and "1:10-2:10" in out)
        samples, clicks = clicks10(90.0, rate=16000)
        shorter = take10({"Drums.wav": (samples, 16000, "pcm16"), "Drums.mid": [t + 0.003 for t in clicks]})
        out = run10(shorter)[1]
        got = windows10(out)
        ok("a take under two minutes (90 s) is one window, all of it",
           len(got) == 1 and got[0][:2] == (180, 180) and "0:00-1:30" in out)

        # Other formats: what the app writes (16 and 24 bits) and what other
        # recorders do (32-bit float), mono and stereo. Only the right channel
        # hears the click, or the two hear it upside down; neither may lose it.
        samples, clicks = clicks10(10.0, hiss=0.002, channels=2)
        right_only = samples.copy()
        right_only[:, 0] = 0.0
        upside_down = samples.copy()
        upside_down[:, 1] *= -1
        for kind, shape, label in (("pcm16", samples, "16-bit stereo"),
                                   ("pcm24", right_only, "24-bit stereo with the click on the right only"),
                                   ("float32", upside_down, "32-bit float stereo with the sides upside down")):
            folder = take10({"Drums.wav": (shape, 48000, kind), "Drums.mid": [t + 0.003 for t in clicks]})
            got = windows10(run10(folder)[1])
            ok(f"{label}: the clicks are found, the median is 3 ms and all 20 notes are matched",
               len(got) == 1 and got[0][:2] == (20, 20) and abs(got[0][2] - 3.0) < 0.5)

        # A wide file is read as it is, and in blocks that hold the same number of
        # samples however many channels there are.
        samples, clicks = clicks10(10.0, channels=8)
        wide = take10({"Drums.wav": (samples, 48000, "pcm24"), "Drums.mid": [t + 0.003 for t in clicks]})
        got = windows10(run10(wide)[1])
        ok("an 8-channel WAV is read all the same: all 20 notes matched at 3 ms",
           len(got) == 1 and got[0][:2] == (20, 20) and abs(got[0][2] - 3.0) < 0.5)

        class Wide10:
            """A WAV of 8 channels that only says how much it was asked for."""
            channels = 8
            samplerate = 48000

            def __init__(self):
                self.asked = []

            def seek(self, frame):
                pass

            def read(self, frames, dtype, always_2d):
                self.asked.append(frames)
                return np.zeros((frames, self.channels), dtype=np.float32)

        wide_wav = Wide10()
        loud_enough = alignment.loudness(wide_wav, 0, 3 * alignment.BLOCK_FRAMES // 8 + 5)
        ok("and 8 channels are asked for in blocks of BLOCK_FRAMES samples at most, the whole stretch read",
           len(loud_enough) == 3 * alignment.BLOCK_FRAMES // 8 + 5 and len(wide_wav.asked) == 4
           and max(wide_wav.asked) * 8 <= alignment.BLOCK_FRAMES)

        # Drum hits are not clicks: a noise burst that takes 3 ms to rise and rings
        # for 150 ms, hard and soft, on irregular beats, over a little hiss. The
        # onset is where the hit rises, to within a millisecond or so.
        rng = np.random.default_rng(11)
        hits = np.round((np.cumsum(rng.uniform(0.3, 1.2, 40)) + 0.3) * 48000) / 48000
        kit = kit10(hits, rng.uniform(0.15, 0.9, len(hits)), 0.003, 0.05)
        drum_take = take10({"Drums.wav": (kit, 48000, "pcm24"), "Drums.mid": [t + 0.003 for t in hits]})
        got = windows10(run10(drum_take)[1])
        ok("drum hits that rise over 3 ms, hard and soft, are found: all 40, a median within a millisecond of 3 ms",
           len(got) == 1 and got[0][:2] == (40, 40) and abs(got[0][2] - 3.0) < 1.0)
        ok("and the worst of them is within 2.5 ms of the median", len(got) == 1 and abs(got[0][3] - got[0][2]) < 2.5)

        # A hit is found where it starts, not where it has risen. With the notes at
        # the exact start of each hit, the figures are how far the audio's onset is
        # after it: a share of the rise. Soft hits that take 10 ms to rise are the
        # hard case, for the frame that catches them comes late in the rise.
        # One in four is hard (0.9) and the rest soft (0.07, about 8% of it).
        soft_at = np.round((0.5 + 0.7 * np.arange(36)) * 48000) / 48000
        soft_amps = np.where(np.arange(36) % 4 == 0, 0.9, 0.07)
        soft_take = take10({"Drums.wav": (kit10(soft_at, soft_amps, 0.010, 0.08, seed=3), 48000, "pcm24"),
                            "Drums.mid": list(soft_at)})
        got = windows10(run10(soft_take)[1])
        ok("soft hits, about 8% of the loudest of the minute, that rise over 10 ms: all 36 found, the worst within 3 ms",
           len(got) == 1 and got[0][:2] == (36, 36) and abs(got[0][3]) < 3.0)
        # Drums ring into the next hit: 100 ms decay, a hit every 0.2 s give or take
        # 40%, 0.3 to 0.9 loud. A hit soon after a louder one can be missed (it has
        # to stand four times above the ring), and the count says how many; those
        # found are placed at their start, not up to 28 ms into it.
        gaps = np.random.default_rng(12).uniform(0.12, 0.28, 110)
        ring_at = np.round((1.0 + np.cumsum(gaps)[np.cumsum(gaps) < 20.0]) * 48000) / 48000
        ring_amps = np.random.default_rng(112).uniform(0.3, 0.9, len(ring_at))
        ring_take = take10({"Drums.wav": (kit10(ring_at, ring_amps, 0.003, 0.1, seed=212), 48000, "pcm24"),
                            "Drums.mid": list(ring_at)})
        got = windows10(run10(ring_take)[1])
        ok("a ringing, irregular pattern: more than half its hits are found, and the worst is within 3 ms",
           len(got) == 1 and got[0][0] > got[0][1] / 2 and abs(got[0][3]) < 3.0)
        # The other way: a hit must not be placed before it starts. A soft tone that
        # rings for 400 ms (0.18 loud), and 52 to 55 ms after it a hit five times as
        # loud: the ring is still over the level before the second hit, and it must
        # not be taken for its start, which would put the onset up to 46 ms early (it
        # does, 46 ms, with the line at 1.5 times the level and this seed).
        pair_gaps = (0.052, 0.053, 0.054, 0.055, 0.052, 0.054)
        pair_at = np.array([(1.0 + 2.5 * k, 1.0 + 2.5 * k + gap) for k, gap in enumerate(pair_gaps)]).ravel()
        pair_at = np.round(pair_at * 48000) / 48000
        pair_take = take10({"Drums.wav": (kit10(pair_at, [0.18, 0.9] * len(pair_gaps), 0.003, 0.4, seed=101, tone=200),
                                         48000, "pcm24"),
                            "Drums.mid": list(pair_at)})
        got = windows10(run10(pair_take)[1])
        ok("a ringing tone and a hit five times louder 52 to 55 ms after it: both found, and neither early, the worst within 3 ms",
           len(got) == 1 and got[0][:2] == (12, 12) and abs(got[0][3]) < 3.0)

        # A low rumble under soft hits: 60 Hz noise at -40 dBFS (0.01), about as loud
        # as the softest hits, and varying as slowly as their rise does, so that the
        # rise was followed back into it. 60 hits, 0.05 to 0.9 loud. This is one such
        # take, a favourable one (1.5 ms), and the check is that the high-pass is
        # there (without it, 6.6 ms). It is not the tool's figure for a rumble: over
        # thirty other takes at this level the worst is 2.6 ms at the median and up
        # to 5, with 11 of the 30 over 3; without the high-pass, 27 of the 30.
        rumble_amps = np.exp(np.random.default_rng(23).uniform(np.log(0.05), np.log(0.9), 60))
        rumble_amps[0] = 0.9
        rumble_at = np.round((0.5 + 0.7 * np.arange(60)) * 48000) / 48000
        rumble_take = take10({"Drums.wav": (kit10(rumble_at, rumble_amps, 0.003, 0.08, hiss=0.0003, seed=523,
                                                   rumble=(60, 0.01)), 48000, "pcm24"),
                              "Drums.mid": list(rumble_at)})
        got = windows10(run10(rumble_take)[1])
        ok("a 60 Hz rumble about as loud as the soft hits (one take): nearly all are found, and the worst is within 3 ms, as it is not without the high-pass",
           len(got) == 1 and got[0][0] >= 0.9 * got[0][1] and abs(got[0][3]) < 3.0)

        # How far a note may be from an onset and still be its own.
        samples, clicks = clicks10(10.0)
        far = take10({"Drums.wav": (samples, 48000, "pcm16"), "Drums.mid": [t + 0.3 for t in clicks]})
        code, out, err, plain = run10(far)
        ok("notes 300 ms late are nearer the next click than their own, and beyond the 100 ms window: none matched",
           code == 0 and "matched 0 of 20 notes" in out and not windows10(out))
        ok("and it says so, with the window: none within 100 ms of an onset",
           "none within 100 ms of an onset" in out)
        out = run10(far, "--max-ms", 250)[1]
        got = windows10(out)
        ok("--max-ms 250 takes them for the click after, 200 ms early, but for the last note, which has none after it",
           len(got) == 1 and got[0][:2] == (19, 20) and abs(got[0][2] + 200.0) < 0.6)
        two = take10({"Drums.wav": (samples, 48000, "pcm16"),
                      "Drums.mid": sorted([t + 0.003 for t in clicks] + [t + 0.004 for t in clicks])})
        got = windows10(run10(two)[1])
        ok("two notes at one click are one hit: the nearer is matched and the other is not",
           len(got) == 1 and got[0][:2] == (20, 40))

        # Which WAV a .mid belongs to.
        samples, clicks = clicks10(10.0)
        keys_at = [t + 0.003 for t in clicks]
        mixed = take10({"Drums.wav": (samples, 48000, "pcm16"), "Drums.mid": keys_at, "Keys.mid": keys_at})
        code, out, err, plain = run10(mixed)
        ok("a .mid with no WAV of its name is not guessed at: it says to pick one with --wav, and names the WAVs",
           "Keys.mid" in err and "--wav" in err and "Drums.wav" in err)
        ok("the Both track beside it is measured all the same, and the exit is clean",
           code == 0 and "Drums.mid" in out and len(windows10(out)) == 1)
        code, out, err, plain = run10(mixed, "--wav", "Drums.wav")
        ok("--wav Drums.wav measures the other .mid against it too",
           code == 0 and len(windows10(out)) == 2 and "Keys.mid" in out and not err)
        code, out, err, plain = run10(mixed, "--wav", "Nothing.wav")
        ok("--wav with a name that is not there is refused, plainly", code != 0 and "Nothing.wav" in err)
        keys_only = take10({"Drums.wav": (samples, 48000, "pcm16"), "Keys.mid": keys_at})
        code, out, err, plain = run10(keys_only)
        ok("and a folder where no .mid can be paired exits non-zero, saying which WAV to pick",
           code != 0 and "--wav" in err and "Drums.wav" in err and not windows10(out))

        # Nothing to measure.
        nothing = root10 / "empty"
        nothing.mkdir()
        code, out, err, plain = run10(nothing)
        ok("a folder with no .mid exits non-zero and says so", code != 0 and ".mid" in err and not out)
        samples, clicks = clicks10(5.0)
        notes_only = take10({"Keys.mid": [t + 0.003 for t in clicks]})
        code, out, err, plain = run10(notes_only)
        ok("a folder with a .mid and no WAV exits non-zero and says so", code != 0 and ".wav" in err and not out)
        code, out, err, plain = command10(root10 / "not-there")
        ok("a folder that is not there exits non-zero and says so", code != 0 and "not-there" in err)
        code, out, err, plain = command10()
        ok("no folder given is a usage error that says how to run it, not a traceback",
           code != 0 and "usage" in err.lower() and "Traceback" not in err)

        # A track named in another script keeps the output plain.
        samples, clicks = clicks10(5.0)
        stem10 = "Pa" + chr(0x142) + "yn"  # Palyn with an l-stroke, which cp1252 cannot print
        polish = take10({stem10 + ".wav": (samples, 48000, "pcm16"), stem10 + ".mid": [t + 0.003 for t in clicks]})
        code, out, err, plain = command10(polish)
        escaped = ascii(stem10)[1:-1]  # Pa, a backslash, u0142, yn
        ok("a track whose name has a letter outside ASCII is measured and the output stays ASCII, "
           "the letter written as its escape",
           code == 0 and plain and escaped + ".mid" in out and escaped != stem10 and len(windows10(out)) == 1)
        # Names in Cyrillic, which this app is written for, stay apart on a console that has none.
        names10 = ["".join(map(chr, letters)) for letters in ((0x411, 0x430, 0x441), (0x421, 0x43E, 0x43B, 0x43E))]
        cyrillic = take10({f"{name}.{kind}": ((samples, 48000, "pcm16") if kind == "wav" else [t + 0.003 for t in clicks])
                           for name in names10 for kind in ("wav", "mid")})
        code, out, err, plain = run10(cyrillic)
        ok("two tracks named in Cyrillic are measured and told apart in plain ASCII, not both as ?s",
           code == 0 and plain and "?" not in out
           and all(ascii(name)[1:-1] + ".mid against" in out for name in names10) and len(windows10(out)) == 2)
        broken = take10({"Drums.wav": (samples, 48000, "pcm16")})
        (broken / "Drums.mid").write_bytes(b"not a midi file")
        code, out, err, plain = run10(broken)
        ok("a .mid that cannot be read is named, with no traceback, and nothing measured exits non-zero",
           code != 0 and "Drums.mid" in err and "Traceback" not in err)

        # libsndfile missing: soundfile raises OSError, not ImportError, when it imports.
        real_import = builtins.__import__

        def no_libsndfile(name, *args, **kwargs):
            if name == "soundfile":
                raise OSError("sndfile library not found using ctypes.util.find_library")
            return real_import(name, *args, **kwargs)

        builtins.__import__ = no_libsndfile
        try:
            code, out, err, plain = run10(late)
        finally:
            builtins.__import__ = real_import
        ok("a soundfile that will not import, for want of libsndfile, is said plainly, with no traceback",
           code != 0 and "soundfile" in err and "pip install" in err and "Traceback" not in err and not out)

        tool_source = tool10.read_text(encoding="utf-8") if tool10.exists() else ""
        tool_imports = {n.names[0].name if isinstance(n, ast.Import) else n.module
                        for n in ast.walk(ast.parse(tool_source)) if isinstance(n, (ast.Import, ast.ImportFrom))}
        ok("the tool reads the .mid through the app's own smf and imports neither mido nor the MIDI library",
           "rehearsal_recorder.midi.smf" in tool_imports and not tool_imports & {"pylibremidi", "mido"})

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
