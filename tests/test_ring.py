"""
Sound through rtmixer's rings (docs/superpowers/specs/2026-11-04-sound-process-design.md,
Parts 4 to 7): audio/ring.py, and the players and recorders built on it.

No sound card here. tests/fake_rtmixer.py stands in for rtmixer, and its
card runs one card call at a time when a check asks it to (card.pump), so
every check knows exactly what the card has taken and what it has heard.
The first group checks the fake itself against what rtmixer's C callback
does (src/rtmixer.c in rtmixer 0.1.7), since every later check leans on it.
"""

import logging
import sys
import time
import types
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))
sys.path.insert(0, str(HERE))

# No sound card library here: the fake rtmixer needs none, and the modules
# that still import sounddevice get a stand-in that finds no card.
_sd = types.ModuleType("sounddevice")
_sd.query_devices = lambda *a, **k: []
_sd.query_hostapis = lambda: []
_sd.OutputStream = _sd.InputStream = _sd.Stream = None
sys.modules.setdefault("sounddevice", _sd)
# No suite opens a real MIDI port.
sys.modules["pylibremidi"] = None

import numpy as np  # noqa: E402

import fake_rtmixer  # noqa: E402

fake_rtmixer.install()
import rtmixer  # noqa: E402  (the fake, from sys.modules)

problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else,
    # a star or an arrow, taking the whole suite down with it.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


RATE = 48000


def fake_card_behaves():
    print("\n[1] The fake card does what rtmixer's callback does")
    card = fake_rtmixer.card
    card.reset()

    # Play: a ring with 2048 frames gives 1024 a call, and the call that
    # finds 512 plays them and lets the ring go.
    mixer = rtmixer.Mixer(channels=2, samplerate=RATE, blocksize=1024)
    mixer.start()
    ring = rtmixer.RingBuffer(elementsize=8, size=4096)
    tone = np.full((2048, 2), 0.25, dtype=np.float32)
    ring.write(tone)
    action = mixer.play_ringbuffer(ring)
    ok("a new play action waits for the card (actual_time -1)", action.actual_time == -1.0)
    out = card.pump(1024)
    ok("the first call takes 1024 frames", ring.read_available == 1024 and action.done_frames == 1024)
    ok("what the card played is the ring's", np.allclose(out[mixer], 0.25))
    ok("a play action started at once is at the card's time", action.actual_time == 1.0)
    card.pump(1024)
    ok("the second call takes the rest", ring.read_available == 0 and action in mixer.actions)
    ring.write(tone[:512])
    out = card.pump(1024)
    ok("the call that finds 512 frames lets the ring go", action not in mixer.actions)
    ok("and plays the 512 it found, silence after",
       np.allclose(out[mixer][:512], 0.25) and np.allclose(out[mixer][512:], 0.0))
    ok("the action counts 2560 frames done", action.done_frames == 2560)
    ok("the card call size is kept", action.stats.max_blocksize == 1024)

    # A start in the future: the action waits, then lands on its frame.
    ring = rtmixer.RingBuffer(elementsize=8, size=4096)
    ring.write(tone)
    start = mixer.time + 1500 / RATE
    action = mixer.play_ringbuffer(ring, start=start)
    out = card.pump(1024)
    ok("a later start waits a whole call out", action.done_frames == 0 and np.allclose(out[mixer], 0.0))
    out = card.pump(1024)
    ok("then lands on the frame asked for",
       np.allclose(out[mixer][:476], 0.0) and np.allclose(out[mixer][476:], 0.25))
    ok("actual_time is the requested start", abs(action.actual_time - start) < 0.5 / RATE)
    late = mixer.play_ringbuffer(ring, start=mixer.time - 1.0, allow_belated=False)
    card.pump(1024)
    ok("a late start that may not be late is dropped", late not in mixer.actions and late.actual_time == 0.0)
    mixer.cancel(action)
    card.pump(1024)
    ok("a cancelled action is gone after the next call", action not in mixer.actions)
    try:
        mixer.stats
        ok("stats raise while the stream runs", False)
    except RuntimeError:
        ok("stats raise while the stream runs", True)
    mixer.stop()
    ok("stats read once stopped, one block a call", mixer.stats.blocks == 7)
    mixer.close()

    # Record: a ring of 4096 is let go on the call that would overflow it.
    recorder = rtmixer.Recorder(channels=2, samplerate=RATE, blocksize=1024)
    recorder.start()
    ring = rtmixer.RingBuffer(elementsize=8, size=4096)
    action = recorder.record_ringbuffer(ring)
    card.feed(np.arange(5 * 1024 * 2, dtype=np.float32).reshape(-1, 2))
    for _ in range(4):
        card.pump(1024)
    ok("four calls fill a ring of 4096", ring.read_available == 4096 and action in recorder.actions)
    card.pump(1024)
    ok("the call that would overflow it lets the ring go", action not in recorder.actions)
    got = np.zeros((4096, 2), dtype=np.float32)
    ring.readinto(got)
    ok("what was recorded is what the card fed, in order", got[0, 0] == 0 and got[-1, 1] == 4096 * 2 - 1)
    recorder.stop()
    recorder.close()

    # The ring's insides, as the players reach them: a writable view of its
    # memory and its write index, cut back by hand.
    ring = rtmixer.RingBuffer(elementsize=8, size=1024)
    data = np.frombuffer(rtmixer._ffi.buffer(ring._ptr.buffer, 1024 * 8), dtype=np.float32).reshape(1024, 2)
    ring.write(tone[:600])
    data[10] = 0.5
    ring._ptr.writeIndex = 100 & ring._ptr.bigMask
    ok("a cut write index shortens the ring", ring.read_available == 100)
    got = np.zeros((100, 2), dtype=np.float32)
    ring.readinto(got)
    ok("a frame written in place is read back", got[10, 0] == 0.5 and got[9, 0] == 0.25)
    ok("bigMask is twice the size less one", ring._ptr.bigMask == 2047)

    # Duplex: one card call plays and records; latency is a pair.
    both = rtmixer.MixerAndRecorder(channels=(2, 2), samplerate=RATE, blocksize=1024)
    ok("a duplex stream's latency is (input, output)", isinstance(both.latency, tuple))
    card.reset()


