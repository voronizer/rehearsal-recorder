"""
Waveform peaks for the player.

Computed here rather than in the browser: the files are ours (plain PCM, 16 or
24 bit), numpy is already a dependency, and this way the interface never has to
decode the whole take just to draw a picture. One peak per bar is enough to
see where a track plays, where it is silent, and where it clipped.
"""

import wave

import numpy as np

from rehearsal_recorder.audio.format import unpack24

# Bars per track. ~900 covers the full window width.
DEFAULT_BUCKETS = 900

# How many bars to process at a time. This bounds memory: only
# BUCKETS_PER_BLOCK * (bar length) samples are held at once, not the file.
BUCKETS_PER_BLOCK = 64


def wav_peaks(path, buckets=DEFAULT_BUCKETS):
    """
    Returns (peaks, frames, samplerate) where peaks is a list of `buckets`
    values in 0..1: the maximum absolute level over that slice.
    """
    with wave.open(str(path), "rb") as wf:
        frames = wf.getnframes()
        samplerate = wf.getframerate()
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()

        if frames == 0 or sampwidth not in (2, 3):
            return [0.0] * buckets, frames, samplerate

        # Peaks are always reported in 0..1, so each depth is divided by its
        # own full scale and the picture looks the same either way.
        scale = 32768.0 if sampwidth == 2 else float(1 << 23)

        per_bucket = max(1, frames // buckets)
        peaks = np.zeros(buckets, dtype=np.float32)

        bucket = 0
        while bucket < buckets:
            take = min(BUCKETS_PER_BLOCK, buckets - bucket)
            raw = wf.readframes(per_bucket * take)
            if not raw:
                break

            if sampwidth == 2:
                arr = np.frombuffer(raw, dtype=np.int16)
                if channels > 1:
                    arr = arr.reshape(-1, channels).mean(axis=1).astype(np.int16)
            else:
                packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, channels, 3)
                whole = np.zeros(packed.shape[0], dtype=np.int32)
                unpack24(np.ascontiguousarray(packed[:, 0, :]), whole)
                arr = whole

            usable = (arr.size // per_bucket) * per_bucket
            if usable == 0:
                break

            block = np.abs(arr[:usable].reshape(-1, per_bucket).astype(np.float32))
            block_peaks = block.max(axis=1) / scale
            peaks[bucket:bucket + block_peaks.size] = block_peaks
            bucket += block_peaks.size

    return [round(float(p), 4) for p in peaks], frames, samplerate
