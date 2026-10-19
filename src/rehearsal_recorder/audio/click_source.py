"""
One running click, rendered a block at a time into whichever stream plays it
(metronome spec, Part 3): the click's own output (audio/click_output.py), the
player's stream between takes, or a take's stream.

A free click, between takes, keeps its own grid: click k falls on the stream's
frame `origin + click_frame(k - from_k, ...)`, so each click is worked out from
its number and never summed. Retimed while it runs, the next click comes one new
click after the last one heard, or at once if that moment has passed; the bar
goes on unless the signature changes, when the next click is the first of a bar.

A take's click is placed instead (`place`): click k goes on whatever frame of
this stream the take says, so it can follow the recording's own clock. When it
is heard is the take's to say too (`heard`), so the screen can be told even when
the click's output has gone.

What the screen is told (`upcoming`, `count_state`) is read from the times each
click is heard, by the stream's own clock (an OutputClock, marked with every
block), never by a timer of its own (Part 5).

`render` runs on the audio thread. It takes no lock and allocates nothing but a
tuple or two: what the other threads read is in single attributes, each replaced
whole. A change asked from another thread (`retime`, `set_on`, `set_voices`) is
taken up at the next block.
"""

from rehearsal_recorder.audio.click import accent, click_frame, mix_clicks, per_bar
from rehearsal_recorder.audio.click_timing import OutputClock

# The clicks already rendered, kept by number for what the screen asks: a
# stream renders at most a second ahead of what is heard (click_timing.lead_of),
# and 600 a minute is ten clicks a second.
RENDERED = 32

# A placed click that falls just before the block being rendered (the line it
# is placed by was refitted in between) is played at the block's start; one
# later than this is past, and is counted without a sound.
LATE_SEC = 0.005

_NS = 1e9