class Counter:
    """A take stand-in for a RingOutput: each frame of channel 0 is its
    place in the take, channel 1 the level it was mixed at."""

    def __init__(self):
        self.pos = 0
        self.level = 1.0
        self.leads = []

    def fill(self, out, frame, now_ns, lead_sec):
        n = len(out)
        out[:, 0] = self.pos + np.arange(n)
        out[:, 1] = self.level
        self.leads.append((frame, lead_sec))
        shown = self.pos
        self.pos += n
        return shown

    def state(self):
        return self.pos

    def restore(self, s):
        self.pos = s


def _output():
    from rehearsal_recorder.audio.ring import RingOutput
    fake_rtmixer.card.reset()
    mixer = rtmixer.Mixer(channels=2, samplerate=RATE, blocksize=1024)
    mixer.start()
    take = Counter()
    ring = RingOutput(mixer, 2, RATE, take.fill, take.state, take.restore)
    ring.start(worker=False)
    return mixer, take, ring


def _play(mixer, calls, frames=1024):
    """`calls` card calls; what came out, one array."""
    out = [fake_rtmixer.card.pump(frames)[mixer] for _ in range(calls)]
    return np.concatenate(out) if out else np.zeros((0, 2), np.float32)


def output_keeps_a_second():
    print("\n[2] A play ring keeps a second ahead of the card")
    mixer, take, ring = _output()
    ok("after start, 47 blocks are in the ring", ring.ring.read_available == 47 * 1024)
    heard = _play(mixer, 3)
    ok("the card plays the take from its first frame", np.array_equal(heard[:, 0], np.arange(3072)))
    ok("three calls in, the card hears frame 3072", ring.heard() == 3072)
    ring.service()
    ok("a look tops it up to a second again", ring.ring.read_available == 47 * 1024)
    frame, lead = take.leads[-1]
    ok("each block is told how far ahead of the card it is heard",
       abs(lead - (frame - 3072) / RATE) < 1e-9)
    ok("what fill returned is kept for its block", ring.shown(3072 + 5) == 3072)
    ring.stop()


