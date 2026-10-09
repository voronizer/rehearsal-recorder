"""
A take's .mid read back as the notes the player draws (Part 6): a grid of
drum rows for a kit, a piano roll for anything else.

It works from `smf.read_events`, which has already put the file's own ticks and
tempo changes into seconds, so it needs neither mido nor the MIDI library and
runs with nothing plugged in.

The notes of a whole take are sent to the player at once and zooming asks for
nothing again, so an answer is kept small: a note is four plain numbers,
[t, d, row or pitch, velocity], and the seconds are rounded to the microsecond,
far finer than a tick of the file (a 1920th of a second). That is about 27
characters of JSON a note, where the unrounded floats would make it 48 (and a
length of 0.1 s can come out as 0.09999999999999998). An hour with 40000
notes is about a megabyte.
"""

from collections import deque

from rehearsal_recorder.midi.smf import read_events

# The rows of the drum grid, top to bottom as the player draws them. A note's
# row is its index here, and the row after the last is Other.
DRUM_ROWS = ["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"]
OTHER = "Other"
_CRASH, _RIDE, _HIHAT, _TOMS, _SNARE, _KICK = range(len(DRUM_ROWS))
_OTHER = len(DRUM_ROWS)

# Which row each note lands on: the General MIDI drum map, and beside it the
# notes e-kits use. On a TD-17, 22 and 26 are the hi-hat's edge, 40 the snare's
# rim and 58 the rim of tom 3 (General MIDI calls 58 a vibraslap). A note not
# here goes to Other; the row is shown only in a take that has one.
DRUM_MAP = {
    36: _KICK,
    38: _SNARE, 40: _SNARE, 37: _SNARE,
    42: _HIHAT, 44: _HIHAT, 46: _HIHAT, 22: _HIHAT, 26: _HIHAT,
    48: _TOMS, 50: _TOMS, 45: _TOMS, 47: _TOMS, 43: _TOMS, 58: _TOMS,
    51: _RIDE, 53: _RIDE, 59: _RIDE,
    49: _CRASH, 55: _CRASH, 57: _CRASH, 52: _CRASH,
}

# The General MIDI drum channel: channel 10 counted from 1, 9 in a status byte.
_DRUM_CHANNEL = 9

# What a take with no notes at all gets for a piano roll: the octave from
# middle C (60) up to the B above it, so the lane has something to draw under.
_EMPTY_LOW, _EMPTY_HIGH = 60, 71

_NOTE_OFF, _NOTE_ON = 0x80, 0x90


def read_notes(path, drums_icon: bool) -> dict:
    """
    The notes of the .mid at `path`, for the player.

    For drums, `{"drums": True, "rows": DRUM_ROWS, "notes": [[t, d, row, vel]]}`:
    `row` is the index into `rows`, which gains "Other" as its last only when a
    note outside DRUM_MAP is used. Otherwise `{"drums": False, "low": int,
    "high": int, "notes": [[t, d, pitch, vel]]}`: `low` and `high` are the
    notes the roll covers, rounded out to whole octaves from C to B (61 and 74
    give 60 and 83; the top is 127, where MIDI stops, and not the B above it),
    and a take with no notes gets 60 to 71. `t` and `d` are seconds from the
    take's start and how long the note was held, `vel` the note-on's, 1 to 127.
    The notes are in the order they began.

    It is drums when `drums_icon` says the track has the drums icon, or, without
    it, when the notes are on MIDI channel 10: when every note-on is on channel
    10, and there is at least one. One note-on elsewhere makes the file pitched.
    Drummers do move a kit off channel 10, which is what the icon is for, but
    a keyboard whose pads are on 10 and keys are not is no kit, and the grid
    would push its keys into rows. A release or a velocity 0 note-on on another
    channel is no note-on and does not count.

    A release closes the oldest note still sounding on its channel and note
    (first in, first out), so a fast roll on one note, where an e-kit ends each
    hit about 0.1 s after it, gives notes of 0.1 s that overlap and not one long
    and one short. A note-on at velocity 0 is a release, as MIDI has it, and a
    release with no note sounding is passed over. A note never released lasts
    to the time of the file's last event, of any kind, a controller included;
    the end-of-track mark is not an event `read_events` gives, so a note struck
    as the very last event is 0 long. The player has to give such a bar a width
    it can see.

    Raises whatever `read_events` does for a file that is not a readable .mid;
    the caller decides how to say it.
    """
    _, events = read_events(path)
    end = events[-1][0] if events else 0.0

    notes = []        # [t, d, note, vel], in the order the notes began
    sounding = {}     # (channel, note) -> [(seconds, the note)] begun and not released, oldest first
    on_channels = set()
    for seconds, data in events:
        kind = data[0] & 0xF0
        if kind != _NOTE_ON and kind != _NOTE_OFF:  # SysEx and the rest are 0xF0, and are not notes
            continue
        key = (data[0] & 0x0F, data[1])
        if kind == _NOTE_ON and data[2] > 0:
            note = [round(seconds, 6), 0.0, data[1], data[2]]
            notes.append(note)
            sounding.setdefault(key, deque()).append((seconds, note))
            on_channels.add(key[0])
        elif sounding.get(key):
            began, note = sounding[key].popleft()
            note[1] = round(seconds - began, 6)
    for held in sounding.values():
        for began, note in held:
            note[1] = round(end - began, 6)

    if drums_icon or on_channels == {_DRUM_CHANNEL}:
        for note in notes:
            note[2] = DRUM_MAP.get(note[2], _OTHER)
        rows = DRUM_ROWS + [OTHER] if any(note[2] == _OTHER for note in notes) else list(DRUM_ROWS)
        return {"drums": True, "rows": rows, "notes": notes}

    if not notes:
        return {"drums": False, "low": _EMPTY_LOW, "high": _EMPTY_HIGH, "notes": notes}
    pitches = [note[2] for note in notes]
    return {"drums": False,
            "low": min(pitches) // 12 * 12,
            "high": min(max(pitches) // 12 * 12 + 11, 127),
            "notes": notes}
