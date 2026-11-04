"""Reads a recording of the probe's take by its steady 997 Hz tone: 1 ms
steps of the tone's level and phase, from a 2 ms window that leaves the other
tone (1499 Hz, switched on and off by M) out. A gap is the level falling
under 60 % of its usual; a slip is the phase moving by more than a tenth of a
frame. Neither happens while the take plays as it should, whatever the
driver's rate or resampling between."""

import numpy as np
import soundfile as sf

TONE = 997.0
OTHER = 1499.0


def judge(path):
    x, rate = sf.read(str(path), dtype="float64", always_2d=True)
    x = x[:, 0]
    n = np.arange(len(x))
    y = x * np.exp(-2j * np.pi * TONE * n / rate)
    w = int(round(rate * 0.002))
    c = np.cumsum(np.concatenate([[0], y]))
    z = (c[w:] - c[:-w]) / w
    z = z[:: max(1, rate // 1000)]  # one value per ms
    level = np.abs(z) * 2
    if len(level) == 0 or level.max() < 0.05:
        return {"heard_s": 0, "gaps": None, "note": "no tone recorded"}
    on = np.flatnonzero(level > 0.5 * level.max())
    z, level = z[on[0] + 20:on[-1] - 20], level[on[0] + 20:on[-1] - 20]
    usual = np.median(level)
    low = level < 0.6 * usual
    gaps = []
    i = 0
    while i < len(low):
        if low[i]:
            j = i
            while j < len(low) and low[j]:
                j += 1
            gaps.append(j - i)
            i = j
        else:
            i += 1
    # Phase, in frames of 48 kHz, away from gaps; a step between 10 ms means.
    phase = np.unwrap(np.angle(z)) / (2 * np.pi * TONE) * 48000
    ok = ~np.convolve(low, np.ones(25), mode="same").astype(bool)
    means = []
    for k in range(0, len(phase) - 10, 10):
        if ok[k:k + 10].all():
            means.append((k, phase[k:k + 10].mean()))
    slips = []
    for (k0, p0), (k1, p1) in zip(means, means[1:]):
        if abs(p1 - p0) > 0.1:
            slips.append(round(p1 - p0, 2))
    return {"heard_s": round(len(level) / 1000, 1), "gaps": len(gaps),
            "gap_ms_total": int(sum(gaps)), "gap_ms_longest": int(max(gaps, default=0)),
            "slips": len(slips), "slip_frames_first": slips[:8],
            "phase_spread_frames": round(float(np.ptp([p for _, p in means])) if means else 0.0, 2)}
