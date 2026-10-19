"""
The metronome's click. So far this is the click itself: the four signatures,
their tempos and accents, the frame each click falls on over an hour, and the
three sounds (Part 3 of the metronome spec); a WAV that carries its tempo in an
`acid` chunk, read back by libsndfile and by `wave` (Part 9); where a click is
heard when its output is not the recording card, placed by the recording's
clock and the output's own (Part 3); and a crop of a click take snapped to its
bars (Part 9). Later sections are added as the rest of it is built.

The heavy arithmetic of the metronome lives here and not in test_engine.py,
whose length bounds the whole Python run: an hour of clicks, two clocks that
drift apart for an hour.

No sound card and no MIDI: nothing here opens a stream. The clocks are fed
made-up blocks, and the sounds and files are inspected as numbers and bytes.
"""

import random
import struct
import sys
import tempfile
import types
import wave
from fractions import Fraction
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root, as the other suites do.
sys.path.insert(0, str(PROJECT / "src"))

import numpy as np  # noqa: E402
import soundfile  # noqa: E402  (libsndfile, to read the acid chunk the way a DAW's library does)

from rehearsal_recorder.audio.click import (  # noqa: E402
    SIGNATURES, SOUNDS, Voices, accent, clamp_tempo, click_frame, mix_clicks, per_bar, per_quarter,
    quarter_tempo, snap_region, tempo_range)
from rehearsal_recorder.audio.click_timing import OutputClock, lead_of, round_trip_frames  # noqa: E402
from rehearsal_recorder.audio.wavfile import Acid, WavWriter, read_acid  # noqa: E402
from rehearsal_recorder.midi.clock import AudioClock  # noqa: E402

problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else,
    # such as "★" or "▶", taking the whole suite down with it.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def centroid(voice, samplerate):
    """Where a sound's power sits on average, in Hz: higher for a brighter sound."""
    size = 1 << 14
    power = np.abs(np.fft.rfft(voice.astype(np.float64), size)) ** 2
    freqs = np.fft.rfftfreq(size, 1 / samplerate)
    return float((freqs * power).sum() / power.sum())


def loop_info(path):
    """
    What libsndfile reads from a WAV's acid chunk: (num, den, beats, bpm), or
    None for a file with none. Through its own SF_LOOP_INFO, as a DAW built on it
    reads it: python-soundfile has no call for it, so the C call is made.
    """
    SFC_GET_LOOP_INFO = 0x10E0
    with soundfile.SoundFile(str(path)) as f:
        buf = soundfile._ffi.new("char[]", 44)
        if not soundfile._snd.sf_command(f._file, SFC_GET_LOOP_INFO, buf, 44):
            return None
        num, den, _mode, beats, bpm, _root = struct.unpack("<hhiifi", bytes(soundfile._ffi.buffer(buf))[:20])
    return num, den, beats, bpm


