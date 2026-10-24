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

import json
import math
import os
import random
import shutil
import sys
import tempfile
import threading
import time
import types
import wave
from pathlib import Path

# The engine suite's stand-in for the sound card library, then the tempo
# suite's drums: importing either runs no suite.
from test_engine import np  # noqa: F401  (the stand-ins come with it)
from test_tempo import hit, write_wav

import soundfile  # noqa: E402

from rehearsal_recorder.audio import backing_count, backing_file  # noqa: E402
from rehearsal_recorder.audio.backing_source import BackingSource, Sources  # noqa: E402
from rehearsal_recorder.audio.capture import AudioRecorder  # noqa: E402
from rehearsal_recorder.audio.click import Voices, click_frame  # noqa: E402
from rehearsal_recorder.audio.click_output import SilentOutput  # noqa: E402
from rehearsal_recorder.audio.click_source import ClickSource  # noqa: E402
from rehearsal_recorder.audio.drafts import finalize  # noqa: E402
from rehearsal_recorder.audio.format import unpack24  # noqa: E402
from rehearsal_recorder.audio.player import TakePlayer  # noqa: E402
from rehearsal_recorder.audio.take_click import TakeBacking, TakeClick  # noqa: E402
from rehearsal_recorder.metronome import ANOTHER_ASIO  # noqa: E402
from rehearsal_recorder.midi.clock import AudioClock  # noqa: E402

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


RATE = 48000
T = 3_000_000_000
# The duplex blocks below are heard 4.5 ms after their callback runs and were
# captured 5 ms before it: a round trip of 9.5 ms, 456 frames at 48 kHz.
TRIP = 456


