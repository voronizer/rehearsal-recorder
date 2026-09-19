"""
Recovering takes that were never saved.

While a take is being recorded it lives as raw PCM inside the rehearsal's
drafts folder; it only becomes .wav when you press stop. So if the app is
killed mid-take, the audio is on disk but in a form nothing plays yet.

This module finds those leftovers and turns them back into normal takes.
"""

from pathlib import Path

from rehearsal_recorder.audio.capture import RAW_SUFFIX, raw_to_wav
from rehearsal_recorder.audio.format import bytes_per_sample

DRAFTS_DIR = "_drafts"


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
    """Raw counts as audio too — that is exactly the crashed-take case."""
    folder = Path(folder)
    return any(folder.rglob("*.wav")) or any(folder.rglob(f"*{RAW_SUFFIX}"))


def describe(take_dir, samplerate, bit_depth=16):
    """What the interface shows about a recoverable draft."""
    take_dir = Path(take_dir)
    tracks = []
    frames = 0

    for path in sorted(take_dir.iterdir()):
        if path.suffix == RAW_SUFFIX:
            track_frames = path.stat().st_size // bytes_per_sample(bit_depth)
            frames = max(frames, track_frames)
            tracks.append(path.stem)
        elif path.suffix == ".wav":
            tracks.append(path.stem)

    return {
        "dir": str(take_dir),
        "name": take_dir.name,
        "tracks": tracks,
        "duration_sec": frames / samplerate if samplerate else 0,
    }


def finalize(take_dir, samplerate, bit_depth=16):
    """
    Turns raw files into .wav in place and returns the track list in the same
    shape stop_take() produces, so the rest of the app cannot tell the
    difference between a recovered take and a normally stopped one.
    """
    take_dir = Path(take_dir)
    tracks = []
    frames = 0

    for raw_path in sorted(take_dir.glob(f"*{RAW_SUFFIX}")):
        wav_path = raw_path.with_suffix(".wav")
        frames = max(
            frames, raw_path.stat().st_size // bytes_per_sample(bit_depth)
        )
        raw_to_wav(raw_path, wav_path, samplerate, bit_depth)
        raw_path.unlink(missing_ok=True)

    for wav_path in sorted(take_dir.glob("*.wav")):
        tracks.append({"name": wav_path.stem, "file": str(wav_path)})

    return {
        "tracks": tracks,
        "duration_sec": frames / samplerate if samplerate else 0,
    }
