"""
Where the band drifted (drift spec Part 2): the tempo of every bar of a take,
for the line along Master's lane, counted with numpy and nothing else.

What it listens to, first that the take has and that gives a steady beat:
the drums' .mid (their hits, the kick and snare weighing more); the drums'
WAVs, summed when there are several (a kick mic and overheads); every WAV of
the take summed, which the caller hands over without a backing track in it.
The beats are found around the take's tempo when it has one, else around the
counter's count of the take (`audio/tempo.py`); each bar's tempo is a robust
line through its beats. Which bars ran ahead or dragged is for the interface
to say, so a change of the tolerance counts nothing again.
"""

import numpy as np

from rehearsal_recorder.audio import tempo as tempomod

# Fewer bars than this is too short to show a tempo along.
MIN_BARS = 4
# A source that gives a tempo for fewer than this share of its bars has no
# steady beat in it, and the next is tried.
COUNTED_SHARE = 0.5
BEATS_A_BAR = {"4/4": 4, "3/4": 3, "2/4": 2, "6/8": 6}


def count(*, drums_mid=(), drums=(), mix=(), tempo=None, signature="4/4", click=False, stop=None):
    """
    The take's bars: {"ok": True, "source", "per_bar", "tempo", "middle",
    "bars"}, or {"ok": False, "why": "short" | "no-beat"}.

    `drums_mid`, `drums` and `mix` are paths: the drums' .mid files (the first
    is read), the drums' WAVs and the WAVs to sum for the mix. `tempo` is the
    take's aim in clicks a minute, None for none; `signature` says how many
    beats make a bar ("4/4" when the take has none). On a `click` take the
    bars lie on the click's grid, which starts at the file's first sample, and
    bar 1 is the grid's first bar the band plays in, past the count-in;
    otherwise bar 1 starts on the first beat played.

    "source" is "drums-mid", "drums" or "mix"; "tempo" what the beats were
    found around; "middle" the median of the bars' tempos; "bars" as
    `tempo.bar_tempos` gives them, a bar with no hits having a tempo of None.
    "short" is a take under 4 bars, "no-beat" one where no source gave a
    steady beat. A WAV that cannot be read raises what reading it raises;
    `stop` raises tempo.Cancelled when it says so.
    """
    per_bar = BEATS_A_BAR[signature]
    mix = [m for m in mix or () if str(m) not in {str(d) for d in drums}] if drums else list(mix or ())
    sources = []
    if drums_mid:
        sources.append(("drums-mid", lambda: tempomod._hits_envelope(drums_mid[0])))
    if drums:
        sources.append(("drums", lambda: tempomod._audio_envelope(drums, tempomod.TRACK_HOP, stop)))
    if mix:
        sources.append(("mix", lambda: tempomod._audio_envelope(mix, tempomod.TRACK_HOP, stop)))
    for name, envelope in sources:
        made = envelope()
        if made is None:
            continue
        env, fps, hits = made
        seconds = len(env) / fps
        aim = tempo or tempomod.middle_tempo(env, fps, hits, signature)
        if aim is None:
            if seconds < tempomod.WINDOW_SEC:
                return {"ok": False, "why": "short"}
            continue
        if seconds < MIN_BARS * per_bar * 60.0 / aim:
            return {"ok": False, "why": "short"}
        beats = tempomod.track(env, fps, aim, stop=stop)
        if len(beats) <= per_bar:
            continue
        times, found = tempomod.snap(beats, env, fps, aim)
        first = _bar_one(times, aim, per_bar) if click and tempo else 0
        bars = tempomod.bar_tempos(times, found, per_bar, first)
        counted = [b["tempo"] for b in bars if b["tempo"] is not None]
        if len(counted) < max(MIN_BARS, COUNTED_SHARE * len(bars)):
            continue
        return {"ok": True, "source": name, "per_bar": per_bar, "tempo": float(aim),
                "middle": float(np.median(counted)), "bars": bars}
    return {"ok": False, "why": "no-beat"}


def _bar_one(times, tempo, per_bar):
    """
    On a click take, the beat that starts bar 1: the click's grid has a bar
    every `per_bar` clicks from the first sample, and bar 1 is the first
    whose start the band's first beat reaches, within half a beat, so a
    count-in of any length is passed over and a beat played early as a
    pickup is not a bar of its own. The beat nearest that start is the one.
    """
    beat = 60.0 / tempo
    bar = per_bar * beat
    start = np.ceil((times[0] - beat / 2) / bar) * bar
    return int(np.argmin(np.abs(times - start)))