def setting_heard_from_guard():
    print("\n[3] A setting is mixed again from two card calls ahead")
    mixer, take, ring = _output()
    _play(mixer, 3)
    ring.service()
    take.level = 2.0
    ring.change()
    ring.service()
    heard = _play(mixer, 40)
    frames = 3072 + np.arange(len(heard))
    guard = -(-(3072 + 2 * 1024 + 256) // 1024) * 1024
    ok(f"the card plays the old setting up to frame {guard}",
       (heard[frames < guard, 1] == 1.0).all())
    ok("and the new one from there on", (heard[frames >= guard, 1] == 2.0).all())
    ok("the take's frames are the same either side", np.array_equal(heard[:, 0], frames))
    ring.stop()


def move_is_exact():
    print("\n[4] A move is exact to the frame and leaves nothing old after it")
    mixer, take, ring = _output()
    _play(mixer, 3)
    ring.service()
    seek = 20 * RATE
    ring.move(lambda: setattr(take, "pos", seek))
    ring.service()
    heard = _play(mixer, 47, 1024)
    frames = 3072 + np.arange(len(heard))
    jump = np.flatnonzero(heard[:, 0] != frames)
    at = int(frames[jump[0]]) if len(jump) else None
    ok("the move lands on a block, ahead of the guard",
       at is not None and at % 1024 == 0 and at >= 3072 + 2 * 1024 + 256)
    ok("the take as it was up to there",
       at is not None and np.array_equal(heard[frames < at, 0], frames[frames < at]))
    after = heard[frames >= at, 0] if at is not None else np.zeros(0)
    ok("from 20.000 s on after it, nothing old", np.array_equal(after, seek + np.arange(len(after))))
    ok("the moved piece and the top-up after it make one run",
       len(after) >= 24 * 1024)
    ring.stop()


def dry_ring_restarts():
    print("\n[5] A ring that ran dry plays again with 0.6 s in it")
    mixer, take, ring = _output()
    _play(mixer, 48)
    ok("rtmixer let the dry ring go", ring._action not in mixer.actions)
    ring.service()
    ok("counted once", ring.counts["ran_dry"] == 1)
    ok("a new ring with 0.6 s in it plays",
       ring.ring.read_available >= 0.6 * RATE and ring._action in mixer.actions)
    heard = _play(mixer, 1)
    ok("from where the mixing got to", heard[0, 0] == 47 * 1024)
    ok("the stream's frames go on", ring.heard() == 48 * 1024)
    ring.stop()


def coarse_reads_still_mark():
    print("\n[8c] Reads as far apart as a coarse sleep makes them still mark the clock")
    from rehearsal_recorder.audio.ring import RingMarks
    from rehearsal_recorder.midi.clock import AudioClock
    latency = 0.08533
    t0 = 5_000_000_000
    ns_per_frame = 1e9 / RATE
    arrive = [t0 + round(j * 1024 * ns_per_frame + latency * 1e9) for j in range(470)]
    # A Windows wait lasts a timer tick, 15.625 ms; GitHub's Mac sleeps about
    # 10 ms when asked for 2.
    for name, step_ms in (("a Windows tick", 15.625), ("a Mac's 10 ms", 10.1)):
        clock = AudioClock(RATE)
        marks = RingMarks(clock, RATE, latency)
        reads = [t0 + round(k * step_ms * 1e6) for k in range(1, int(10_000 / step_ms))]
        j, last = 0, reads[0]
        for now in reads[1:]:
            first = j
            while j < len(arrive) and arrive[j] <= now:
                j += 1
            if j > first:
                marks.read(first * 1024, (j - first) * 1024, (last + now) // 2, window_ns=now - last)
            last = now
        kept = list(clock._kept)
        off = [abs(ns - (t0 + frame * ns_per_frame)) / 1e6 for ns, frame in kept] or [float("inf")]
        placed = [abs(clock.to_seconds(t0 + round(s * 1e9)) - s) * 1e3 for s in (1.0, 5.0, 9.0)]
        ok(f"reads {name} apart: a mark a second ({len(kept)} for 10 s), each within 1.5 ms "
           f"(worst {max(off):.2f} ms)", 9 <= len(kept) <= 11 and max(off) < 1.5)
        ok(f"  and a note placed within 0.5 ms (worst {max(placed):.2f} ms)", max(placed) < 0.5)


def marks_missing_said():
    print("\n[8b] Reads too far apart for a mark: the log says so, once")
    from rehearsal_recorder.audio.ring import RingMarks
    from rehearsal_recorder.midi.clock import AudioClock
    said = []
    handler = logging.Handler()
    handler.emit = lambda record: said.append(record.getMessage())
    logger = logging.getLogger("rehearsal_recorder.audio.ring")
    logger.addHandler(handler)
    try:
        clock = AudioClock(RATE)
        marks = RingMarks(clock, RATE, 0.01)
        t0 = 5_000_000_000
        # A read every 60 ms: the ring's thread held up all along.
        for k in range(1, 70):
            marks.read((k - 1) * 2880, 2880, t0 + k * 60_000_000, window_ns=60_000_000)
    finally:
        logger.removeHandler(handler)
    lines = [s for s in said if "notes' clock" in s]
    ok("no mark from reads 60 ms apart", not clock.marked())
    ok("the log says the clock has had no mark, once", len(lines) == 1)
    ok("  with how far apart the reads were", bool(lines) and "60.0 ms" in lines[0])


def move_made_before_it_returns():
    print("\n[14] A move asked of a ring its thread fills is made before move() returns")
    from rehearsal_recorder.audio.ring import RingOutput
    fake_rtmixer.card.reset()
    mixer = rtmixer.Mixer(channels=2, samplerate=RATE, blocksize=1024)
    mixer.start()
    take = Counter()
    ring = RingOutput(mixer, 2, RATE, take.fill, take.state, take.restore)
    ring.start()
    try:
        _play(mixer, 3)
        landed = []
        for i in range(20):
            ring.move(lambda i=i: setattr(take, "pos", (i + 1) * RATE))
            landed.append(ring.landed is not None and ring.settled() is False and ring._made == ring._asked)
        ok("each of 20 seeks has landed as move() returns, so the playhead is where it was sent",
           all(landed))
    finally:
        ring.stop()


def heard_falls_back():
    print("\n[6] The frame heard, from the ring when the clock is not believable")
    fake_rtmixer.card.reset()
    fake_rtmixer.card.out_latency = 0.01
    from rehearsal_recorder.audio.ring import RingOutput
    mixer = rtmixer.Mixer(channels=2, samplerate=RATE, blocksize=1024)
    mixer.start()
    take = Counter()
    ring = RingOutput(mixer, 2, RATE, take.fill, take.state, take.restore)
    ring.start(worker=False)
    _play(mixer, 3)
    ok("by the clock: what the card took, less the output latency", ring.heard() == 3072 - 480)
    ring._action.actual_time = 0.0
    ok("no start time: from the ring, the same", ring.heard() == 3072 - 480)
    ring._action.actual_time = -50.0
    ok("a start time that puts it past the ring: from the ring", ring.heard() == 3072 - 480)
    ring.stop()
    fake_rtmixer.card.out_latency = 0.0


def input_pads_overflow():
    print("\n[7] A record ring that filled: the frames lost come back as silence")
    from rehearsal_recorder.audio.ring import RingInput
    card = fake_rtmixer.card
    card.reset()
    recorder = rtmixer.Recorder(channels=1, samplerate=RATE, blocksize=1024)
    recorder.start()
    got = []
    ring = RingInput(recorder, 1, RATE, lambda block, first, arrival: got.append(
        (first, block[:, 0].copy(), arrival)), seconds=8192 / RATE)
    ring.start(worker=False)
    card.feed(np.arange(13 * 1024, dtype=np.float32)[:, None] + 1)
    _play_frames = [card.pump(1024) for _ in range(12)]
    ring.service()
    ok("the full ring is handed over", sum(len(b) for _, b, _ in got) == 8192)
    ok("the overflow is counted", ring.counts["overflowed"] == 1 and ring.counts["fullest_frames"] == 8192)
    card.pump(1024)
    ring.service()
    whole = np.concatenate([b for _, b, _ in got])
    ok("the take keeps its length: every frame the card captured", len(whole) == 13 * 1024)
    ok("the 4096 frames lost are silence, said so",
       ring.counts["lost_frames"] == 4096 and not whole[8192:12288].any()
       and any(a is None and len(b) == 4096 for _, b, a in got))
    ok("what came after is in its place", np.array_equal(whole[12288:], np.arange(12288, 13312) + 1))
    ok("each piece says its first frame", [f for f, _, _ in got] == [0, 8192, 12288])
    ring.stop()


def marks_mean_of_second():
    print("\n[8] The notes' clock, one mark a second from the reads")
    from rehearsal_recorder.audio.ring import RingMarks
    from rehearsal_recorder.midi.clock import AudioClock
    clock = AudioClock(RATE)
    latency = 0.08533
    marks = RingMarks(clock, RATE, latency)
    rng = np.random.default_rng(7)
    t0 = 5_000_000_000
    ns_per_frame = 1e9 / RATE
    # Block j's first frame is captured at t0 + j*1024 frames and arrives the
    # stream's latency later; the ring is read about every 10 ms, give or
    # take 5.
    arrive = [t0 + round(j * 1024 * ns_per_frame + latency * 1e9) for j in range(470)]
    reads = sorted(t0 + round(k * 10e6 + rng.uniform(-5e6, 5e6)) for k in range(1, 1000))
    j, last = 0, reads[0]
    for now in reads[1:]:
        first = j
        while j < len(arrive) and arrive[j] <= now:
            j += 1
        if j > first:
            marks.read(first * 1024, (j - first) * 1024, (last + now) // 2)
        last = now
    kept = list(clock._kept)
    off = [abs(ns - (t0 + frame * ns_per_frame)) / 1e6 for ns, frame in kept]
    ok(f"a mark a second ({len(kept)} for 10 s)", 9 <= len(kept) <= 11)
    ok(f"each mark within 1.5 ms of the true line (worst {max(off):.2f} ms)", max(off) < 1.5)
    # What a note gets: the line through the marks, read at a moment.
    placed = [abs(clock.to_seconds(t0 + round(s * 1e9)) - s) * 1e3
              for s in (1.0, 3.3, 5.0, 7.7, 9.0)]
    ok(f"a note is placed within 0.5 ms of where it was played (worst {max(placed):.2f} ms)",
       max(placed) < 0.5)


def _wav(path):
    """A WAV's samples as whole numbers, frames by channels."""
    import wave
    with wave.open(str(path), "rb") as w:
        width, channels, raw = w.getsampwidth(), w.getnchannels(), w.readframes(w.getnframes())
    if width == 2:
        return np.frombuffer(raw, dtype="<i2").reshape(-1, channels).astype(np.int64)
    b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int64)
    v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
    v = np.where(v >= 1 << 23, v - (1 << 24), v)
    return v.reshape(-1, channels)


def _recorder(folder, **kw):
    from rehearsal_recorder.audio.capture import AudioRecorder
    fake_rtmixer.card.reset()
    tracks = kw.pop("tracks", [{"name": "Gtr", "channel": 1}, {"name": "Keys", "channel": 2, "stereo": True}])
    rec = AudioRecorder(0, RATE, tracks, folder, **kw)
    rec.start()
    return rec


def take_writes_every_frame(tmp):
    print("\n[9] A take writes every frame the card captured, bit for bit")
    rng = np.random.default_rng(9)
    for depth, top in ((16, 1 << 15), (24, 1 << 23)):
        rec = _recorder(tmp / f"take{depth}", bit_depth=depth)
        sent = rng.integers(-top, top, size=(10 * RATE, 3))
        at = 0
        while at < len(sent):
            n = int(rng.integers(64, 2049))
            fake_rtmixer.call(rec._stream, (sent[at:at + n] / top).astype(np.float32))
            if rng.random() < 0.5:
                rec._input.service()
            at += n
        rec._input.service()
        result = rec.stop()
        files = {t["name"]: t["file"] for t in result["tracks"]}
        gtr, keys = _wav(files["Gtr"]), _wav(files["Keys"])
        ok(f"{depth} bits: all 10 s are there, mono and stereo",
           len(gtr) == len(sent) and len(keys) == len(sent) and keys.shape[1] == 2)
        ok(f"{depth} bits: and every sample is what the card captured",
           np.array_equal(gtr[:, 0], sent[:, 0]) and np.array_equal(keys, sent[:, 1:3]))
        ok(f"{depth} bits: the ring never filled", rec._input.counts["overflowed"] == 0)


def card_gone_stops_take(tmp):
    print("\n[10] A card that sends nothing for 3 s stops the take")
    import time as _time
    from rehearsal_recorder.audio.capture import STALLED
    rec = _recorder(tmp / "gone")
    fake_rtmixer.recorded(rec, np.zeros((1024, 3), np.float32))
    ok("a card that sends is not stopped", rec.problem() is None)
    rec._heartbeat._last = _time.monotonic() - 3.5
    fake_rtmixer.recorded(rec, np.zeros((1024, 3), np.float32))
    ok("frames arriving count as the card being there", rec.problem() is None)
    rec._heartbeat._last = _time.monotonic() - 3.5
    rec._input.service()
    ok("3 s with none: the take says the card has gone", rec.problem() == STALLED)
    rec.stop()


def disk_refuses_stops_take(tmp):
    print("\n[10b] A take whose disk refuses the write stops, and says why")
    from rehearsal_recorder.audio.capture import WRITE_FAILED
    rec = _recorder(tmp / "full")
    fake_rtmixer.recorded(rec, np.zeros((1024, 3), np.float32))
    ok("a take that writes is not stopped", rec.problem() is None)

    class _Full:
        def __init__(self, real):
            self.real = real

        def write(self, data):
            raise OSError(28, "No space left on device")

        def __getattr__(self, name):
            return getattr(self.real, name)

    rec._raw_files["Gtr"] = _Full(rec._raw_files["Gtr"])
    fake_rtmixer.call(rec._stream, np.zeros((1024, 3), np.float32))
    rec._input.look()
    ok("the disk full: the take says it could not be written", rec.problem() == WRITE_FAILED)
    ok("  and it stays said", rec.problem() == WRITE_FAILED)
    rec._raw_files["Gtr"] = rec._raw_files["Gtr"].real
    rec.stop()


def _click_take(tmp, name, tempo=120):
    from rehearsal_recorder.audio.click import Voices
    from rehearsal_recorder.audio.take_click import TakeClick
    voices = Voices("click", RATE, 0.7)
    click = TakeClick(tempo, "4/4", 1, voices, (0, 1), lead_sec=0.1)
    rec = _recorder(tmp / name, tracks=[{"name": "Gtr", "channel": 1}], click=click)
    return rec, click, voices


def click_on_card_lands_on_grid(tmp):
    print("\n[11] The click on the recording card lands on the take's grid")
    from rehearsal_recorder.audio.click import click_frame
    rec, click, voices = _click_take(tmp, "grid")
    play, record = rec._output.action, rec._input.action
    ok("the take's stream plays and records", rec._output is not None and record is not None)
    played = [fake_rtmixer.recorded(rec, np.zeros((1024, 1), np.float32)) for _ in range(60)]
    played = np.concatenate(played)[:, 0]
    ok("both rings started at the one time asked",
       play.actual_time > 0 and play.actual_time == record.actual_time)
    first = click.first_click_frame
    ok(f"the first click is lead_sec after the take's first frame ({first})", first == round(0.1 * RATE))
    begun = int(round((play.actual_time - 1.0) * RATE))
    voice = voices.of(0)
    onset = int(np.flatnonzero(np.abs(voice) > 0)[0])
    heard = np.flatnonzero(np.abs(played) > 0)
    ok("it is played on the frame it lands on in the take: play frame s for input frame s",
       len(heard) and int(heard[0]) - begun == first + onset)
    second = first + click_frame(1, 120, RATE)
    ok("and the next on the grid after it",
       np.abs(played[begun + second + onset]) > 0 and not np.abs(played[begun + second - 200:begun + second]).any())
    rec.stop()


def stop_on_quarter(tmp):
    print("\n[12] Stop records on to the next quarter")
    import threading
    from rehearsal_recorder.audio.click import click_frame
    rec, click, _ = _click_take(tmp, "quarter")
    for _ in range(40):
        fake_rtmixer.recorded(rec, np.zeros((1024, 1), np.float32))
    first = click.first_click_frame
    asked = rec._frames_written
    done = []
    stopping = threading.Thread(target=lambda: done.append(rec.stop()))
    stopping.start()
    calls = 0
    while stopping.is_alive() and calls < 400:
        fake_rtmixer.recorded(rec, np.zeros((1024, 1), np.float32))
        calls += 1
        stopping.join(0.002)
    stopping.join(5)
    quarter = click_frame(1, 120, RATE)
    want = first + -(-(asked - first) // quarter) * quarter
    ok(f"the take ends on the quarter after Stop ({click.end_frame} for {want})", click.end_frame == want)
    gtr = _wav(done[0]["tracks"][0]["file"]) if done else np.zeros((0, 1))
    ok("its file holds whole quarters from the first click", len(gtr) == want - first)


def marks_reach_clock(tmp):
    print("\n[13] A take with notes marks their clock from the ring")
    from rehearsal_recorder.midi.clock import AudioClock
    clock = AudioClock(RATE)
    rec = _recorder(tmp / "notes", tracks=[{"name": "Gtr", "channel": 1}], clock=clock)
    calls = 0
    while not clock._kept and calls < 300:
        fake_rtmixer.recorded(rec, np.zeros((1024, 1), np.float32))
        calls += 1
    ok(f"the first mark comes within 0.3 s of frames ({calls * 1024} frames)", calls * 1024 <= 0.3 * RATE)
    while calls * 1024 < 5 * RATE:
        fake_rtmixer.recorded(rec, np.zeros((1024, 1), np.float32))
        calls += 1
    kept = clock._kept
    ok(f"after 5 s, a mark about every second ({len(kept)} kept)", 4 <= len(kept) <= 5)
    ok("each on the take's frames, in order",
       all(b[1] - a[1] >= RATE for a, b in zip(kept, kept[1:])) and kept[-1][1] < 5 * RATE)
    rec.stop()


def reads_often_enough():
    print("\n[13b] The record ring's own thread reads often enough to mark the notes' clock")
    from rehearsal_recorder.audio.ring import RingInput, RingMarks
    card = fake_rtmixer.card
    card.reset()
    recorder = rtmixer.Recorder(channels=1, samplerate=RATE, blocksize=1024)
    recorder.start()
    ring = RingInput(recorder, 1, RATE, lambda block, first, arrival: None)
    stamps = []
    ring.service = lambda now_ns=None: stamps.append(time.perf_counter_ns())
    ring.start()
    time.sleep(0.5)
    ring.stop(drain=False)
    gaps = sorted(b - a for a, b in zip(stamps, stamps[1:]))
    median = gaps[len(gaps) // 2] / 1e6 if gaps else float("inf")
    limit = RingMarks.WINDOW_SEC * 1000
    ok(f"half its reads come under {limit:.0f} ms apart, on this computer (median {median:.1f} ms)",
       median <= limit)


def main():
    fake_card_behaves()
    output_keeps_a_second()
    setting_heard_from_guard()
    move_is_exact()
    dry_ring_restarts()
    heard_falls_back()
    input_pads_overflow()
    marks_mean_of_second()
    coarse_reads_still_mark()
    marks_missing_said()
    move_made_before_it_returns()
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        tmp = Path(folder)
        take_writes_every_frame(tmp)
        card_gone_stops_take(tmp)
        disk_refuses_stops_take(tmp)
        click_on_card_lands_on_grid(tmp)
        stop_on_quarter(tmp)
        marks_reach_clock(tmp)
    reads_often_enough()
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print("  - " + p)
        return 1
    print("\nAll ring checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
