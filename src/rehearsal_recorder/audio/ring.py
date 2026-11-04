"""
Sound through rtmixer's rings (docs/superpowers/specs/2026-11-04-sound-process-design.md,
Parts 2, 3 and 5).

rtmixer's callback is C. It copies a ring Python fills into the card, and the
card's inputs into a ring Python empties, and runs no Python on the way, so
nothing the interpreter is busy with can make the card wait. What Python
does is keep the rings a second ahead (playing) or empty (recording), on a
thread of its own here.

`RingOutput` plays. `fill` mixes one block of 1024 frames for a frame of the
stream; the ring holds a second of them. Two kinds of change:

- a setting (M, S, a fader, Master, a click's volume): the blocks the card has
  not reached are mixed again in place, from two card calls ahead of where it
  reads (twice its largest call, plus 256 frames). If Python is slow in
  between, the card plays the blocks as they were: the change is heard a
  little later, nothing else;
- a move (Play, Pause, a seek, the loop's jump): from a block ahead of the
  card, 24 blocks (about half a second) of the moved take are mixed into a
  buffer, copied into the ring in one piece, and the ring is cut after them,
  so nothing of the take as it was is left after the move.

Mixing again needs the state the mixing was in before each block: `state()`
saves it and `restore(s)` puts it back. A fill with no state of its own (a
function of the frame alone) passes neither.

If the ring runs dry anyway, rtmixer lets it go; a new one starts with 0.6 s
in it, and `counts["ran_dry"]` says how often.

`RingInput` records: rtmixer's callback writes the inputs into a ring of 2.5 s
and a thread here reads it every 2 ms, handing what it finds to `consume`. A
ring that filled (the thread held up that long) loses what the card captured
until it is recording again; that much silence is handed over in its place, so
the take keeps its length and its notes their places.

`RingMarks` marks the notes' clock from those reads (Part 5).

Frames are counted for the stream, not for one ring: a ring started again
after running dry goes on from where the mixing got to.
"""

import logging
import threading
import time

import numpy as np

from rehearsal_recorder.midi.clock import MAX_AGE_SEC

log = logging.getLogger(__name__)

# rtmixer's calls that queue an action or read which are left share one
# scratch pointer per stream, and a take's stream is played by one ring's
# thread and recorded by another's: one at a time, whatever the stream.
RTMIXER_LOCK = threading.Lock()

BLOCK = 1024

# A move mixes this many blocks in one piece (about half a second).
MOVE_BLOCKS = 24

# After a dry ring, it plays again once this share of the reserve is in it.
RESTART_SHARE = 0.6

# How often the threads look at their rings.
OUTPUT_TICK_SEC = 0.005
INPUT_TICK_SEC = 0.002

# How long stop() waits for a thread to finish its pass.
JOIN_SEC = 2.0

# How long move() waits for the thread to make the move: a seek is where it
# was sent as soon as it returns, for whoever asks the position next.
MOVE_WAIT_SEC = 0.1

_NS = 1e9


