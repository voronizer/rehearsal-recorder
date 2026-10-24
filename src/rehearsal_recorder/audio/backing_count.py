"""
Counting a backing track (backing-track spec, Part 2): its tempo and where its
bar 1 is, from the file made ready to play.

The tempo is the metronome's counter (audio/tempo.py) on the file as a whole
mix, in the song's signature, 4/4 for a song with none. The beats are drift's
tracker around that tempo (`track`, then `snap` onto the hits). Bar 1 is the
first beat of the strongest of the bar's possible downbeats: of the 4 (3, 2
or 6) places a bar could start, the one whose beats are loudest on average
across the file, which is where the kick and the crash land. A pickup or a
song that leans on beat 3 can still put it a beat off, which is why the song's
page offers one beat earlier or later.

Loudest is the level just after each beat, not the onset envelope the beats
are found on: that envelope is how far the spectrum rose in decibels, so it
stands highest on a hit after a quiet stretch. On drums with a crash on every
bar 1 it stood highest on the bar's last beat. And the envelope's steps
are 46 ms wide, so the tracker's beats sit about 10 ms before the hits. Bar 1
is moved onto its hit, the steepest rise of the level within 30 ms of it, or
the backing track would come in 10 ms behind the click.

A file with no steady beat (pads, a drone) has no tempo, and its bar 1 is its
start: fewer than half the beats the tracker laid found a hit to sit on, or
the counter found nothing to count.
"""

import numpy as np

from rehearsal_recorder.audio import tempo as tempomod
from rehearsal_recorder.audio.backing_file import open_ready
from rehearsal_recorder.audio.click import clamp_tempo, per_bar

NO_BEAT = {"tempo": None, "first_bar": 0.0}
# A file whose beats found a hit for fewer than this share of them has no
# steady beat in it, as drift says of a source (audio/drift.py COUNTED_SHARE).
FOUND_SHARE = 0.5
# How long after a beat its level is measured: a kick's body.
LOUD_SEC = 0.05
# Bar 1's hit is looked for this far either side of the tracker's beat, in
# steps of a millisecond, the level taken over two.
REACH_SEC = 0.03
LEVEL_STEP_SEC = 0.001


def count(ready, signature, stop=None):
    """
    {"tempo": clicks a minute as the metronome keeps them, or None for no
    steady beat; "first_bar": seconds into the file, to a hundredth} for a
    ready file. `signature` is the song's, None for none. `stop` raises
    tempo.Cancelled when it says so, as the counters' do.
    """
    if signature not in tempomod.RANGES:
        signature = "4/4"
    opened = [open_ready(ready)]
    made = tempomod._envelope(opened, tempomod.TRACK_HOP, stop)
    if made is None:
        return dict(NO_BEAT)
    env, fps, hits = made
    aim = tempomod.middle_tempo(env, fps, hits, signature)
    if aim is None:
        return dict(NO_BEAT)
    beats_a_bar = per_bar(signature)
    beats = tempomod.track(env, fps, aim, stop=stop)
    if len(beats) <= beats_a_bar:
        return dict(NO_BEAT)
    times, found = tempomod.snap(beats, env, fps, aim)
    if np.count_nonzero(found) < FOUND_SHARE * len(found):
        return dict(NO_BEAT)
    rate = opened[0][2]
    starts = np.rint(times * rate).astype(int)
    loud = np.array([_level(tempomod._mix(opened, i, i + int(LOUD_SEC * rate))) for i in starts])
    phase = int(np.argmax([loud[p::beats_a_bar].mean() for p in range(beats_a_bar)]))
    first = _onto_hit(opened, times[phase]) if found[phase] else times[phase]
    return {"tempo": clamp_tempo(aim, signature), "first_bar": round(max(0.0, float(first)), 2)}


def _level(block):
    return float(np.sqrt(np.mean(np.square(block)))) if len(block) else 0.0


def _onto_hit(opened, seconds):
    """The time within REACH_SEC of `seconds` where the level rises most
    steeply: where the hit starts."""
    rate = opened[0][2]
    step = max(1, int(LEVEL_STEP_SEC * rate))
    first = int(round((seconds - REACH_SEC) * rate))
    block = tempomod._mix(opened, first, first + int(2 * REACH_SEC * rate) + 2 * step)
    frames = np.lib.stride_tricks.sliding_window_view(block, 2 * step)[::step]
    level = np.sqrt(np.mean(np.square(frames), axis=1))
    return (first + step * (int(np.argmax(np.diff(level))) + 1)) / rate
