"""
Counting a song's tempo from a take (spec Part 10), with numpy and nothing else.

It is librosa's way of doing it, after the research behind the spec
(metronome/research/tempo-estimation.md), written out: the spectrum's rises
make an onset envelope, the envelope's autocorrelation over 8-second windows
says which gaps between onsets are common, and a gentle preference for tempos
around 120 settles between a beat and its double or half. Each window gives a
tempo and the take gives their median, so a take that speeds up or slows down
comes out in the middle and a few windows of talking or noise do not move it.

What it listens to, first that the take has: the drums' .mid (its hits, the
kick and snare counting more than the rest); the drums' WAV (the track with
the drums icon); the take's tracks mixed. A source that gives nothing, because
it is silent or has no hits in it, hands the counting to the next.

The answer is in clicks a minute, as the metronome counts them (a quarter in
x/4, an eighth in 6/8), clamped to the signature's range. In 6/8 the strongest
gap is often the quarter, and the answer is the eighth: the gap whose triple,
the dotted quarter a drummer feels, is strong too.

The WAVs are read in blocks, through the memory map the player and the mixdown
use, so a take of any length costs about what a short one does. Three minutes
take about a third of a second.
"""

import logging

import numpy as np

from rehearsal_recorder.audio.format import unpack24
from rehearsal_recorder.audio.player import _open_track
from rehearsal_recorder.midi.notes import DRUM_MAP, DRUM_ROWS
from rehearsal_recorder.midi.smf import read_events

log = logging.getLogger(__name__)

# What a signature's number may be, and where the preference sits: 120 beats
# a minute, which in 6/8 is 240 eighths. The click's range (global constraints).
RANGES = {"4/4": (30, 300, 120.0), "3/4": (30, 300, 120.0), "2/4": (30, 300, 120.0), "6/8": (60, 600, 240.0)}

WINDOW_SEC = 8.0
# How a gap's strength is scored: the autocorrelation (1 at no gap, near 0 for
# a gap nothing repeats at) is squeezed by log(1 + COMPRESS * x), so a strong
# gap scores about 14 and a weak one about 10.
COMPRESS = 1e6
# The preference for the centre is a bell one octave wide: a tempo an octave
# away is held back by half a point of that score.
PRIOR_OCTAVES = 1.0

# A take whose loudest moment is under -60 dB of full scale is silent: this is
# a card's dither, or a track nobody played.
SILENT_PEAK = 1e-3
# A window with less than a thousandth of the loudest window's energy in its
# envelope is quiet, not a rhythm: the end of a take left running, a pause.
QUIET_WINDOW = 1e-3
# Mel bands, as librosa's; the spectrum is 80 dB deep from its loudest, so a
# room's hum in a pause is not a rhythm either.
MELS = 64
DEPTH_DB = 80.0
# Steps of the spectrum taken at once: 64 of 4096 samples at 44.1 kHz is 1 MB.
BLOCK_STEPS = 64

# A .mid's hits are laid on an envelope of 200 steps a second (5 ms), as in the
# research: the kick and snare count fully, everything else 0.4.
HIT_FPS = 200.0
HEAVY = {note for note, row in DRUM_MAP.items() if DRUM_ROWS[row] in ("Kick", "Snare")}
LIGHT_WEIGHT = 0.4
# A window with fewer hits than this has no tempo in it.
MIN_HITS = 4


def count(*, drums_mid=None, drums_wav=None, wavs=(), signature="4/4"):
    """
    The tempo of a take in clicks a minute, as a float, or None when it has
    none to give: silence, or under 8 seconds of anything.

    `drums_mid`, `drums_wav` and `wavs` are paths (or None, or no paths): the
    drums' .mid, the drums' WAV, and every WAV of the take. The first the take
    has that gives an answer is the one; a .mid that cannot be read is passed
    over as one with no hits is. A WAV that cannot be read raises what reading
    it raises (OSError, wave.Error, ValueError for a file that is not 16- or
    24-bit), for the caller to say.

    `signature` is "4/4", "3/4", "2/4" or "6/8"; anything else raises
    ValueError. The answer is in 30 to 300 in x/4 and 60 to 600 in 6/8.
    """
    if signature not in RANGES:
        raise ValueError(f"Not a signature: {signature!r}")
    lo, hi, centre = RANGES[signature]
    wavs = list(wavs or ())
    sources = []
    if drums_mid:
        sources.append(lambda: _hits_envelope(drums_mid))
    if drums_wav:
        sources.append(lambda: _audio_envelope([drums_wav]))
    if wavs and [str(w) for w in wavs] != [str(drums_wav)]:
        sources.append(lambda: _audio_envelope(wavs))
    for source in sources:
        found = source()
        if found is None:
            continue
        env, fps, hits = found
        tempos = _window_tempos(env, fps, hits, six_eight=signature == "6/8", lo=lo, hi=hi, centre=centre)
        if len(tempos):
            return float(min(max(np.median(tempos), lo), hi))
    return None


