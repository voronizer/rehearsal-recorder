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

The app counts a take in a second process (`count_apart`): the take may be
playing as it is counted, and both in one Python made it click.
"""

import logging
import multiprocessing
import time

import numpy as np

from rehearsal_recorder.audio import tempo as tempomod

log = logging.getLogger(__name__)

# Fewer bars than this is too short to show a tempo along.
MIN_BARS = 4
# A source that gives a tempo for fewer than this share of its bars has no
# steady beat in it, and the next is tried.
COUNTED_SHARE = 0.5
BEATS_A_BAR = {"4/4": 4, "3/4": 3, "2/4": 2, "6/8": 6}
# How long a second process has to start counting, in seconds, before the
# count is made in the app instead: a Reha.exe that Windows is slow to start
# again, or a build that never gets to the count at all.
START_PATIENCE_SEC = 30
# How often the wait for the second process's answer asks `stop`, in seconds.
STOP_POLL_SEC = 0.05


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
    "short" is a take under 4 bars, or a source with a steady beat for fewer
    (a false start after a count-in); "no-beat" one where no source gave a
    steady beat. A WAV that cannot be read raises what reading it raises;
    `stop` raises tempo.Cancelled when it says so.
    """
    per_bar = BEATS_A_BAR[signature]
    short = False
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
            short = short or len(counted) >= COUNTED_SHARE * len(bars)
            continue
        return {"ok": True, "source": name, "per_bar": per_bar, "tempo": float(aim),
                "middle": float(np.median(counted)), "bars": bars}
    return {"ok": False, "why": "short" if short else "no-beat"}


def count_apart(*, stop=None, **kw):
    """
    `count` in a second process of its own, which is how the app counts a
    take's drift: the review screen asks for it the moment a take opens, as
    the take starts to play.

    The take is mixed in Python, on the sound card's thread (audio/player.py),
    and Python runs one thread at a time. The beat tracker is a loop in Python
    over every step of the take, and beside it the mix missed the card's
    deadline: the take clicked and dropped out for its first seconds. A second
    process has a Python of its own. It reads the WAVs and the .mid by their
    paths, and nothing it imports starts PortAudio: started with ASIO, it can
    interrupt what is playing for a moment (rehearsal_recorder/__init__.py
    says when), and here that is the take.

    `stop` is asked here while the count runs there. When it says so, the
    second process is ended at once and tempo.Cancelled raised, as `count`
    raises it. What `count` raises there is raised here. A second process
    that cannot start, has not begun after START_PATIENCE_SEC or ends without
    an answer leaves the count to this one, as before, and the log says why.
    """
    context = multiprocessing.get_context("spawn")
    answers, sender = context.Pipe(duplex=False)
    apart = context.Process(target=_count_here, args=(sender, kw), name="drift count", daemon=True)
    try:
        apart.start()
    except Exception as e:  # noqa: BLE001 - whatever it was, the app can count
        answers.close()
        sender.close()
        log.warning("A take's drift is counted in the app: a second process did not start: %r", e)
        return count(stop=stop, **kw)
    # Only the second process writes, so its end is the end of the pipe.
    sender.close()
    why = "ended without an answer"
    try:
        started, began = False, time.monotonic()
        while True:
            if stop is not None and stop():
                raise tempomod.Cancelled()
            try:
                if not answers.poll(STOP_POLL_SEC):
                    if not started and time.monotonic() - began > START_PATIENCE_SEC:
                        why = f"had not begun after {START_PATIENCE_SEC} s"
                        break
                    continue
                kind, value = answers.recv()
            except (EOFError, OSError):
                break
            if kind == "started":
                started = True
            elif kind == "done":
                return value
            else:
                raise value
    finally:
        if apart.is_alive():
            apart.kill()
        apart.join(5)
        answers.close()
    log.warning("A take's drift is counted in the app: the second process %s", why)
    return count(stop=stop, **kw)


def _count_here(sender, kw):
    """The second process's side of count_apart: that it has begun, then
    `count`'s answer, or what it raised."""
    sender.send(("started", None))
    try:
        answer = ("done", count(**kw))
    except Exception as e:  # noqa: BLE001 - raised again in the app
        answer = ("failed", e)
    try:
        sender.send(answer)
    except Exception as e:  # noqa: BLE001 - an exception that cannot be pickled
        sender.send(("failed", RuntimeError(f"{answer[1]!r}, sent back as {e!r}")))
    sender.close()


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
