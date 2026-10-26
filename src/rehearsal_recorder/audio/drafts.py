"""
Recovering takes that were never saved.

While a take is being recorded it lives as raw PCM inside the rehearsal's
drafts folder; it only becomes .wav when you press stop. So if the app is
killed mid-take, the audio is on disk but in a form nothing plays yet.

A take's notes are in the same case: a .midraw per track that takes notes
(midi/capture.py), which only becomes a .mid when the take is stopped or
recovered.

A take recorded to the click is cut on its grid as Stop would have cut it: its
files start at the first click of its count-in, which take.json says, and carry
its tempo (metronome spec, Parts 1 and 3). Where it ends is where the app died.
One with a backing track that was heard gets its Backing track from take.json
too, written from the file as Stop would have written it (backing-track spec,
Part 4).

This module finds those leftovers and turns them back into normal takes.
"""

import json
import wave
from pathlib import Path

from rehearsal_recorder.audio.backing_file import open_ready, write_take_track
from rehearsal_recorder.audio.capture import (
    RAW_SUFFIX,
    TAKE_RECORD,
    raw_to_wav,
    safe_name,
)
from rehearsal_recorder.activity import Stages
from rehearsal_recorder.audio.format import bytes_per_sample
from rehearsal_recorder.audio.take_click import cut_of, whole
from rehearsal_recorder.midi.capture import MID_SUFFIX, MIDRAW_SUFFIX, finish_draft

DRAFTS_DIR = "_drafts"


def _widths(take_dir):
    """How many channels each raw file holds, by its file stem. Empty for a
    take recorded before the record was written, whose tracks are all mono."""
    try:
        record = json.loads((Path(take_dir) / TAKE_RECORD).read_text("utf-8"))
        return {t["file"]: int(t.get("channels", 1)) for t in record["tracks"]}
    except Exception:
        return {}


def _cut(take_dir):
    """Where a draft's raw files are cut: (first frame, frames or None, Acid or
    None), from the click in its take.json (take_click.cut_of)."""
    try:
        record = json.loads((Path(take_dir) / TAKE_RECORD).read_text("utf-8"))
        return cut_of(record.get("click") if isinstance(record, dict) else None)
    except Exception:
        return 0, None, None


def _kept(count, head, frames):
    """How many of a raw file's `count` frames its .wav keeps."""
    left = max(0, count - head)
    return left if frames is None else min(left, frames)


def _backing(take_dir):
    """The backing track take.json says the take heard: ({"file", "from_frame",
    "name"}, its Backing track's path), or None. Only for a take cut on its
    grid: without a first frame there is nothing to place it by."""
    try:
        record = json.loads((Path(take_dir) / TAKE_RECORD).read_text("utf-8"))
        backing = record.get("backing")
        first = record["click"]["first_click_frame"]
        if (not isinstance(backing, dict) or not whole(first) or first < 0
                or not whole(backing.get("from_frame")) or not isinstance(backing.get("name"), str)
                or not isinstance(backing.get("file"), str)):
            return None
    except Exception:
        return None
    return backing, Path(take_dir) / f"{safe_name(backing['name'])}.wav"


def _names(take_dir, kind):
    """The track each of a take's files of `kind` ("tracks" for the audio,
    "notes") belongs to, by its file stem, as take.json records it: "Synth_Pad"
    is the track "Synth/Pad". Empty for a take recorded before the record named
    its tracks, whose files go by their own names, as they always have."""
    try:
        record = json.loads((Path(take_dir) / TAKE_RECORD).read_text("utf-8"))
        return {e["file"]: e["name"] for e in record[kind]
                if isinstance(e.get("name"), str) and e["name"]}
    except Exception:
        return {}


def icons(take_dir):
    """The icon of each of a take's tracks by name, its notes' too, as
    take.json records them. Empty for a take recorded before the record kept
    them."""
    try:
        record = json.loads((Path(take_dir) / TAKE_RECORD).read_text("utf-8"))
        return {e["name"]: e["icon"] for kind in ("tracks", "notes") for e in record.get(kind) or []
                if isinstance(e, dict) and isinstance(e.get("name"), str)
                and isinstance(e.get("icon"), str) and e["icon"]}
    except Exception:
        return {}


def draft_dirs(rehearsal_folder):
    """Every draft take folder inside a rehearsal that still holds audio."""
    drafts_root = Path(rehearsal_folder) / DRAFTS_DIR
    if not drafts_root.is_dir():
        return []

    found = []
    for take_dir in sorted(drafts_root.iterdir()):
        if take_dir.is_dir() and has_audio(take_dir):
            found.append(take_dir)
    return found


def has_audio(folder):
    """Raw counts as audio too — that is exactly the crashed-take case. So do
    a take's notes, unfinished or made: a take whose only recording is notes is
    not empty, and stays listed after a recovery that found no audio has made
    its .midraw into a .mid. A half-made .mid.part is not a recording."""
    folder = Path(folder)
    return (any(folder.rglob("*.wav")) or any(folder.rglob(f"*{RAW_SUFFIX}"))
            or any(folder.rglob(f"*{MIDRAW_SUFFIX}")) or any(folder.rglob(f"*{MID_SUFFIX}")))


