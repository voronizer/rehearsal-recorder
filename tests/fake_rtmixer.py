"""
A stand-in for rtmixer 0.1.7 in the test suites: no PortAudio, no card.

What it copies from rtmixer's C callback (src/rtmixer.c), because the code
under test depends on each of these:

- a play action takes the frames a card call needs from its ring; when the
  ring has fewer, it plays what is there and the action is let go (it leaves
  `actions`). A record action is let go the same way when its ring has no
  room for a whole call;
- an action asked to start later waits whole card calls, then starts on the
  frame asked for, and `actual_time` is that moment (output time for play,
  input time for record); one asked to start in the past starts at once,
  unless `allow_belated=False`, when it is dropped with `actual_time` 0.0;
  before the card has seen it, `actual_time` is -1.0 (or 0.0);
- the ring is PortAudio's: a power of two in size, read and write indexes
  running to twice the size (`bigMask`), so a player may write into the
  ring's memory in place (`_ffi.buffer(ring._ptr.buffer, n)`) and cut it by
  setting `writeIndex`;
- `stats` on a running stream raises, as rtmixer's does.

The card is driven by hand: `card.pump(frames)` is one card call for every
started stream and returns what each played; `card.feed(array)` queues what
the card's inputs will hear. `card.time` starts at 1.0 and moves on by the
call's length after each call. `card.out_latency` and `card.in_latency` (0.0
unless a check sets them) put the output and input times either side of it.
"""

import sys

import numpy as np

__version__ = "0.1.7"

PLAY_RINGBUFFER, RECORD_RINGBUFFER, CANCEL = 1, 3, 4


class _Ptr:
    """PaUtilRingBuffer's fields, the ones a player reaches."""

    def __init__(self, elementsize, size):
        self.bufferSize = size
        self.bigMask = 2 * size - 1
        self.smallMask = size - 1
        self.elementSizeBytes = elementsize
        self.writeIndex = 0
        self.readIndex = 0
        self.buffer = bytearray(elementsize * size)


class _FFI:
    @staticmethod
    def buffer(memory, size):
        return memoryview(memory)[:size]


_ffi = _FFI()


def _bytes(data):
    """The bytes of `data`, sharing its memory, so a read can land in it."""
    if isinstance(data, np.ndarray):
        if not data.flags.c_contiguous:
            raise ValueError("data must be contiguous")
        return data.reshape(-1).view(np.uint8)
    return np.frombuffer(data, dtype=np.uint8)


