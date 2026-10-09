"""
Recovering takes that were never saved.

While a take is being recorded it lives as raw PCM inside the rehearsal's
drafts folder; it only becomes .wav when you press stop. So if the app is
killed mid-take, the audio is on disk but in a form nothing plays yet.

A take's notes are in the same case: a .midraw per track that takes notes
(midi/capture.py), which only becomes a .mid when the take is stopped or
recovered.

This module finds those leftovers and turns them back into normal takes.
"""

import json
import wave
from pathlib import Path

from rehearsal_recorder.audio.capture import (
    RAW_SUFFIX,
    TAKE_RECORD,
    raw_to_wav,
)
from rehearsal_recorder.activity import Stages
from rehearsal_recorder.audio.format import bytes_per_sample
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
    a take's unfinished notes: a take whose only recording is notes is not empty."""
    folder = Path(folder)
    return (any(folder.rglob("*.wav")) or any(folder.rglob(f"*{RAW_SUFFIX}"))
            or any(folder.rglob(f"*{MIDRAW_SUFFIX}")))


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

    for path in sorted(take_dir.iterdir()):
        if path.suffix == MIDRAW_SUFFIX:
            unmade.add(path.stem)
        elif path.suffix == MID_SUFFIX:
            made.add(path.stem)
        elif path.suffix == RAW_SUFFIX:
            track_frames = path.stat().st_size // (
                bytes_per_sample(bit_depth) * _widths(take_dir).get(path.stem, 1)
            )
            frames = max(frames, track_frames)
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
    listed with them: "notes", apart from the audio "tracks".

    `progress(fraction, step)`, when given, hears how far along it is, the
    tracks weighed by their size.
    """
    take_dir = Path(take_dir)
    tracks = []
    frames = 0

    widths = _widths(take_dir)
    raws = sorted(take_dir.glob(f"*{RAW_SUFFIX}"))
    stages = Stages(
        [(f"Track {i + 1} of {len(raws)}", p.stat().st_size)
         for i, p in enumerate(raws)],
        progress or (lambda fraction, step: None),
    )
    for i, raw_path in enumerate(raws):
        wav_path = raw_path.with_suffix(".wav")
        channels = widths.get(raw_path.stem, 1)
        frames = max(
            frames,
            raw_path.stat().st_size // (bytes_per_sample(bit_depth) * channels),
        )
        raw_to_wav(raw_path, wav_path, samplerate, bit_depth, channels=channels,
                   progress=stages.part(i))
        raw_path.unlink(missing_ok=True)

    for wav_path in sorted(take_dir.glob("*.wav")):
        frames = max(frames, wav_frames(wav_path))
        tracks.append({"name": wav_path.stem, "file": str(wav_path)})

    duration = frames / samplerate if samplerate else 0
    # Before the record goes: it says which port each notes file came from.
    notes = finish_draft(take_dir, duration, samplerate)
    (take_dir / TAKE_RECORD).unlink(missing_ok=True)

    return {
        "tracks": tracks,
        "notes": notes,
        "duration_sec": duration,
    }
