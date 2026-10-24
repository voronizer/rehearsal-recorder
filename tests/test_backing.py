"""
A song's backing track (backing-track spec): the file the band adds to a song,
made ready to play at the app's rate, counted, and written into a take.

The files are made here with libsndfile, as the band's players would export
them: WAV, AIFF, FLAC, MP3 and OGG, a tone of a known pitch and level for the
resampler, and drums on a grid with bar 1 after a known lead-in for the
counter, so every answer has a truth. Real backing tracks are not here: the
counter is tried on the band's own files by hand (the spec's list).

No sound card, no browser, no MIDI port: files in a temporary folder.
"""

import os
import shutil
import sys
import tempfile
import wave
from pathlib import Path

# The engine suite's stand-in for the sound card library, then the tempo
# suite's drums: importing either runs no suite.
from test_engine import np  # noqa: F401  (the stand-ins come with it)
from test_tempo import hit, write_wav

import soundfile  # noqa: E402

from rehearsal_recorder.audio import backing_count, backing_file  # noqa: E402
from rehearsal_recorder.audio.format import unpack24  # noqa: E402

problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


SR = 44100
UNREADABLE = "This file can't be read. Use WAV, AIFF, FLAC, MP3 or OGG; most players can export one."
rng = np.random.default_rng(7)


def refused(path):
    """The message probe gives for a file, or None when it reads it."""
    try:
        backing_file.probe(path)
    except backing_file.BackingError as e:
        return str(e)
    return None


def sine(freq, seconds, sr, level=0.5):
    return level * np.sin(2 * np.pi * freq * np.arange(int(seconds * sr)) / sr)