class RingBuffer:
    def __init__(self, elementsize, size=None, buffer=None):
        if buffer is not None or size is None:
            raise TypeError("the fake ring takes a size only")
        if size < 1 or size & (size - 1):
            raise ValueError("size must be a power of 2")
        self._ptr = _Ptr(elementsize, size)
        self._memory = np.frombuffer(self._ptr.buffer, dtype=np.uint8)

    @property
    def elementsize(self):
        return self._ptr.elementSizeBytes

    def __len__(self):
        return self._ptr.bufferSize

    @property
    def read_available(self):
        p = self._ptr
        return (p.writeIndex - p.readIndex) & p.bigMask

    @property
    def write_available(self):
        return self._ptr.bufferSize - self.read_available

    def flush(self):
        self._ptr.writeIndex = self._ptr.readIndex = 0

    def _copy_in(self, start, raw):
        size, es = self._ptr.bufferSize, self.elementsize
        slot = start & self._ptr.smallMask
        n = len(raw) // es
        first = min(n, size - slot)
        self._memory[slot * es:(slot + first) * es] = raw[:first * es]
        self._memory[:(n - first) * es] = raw[first * es:]

    def _copy_out(self, start, n):
        size, es = self._ptr.bufferSize, self.elementsize
        slot = start & self._ptr.smallMask
        first = min(n, size - slot)
        return np.concatenate((self._memory[slot * es:(slot + first) * es],
                               self._memory[:(n - first) * es]))

    def write(self, data, size=-1):
        raw = _bytes(data)
        whole = len(raw) // self.elementsize
        n = min(whole if size < 0 else size, self.write_available)
        self._copy_in(self._ptr.writeIndex, raw[:n * self.elementsize])
        self._ptr.writeIndex = (self._ptr.writeIndex + n) & self._ptr.bigMask
        return n

    def readinto(self, data):
        target = _bytes(data)
        n = min(len(target) // self.elementsize, self.read_available)
        target[:n * self.elementsize] = self._copy_out(self._ptr.readIndex, n)
        self._ptr.readIndex = (self._ptr.readIndex + n) & self._ptr.bigMask
        return n

    def read(self, size=-1):
        n = self.read_available if size < 0 else min(size, self.read_available)
        out = bytearray(n * self.elementsize)
        self.readinto(out)
        return bytes(out)


class _Stats:
    def __init__(self):
        self.blocks = self.min_blocksize = self.max_blocksize = 0
        self.input_underflows = self.input_overflows = 0
        self.output_underflows = self.output_overflows = 0

    def count(self, frames):
        if self.blocks == 0:
            self.min_blocksize = self.max_blocksize = frames
        else:
            self.min_blocksize = min(self.min_blocksize, frames)
            self.max_blocksize = max(self.max_blocksize, frames)
        self.blocks += 1


class _Action:
    def __init__(self, type, ring=None, channels=0, mapping=(), start=0.0,
                 allow_belated=True, target=None):
        self.type = type
        self.ringbuffer = ring
        self.channels = channels
        self.mapping = tuple(mapping)
        self.requested_time = start
        self.actual_time = -1.0 if allow_belated else 0.0
        self.action = target
        self.done_frames = 0
        self.stats = _Stats()


class _Card:
    def __init__(self):
        self.reset()

    def reset(self):
        self.time = 1.0
        self.out_latency = 0.0
        self.in_latency = 0.0
        self.streams = []
        self._fed = np.zeros((0, 0), dtype=np.float32)

    def feed(self, frames):
        frames = np.asarray(frames, dtype=np.float32)
        if len(self._fed) == 0:
            self._fed = frames.copy()
        else:
            self._fed = np.concatenate((self._fed, frames))

    def _heard(self, frames, channels):
        got = np.zeros((frames, channels), dtype=np.float32)
        take = self._fed[:frames]
        if len(take):
            width = min(channels, take.shape[1])
            got[:len(take), :width] = take[:, :width]
        self._fed = self._fed[len(take):]
        return got

    def pump(self, frames):
        """One card call of `frames` for every started stream. Returns
        {stream: what it played} for the streams that play."""
        played = {}
        rate = self.streams[0].samplerate if self.streams else 48000.0
        width = max([s._inputs for s in self.streams] + [1])
        heard = self._heard(frames, width)
        for stream in list(self.streams):
            out = stream._call(frames, heard[:, :stream._inputs])
            if out is not None:
                played[stream] = out
        self.time += frames / rate
        return played


card = _Card()

# A suite with stream stand-ins of its own (a card that refuses to open, one
# that hangs on stop, ASIO's one stream at a time) hands them the opening:
# twins(kind, settings) with kind "output", "input" or "duplex" returns an
# object whose start, stop and close each stream's own call first, or raises
# as that card would.
twins = None


class _Base:
    def __init__(self, kind, **kwargs):
        # What it was opened with, for a check that asks.
        self.kw = dict(kwargs)
        self._twin = twins(kind, self.kw) if twins is not None else None
        self._open(kind, **kwargs)

    def _open(self, kind, samplerate=None, channels=None, blocksize=0, device=None,
              latency=None, **kwargs):
        self.kind = kind
        self.samplerate = float(samplerate or 48000)
        self.blocksize = blocksize
        self.device = device
        if channels is None:
            channels = (2, 2) if kind == "duplex" else 2
        self.channels = channels
        if kind == "duplex":
            self._inputs, self._outputs = channels
        elif kind == "input":
            self._inputs, self._outputs = channels, 0
        else:
            self._inputs, self._outputs = 0, channels
        self.active = False
        self.closed = False
        self._live = []
        self._stats = _Stats()

    @property
    def time(self):
        return card.time

    @property
    def latency(self):
        if self.kind == "duplex":
            return (card.in_latency, card.out_latency)
        return card.in_latency if self.kind == "input" else card.out_latency

    @property
    def actions(self):
        return set(self._live)

    @property
    def stats(self):
        if self.active:
            raise RuntimeError("Accessing .stats on an active stream")
        return self._stats

    def start(self):
        if self.closed:
            raise RuntimeError("stream is closed")
        if self._twin is not None:
            self._twin.start()
        if not self.active:
            self.active = True
            card.streams.append(self)

    def stop(self):
        if self._twin is not None:
            self._twin.stop()
        if self.active:
            self.active = False
            card.streams.remove(self)

    abort = stop

    def close(self):
        if self.active:
            self.active = False
            card.streams.remove(self)
        if self._twin is not None and not self.closed:
            self._twin.close()
        self.closed = True

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *exc):
        self.close()

    def cancel(self, action, time=0, allow_belated=True):
        cancel = _Action(CANCEL, start=time, allow_belated=allow_belated, target=action)
        self._live.insert(0, cancel)
        return cancel

    def wait(self, action=None, sleeptime=10):
        raise RuntimeError("the fake card moves only when a check pumps it")

    def _mapping(self, channels, most):
        try:
            count, mapping = len(channels), tuple(channels)
        except TypeError:
            count, mapping = channels, tuple(range(1, channels + 1))
        if max(mapping) > most:
            raise ValueError("Channel number too large")
        if min(mapping) < 1:
            raise ValueError("Channel numbers start with 1")
        return count, mapping

    def _add(self, type, ring, channels, start, allow_belated, most):
        if channels is None:
            channels = ring.elementsize // 4
        count, mapping = self._mapping(channels, most)
        if ring.elementsize != 4 * count:
            raise ValueError("Incompatible elementsize")
        action = _Action(type, ring, count, mapping, start, allow_belated)
        self._live.append(action)
        return action

    def _call(self, frames, heard):
        self._stats.count(frames)
        out = np.zeros((frames, self._outputs), dtype=np.float32) if self._outputs else None
        for action in list(self._live):
            if action not in self._live:
                continue
            if action.type == CANCEL:
                if action.action in self._live:
                    self._live.remove(action.action)
                self._live.remove(action)
                continue
            play = action.type == PLAY_RINGBUFFER
            now = card.time + card.out_latency if play else card.time - card.in_latency
            offset = 0
            if action.done_frames == 0:
                diff = action.requested_time - now
                if diff >= 0.0:
                    offset = int(round(diff * self.samplerate))
                    if offset >= frames:
                        action.actual_time = -1.0
                        continue
                    action.actual_time = now + offset / self.samplerate
                elif action.actual_time == 0.0:
                    self._live.remove(action)
                    continue
                else:
                    action.actual_time = now
            action.stats.count(frames)
            want = frames - offset
            ring = action.ringbuffer
            columns = [m - 1 for m in action.mapping]
            if play:
                got = np.zeros((min(want, ring.read_available), action.channels), dtype=np.float32)
                ring.readinto(got)
                out[offset:offset + len(got)][:, columns] += got
                done = len(got)
            else:
                done = min(want, ring.write_available)
                ring.write(np.ascontiguousarray(heard[offset:offset + done][:, columns]))
            action.done_frames += done
            if done < want:
                self._live.remove(action)
        return out


