"""
Counting a song's tempo from a take (spec Part 10): audio/tempo.py, the app's
own counter in numpy, on synthetic takes.

The takes are made the way the research harness makes them
(metronome/research/compare.py): a kick, a snare and hi-hats rendered as noise
and sines on a grid, 8 ms of jitter on every hit, a hum under all of it. A
tempo is what the grid was made at, so every answer here has a truth to be
within a few bpm of. Real rehearsals are not here: the counter is tried on the
band's own click takes by hand (the spec's list).

No sound card, no browser, no MIDI port: WAVs and .mid files in a temporary
folder, and the counter is given their paths. The librosa and mir_eval the
research compared against are not imported here and are not in the app.
"""

import logging
import sys
import tempfile
import time
import tracemalloc
import types
import wave
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))

# The player's reader of WAV files is used, and the module it is in wants a
# sound card library. There is none here.
_sd = types.ModuleType("sounddevice")
_sd.query_devices = lambda *a, **k: []
_sd.query_hostapis = lambda: []
_sd.OutputStream = _sd.InputStream = None
sys.modules.setdefault("sounddevice", _sd)
# No suite opens a real MIDI port.
sys.modules["pylibremidi"] = None

import numpy as np  # noqa: E402

from rehearsal_recorder.audio import tempo  # noqa: E402
from rehearsal_recorder.midi.smf import write_mid  # noqa: E402

problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else,
    # a star or an arrow, taking the whole suite down with it.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


SR = 44100

# The patterns of compare.py: (step within the bar, kind, velocity), a step
# being a subdivision of the beat. "k" kick, "s" snare, "h" hat.
ROCK = [(i, "h", 0.6) for i in range(8)] + [(0, "k", 1), (4, "k", 1), (5, "k", .7), (2, "s", 1), (6, "s", 1)]
WALTZ = [(i, "h", 0.5) for i in range(6)] + [(0, "k", 1), (2, "s", .8), (4, "s", .8)]
SIX_EIGHT = [(i, "h", 0.5) for i in range(6)] + [(0, "k", 1), (3, "s", 1)]  # six eighths, a snare on the fourth

# General MIDI's drum notes for the three kinds, on channel 10.
NOTE = {"k": 36, "s": 38, "h": 42}


def hit(rng, sr, kind, n):
    t = np.arange(n) / sr
    if kind == "k":
        return np.sin(2 * np.pi * (50 + 80 * np.exp(-t * 40)) * t) * np.exp(-t * 18)
    if kind == "s":
        return (rng.standard_normal(n) * 0.6 + np.sin(2 * np.pi * 190 * t)) * np.exp(-t * 25) * 0.7
    return np.diff(rng.standard_normal(n + 1)) * np.exp(-t * 90) * 0.25


def pattern(rng, bpm0, bpm1, dur, beats_per_bar, sub, grid, jitter=0.008):
    """The hits of a take, as (seconds, kind, velocity): the tempo moves from
    `bpm0` to `bpm1` over `dur` seconds, a beat has `sub` steps."""
    events, t, k = [], 0.0, 0
    steps_per_bar = beats_per_bar * sub
    while t < dur:
        bpm = bpm0 + (bpm1 - bpm0) * t / dur
        pos = k % steps_per_bar
        for step, kind, vel in grid:
            if step == pos:
                events.append((max(0.0, t + rng.normal(0, jitter)), kind, vel))
        t += 60.0 / bpm / sub
        k += 1
    return sorted(events)


def render(rng, events, dur, sr=SR):
    """The take as `dur` seconds of samples: every hit 0.4 s long, 1% noise
    under it, the loudest sample at 0.8 of full scale."""
    y = np.zeros(int(dur * sr) + sr)
    n = int(0.4 * sr)
    for t, kind, vel in events:
        i = int(t * sr)
        y[i:i + n] += vel * hit(rng, sr, kind, n)[: len(y) - i]
    y += 0.01 * rng.standard_normal(len(y))
    return y[: int(dur * sr)] * (0.8 / np.abs(y).max())


