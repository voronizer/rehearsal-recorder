"""
The metronome's click. So far this is the click itself: the four signatures,
their tempos and accents, the frame each click falls on over an hour, and the
three sounds (Part 3 of the metronome spec); a WAV that carries its tempo in an
`acid` chunk, read back by libsndfile and by `wave` (Part 9); where a click is
heard when its output is not the recording card, placed by the recording's
clock and the output's own (Part 3); and a crop of a click take snapped to its
bars (Part 9). Then the click in the streams: a take's click on the recording
card, written into the take's own stream a round trip early; on another device,
placed by two clocks that drift apart; the click between takes, retimed while it
runs; and the metronome that follows the next take's name (Part 2). Last,
tools/click_alignment.py, the hand check of how far a take's recorded clicks are
from their places, run on WAVs made here.

The heavy arithmetic of the metronome lives here and not in test_engine.py,
whose length bounds the whole Python run: an hour of clicks, two clocks that
drift apart for an hour.

No sound card and no MIDI: nothing here opens a stream (sounddevice is stubbed,
as in test_engine.py). The clocks are fed made-up blocks, and the sounds and
files are inspected as numbers and bytes.
"""

import contextlib
import importlib.util
import io
import random
import re
import struct
import sys
import tempfile
import threading
import time
import types
import wave
from fractions import Fraction
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root, as the other suites do.
sys.path.insert(0, str(PROJECT / "src"))

# No sound card: the click's own output imports sounddevice, and nothing here
# opens it.
_sd = types.ModuleType("sounddevice")
_sd.query_devices = lambda index=None, kind=None: {"name": "Stub", "max_output_channels": 2,
                                                   "default_samplerate": 48000}
sys.modules["sounddevice"] = _sd

import numpy as np  # noqa: E402
import soundfile  # noqa: E402  (libsndfile, to read the acid chunk the way a DAW's library does)

from rehearsal_recorder.audio.click import (  # noqa: E402
    SIGNATURES, SOUNDS, Voices, accent, clamp_tempo, click_frame, mix_clicks, per_bar, per_quarter,
    quarter_tempo, snap_region, tempo_range)
from rehearsal_recorder.audio.click_source import ClickSource  # noqa: E402
from rehearsal_recorder.audio.click_timing import OutputClock, lead_of, round_trip_frames  # noqa: E402
from rehearsal_recorder.audio.take_click import TakeClick  # noqa: E402
from rehearsal_recorder.audio.wavfile import Acid, WavWriter, read_acid  # noqa: E402
from rehearsal_recorder.metronome import Metronome  # noqa: E402
from rehearsal_recorder.midi.clock import AudioClock  # noqa: E402

problems = []


class Impulse:
    """Voices for checking where clicks land: one sample, at the click's own
    frame, whose value says its accent (1, 2 or 3 for accents 0, 1 and 2)."""

    sound, volume = "click", 1.0

    def __init__(self, samplerate):
        self.samplerate = samplerate
        self._voices = []
        for level in (0, 1, 2):
            voice = np.zeros(64, np.float32)
            voice[0] = level + 1
            self._voices.append(voice)

    def of(self, accent):
        return self._voices[accent]


def onsets(audio, column=0):
    """Where the impulses in a run of blocks are, as (frame, accent)."""
    at = np.flatnonzero(audio[:, column])
    return [(int(f), int(audio[f, column]) - 1) for f in at]


class FakeOutput:
    """The click's own output stream, as a take's click sees it: its rate,
    whether it is there, and the source it was given. Its blocks are rendered
    by hand."""

    def __init__(self, samplerate, problem=None, name="Headphone amp"):
        self.samplerate = samplerate
        self.name = name
        self.route = (0,)
        self.source = None
        self._problem = problem
        self.stopped = False

    def start(self, source):
        self.source = source

    def stop(self):
        self.stopped = True

    def problem(self):
        return self._problem


class FakeLibrary:
    """Library.tempo_for and set_song_tempo, over three songs."""

    def __init__(self):
        self.songs = {"palyn": {"id": 1, "title": "Pałyn", "tempo": 128, "signature": "4/4"},
                      "dym": {"id": 2, "title": "Dym", "tempo": None, "signature": None},
                      "ahon": {"id": 3, "title": "Ahoń", "tempo": 198, "signature": "6/8"}}
        self.saved = []

    def tempo_for(self, name):
        words = (name or "").strip().split()
        if words and words[-1].isdigit():
            words = words[:-1]
        key = " ".join(words).casefold().replace("ł", "l").replace("ń", "n")
        song = self.songs.get(key)
        if song is None:
            return {"song": None, "last_take": None}
        return {"song": dict(song),
                "last_take": {"folder": "/rec/2026-10-09", "take_number": 4, "name": f"{song['title']} 2"}}

    def set_song_tempo(self, song_id, tempo, signature):
        self.saved.append((song_id, tempo, signature))
        for song in self.songs.values():
            if song["id"] == song_id:
                song["tempo"], song["signature"] = tempo, signature
                return dict(song)
        return None