def duplex_run(tc, blocks, width, start=0):
    """Blocks of 1024 into a take's stream with inputs and outputs, as
    test_click's: what the take wrote into the outputs, all of them."""
    heard = []
    for i in range(start, start + blocks):
        out = np.zeros((1024, width), np.float32)
        now = 100.0 + i * 1024 / RATE
        info = types.SimpleNamespace(currentTime=now, inputBufferAdcTime=now - 0.005,
                                     outputBufferDacTime=now + 0.0045)
        tc.on_duplex_block(out, i * 1024, 1024, info, (0.004, 0.004), now_ns=T + i * 1024 * 10 ** 9 // RATE)
        heard.append(out)
    return np.concatenate(heard)


def placed(data, start, from_frame, length):
    """What a backing track's outputs hold over `length` frames of a stream:
    silence before frame `start`, where the take begins, then the file from
    its frame `from_frame`, silent where that is before the file or past it."""
    out = np.zeros((length, data.shape[1]), np.float32)
    frames = np.arange(length)
    f = from_frame + frames - start
    inside = (frames >= start) & (f >= 0) & (f < len(data))
    out[inside] = data[f[inside]]
    return out


def pcm24(x):
    """Float frames as the 24-bit numbers a take's WAV holds."""
    return np.clip(np.rint(x.astype(np.float64) * 8388607.0), -8388608, 8388607).astype(np.int64)


def read24(path):
    """A 24-bit WAV's frames as numbers, and (channels, sample width, rate)."""
    with wave.open(str(path), "rb") as w:
        shape = (w.getnchannels(), w.getsampwidth(), w.getframerate())
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.uint8)
    whole = np.zeros(len(raw) // 3, dtype=np.int32)
    unpack24(raw.reshape(-1, 3), whole)
    return whole.reshape(-1, shape[0]).astype(np.int64), shape


class FakeOutput:
    """Another device's output stream as a take sees it: its rate, whether it
    is there (`trouble`, changed by hand), and the source it was given. Its
    blocks are rendered by hand."""

    def __init__(self, samplerate=RATE, trouble=None, name="Laptop", channels=(1, 2)):
        self.samplerate = samplerate
        self.name = name
        self.channels = tuple(channels)
        self.route = tuple(c - 1 for c in channels)
        self.source = None
        self.trouble = trouble
        self.stopped = False

    def start(self, source):
        self.source = source

    def stop(self):
        self.stopped = True

    def problem(self):
        return self.trouble


def through_the_api(tmp):
    """
    [9]: what a song's page, the row, Settings and Record ask of the app,
    through the Api on the engine suite's pretend machine: the Interface
    (device 0) records and plays, and the Desk (device 3) has eight outputs.
    Uses the files [1] and [3] made in `tmp`. The Trash is a folder here.
    """
    import rehearsal_recorder.api as apimod
    import test_engine
    from test_engine import _FakeStream, _sd, fresh_api

    print("\n[9] Through the Api")
    trash = tmp / "Trash"
    trash.mkdir()
    trashed = []

    def to_trash(path, fallback_root=None):
        path = Path(path)
        trashed.append(path.name)
        shutil.move(str(path), str(trash / path.name))
        return {"ok": True, "trashed": True, "location": None}

    files = tmp / "Band files"
    files.mkdir()
    palyn_file = files / "Pałyn backing.wav"
    shutil.copyfile(tmp / "128.wav", palyn_file)
    viasna_file = backing(files / "Viasna backing.wav", 126, 4, 16, 0.40, snares=(1, 3), kicks=(0, 2))
    sonca_file = files / "Sonca pads.wav"
    shutil.copyfile(tmp / "pads.wav", sonca_file)

    home = tmp / "Home"
    home.mkdir()
    was_trash, real_ready, real_query = apimod.move_to_trash, backing_file.make_ready, _sd.query_devices
    apimod.move_to_trash = to_trash
    _, a = fresh_api(home)

    def kinds(tracks):
        return [(t["name"], t.get("kind")) for t in tracks]

    def ready(timeout=30):
        """Whether the row stops saying the file is being got ready."""
        give_up = time.monotonic() + timeout
        while a.metronome_state()["backing"]["getting_ready"] and time.monotonic() < give_up:
            time.sleep(0.05)
        return not a.metronome_state()["backing"]["getting_ready"]

    def info(i):
        now = 80.0 + i * 1024 / RATE
        return types.SimpleNamespace(currentTime=now, inputBufferAdcTime=now - 0.005,
                                     outputBufferDacTime=now + 0.005)

    def blocks(n):
        """`n` blocks of silence from the card into the take recording."""
        rec = a._recorder
        for i in range(n):
            indata = np.zeros((1024, 1), np.int16)
            if rec.click is not None and rec.click.duplex:
                rec._duplex_callback(indata, np.zeros((1024, rec.click.width), np.float32), 1024, info(i), None)
            else:
                rec._callback(indata, 1024, info(i), None)

    try:
        s = a.get_settings()
        ok("before any song has one: where the player plays, at 0.8, on, no row",
           s["backing_device_index"] is None and s["backing_device_missing"] is None
           and s["backing_channels"] is None and s["backing_volume"] == 0.8
           and s["backing_on"] is True and s["backing_row"] is False)
        ok("a volume past 1 is refused", a.set_backing_setting("backing_volume", 1.5)["ok"] is False)
        ok("and so is a setting it does not have", a.set_backing_setting("backing_row", True)["ok"] is False)
        ok("every output says whether the backing track can go there",
           all("backing_unavailable" in d for d in a.list_output_devices()))

        palyn = a.add_song("Pałyn")
        ok("New song makes a song with no takes", palyn.get("ok") and palyn["title"] == "Pałyn")
        ok("  and refuses a title in use, in any case", a.add_song("PAŁYN").get("error") == "Pałyn is already a song.")
        hlyboka = a.add_song("Hlyboka")
        ok("  Next take offers a song with no takes",
           any(c["song"] == "Hlyboka" and c["go"] == 1 for c in a.song_choices()["other"]))

        was_webview = sys.modules.get("webview")
        sys.modules["webview"] = types.SimpleNamespace(OPEN_DIALOG=10, FOLDER_DIALOG=20, SAVE_DIALOG=30)
        asked = []
        try:
            a._window = types.SimpleNamespace(
                create_file_dialog=lambda *args, **kw: asked.append(kw) or (str(palyn_file),))
            ok("the picker gives the file and its name",
               a.pick_backing_file() == {"ok": True, "path": str(palyn_file), "name": "Pałyn backing.wav"})
            ok("  and offers the files the app reads", "*.mp3" in " ".join(asked[0].get("file_types") or ()))
            a._window = types.SimpleNamespace(create_file_dialog=lambda *args, **kw: None)
            ok("  cancelled, it says so", a.pick_backing_file() == {"ok": False, "cancelled": True})
        finally:
            a._window = None
            if was_webview is None:
                sys.modules.pop("webview", None)
            else:
                sys.modules["webview"] = was_webview

        added = a.add_backing(palyn["id"], str(palyn_file))
        copy = home / "Rec" / "Backing tracks" / "Pałyn backing.wav"
        length = soundfile.info(str(palyn_file)).frames / SR
        ok("Add counts it: 128, bar 1 on its first strong beat",
           added.get("ok") is True and added["tempo"] == 128 and abs(added["first_bar"] - 0.80) <= 0.02)
        ok("  and says its name, length and channels",
           added["name"] == "Pałyn backing.wav" and abs(added["seconds"] - length) < 0.01 and added["channels"] == 1)
        ok("  copied to Backing tracks, and ready at the app's rate",
           copy.exists() and backing_file.ready_path(copy, 44100).exists())
        page = a.get_song(palyn["id"])
        ok("a song with no tempo takes the counted one", (page["tempo"], page["signature"]) == (128, "4/4"))
        ok("  its page has the file, there",
           page["backing"] == {"name": "Pałyn backing.wav", "first_bar": added["first_bar"], "tempo": 128,
                               "seconds": added["seconds"], "channels": 1, "missing": False})
        ok("  and so does History's list",
           next(s for s in a.list_songs()["songs"] if s["id"] == palyn["id"])["backing"] == page["backing"])
        ok("the row shows from now on", a.get_settings()["backing_row"] is True)
        before = sorted(p.name for p in copy.parent.iterdir())
        ok("a 6-channel file is refused in its words, and nothing is copied",
           a.add_backing(palyn["id"], str(tmp / "surround.wav"))
           == {"ok": False, "error": "This file has 6 channels. Use a mono or stereo file."}
           and sorted(p.name for p in copy.parent.iterdir()) == before)
        ok("  so is a song that is not there",
           a.add_backing(99999, str(palyn_file))["ok"] is False
           and sorted(p.name for p in copy.parent.iterdir()) == before)

        viasna = a.add_song("Viasna")
        a.set_song_tempo(viasna["id"], 128, "4/4")
        counted = a.add_backing(viasna["id"], str(viasna_file))
        ok("a song with a tempo keeps it: counted 126, the song stays at 128",
           counted.get("tempo") == 126 and a.get_song(viasna["id"])["tempo"] == 128)
        sonca = a.add_song("Sonca")
        held = a.add_backing(sonca["id"], str(sonca_file))
        ok("pads: no steady beat, bar 1 at the start, and the song has no tempo still",
           held.get("ok") is True and held["tempo"] is None and held["first_bar"] == 0.0
           and a.get_song(sonca["id"])["tempo"] is None)

        long_ = a.get_song(viasna["id"])["backing"]["seconds"]
        ok("bar 1 is kept to a hundredth", a.set_backing_first_bar(viasna["id"], 0.534) == {"ok": True, "first_bar": 0.53})
        ok("  never past the file's end",
           a.set_backing_first_bar(viasna["id"], 9999)["first_bar"] == math.floor(long_ * 100) / 100)
        ok("  nor before its start", a.set_backing_first_bar(viasna["id"], -1)["first_bar"] == 0.0)
        a.set_backing_first_bar(viasna["id"], 0.40)
        halved = a.set_backing_tempo(palyn["id"], 64, True)
        ok("halved: the backing track's tempo, and the song's that took it",
           halved.get("ok") is True and a.get_song(palyn["id"])["tempo"] == 64
           and a.get_song(palyn["id"])["backing"]["tempo"] == 64)
        a.set_backing_tempo(palyn["id"], 128, True)
        ok("the backing track's tempo taken for the song",
           a.set_backing_tempo(viasna["id"], 126, True).get("ok") is True and a.get_song(viasna["id"])["tempo"] == 126
           and a.set_backing_tempo(viasna["id"], 126, False).get("ok") is True)
        a.set_song_tempo(viasna["id"], 128, "4/4")
        ok("  a tempo the metronome cannot keep is refused", a.set_backing_tempo(palyn["id"], 999, True)["ok"] is False)
        drawn = a.song_backing_peaks(palyn["id"], 8.0, 80)
        ok("its start drawn: one row of 80 for its one channel, quiet before bar 1, loud on it",
           drawn.get("ok") is True and len(drawn["peaks"]) == 1 and len(drawn["peaks"][0]) == 80
           and max(drawn["peaks"][0][:7]) < 0.1 and max(drawn["peaks"][0][8:12]) > 0.3)

        replaced = a.add_backing(viasna["id"], str(palyn_file))
        ok("Replace: the new file in, the old copy and its ready file to the Trash",
           replaced.get("ok") is True and "Viasna backing.wav" in trashed
           and "Viasna backing.wav (ready 44.1 kHz).wav" in trashed
           and not (copy.parent / "Viasna backing.wav").exists())
        ok("  the new copy beside Palyn's under a name of its own", (copy.parent / "Pałyn backing (2).wav").exists())
        a.add_backing(viasna["id"], str(viasna_file))

        a.set_output_device(0)
        gate = threading.Event()

        def made_slowly(copy_, rate):
            gate.wait(10)
            return real_ready(copy_, rate)

        backing_file.make_ready = made_slowly
        try:
            ok("a rehearsal begins at 48 kHz",
               a.start_rehearsal("Evening", 0, RATE, [{"name": "Gtr", "channel": 1}], 16)["ok"])
            a.set_next_take_name("Pałyn")
            row = a.metronome_state()["backing"]
            ok("the file is got ready at that rate, and the row says so",
               row["getting_ready"] is True and row["song"]["title"] == "Pałyn")
            ok("  Record meanwhile records without it", a.start_take()["ok"] and a._recorder.click.backing is None)
            a.stop_take()
        finally:
            backing_file.make_ready = real_ready
            gate.set()
        ok("  then it is ready at 48 kHz", ready() and backing_file.ready_path(copy, RATE).exists())

        row = a.metronome_state()["backing"]
        ok("the row before a click take: Palyn's file, on, at 0.8, not playing",
           row["song"] == {**a.get_song(palyn["id"])["backing"], "song_id": palyn["id"], "title": "Pałyn"}
           and row["on"] is True and row["volume"] == 0.8 and row["row"] is True and row["playing"] is False
           and row["position_sec"] == 0 and row["output_missing"] is None and row["free"] is False)
        first_bar = a.get_song(palyn["id"])["backing"]["first_bar"]
        a.start_take()
        rec = a._recorder
        tb = rec.click.backing
        ok("a click take: its bar 1 on the first click after the count-in",
           tb is not None and tb.from_frame == round(first_bar * RATE) - click_frame(4, 128, RATE)
           and tb.file == backing_file.ready_path(copy, RATE))
        ok("  on the recording card's outputs, mono to both", rec.click.duplex and tb.output is None and tb.route == (0, 1))
        ok("  the row shows it playing", a.metronome_state()["backing"]["playing"] is True)
        ok("Replace during a take is refused",
           a.add_backing(palyn["id"], str(viasna_file)) == {"ok": False, "error": "Not during a take"})
        ok("  and Remove", a.remove_backing(palyn["id"]) == {"ok": False, "error": "Not during a take"})
        ok("  the take keeps the file it opened", copy.exists() and tb.file.exists())
        a.set_backing_setting("backing_volume", 0.5)
        ok("the volume during the take is what it plays", tb.volume == 0.5)
        a.set_backing_setting("backing_volume", 0.8)
        blocks(16)
        done = a.stop_take()
        ok("Stop: its tracks end with the Backing track",
           kinds(done["tracks"]) == [("Gtr", None), ("Backing", "backing")] and Path(done["tracks"][-1]["file"]).is_file())
        ok("  with its song, whose Backing track is not heard yet",
           done["song_id"] == palyn["id"] and done["backing_heard"] is False)
        kept = a.keep_take(done["take_number"], done["temp_dir"], done["suggested_name"], done["duration_sec"],
                           done["tracks"])
        click_take = kept["take"]
        ok("Keep keeps it as the take's Backing track",
           kinds(click_take["tracks"]) == [("Gtr", None), ("Backing", "backing")]
           and click_take["song"] == "Pałyn" and click_take["song_id"] == palyn["id"])
        media = a.take_media(click_take["tracks"])
        ok("  the player gets it with the Backing track icon",
           media[-1].get("icon") == "backing" and media[-1].get("kind") == "backing")
        folder = Path(a._session["folder"])
        a.set_cloud_dir(str(tmp / "Cloud"))
        sent = a._copy_to_cloud(folder, click_take["take_number"], "tracks")
        ok("sent to the cloud with its tracks, the Backing track goes too",
           sent.get("ok") is True and any(p.name == "Backing.wav" for p in (tmp / "Cloud").rglob("*")))

        band = backing(tmp / "band 120.wav", 120, 4, 16, 0.5, snares=(1, 3), kicks=(0, 2))
        steady = backing(tmp / "steady 90.wav", 90, 4, 12, 0.2, snares=(1, 3), kicks=(0, 2))
        y, rate = soundfile.read(str(band))
        soundfile.write(click_take["tracks"][0]["file"], y * 0.2, rate, subtype="PCM_16")
        shutil.copyfile(steady, click_take["tracks"][1]["file"])
        ok("a take's tempo counted from its files leaves its steady Backing track out: the band's 120",
           a.count_tempo(str(folder), click_take["take_number"], "4/4") == {"ok": True, "tempo": 120})
        drift = a.take_drift(click_take["tracks"], [], {"tempo": None, "signature": "4/4"})
        ok("  and so does its drift line", drift.get("ok") is True and round(drift["middle"]) == 120)

        a.metronome_set_on(False)
        a.start_take()
        rec = a._recorder
        ok("the metronome off: no click, the file from its start at Record",
           rec.click is not None and not rec.click.clicks and rec.click.backing is not None
           and rec.click.backing.from_frame == 0)
        blocks(8)
        ok("  no count-in on the screen", a.metronome_state()["phase"] == "take")
        done = a.stop_take()
        ok("  Stop keeps its Backing track; the take has its tempo and no click",
           kinds(done["tracks"])[-1] == ("Backing", "backing") and done["click"] is False and done["tempo"] == 128)
        a._meters.clear()
        kept = a.keep_take(done["take_number"], done["temp_dir"], done["suggested_name"], done["duration_sec"],
                           done["tracks"])
        ok("  kept from its take.json, it is no click take", kept["take"]["click"] is False
           and kept["take"]["tempo"] == 128)
        a.metronome_set_on(True)

        a.set_next_take_name("Sonca")
        ok("Sonca's file gets ready at 48 kHz", ready())
        a.start_take()
        rec = a._recorder
        ok("a song with no tempo: the file from its start too",
           rec.click is not None and not rec.click.clicks and rec.click.backing is not None
           and rec.click.backing.from_frame == 0)
        a.stop_take()

        a.set_next_take_name("Take 9")
        row = a.metronome_state()["backing"]
        ok("a free take: no backing track, and the row knows why", row["free"] is True and row["song"] is None)
        a.start_take()
        ok("  Record plays none", a._recorder.click is None)
        a.stop_take()
        a.add_song("Dym")
        a.set_next_take_name("Dym")
        row = a.metronome_state()["backing"]
        ok("a song without one: none in the row", row["song"] is None and row["free"] is False)

        a.set_next_take_name("Pałyn")
        ok("the switch is a setting", a.set_backing_setting("backing_on", False)["ok"]
           and a.get_settings()["backing_on"] is False and a.metronome_state()["backing"]["on"] is False)
        a.start_take()
        ok("  off: Record plays none", a._recorder.click.backing is None)
        a.stop_take()
        a.set_backing_setting("backing_on", True)

        ok("the Desk's 5-6 for the backing track",
           a.set_backing_device(3)["ok"] and a.set_backing_channels([5, 6])["ok"]
           and a.get_settings()["backing_device_index"] == 3 and a.get_settings()["backing_channels"] == [5, 6])
        gone = [d for d in test_engine._DEVICES if d["name"] != "Desk"]
        _sd.query_devices = lambda index=None, kind=None: gone if index is None else gone[index]
        try:
            a._metronome.devices_changed()
            ok("its output unplugged: the row names it, with its outputs",
               a.metronome_state()["backing"]["output_missing"] == "Desk 5–6")
            ok("  and so does Settings", a.get_settings()["backing_device_missing"] == "Desk")
            a.start_take()
            ok("  Record records without it", a._recorder.click.backing is None)
            blocks(8)
            done = a.stop_take()
            ok("  and keeps no Backing track", all(t.get("kind") != "backing" for t in done["tracks"]))
        finally:
            _sd.query_devices = real_query
            a._metronome.devices_changed()
        ok("plugged in again, the row says nothing of it", a.metronome_state()["backing"]["output_missing"] is None)
        a.set_backing_device(None)

        opened = _FakeStream.opened
        ok("its play button plays it", a.backing_play(palyn["id"], False)["ok"])
        ok("  in a stream of its own on the interface, shown playing",
           _FakeStream.opened == opened + 1 and _FakeStream.last.kw["device"] == 0
           and a.metronome_state()["backing"]["playing"] is True)
        ok("  the metronome's play button stops it",
           a.metronome_play()["ok"] and a.metronome_state()["backing"]["playing"] is False)
        ok("  and it stops the metronome's",
           a.backing_play(palyn["id"], False)["ok"] and a.metronome_state()["phase"] == "idle")
        a.set_next_take_name("Dym")
        ok("  another song picked stops it", a.metronome_state()["backing"]["playing"] is False)
        a.set_next_take_name("Pałyn")
        a.backing_play(palyn["id"], False)
        ok("  Stop stops it", a.backing_stop()["ok"] and a.metronome_state()["backing"]["playing"] is False)
        opened = _FakeStream.opened
        ok("with the click from bar 1: one stream for both on one device",
           a.backing_play(palyn["id"], True)["ok"] and _FakeStream.opened == opened + 1)
        a.start_take()
        ok("  during a take it does not play", a.backing_play(palyn["id"], False)["ok"] is False)
        a.stop_take()
        ok("  Record stopped it", a.metronome_state()["backing"]["playing"] is False)
        opened = _FakeStream.opened
        ok("Settings plays two seconds of it, not shown in the row",
           a.backing_preview()["ok"] and _FakeStream.opened == opened + 1
           and a.metronome_state()["backing"]["playing"] is False)
        a.backing_stop()

        copy.unlink()
        ok("the copy deleted by hand: its page says it is missing",
           a.get_song(palyn["id"])["backing"]["missing"] is True)
        row = a.metronome_state()["backing"]
        ok("  so does the row, and nothing is got ready", row["song"]["missing"] is True and row["getting_ready"] is False)
        a.start_take()
        ok("  Record records without it", a._recorder.click.backing is None)
        a.stop_take()
        ok("  its play button says why",
           a.backing_play(palyn["id"], False).get("error")
           == "Pałyn backing.wav is missing from the Backing tracks folder.")
        ok("  Remove takes it away", a.remove_backing(palyn["id"])["ok"] and a.get_song(palyn["id"])["backing"] is None)

        trashed.clear()
        ok("a merge into a song with none gives it the merged one's, nothing to the Trash",
           a.merge_songs(viasna["id"], hlyboka["id"])["ok"]
           and a.get_song(hlyboka["id"])["backing"]["name"] == "Viasna backing.wav" and trashed == [])
        ok("one into a song with its own: the merged one's copy to the Trash, with its ready files",
           a.merge_songs(sonca["id"], hlyboka["id"])["ok"] and "Sonca pads.wav" in trashed
           and any(t.startswith("Sonca pads.wav (ready ") for t in trashed))

        ok("whether a song's Backing track is heard is kept",
           a.set_song_backing_heard(palyn["id"], True) == {"ok": True, "heard": True})
        a.shutdown()
        _, b = fresh_api(home)
        try:
            ok("  across a restart", b._lib.take(folder, click_take["take_number"])["backing_heard"] is True)
        finally:
            b.shutdown()
    finally:
        apimod.move_to_trash, backing_file.make_ready, _sd.query_devices = was_trash, real_ready, real_query


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

    print("\n[5] Placing it")
    noise = rng.uniform(-0.9, 0.9, (6 * RATE, 2)).astype(np.float32)
    soundfile.write(tmp / "noise.wav", noise, RATE, subtype="FLOAT")
    ready6 = backing_file.make_ready(tmp / "noise.wav", RATE)
    data6 = np.asarray(backing_file.open_ready(ready6)[0])
    voices = Voices("click", RATE, 0.7)
    bar = click_frame(4, 120, RATE)

    def click_take(count_in, bar_one, route=(2, 3), file=ready6, **kw):
        return TakeClick(120, "4/4", count_in, voices, (0, 1),
                         backing=TakeBacking(file, bar_one, route=route, volume=1.0), **kw)

    one = click_take(1, 2.5)
    heard_one = duplex_run(one, 150, 4)
    first = one.first_click_frame
    ok("a bar of count-in at 120 before bar 1 at 2.50 s: the file starts at its frame 24000",
       one.backing.from_frame == 24000)
    ok("frame for frame: silent before the first click, then the file",
       np.array_equal(heard_one[:, 2:4], placed(data6, first - TRIP, 24000, len(heard_one))))
    ok("its bar 1 lands on the first click after the count-in",
       np.array_equal(heard_one[first - TRIP + bar, 2:4], data6[120000]))

    two = click_take(2, 4.2)
    heard = duplex_run(two, 200, 4)
    first = two.first_click_frame
    ok("two bars of count-in: bar 1 on the first click after them",
       two.backing.from_frame == 9600
       and np.array_equal(heard[:, 2:4], placed(data6, first - TRIP, 9600, len(heard)))
       and np.array_equal(heard[first - TRIP + 2 * bar, 2:4], data6[201600]))

    long_in = click_take(1, 3.2)
    heard = duplex_run(long_in, 60, 4)
    first = long_in.first_click_frame
    ok("a 3.2 s lead-in and a 2 s count-in: the first 1.2 s of the file are skipped",
       long_in.backing.from_frame == 57600 and np.array_equal(heard[first - TRIP, 2:4], data6[57600]))

    short_in = click_take(1, 1.0)
    heard = duplex_run(short_in, 120, 4)
    first = short_in.first_click_frame
    ok("a 1 s lead-in and a 2 s count-in: a second of silence, then the file from its start",
       short_in.backing.from_frame == -48000
       and np.array_equal(heard[:, 2:4], placed(data6, first - TRIP, -48000, len(heard)))
       and not heard[first - TRIP:first - TRIP + 48000, 2:4].any())

    no_count = click_take(0, 2.5)
    heard = duplex_run(no_count, 60, 4)
    first = no_count.first_click_frame
    ok("no count-in: the file starts at its bar 1, with the first click",
       no_count.backing.from_frame == 120000 and np.array_equal(heard[first - TRIP, 2:4], data6[120000])
       and np.array_equal(heard[first - TRIP:first - TRIP + len(voices.of(2)), 0], voices.of(2)))

    alone = TakeClick(None, None, 0, None, (), clicks=False,
                      backing=TakeBacking(ready6, 2.5, route=(0, 1), volume=1.0))
    heard = duplex_run(alone, 60, 2)
    first = alone.first_click_frame
    ok("no click: the file from its start, nothing else in the outputs",
       alone.backing.from_frame == 0 and first == 4800 + TRIP
       and np.array_equal(heard, placed(data6, first - TRIP, 0, len(heard))))
    ok("  the take's files start where its first sample comes back in",
       alone.record()["first_click_frame"] == first and alone.count_in_clicks == 0)
    ok("  Stop ends them where it comes, no quarter to run on to, no tempo in the WAVs",
       alone.stop_frame(first + 12345) == first + 12345 and alone.end_frame == first + 12345
       and alone.acid() is None)

    print("\n[6] The streams")
    click_only = TakeClick(120, "4/4", 1, voices, (0, 1))
    ok("the click keeps its own outputs: the same as without a backing track",
       np.array_equal(heard_one[:, 0:2], duplex_run(click_only, 150, 2)))
    mono_noise = rng.uniform(-0.9, 0.9, 3 * RATE).astype(np.float32)
    soundfile.write(tmp / "mono.wav", mono_noise, RATE, subtype="FLOAT")
    mono = click_take(1, 1.5, file=backing_file.make_ready(tmp / "mono.wav", RATE))
    heard = duplex_run(mono, 60, 4)
    want = placed(mono_noise[:, None], mono.first_click_frame - TRIP, mono.backing.from_frame, len(heard))[:, 0]
    ok("a mono file goes to both outputs of its pair", np.array_equal(heard[:, 2], want) and np.array_equal(heard[:, 3], want))
    single = click_take(1, 2.5, route=(2,))
    heard = duplex_run(single, 60, 3)
    both_sides = (data6[:, :1] + data6[:, 1:]) * np.float32(0.5)
    ok("a stereo file on one output: its two sides averaged",
       np.allclose(heard[:, 2:3], placed(both_sides, single.first_click_frame - TRIP, 24000, len(heard)), atol=1e-6))

    together = Sources(ClickSource(120, "4/4", voices, (0, 1)),
                       BackingSource(backing_file.open_ready(ready6), (2, 3), 1.0))
    block = np.zeros((1024, 4), np.float32)
    together.render(block, 0, T, 0.01)
    ok("one stream for both: the click on its outputs, the file on its own",
       together.route == (0, 1, 2, 3) and np.array_equal(block[:, 2:4], data6[:1024])
       and np.array_equal(block[:, 0], voices.of(2)[:1024]))
    shared = FakeOutput(RATE, channels=(1, 2, 3, 4))
    sharing = TakeClick(120, "4/4", 1, voices, (0, 1), output=shared, samplerate=RATE,
                        backing=TakeBacking(ready6, 2.5, output=shared, route=(2, 3)))
    sharing.start()
    ok("  a take whose click and backing track go to the same device opens one stream there",
       isinstance(shared.source, Sources) and shared.source.sources == (sharing.source, sharing.backing.source))

    write_wav(tmp / "quiet.wav", np.zeros(RATE), sr=RATE)
    player = TakePlayer([{"name": "Gtr", "file": str(tmp / "quiet.wav")}])
    between = BackingSource(backing_file.open_ready(ready6), (0, 1), 1.0)
    player.play_free_backing(between)
    out = np.zeros((512, 2), np.int16)
    player._fill(out, 512, None)
    ok("between takes, mixed into the player's stream on its device",
       player.free_backing is between and np.abs(out - np.trunc(data6[:512] * 32767)).max() <= 1)

    elsewhere = FakeOutput(RATE)
    asio = TakeClick(120, "4/4", 1, voices, (0, 1), output=elsewhere, samplerate=RATE,
                     backing=TakeBacking(ready6, 2.5, output=SilentOutput("X18", ANOTHER_ASIO, RATE)))
    asio.start()
    elsewhere.source.render(np.zeros((1024, 2), np.float32), 0, T, 0.02)
    clock = AudioClock(RATE)
    clock.started_ns = T
    clock.mark(T + 30_000_000, 1024, 1024, None)
    asio.on_input(0, clock)
    ok("a second ASIO card can't carry it, in the click's words, and the take records without it",
       asio.first_click_frame is not None and asio.backing.problem() == ANOTHER_ASIO
       and asio.backing_record() is None)

    print("\n[7] Another device")
    # The backing track on the laptop's output while the desk records: two
    # clocks, the desk 200 ppm fast and the laptop 150 ppm slow, each
    # callback late by a few ms of jitter, as in test_click's hour.
    in_rate, out_rate = RATE * (1 + 200e-6), RATE * (1 - 150e-6)
    T0 = 7_000_000_000
    T1 = T0 + 250_000_000
    rnd = random.Random(5)
    laptop = FakeOutput(RATE)
    away = TakeClick(None, None, 0, None, (), clicks=False, samplerate=RATE,
                     backing=TakeBacking(ready6, 0.0, output=laptop, volume=1.0))
    away.start()
    desk = AudioClock(RATE)
    desk.latency_sec = 0.005
    desk.started_ns = T0
    out = np.zeros((1024, 2), np.float32)
    steps, last = [], None
    i = j = 0

    def input_due(i):
        return T0 + (1024 * (i + 1)) / in_rate * 1e9 + 3e6 + rnd.random() * 3e6

    def output_due(j):
        return T1 + 1024 * j / out_rate * 1e9 - 0.02e9 - rnd.random() * 3e6

    next_in, next_out = input_due(0), output_due(0)
    while min(next_in, next_out) < T0 + 3600e9:
        if next_in <= next_out:
            ran = int(next_in)
            captured = T0 + 1024 * i / in_rate * 1e9 + rnd.uniform(-2e5, 2e5)
            desk.mark(ran, 1024 * (i + 1), 1024, (ran - captured) / 1e9)
            away.on_input(1024 * i, desk)
            i += 1
            next_in = input_due(i)
        else:
            ran = int(next_out)
            dac = T1 + 1024 * j / out_rate * 1e9 + rnd.uniform(-2e5, 2e5)
            out.fill(0)
            laptop.source.render(out, 1024 * j, ran, (dac - ran) / 1e9)
            now = laptop.source.position_sec
            if last is not None and now is not None:
                steps.append((now - last) * RATE / 1024)
            if now is not None:
                last, last_block = now, j
            j += 1
            next_out = output_due(j)
    heard_at = (T1 + 1024 * last_block / out_rate * 1e9 - T0) * in_rate / 1e9
    off = last * RATE - (away.backing.from_frame + heard_at - away.first_click_frame)
    ok(f"after an hour the file is heard within 10 ms of where its track has it ({off / RATE * 1000:+.2f} ms)",
       abs(off) <= 480)
    ok(f"its speed kept within 0.1% of the file's ({min(steps):.5f} to {max(steps):.5f})",
       len(steps) > 160000 and 0.999 <= min(steps) and max(steps) <= 1.001)

    print("\n[8] The take's Backing track")

    def block_in(i):
        n = (np.arange(i * 1024, (i + 1) * 1024) % 30000).astype(np.int32) << 8
        return np.stack([n, n], axis=1)

    def info(i):
        now = 50.0 + i * 1024 / RATE
        return types.SimpleNamespace(currentTime=now, inputBufferAdcTime=now - 0.005,
                                     outputBufferDacTime=now + 0.005)

    def feed(rec, i):
        if rec.click.duplex:
            rec._duplex_callback(block_in(i), np.zeros((1024, rec.click.width), np.float32), 1024, info(i), None)
        else:
            rec._callback(block_in(i), 1024, info(i), None)

    def stopped(rec, done, also=None):
        """Stop, the card going on from block `done` on a thread of its own once
        Stop has said where the take ends, as test_engine's [80] has it.
        `also(i)` runs with each block."""
        halt = threading.Event()

        def card():
            i = done
            while not halt.is_set():
                if rec.click.end_frame is None:
                    time.sleep(0.001)
                    continue
                feed(rec, i)
                if also is not None:
                    also(i)
                i += 1
                time.sleep(0.0002)

        feeder = threading.Thread(target=card, daemon=True)
        stream = rec._stream
        stopping = stream.stop

        def stop():
            halt.set()
            feeder.join()
            stopping()

        stream.stop = stop
        feeder.start()
        return rec.stop()

    def take(name, tracks=(("Gtr", 1), ("Voc", 2)), blocks=300, during=None, also=None, **backing):
        backing = {"route": (2, 3), **backing}
        tc = TakeClick(120, "4/4", 1, voices, (0, 1), backing=TakeBacking(ready6, 2.5, **backing))
        rec = AudioRecorder(0, RATE, [{"name": n, "channel": c} for n, c in tracks], tmp / name, 24, click=tc)
        rec.start()
        opened = rec._stream.kw
        for i in range(blocks):
            feed(rec, i)
            if also is not None:
                also(i)
            if during is not None:
                during(i, tc)
        return tc, opened, stopped(rec, blocks, also)

    tc, opened, done = take("A")
    folder = tmp / "A"
    track, shape = read24(folder / "Backing.wav")
    frames = tc.end_frame - tc.first_click_frame
    want = pcm24(backing_file.take_frames(backing_file.open_ready(ready6), 24000, frames))
    ok("Stop writes the take's Backing track beside its tracks",
       done.get("backing") == {"name": "Backing", "file": str(folder / "Backing.wav")}
       and opened["channels"] == (2, 4))
    ok("  stereo as the file, at the take's 24 bits and rate, its length",
       shape == (2, 3, RATE) and len(track) == frames == read24(folder / "Gtr.wav")[0].shape[0])
    ok("  the file sample for sample as it was placed, silent past its end",
       np.array_equal(track, want) and not track[264000:].any() and track[:264000].any())
    record = json.loads((folder / "take.json").read_text(encoding="utf-8"))
    ok("take.json says which file and where it started",
       record.get("backing") == {"file": str(ready6), "from_frame": 24000, "name": "Backing"})
    ok("the fade at Stop was heard before the take's stream closed", tc.backing.source.done)

    def flip(i, tc):
        if i == 50:
            tc.set_backing_on(False)
        if i == 80:
            tc.set_backing_volume(0.3)

    take("B", during=flip)
    ok("the switch and the volume during the take change what is heard, not the track",
       (tmp / "B" / "Backing.wav").read_bytes() == (folder / "Backing.wav").read_bytes())

    _, _, done = take("C", tracks=(("Backing", 1), ("Voc", 2)), blocks=60)
    ok("a band track already called Backing: the backing track's is Backing (2)",
       done["backing"] == {"name": "Backing (2)", "file": str(tmp / "C" / "Backing (2).wav")}
       and any(t["name"] == "Backing" for t in done["tracks"]))

    lost = TakeClick(120, "4/4", 1, voices, (0, 1), backing=TakeBacking(ready6, 2.5, route=(2, 3)))
    crashed = AudioRecorder(0, RATE, [{"name": "Gtr", "channel": 1}], tmp / "D", 24, click=lost)
    crashed.start()
    for i in range(120):
        feed(crashed, i)
    time.sleep(0.2)
    crashed.abandon()
    back = finalize(tmp / "D", RATE, 24)
    track, _ = read24(tmp / "D" / "Backing.wav")
    frames = round(back["duration_sec"] * RATE)
    ok("a take the app did not live to finish gets the same track from take.json",
       back.get("backing") == {"name": "Backing", "file": str(tmp / "D" / "Backing.wav")}
       and [t["name"] for t in back["tracks"]] == ["Gtr"]
       and np.array_equal(track, pcm24(backing_file.take_frames(backing_file.open_ready(ready6), 24000, frames))))

    _, _, done = take("E", blocks=60, route=None, output=SilentOutput("Laptop", "Not connected.", RATE))
    ok("its output not there at Record: the take records, with no Backing track",
       done["backing"] is None and not (tmp / "E" / "Backing.wav").exists() and len(done["tracks"]) == 2)

    going = FakeOutput(RATE)

    def laptop_block(i):
        if going.source is not None:
            going.source.render(np.zeros((1024, 2), np.float32), 1024 * i, T + i * 21_333_333, 0.02)
        if i == 60:
            going.trouble = "The click's output stopped answering."

    _, _, done = take("F", blocks=120, route=None, output=going, also=laptop_block)
    ok("its output gone during the take: the band heard it, so the track is written",
       done["backing"] is not None and (tmp / "F" / "Backing.wav").exists())

    fading = BackingSource(backing_file.open_ready(ready6), (0, 1), 1.0)
    fading.render(np.zeros((1024, 2), np.float32), 0, T, 0.01)
    fading.fade_out()
    block = np.zeros((1024, 2), np.float32)
    fading.render(block, 1024, T + 21_333_333, 0.01)
    ramp = (1 - np.arange(1, 961) / 960)[:, None]
    ok("at Stop what is heard fades out over 20 ms, then is silent",
       np.allclose(block[:960], data6[1024:1984] * ramp, atol=1e-6) and not block[960:].any() and fading.done)

    through_the_api(tmp)

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