def tone(y, sr):
    """The loudest tone in `y`: its frequency, from a Hann window's peak and
    the parabola through the logs of its neighbours, and its level in dB of
    full scale, from the middle's RMS (a sine at 1.0 is -3 dB)."""
    spectrum = np.abs(np.fft.rfft(y * np.hanning(len(y))))
    k = int(np.argmax(spectrum[1:-1])) + 1
    a, b, c = np.log(spectrum[k - 1:k + 2])
    freq = (k + 0.5 * (a - c) / (a - 2 * b + c)) * sr / len(y)
    middle = y[len(y) // 10: -len(y) // 10]
    return freq, 20 * np.log10(np.sqrt(np.mean(middle ** 2)))


def crash(n, sr):
    """A crash on bar 1: noise, bright and long, the loudest hit of the bar."""
    t = np.arange(n) / sr
    return np.diff(rng.standard_normal(n + 1)) * np.exp(-t * 8) * 0.6


def backing(path, bpm, per_bar, bars, lead_in, *, sub=2, snares=(), kicks=(0,), pickup=False):
    """
    A backing track: `lead_in` seconds of the room, then `bars` bars of `bpm`
    beats a minute: a kick and a crash on each bar's first beat, a kick on the
    beats in `kicks`, a snare on those in `snares`, a hat `sub` times a beat;
    2 ms of jitter, as a track made to a grid. With `pickup` a snare comes a
    beat before bar 1. Written as a 16-bit WAV at 44.1 kHz.
    """
    beat = 60.0 / bpm
    dur = lead_in + bars * per_bar * beat + 1.0
    y = np.zeros(int(dur * SR) + SR)
    n = int(0.4 * SR)

    def add(t, sound):
        i = int(max(0.0, t + rng.normal(0, 0.002)) * SR)
        y[i:i + n] += sound[: len(y) - i]

    if pickup:
        add(lead_in - beat, 0.8 * hit(rng, SR, "s", n))
    for k in range(bars * per_bar):
        t, pos = lead_in + k * beat, k % per_bar
        if pos == 0:
            add(t, hit(rng, SR, "k", n) + crash(n, SR))
        elif pos in kicks:
            add(t, hit(rng, SR, "k", n))
        if pos in snares:
            add(t, hit(rng, SR, "s", n))
        for q in range(sub):
            add(t + q * beat / sub, 0.6 * hit(rng, SR, "h", n))
    y += 0.01 * rng.standard_normal(len(y))
    y = y[: int(dur * SR)]
    return write_wav(path, y * (0.8 / np.abs(y).max()))


def pads(path, seconds=30.0):
    """Held chords that change every 7 s through a slow fade: no beat."""
    t = np.arange(int(seconds * SR)) / SR
    chords = [(220.0, 277.2, 329.6), (196.0, 246.9, 293.7), (174.6, 220.0, 261.6), (196.0, 246.9, 293.7)]
    y = np.zeros(len(t))
    for i, chord in enumerate(chords * 2):
        centre = 3.5 + 7.0 * i
        weight = np.clip(1.0 - np.abs(t - centre) / 5.0, 0.0, 1.0)
        if weight.any():
            y += weight * sum(np.sin(2 * np.pi * f * t) for f in chord)
    y += 0.003 * rng.standard_normal(len(t))
    return write_wav(path, y * (0.5 / np.abs(y).max()))


def main():
    tmp = Path(tempfile.mkdtemp())

    print("\n[1] Reading the file")
    stereo = np.stack([sine(440, 1.0, SR), sine(440, 1.0, SR, 0.25)], axis=1)
    made = {
        "WAV 16-bit": ("a16.wav", "WAV", "PCM_16"),
        "WAV 24-bit": ("a24.wav", "WAV", "PCM_24"),
        "WAV float": ("af.wav", "WAV", "FLOAT"),
        "AIFF": ("a.aiff", "AIFF", "PCM_16"),
        "FLAC": ("a.flac", "FLAC", "PCM_16"),
        "MP3": ("a.mp3", "MP3", "MPEG_LAYER_III"),
        "OGG": ("a.ogg", "OGG", "VORBIS"),
    }
    for label, (name, kind, subtype) in made.items():
        soundfile.write(tmp / name, stereo, SR, format=kind, subtype=subtype)
        try:
            seconds, channels = backing_file.probe(tmp / name)
            read = abs(seconds - 1.0) < 0.1 and channels == 2
        except backing_file.BackingError as e:
            read = False
            print("    ", e)
        ok(f"{label} is read: about 1 s, stereo", read)
    soundfile.write(tmp / "mono.wav", stereo[:, 0], SR, subtype="PCM_16")
    ok("a mono WAV is read as one channel", backing_file.probe(tmp / "mono.wav")[1] == 1)

    (tmp / "song.m4a").write_bytes(b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00M4A mp42isom" + bytes(4096))
    ok("an M4A says it can't be read, and which files can", refused(tmp / "song.m4a") == UNREADABLE)
    (tmp / "notes.txt").write_text("Verse, chorus, verse, chorus, out on the riff.\n")
    ok("a text file says the same", refused(tmp / "notes.txt") == UNREADABLE)
    soundfile.write(tmp / "surround.wav", np.zeros((4410, 6)), SR, subtype="PCM_16")
    ok("a 6-channel file asks for mono or stereo",
       refused(tmp / "surround.wav") == "This file has 6 channels. Use a mono or stereo file.")

    original = tmp / "From the drummer" / "Pałyn backing.wav"
    original.parent.mkdir()
    shutil.copyfile(tmp / "a24.wav", original)
    folder = tmp / "Rec" / "Backing tracks"
    first = backing_file.import_copy(original, folder)
    second = backing_file.import_copy(original, folder)
    ok("the copy goes in the Backing tracks folder under its own name",
       first == folder / "Pałyn backing.wav")
    ok("a name in use gets (2)", second == folder / "Pałyn backing (2).wav")
    ok("both copies are byte for byte the file",
       first.read_bytes() == original.read_bytes() == second.read_bytes())

    print("\n[2] Ready to play")
    ok("the ready file is named with its rate",
       backing_file.ready_path(first, 48000) == folder / "Pałyn backing.wav (ready 48 kHz).wav"
       and backing_file.ready_path(first, 44100).name == "Pałyn backing.wav (ready 44.1 kHz).wav")

    for rate_in in (44100, 96000):
        copy = tmp / f"tone {rate_in}.wav"
        y = np.stack([sine(1000, 2.0, rate_in), sine(1000, 2.0, rate_in, 0.25)], axis=1)
        soundfile.write(copy, y, rate_in, subtype="FLOAT")
        ready = backing_file.make_ready(copy, 48000)
        data, frames, rate, sample_bytes, channels = backing_file.open_ready(ready)
        ok(f"{rate_in} Hz made ready at 48 kHz, stereo kept, as float",
           rate == 48000 and channels == 2 and sample_bytes == 4 and data.dtype == np.float32
           and data.shape == (frames, 2) and abs(frames - 96000) <= 2)
        for side, level in ((0, 0.5), (1, 0.25)):
            freq, db = tone(np.asarray(data[:, side], float), rate)
            want = 20 * np.log10(level / np.sqrt(2))
            ok(f"{rate_in} Hz: the 1 kHz tone's pitch within 0.1 Hz, side {side + 1} ({freq:.3f} Hz)",
               abs(freq - 1000) < 0.1)
            ok(f"{rate_in} Hz: its level within 0.05 dB, side {side + 1} ({db - want:+.4f} dB)",
               abs(db - want) < 0.05)

    high = tmp / "30 kHz.wav"
    soundfile.write(high, sine(30000, 2.0, 96000), 96000, subtype="FLOAT")
    data = backing_file.open_ready(backing_file.make_ready(high, 48000))[0]
    middle = np.asarray(data[4800:-4800, 0], float)
    alias = 20 * np.log10(np.sqrt(np.mean(middle ** 2)) / (0.5 / np.sqrt(2)) + 1e-30)
    ok(f"a 30 kHz tone at 96 kHz leaves under -90 dB at 48 kHz ({alias:.1f} dB)", alias < -90)

    same = tmp / "at 48.wav"
    y48 = rng.uniform(-0.9, 0.9, (48000, 2)).astype(np.float32)
    soundfile.write(same, y48, 48000, subtype="FLOAT")
    data = backing_file.open_ready(backing_file.make_ready(same, 48000))[0]
    ok("a file at 48 kHz keeps every sample exactly", np.array_equal(np.asarray(data), y48))
    read16 = soundfile.read(tmp / "a16.wav", dtype="float32", always_2d=True)[0]
    data = backing_file.open_ready(backing_file.make_ready(tmp / "a16.wav", 44100))[0]
    ok("the ready file holds what libsndfile reads", np.array_equal(np.asarray(data), read16))

    mp3 = tmp / "a.mp3"
    ready = backing_file.make_ready(mp3, 48000)
    once = np.array(backing_file.open_ready(ready)[0])
    ready.unlink()
    again = np.array(backing_file.open_ready(backing_file.make_ready(mp3, 48000))[0])
    ok("an MP3 decodes to the same frames twice", once.shape == again.shape and np.array_equal(once, again))

    copy = tmp / "changes.wav"
    soundfile.write(copy, sine(500, 1.0, SR), SR, subtype="PCM_16")
    ready = backing_file.make_ready(copy, 48000)
    when = ready.stat().st_mtime_ns
    ok("made again only when needed: the same ready file is kept",
       backing_file.make_ready(copy, 48000) == ready and ready.stat().st_mtime_ns == when)
    soundfile.write(copy, sine(500, 1.0, SR, 0.1), SR, subtype="PCM_16")
    later = ready.stat().st_mtime + 10
    os.utime(copy, (later, later))
    level = np.abs(np.asarray(backing_file.open_ready(backing_file.make_ready(copy, 48000))[0])).max()
    ok("a copy newer than its ready file makes it again", abs(level - 0.1) < 0.01)
    ok("nothing half-made is left beside it",
       sorted(p.name for p in tmp.glob("changes.wav*")) == ["changes.wav", "changes.wav (ready 48 kHz).wav"])

    real = backing_file._soundfile
    backing_file._soundfile = lambda: None
    try:
        ok("without libsndfile a 16- or 24-bit WAV still reads",
           backing_file.probe(tmp / "a24.wav") == (1.0, 2))
        ok("and nothing else does",
           refused(tmp / "a.flac") == UNREADABLE and refused(tmp / "af.wav") == UNREADABLE)
        plain = tmp / "plain" / "a16.wav"
        plain.parent.mkdir()
        shutil.copyfile(tmp / "a16.wav", plain)
        data = backing_file.open_ready(backing_file.make_ready(plain, 44100))[0]
        ok("and is made ready the same", np.array_equal(np.asarray(data), read16))
    finally:
        backing_file._soundfile = real

    peaks = backing_file.peaks(backing_file.ready_path(tmp / "tone 44100.wav", 48000), 4.0, 100)
    ok("its picture: a row a side, the tone for 2 s, then nothing to 4 s",
       len(peaks) == 2 and len(peaks[0]) == 100
       and abs(peaks[0][10] - 0.5) < 0.01 and abs(peaks[1][10] - 0.25) < 0.01
       and max(peaks[0][51:]) == 0.0)

    print("\n[3] Counting")
    cases = [
        ("4/4 at 128 after a 0.80 s lead-in", backing(tmp / "128.wav", 128, 4, 16, 0.80, snares=(1, 3), kicks=(0, 2)),
         "4/4", 128, 0.80),
        ("3/4 at 96", backing(tmp / "96.wav", 96, 3, 16, 0.50, snares=(1, 2)), "3/4", 96, 0.50),
        ("6/8 at 198 with a pickup", backing(tmp / "198.wav", 198, 6, 16, 1.20, sub=1, snares=(3,), pickup=True),
         "6/8", 198, 1.20),
        ("a ballad at 72", backing(tmp / "72.wav", 72, 4, 12, 0.30, snares=(1, 3)), "4/4", 72, 0.30),
    ]
    for label, path, signature, bpm, bar_one in cases:
        found = backing_count.count(backing_file.make_ready(path, 48000), signature)
        print(f"     {label}: {found}")
        ok(f"{label}: the tempo within 1", found["tempo"] is not None and abs(found["tempo"] - bpm) <= 1)
        ok(f"{label}: bar 1 within 0.02 s", abs(found["first_bar"] - bar_one) <= 0.02)
        ok(f"{label}: bar 1 on its hit, not ahead of it", found["first_bar"] >= bar_one - 0.005)
    held = backing_count.count(backing_file.make_ready(pads(tmp / "pads.wav"), 48000), "4/4")
    ok("pads: no steady beat, bar 1 at the start", held == {"tempo": None, "first_bar": 0.0})
    ready128 = backing_file.ready_path(tmp / "128.wav", 48000)
    ok("a song with no signature counts 4/4",
       backing_count.count(ready128, None) == backing_count.count(ready128, "4/4"))

    print("\n[4] The take's track")
    y = rng.uniform(-0.99, 0.99, (24000, 2)).astype(np.float32)
    source = tmp / "track source.wav"
    soundfile.write(source, y, 48000, subtype="FLOAT")
    opened = backing_file.open_ready(backing_file.make_ready(source, 48000))
    block = backing_file.take_frames(opened, -4800, 9600)
    ok("before the file: 4800 frames of silence, then the file",
       block.shape == (9600, 2) and not block[:4800].any() and np.array_equal(block[4800:], y[:4800]))
    block = backing_file.take_frames(opened, 24000 - 100, 1000)
    ok("past its end: silence", np.array_equal(block[:100], y[-100:]) and not block[100:].any())

    out = tmp / "Backing.wav"
    length = 4800 + 24000 + 2400
    backing_file.write_take_track(opened, -4800, length, out, 48000, 3)
    with wave.open(str(out), "rb") as w:
        shape = (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes())
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.uint8)
    ok("the take's track: stereo, 24-bit, 48 kHz, the take's length", shape == (2, 3, 48000, length))
    whole = np.zeros(len(raw) // 3, dtype=np.int32)
    unpack24(raw.reshape(-1, 3), whole)
    want = np.zeros((length, 2))
    want[4800:4800 + 24000] = y * 8388607
    ok("it reads back within one step of the file, silent around it",
       np.abs(whole.reshape(-1, 2) - want).max() <= 1)
    backing_file.write_take_track(opened, 0, 24000, tmp / "Backing 16.wav", 48000, 2)
    with wave.open(str(tmp / "Backing 16.wav"), "rb") as w:
        back = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").reshape(-1, 2)
    ok("and at 16 bits", np.abs(back - y * 32767).max() <= 1)

    shutil.rmtree(tmp, ignore_errors=True)
    print()
    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print("  -", p)
        return 1
    print("All backing track checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