class Mixer(_Base):
    def __init__(self, **kwargs):
        _Base.__init__(self, "output", **kwargs)

    def play_ringbuffer(self, ringbuffer, channels=None, start=0, allow_belated=True):
        return self._add(PLAY_RINGBUFFER, ringbuffer, channels, start, allow_belated, self._outputs)


class Recorder(_Base):
    def __init__(self, **kwargs):
        _Base.__init__(self, "input", **kwargs)

    def record_ringbuffer(self, ringbuffer, channels=None, start=0, allow_belated=True):
        return self._add(RECORD_RINGBUFFER, ringbuffer, channels, start, allow_belated, self._inputs)


class MixerAndRecorder(Mixer, Recorder):
    def __init__(self, **kwargs):
        _Base.__init__(self, "duplex", **kwargs)


_KINDS = {"output": "OutputStream", "input": "InputStream", "duplex": "Stream"}


def install(sd=None):
    """Puts this module in sys.modules as `rtmixer` and returns it. With `sd`,
    a suite's sounddevice stand-in, each stream is opened through that
    module's own stream class of its kind as well (see `twins`), looked up as
    it opens, so a check that swaps one in has rtmixer's streams follow."""
    global twins
    module = sys.modules[__name__]
    sys.modules["rtmixer"] = module
    if sd is not None:
        def through(kind, settings):
            stand_in = getattr(sd, _KINDS[kind], None)
            return stand_in(**settings) if stand_in is not None else None
        twins = through
    return module

