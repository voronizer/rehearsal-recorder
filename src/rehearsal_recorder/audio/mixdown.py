"""
Bouncing a take down to one stereo .wav.

This is what gets shared: the drummer's phone is not going to open eight
separate files. The per-track volumes the band set while listening back are
applied, because that balance is the whole point of having listened.

Memory stays bounded — the tracks are read in chunks through the same memmap
the player uses, so a twenty-minute take costs no more than a short one.
"""

from pathlib import Path

import numpy as np

from rehearsal_recorder.audio.format import unpack24
from rehearsal_recorder.audio.wavfile import WavWriter, _open_track

CHUNK = 1 << 16

# The sum of several tracks goes over full scale easily, so the mix is scaled
# down to sit just under it. A little headroom keeps the peak from landing on
# the very last bit.
TARGET_PEAK = 0.97


class Stopped(Exception):
    """A count of a take's peak stopped by its `stop`: it is counted again
    from its start next time."""


def mix_peak(files, stop=None):
    """
    The loudest sample of a take's audio files added together, each at full
    level, as the mixdown's first pass adds them: 1.0 is full scale, and the
    sum of several tracks can go over it. sending/band_service.py sends it
    with the take, and the band service turns the take up by it
    (service/worker/takes/gain.ts), so the band's faders cannot take it over
    full scale there.

    None when a file cannot be opened, or there are none. `stop()`, asked
    before each chunk, raises Stopped when it answers true.
    """
    opened = _opened([{"name": "", "file": f} for f in files], {})
    if not isinstance(opened, list) or not opened:
        return None
    return _loudest(opened, stop=stop) / 32768.0


def mixdown(tracks, out_path, volumes=None, progress=None, acid=None):
    """
    tracks:  [{"name":.., "file":..}] — the tracks of one take
    volumes: {name: 0..1}, the balance from the player; missing names get 1.0
    acid:    a click take's tempo (audio/wavfile.Acid), for the mix to carry

    Returns {"ok", "file", "duration_sec", "gain"}. gain is what had to be
    applied to keep the mix from clipping: 1.0 means nothing was touched.

    `progress(fraction)`, when given, hears how far along it is: the pass
    that finds the peak is the first half, the pass that writes the second.
    """
    if not tracks:
        return {"ok": False, "error": "No tracks"}

    opened = _opened(tracks, volumes or {})
    if isinstance(opened, str):
        return {"ok": False, "error": opened}
    samplerate = opened[0][5]

    total = max(frames for _, frames, _, _, _, _ in opened)
    if total == 0:
        return {"ok": False, "error": "The take is empty"}

    peak = _loudest(
        opened,
        progress=None if progress is None else (lambda done: progress(0.5 * done)),
    )

    limit = 32767.0
    gain = 1.0 if peak <= limit * TARGET_PEAK else (limit * TARGET_PEAK) / peak

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with WavWriter(out_path, samplerate, 2, 2, acid) as w:
        for start in range(0, total, CHUNK):
            acc = _sum_chunk(opened, start, min(CHUNK, total - start)) * gain
            out = np.clip(np.rint(acc), -32768, 32767).astype("<i2")
            w.write(out.tobytes())
            if progress is not None:
                progress(0.5 + 0.5 * min(start + CHUNK, total) / total)

    return {
        "ok": True,
        "file": str(out_path),
        "duration_sec": total / samplerate,
        "gain": round(gain, 4),
    }


def _opened(tracks, volumes):
    """Each track opened for summing, as (data, frames, gain, sample_bytes,
    width, rate), or what went wrong with the first that would not open."""
    opened = []
    for t in tracks:
        try:
            data, frames, rate, sample_bytes, width = _open_track(t["file"])
        except Exception as e:
            return f"{Path(t['file']).name}: {e}"
        gain = float(volumes.get(t["name"], 1.0))
        # The mix is 16-bit — it is what gets sent to people, and every phone
        # plays it. A 24-bit source is scaled down to that range on the way
        # in, so tracks of different depths sum correctly.
        scale = (1.0 / 256.0) if sample_bytes == 3 else 1.0
        opened.append(
            (data, frames, max(0.0, min(1.0, gain)) * scale, sample_bytes, width, rate)
        )
    return opened


def _loudest(opened, progress=None, stop=None):
    """The first pass: how loud the sum actually gets, at 16-bit scale.
    Guessing from the peaks of the separate tracks would be far too
    pessimistic — they do not all peak at the same instant. `progress` hears
    the fraction done; `stop()` is asked before each chunk."""
    total = max(frames for _, frames, _, _, _, _ in opened)
    peak = 0.0
    for start in range(0, total, CHUNK):
        if stop is not None and stop():
            raise Stopped()
        acc = _sum_chunk(opened, start, min(CHUNK, total - start))
        peak = max(peak, float(np.abs(acc).max()))
        if progress is not None:
            progress(min(start + CHUNK, total) / total)
    return peak


def _sum_chunk(opened, start, length):
    """One block of the mix, as (length, 2).

    A stereo track keeps its sides — left into left, right into right. A mono
    track goes to both, which is what a stereo file of a mono take means."""
    acc = np.zeros((length, 2), dtype=np.float32)
    for data, frames, gain, sample_bytes, width, _ in opened:
        if start >= frames or gain == 0.0:
            continue  # this track has already ended, or is turned all the way down
        end = min(start + length, frames)
        piece = data[start:end]
        if sample_bytes == 3:
            whole = np.zeros((end - start) * width, dtype=np.int32)
            unpack24(np.ascontiguousarray(piece).reshape(-1, 3), whole)
            piece = whole.reshape(end - start, width)
        piece = piece.astype(np.float32) * gain
        acc[: len(piece), 0] += piece[:, 0]
        acc[: len(piece), 1] += piece[:, width - 1]
    return acc
