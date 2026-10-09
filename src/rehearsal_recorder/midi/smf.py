"""
The notes of one take as a Standard MIDI File: what such a file can hold,
writing one, and reading one back (spec F2 and F4).

It imports mido and never touches the MIDI library: it is given bytes and
times, so it runs with nothing plugged in.

The file is format 0, 960 ticks to the beat, at 120 bpm (D8), so a tick is a
1920th of a second. The tempo is fixed by this module, which is why a time in
seconds and a tick are the same fact here and never need the file's own tempo
map to be read.

A .mid holds channel messages, SysEx and its own meta events, and nothing else.
mido does not stop all of what a port sends from being written (it refuses
clock and a few others and the save fails; active sensing, song position and
time code it writes as they are, and a reset it writes as the start of a meta
event, which not even mido can read back), so what is kept is decided here, by
`storable`, and the rest is left out and counted, never fatal.
"""

import logging
import threading
from pathlib import Path

import mido

log = logging.getLogger(__name__)

TICKS_PER_BEAT = 960
TEMPO = 500_000  # microseconds to the beat: 120 bpm
TICKS_PER_SEC = 1920  # 960 ticks to the beat, two beats a second

# mido writes and reads the text of a name in a charset it keeps in a module
# variable, set for the length of a save or a load and put back after. Two
# going at once (two ports' files written together) would put it back under
# each other, and a name could then be written in Latin-1 after all.
_CHARSET_LOCK = threading.Lock()


def storable(data) -> bool:
    """
    Whether a .mid can hold these bytes as they are: a channel message (status
    0x80-0xEF) of the right length for its kind, two bytes for a program change
    or channel pressure and three for the rest, every data byte under 0x80; or
    a whole SysEx, F0 ... F7 with every byte between under 0x80. Anything else
    is not: the system messages, a message cut short or run on, bytes with no
    status.
    """
    data = bytes(data)
    if not data:
        return False
    status = data[0]
    if 0x80 <= status <= 0xEF:
        size = 2 if 0xC0 <= status <= 0xDF else 3
        return len(data) == size and max(data[1:]) < 0x80
    if status == 0xF0:
        return len(data) >= 2 and data[-1] == 0xF7 and max(data[1:-1], default=0) < 0x80
    return False


def _message(data, delta: int):
    """
    The mido message for these bytes, `delta` ticks after the one before; None
    for bytes that are not `storable`, and for any that mido refuses anyway. The
    check here is meant to be the whole of it, but mido has the last word and
    one event it will not take must cost only itself, never the take's file.
    """
    try:
        data = bytes(data)
        if not storable(data):
            return None
        if data[0] == 0xF0:
            return mido.Message("sysex", data=data[1:-1], time=delta)
        return mido.Message.from_bytes(data, time=delta)
    except Exception:
        return None


def _text(name: str) -> str:
    """A name the file can hold in UTF-8: a lone surrogate, which no encoding
    holds, becomes "?" rather than failing the save."""
    return name.encode("utf-8", "replace").decode("utf-8")


def write_mid(path, *, track_name: str, port_name: str, start: list[bytes],
              events: list[tuple[float, bytes]]) -> int:
    """
    Writes the take's notes to `path` and returns how many events were left
    out, the start messages among them. An event the file cannot hold is
    skipped and the rest are written: it never costs the take its file.

    At tick 0 come the track's name, the port's name as the device name and 120
    bpm, then the `start` messages (the state the instrument was in when the
    take began, F6), then the `events`, each a (seconds from the take's start,
    bytes) pair. Names are written in UTF-8, so "Pałyn" and "Барабаны" are
    saved; a lone surrogate in one is written as "?".

    `events` are in time order, seconds from the start and not before it. Each
    event's tick is its own time times 1920, rounded; the delta is the
    difference between two ticks, never the sum of rounded deltas, so a long
    take does not drift. A caller that gets the order wrong still has its file:
    an event is never put before the one before it, so a time before the start
    is put at tick 0 and an event that comes late is put on the tick of the one
    it follows. A time that is not a number is skipped like a message that is
    not storable. The bytes of an event are kept as they are, the channel
    included.
    """
    track = mido.MidiTrack()
    track.append(mido.MetaMessage("track_name", name=_text(track_name)))
    track.append(mido.MetaMessage("device_name", name=_text(port_name)))
    track.append(mido.MetaMessage("set_tempo", tempo=TEMPO))

    skipped = 0
    for data in start:
        msg = _message(data, 0)
        if msg is None:
            skipped += 1
        else:
            track.append(msg)

    previous = 0
    for seconds, data in events:
        msg = None
        try:
            tick = max(previous, round(seconds * TICKS_PER_SEC))
            msg = _message(data, tick - previous)
        except (TypeError, ValueError, OverflowError):  # not a number, NaN, infinity
            pass
        if msg is None:
            skipped += 1
        else:
            track.append(msg)
            previous = tick

    mid = mido.MidiFile(type=0, ticks_per_beat=TICKS_PER_BEAT, charset="utf-8")
    mid.tracks.append(track)
    with _CHARSET_LOCK:
        mid.save(path)
    if skipped:
        log.info("%s: %d event(s) a .mid cannot hold left out", Path(path).name, skipped)
    return skipped


def read_events(path) -> tuple[dict, list[tuple[float, bytes]]]:
    """
    A file written by `write_mid`, read back as (names, events). `names` is
    {"track_name": ..., "device_name": ...}, "" for one the file lacks. `events`
    is every channel and SysEx event as (seconds from the take's start, bytes) in
    time order, the start messages first. A SysEx comes back whole, F0 ... F7.
    The seconds are the tick over 1920: the tempo is this module's, not the
    file's. Anything else in the file is passed over.
    """
    with _CHARSET_LOCK:
        mid = mido.MidiFile(path, charset="utf-8")
    metas = {}
    found = []
    for track in mid.tracks:
        tick = 0
        for msg in track:
            tick += msg.time
            if msg.is_meta:
                if msg.type in ("track_name", "device_name"):
                    metas.setdefault(msg.type, msg.name)
                continue
            if msg.type == "sysex":
                data = bytes([0xF0, *msg.data, 0xF7])
            else:
                data = bytes(msg.bytes())
            if storable(data):
                found.append((tick, data))
    found.sort(key=lambda event: event[0])  # one track: already in order
    names = {"track_name": metas.get("track_name", ""), "device_name": metas.get("device_name", "")}
    return names, [(tick / TICKS_PER_SEC, data) for tick, data in found]
