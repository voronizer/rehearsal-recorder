"""
A song's backing track playing (backing-track spec, Part 3), rendered a block
at a time into whichever stream plays it, as the click is (audio/click_source.py):
the take's stream on the recording card, its own output on another device, or
the player's stream between takes.

Between takes it plays from where it was started, a frame of the file to a
frame of the stream. In a take it is placed instead (`place`): the take says
which frame of the file each frame of this stream plays, so the file's bar 1
lands on the take's. On the recording card that is the stream's own frames,
and it is read frame for frame. On another device the place comes through two
clocks, the recording's and the output's, and it moves a little each time
their lines are fitted again. A file must not jump, so there it follows
(`follow`): each block is read at the speed that brings it to where the take
says it should be by the block's end, never more than FOLLOW_LIMIT off its own
speed, a sample between two frames taken on the straight line between them.

What is heard is the file at its volume, nothing while it is switched off, and
at Stop a fade over FADE_SEC, so the room hears no click. A change of either is
ramped over the same 20 ms. None of it changes the take's Backing track, which
is written from the file (audio/backing_file.write_take_track).

`render` runs on the audio thread. It takes no lock: what other threads set or
read is in single attributes, each replaced whole, taken up at the next block.
"""

import math

import numpy as np

from rehearsal_recorder.audio.click_timing import OutputClock

# The fade at Stop, and the ramp of a change of volume or of the switch.
FADE_SEC = 0.02
# How far from the file's own speed it may be played to follow another
# device's clock: under the spec's 0.1 %, too small to hear. Two cards 200 ppm
# apart need 0.02 %.
FOLLOW_LIMIT = 0.0009

# Frames of a block the scratch buffers are made for; a longer one grows them.
BLOCK_FRAMES = 1024


