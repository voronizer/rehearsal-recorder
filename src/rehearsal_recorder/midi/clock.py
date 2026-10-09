"""
Which sample of the audio a moment on the computer's clock belongs to (spec F1).

A note is stamped with the computer's own clock when it arrives, and belongs at
the sample of the WAV that was being captured as it was played. The audio
interface keeps its own time, and over an hour the two clocks part by a fifth of
a second (one interface measured +196 ppm), which is a flam against the drums.
So the audio callback marks this clock with every block: when the block arrived
by the computer's clock, and how many frames the take had by then. A line fitted
through those marks turns any time on the computer's clock into a sample,
drift included, and it is fitted afresh as the take goes on.

Every time on the Python side is `time.perf_counter_ns()`, which is also what a
port's thread stamps its events with.

`mark` runs on the audio thread, so it does no I/O, takes no lock and logs
nothing; what it keeps grows by one tuple a second. `marks` and `to_seconds` are
for other threads, and rely on nothing but single assignments and list.append,
which are whole in one step under the GIL. The fit itself is `fit`, a function
of the marks alone, so a take whose app died is placed again from the marks that
reached the disk (`save_line`, `load`), the way it would have been placed alive.

It imports neither the MIDI library nor mido, nor sounddevice: it is handed
numbers.
"""

import re
from pathlib import Path

# A mark is kept for the fit once in this many seconds of audio. An hour of
# blocks is some 170000 of them, which would be a fit through 170000 points to
# say what 3600 say as well. The latest block's mark is always there besides.
MARK_EVERY_SEC = 1.0

# A line through marks closer together than this would say more about when the
# callbacks happened to run than about how fast the interface is: a few
# milliseconds of jitter over half a second is a slope off by a percent or two,
# where an interface is off by a few hundredths of one.
FIT_MIN_SPAN_SEC = 0.5

# How old the driver may say the first frame of a block is and be believed.
# Anything else is a bug in the driver (PortAudio has had one in these times
# for input-only streams on CoreAudio) or a zero it did not fill in.
MAX_AGE_SEC = 1.0

_NS = 1e9


class AudioClock:
    """
    One take's clock. The recorder marks it with every block it writes; a note
    asks it for a time in the take.

    `latency_sec` is the interface's input latency, set when the stream is
    open, and `started_ns` is when the take was started. They stand in for what
    the marks have not yet said: a block whose capture time the driver does not
    give is taken to have been captured as long ago as it is long plus the
    latency, and a take with no mark yet runs from `started_ns`.
    """

    def __init__(self, samplerate):
        self.samplerate = samplerate
        self.latency_sec = 0.0
        self.started_ns = None
        # (ns, frame): the computer's time of a block's first frame, and that
        # frame's number. `_kept` only grows, and `_latest` is the newest of
        # all, kept or not. The one thread that marks sets `_latest` first
        # and appends to `_kept` after, so a reader that copies `_kept` and then
        # reads `_latest` never sees a latest older than the end of its copy.
        self._kept = []
        self._latest = None
        # (the newest mark it was fitted through, the fit): see to_seconds.
        self._fitted = None

    def mark(self, arrival_ns, frames_end, frames, age_sec):
        """
        A block of `frames` frames has arrived at `arrival_ns`, and the take
        has `frames_end` frames with it. `age_sec` is how old its first frame
        is as the callback runs, as the driver says it (PortAudio's
        currentTime less inputBufferAdcTime), or None when it does not.

        Audio thread: single assignments and one append, nothing else shared.
        """
        first = frames_end - frames
        if age_sec is not None and 0 <= age_sec < MAX_AGE_SEC:
            back = age_sec
        else:
            # The block is as old as it is long when its last frame has just
            # arrived, plus the time the interface took to hand it over.
            back = frames / self.samplerate + self.latency_sec
        mark = (arrival_ns - int(back * _NS), first)
        self._latest = mark
        kept = self._kept
        if not kept or first - kept[-1][1] >= MARK_EVERY_SEC * self.samplerate:
            kept.append(mark)

    def marks(self):
        """The kept marks, one for each second of frames, and the latest: a new
        list each time, oldest first, as (ns, frame)."""
        # The copy first and the latest after, see __init__.
        out = list(self._kept)
        latest = self._latest
        if latest is not None and (not out or latest[1] > out[-1][1]):
            out.append(latest)
        return out

    def to_seconds(self, ns):
        """
        Seconds into the take on the audio's own clock, for a moment `ns` on
        the computer's: the number of the frame being captured then, over the
        samplerate. Before the take that is a negative number.
        """
        latest = self._latest
        if latest is None:
            return fit([], self.samplerate, self.started_ns)(ns)
        # The fit is kept until there is a newer mark. A take's notes are all
        # placed at its end, thousands of them against the same few thousand
        # marks. Two threads asking at once each fit and one wins, which
        # costs a little time and nothing else.
        fitted = self._fitted
        if fitted is None or fitted[0] is not latest:
            marks = self.marks()
            fitted = (marks[-1], fit(marks, self.samplerate, self.started_ns))
            self._fitted = fitted
        return fitted[1](ns)