def main():
    print("\n[1] The click")
    ok("the four signatures, and the three sounds",
       SIGNATURES == ("4/4", "3/4", "2/4", "6/8") and SOUNDS == ("click", "wood", "hihat"))
    ok("x/4 runs from 30 to 300, 6/8 from 60 to 600",
       [tempo_range(s) for s in SIGNATURES] == [(30, 300), (30, 300), (30, 300), (60, 600)])
    ok("a tempo is a whole number: 128.6 is 129",
       clamp_tempo(128.6, "4/4") == 129 and type(clamp_tempo(128.6, "4/4")) is int)
    ok("and kept in its signature's range: 20 in 4/4 is 30, 700 in 6/8 is 600",
       clamp_tempo(20, "4/4") == 30 and clamp_tempo(700, "6/8") == 600)
    ok("but 400 is a 6/8 tempo, and 40 is not", clamp_tempo(400, "6/8") == 400 and clamp_tempo(40, "6/8") == 60)
    ok("a bar is 4, 3, 2 or 6 clicks", [per_bar(s) for s in SIGNATURES] == [4, 3, 2, 6])
    ok("a quarter is one click, two in 6/8", [per_quarter(s) for s in SIGNATURES] == [1, 1, 1, 2])
    ok("4/4 accents its first click", [accent("4/4", k) for k in range(5)] == [2, 0, 0, 0, 2])
    ok("6/8 its first, and its fourth a little", [accent("6/8", k) for k in range(7)] == [2, 0, 0, 1, 0, 0, 2])
    ok("3/4 and 2/4 their first",
       [accent("3/4", k) for k in range(4)] == [2, 0, 0, 2] and [accent("2/4", k) for k in range(3)] == [2, 0, 2])
    ok("198 in 6/8 is 99 a quarter, 128 in 4/4 is 128",
       quarter_tempo(198, "6/8") == 99 and quarter_tempo(128, "4/4") == 128)

    # Each click's frame is worked out from its number: a sum of click lengths
    # would build up its rounding, a frame at a time, over a long take.
    ok("at 128 and 48000 every click of an hour is on round(k * 22500)",
       all(click_frame(k, 128, 48000) == round(k * 22500) for k in range(128 * 60 + 1)))
    worst = max(abs(click_frame(k, 127, 44100) - Fraction(k * 44100 * 60, 127)) for k in range(127 * 60 + 1))
    ok("at 127 and 44100, where a click is no whole number of frames, every click of the hour "
       "is within half a frame of its exact place, the last one too", worst <= Fraction(1, 2))

    by_sound = {}
    for sound in SOUNDS:
        for rate in (44100, 48000):
            for volume in (0.25, 0.7, 1.0):
                voices = Voices(sound, rate, volume)
                made = [voices.of(a) for a in (0, 1, 2)]
                ok(f"{sound} at {rate}, volume {volume}: float32, one channel, at most 60 ms",
                   all(v.dtype == np.float32 and v.ndim == 1 and 0 < len(v) <= round(0.060 * rate) for v in made))
                ok("  its peak no louder than the volume, and not silent",
                   all(0.9 * volume < float(np.abs(v).max()) <= volume for v in made))
            heard = [centroid(Voices(sound, rate, 0.7).of(a), rate) for a in (0, 1, 2)]
            ok(f"{sound} at {rate}: a bar's first click higher than the others, 6/8's fourth between",
               heard[0] < heard[1] < heard[2])
            by_sound[sound, rate] = heard[0]
        long44, long48 = len(Voices(sound, 44100, 0.7).of(0)), len(Voices(sound, 48000, 0.7).of(0))
        ok(f"{sound} lasts as long at 44100 as at 48000, within a frame", abs(long44 / 44100 - long48 / 48000) <= 1 / 44100)
        voice = Voices(sound, 48000, 0.7).of(2)
        ok(f"{sound} starts from silence and ends in it", abs(float(voice[0])) < 1e-3 and abs(float(voice[-1])) < 1e-3)
    ok("the three sounds differ: each sits a quarter or more above or below the others",
       all(max(by_sound[a, 48000], by_sound[b, 48000]) / min(by_sound[a, 48000], by_sound[b, 48000]) > 1.25
           for a, b in (("click", "wood"), ("click", "hihat"), ("wood", "hihat"))))
    print(f"         (where they sit: {', '.join(f'{s} {by_sound[s, 48000]:.0f} Hz' for s in SOUNDS)})")
    ok("a sound is made once for a rate and a volume",
       Voices("wood", 48000, 0.7).of(1) is Voices("wood", 48000, 0.7).of(1)
       and Voices("wood", 48000, 0.5).of(1) is not Voices("wood", 48000, 0.7).of(1))
    ok("and cannot be changed by what plays it", not Voices("click", 48000, 0.7).of(0).flags.writeable)

    # A click into a stream's blocks: the same whether the stream asks for one
    # block of 512 frames or two of 256, and only on the channels it goes to.
    voices = Voices("click", 48000, 0.7)
    voice = voices.of(2)
    whole = np.zeros((512, 4), np.float32)
    mix_clicks(whole, 0, [(250, 2)], voices, [1, 3])
    first, second = np.zeros((256, 4), np.float32), np.zeros((256, 4), np.float32)
    mix_clicks(first, 0, [(250, 2)], voices, [1, 3])
    mix_clicks(second, 256, [(250, 2)], voices, [1, 3])
    ok("a click at 250 mixed into two blocks of 256 is the one in a block of 512", np.array_equal(np.vstack([first, second]), whole))
    ok("it is the voice's first 262 frames from frame 250 on, on channels 2 and 4",
       np.array_equal(whole[250:, 1], voice[:262]) and np.array_equal(whole[:, 3], whole[:, 1])
       and not whole[:250].any())
    ok("and nothing on channels 1 and 3", not whole[:, [0, 2]].any())
    under = np.full((256, 2), 0.1, np.float32)
    mix_clicks(under, 1000, [(1100, 0)], voices, [0])
    ok("a click is added to what the block already holds",
       np.allclose(under[100:, 0], 0.1 + voices.of(0)[:156]) and (under[:, 1] == np.float32(0.1)).all())
    gone = np.zeros((256, 2), np.float32)
    mix_clicks(gone, 5000, [(5000 - len(voice), 2), (5256, 0)], voices, [0, 1])
    ok("a click that has ended before the block, and one that starts after it, add nothing", not gone.any())
    two = np.zeros((8192, 1), np.float32)
    mix_clicks(two, 0, [(100, 2), (3000, 0)], voices, [0])
    ok("two clicks in one block are both there, whole",
       np.array_equal(two[100:100 + len(voice), 0], voice) and np.array_equal(two[3000:3000 + len(voices.of(0)), 0], voices.of(0)))

    print("\n[2] The WAV's tempo")
    tmp = Path(tempfile.mkdtemp())
    rng = np.random.default_rng(3)
    for width in (2, 3):
        frames = rng.integers(0, 256, 4800 * 2 * width, dtype=np.uint8).tobytes()
        theirs, mine = tmp / f"wave{width}.wav", tmp / f"ours{width}.wav"
        with wave.open(str(theirs), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(width)
            w.setframerate(48000)
            w.writeframes(frames)
        with WavWriter(mine, 48000, 2, width) as w:
            w.write(frames[:1000 * 2 * width])
            w.write(frames[1000 * 2 * width:])
        ok(f"a {width * 8}-bit stereo file with no tempo is byte for byte what wave writes",
           mine.read_bytes() == theirs.read_bytes())
        ok("  and has no acid chunk to read", read_acid(mine) is None and loop_info(mine) is None)
    with WavWriter(tmp / "empty.wav", 44100, 1, 2) as w:
        pass
    with wave.open(str(tmp / "empty-wave.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(44100)
    ok("an empty one too", (tmp / "empty.wav").read_bytes() == (tmp / "empty-wave.wav").read_bytes())

    # 6/8 at 198 is 99 a quarter; eight quarters of stereo 24-bit.
    eight = round(8 * 60 * 48000 / 99)
    audio = rng.integers(0, 256, eight * 2 * 3, dtype=np.uint8).tobytes()
    tempo = tmp / "tempo.wav"
    with WavWriter(tempo, 48000, 2, 3, acid=Acid(99.0, 6, 8)) as w:
        for at in range(0, len(audio), 6 * 4096):
            w.write(audio[at:at + 6 * 4096])
    ok("libsndfile reads 6/8, eight quarters at 99 from the file's acid chunk", loop_info(tempo) == (6, 8, 8, 99.0))
    with wave.open(str(tempo), "rb") as w:
        ok("wave reads the same audio around it",
           (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (2, 3, 48000, eight)
           and w.readframes(eight) == audio)
    with soundfile.SoundFile(str(tempo)) as f:
        ok("and so does libsndfile", f.frames == eight and f.samplerate == 48000 and f.channels == 2)
    ok("the chunk reads back as it was written", read_acid(tempo) == Acid(99.0, 6, 8))
    raw = tempo.read_bytes()
    ok("it comes before the data, and the data is last in the file",
       raw.index(b"acid") < raw.index(b"data") and len(raw) - raw.index(b"data") - 8 == len(audio))
    ok("its 24 bytes as a DAW expects them",
       raw[raw.index(b"acid"):raw.index(b"acid") + 32]
       == struct.pack("<4sIIHHfIHHf", b"acid", 24, 0x04, 60, 0x8000, 0.0, 8, 8, 6, 99.0))
    ok("the RIFF size counts the chunk", struct.unpack("<I", raw[4:8])[0] == len(raw) - 8)
    four = tmp / "four.wav"
    with WavWriter(four, 44100, 1, 2, acid=Acid(128.0, 4, 4)) as w:
        w.write(b"\x00\x00" * round(32 * 60 * 44100 / 128))
    ok("4/4 at 128 and 44100, 32 quarters", loop_info(four) == (4, 4, 32, 128.0) and read_acid(four) == Acid(128.0, 4, 4))
    (tmp / "noise.wav").write_bytes(b"RIFF\x04\x00\x00\x00WAVE")
    (tmp / "short.wav").write_bytes(raw[:raw.index(b"acid") + 12])
    (tmp / "text.wav").write_text("not a wav")
    ok("a file with no chunks, one cut inside its acid chunk and one that is no WAV have none",
       read_acid(tmp / "noise.wav") is None and read_acid(tmp / "short.wav") is None and read_acid(tmp / "text.wav") is None)

    print("\n[3] Where a click is heard")
    # The click on another device than the recording card. The card is 200 ppm
    # fast, its blocks marked as MIDI's clock is tested ([5] of test_midi.py);
    # the click's output is 150 ppm slow, opened a quarter of a second later,
    # its callbacks a jittery 8 ms ahead of what they write. A click belongs on
    # an input frame; it should be heard as that frame is captured, so a beat
    # played on it lands on that frame.
    SR, T0, MS = 48000, 5_000_000_000, 1_000_000
    rnd = random.Random(7)
    rec_rate, out_rate, T1 = SR * 1.0002, SR * (1 - 0.00015), T0 + 250 * MS

    def captured(frame):
        """When the card captured this input frame, by the computer's clock."""
        return T0 + frame / rec_rate * 1e9

    def heard_at(ns):
        """Which output frame the click's device was playing at this moment."""
        return (ns - T1) * out_rate / 1e9

    rec = AudioClock(SR)
    rec.latency_sec = 0.010

    def mark_in(k):
        end = k * 1024
        rec.mark(T0 + int(end / rec_rate * 1e9) + 10 * MS + rnd.randint(-2 * MS, 2 * MS), end, 1024, None)

    out = OutputClock(SR)

    def mark_out(m):
        first = m * 512
        out.mark(T1 + int(first / out_rate * 1e9) - 8 * MS + rnd.randint(-2 * MS, 2 * MS), first, 0.008)

    ok("an output clock with no block yet places nothing", out.frame_at(T1) is None and out.ns_at(0) is None)
    blocks_in, blocks_out = 3600 * SR // 1024, 3600 * SR // 512
    for k in range(1, 3 * SR // 1024):
        mark_in(k)
    for m in range(0, 3 * SR // 512):
        mark_out(m)
    early = 3 * SR + 9600  # 200 ms ahead of the last block, as a click is scheduled
    ok("3 s into a take, a click 200 ms ahead is heard within 5 ms of its frame's capture",
       abs(out.frame_at(rec.ns_at(early)) - heard_at(captured(early))) < 0.005 * SR)
    for k in range(3 * SR // 1024, blocks_in):
        mark_in(k)
    for m in range(3 * SR // 512, blocks_out):
        mark_out(m)
    hour = 48000 * 3600
    placed = out.frame_at(rec.ns_at(hour))
    ok("an hour in, the click of input frame 48000 * 3600 is heard within 1 ms of its capture",
       abs(placed - heard_at(captured(hour))) < 0.001 * SR)
    ok("  on a whole output frame", type(placed) is int)
    ok("the output clock reads its own line both ways",
       all(out.frame_at(out.ns_at(f)) == f for f in (0, 12_345, 3600 * SR)))

    # The line ns_at reads is refitted only as a mark is kept, a second apart,
    # so the click's stream reads it without refitting; to_seconds still fits
    # through every block's mark, as MIDI's notes need.
    asked = T0 + 3_000_000_000_000
    line_moved, seconds_moved = [], []
    for k in range(blocks_in, blocks_in + 47):
        line_before, seconds_before = rec.ns_at(hour), rec.to_seconds(asked)
        mark_in(k)
        line_moved.append(rec.ns_at(hour) != line_before)
        seconds_moved.append(rec.to_seconds(asked) != seconds_before)
    ok("47 blocks, a second of them, move ns_at once, as one of them keeps a mark", line_moved.count(True) == 1)
    ok("  and to_seconds with every one", all(seconds_moved))
    # Just after a mark is kept it is the newest, and the two read one line.
    line_before = rec.ns_at(hour)
    for k in range(blocks_in + 47, blocks_in + 94):
        mark_in(k)
        if rec.ns_at(hour) != line_before:
            break
    ok("read as a mark is kept, ns_at is to_seconds backwards, within 1 us",
       rec.ns_at(hour) != line_before
       and all(abs(rec.to_seconds(rec.ns_at(f)) - f / SR) < 1e-6 for f in (0, 1800 * SR, hour, hour + SR)))
    unstarted = AudioClock(SR)
    unstarted.started_ns = T0
    ok("before its first block, ns_at counts from when the take started, as to_seconds does",
       unstarted.ns_at(2 * SR) == T0 + 2_000_000_000 and unstarted.to_seconds(unstarted.ns_at(2 * SR)) == 2.0)

    rt = types.SimpleNamespace
    ok("the lead is the driver's: 12 ms from now to the first frame being heard",
       abs(lead_of(rt(currentTime=100.0, outputBufferDacTime=100.012), 0.02) - 0.012) < 1e-9)
    ok("a lead of 0, a negative one, or one over a second is not: the stream's latency instead",
       [lead_of(rt(currentTime=100.0, outputBufferDacTime=at), 0.02) for at in (100.0, 99.99, 101.5)] == [0.02] * 3)
    ok("nor are times the driver left at 0, or none at all",
       lead_of(rt(currentTime=0.0, outputBufferDacTime=0.012), 0.02) == 0.02
       and lead_of(rt(currentTime=100.0, outputBufferDacTime=0.0), 0.02) == 0.02
       and lead_of(None, 0.02) == 0.02 and lead_of(rt(currentTime=100.0), 0.02) == 0.02)
    ok("a duplex stream's round trip is the driver's, in frames: 22 ms is 1056 at 48000",
       round_trip_frames(rt(inputBufferAdcTime=99.99, outputBufferDacTime=100.012, currentTime=100.0), 0.05, 48000) == 1056)
    ok("one of 0, a negative one, or one over a second is the fallback: 50 ms is 2400",
       [round_trip_frames(rt(inputBufferAdcTime=100.0, outputBufferDacTime=at, currentTime=100.0), 0.05, 48000)
        for at in (100.0, 99.98, 101.2)] == [2400] * 3)
    ok("and so are times left at 0, and none",
       round_trip_frames(rt(inputBufferAdcTime=0.0, outputBufferDacTime=100.012, currentTime=100.0), 0.05, 48000) == 2400
       and round_trip_frames(None, 0.05, 48000) == 2400)

    print("\n[4] Snapping a crop")
    # A click take's bars start at the first sample of its files, so a crop
    # starts on a bar line and ends on a whole quarter (the acid chunk's beats).
    minute = 60 * SR
    ok("4/4 at 120, 3.3 to 10.2 s cuts 2.0 to 10.5 s",
       snap_region(3.3, 10.2, 120, "4/4", SR, minute) == (2 * SR, round(10.5 * SR)))
    ok("6/8 at 180, 1.1 to 3.95 s cuts 0.0 to 4.0 s",
       snap_region(1.1, 3.95, 180, "6/8", SR, minute) == (0, 4 * SR))
    ok("and 1.1 to 4.05 s cuts 0.0 to 4.67 s, the next whole quarter, two clicks on",
       snap_region(1.1, 4.05, 180, "6/8", SR, minute) == (0, round(14 / 3 * SR)))
    ok("a region starting in the count-in starts at 0",
       snap_region(1.2, 6.2, 120, "4/4", SR, minute) == (0, round(6.5 * SR)))
    ok("one ending in the file's last part of a quarter ends at the file's end",
       snap_region(3.3, 10.2, 120, "4/4", SR, round(10.3 * SR)) == (2 * SR, round(10.3 * SR)))
    ok("one already on a bar line and a quarter stays as it is",
       snap_region(4.0, 9.5, 120, "4/4", SR, minute) == (4 * SR, round(9.5 * SR)))
    ok("and one reaching past the file's end, or starting before it, stays inside it",
       snap_region(-1.0, 99.0, 120, "4/4", SR, minute) == (0, minute))
    # Where a click is no whole number of frames, the lines are the clicks' own
    # frames, rounded as each click is.
    sweep = random.Random(11)
    wrong = []
    for _ in range(2000):
        start, end = sorted(sweep.uniform(0, 600) for _ in range(2))
        first, last = snap_region(start, end, 127, "3/4", 44100, 700 * 44100)
        bar = round(first * 127 / (3 * 60 * 44100))  # which bar line it says it is
        quarter = round(last * 127 / (60 * 44100))
        if not (first == click_frame(3 * bar, 127, 44100) <= round(start * 44100) < click_frame(3 * bar + 3, 127, 44100)
                and click_frame(quarter - 1, 127, 44100) < round(end * 44100) <= last == click_frame(quarter, 127, 44100)):
            wrong.append((start, end))
    ok("at 127 in 3/4 and 44100, 2000 regions each start on the last bar line at or before them "
       "and end on the first quarter at or after them", wrong == [])

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("The click: every check passes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