class BackingSource:
    """
    An opened ready file (backing_file.open_ready) into the stream's channels
    in `route` (0-based) at `volume` (0..1). `samplerate`: the stream's, if not
    the file's.

    Between takes it plays from the file's frame `start`. In a take `place(o)`
    is the frame of the file (a float, or None for silence) the stream's frame
    `o` plays, `follow` says it comes through another device's clock, and the
    file before its frame `floor` is not heard: the take has not begun there.
    """

    def __init__(self, opened, route, volume, place=None, follow=False, start=0, floor=0,
                 samplerate=None):
        self._data, self._frames, self.file_rate, _, self.channels = opened
        self.route = tuple(route)
        self.samplerate = int(samplerate or self.file_rate)
        self.clock = OutputClock(self.samplerate)
        self._place = place
        self._follow = bool(follow)
        self._start = start
        self._floor = max(0, floor)
        # File frames to a stream frame: 1 unless the stream runs at another rate.
        self._nominal = self.file_rate / self.samplerate
        self._fade = max(1, round(FADE_SEC * self.samplerate))
        self._ramp = np.arange(self._fade + 1, dtype=np.float32) / np.float32(self._fade)
        # Asked from other threads.
        self._volume = float(volume)
        self._on = True
        self._fading = False
        # The audio thread's: the gain now, and the ramp it is on (from, to,
        # frames of it done; done when it reaches self._fade).
        self._gain = self._volume
        self._ramp_from = self._ramp_to = self._gain
        self._ramp_done = self._fade
        # Between takes, the stream's frame the file started at; following,
        # the file's frame the next block starts at.
        self._origin = None
        self._pos = None
        self._past_end = False
        self._block = np.zeros((BLOCK_FRAMES, self.channels), np.float32)
        self._gains = np.zeros(BLOCK_FRAMES, np.float32)
        self._index = np.arange(BLOCK_FRAMES, dtype=np.float64)
        self._segment = np.zeros((BLOCK_FRAMES + 2, self.channels), np.float32)
        # Seconds into the file at the start of the last block rendered: None
        # before it plays, and on past the file's end in a take.
        self.position_sec = None
        # As ClickSource's: a take on another device waits for `started`
        # before it chooses its first frame, and `written` says how far the
        # stream has rendered. repr() of the first error in render, which
        # carries on in silence.
        self.started = False
        self.written = None
        self.fault = None

    # ---------- from other threads ----------

    def set_on(self, on):
        """The row's switch: off, it goes on playing and is not heard."""
        self._on = bool(on)

    def set_volume(self, volume):
        self._volume = float(volume)

    def fade_out(self):
        """Stop: what is heard fades out over FADE_SEC, then is silent."""
        self._fading = True

    @property
    def done(self):
        """Faded out, or between takes played to the file's end."""
        return (self._fading and self._ramp_done >= self._fade and self._gain == 0.0) or self._past_end

    # ---------- the audio thread ----------

    def render(self, out, first_frame, arrival_ns, lead_sec):
        """
        Adds the file into `out`, a block (frames by channels) whose first
        frame is the stream's `first_frame`, its callback run at `arrival_ns`
        and its first frame heard `lead_sec` after that, as ClickSource.render.
        An error is kept in `fault` and the block left as it is.
        """
        try:
            self._render(out, first_frame, arrival_ns, lead_sec)
        except Exception as e:
            if self.fault is None:
                self.fault = repr(e)

    def _render(self, out, first_frame, arrival_ns, lead_sec):
        self.clock.mark(arrival_ns, first_frame, lead_sec)
        n = len(out)
        # `written` before `started`: whoever sees the one sees the other.
        self.written = (first_frame + n, n)
        self.started = True
        gain = self._gain_for(n)
        at = self._where(first_frame, n)
        if at is None:
            return
        pos, step = at
        self.position_sec = pos / self.file_rate
        if self._place is None and pos >= self._frames:
            self._past_end = True
        if not isinstance(gain, np.ndarray) and gain == 0.0:
            return
        block = self._read(pos, step, n)
        if block is None:
            return
        if isinstance(gain, np.ndarray):
            block *= gain[:, None]
        elif gain != 1.0:
            block *= np.float32(gain)
        self._mix(out, block)

    def _gain_for(self, n):
        """The gain over the next `n` frames: a number, or a ramp of them."""
        target = 0.0 if self._fading or not self._on else self._volume
        if target != self._ramp_to:
            self._ramp_from, self._ramp_to, self._ramp_done = self._gain, target, 0
        left = self._fade - self._ramp_done
        if left <= 0:
            self._gain = self._ramp_to
            return self._gain
        if len(self._gains) < n:
            self._gains = np.zeros(n, np.float32)
        gains = self._gains[:n]
        k = min(left, n)
        done = self._ramp_done
        g0, g1 = self._ramp_from, self._ramp_to
        np.multiply(self._ramp[done + 1:done + k + 1], np.float32(g1 - g0), out=gains[:k])
        gains[:k] += np.float32(g0)
        gains[k:] = g1
        self._ramp_done = done + k
        self._gain = g1 if self._ramp_done >= self._fade else float(gains[k - 1])
        return gains

    def _where(self, first_frame, n):
        """(the file's frame the block starts at, file frames a stream frame),
        or None while the take says nothing is heard."""
        if self._place is None:
            if self._origin is None:
                self._origin = first_frame
            if self._nominal == 1.0:
                return self._start + (first_frame - self._origin), 1.0
            return self._start + (first_frame - self._origin) * self._nominal, self._nominal
        if not self._follow:
            pos = self._place(first_frame)
            return None if pos is None else (pos, self._nominal)
        aim = self._place(first_frame)
        if aim is None:
            self._pos = None
            return None
        pos = aim if self._pos is None else self._pos
        end = self._place(first_frame + n)
        step = self._nominal if end is None else (end - pos) / n
        low, high = self._nominal * (1 - FOLLOW_LIMIT), self._nominal * (1 + FOLLOW_LIMIT)
        step = min(high, max(low, step))
        self._pos = pos + step * n
        return pos, step

    def _read(self, pos, step, n):
        """`n` frames of the file from frame `pos`, `step` apart, as a float32
        block; silence before `floor` and after the end. None when none of it
        is heard."""
        floor, frames = self._floor, self._frames
        last = pos + step * (n - 1)
        if last < floor - 1 or pos >= frames:
            return None
        if len(self._block) < n:
            self._block = np.zeros((n, self.channels), np.float32)
            self._index = np.arange(n, dtype=np.float64)
            self._segment = np.zeros((n + 2, self.channels), np.float32)
        block = self._block[:n]
        block.fill(0.0)
        if step == 1.0 and float(pos).is_integer():
            a = int(pos)
            first, end = max(a, floor), min(a + n, frames)
            if first < end:
                block[first - a:end - a] = self._data[first:end]
            return block
        a = math.floor(pos)
        width = math.floor(last) + 2 - a
        if len(self._segment) < width:
            self._segment = np.zeros((width, self.channels), np.float32)
        segment = self._segment[:width]
        segment.fill(0.0)
        first, end = max(a, floor), min(a + width, frames)
        if first < end:
            segment[first - a:end - a] = self._data[first:end]
        x = (pos - a) + step * self._index[:n]
        lo = x.astype(np.int64)
        frac = (x - lo).astype(np.float32)[:, None]
        np.multiply(segment[lo], 1 - frac, out=block)
        block += segment[lo + 1] * frac
        return block

    def _mix(self, out, block):
        """A mono file into every output of its route; a stereo one left and
        right into two, or both sides averaged into one."""
        width = out.shape[1]
        route = self.route
        if self.channels == 1:
            for c in route:
                if c < width:
                    out[:, c] += block[:, 0]
        elif len(route) >= 2:
            for side, c in enumerate(route[:2]):
                if c < width:
                    out[:, c] += block[:, side]
        elif route and route[0] < width:
            column = out[:, route[0]]
            column += (block[:, 0] + block[:, 1]) * np.float32(0.5)


class Sources:
    """Several sources in one stream (the click and the backing track on one
    device), rendered in turn: the contract of each, the route of all."""

    def __init__(self, *sources):
        self.sources = tuple(sources)
        self.route = tuple(sorted({c for s in self.sources for c in s.route}))

    @property
    def fault(self):
        return next((s.fault for s in self.sources if s.fault is not None), None)

    def render(self, out, first_frame, arrival_ns, lead_sec):
        for source in self.sources:
            source.render(out, first_frame, arrival_ns, lead_sec)