def _mel_filters(sr, n_fft):
    """The triangles that gather a spectrum's bins into MELS bands, 30 Hz up,
    as (MELS, bins)."""
    mel = lambda f: 2595.0 * np.log10(1.0 + f / 700.0)
    hertz = lambda m: 700.0 * (10 ** (m / 2595.0) - 1.0)
    edges = hertz(np.linspace(mel(30.0), mel(sr / 2), MELS + 2))
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    low, mid, high = edges[:-2, None], edges[1:-1, None], edges[2:, None]
    return np.maximum(0.0, np.minimum((freqs - low) / (mid - low), (high - freqs) / (high - mid)))


def _mix(opened, start, stop):
    """
    The samples `start` to `stop` of every track added into one mono block, 1.0
    being full scale; zero where a file does not reach, before it or after.
    A stereo track is its two sides averaged.
    """
    out = np.zeros(stop - start, dtype=np.float32)
    for data, frames, _, sample_bytes, width in opened:
        first, last = max(start, 0), min(stop, frames)
        if first >= last:
            continue
        piece = data[first:last]
        if sample_bytes == 3:
            whole = np.zeros((last - first) * width, dtype=np.int32)
            unpack24(np.ascontiguousarray(piece).reshape(-1, 3), whole)
            piece = whole.reshape(last - first, width).astype(np.float32) * np.float32(1 / 8388608)
        else:
            piece = piece.astype(np.float32) * np.float32(1 / 32768)
        out[first - start:last - start] += piece.mean(axis=1)
    return out


