"""
Bouncing a take down to one stereo .wav.

This is what gets shared: the drummer's phone is not going to open eight
separate files. The per-track volumes the band set while listening back are
applied, because that balance is the whole point of having listened.

Memory stays bounded — the tracks are read in chunks through the same memmap
the player uses, so a twenty-minute take costs no more than a short one.
"""

import wave
from pathlib import Path

import numpy as np

from rehearsal_recorder.audio.format import unpack24
from rehearsal_recorder.audio.player import _open_track

CHUNK = 1 << 16

# The sum of several tracks goes over full scale easily, so the mix is scaled
# down to sit just under it. A little headroom keeps the peak from landing on
# the very last bit.
TARGET_PEAK = 0.97


def mixdown(tracks, out_path, volumes=None):
    """
    tracks:  [{"name":.., "file":..}] — the tracks of one take
    volumes: {name: 0..1}, the balance from the player; missing names get 1.0

    Returns {"ok", "file", "duration_sec", "gain"}. gain is what had to be
    applied to keep the mix from clipping: 1.0 means nothing was touched.
    """
    if not tracks:
        return {"ok": False, "error": "No tracks"}

    volumes = volumes or {}
    opened = []
    samplerate = None
    for t in tracks:
        try:
            data, frames, rate, sample_bytes = _open_track(t["file"])
        except Exception as e:
            return {"ok": False, "error": f"{Path(t['file']).name}: {e}"}
        if samplerate is None:
            samplerate = rate
        gain = float(volumes.get(t["name"], 1.0))
        # The mix is 16-bit — it is what gets sent to people, and every phone
        # plays it. A 24-bit source is scaled down to that range on the way
        # in, so tracks of different depths sum correctly.
        scale = (1.0 / 256.0) if sample_bytes == 3 else 1.0
        opened.append((data, frames, max(0.0, min(1.0, gain)) * scale, sample_bytes))

    total = max(frames for _, frames, _, _ in opened)
    if total == 0:
        return {"ok": False, "error": "The take is empty"}

    # First pass: how loud does the sum actually get? Guessing from the peaks
    # of the separate tracks would be far too pessimistic — they do not all
    # peak at the same instant.
    peak = 0.0
    for start in range(0, total, CHUNK):
        acc = _sum_chunk(opened, start, min(CHUNK, total - start))
        peak = max(peak, float(np.abs(acc).max()))

    limit = 32767.0
    gain = 1.0 if peak <= limit * TARGET_PEAK else (limit * TARGET_PEAK) / peak

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(samplerate)
        for start in range(0, total, CHUNK):
            acc = _sum_chunk(opened, start, min(CHUNK, total - start)) * gain
            mono = np.clip(np.rint(acc), -32768, 32767).astype("<i2")
            w.writeframes(np.repeat(mono, 2).tobytes())

    return {
        "ok": True,
        "file": str(out_path),
        "duration_sec": total / samplerate,
        "gain": round(gain, 4),
    }


def _sum_chunk(opened, start, length):
    acc = np.zeros(length, dtype=np.float32)
    for data, frames, gain, sample_bytes in opened:
        if start >= frames or gain == 0.0:
            continue  # this track has already ended, or is turned all the way down
        end = min(start + length, frames)
        piece = data[start:end]
        if sample_bytes == 3:
            whole = np.zeros(end - start, dtype=np.int32)
            unpack24(np.ascontiguousarray(piece), whole)
            piece = whole
        acc[: len(piece)] += piece.astype(np.float32) * gain
    return acc
