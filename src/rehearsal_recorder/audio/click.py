"""
The metronome's click: its arithmetic and its sounds, shared by every stream
that plays it (the recorder's, the player's and the click's own output).

The tempo counts clicks: a click is 60 / tempo seconds in every signature, a
quarter note in x/4 and an eighth in 6/8, where a song felt in two at 66 shows
198 (metronome spec, M15). A click's frame is worked out from its number and
never summed from the clicks before it, so at a tempo whose click is no whole
number of frames the hundredth click and the ten-thousandth are each within
half a frame of their place.

The three sounds are made here at the output's own sample rate, not played
from sample files: nothing to license and nothing to resample.

Plain numbers and numpy: no stream, no thread, no lock.
"""

import functools

import numpy as np

SIGNATURES = ("4/4", "3/4", "2/4", "6/8")
SOUNDS = ("click", "wood", "hihat")

_PER_BAR = {"4/4": 4, "3/4": 3, "2/4": 2, "6/8": 6}

# The tempo's range in quarter notes a minute. 6/8 counts eighths, so its
# numbers are twice these, and a fast 6/8 fits.
QUARTER_RANGE = (30, 300)

# Each sound lasts 50 ms, inside the 60 ms a click may take, so even 600
# eighths a minute (100 ms apart) never overlap. It rises over a millisecond
# and falls to nothing over its last five, each a half cosine, so neither end
# is a click of its own.
VOICE_SEC = 0.05
ATTACK_SEC = 0.001
RELEASE_SEC = 0.005

# Click: a sine for each accent, dying away fast.
CLICK_HZ = (900, 1100, 1300)
CLICK_DECAY_SEC = 0.008
# Woodblock: two resonances, as a block of wood rings when struck, the upper
# one quieter and shorter: (times the lower one's pitch, level, decay).
WOOD_HZ = (1500, 1800, 2200)
WOOD_MODES = ((1.0, 1.0, 0.010), (2.7, 0.5, 0.004))
# Hi-hat: noise above a cutoff for each accent, its very top rolled off, and
# the same noise every time, so a sound is the same each time it is made.
HIHAT_HZ = (5000, 6500, 8000)
HIHAT_TOP_HZ = 14000
HIHAT_DECAY_SEC = 0.015
HIHAT_SEED = 1


def per_bar(signature):
    """Clicks in a bar: 4, 3, 2 or 6."""
    return _PER_BAR[signature]


def per_quarter(signature):
    """Clicks in a quarter note: one, or two in 6/8, whose clicks are eighths."""
    return 2 if signature == "6/8" else 1


def tempo_range(signature):
    """The lowest and the highest tempo: 30 and 300 in x/4, 60 and 600 in 6/8."""
    low, high = QUARTER_RANGE
    return low * per_quarter(signature), high * per_quarter(signature)


def clamp_tempo(value, signature):
    """A tempo as the metronome keeps it: a whole number inside the signature's range."""
    low, high = tempo_range(signature)
    return max(low, min(high, round(value)))


def accent(signature, k):
    """How click k sounds, counted from a bar's first click: 2 for the first,
    1 for the fourth in 6/8, 0 for the others."""
    beat = k % per_bar(signature)
    if beat == 0:
        return 2
    if signature == "6/8" and beat == 3:
        return 1
    return 0


def quarter_tempo(tempo, signature):
    """What a DAW calls the tempo: quarters a minute, so half the number in 6/8."""
    return tempo / per_quarter(signature)


def click_frame(k, tempo, samplerate):
    """The frame click k falls on, counted from the first click (k = 0)."""
    return round(k * 60 * samplerate / tempo)


def _click(t, samplerate, accent):
    return np.sin(2 * np.pi * CLICK_HZ[accent] * t) * np.exp(-t / CLICK_DECAY_SEC)


def _wood(t, samplerate, accent):
    pitch = WOOD_HZ[accent]
    return sum(level * np.sin(2 * np.pi * pitch * times * t) * np.exp(-t / decay)
               for times, level, decay in WOOD_MODES)