def wav_frames(path):
    """How long a .wav is, in frames, from its own header. A take that was
    stopped but never saved is already .wav — its length is not in the size
    of a raw file any more."""
    try:
        with wave.open(str(path), "rb") as w:
            return w.getnframes()
    except (OSError, EOFError, wave.Error):
        return 0


def describe(take_dir, samplerate, bit_depth=16):
    """What the interface shows about a recoverable draft."""
    take_dir = Path(take_dir)
    tracks = []
    unmade, made = set(), set()  # notes files not yet a .mid, and ones that are; a .mid.part is neither
    frames = 0
    head, length, _ = _cut(take_dir)

    for path in sorted(take_dir.iterdir()):
        if path.suffix == MIDRAW_SUFFIX:
            unmade.add(path.stem)
        elif path.suffix == MID_SUFFIX:
            made.add(path.stem)
        elif path.suffix == RAW_SUFFIX:
            track_frames = path.stat().st_size // (
                bytes_per_sample(bit_depth) * _widths(take_dir).get(path.stem, 1)
            )
            frames = max(frames, _kept(track_frames, head, length))
            tracks.append(path.stem)
        elif path.suffix == ".wav":
            frames = max(frames, wav_frames(path))
            tracks.append(path.stem)

    return {
        "dir": str(take_dir),
        "name": take_dir.name,
        "tracks": tracks,
        "notes": sorted(unmade | made),
        "duration_sec": frames / samplerate if samplerate else 0,
    }


def finalize(take_dir, samplerate, bit_depth=16, progress=None):
    """
    Turns raw files into .wav in place and returns the track list in the same
    shape stop_take() produces, so the rest of the app cannot tell the
    difference between a recovered take and a normally stopped one. The notes
    files become .mid the same way, and a .mid that stop had already made is
    listed with them: "notes", apart from the audio "tracks". Each is named as
    its track where take.json records the name, so a Both track's audio and
    its notes come back under the one name, as Stop gives them; otherwise by
    its file.

    take.json is left where it is: a recovery whose files then fail to move
    is tried again with it, and the draft's folder goes, with it, once the
    take is kept.

    A click take's raw files are cut at its first click, as Stop cuts them,
    and the length handed on to its notes is counted from there. A .wav that
    Stop made is already cut.

    A take that heard a backing track gets its Backing track as Stop writes
    it, from the ready file take.json names, if Stop did not write it and
    that file is still there: "backing", {"name", "file"} or None, apart from
    the band's tracks.

    `progress(fraction, step)`, when given, hears how far along it is, the
    tracks weighed by their size, and a Backing track still to write last,
    weighed as the longest of them.
    """
    take_dir = Path(take_dir)
    tracks = []
    frames = 0

    widths = _widths(take_dir)
    head, length, acid = _cut(take_dir)
    track_names, note_names = _names(take_dir, "tracks"), _names(take_dir, "notes")
    raws = sorted(take_dir.glob(f"*{RAW_SUFFIX}"))
    backing = _backing(take_dir)
    parts = [(f"Track {i + 1} of {len(raws)}", p.stat().st_size) for i, p in enumerate(raws)]
    if backing is not None and not backing[1].exists():
        parts.append(("Backing track", max((size for _, size in parts), default=0)))
    stages = Stages(parts, progress or (lambda fraction, step: None))
    for i, raw_path in enumerate(raws):
        wav_path = raw_path.with_suffix(".wav")
        channels = widths.get(raw_path.stem, 1)
        frames = max(
            frames,
            _kept(raw_path.stat().st_size // (bytes_per_sample(bit_depth) * channels), head, length),
        )
        raw_to_wav(raw_path, wav_path, samplerate, bit_depth, channels=channels,
                   progress=stages.part(i), head_frames=head, frames=length, acid=acid)
        raw_path.unlink(missing_ok=True)

    for wav_path in sorted(take_dir.glob("*.wav")):
        if backing is not None and wav_path.name == backing[1].name:
            continue
        frames = max(frames, wav_frames(wav_path))
        tracks.append({"name": track_names.get(wav_path.stem, wav_path.stem), "file": str(wav_path)})
    if backing is not None:
        backing = _write_backing(backing, frames, samplerate, bit_depth, stages.part(len(raws)))

    duration = frames / samplerate if samplerate else 0
    notes = [{**n, "name": note_names.get(n["name"], n["name"])}
             for n in finish_draft(take_dir, duration, samplerate)]

    return {
        "tracks": tracks,
        "notes": notes,
        "duration_sec": duration,
        "backing": backing,
    }


def _write_backing(backing, frames, samplerate, bit_depth, progress):
    """A recovered take's Backing track: {"name", "file"}, written unless Stop
    wrote it; None when it cannot be, its ready file gone or unreadable."""
    record, path = backing
    if not path.exists():
        try:
            write_take_track(open_ready(record["file"]), record["from_frame"], frames, path,
                             samplerate, bytes_per_sample(bit_depth), progress)
        except (OSError, ValueError) as e:
            print(f"[drafts] Backing track not written: {e}")
            path.unlink(missing_ok=True)
            return None
    return {"name": record["name"], "file": str(path)}