class FakePlayer:
    """A take player holding a device: the free click it is given."""

    def __init__(self, device, samplerate=48000, route=(0, 1)):
        self.device, self.samplerate, self.route = device, samplerate, route
        self.free = None

    def holds(self, device_index):
        return device_index == self.device

    def play_free_click(self, source):
        self.free = source

    @property
    def free_click(self):
        return self.free


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

    one_stream()
    another_device()
    on_its_own()
    alignment_tool()

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("The click: every check passes.")
    return 0


def one_stream():
    print("\n[5] A take's click, one stream")
    # The click on the recording card: one stream with inputs and outputs, the
    # click written into its output in the callback that reads its inputs. What
    # is written comes back in a round trip later, here 9.5 ms (456 frames at
    # 48000), so the click of input frame s is written at output frame s - 456.
    SR, MS = 48000, 1_000_000
    T = 3_000_000_000
    voices = Voices("click", SR, 0.7)

    def run(click, blocks, start=0):
        """Blocks of 1024 into a stream whose output is heard 4.5 ms after its
        callback runs, and whose input was captured 5 ms before it."""
        heard = []
        for i in range(start, start + blocks):
            out = np.zeros((1024, 2), np.float32)
            now = 100.0 + i * 1024 / SR
            info = types.SimpleNamespace(currentTime=now, inputBufferAdcTime=now - 0.005,
                                         outputBufferDacTime=now + 0.0045)
            click.on_duplex_block(out, i * 1024, 1024, info, (0.004, 0.004), now_ns=T + i * 1024 * 1_000_000_000 // SR)
            heard.append(out)
        return np.concatenate(heard)

    tc = TakeClick(120, "4/4", 1, voices, (0, 1))
    ok("a click on the recording card rides the take's stream, its first click not yet chosen",
       tc.duplex and tc.first_click_frame is None and tc.end_frame is None)
    heard = run(tc, 150)
    first = tc.first_click_frame
    ok("the first block chooses it: 0.1 s on, and a round trip of 9.5 ms after that", first == 4800 + 456)
    ok("so the first click is at output frame first_click_frame - 456",
       not heard[:first - 456].any() and np.array_equal(heard[first - 456:first - 456 + len(voices.of(2)), 0], voices.of(2)))
    ok("  on both of its outputs", np.array_equal(heard[:, 0], heard[:, 1]))
    # 150 blocks, 3.2 s, hold seven clicks.
    places = [first - 456 + click_frame(k, 120, SR) for k in range(7)]
    levels = [next((a for a in (0, 1, 2) if np.array_equal(heard[p:p + len(voices.of(a)), 0], voices.of(a))), None)
              for p in places[:6]]
    ok("a bar of four count-in clicks, the first accented, then the take's first beat accented again",
       tc.count_in_clicks == 4 and levels == [2, 0, 0, 0, 2, 0])
    between = np.ones(len(heard), bool)
    for p in places:
        between[p:p + len(voices.of(0))] = False
    ok("and nothing between them", not heard[between[:len(heard)]].any())

    # When each is heard: block i ran at T + i blocks, 4.5 ms before its first
    # frame was heard.
    def at(k):
        return T + 4_500_000 + (first - 456 + click_frame(k, 120, SR)) * 1_000_000_000 // SR

    count, since = tc.count_state(at(0) - MS)
    ok("before the first click, no count yet, and the count-in's end ahead",
       count == 0 and abs(since - (at(0) - MS - at(4)) / 1e6) < 0.2)
    ok("just after the second, the count-in's second click",
       tc.count_state(at(1) + MS)[0] == 2 and tc.count_state(at(3) + MS)[0] == 4)
    count, since = tc.count_state(at(4) + 2 * MS)
    ok("the count-in ends on the take's first beat: since_count_in_ms near 0 then", count == 0 and abs(since - 2.0) < 0.2)
    upcoming = tc.upcoming(at(1) + MS, 1.5)
    ok("the clicks heard in the next 1.5 s, each with its place in the bar",
       [i for _, i in upcoming] == [2, 3, 0] and abs(upcoming[0][0] - 499.0) < 0.2)
    ok("its record for take.json",
       tc.record() == {"tempo": 120, "signature": "4/4", "on": True, "wav_tempo": True,
                       "first_click_frame": first, "end_frame": None})

    quiet = TakeClick(120, "4/4", 1, voices, (0, 1), on=False)
    silent = run(quiet, 60)
    ok("switched off, it writes silence", not silent.any() and quiet.first_click_frame == first)
    quiet.set_on(True)
    back = run(quiet, 60, start=60)
    k, place = next((k, p - 60 * 1024) for k, p in ((k, first - 456 + click_frame(k, 120, SR)) for k in range(12))
                    if p >= 60 * 1024)
    ok("and kept counting: switched on again, the next click is on its beat, in its place in the bar",
       (k, place) == (3, 76800 - 61440) and not back[:place].any()
       and np.array_equal(back[place:place + len(voices.of(0)), 0], voices.of(accent("4/4", k))))

    # A driver that gives no times: the round trip is the stream's own
    # latencies, which the recorder knows only once the stream is open (None
    # until then). The ones it asked for are never taken for them.
    blank = types.SimpleNamespace(currentTime=0.0, inputBufferAdcTime=0.0, outputBufferDacTime=0.0)
    unsaid = TakeClick(120, "4/4", 1, voices, (0, 1))
    out = np.zeros((1024, 2), np.float32)
    unsaid.on_duplex_block(out, 0, 1024, blank, None, now_ns=T)
    waited = unsaid.first_click_frame is None and not out.any()
    unsaid.on_duplex_block(out, 1024, 1024, blank, (0.004, 0.006), now_ns=T + 21_333_333)
    ok("a driver with no times: the first click waits for the stream's own latencies, 10 ms here",
       waited and unsaid.first_click_frame == 1024 + 4800 + 480)

    print("  Stop records on to the next quarter")
    eight = TakeClick(180, "6/8", 1, voices, (0, 1))
    run(eight, 1)
    f8 = eight.first_click_frame
    ok("6/8 at 180: Stop just after click 7 ends on click 8, an even click",
       eight.stop_frame(f8 + click_frame(7, 180, SR) + 5) == f8 + click_frame(8, 180, SR)
       and eight.end_frame == f8 + click_frame(8, 180, SR))
    ok("  Stop on a quarter ends there", eight.stop_frame(f8 + click_frame(8, 180, SR)) == f8 + click_frame(8, 180, SR))
    ok("  Stop before the first click still holds one quarter", eight.stop_frame(f8 - 100) == f8 + click_frame(2, 180, SR))
    ok("4/4: Stop in the count-in ends on its next click",
       tc.stop_frame(first + click_frame(1, 120, SR) + 1) == first + click_frame(2, 120, SR))
    ok("the WAVs' tempo and the .mid's: 180 eighths in 6/8 are 90 quarters",
       eight.acid() == Acid(90.0, 6, 8) and eight.meter() == (666667, (6, 3, 12, 8))
       and tc.acid() == Acid(120.0, 4, 4) and tc.meter() == (500000, (4, 2, 24, 8)))
    ok("none in the WAVs when the setting is off",
       TakeClick(120, "4/4", 1, voices, (0, 1), wav_tempo=False).acid() is None)
    early = TakeClick(120, "4/4", 2, voices, (0, 1))
    ok("Stop before the first click is chosen: no grid, the take ends where it is",
       early.stop_frame(5000) == 5000 and early.first_click_frame is None and early.end_frame is None)
    ok("two bars of count-in are eight clicks", early.count_in_clicks == 8)


def another_device():
    print("\n[6] A take's click, another device")
    # The click on the laptop's jack while the desk records: two clocks. The
    # desk runs at 48000 and 200 ppm fast, the jack at 44100 and 100 ppm slow.
    # Each stream's callback runs late by a few milliseconds of jitter, and the
    # driver says how late (as PortAudio's time_info does), give or take a
    # fifth of a millisecond. A click belongs on an input frame and should be
    # heard as that frame is captured, so a beat played on it lands on it.
    IN, OUT = 48000, 44100
    in_rate, out_rate = IN * (1 + 200e-6), OUT * (1 - 100e-6)
    T0 = 7_000_000_000

    def take(seconds, late_sec, seed, lead_sec=0.02):
        """`lead_sec`: how long before its frames are heard the jack's callback
        runs, less up to 3 ms of jitter."""
        rnd = random.Random(seed)
        T1 = T0 + int((0.25 + late_sec) * 1e9)  # when the jack's first frame is heard
        output = FakeOutput(OUT)
        tc = TakeClick(120, "4/4", 1, Impulse(OUT), (0,), samplerate=IN, output=output)
        tc.start()
        rec = AudioClock(IN)
        rec.latency_sec = 0.005
        rec.started_ns = T0
        out = np.zeros((1024, 1), np.float32)
        clicks = []
        i = j = 0

        def input_due(i):
            return T0 + (1024 * (i + 1)) / in_rate * 1e9 + 3e6 + rnd.random() * 3e6

        def output_due(j):
            return T1 + 1024 * j / out_rate * 1e9 - lead_sec * 1e9 - rnd.random() * 3e6

        next_in, next_out = input_due(0), output_due(0)
        end = T0 + seconds * 1e9
        while min(next_in, next_out) < end:
            if next_in <= next_out:
                ran = int(next_in)
                captured = T0 + 1024 * i / in_rate * 1e9 + rnd.uniform(-2e5, 2e5)
                rec.mark(ran, 1024 * (i + 1), 1024, (ran - captured) / 1e9)
                tc.on_input(1024 * i, rec)
                i += 1
                next_in = input_due(i)
            else:
                ran = int(next_out)
                dac = T1 + 1024 * j / out_rate * 1e9 + rnd.uniform(-2e5, 2e5)
                out.fill(0)
                output.source.render(out, 1024 * j, ran, (dac - ran) / 1e9)
                if out.any():
                    clicks += [(1024 * j + f, a) for f, a in onsets(out)]
                j += 1
                next_out = output_due(j)
        return tc, clicks, T1

    def worst(tc, clicks, T1):
        """The furthest any click is heard from its input frame's capture, in ms."""
        first = tc.first_click_frame
        return max(abs((T1 + m / out_rate * 1e9) - (T0 + (first + click_frame(k, 120, IN)) / in_rate * 1e9))
                   for k, (m, _) in enumerate(clicks)) / 1e6

    tc, clicks, T1 = take(3600, 0.0, 5)
    ok("an hour of clicks on the jack, none missing", len(clicks) >= 2 * 3600 - 2)
    miss = worst(tc, clicks, T1)
    ok("every click of the hour heard within 1 ms of its input frame's capture", miss < 1.0)
    print(f"         (the furthest: {miss:.3f} ms)")
    ok("  the count-in's bar accented as a bar, and the take's", [a for _, a in clicks[:9]] == [2, 0, 0, 0, 2, 0, 0, 0, 2])
    ok("the first click chosen 0.2 s after the input block that followed the jack's first",
       0.2 * IN <= tc.first_click_frame <= (0.25 + 0.2) * IN + 1024)

    tc, clicks, T1 = take(8, 2.0, 6)
    ok("the jack starting 2 s late moves the first click after it", tc.first_click_frame > (2.0 + 0.2) * IN)
    ok("and the count-in stays whole, each heard on its frame",
       [a for _, a in clicks[:5]] == [2, 0, 0, 0, 2] and worst(tc, clicks, T1) < 1.0)

    # Bluetooth headphones hear a block 0.3 s after it is written, so the
    # first click comes late enough for the jack to have it in time.
    tc, clicks, T1 = take(8, 0.0, 7, lead_sec=0.3)
    ok("an output heard 0.3 s after it is written: the count-in whole, each click on its frame",
       [a for _, a in clicks[:5]] == [2, 0, 0, 0, 2] and worst(tc, clicks, T1) < 1.0
       and tc.first_click_frame > 0.3 * IN)

    made = TakeClick(120, "4/4", 1, Voices("click", IN, 0.7), (0,), output=FakeOutput(OUT))
    ok("the click is made at the jack's rate, 44100, not the desk's",
       made.source.voices.samplerate == OUT and np.array_equal(made.source.voices.of(2), Voices("click", OUT, 0.7).of(2)))
    ok("and the take's frames counted at the desk's", made.samplerate == IN and not made.duplex)

    gone = TakeClick(120, "4/4", 1, Voices("click", IN, 0.7), (0,), output=FakeOutput(OUT, problem="Gone"))
    gone.start()
    gone_clock = AudioClock(IN)
    gone_clock.started_ns = T0
    gone_clock.mark(T0 + 30_000_000, 1024, 1024, None)
    gone.on_input(0, gone_clock)
    ok("an output that is not there: the first click is chosen at once, and the grid is kept",
       gone.first_click_frame == round(0.2 * IN) and gone.problem() == "Gone")
    ok("  and the screen still hears when its clicks fall", gone.count_state(T0 + 100_000_000)[1] is not None)


def on_its_own():
    print("\n[7] The click on its own")
    # Between takes the click has an output of its own, or rides the player's.
    # Changed while it runs, it goes on at the new tempo from its next click:
    # no gap longer than the old click, none shorter than the new.
    SR = 48000
    p120, p140 = 60 * SR / 120, 60 * SR / 140

    def blocks(source, count, start=0, size=512):
        out = []
        for b in range(start, start + count):
            block = np.zeros((size, 1), np.float32)
            source.render(block, b * size, 9_000_000_000 + b * size * 1_000_000_000 // SR, 0.01)
            out.append(block)
        return np.concatenate(out)

    wrong = []
    for after in range(90, 140, 3):  # retimed at 17 places, around the second bar's first clicks
        src = ClickSource(120, "4/4", Impulse(SR), (0,))
        before = blocks(src, after)
        src.retime(140, "4/4")
        heard = onsets(np.concatenate([before, blocks(src, 400, start=after)]))
        gaps = [b[0] - a[0] for a, b in zip(heard, heard[1:])]
        if not (min(gaps) >= p140 - 1 and max(gaps) <= p120 + 1
                and [a for _, a in heard] == [accent("4/4", k) for k in range(len(heard))]):
            wrong.append(after)
    ok("120 retimed to 140 at 17 moments: no gap over 60/120 s, none under 60/140 s, the bar going on", wrong == [])
    src = ClickSource(120, "4/4", Impulse(SR), (0,))
    before = blocks(src, 100)  # 51200 frames: the third click (k = 2) at 48000 is the last
    src.retime(140, "4/4")
    heard = onsets(np.concatenate([before, blocks(src, 200, start=100)]))
    ok("from its next click on the new period: 48000 then 48000 + 20571",
       [f for f, _ in heard[2:5]] == [48000, 48000 + round(p140), 48000 + round(2 * p140)])

    src = ClickSource(120, "4/4", Impulse(SR), (0,))
    before = blocks(src, 100)
    src.retime(120, "3/4")
    heard = onsets(np.concatenate([before, blocks(src, 300, start=100)]))
    ok("a new signature: its next click is the first of a bar, accented, and the bar is 3",
       [a for _, a in heard[:8]] == [2, 0, 0, 2, 0, 0, 2, 0])

    one = ClickSource(120, "4/4", Impulse(SR), (0,), bars=1)
    heard = onsets(blocks(one, 400))
    ok("a preview of one bar is four clicks and then nothing", [a for _, a in heard] == [2, 0, 0, 0] and one.done)
    six = ClickSource(198, "6/8", Impulse(SR), (0,), bars=1)
    ok("  six in 6/8", [a for _, a in onsets(blocks(six, 400))] == [2, 0, 0, 1, 0, 0] and six.done)
    later = ClickSource(120, "4/4", Impulse(SR), (0,), start_k=2)
    ok("one carried on from click 2 starts on the bar's third beat", [a for _, a in onsets(blocks(later, 200))][:3] == [0, 0, 2])

    src = ClickSource(120, "4/4", Impulse(SR), (0,))
    blocks(src, 10)
    now = 9_000_000_000 + 10 * 512 * 1_000_000_000 // SR
    soon = src.upcoming(now, 1.5)
    ok("what the screen lights next: each click heard in the next 1.5 s and its place in the bar",
       [i for _, i in soon] == [1, 2, 3] and all(0 <= ms <= 1500 for ms, _ in soon)
       and abs(soon[0][0] - (10 + 500 - 10 * 512 / 48)) < 0.2)
    src.set_on(False)
    ok("switched off it renders nothing", not blocks(src, 200, start=10).any())

    print("  The metronome follows the next take's name")
    library = FakeLibrary()
    config, written = {}, []
    player = FakePlayer(None)
    m = Metronome(config, lambda: written.append(dict(config)), lambda: player, lambda key: None, library)
    state = m.state()
    ok("before a name, a free take with an empty row",
       state["case"] == "free" and state["tempo"] is None and state["phase"] == "idle" and state["per_bar"] == 4)
    m.follow("Palyn 3")
    state = m.state()
    ok("1. a song with a tempo: the song's", state["case"] == "song" and (state["tempo"], state["signature"]) == (128, "4/4")
       and state["song"]["title"] == "Pałyn" and not state["held"] and state["last_take"]["take_number"] == 4)
    ok("  what Record takes", m.take_meter() == (128, "4/4", True))
    ok("a tempo out of range or a signature not one of the four is refused",
       not m.set(20, "4/4")["ok"] and not m.set(128, "5/4")["ok"] and not m.set(129.5, "4/4")["ok"]
       and m.state()["tempo"] == 128)
    ok("a change in the row is held", m.set(132, "4/4")["ok"] and m.state()["held"] and m.take_meter()[0] == 132)
    m.follow("Palyn")
    ok("  through a keystroke in the same song's name", m.state()["tempo"] == 132 and m.state()["held"])
    m.follow("Dym")
    state = m.state()
    ok("2. a song without a tempo: the row is empty, and the take records without a click",
       state["case"] == "song_without" and state["tempo"] is None and not state["held"]
       and state["last_take"]["name"] == "Dym 2" and m.take_meter()[0] is None)
    m.follow("Palyn 4")
    ok("another song took the held change away", m.state()["tempo"] == 128 and not m.state()["held"])
    m.follow("Dym")
    m.set(104, "4/4")
    ok("a tempo typed for a song without one is held, and saved to it by the button",
       m.state()["held"] and m.save_to_song()["ok"] and library.saved == [(2, 104, "4/4")]
       and not m.state()["held"] and m.state()["case"] == "song")
    m.follow("")
    state = m.state()
    ok("3. a free take: an empty row, no song, nothing held", state["case"] == "free" and state["tempo"] is None
       and state["song"] is None and not m.save_to_song()["ok"])
    m.set(100, "3/4")
    m.follow("Take 5")
    ok("  a tempo set by hand holds through another free name", m.take_meter() == (100, "3/4", True))
    m.follow("Novaja")
    ok("  and a new title no song has yet; the case is a song without a tempo",
       m.state()["case"] == "song_without" and m.state()["tempo"] == 100 and m.state()["song"] is None
       and not m.save_to_song()["ok"])
    m.follow("Ahon")
    ok("until a song is picked: 198 in 6/8, six clicks a bar",
       (m.state()["tempo"], m.state()["signature"], m.state()["per_bar"]) == (198, "6/8", 6))
    m.set(198, "4/4")
    ok("the signature changed keeps the number", m.state()["tempo"] == 198 and m.state()["signature"] == "4/4")

    print("  Its settings, and a bar heard")
    ok("the settings and their defaults",
       m.settings() == {"click_device_index": None, "click_channels": None, "click_sound": "click",
                        "click_volume": 0.7, "count_in_bars": 1, "tempo_in_wav": True, "metronome_on": True})
    ok("each is checked and saved", m.set_setting("click_sound", "wood")["ok"] and written[-1]["click_sound"] == "wood"
       and m.set_setting("count_in_bars", 2)["ok"] and m.set_setting("tempo_in_wav", False)["ok"]
       and m.set_setting("click_volume", 0.5)["ok"] and config["click_volume"] == 0.5)
    ok("an unknown key, or a value that is not one, is refused and nothing saved",
       not m.set_setting("click_colour", "red")["ok"] and not m.set_setting("click_sound", "cowbell")["ok"]
       and not m.set_setting("tempo_in_wav", 1)["ok"] and not m.set_setting("count_in_bars", True)["ok"]
       and len(written) == 4)
    ok("the switch is a setting too", m.set_on(False)["ok"] and config["metronome_on"] is False
       and m.take_meter() == (198, "4/4", False) and m.state()["on"] is False)
    m.set_on(True)
    ok("a bar previewed rides the player that holds the click's output",
       m.preview(bars=1, sound="hihat")["ok"] and isinstance(player.free, ClickSource))
    bar = player.free
    ok("  in the sound asked for, at the volume set", bar.voices.sound == "hihat" and bar.voices.volume == 0.5)
    ok("  and the screen shows nothing of it", m.state()["phase"] == "idle" and m.state()["upcoming"] == [])
    heard = blocks(bar, 400)
    ok("it stops after one bar", len([f for f in np.flatnonzero(heard[:, 0])
                                      if f == 0 or not heard[max(0, f - 200):f, 0].any()]) == 4 and bar.done)
    m.state()
    ok("  and then lets go of the player's stream", player.free is None)
    ok("the click between takes runs on the player's stream too", m.play()["ok"] and m.state()["phase"] == "preview")
    run = player.free
    m.set(150, "4/4")
    ok("  retimed when the row changes", run.tempo == 150 and run is player.free)
    m.set(None, "4/4")
    ok("  and stopped when it is emptied", player.free is None and m.state()["phase"] == "idle")
    m.set(150, "4/4")
    m.play()
    m.stop()
    ok("Stop stops it", player.free is None and m.state()["phase"] == "idle")
    m.play()
    run = player.free
    # The player closed its output and opened it again (a rescan, or its card
    # coming back): closing let go of the click.
    player.free = None
    m.resink()
    ok("a player that closed and opened its output again gets the click back",
       isinstance(player.free, ClickSource) and player.free is not run and m.state()["phase"] == "preview")
    # A ■ pressed while the click is being moved: the move cannot bring it back.
    player.free = None
    real_sink, moving = m._sink, threading.Event()

    def slow_sink():
        moving.set()
        time.sleep(0.05)
        return real_sink()

    m._sink = slow_sink
    mover = threading.Thread(target=m.resink)
    mover.start()
    moving.wait(1)
    m.stop()
    mover.join(1)
    m._sink = real_sink
    ok("a Stop while the click is being moved stays stopped",
       not mover.is_alive() and player.free is None and m.state()["phase"] == "idle")
    m.stop()

    print("  Play on a song's page")
    # The row holds a change, 150 in 4/4, Ahon's own being 198 in 6/8.
    held = (m.take_meter(), m.state()["held"])
    played = m.play(96, "3/4")
    page = player.free
    state = m.state()
    ok("a song's page plays its own tempo and signature, and the screen shows them",
       played["ok"] and isinstance(page, ClickSource) and (page.tempo, page.signature) == (96, "3/4")
       and (state["phase"], state["tempo"], state["signature"], state["per_bar"]) == ("preview", 96, "3/4", 3))
    ok("  the row left as it was, its change still held",
       held == ((150, "4/4", True), True) and (m.take_meter(), state["held"]) == held)
    m.set(160, "4/4")
    ok("  and it does not follow the row", player.free is page and page.tempo == 96)
    player.free = None
    m.resink()
    m.set(150, "4/4")
    ok("  nor once moved to another stream", isinstance(player.free, ClickSource) and player.free is not page
       and player.free.tempo == 96 and m.state()["tempo"] == 96)
    m.stop()
    ok("stopped, the row is as it was", (m.take_meter(), m.state()["held"], m.state()["tempo"]) == ((150, "4/4", True), True, 150))
    ok("a tempo out of its range, or a signature not one of the four, is refused as the row's is",
       m.play(20, "4/4") == {"ok": False, "error": "A tempo in 4/4 is a whole number from 30 to 300"}
       and m.play(96, "5/4") == {"ok": False, "error": "The time signature is one of 4/4, 3/4, 2/4 and 6/8"}
       and m.play(96, None)["ok"] is False and m.play(96.5, "3/4")["ok"] is False and player.free is None)
    ok("with no tempo it plays the row's, as before", m.play()["ok"] and player.free.tempo == 150
       and (m.state()["phase"], m.state()["tempo"]) == ("preview", 150))
    m.stop()

    print("  Where the click goes, and the device list")
    real_query = _sd.query_devices

    class Refusing:
        def __init__(self, **kw):
            raise RuntimeError("Device unavailable")

    # A headphone amp at 44100 that will not open: the click is counted at
    # its rate all the same, to no output.
    _sd.query_devices = lambda index=None, kind=None: {"name": "Headphone amp", "max_output_channels": 2,
                                                       "default_samplerate": 44100}
    _sd.OutputStream = Refusing
    try:
        amp = Metronome({"click_device": {"name": "Headphone amp", "host_api": "CoreAudio"}, "click_device_index": 5},
                        lambda: None, lambda: None, {"click_device": 5}.get, None)
        amp.set(120, "4/4")
        played = amp.play()["ok"]
    finally:
        _sd.query_devices = real_query
        del _sd.OutputStream
    state = amp.state()
    gaps = [b[0] - a[0] for a, b in zip(state["upcoming"], state["upcoming"][1:])]
    counted = amp._free.source
    ok("a 44.1 kHz output that will not open: the beat still flashes every 500 ms at 120, and says which",
       played and len(gaps) >= 1 and all(abs(g - 500) < 0.5 for g in gaps)
       and state["output_missing"] == "Headphone amp")
    ok("  counted at its rate, on its outputs, raising nothing", counted.fault is None and counted.samplerate == 44100)
    amp.stop()

    # The screen asks for the state many times a second; the device list is
    # PortAudio's, which a rescan rebuilds under the app's stream lock.
    asked = []
    polled = Metronome({}, lambda: None, lambda: None, lambda key: asked.append(key), None)
    polled.state()
    once = list(asked)
    queried = []
    _sd.query_devices = lambda index=None, kind=None: queried.append(index) or real_query(index, kind)
    try:
        for _ in range(20):
            polled.state()
    finally:
        _sd.query_devices = real_query
    ok("the screen's polls ask where the click goes once, not each time, and never PortAudio",
       once == ["click_device", "output_device"] and asked == once and queried == [])

    # No click device saved, and the player on the system output, which is
    # the recording card: the click rides the take's stream there.
    _sd.query_devices = lambda index=None, kind=None: {"name": "Interface", "index": 0, "max_output_channels": 2,
                                                       "default_samplerate": 48000}
    try:
        system = Metronome({}, lambda: None, lambda: None, lambda key: None, None)
        system.set(120, "4/4")
        on_card = system.take_click(0, 48000)
    finally:
        _sd.query_devices = real_query
    ok("the system output is the recording card: one stream, no second one on it",
       on_card is not None and on_card.duplex and on_card.route == (0, 1))


def alignment_tool():
    print("\n[8] The alignment tool")
    # tools/click_alignment.py, the hand check of Part 3's aim: the click's
    # output cabled into an input, a take recorded to the click, then
    # `python tools/click_alignment.py "<take folder>"`. It says how far each
    # recorded click is from its place on the take's grid, as
    # tools/midi_alignment.py says it for notes. Loaded as test_midi.py loads
    # that one, and run through its main() in this process. The takes are WAVs
    # written by the app's own writer, so the tempo comes from their acid chunk
    # as it does in a real take; a click is the sharp start of a 2 kHz burst
    # that dies away in a few ms, on the very sample it is meant for.
    tool = PROJECT / "tools" / "click_alignment.py"
    ok("tools/click_alignment.py is there", tool.is_file())
    if not tool.is_file():
        return
    spec = importlib.util.spec_from_file_location("click_alignment", tool)
    alignment = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(alignment)

    def run(*args):
        """(exit code, what it printed, what it said as an error)."""
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = alignment.main([str(arg) for arg in args])
            except SystemExit as stopped:  # argparse
                code = stopped.code if isinstance(stopped.code, int) else 1
        return code, out.getvalue(), err.getvalue()

    def recorded(seconds, tempo, late_ms, rate=48000):
        """One channel of clicks on the grid of `tempo`, each `late_ms` late
        (a function of the click's time in seconds, or a number)."""
        late = late_ms if callable(late_ms) else (lambda t: late_ms)
        samples = np.zeros(round(seconds * rate))
        t = np.arange(round(0.008 * rate)) / rate
        burst = 0.8 * np.cos(2 * np.pi * 2000 * t) * np.exp(-t / 0.002)
        k = 0
        while True:
            at = click_frame(k, tempo, rate)
            at += round(late(at / rate) / 1000 * rate)
            if at + len(burst) >= len(samples):
                return samples
            samples[at:at + len(burst)] += burst
            k += 1

    def write(path, samples, rate=48000, acid=None):
        """16-bit mono, through the app's own writer, with `acid` or none."""
        ints = np.round(np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
        with WavWriter(path, rate, 1, 2, acid) as w:
            w.write(ints.tobytes())

    seen = re.compile(r"matched (\d+) of (\d+) clicks, median ([+-]\d+\.\d) ms, worst ([+-]\d+\.\d) ms")

    with tempfile.TemporaryDirectory() as root:
        root = Path(root)

        # The plan's check, with a silent track beside the one the cable fed.
        late = root / "late"
        late.mkdir()
        write(late / "Click.wav", recorded(20.0, 120, 2.0), acid=Acid(120.0, 4, 4))
        write(late / "Vocals.wav", np.zeros(20 * 48000), acid=Acid(120.0, 4, 4))
        code, out, err = run(late)
        click_part = out.split("Vocals.wav")[0]
        got = seen.findall(click_part)
        ok("clicks 2 ms late on a 120 grid: it runs, and prints a median of +2.0 ms",
           code == 0 and len(got) == 1 and got[0][2] == "+2.0")
        ok("  all 40 clicks of 20 s matched, the worst +2.0 ms too", bool(got) and got[0][:2] == ("40", "40")
           and got[0][3] == "+2.0")
        ok("  the tempo read from the WAV, and said", "the click at 120 a minute" in click_part)
        ok("  the silent track beside it measured too, with nothing matched",
           "Vocals.wav" in out and "matched 0 of 40 clicks" in out)
        code, out, err = run(late, "--wav", "Click")
        ok("--wav measures that track alone", code == 0 and "Vocals.wav" not in out and len(seen.findall(out)) == 1)
        code, out, err = run(late, "--wav", "Bass")
        ok("--wav naming a file that is not there: exit 1, saying so", code == 1 and "no such file" in err)
        code, out, err = run(late, "--tempo", 0)
        ok("--tempo 0 refused", code not in (0, None) and "--tempo" in err and not seen.search(out))
        code, out, err = run(late, "--max-ms", 0)
        ok("--max-ms 0 refused", code not in (0, None) and "--max-ms" in err and not seen.search(out))

        # 6/8: the WAV says the quarter tempo, 99; the clicks are eighths, 198.
        eighths = root / "eighths"
        eighths.mkdir()
        write(eighths / "Ahoń.wav", recorded(12.0, 198, 0.0), acid=Acid(99.0, 6, 8))
        code, out, err = run(eighths)
        got = seen.findall(out)
        ok("6/8 at 99 a quarter is measured as 198 clicks a minute, on time",
           code == 0 and "the click at 198 a minute" in out and len(got) == 1)
        ok("  on time prints a median and a worst of +0.0 ms, never -0.0",
           bool(got) and got[0][2] == "+0.0" and got[0][3] == "+0.0")
        ok("  and a name in another script printed as plain ASCII",
           "Aho\\u0144.wav" in out and all(ord(c) < 128 for c in out + err))

        # Two windows, the clocks drifting: at 127 on 44.1 kHz, where a click
        # is no whole number of frames, 2 ms late for the first half and 4 ms
        # for the second.
        drift = root / "drift"
        drift.mkdir()
        write(drift / "Click.wav", recorded(130.0, 127, lambda t: 2.0 if t < 65 else 4.0, rate=44100),
              rate=44100, acid=Acid(127.0, 4, 4))
        code, out, err = run(drift)
        got = seen.findall(out)
        ok("130 s at 127 on 44.1 kHz: the first minute's median +2.0 ms, the last minute's +4.0 ms",
           code == 0 and [g[2] for g in got] == ["+2.0", "+4.0"]
           and "first minute" in out and "last minute" in out)

        # A take whose WAVs carry no tempo (the setting was off): --tempo.
        plain = root / "plain"
        plain.mkdir()
        write(plain / "Click.wav", recorded(20.0, 120, 2.0))
        code, out, err = run(plain)
        ok("a WAV with no tempo, and none given: exit 1, asking for --tempo", code == 1 and "--tempo" in err)
        code, out, err = run(plain, "--tempo", 120)
        got = seen.findall(out)
        ok("  given with --tempo 120: a median of +2.0 ms", code == 0 and len(got) == 1 and got[0][2] == "+2.0")

        empty = root / "empty"
        empty.mkdir()
        code, out, err = run(empty)
        ok("a folder with no WAV, and one that is not there: exit 1, saying so",
           code == 1 and ".wav" in err and run(root / "nowhere")[0] == 1)


if __name__ == "__main__":
    raise SystemExit(main())