def fit(marks, samplerate, started_ns):
    """
    A function from a time on the computer's clock to seconds into the take,
    through these marks (ns, frame): the least squares line of time on frame.
    It is worked out from the marks' distances to the first one, which are
    whole numbers: a computer that has been up for months counts more
    nanoseconds than a float has digits for, and the distances are small.

    - Two marks or more, at least FIT_MIN_SPAN_SEC of audio from the first to
      the last: the line they make, which has the interface's speed in it.
    - Fewer, or closer together: the speed the interface was asked for, through
      the middle of the marks, which is no better than the clock they came with
      but no worse.
    - A line that does not go forward in time, which the marks of a real
      interface never make: the speed it was asked for.
    - No marks: from `started_ns`, and from nothing if there is none, so a
      caller that asks too early is answered with 0 and not with an error.
    """
    if not marks:
        if started_ns is None:
            return lambda ns: 0.0
        return lambda ns: (ns - started_ns) / _NS

    first_ns, first_frame = marks[0]
    xs = [frame - first_frame for _, frame in marks]
    ys = [ns - first_ns for ns, _ in marks]
    xbar = sum(xs) / len(xs)
    ybar = sum(ys) / len(ys)

    slope = _NS / samplerate  # ns to a frame
    if len(marks) >= 2 and max(xs) - min(xs) >= FIT_MIN_SPAN_SEC * samplerate:
        sxx = sum((x - xbar) ** 2 for x in xs)
        sxy = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys))
        if sxy > 0:
            slope = sxy / sxx

    def seconds(ns):
        return (first_frame + xbar + (ns - first_ns - ybar) / slope) / samplerate

    return seconds


# One mark of a take.clock file: an ns, a space, a frame, and a newline. Up to
# 19 digits, which is all an ns or a frame can be: int() refuses a longer
# string of digits, so a line of garbage would raise instead of being skipped.
_LINE = re.compile(r"(-?[0-9]{1,19}) ([0-9]{1,19})")


def save_line(mark):
    """A mark as the line it is kept in on disk."""
    ns, frame = mark
    return f"{ns} {frame}\n"


def load(path):
    """
    The marks in a file of `save_line` lines, in the order they were written; no
    marks for a file that is not there or cannot be read.

    A line that is not an ns and a frame is skipped, wherever it is. The last
    line of a file that was being written when the app died is cut anywhere,
    and "12 48" cut from "12 4800" is a mark, the wrong one, so only a line
    that ends in its newline is a line.
    """
    try:
        text = Path(path).read_bytes().decode("utf-8", "replace")
    except OSError:
        return []
    lines = text.split("\n")
    lines.pop()  # what follows the last newline: nothing, or a line cut short
    marks = []
    for line in lines:
        found = _LINE.fullmatch(line.rstrip("\r"))
        if found:
            marks.append((int(found[1]), int(found[2])))
    return marks