def _audio_envelope(paths):
    """
    The onset envelope of these WAVs mixed: how much the spectrum rose at each
    step of about 23 ms, which is a drum hit's mark whatever the drum. Returns
    (envelope, steps a second, None), or None for a take that is silent.

    The spectrum is taken 4 steps wide on 64 mel bands, in decibels, 80 deep
    from its loudest; the envelope is its rises, averaged over the bands.
    """
    opened = [_open_track(path) for path in paths]
    sr = opened[0][2]
    total = max(frames for _, frames, _, _, _ in opened)
    hop = int(round(sr * 512 / 22050))
    n_fft = 4 * hop
    steps = 1 + total // hop
    window = np.hanning(n_fft).astype(np.float32)
    bands = _mel_filters(sr, n_fft).T.astype(np.float32)
    peak = 0.0
    db = np.empty((steps, MELS), dtype=np.float32)
    for first in range(0, steps, BLOCK_STEPS):
        last = min(first + BLOCK_STEPS, steps)
        # Step i is centred on sample i * hop: it starts n_fft/2 before and ends n_fft/2 after.
        block = _mix(opened, first * hop - n_fft // 2, (last - 1) * hop + n_fft // 2)
        peak = max(peak, float(np.abs(block).max()))
        frames = np.lib.stride_tricks.sliding_window_view(block, n_fft)[::hop]
        power = np.abs(np.fft.rfft(frames * window, axis=1)) ** 2
        db[first:last] = 10.0 * np.log10(np.maximum(power @ bands, 1e-10))
    if peak < SILENT_PEAK:
        return None
    np.maximum(db, db.max() - DEPTH_DB, out=db)
    rises = np.maximum(0.0, np.diff(db, axis=0)).mean(axis=1)
    return np.concatenate([[0.0], rises]), sr / hop, None


def _hits_envelope(path):
    """
    The hits of a drums .mid as an envelope: an impulse for each note-on with a
    velocity, spread over about 10 ms so a step of jitter does not split a
    peak. Returns (envelope, steps a second, hits per step), or None for a
    file that cannot be read or has no hits in it.
    """
    try:
        _, events = read_events(path)
    except Exception as e:
        log.warning("%s cannot be counted: %r", path, e)
        return None
    hits = [(seconds, _weight(data[1])) for seconds, data in events
            if data[0] & 0xF0 == 0x90 and len(data) == 3 and data[2] > 0]
    if len(hits) < MIN_HITS:
        return None
    times = np.array([t for t, _ in hits])
    weights = np.array([w for _, w in hits])
    steps = int(np.ceil(times.max() * HIT_FPS)) + 2
    env = np.zeros(steps)
    counts = np.zeros(steps)
    at = np.round(times * HIT_FPS).astype(int)
    np.add.at(env, at, weights)
    np.add.at(counts, at, 1.0)
    bell = np.exp(-0.5 * (np.arange(-6, 7) / 2.0) ** 2)
    return np.convolve(env, bell / bell.sum(), mode="same"), HIT_FPS, counts


def _weight(note):
    return 1.0 if note in HEAVY else LIGHT_WEIGHT


def _window_tempos(env, fps, hits, *, six_eight, lo, hi, centre):
    """
    The tempo of each 8-second window of the envelope (a quarter of a window
    apart), in clicks a minute: the autocorrelation says how like itself the
    window is when slid by each gap, the preference for the centre is added in
    octaves, and the best gap in range is the window's tempo, placed between
    two steps by the parabola through its neighbours. `hits` is the number of
    hits at each step of a .mid's envelope, None for audio. A window too quiet
    or with too few hits to have a tempo is left out; the answer is every
    other window's, empty when there is none (or under 8 seconds).
    """
    window = int(round(WINDOW_SEC * fps))
    if len(env) < window:
        return np.empty(0)
    starts = np.arange(0, len(env) - window + 1, max(1, window // 4))
    frames = np.stack([env[s:s + window] for s in starts])
    frames = (frames - frames.mean(axis=1, keepdims=True)) * np.hanning(window)
    spectrum = np.abs(np.fft.rfft(frames, n=2 * window, axis=1)) ** 2
    corr = np.fft.irfft(spectrum, axis=1)[:, :window]
    energy = corr[:, 0]
    keep = energy > QUIET_WINDOW * energy.max() if energy.max() > 0 else np.zeros(len(starts), bool)
    if hits is not None:
        inside = np.concatenate([[0.0], np.cumsum(hits)])
        keep &= inside[starts + window] - inside[starts] >= MIN_HITS
    if not keep.any():
        return np.empty(0)
    corr = corr[keep] / energy[keep, None]

    gaps = np.arange(1, window)  # in steps
    bpm = 60.0 * fps / gaps
    strength = np.log1p(COMPRESS * np.maximum(corr[:, 1:], 0.0))
    score = strength - 0.5 * ((np.log2(bpm) - np.log2(centre)) / PRIOR_OCTAVES) ** 2
    if six_eight:
        # Three eighths on is a dotted quarter, whose strength is added to the eighth's.
        triple = np.full_like(score, -np.inf)
        reach = (3 * gaps) < window
        triple[:, reach] = strength[:, 3 * gaps[reach] - 1]
        score = score + triple
    score[:, (bpm < lo) | (bpm > hi)] = -np.inf

    # The gap, in steps: the best of the score, and then the top of the
    # autocorrelation's own peak nearby, between two steps. In 6/8 that is the
    # dotted quarter's peak, three times as far out and so three times as fine.
    lag = np.argmax(score, axis=1) + 1
    if six_eight:
        return 60.0 * fps / (_peak(corr, 3 * lag, 2) / 3)
    return 60.0 * fps / _peak(corr, lag, 1)


def _peak(corr, near, reach):
    """
    Where each row of `corr` peaks within `reach` steps of `near`, as a gap that
    may fall between two steps: the highest step there and the parabola through
    it and its neighbours.
    """
    rows = np.arange(len(corr))
    top = len(corr[0]) - 2
    steps = np.clip(near[:, None] + np.arange(-reach, reach + 1), 1, top)
    best = steps[rows, np.argmax(corr[rows[:, None], steps], axis=1)]
    a, b, c = corr[rows, best - 1], corr[rows, best], corr[rows, best + 1]
    with np.errstate(invalid="ignore", divide="ignore"):
        shift = 0.5 * (a - c) / (a - 2 * b + c)
    return best + np.where(np.isfinite(shift) & (np.abs(shift) < 1), shift, 0.0)