class ClickSource:
    """
    `voices` (audio/click.Voices) at the stream's rate, into the stream's
    channels in `route` (0-based). `bars`: how many bars it plays, for a
    preview; None runs until it is taken out of its stream. `start_k`: the
    number of its first click, counted from a bar's first, so a click carried
    on into another stream keeps its place in the bar.

    `place(k)` and `heard(k)`, for a take's click: the frame of this stream
    click k goes on and the moment it is heard (time.perf_counter_ns()), or
    None while the take has not chosen its first click.
    """

    def __init__(self, tempo, signature, voices, route, place=None, bars=None, start_k=0, heard=None):
        self.voices = voices
        self.route = tuple(route)
        self.samplerate = voices.samplerate
        self.clock = OutputClock(voices.samplerate)
        self._place = place
        self._heard = heard
        self._on = True
        self._start_k = start_k
        self._limit = None if bars is None else start_k + bars * per_bar(signature)
        # The next click to render, and the one before it, as (frame, accent)
        # while it still sounds: a click runs on into the next block.
        self._next = start_k
        self._sounding = None
        self._last = None
        # (origin, from_k, tempo, bar_from, signature): click k is at
        # origin + click_frame(k - from_k) and is click (k - bar_from) of its
        # bar. The origin is the first block's first frame, for a free click.
        self._grid = (None, start_k, tempo, 0, signature)
        # (number, tempo, signature): the latest asked, and the number of the
        # one taken up, so two asked between blocks leave the second.
        self._asked = None
        self._taken = 0
        self._rendered = [None] * RENDERED
        self._starts = []
        # Whether a block has been rendered: a take's click waits for that
        # before it chooses its first click.
        self.started = False
        # repr() of the first error in render, which carries on in silence.
        self.fault = None

    # ---------- from other threads ----------

    @property
    def tempo(self):
        asked = self._asked
        return asked[1] if asked is not None else self._grid[2]

    @property
    def signature(self):
        asked = self._asked
        return asked[2] if asked is not None else self._grid[4]

    @property
    def done(self):
        """A preview that has played its bars to the end."""
        return self._limit is not None and self._next >= self._limit and self._sounding is None

    @property
    def next_in_bar(self):
        """The place in its bar of the next click (0 is a bar's first), for a
        click carried on into another stream as `start_k`."""
        _, _, _, bar_from, signature = self._grid
        asked = self._asked
        if asked is not None and asked[0] != self._taken and asked[2] != signature:
            return 0
        return (self._next - bar_from) % per_bar(signature)

    def set_on(self, on):
        """Off: the clicks go on being counted and are not heard."""
        self._on = bool(on)

    def set_voices(self, voices):
        """Another sound or volume, at the same rate, from the next click."""
        self.voices = voices

    def retime(self, tempo, signature):
        """A new tempo or signature, from the next click (a free click only)."""
        number = 1 if self._asked is None else self._asked[0] + 1
        self._asked = (number, tempo, signature)

    def upcoming(self, now_ns, within_sec=1.5):
        """
        The clicks heard from `now_ns` to `within_sec` later, as
        [ms from now, place in the bar (0 is its first)], earliest first: those
        already rendered, then those to come.
        """
        horizon = now_ns + within_sec * _NS
        found = []
        next_k = self._next
        for k in range(max(self._start_k, next_k - RENDERED), next_k):
            entry = self._rendered[k % RENDERED]
            if entry is None or entry[0] != k:
                continue
            at = self._heard(k) if self._heard is not None else self.clock.ns_at(entry[1])
            if at is not None and now_ns <= at <= horizon:
                found.append([round((at - now_ns) / 1e6, 1), entry[2]])
        origin, from_k, tempo, bar_from, signature = self._grid
        bar = per_bar(signature)
        k = next_k
        if self._heard is not None:
            k = self._first_heard(k, now_ns)
        while self._limit is None or k < self._limit:
            if self._heard is not None:
                at = self._heard(k)
            elif origin is None:
                break
            else:
                at = self.clock.ns_at(origin + click_frame(k - from_k, tempo, self.samplerate))
            if at is None or at > horizon:
                break
            if at >= now_ns:
                found.append([round((at - now_ns) / 1e6, 1), (k - bar_from) % bar])
            k += 1
        return found

    def count_state(self, now_ns, count_in_clicks):
        """
        For a take's click: (which count-in click was heard last, 1-based, or 0
        before the first and once the count-in is over; ms since the count-in
        ended, its last click's next, negative before then, or None while the
        take has no first click).
        """
        heard = self._heard if self._heard is not None else self._heard_free
        end = heard(count_in_clicks)
        if end is None:
            return 0, None
        count = 0
        if now_ns < end:
            for k in range(count_in_clicks):
                at = heard(k)
                if at is not None and at <= now_ns:
                    count = k + 1
        return count, round((now_ns - end) / 1e6, 1)

    def _heard_free(self, k):
        origin, from_k, tempo, _, _ = self._grid
        if origin is None:
            return None
        return self.clock.ns_at(origin + click_frame(k - from_k, tempo, self.samplerate))

    def _first_heard(self, k, now_ns):
        """The first click from k on that is heard at `now_ns` or after: a
        take's click whose output has gone renders nothing, so its count of
        clicks rendered stays where it was and the screen asks far ahead."""
        heard = self._heard
        at = heard(k)
        if at is None or at >= now_ns:
            return k
        step, high = 1, k + 1
        while True:
            at = heard(high)
            if at is None or at >= now_ns:
                break
            k, step = high, step * 2
            high = k + step
        while high - k > 1:
            middle = (k + high) // 2
            at = heard(middle)
            if at is not None and at < now_ns:
                k = middle
            else:
                high = middle
        return high

    # ---------- the audio thread ----------

    def render(self, out, first_frame, arrival_ns, lead_sec):
        """
        Adds the clicks that sound in `out`, a block (frames by channels) whose
        first frame is the stream's `first_frame`, its callback run at
        `arrival_ns` and its first frame heard `lead_sec` after that. What is
        under them stays. An error is kept in `fault` and the block left as it
        is: a click must never cost the stream it rides.
        """
        try:
            self._render(out, first_frame, arrival_ns, lead_sec)
        except Exception as e:
            if self.fault is None:
                self.fault = repr(e)

    def _render(self, out, first_frame, arrival_ns, lead_sec):
        self.clock.mark(arrival_ns, first_frame, lead_sec)
        self.started = True
        asked = self._asked
        if asked is not None and asked[0] != self._taken:
            self._taken = asked[0]
            self._regrid(asked[1], asked[2], first_frame)
        origin, from_k, tempo, bar_from, signature = self._grid
        if self._place is None and origin is None:
            origin = first_frame
            self._grid = (origin, from_k, tempo, bar_from, signature)
        voices = self.voices
        length = len(voices.of(0))
        end = first_frame + len(out)
        late = round(LATE_SEC * self.samplerate)
        bar = per_bar(signature)
        starts = self._starts
        starts.clear()
        sounding = self._sounding
        if sounding is not None:
            if sounding[0] + length > first_frame:
                starts.append(sounding)
            else:
                self._sounding = None
        while self._limit is None or self._next < self._limit:
            k = self._next
            if self._place is not None:
                frame = self._place(k)
                if frame is None:
                    break
            else:
                frame = origin + click_frame(k - from_k, tempo, self.samplerate)
            if frame >= end:
                break
            if first_frame - late <= frame < first_frame:
                frame = first_frame
            index = (k - bar_from) % bar
            self._rendered[k % RENDERED] = (k, frame, index)
            self._last = frame
            self._next = k + 1
            if self._on and frame >= first_frame:
                click = (frame, accent(signature, index))
                starts.append(click)
                self._sounding = click
        if starts:
            mix_clicks(out, first_frame, starts, voices, self.route)

    def _regrid(self, tempo, signature, first_frame):
        """The grid from the next click on, at a new tempo or signature: one
        new click after the last, or at the block's start if that has passed."""
        origin, from_k, _, bar_from, old = self._grid
        if signature != old:
            bar_from = self._next
        if self._place is None and origin is not None and self._last is not None:
            if self._last + click_frame(1, tempo, self.samplerate) >= first_frame:
                origin, from_k = self._last, self._next - 1
            else:
                origin, from_k = first_frame, self._next
        self._grid = (origin, from_k, tempo, bar_from, signature)