def write_wav(path, y, sr=SR, bits=16, channels=1):
    """A WAV as the app writes them: the samples straight after the header, the
    data last. With `channels` 2 the right side is the left at half."""
    y = np.asarray(y, float)
    if channels == 2:
        y = np.stack([y, y * 0.5], axis=1).reshape(-1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(bits // 8)
        w.setframerate(sr)
        if bits == 16:
            w.writeframes(np.rint(y * 32767).astype("<i2").tobytes())
        else:
            whole = np.rint(y * 8388607).astype("<i4")
            w.writeframes(whole.view(np.uint8).reshape(-1, 4)[:, :3].tobytes())
    return path


def write_drums_mid(path, events):
    """The hits as a drums .mid: a note-on on channel 10 for each, the velocity
    as it was struck, and the note let go 50 ms after."""
    played = []
    for t, kind, vel in events:
        played.append((t, bytes([0x99, NOTE[kind], max(1, round(vel * 127))])))
        played.append((t + 0.05, bytes([0x89, NOTE[kind], 0])))
    write_mid(path, track_name="Drums", port_name="TD-17", start=[], events=sorted(played, key=lambda e: e[0]))
    return path


def near(got, want, within):
    return got is not None and abs(got - want) <= within


def said(got):
    return got if got is None else round(got, 1)


def main():
    print("\n[1] Counting a tempo")
    warned = []  # what the counter says to the log, checked and not printed
    catcher = logging.Handler(level=logging.WARNING)
    catcher.emit = warned.append
    logging.getLogger(tempo.__name__).addHandler(catcher)
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        answers = []  # (signature, what came back), checked against the ranges at the end

        def count(**kw):
            kw.setdefault("drums_mid", None)
            kw.setdefault("drums_wav", None)
            kw.setdefault("wavs", [])
            kw.setdefault("signature", "4/4")
            got = tempo.count(**kw)
            answers.append((kw["signature"], got))
            return got

        # 4/4 at 128, three minutes: also the take whose time is printed.
        rng = np.random.default_rng(1)
        rock_events = pattern(rng, 128, 128, 180, 4, 2, ROCK)
        rock_wav = write_wav(tmp / "rock.wav", render(rng, rock_events, 180))
        began = time.perf_counter()
        got = count(drums_wav=rock_wav, wavs=[rock_wav])
        spent = time.perf_counter() - began
        if near(got, 128, 2):
            ok(f"4/4 at 128 comes out as {said(got)} (128 +-2)", True)
        else:
            # The usual mistake of this kind of counter, which Halve and Double put right (Part 10).
            ok(f"4/4 at 128 comes out as {said(got)}, the halve/double case (64 or 256)",
               near(got, 64, 2) or near(got, 256, 4))
        print(f"  a 3-minute take counted in {spent:.2f} s")

        # 3/4 at 96, at 48 kHz.
        rng = np.random.default_rng(2)
        waltz_events = pattern(rng, 96, 96, 60, 3, 2, WALTZ)
        waltz_wav = write_wav(tmp / "waltz.wav", render(rng, waltz_events, 60, 48000), 48000)
        got = count(drums_wav=waltz_wav, wavs=[waltz_wav], signature="3/4")
        ok(f"3/4 at 96, a take at 48 kHz, comes out as {said(got)} (96 +-2)", near(got, 96, 2))

        # 6/8: the number is the eighth, the click (M15). A bar is six of them, 198 a minute here.
        rng = np.random.default_rng(3)
        six_events = pattern(rng, 66, 66, 60, 2, 3, SIX_EIGHT)
        six_wav = write_wav(tmp / "six.wav", render(rng, six_events, 60))
        got = count(drums_wav=six_wav, wavs=[six_wav], signature="6/8")
        ok(f"6/8 with the eighths at 198 comes out as {said(got)} (198 +-3)", near(got, 198, 3))

        # A take that speeds up from 124 to 134 gives the middle of its windows.
        rng = np.random.default_rng(4)
        drift_events = pattern(rng, 124, 134, 120, 4, 2, ROCK)
        drift_wav = write_wav(tmp / "drift.wav", render(rng, drift_events, 120))
        got = count(drums_wav=drift_wav, wavs=[drift_wav])
        ok(f"a drift from 124 to 134 comes out as {said(got)} (129 +-3)", near(got, 129, 3))

        # The drums .mid is used before the WAV: here the two disagree, the .mid is 128 and the WAV 96.
        rock_mid = write_drums_mid(tmp / "rock.mid", rock_events[: len(rock_events) // 3])
        got = count(drums_mid=rock_mid, drums_wav=waltz_wav, wavs=[waltz_wav])
        ok(f"a drums .mid at 128 is counted before a WAV at 96: {said(got)} (128 +-2)", near(got, 128, 2))
        got = count(drums_wav=waltz_wav, wavs=[waltz_wav], signature="3/4")
        ok(f"and without the .mid the same WAV comes out as {said(got)} (96 +-2)", near(got, 96, 2))
        six_mid = write_drums_mid(tmp / "six.mid", six_events)
        got = count(drums_mid=six_mid, signature="6/8")
        ok(f"a 6/8 drums .mid with the eighths at 198 comes out as {said(got)} (198 +-3)", near(got, 198, 3))
        quiet_mid = tmp / "none.mid"
        write_mid(quiet_mid, track_name="Drums", port_name="TD-17", start=[b"\xb9\x04\x5a"], events=[])
        got = count(drums_mid=quiet_mid, drums_wav=waltz_wav, wavs=[waltz_wav], signature="3/4")
        ok("a drums .mid with no hits in it hands the counting to the WAV", near(got, 96, 2))
        broken_mid = tmp / "broken.mid"
        broken_mid.write_bytes(b"this is not a midi file")
        got = count(drums_mid=broken_mid, drums_wav=waltz_wav, wavs=[waltz_wav], signature="3/4")
        ok("and so does one that cannot be read, which the log names",
           near(got, 96, 2) and any("broken.mid" in record.getMessage() for record in warned))

        # The drums WAV is used before the tracks mixed.
        got = count(drums_wav=rock_wav, wavs=[waltz_wav])
        ok(f"the drums WAV is counted before the tracks mixed: {said(got)} (the rock's 128, not the waltz's 96)",
           near(got, 128, 2) or near(got, 64, 2) or near(got, 256, 4))
        got = count(wavs=[waltz_wav], signature="3/4")
        ok("and with no drums WAV the tracks are what is counted", near(got, 96, 2))

        # Tracks mixed: the drums in 24 bits on both sides, a bass line under them.
        rng = np.random.default_rng(5)
        waltz_24 = render(rng, pattern(rng, 96, 96, 60, 3, 2, WALTZ), 60, 48000)
        stereo_wav = write_wav(tmp / "drums24.wav", waltz_24, 48000, bits=24, channels=2)
        bass = 0.3 * np.sin(2 * np.pi * 55 * np.arange(60 * 48000) / 48000)
        bass_wav = write_wav(tmp / "bass.wav", bass, 48000)
        got = count(wavs=[stereo_wav, bass_wav], signature="3/4")
        ok(f"a 24-bit stereo track and a bass line, mixed, come out as {said(got)} (96 +-2)", near(got, 96, 2))

        # Level and length do not decide it.
        soft = write_wav(tmp / "soft.wav", waltz_24 * 0.01, 48000)
        got = count(wavs=[soft], signature="3/4")
        ok(f"the same take 40 dB lower (a peak at 0.008) comes out as {said(got)} (96 +-2)", near(got, 96, 2))
        rng = np.random.default_rng(6)
        playing = render(rng, pattern(rng, 96, 96, 30, 3, 2, WALTZ), 30, 48000)
        tail = write_wav(tmp / "tail.wav", np.concatenate([playing, np.zeros(150 * 48000)]), 48000)
        got = count(wavs=[tail], signature="3/4")
        ok(f"half a minute of playing and two and a half minutes of silence after it comes out as "
           f"{said(got)} (96 +-2)", near(got, 96, 2))
        short = write_wav(tmp / "short.wav", render(rng, pattern(rng, 96, 96, 7, 3, 2, WALTZ), 7, 48000), 48000)
        ok("a take of 7 s is too short to count", count(wavs=[short], signature="3/4") is None)
        ten = write_wav(tmp / "ten.wav", render(rng, pattern(rng, 96, 96, 10, 3, 2, WALTZ), 10, 48000), 48000)
        got = count(wavs=[ten], signature="3/4")
        ok(f"and one of 10 s can be counted: {said(got)} (96 +-4)", near(got, 96, 4))

        # Silence is no tempo.
        silent = write_wav(tmp / "silent.wav", np.zeros(30 * SR))
        ok("30 s of silence gives None", count(drums_wav=silent, wavs=[silent]) is None)
        dither = write_wav(tmp / "dither.wav", np.random.default_rng(8).integers(-1, 2, 30 * SR) / 32767)
        ok("30 s of dither, one step of 16 bits either way, gives None", count(wavs=[dither]) is None)
        ok("a drums .mid with no hits over a silent WAV gives None",
           count(drums_mid=quiet_mid, drums_wav=silent, wavs=[silent]) is None)
        ok("no files at all gives None", count() is None)
        silent_48 = write_wav(tmp / "silent48.wav", np.zeros(60 * 48000), 48000)
        ok("a silent drums WAV hands the counting to the tracks mixed",
           near(count(drums_wav=silent_48, wavs=[silent_48, waltz_wav], signature="3/4"), 96, 2))

        # The ranges: 30 to 300 in x/4 clicks, 60 to 600 in 6/8, and no other signature.
        ranges = {"4/4": (30, 300), "3/4": (30, 300), "2/4": (30, 300), "6/8": (60, 600)}
        for sig in ("2/4", "6/8"):
            got = count(wavs=[waltz_wav], signature=sig)
            ok(f"the waltz counted as {sig} is a number in {ranges[sig][0]} to {ranges[sig][1]}: {said(got)}",
               got is not None and ranges[sig][0] <= got <= ranges[sig][1])
        ok("every answer above is inside its signature's range",
           all(got is None or ranges[sig][0] <= got <= ranges[sig][1] for sig, got in answers))
        try:
            count(wavs=[waltz_wav], signature="5/4")
            refused = False
        except ValueError:
            refused = True
        ok("a signature the app does not have is refused", refused)
        # An answer that interpolation puts a little past the edge is held to it.
        real = tempo._window_tempos
        edges = []
        try:
            for sig, past, edge in (("4/4", 305.0, 300), ("4/4", 28.0, 30), ("6/8", 610.0, 600), ("6/8", 55.0, 60)):
                tempo._window_tempos = lambda *a, past=past, **k: np.array([past, past])
                edges.append(count(wavs=[waltz_wav], signature=sig) == edge)
        finally:
            tempo._window_tempos = real
        ok("an answer past the range is held to its edge: 300 and 30 in x/4, 600 and 60 in 6/8", all(edges))

        # Read in blocks: the three minutes are never all in memory at once.
        tracemalloc.start()
        count(drums_wav=rock_wav, wavs=[rock_wav])
        peak = tracemalloc.get_traced_memory()[1]
        tracemalloc.stop()
        whole = 180 * SR * 4  # the take as float32 in one piece
        ok(f"counting 3 minutes holds {peak / 2 ** 20:.1f} MB at most, under a third of the take as one array "
           f"({whole / 2 ** 20:.0f} MB)", peak < whole / 3)

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("Counting a tempo: every check passes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
