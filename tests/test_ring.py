"""
Sound through rtmixer's rings (docs/superpowers/specs/2026-11-04-sound-process-design.md,
Parts 4 to 7): audio/ring.py, and the players and recorders built on it.

No sound card here. tests/fake_rtmixer.py stands in for rtmixer, and its
card runs one card call at a time when a check asks it to (card.pump), so
every check knows exactly what the card has taken and what it has heard.
The first group checks the fake itself against what rtmixer's C callback
does (src/rtmixer.c in rtmixer 0.1.7), since every later check leans on it.
"""

import sys
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


def main():
    fake_card_behaves()
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print("  - " + p)
        return 1
    print("\nAll ring checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