def _ceil_block(frame):
    return -(-frame // BLOCK) * BLOCK


def _ring_size(frames):
    size = BLOCK
    while size < frames:
        size *= 2
    return size


def _rtmixer():
    # Imported where it is used: only the sound process plays through it.
    import rtmixer
    return rtmixer


def _output_latency(mixer):
    latency = getattr(mixer, "latency", 0.0)
    if isinstance(latency, (tuple, list)):
        latency = latency[-1]
    try:
        latency = float(latency)
    except (TypeError, ValueError):
        return 0.0
    return latency if 0.0 <= latency < MAX_AGE_SEC else 0.0


def _input_latency(recorder):
    latency = getattr(recorder, "latency", 0.0)
    if isinstance(latency, (tuple, list)):
        latency = latency[0]
    try:
        latency = float(latency)
    except (TypeError, ValueError):
        return 0.0
    return latency if 0.0 <= latency < MAX_AGE_SEC else 0.0


class RingOutput:
    """
    Plays `fill`'s blocks through `mixer` (an rtmixer Mixer, or a
    MixerAndRecorder), `channels` wide, at `samplerate`.

    fill(out, frame, now_ns, lead_sec): mixes the block of the stream's
    `frame` into `out` (zeros, BLOCK by channels, float32); `now_ns` is now on
    time.perf_counter_ns() and `lead_sec` how long after it the block's first
    frame is heard. What it returns is kept for the block (`shown`).
    """

    def __init__(self, mixer, channels, samplerate, fill, state=None, restore=None,
                 heartbeat=None, reserve_sec=1.0):
        self.mixer = mixer
        self.channels = channels
        self.rate = int(samplerate)
        self._fill = fill
        self._state = state
        self._restore = restore
        self._heartbeat = heartbeat
        self.target = int(round(reserve_sec * self.rate))
        self.low = int(round(reserve_sec * RESTART_SHARE * self.rate))
        self.size = _ring_size(int(self.target * 1.5) + MOVE_BLOCKS * BLOCK)
        self._block = np.zeros((BLOCK, channels), dtype=np.float32)
        self._lock = threading.Lock()
        self._changed = False
        self._moves = []
        # Moves asked and moves made, and the frame the last one landed on:
        # see settled().
        self._asked = 0
        self._made = 0
        self._landed = None
        self._made_now = threading.Condition(self._lock)
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread = None
        self._took = 0.0  # seconds the last move took to mix
        self._seen = None  # frames the card had taken at the last look
        self.counts = {"ran_dry": 0, "lowest_reserve_frames": None}
        self._base = 0
        self.written = 0
        self.ring = None
        self._data = None
        self._action = None
        self._states = {}
        self._shown = {}
        self._end = None
        self._cursor = None
        self._started = False
        self.requested = 0

    # ---------- the ring ----------

    def _new_ring(self):
        rt = _rtmixer()
        self._base = self.written
        self.ring = rt.RingBuffer(elementsize=4 * self.channels, size=self.size)
        memory = rt._ffi.buffer(self.ring._ptr.buffer, self.size * 4 * self.channels)
        self._data = np.frombuffer(memory, dtype=np.float32).reshape(self.size, self.channels)
        self._action = None
        self._cursor = None

    def card_at(self):
        """The stream's frame the card has taken from the ring up to."""
        ring = self.ring
        if ring is None:
            return self.written
        return self.written - ring.read_available

    def _unsafe(self):
        """How far ahead of what the card has taken it may be reading: two
        of its calls, and 256 frames more."""
        action = self._action
        call = 0
        if action is not None:
            try:
                call = int(action.stats.max_blocksize)
            except Exception:
                call = 0
        return 2 * (call or BLOCK) + 256

    def heard(self):
        """The stream's frame the card plays this moment, by its clock:
        PortAudio's time less the time the ring started. Just after the
        card's first call, that is before the ring's first frame (heard an
        output latency later), and so is the frame. Counted from the ring
        instead when that time is not believable (none yet, more than a
        second before the ring's start, or past what it was given): what the
        card took, less the output latency. None until the card has taken
        from the ring, as nothing of it is heard before (a ring asked to
        start later, or one the card has not reached yet)."""
        action, base, written = self._action, self._base, self.written
        if action is None:
            return None
        started = action.actual_time
        if started > 0:
            try:
                into = int(round((self.mixer.time - started) * self.rate))
            except Exception:
                into = None
            if into is not None and -self.rate <= into <= written - base:
                return base + into
        taken = self.card_at()
        if self._started and taken > base:
            return max(base, taken - int(_output_latency(self.mixer) * self.rate))
        return None

    def soonest(self):
        """The first frame a change asked now is sure to be heard from: past
        the guard, and a card call more for the thread's next look. None
        until the card has taken from the ring."""
        if self.heard() is None:
            return None
        return _ceil_block(self.card_at() + self._unsafe()) + BLOCK

    @property
    def action(self):
        """rtmixer's action playing the ring, None before it plays."""
        return self._action

    @property
    def base(self):
        """The stream's frame the ring playing now began with."""
        return self._base

    def shown(self, frame):
        """What `fill` returned for the block that holds `frame`, None for one
        not (or no longer) kept."""
        if frame is None:
            return None
        return self._shown.get(frame - frame % BLOCK)

    # ---------- mixing ----------

    def _lead(self, frame, heard):
        """How long after now the block from `frame` is heard; None while
        nothing of the ring is (see heard), for a fill that marks a clock
        with it to leave it unmarked."""
        if heard is None:
            return None
        return (frame - heard) / self.rate

    def _mix(self, state, out, frame, heard, edits=()):
        """One block from `state` into `out`: (the state before it, after the
        edits; what fill returned; the state after it)."""
        if self._restore is not None and state is not None:
            self._restore(state)
        for edit in edits:
            edit()
        before = self._state() if self._state is not None else None
        out.fill(0.0)
        shown = self._fill(out, frame, time.perf_counter_ns(), self._lead(frame, heard))
        after = self._state() if self._state is not None else None
        return before, shown, after

    def _add(self, heard):
        at = self.written
        before, shown, self._end = self._mix(self._end, self._block, at, heard)
        self._states[at], self._shown[at] = before, shown
        self.ring.write(self._block)
        self.written = at + BLOCK

    def _remix(self, heard):
        at, state = self._cursor
        while at < self.written:
            if at < self.card_at() + self._unsafe():
                # The card has it already, as it was: go on after it.
                at += BLOCK
                state = self._states.get(at, state)
                continue
            before, shown, state = self._mix(state, self._block, at, heard)
            slot = (at - self._base) % self.size
            self._data[slot:slot + BLOCK] = self._block
            self._states[at], self._shown[at] = before, shown
            at += BLOCK
        self._end = state
        self._cursor = None

    def _cut_at(self, frame):
        """Ends the ring at `frame`, past where the card can be reading:
        what was written after it is dropped."""
        ptr = self.ring._ptr
        ptr.writeIndex = (frame - self._base) & ptr.bigMask
        for kept in (self._states, self._shown):
            for k in [k for k in kept if k >= frame]:
                del kept[k]
        self.written = frame

    def _move(self, edits, heard):
        buf = np.zeros((MOVE_BLOCKS * BLOCK, self.channels), dtype=np.float32)
        for _ in range(4):
            ahead = self._unsafe() + BLOCK + int(self._took * 1.5 * self.rate)
            at = _ceil_block(self.card_at() + ahead)
            if at >= self.written or at - self.card_at() + len(buf) > self.size:
                break
            began = time.perf_counter()
            state = self._states.get(at, self._end)
            kept = []
            for i in range(MOVE_BLOCKS):
                piece = buf[i * BLOCK:(i + 1) * BLOCK]
                before, shown, state = self._mix(state, piece, at + i * BLOCK, heard,
                                                 edits if i == 0 else ())
                kept.append((before, shown))
            self._took = time.perf_counter() - began
            if at < self.card_at() + self._unsafe():
                continue
            self._cut_at(at)
            slot = (at - self._base) % self.size
            first = min(len(buf), self.size - slot)
            self._data[slot:slot + first] = buf[:first]
            self._data[:len(buf) - first] = buf[first:]
            ptr = self.ring._ptr
            ptr.writeIndex = (at + len(buf) - self._base) & ptr.bigMask
            for i, (before, shown) in enumerate(kept):
                self._states[at + i * BLOCK], self._shown[at + i * BLOCK] = before, shown
            self.written = at + len(buf)
            self._end = state
            self._cursor = None
            self._landed = at
            return
        # The ring holds too little for a move ahead of the card, or Python
        # was too slow four times over: the move goes at the ring's end.
        if self._restore is not None and self._end is not None:
            self._restore(self._end)
        for edit in edits:
            edit()
        self._end = self._state() if self._state is not None else None
        self._cursor = None
        self._landed = self.written

    def _play(self, at=0):
        with RTMIXER_LOCK:
            self._action = self.mixer.play_ringbuffer(self.ring, start=at)

    # ---------- what the owner calls ----------

    def start(self, worker=True, when=None):
        """Fills a second and plays it; with `worker`, a thread keeps it
        filled (without, `service` is called by hand, as the tests do).
        `when()`, asked once the second is mixed, is the stream time the
        ring is to be heard from (`requested`); without it, at once."""
        with self._lock:
            self._new_ring()
            self._end = self._state() if self._state is not None else None
            while self.ring.read_available < self.target:
                self._add(None)
            self.requested = when() if when is not None else 0
            self._play(self.requested)
            self._started = True
        if self._heartbeat is not None:
            self._heartbeat.start()
        if worker:
            self._thread = threading.Thread(target=self._run, name="ring-output", daemon=True)
            self._thread.start()

    def stop(self):
        """Stops the thread and lets go of the ring. The stream is the
        owner's to close. What the mixing depends on is put back as it was
        for the block heard now (or the one the last move landed on, when
        the card has not got there), with moves still waiting made after it:
        a stream opened next goes on from what was heard, not from a second
        ahead of it."""
        self._stop.set()
        self._wake.set()
        thread, self._thread = self._thread, None
        if thread is not None and thread is not threading.current_thread():
            thread.join(JOIN_SEC)
        with self._lock:
            frame = self.heard()
            if frame is not None:
                frame = max(self._base, frame)
            if self._landed is not None and (frame is None or self._landed > frame):
                frame = self._landed
            state = None if frame is None else self._states.get(frame - frame % BLOCK)
            if state is not None and self._restore is not None:
                self._restore(state)
            moves, self._moves = self._moves, []
            for edit in moves:
                edit()
            self._made = self._asked
            self._made_now.notify_all()
        if self._heartbeat is not None:
            self._heartbeat.stop()
        action = self._action
        if action is not None:
            try:
                with RTMIXER_LOCK:
                    self.mixer.cancel(action)
            except Exception:
                pass  # the stream is going, and the ring with it

    def change(self):
        """A setting changed: the ring is mixed again from the guard."""
        self._changed = True

    def move(self, edit):
        """`edit()` is applied a block ahead of the card, and the ring after it
        mixed from there: Play, Pause, a seek, the loop. With a thread filling
        the ring, it is woken for it, and the move made when this returns
        (MOVE_WAIT_SEC at most)."""
        with self._lock:
            self._moves.append(edit)
            self._asked += 1
            asked = self._asked
            thread = self._thread
            if thread is None or thread is threading.current_thread() or self._stop.is_set():
                return
            self._wake.set()
            self._made_now.wait_for(lambda: self._made >= asked or self._stop.is_set(), MOVE_WAIT_SEC)

    @property
    def landed(self):
        """The frame the last move made landed on, None before one."""
        return self._landed

    def settled(self):
        """Whether the card has played up to the last move asked: until then
        the buttons show what was asked, not what is heard."""
        if self._made != self._asked:
            return False
        landed = self._landed
        if landed is None:
            return True
        heard = self.heard()
        return heard is not None and heard >= landed

    def service(self):
        """One look at the ring: restarted if it ran dry, moves and changes
        mixed, topped up to a second."""
        with self._lock:
            self._service()
            self._made_now.notify_all()

    def _service(self):
        heard = self.heard()
        self._beat()
        action = self._action
        with RTMIXER_LOCK:
            gone = action is not None and action not in self.mixer.actions
        if gone:
            # Ran dry: rtmixer let the ring go. A new one from where the
            # mixing got to.
            self.counts["ran_dry"] += 1
            # It held nothing at the end: the least it held is none.
            self.counts["lowest_reserve_frames"] = 0
            self._new_ring()
            while self.ring.read_available < self.low:
                self._add(None)
            self._play()
            return
        have = self.ring.read_available
        lowest = self.counts["lowest_reserve_frames"]
        if lowest is None or have < lowest:
            self.counts["lowest_reserve_frames"] = have
        moves, self._moves, asked = self._moves, [], self._asked
        if moves:
            self._changed = False
            self._move(moves, heard)
        self._made = asked
        if self._changed:
            self._changed = False
            at = _ceil_block(self.card_at() + self._unsafe())
            if at < self.written:
                self._cursor = (at, self._states.get(at, self._end))
        if self._cursor is not None:
            self._remix(heard)
        while self.ring.read_available < self.target and self.ring.write_available >= BLOCK:
            self._add(heard)
        old = self.card_at() - 8 * BLOCK
        for kept in (self._states, self._shown):
            for k in [k for k in kept if k < old]:
                del kept[k]

    def _beat(self):
        """The card took sound since the last look: it is still there."""
        taken = self.card_at()
        if self._heartbeat is not None and taken != self._seen:
            self._heartbeat.enter()
            self._heartbeat.leave()
        self._seen = taken

    def _run(self):
        while not self._stop.is_set():
            try:
                self.service()
            except Exception as e:  # noqa: BLE001  the thread must go on
                self.fault = repr(e)
            self._wake.wait(OUTPUT_TICK_SEC)
            self._wake.clear()

    fault = None


class RingInput:
    """
    Records `channels` of `recorder` (an rtmixer Recorder or MixerAndRecorder)
    at `samplerate` into a ring of `seconds` and hands each arrival to
    `consume(block, first_frame, arrival_ns)`: float32 frames by channels, the
    stream's frame of the first, and when they arrived on
    time.perf_counter_ns(), the middle of this read and the one before.
    Silence handed over for frames the card captured while the ring could not
    take them has `arrival_ns` None.
    """

    def __init__(self, recorder, channels, samplerate, consume, heartbeat=None, seconds=2.5):
        self.recorder = recorder
        self.channels = channels
        self.rate = int(samplerate)
        self._consume = consume
        self._heartbeat = heartbeat
        self.size = _ring_size(int(seconds * self.rate))
        rt = _rtmixer()
        self.ring = rt.RingBuffer(elementsize=4 * channels, size=self.size)
        self._buf = np.zeros((self.size, channels), dtype=np.float32)
        self.counts = {"overflowed": 0, "lost_frames": 0, "fullest_frames": 0}
        self.frames = 0
        self._action = None
        self._gap_from = None  # stream time the frames lost begin at
        self._last_ns = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self.fault = None
        # How long the last read waited on the one before: how sure its
        # arrival time is (see RingMarks).
        self.window_ns = None
        # The stream time the ring's frame 0 was captured at, once the card
        # has begun recording into it.
        self.started_time = None

    @property
    def action(self):
        return self._action

    def start(self, at=0, worker=True):
        """Records from the stream time `at` (0: at once)."""
        with RTMIXER_LOCK:
            self._action = self.recorder.record_ringbuffer(self.ring, start=at)
        self._last_ns = time.perf_counter_ns()
        if self._heartbeat is not None:
            self._heartbeat.start()
        if worker:
            self._thread = threading.Thread(target=self._run, name="ring-input", daemon=True)
            self._thread.start()

    def stop(self, drain=True):
        """Stops the thread; with `drain`, what is left in the ring is
        handed over first."""
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None and thread is not threading.current_thread():
            thread.join(JOIN_SEC)
        if drain:
            self.service()
        if self._heartbeat is not None:
            self._heartbeat.stop()
        action = self._action
        if action is not None:
            try:
                with RTMIXER_LOCK:
                    self.recorder.cancel(action)
            except Exception:
                pass

    def service(self, now_ns=None):
        with self._lock:
            self._service(time.perf_counter_ns() if now_ns is None else now_ns)

    def _service(self, now):
        action = self._action
        if action is None:
            return
        last, self._last_ns = self._last_ns, now
        if self.started_time is None and action.actual_time > 0:
            self.started_time = action.actual_time
        if self._gap_from is not None:
            if action.actual_time <= 0:
                return  # the new recording has not begun: nothing in the ring yet
            lost = max(0, int(round((action.actual_time - self._gap_from) * self.rate)))
            self._gap_from = None
            self.counts["lost_frames"] += lost
            while lost > 0:
                n = min(lost, self.size)
                silence = self._buf[:n]
                silence.fill(0.0)
                self._consume(silence, self.frames, None)
                self.frames += n
                lost -= n
        with RTMIXER_LOCK:
            dropped = action not in self.recorder.actions
        have = self.ring.read_available
        if have > self.counts["fullest_frames"]:
            self.counts["fullest_frames"] = have
        if have:
            n = self.ring.readinto(self._buf[:have])
            arrival = now if last is None else (last + now) // 2
            self.window_ns = None if last is None else now - last
            # Inside the heartbeat, as a callback is: a disk slow to take the
            # frames is the app busy with them, not the card gone.
            beat = self._heartbeat
            if beat is not None:
                beat.enter()
            try:
                self._consume(self._buf[:n], self.frames, arrival)
            finally:
                self.frames += n
                if beat is not None:
                    beat.leave()
        if dropped and not self._stop.is_set():
            # The ring filled and rtmixer let it go. Recording again at once;
            # what the card captured meanwhile is handed over as silence.
            self.counts["overflowed"] += 1
            self._gap_from = action.actual_time + action.done_frames / self.rate
            with RTMIXER_LOCK:
                self._action = self.recorder.record_ringbuffer(self.ring)

    def look(self):
        """One look at the ring (service), as its thread makes it: one that
        fails is kept as the ring's fault, the first said in the log, and
        the take says it could not be written (AudioRecorder.problem)."""
        try:
            self.service()
        except Exception as e:  # noqa: BLE001  the thread must go on
            if self.fault is None:
                log.error("The take could not be written: %r", e)
            self.fault = repr(e)

    def _run(self):
        while not self._stop.is_set():
            self.look()
            self._stop.wait(INPUT_TICK_SEC)


class RingMarks:
    """
    The notes' clock (midi/clock.AudioClock) marked from a recording ring's
    reads (Part 5). Each read that found frames says they arrived at
    `arrival_ns`, give or take half of `window_ns`, the time since the read
    before; the first frame of the card call that brought them was captured
    the stream's input latency before. Once a second of frames has passed,
    one mark: the mean of that second's reads, so a coarse sleep between
    reads costs no precision. The first comes after FIRST_MARK_SEC, so a
    take's click on another device has a clock to start by.

    A read that waited longer than WINDOW_SEC on the one before says too
    little of when its frames came, and is left out. Each read kept is the
    clock's latest mark besides (AudioClock.mark_latest), not kept for the
    fit: take.clock writes the kept marks up to the latest.
    """

    FIRST_MARK_SEC = 0.25
    WINDOW_SEC = 0.01

    def __init__(self, clock, samplerate, latency_sec, block=BLOCK):
        self.clock = clock
        self.rate = samplerate
        self.latency_ns = int(round(latency_sec * _NS))
        self.block = block
        self._reads = []
        self._span = self.FIRST_MARK_SEC * samplerate

    def read(self, first_frame, frames, arrival_ns, window_ns=None):
        if arrival_ns is None or frames <= 0:
            return
        if window_ns is not None and window_ns > self.WINDOW_SEC * _NS:
            return
        reads = self._reads
        # Several calls in one read came together: the last is the one that
        # arrived then.
        frame = first_frame + max(0, frames - self.block)
        seen = (arrival_ns - self.latency_ns, frame)
        reads.append(seen)
        if frame - reads[0][1] >= self._span:
            n = len(reads)
            ns = round(sum(r[0] for r in reads) / n)
            mean = round(sum(r[1] for r in reads) / n)
            # Cleared first: a clock that raises is asked again in a second,
            # not at every read after.
            reads.clear()
            self._span = self.rate
            self.clock.mark_at(ns, mean)
        # The newest frame seen, between the marks, as a callback's every
        # block said it.
        latest = getattr(self.clock, "mark_latest", None)
        if latest is not None:
            latest(*seen)