def _hihat(t, samplerate, accent):
    noise = np.random.default_rng(HIHAT_SEED).standard_normal(len(t))
    freqs = np.fft.rfftfreq(len(t), 1 / samplerate)
    above = (freqs / HIHAT_HZ[accent]) ** 4
    top = (freqs / HIHAT_TOP_HZ) ** 4
    filtered = np.fft.irfft(np.fft.rfft(noise) * above / (1 + above) / (1 + top), len(t))
    return filtered * np.exp(-t / HIHAT_DECAY_SEC)


_MAKERS = {"click": _click, "wood": _wood, "hihat": _hihat}


def _ends(frames, samplerate):
    """The rise at the start and the fall at the end, one value a frame."""
    rise = round(ATTACK_SEC * samplerate)
    fall = round(RELEASE_SEC * samplerate)
    ends = np.ones(frames)
    ends[:rise] = 0.5 - 0.5 * np.cos(np.pi * np.arange(rise) / rise)
    ends[frames - fall:] = 0.5 + 0.5 * np.cos(np.pi * np.arange(1, fall + 1) / fall)
    return ends


# A volume dragged along its slider makes a new set at every step; the last
# few are kept.
@functools.lru_cache(maxsize=16)
def _made(sound, samplerate, volume):
    frames = round(VOICE_SEC * samplerate)
    t = np.arange(frames) / samplerate
    ends = _ends(frames, samplerate)
    voices = []
    for level in (0, 1, 2):
        voice = _MAKERS[sound](t, samplerate, level) * ends
        voice = (voice * (volume / np.abs(voice).max())).astype(np.float32)
        # Shared by every stream that plays it: none may change it.
        voice.flags.writeable = False
        voices.append(voice)
    return tuple(voices)


class Voices:
    """
    One sound's three clicks, for accents 0, 1 and 2, at a sample rate and a
    volume (0 to 1, the peak of each). Made once for each sound, rate and
    volume and shared; each is float32, one channel, read-only.
    """

    def __init__(self, sound, samplerate, volume):
        self.sound = sound
        self.samplerate = samplerate
        self.volume = volume
        self._voices = _made(sound, int(samplerate), float(volume))

    def of(self, accent):
        return self._voices[accent]


def mix_clicks(out, first_frame, starts, voices, route):
    """
    Adds clicks into `out`, a block of a stream's output (frames by channels)
    whose first frame is `first_frame` on the stream's count, on the channels
    in `route` (0-based). Each of `starts` is (frame, accent): where a click
    begins on that count, and how it sounds. A click that began before the
    block adds what is left of it, and one that runs past its end adds what
    fits; the rest is the next block's. In place, with numpy views only, so a
    stream's callback can call it.
    """
    frames = len(out)
    for start, level in starts:
        voice = voices.of(level)
        at = start - first_frame
        begin, end = max(at, 0), min(at + len(voice), frames)
        if begin < end:
            piece = voice[begin - at:end - at]
            for channel in route:
                out[begin:end, channel] += piece


def snap_region(start_sec, end_sec, tempo, signature, samplerate, length_frames):
    """
    A crop of a click take put on its grid, as (start, end) frames: the start
    back to the bar line at or before it, the end on to the next quarter (the
    next click in x/4, the next even click in 6/8), so the cropped files start
    on a bar and hold whole quarters. The bars run from the files' first
    sample, the count-in's first click. Both stay inside the file, so a region
    ending in its last part of a quarter ends at the file's end.
    """
    start = min(max(round(start_sec * samplerate), 0), length_frames)
    end = min(max(round(end_sec * samplerate), 0), length_frames)
    bar, quarter = per_bar(signature), per_quarter(signature)
    minute = 60 * samplerate
    # The bar whose line is at or before the start, in whole numbers. The next
    # line is past the start exactly, but rounded to its frame it can land on it.
    b = start * tempo // (minute * bar)
    if click_frame((b + 1) * bar, tempo, samplerate) <= start:
        b += 1
    # The quarter at or after the end, the same way round.
    q = -(-end * tempo // (minute * quarter))
    if q > 0 and click_frame((q - 1) * quarter, tempo, samplerate) >= end:
        q -= 1
    return (click_frame(b * bar, tempo, samplerate),
            min(click_frame(q * quarter, tempo, samplerate), length_frames))
