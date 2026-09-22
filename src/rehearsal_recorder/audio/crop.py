"""
Cutting a take down to the part that is music.

A take is often nine minutes of which three are playing: somebody walking back
to the kit, a false start, the silence after everyone stopped. This writes the
part worth keeping, and only ever writes — moving the original out of the way
is the caller's job, and in this app that means the Trash.

Frames are copied a block at a time, so a twenty-minute source costs the same
memory as a short one: the same care taken in mixdown and encode.
"""

import wave
from pathlib import Path

import numpy as np

from rehearsal_recorder.audio.format import pack24, unpack24

# Frames per block. Big enough that the per-call overhead disappears, small
# enough that memory does not grow with the length of a take.
BLOCK_FRAMES = 1 << 16

# A cut lands on whatever sample happened to be there, and a non-zero sample
# at the edge of a file is a click. A few milliseconds of ramp removes it
# without being audible as a fade.
DEFAULT_FADE_SEC = 0.005


def _faded(raw, ramp, sampwidth, channels):
    """One block of frames with `ramp` — one value per frame — applied."""
    per_sample = np.repeat(ramp, channels)
    if sampwidth == 2:
        arr = np.frombuffer(raw, dtype="<i2").astype(np.float32)
        return np.clip(
            np.rint(arr * per_sample), -32768, 32767
        ).astype("<i2").tobytes()

    # 24-bit: unpack to signed ints, scale, and pack the top three bytes back.
    # pack24 wants the sample left-justified in an int32, which is what the
    # shift below restores after unpack24 gave us the plain value.
    packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
    whole = np.zeros(packed.shape[0], dtype=np.int32)
    unpack24(np.ascontiguousarray(packed), whole)
    scaled = np.clip(
        np.rint(whole.astype(np.float32) * per_sample),
        -(1 << 23), (1 << 23) - 1,
    ).astype(np.int32)
    out = np.zeros((scaled.size, 3), dtype=np.uint8)
    pack24(scaled << 8, out)
    return out.tobytes()


def crop_wav(src, dst, start_sec, end_sec, fade_sec=DEFAULT_FADE_SEC):
    """
    Writes frames [start, end) of src into dst, keeping the sample rate, bit
    depth and channel count it found.

    A ramp is applied at each edge that is really a cut: a region starting at
    the beginning of the file keeps the original attack, and one ending at its
    end keeps the original decay.

    Returns {"ok", "frames", "samplerate"}, or {"ok": False, "error"}.
    """
    src = Path(src)
    dst = Path(dst)
    try:
        with wave.open(str(src), "rb") as fin:
            frames = fin.getnframes()
            rate = fin.getframerate()
            channels = fin.getnchannels()
            sampwidth = fin.getsampwidth()

            if sampwidth not in (2, 3):
                return {"ok": False, "error":
                        f"{src.name}: expected 16- or 24-bit, "
                        f"got {sampwidth * 8}"}
            if rate <= 0:
                return {"ok": False, "error": f"{src.name}: no sample rate"}

            start = max(0, min(frames, int(round(float(start_sec) * rate))))
            end = max(start, min(frames, int(round(float(end_sec) * rate))))
            total = end - start
            if total == 0:
                return {"ok": False,
                        "error": f"{src.name}: nothing in that range"}

            # Only where the file is really being cut.
            fade = max(0, int(round(float(fade_sec) * rate)))
            head = min(fade, total // 2) if start > 0 else 0
            tail = min(fade, total - head) if end < frames else 0
            middle = total - head - tail

            fin.setpos(start)
            dst.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(dst), "wb") as fout:
                fout.setnchannels(channels)
                fout.setsampwidth(sampwidth)
                fout.setframerate(rate)

                if head:
                    ramp = np.linspace(0.0, 1.0, head, endpoint=False,
                                       dtype=np.float32)
                    fout.writeframes(
                        _faded(fin.readframes(head), ramp, sampwidth, channels)
                    )

                left = middle
                while left > 0:
                    want = min(BLOCK_FRAMES, left)
                    block = fin.readframes(want)
                    if not block:
                        break
                    fout.writeframes(block)
                    left -= want

                if tail:
                    ramp = np.linspace(1.0, 0.0, tail, endpoint=False,
                                       dtype=np.float32)
                    fout.writeframes(
                        _faded(fin.readframes(tail), ramp, sampwidth, channels)
                    )
    except (OSError, ValueError, wave.Error) as e:
        dst.unlink(missing_ok=True)
        return {"ok": False, "error": f"{src.name}: {e}"}

    return {"ok": True, "frames": total, "samplerate": rate}
