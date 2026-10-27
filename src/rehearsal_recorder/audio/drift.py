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
import multiprocessing.connection
import os
import threading
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
# How long the second process has to begin a count, in seconds, before the
# count is made in the app instead: a Reha.exe that Windows is slow to start
# again, or a build that never gets to the count at all.
START_PATIENCE_SEC = 30
# How often the wait for the second process's answer asks `stop`, in seconds.
STOP_POLL_SEC = 0.05

# count_apart's second process, kept from one count to the next, and the lock
# that gives it one count at a time.
_apart = None
_apart_lock = threading.Lock()


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
    `count` in a second process, which is how the app counts a take's drift:
    the review screen asks for it the moment a take opens, as the take starts
    to play.

    The take is mixed in Python, on the sound card's thread (audio/player.py),
    and Python runs one thread at a time. The beat tracker is a loop in Python
    over every step of the take, and beside it the mix missed the card's
    deadline: the take clicked and dropped out for its first seconds. The
    second process has a Python of its own. It reads the WAVs and the .mid by
    their paths, and nothing it imports starts PortAudio: started with ASIO,
    it can interrupt what is playing for a moment (rehearsal_recorder/__init__.py
    says when), and here that is the take.

    One process counts one take at a time and is kept for the next
    (start_apart says why). `stop` is asked here while it counts. When it
    says so, the process is ended at once, to be started again for the next
    count, and tempo.Cancelled raised, as `count` raises it. What `count`
    raises there is raised here; a process that ends in the middle of a count
    raises ChildProcessError, and that take is not counted again here. One
    that cannot start, ends before it begins or has not begun after
    START_PATIENCE_SEC leaves the count to this one, as before, and the log
    says why.
    """
    global _apart
    stopped = lambda: stop is not None and stop()
    while not _apart_lock.acquire(timeout=STOP_POLL_SEC):
        if stopped():
            raise tempomod.Cancelled()
    try:
        if stopped():
            raise tempomod.Cancelled()
        try:
            if _apart is not None and not _apart.process.is_alive():
                # Ended between two counts: another takes its place.
                _end_apart()
            if _apart is None:
                _apart = _Apart()
            return _apart.count(kw, stopped)
        except _Gone as e:
            _end_apart()
            if e.counting:
                raise ChildProcessError(f"The second process counting a take's drift {e}") from None
            why = str(e)
        except tempomod.Cancelled:
            _end_apart()
            raise
        except Exception as e:  # noqa: BLE001 - it did not start; the app can count
            if _apart is not None:
                raise
            why = f"did not start: {e!r}"
    finally:
        _apart_lock.release()
    log.warning("A take's drift is counted in the app: the second process %s", why)
    return count(stop=stop, **kw)


def start_apart():
    """
    Starts count_apart's second process ahead of its first count. In a built
    app it is this program started again, and Windows shows its busy cursor
    for two seconds after it starts a program (Microsoft's STARTUPINFO,
    STARTF_FORCEONFEEDBACK): better once as the app opens than each time a
    take does. Never raises: one that does not start now is tried again by
    the first count.
    """
    global _apart
    with _apart_lock:
        if _apart is None:
            try:
                _apart = _Apart()
            except Exception as e:  # noqa: BLE001 - the count tries again
                log.warning("The second process for a take's drift did not start: %r", e)


class _Gone(Exception):
    """count_apart's second process is not there to answer; `counting` is
    whether it had begun the count it was asked for."""

    def __init__(self, why, counting):
        super().__init__(why)
        self.counting = counting


class _Apart:
    """The second process, and its end of the pipe between them."""

    def __init__(self):
        context = multiprocessing.get_context("spawn")
        self.pipe, theirs = context.Pipe()
        self.process = context.Process(target=_count_there, args=(theirs,), name="drift count", daemon=True)
        try:
            self.process.start()
        except BaseException:
            self.pipe.close()
            raise
        finally:
            theirs.close()

    def count(self, kw, stopped):
        """`count(**kw)` there: its answer, or what it raised. _Gone when the
        process is not there to give one."""
        try:
            self.pipe.send(("count", kw))
        except OSError as e:
            raise _Gone(f"could not be asked: {e!r}", counting=False) from None
        asked, counting = time.monotonic(), False
        while True:
            if stopped():
                raise tempomod.Cancelled()
            ready = multiprocessing.connection.wait([self.pipe, self.process.sentinel], STOP_POLL_SEC)
            if self.pipe in ready:
                try:
                    kind, value = self.pipe.recv()
                except (EOFError, OSError):
                    raise _Gone("ended without an answer", counting) from None
                except Exception as e:  # noqa: BLE001 - what it sent cannot be read
                    raise _Gone(f"sent an answer that cannot be read: {e!r}", counting) from None
                if kind == "counting":
                    counting = True
                elif kind == "done":
                    return value
                else:
                    raise value
            elif ready:
                raise _Gone("ended without an answer", counting)
            elif not counting and time.monotonic() - asked > START_PATIENCE_SEC:
                raise _Gone(f"had not begun after {START_PATIENCE_SEC} s", counting)

    def end(self):
        if self.process.is_alive():
            self.process.kill()
        self.process.join(5)
        self.pipe.close()


def _end_apart():
    """Ends the second process, for the next count to start another."""
    global _apart
    if _apart is not None:
        _apart, gone = None, _apart
        gone.end()


def _count_there(pipe):
    """The second process: counts what it is asked to, one take at a time,
    until the app goes."""
    app = multiprocessing.parent_process()
    if app is not None:
        threading.Thread(target=_end_with, args=(app,), name="app gone", daemon=True).start()
    while True:
        try:
            _, kw = pipe.recv()
            pipe.send(("counting", None))
        except (EOFError, OSError):
            return
        try:
            answer = ("done", count(**kw))
        except Exception as e:  # noqa: BLE001 - raised again in the app
            answer = ("failed", e)
        try:
            try:
                pipe.send(answer)
            except OSError:
                return
            except Exception as e:  # noqa: BLE001 - an exception that cannot be pickled
                pipe.send(("failed", RuntimeError(f"{answer[1]!r}, sent back as {e!r}")))
        except OSError:
            return


def _end_with(app):
    """The second process's watch on the app. An app that has gone (a crash,
    Task Manager) waits for no answer, and the take's files are let go of now,
    not when the count ends. Gone without a word: in a built app on Windows
    there is nowhere to write one, and an error would be a dialog."""
    app.join()
    os._exit(0)


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
