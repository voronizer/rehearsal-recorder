"""
Python side, no browser: mixing, transport, disk space, crash safety,
renaming, take naming and draft recovery.

There is no sound card in the checking environment, so no stream is opened —
the renderer is called directly and the samples themselves are inspected.
"""

import json
import re
import struct
import sys
import tempfile
import types
import wave
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))

# Stub sounddevice: there is no real card here.
_sd = types.ModuleType("sounddevice")


class _FakeStream:
    """Stands in for a PortAudio stream: it can be opened and closed, and it
    says so, but no card is involved."""

    opened = 0
    closed = 0

    def __init__(self, **kw):
        self.kw = kw
        _FakeStream.opened += 1
        self.active = False

    def start(self):
        self.active = True

    def stop(self):
        self.active = False

    def close(self):
        _FakeStream.closed += 1


# The devices this fake machine has: 0 is a proper interface, 1 is an input
# only, and 2 refuses anything but 44100.
_DEVICES = [
    {"name": "Interface", "max_output_channels": 2, "max_input_channels": 8,
     "hostapi": 0, "default_samplerate": 48000},
    {"name": "Podcast mic", "max_output_channels": 0, "max_input_channels": 1,
     "hostapi": 0, "default_samplerate": 44100},
    {"name": "Fussy DAC", "max_output_channels": 2, "max_input_channels": 0,
     "hostapi": 0, "default_samplerate": 44100},
]


def _query_hostapis():
    return [{"name": "CoreAudio"}]


def _query_devices(index=None, kind=None):
    if index is None:
        return _DEVICES
    return _DEVICES[index]  # IndexError for a stale index, like the real one


def _check_output_settings(device=None, channels=2, samplerate=None, dtype=None):
    if device == 2 and samplerate != 44100:
        raise ValueError("unsupported samplerate")


def _check_input_settings(device=None, channels=1, samplerate=None, dtype=None):
    # This pretend interface does 44.1 and 48 at both depths, and 96 only at
    # 24 bit — close enough to how real cards differ.
    if samplerate not in (44100, 48000, 96000):
        raise ValueError("unsupported samplerate")
    if samplerate == 96000 and dtype != "int32":
        raise ValueError("unsupported combination")


_sd.query_devices = _query_devices
_sd.query_hostapis = _query_hostapis
_sd.check_output_settings = _check_output_settings
_sd.check_input_settings = _check_input_settings
_sd.OutputStream = _FakeStream
_sd.InputStream = _FakeStream
sys.modules["sounddevice"] = _sd

import numpy as np  # noqa: E402

from rehearsal_recorder.api import _is_inside  # noqa: E402
from rehearsal_recorder.audio.player import TakePlayer  # noqa: E402

SR = 48000
problems = []


def ok(label, cond):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def write_wav(path, value, seconds=2.0, depth=16):
    """A flat tone at `value`, given at 16-bit scale whatever the depth."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2 if depth == 16 else 3)
        w.setframerate(SR)
        if depth == 16:
            frame = struct.pack("<h", value)
        else:
            frame = struct.pack("<i", value * 256)[:3]  # little-endian, low 3
        w.writeframes(frame * int(SR * seconds))


def settle(player, blocks=40, frames=512):
    """Runs a few blocks so the gain smoothing settles."""
    out = None
    for _ in range(blocks):
        out = player._render(frames)
    return out


def fresh_api(tmp):
    import rehearsal_recorder.api as apimod

    apimod.RECORDINGS_ROOT = tmp / "Rec"
    apimod.CONFIG_PATH = tmp / "config.json"
    a = apimod.Api.__new__(apimod.Api)
    apimod.Api.__init__(a)
    return apimod, a


def main():
    tmp = Path(tempfile.mkdtemp())

    print("\n[1] Mixing")
    write_wav(tmp / "A.wav", 1000)
    write_wav(tmp / "B.wav", 2000)
    tracks = [
        {"name": "A", "file": str(tmp / "A.wav")},
        {"name": "B", "file": str(tmp / "B.wav")},
    ]
    p = TakePlayer(tracks)
    ok("duration read", abs(p.state()["duration"] - 2.0) < 0.001)

    silent = p._render(256)
    ok("silence while paused", silent.max() == 0 and silent.min() == 0)

    p.play()
    out = settle(p)
    ok("tracks sum together", abs(int(out[:, 0].mean()) - 3000) < 30)
    ok("mono goes to both channels", bool((out[:, 0] == out[:, 1]).all()))

    # What the meters beside the faders are made of. Measured in the mix,
    # after each track's own gain, so it is what came out rather than what is
    # on disk — the first version of this read the waveform peaks instead and
    # could only change about twice a second.
    levels = p.state()["levels"]
    ok("each track says how loud it came out",
       abs(levels["A"] - 1000 / 32768) < 0.005
       and abs(levels["B"] - 2000 / 32768) < 0.005)

    p.set_volume("B", 0.5)
    settle(p)
    ok("and says it after the fader, not before",
       abs(p.state()["levels"]["B"] - 1000 / 32768) < 0.005)
    p.set_volume("B", 1.0)

    p.set_muted("A", True)
    settle(p)
    ok("a muted track reads nothing at all", p.state()["levels"]["A"] == 0.0)
    p.set_muted("A", False)
    settle(p)

    p.pause()
    p._render(256)
    ok("and nothing reads anything once playback stops",
       all(v == 0.0 for v in p.state()["levels"].values()))

    # Back to the start: the checks below carry on with this same player, and
    # the settling above has already spent most of a two-second take.
    p.seek(0)
    p.play()
    settle(p)

    print("\n[2] Mute / solo / volume")
    p.set_muted("B", True)
    ok("mute removes a track", abs(int(settle(p)[:, 0].mean()) - 1000) < 30)
    p.set_muted("B", False)
    p.set_solo("B")
    ok("solo leaves one", abs(int(settle(p)[:, 0].mean()) - 2000) < 30)
    p.set_solo(None)
    p.set_volume("A", 0.5)
    p.set_volume("B", 0.0)
    ok("volume applies", abs(int(settle(p)[:, 0].mean()) - 500) < 30)
    p.set_volume("A", 1.0)
    p.set_volume("B", 1.0)

    print("\n[3] Seeking and end of take")
    p.seek(1.5)
    ok("seek is exact", abs(p.state()["position"] - 1.5) < 0.01)
    p.seek(1.99)
    p.play()
    for _ in range(60):
        p._render(1024)
    st = p.state()
    ok("stops at the end", st["playing"] is False)
    ok("and rewinds to the start", st["position"] == 0)

    print("\n[4] A–B loop")
    p.set_loop(0.5, 1.0)
    p.seek(0.5)
    p.play()
    positions = []
    for _ in range(400):
        p._render(1024)
        positions.append(p.state()["position"])
    wraps = sum(1 for i in range(1, len(positions)) if positions[i] < positions[i - 1])
    print(f"  range {min(positions):.3f}..{max(positions):.3f}, wraps: {wraps}")
    ok("stays inside the region", min(positions) >= 0.49 and max(positions) <= 1.01)
    ok("wraps around", wraps >= 3)
    print("\n[4b] The audio callback does not allocate")
    # Nothing here should ask the allocator for memory: the callback runs on
    # the audio thread, and malloc is the one place this app has ever been
    # seen to crash. Same buffer, block after block.
    p.set_loop(None, None)
    p.seek(0)
    p.play()
    first = p._render(512)
    second = p._render(512)
    ok("the mix buffer is reused", first.base is second.base)
    ok("a smaller block reuses it too", p._render(256).base is first.base)
    bigger = p._render(4096)
    ok("a bigger block grows it once", bigger.shape[0] == 4096)
    ok("and then keeps that one", p._render(4096).base is bigger.base)
    p.close()

    print("\n[4c] Opening and closing the output")
    from rehearsal_recorder.audio.devices import usable_output

    index, complaint = usable_output(0, SR)
    ok("a good device is used as asked", index == 0 and complaint is None)

    index, complaint = usable_output(1, SR)
    ok("an input-only device falls back", index is None)
    ok("and says why", complaint and "no stereo output" in complaint)

    index, complaint = usable_output(2, SR)
    ok("a device that refuses the rate falls back", index is None)
    ok("and names the rate", complaint and "48000 Hz" in complaint)

    index, complaint = usable_output(99, SR)
    ok("a stale index falls back", index is None)
    ok("and says the device is gone", complaint and "gone" in complaint)

    index, complaint = usable_output(None, SR)
    ok("no preference means no complaint", index is None and complaint is None)

    # Closing twice, and closing while another close is in flight, used to
    # raise "'NoneType' object has no attribute 'close'".
    p3 = TakePlayer(tracks)
    p3.open_output(0)
    before = _sd.OutputStream.closed
    p3.close_output()
    p3.close_output()
    ok("closing twice closes the stream once",
       _sd.OutputStream.closed == before + 1)
    ok("and the take is still loaded", len(p3.tracks) == 2)

    # Switching device keeps the take: close() would have thrown it away.
    p3.open_output(0)
    p3.seek(1.0)
    p3.open_output(2)  # falls back to the system output
    ok("switching the output keeps the take", len(p3.tracks) == 2)
    ok("and the position", abs(p3.state()["position"] - 1.0) < 0.01)
    p3.close()
    ok("a full close lets the audio go", p3.tracks == [])

    print("\n[5] Tracks of different length do not break the mix")
    write_wav(tmp / "short.wav", 500, seconds=0.5)
    p2 = TakePlayer([
        {"name": "long", "file": str(tmp / "A.wav")},
        {"name": "short", "file": str(tmp / "short.wav")},
    ])
    p2.play()
    p2.seek(1.0)  # the short track has already ended here
    out = settle(p2)
    ok("the long one plays, the short one is silent",
       abs(int(out[:, 0].mean()) - 1000) < 30)
    ok("duration follows the longest", abs(p2.state()["duration"] - 2.0) < 0.001)
    p2.close()

    print("\n[5b] Opening and closing from several threads at once")
    # The interface calls Python on its own threads. Two of them landing in
    # the player at the same time is what produced
    # "'NoneType' object has no attribute 'close'" in the console.
    import threading as _threading

    apimod_c, api_c = fresh_api(Path(tempfile.mkdtemp()))
    trouble = []

    def hammer():
        for _ in range(40):
            try:
                api_c.player_open(tracks)
                api_c.player_state()
                api_c.player_close()
            except Exception as e:  # noqa: BLE001 - the point is to catch any
                trouble.append(repr(e))

    threads = [_threading.Thread(target=hammer) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    ok("nothing blew up", not trouble)
    if trouble:
        print("   ", trouble[0])
    ok("no player left behind", api_c._player is None)
    ok("every stream opened was closed",
       _sd.OutputStream.opened == _sd.OutputStream.closed)

    print("\n[5c] The polling route on the local server")
    # The meters ask fourteen times a second. Over the pywebview bridge every
    # one of those starts an OS thread; over http the webview handles it
    # itself. This is that route.
    import urllib.error
    import urllib.request

    apimod_s, api_s = fresh_api(Path(tempfile.mkdtemp()))
    base = api_s.ui_url

    def get(path):
        with urllib.request.urlopen(base + path, timeout=5) as r:
            return r.status, json.loads(r.read().decode())

    status, body = get("api/session_state")
    ok("session state is served", status == 200 and body == {"active": False})
    status, body = get("api/player_state")
    ok("player state is served", status == 200 and body.get("open") is False)
    status, body = get("api/get_levels")
    ok("levels are served", status == 200 and body == {})
    status, body = get("api/recording_health")
    ok("recording health is served",
       status == 200 and body.get("recording") is False)

    # Everything that acts on the world stays on the bridge, where it can be
    # ordered — a GET must never be able to delete a rehearsal.
    blocked = []
    for name in ("delete_rehearsal", "finish_rehearsal", "stop_take",
                 "player_close", "set_recordings_dir"):
        try:
            urllib.request.urlopen(base + "api/" + name, timeout=5)
        except urllib.error.HTTPError as e:
            blocked.append(e.code)
    ok("calls that change things are not reachable over http",
       blocked == [404] * 5)

    print("\n[5d] 24-bit all the way through")
    deep = tmp / "deep"
    write_wav(deep / "A.wav", 1000, seconds=1.0, depth=24)
    write_wav(deep / "B.wav", 2000, seconds=1.0, depth=24)
    deep_tracks = [
        {"name": "A", "file": str(deep / "A.wav")},
        {"name": "B", "file": str(deep / "B.wav")},
    ]
    p24 = TakePlayer(deep_tracks)
    ok("a 24-bit take opens", abs(p24.state()["duration"] - 1.0) < 0.01)
    p24.play()
    out24 = settle(p24)
    ok("and mixes to the same numbers as 16-bit",
       abs(int(out24[:, 0].mean()) - 3000) < 30)
    p24.set_muted("B", True)
    ok("mute still works", abs(int(settle(p24)[:, 0].mean()) - 1000) < 30)
    p24.close()

    # A take where the two depths are mixed — possible after changing the
    # setting between rehearsals and sharing takes around.
    write_wav(deep / "C.wav", 1000, seconds=1.0, depth=16)
    mixed = TakePlayer([
        {"name": "deep", "file": str(deep / "A.wav")},
        {"name": "shallow", "file": str(deep / "C.wav")},
    ])
    mixed.play()
    ok("16- and 24-bit tracks sum correctly in one take",
       abs(int(settle(mixed)[:, 0].mean()) - 2000) < 30)
    mixed.close()

    from rehearsal_recorder.audio.waveform import wav_peaks

    peaks24, frames24, rate24 = wav_peaks(deep / "B.wav", buckets=8)
    ok("the waveform reads 24-bit", frames24 == SR and rate24 == SR)
    ok("and scales it the same as 16-bit",
       abs(peaks24[0] - 2000 / 32768) < 0.002)

    from rehearsal_recorder.audio.mixdown import mixdown as _md

    res24 = _md(deep_tracks, deep / "mix.wav")
    ok("the mix reads 24-bit sources", res24["ok"])
    with wave.open(str(deep / "mix.wav")) as w:
        ok("and is written 16-bit, for sending to people", w.getsampwidth() == 2)
        first = struct.unpack("<h", w.readframes(1)[:2])[0]
    ok("with the right level", abs(first - 3000) < 30)

    print("\n[5e] Recording at 24 bits")
    from rehearsal_recorder.audio.capture import AudioRecorder as _Recorder, raw_to_wav

    rec24 = _Recorder(0, SR, [{"name": "Gtr", "channel": 1}],
                      tmp / "rec24", bit_depth=24)
    rec24._raw_files = {"Gtr": open(tmp / "rec24" / "Gtr.raw", "wb")}
    block32 = np.zeros((256, 1), dtype=np.int32)
    block32[:, 0] = 1000 * 256 * 256  # a mid-level sample at 24-bit scale
    rec24._callback(block32, 256, None, None)
    rec24._raw_files["Gtr"].close()
    raw_size = (tmp / "rec24" / "Gtr.raw").stat().st_size
    ok("three bytes per sample on disk", raw_size == 256 * 3)
    ok("the meter reads the level right",
       abs(rec24.get_levels()["Gtr"] - (1000 * 256 * 256) / 2 ** 31) < 0.001)

    raw_to_wav(tmp / "rec24" / "Gtr.raw", tmp / "rec24" / "Gtr.wav", SR, 24)
    with wave.open(str(tmp / "rec24" / "Gtr.wav")) as w:
        ok("and the wav says 24-bit", w.getsampwidth() == 3 and w.getnframes() == 256)

    _, api_f = fresh_api(Path(tempfile.mkdtemp()))
    formats = api_f.recording_formats(0, 2)["formats"]
    ok("the card is asked what it can do", "48000" in formats)
    ok("96 kHz is offered only where it works", formats.get("96000") == [24])
    ok("48 kHz offers both depths", formats.get("48000") == [16, 24])

    est16 = api_f.disk_estimate(8, SR, 16)
    est24 = api_f.disk_estimate(8, SR, 24)
    ok("24 bits costs half again as much disk",
       abs(est24["bytes_per_sec"] / est16["bytes_per_sec"] - 1.5) < 0.01)

    print("\n[6] Disk space")
    apimod, a = fresh_api(tmp)
    est = a.disk_estimate(8, SR)
    print(f"  8 tracks: {est['bytes_per_sec'] / 1e6:.2f} MB/s, room for {est['minutes'] / 60:.1f} h")
    ok("estimate computed", est["ok"] and est["minutes"] > 0)
    ok("eight tracks is ~0.77 MB/s", abs(est["bytes_per_sec"] - 8 * SR * 2) < 1)
    ok("one track leaves more room", a.disk_estimate(1, SR)["minutes"] > est["minutes"] * 7)

    print("\n[7] Interface disconnect")
    from rehearsal_recorder.audio.capture import AudioRecorder

    rec = AudioRecorder.__new__(AudioRecorder)
    rec.error = None
    rec._stopping = False
    rec._finished()  # as if the stream stopped by itself
    ok("an unrequested stop is flagged as an error", rec.error is not None)

    rec2 = AudioRecorder.__new__(AudioRecorder)
    rec2.error = None
    rec2._stopping = True
    rec2._finished()  # this one we asked for
    ok("our own stop is not an error", rec2.error is None)

    print("\n[7b] Stopping twice")
    # The health check can stop a take at the same moment somebody presses
    # Stop. The second stop used to fsync closed files and rebuild .wav files
    # from .raw sources it had already deleted.
    take_dir = tmp / "twice"
    rec3 = AudioRecorder(0, SR, [{"name": "Gtr", "channel": 1}], take_dir)
    rec3._raw_files = {"Gtr": open(take_dir / "Gtr.raw", "wb")}
    rec3._raw_files["Gtr"].write(struct.pack("<h", 900) * SR)
    rec3._frames_written = SR

    class _FakeStream:
        def stop(self):
            pass

        def close(self):
            pass

    rec3._stream = _FakeStream()
    first = rec3.stop()
    ok("the first stop produces the take", abs(first["duration_sec"] - 1.0) < 0.01)
    ok("and a real wav", Path(first["tracks"][0]["file"]).exists())
    second = rec3.stop()
    ok("the second stop is harmless", second == first)
    ok("and the file is still there", Path(first["tracks"][0]["file"]).exists())

    print("\n[7c] Levels are measured without allocating")
    monitor_tracks = [{"name": "Gtr", "channel": 1}, {"name": "Voc", "channel": 2}]
    rec4 = AudioRecorder(0, SR, monitor_tracks, tmp / "levels")
    rec4._raw_files = {
        t["name"]: open(tmp / "levels" / f"{t['name']}.raw", "wb")
        for t in monitor_tracks
    }

    block = np.zeros((256, 2), dtype=np.int16)
    block[:, 0] = -32000  # a loud negative peak must still read as loud
    block[:, 1] = 100
    rec4._callback(block, 256, None, None)
    levels = rec4.get_levels()
    ok("a negative peak counts", abs(levels["Gtr"] - 32000 / 32768) < 0.001)
    ok("a quiet track reads quiet", levels["Voc"] < 0.01)
    for f in rec4._raw_files.values():
        f.close()
    ok("and they are the samples we sent",
       (tmp / "levels" / "Gtr.raw").read_bytes()[:2] == struct.pack("<h", -32000))

    print("\n[8] Take naming carries over")
    a.start_rehearsal("Jam", 0, SR, [{"name": "Gtr", "channel": 1}])
    folder = Path(a._session["folder"])
    ok("first take is numbered", a.suggest_take_name() == "Take 1")

    def keep(number, name):
        a._session["take_counter"] = number
        d = folder / "_drafts" / f"take {number}"
        write_wav(d / "Gtr.wav", 100, seconds=1.0)
        return a.keep_take(number, str(d), name, 1.0,
                           [{"name": "Gtr", "file": str(d / "Gtr.wav")}])

    # While take 1 is recording the counter already stands at 1, so the name
    # offered for it must be "Take 1" and not the next one's "Take 2".
    a._session["take_counter"] = 1
    ok("the take being reviewed keeps its own number",
       a.suggest_take_name(1) == "Take 1")
    ok("the next one is still the next one", a.suggest_take_name() == "Take 2")
    a._session["take_counter"] = 0

    keep(1, "Polyn")
    ok("next inherits the name", a.suggest_take_name() == "Polyn 2")
    keep(2, a.suggest_take_name())
    ok("the counter keeps climbing", a.suggest_take_name() == "Polyn 3")

    print("\n[8b] A take can arrive with marks already on it")
    # Marks made on the review screen, before the take had a folder, travel
    # with keep_take rather than being written as they are placed.
    d = folder / "_drafts" / "take 9"
    write_wav(d / "Gtr.wav", 100, seconds=1.0)
    a._session["take_counter"] = 9
    with_marks = a.keep_take(
        9, str(d), "Marked on review", 1.0,
        [{"name": "Gtr", "file": str(d / "Gtr.wav")}],
        [{"at": 0.5, "note": "the good bit", "kind": "good"},
         {"at": 2.25, "note": "", "kind": "note"}],
    )
    ok("saved with its marks", with_marks["ok"])
    marks = with_marks["take"]["markers"]
    ok("both are there, in order", [m["at"] for m in marks] == [0.5, 2.25])
    ok("with their notes", marks[0]["note"] == "the good bit")
    ok("and their kinds", marks[0]["kind"] == "good" and marks[1]["kind"] == "note")
    ok("and they survive a read from disk",
       [m["at"] for m in a.get_rehearsal(str(folder))["takes"][-1]["markers"]]
       == [0.5, 2.25])

    # A take saved the ordinary way still starts clean.
    keep(10, "Plain")
    ok("a take saved without marks has none",
       a.get_rehearsal(str(folder))["takes"][-1]["markers"] == [])

    print("\n[9] Renaming")
    r = a.rename_take(str(folder), 1, "Polyn (best)")
    ok("take renamed", r["ok"])
    ok("its file still exists", Path(r["take"]["tracks"][0]["file"]).exists())
    ok("the folder on disk was renamed too",
       any(p.name.startswith("01 - Polyn (best)") for p in folder.iterdir()))

    rr = a.rename_rehearsal(str(folder), "Tuesday jam")
    new_folder = Path(rr["folder"])
    ok("rehearsal renamed", rr["ok"] and new_folder.exists() and not folder.exists())
    detail = a.get_rehearsal(str(new_folder))
    ok("stored paths still resolve",
       all(Path(t["file"]).exists() for tk in detail["takes"] for t in tk["tracks"]))

    # Renaming an old rehearsal from history must leave the live one alone.
    a.finish_rehearsal()
    a.start_rehearsal("Live one", 0, SR, [{"name": "Gtr", "channel": 1}])
    live = Path(a._session["folder"])
    moved = a.rename_rehearsal(str(new_folder), "Renamed from history")
    ok("the running rehearsal is untouched", Path(a._session["folder"]) == live)
    ok("and keeps its own name", a.session_state()["name"] == "Live one")
    a.finish_rehearsal()
    new_folder = Path(moved["folder"])

    print("\n[10] Listening markers")
    a.add_take_marker(str(new_folder), 1, 12.5, "bridge falls apart", "issue")
    a.add_take_marker(str(new_folder), 1, 3.25)
    markers = a.get_rehearsal(str(new_folder))["takes"][0]["markers"]
    ok("markers stored in order", [m["at"] for m in markers] == [3.25, 12.5])
    ok("the note is kept", markers[1]["note"] == "bridge falls apart")
    ok("the kind is kept", markers[1]["kind"] == "issue")
    ok("a bare marker gets the plain kind",
       markers[0]["kind"] == "note" and markers[0]["note"] == "")

    a.update_take_marker(str(new_folder), 1, 3.25, "nice ending", "good")
    edited = a.get_rehearsal(str(new_folder))["takes"][0]["markers"][0]
    ok("editing a marker keeps its position", edited["at"] == 3.25)
    ok("and applies the new note and kind",
       edited["note"] == "nice ending" and edited["kind"] == "good")

    a.add_take_marker(str(new_folder), 1, 3.25, "changed my mind", "redo")
    same_spot = a.get_rehearsal(str(new_folder))["takes"][0]["markers"]
    ok("marking the same spot replaces, not duplicates", len(same_spot) == 2)
    ok("with the newer note", same_spot[0]["note"] == "changed my mind")

    a.remove_take_marker(str(new_folder), 1, 12.5)
    ok("marker removed",
       [m["at"] for m in a.get_rehearsal(str(new_folder))["takes"][0]["markers"]]
       == [3.25])

    # Rehearsals recorded before markers had notes stored plain numbers.
    legacy = a._read_meta(str(new_folder))
    legacy["takes"][0]["markers"] = [7.5, 1.25]
    a._write_meta(new_folder, legacy)
    upgraded = a.get_rehearsal(str(new_folder))["takes"][0]["markers"]
    ok("old numeric markers still load",
       [m["at"] for m in upgraded] == [1.25, 7.5])
    ok("and come back as proper markers",
       all(m["kind"] == "note" and m["note"] == "" for m in upgraded))
    a.remove_take_marker(str(new_folder), 1, 7.5)
    a.remove_take_marker(str(new_folder), 1, 1.25)

    print("\n[11] Sharing to the cloud")
    cloud = tmp / "Drive" / "Band"
    a.set_cloud_dir(str(cloud))
    ok("the cloud folder is remembered",
       a.get_settings()["cloud_dir"] == str(cloud))

    detail = a.get_rehearsal(str(new_folder))
    first = detail["takes"][0]
    shared = a.share_take(str(new_folder), first["take_number"], "both")
    ok("shared", shared["ok"])
    mix = Path(shared["cloud"]["mix"])
    ok("the mix is in the cloud folder", mix.exists() and _is_inside(mix, cloud))
    with wave.open(str(mix)) as w:
        ok("the mix is stereo", w.getnchannels() == 2)
        ok("and as long as the take", abs(w.getnframes() - SR) < 2)
    originals = Path(shared["cloud"]["tracks"])
    ok("the originals are there too",
       originals.is_dir() and len(list(originals.glob("*.wav"))) == 1)
    ok("the take remembers what was shared",
       a.get_rehearsal(str(new_folder))["takes"][0]["cloud"].get("mix") == str(mix))

    # Sharing again must replace, not pile up copies.
    again = a.share_take(str(new_folder), first["take_number"], "mix")
    ok("re-sharing replaces", again["ok"] and not originals.exists())
    ok("one mix, not two", len(list(mix.parent.glob("*.wav"))) == 1)

    out = a.unshare_take(str(new_folder), first["take_number"])
    ok("unshared", out["ok"] and not mix.exists())
    ok("the original take is untouched",
       Path(a.get_rehearsal(str(new_folder))["takes"][0]["tracks"][0]["file"]).exists())
    ok("and it no longer claims to be shared",
       not a.get_rehearsal(str(new_folder))["takes"][0]["cloud"])

    print("\n[11b] Cloud copies can be compressed")
    from rehearsal_recorder.audio.encode import available as _encoder

    a.set_cloud_format("flac")
    ok("the format is remembered",
       a.get_settings()["cloud_format"] == "flac")
    ok("and the interface is told what can be offered",
       [f["id"] for f in a.get_settings()["cloud_formats"]]
       == ["wav", "flac", "mp3"])
    ok("something bogus falls back to plain wav",
       a.set_cloud_format("mp3-please")["cloud_format"] == "wav")

    a.set_cloud_format("flac")
    packed = a.share_take(str(new_folder), first["take_number"], "both")
    ok("shared", packed["ok"])
    mix_path = Path(packed["cloud"]["mix"])

    if _encoder() is None:
        # No encoder here: the copy must still exist, as a wav, and say so.
        ok("without an encoder the copy stays a wav", mix_path.suffix == ".wav")
        ok("and it says why", bool(packed.get("note")))
    else:
        ok("the mix is compressed", mix_path.suffix == ".flac")
        ok("and the wav it came from is gone",
           not mix_path.with_suffix(".wav").exists())
        ok("the format is recorded on the take",
           packed["cloud"]["mix_format"] == "flac")
        originals = list(Path(packed["cloud"]["tracks"]).iterdir())
        ok("the tracks are compressed too",
           originals and all(f.suffix == ".flac" for f in originals))
        ok("nothing was said about failing", not packed.get("note"))

        # Lossless has to mean lossless, or the label is a lie. No external
        # tool needed to check it any more either.
        import soundfile as _sf

        source_wav = Path(first["tracks"][0]["file"])
        before = _sf.read(str(source_wav), dtype="int32")[0]
        after = _sf.read(str(originals[0]), dtype="int32")[0]
        ok("FLAC decodes back to the identical samples",
           (before == after).all() and len(before) == len(after))
        ok("and keeps the depth it was given",
           _sf.info(str(source_wav)).subtype == _sf.info(str(originals[0])).subtype)

        # And the same for a 24-bit take, which is the new default: the depth
        # has to survive compression, not quietly drop to 16.
        deep_take = folder / "24 - Deep take"
        deep_take.mkdir(parents=True, exist_ok=True)
        write_wav(deep_take / "Gtr.wav", 1500, seconds=1.0, depth=24)
        meta24 = a._read_meta(str(new_folder))
        meta24["takes"].append({
            "take_number": 24, "name": "Deep take", "duration_sec": 1.0,
            "tracks": [{"name": "Gtr", "file": str(deep_take / "Gtr.wav")}],
            "markers": [],
        })
        a._write_meta(new_folder, meta24)
        deep_shared = a.share_take(str(new_folder), 24, "tracks")
        deep_files = list(Path(deep_shared["cloud"]["tracks"]).iterdir())
        ok("a 24-bit take compresses too",
           deep_files and deep_files[0].suffix == ".flac")
        ok("and stays 24-bit inside the flac",
           deep_files and _sf.info(str(deep_files[0])).subtype == "PCM_24")
        ok("with the samples unchanged",
           (_sf.read(str(deep_take / "Gtr.wav"), dtype="int32")[0]
            == _sf.read(str(deep_files[0]), dtype="int32")[0]).all())
        a.unshare_take(str(new_folder), 24)

    # The originals on disk must not have been touched by any of this.
    ok("the recording itself is untouched",
       all(Path(t["file"]).exists()
           for t in a.get_rehearsal(str(new_folder))["takes"][0]["tracks"]))

    a.unshare_take(str(new_folder), first["take_number"])
    ok("and the compressed copies are removable too", not mix_path.exists())
    a.set_cloud_format("wav")

    print("\n[11c] A cloud copy remembers what it was made from")
    from rehearsal_recorder import cloud as cloudmod

    a.set_cloud_format("wav")
    detail = a.get_rehearsal(str(new_folder))
    take = detail["takes"][0]
    a.share_take(str(new_folder), take["take_number"], "mix")
    take = a.get_rehearsal(str(new_folder))["takes"][0]
    volumes = a.get_settings()["volumes"]
    where = a._cloud_target(new_folder)
    ok("the copy records what it was made from",
       take["cloud"]["source"]["what"] == "mix"
       and take["cloud"]["source"]["name"] == take["name"])
    ok("and where it went",
       take["cloud"]["source"].get("dir") == str(where))
    ok("and it counts as current",
       cloudmod.is_current(take, "mix", volumes, "wav", where))
    ok("asking for more than was copied is not current",
       not cloudmod.is_current(take, "both", volumes, "wav", where))
    ok("and neither is another cloud folder",
       not cloudmod.is_current(take, "mix", volumes, "wav", tmp / "Elsewhere"))

    renamed = dict(take, name="Something else")
    ok("a renamed take is not current",
       not cloudmod.is_current(renamed, "mix", volumes, "wav", where))
    # A crop changes nothing else in this record — same name, same format,
    # same folder, same balance — and share_take reads the take's files
    # outside the metadata lock, so a copy that started before a crop can
    # write its record after it. Without the length in there, that record
    # matches the shorter take and the re-publish the crop asked for skips it,
    # leaving the uncropped copy in the cloud folder reported as up to date.
    shorter = dict(take, duration_sec=round(take["duration_sec"] / 2, 2))
    ok("and neither is a take that has been cropped since",
       not cloudmod.is_current(shorter, "mix", volumes, "wav", where))
    ok("a take that was never copied is not current",
       not cloudmod.is_current({"name": "x", "tracks": []}, "mix", volumes,
                               "wav", where))

    print("\n[11d] The publishing queue")
    done, recording = [], {"now": False}
    q = cloudmod.PublishQueue(
        step=lambda folder, n: done.append((folder, n)),
        paused=lambda: recording["now"],
    )
    q.enqueue("/rec/One", 1)
    q.enqueue("/rec/One", 2)
    q.enqueue("/rec/One", 1)
    ok("the same take is not queued twice",
       q.states("/rec/One") == {1: "queued", 2: "queued"})
    ok("another rehearsal's queue is its own", q.states("/rec/Two") == {})

    recording["now"] = True
    ok("nothing runs while a take is being recorded", q.run_next() is False)
    ok("and the job is still waiting", q.states("/rec/One") == {1: "queued", 2: "queued"})

    recording["now"] = False
    ok("a job runs once recording stops", q.run_next() is True)
    ok("in the order they arrived", done == [("/rec/One", 1)])
    ok("the second one follows", q.run_next() is True and done[-1] == ("/rec/One", 2))
    ok("and then there is nothing to do", q.run_next() is False)

    # A take modified during publishing must be re-published with the new state,
    # so the cloud copy does not stay stale. A step that re-enqueues its own job
    # models the app calling enqueue() after the take changed mid-publish.
    # A name of its own: the queue above captured `recording` by name, and
    # rebinding it here would quietly change what that one is paused by.
    reruns, recording2 = [], {"now": False}
    q2 = cloudmod.PublishQueue(
        step=lambda folder, n: (
            reruns.append((folder, n)),
            q2.enqueue(folder, n) if len(reruns) == 1 else None
        ),
        paused=lambda: recording2["now"],
    )
    q2.enqueue("/rec/X", 5)
    ok("a job re-enqueued from its own step is queued again",
       q2.run_next() is True and reruns == [("/rec/X", 5)] and
       q2.states("/rec/X") == {5: "queued"})
    ok("and runs a second time", q2.run_next() is True and
       len(reruns) == 2 and reruns[-1] == ("/rec/X", 5))
    ok("then there is nothing to do", q2.run_next() is False)

    print("\n[11e] Publishing on its own is a setting")
    ok("off until it is asked for", a.get_settings()["auto_publish"] is False)
    ok("and the mix is what it would send",
       a.get_settings()["auto_publish_what"] == "mix")

    res = a.set_auto_publish(True, "both")
    ok("it can be turned on", res["ok"] and res["auto_publish"] is True)
    ok("with what to send", a.get_settings()["auto_publish_what"] == "both")
    ok("nonsense is refused", a.set_auto_publish(True, "everything")["ok"] is False)
    ok("and the refusal changed nothing",
       a.get_settings()["auto_publish_what"] == "both")
    a.set_auto_publish(False)
    ok("turning it off leaves the choice alone",
       a.get_settings()["auto_publish"] is False
       and a.get_settings()["auto_publish_what"] == "both")

    print("\n[12] The mix does not clip")
    loud = tmp / "loud"
    write_wav(loud / "one.wav", 20000, seconds=0.5)
    write_wav(loud / "two.wav", 20000, seconds=0.5)
    from rehearsal_recorder.audio.mixdown import mixdown as _mixdown

    res = _mixdown(
        [{"name": "one", "file": str(loud / "one.wav")},
         {"name": "two", "file": str(loud / "two.wav")}],
        loud / "mix.wav",
    )
    ok("mixed", res["ok"])
    ok("it had to pull the level down", res["gain"] < 1.0)
    with wave.open(str(loud / "mix.wav")) as w:
        peak = max(abs(v) for v in struct.unpack(
            f"<{w.getnframes() * 2}h", w.readframes(w.getnframes())))
    ok("and nothing is slammed against full scale", peak <= 32767 * 0.98)

    quiet = _mixdown(
        [{"name": "one", "file": str(loud / "one.wav")}], loud / "quiet.wav"
    )
    ok("a mix that fits is left alone", quiet["gain"] == 1.0)

    saved = _mixdown(
        [{"name": "one", "file": str(loud / "one.wav")},
         {"name": "two", "file": str(loud / "two.wav")}],
        loud / "balanced.wav", {"two": 0.0},
    )
    with wave.open(str(loud / "balanced.wav")) as w:
        first_sample = struct.unpack("<h", w.readframes(1)[:2])[0]
    ok("the saved balance is applied", saved["ok"] and abs(first_sample - 20000) < 30)

    print("\n[13] A crashed take survives and can be recovered")
    tmp2 = Path(tempfile.mkdtemp())
    apimod2, _ = fresh_api(tmp2)
    crashed = tmp2 / "Rec" / "Jam - 2026-09-01 20-00"
    (crashed / "_drafts" / "take 1").mkdir(parents=True)
    for name in ("Gtr", "Voc"):
        # Mid-take there are only .raw files — no .wav exists yet. This is
        # exactly the case the empty-rehearsal cleanup must not touch.
        (crashed / "_drafts" / "take 1" / f"{name}.raw").write_bytes(
            struct.pack("<h", 1234) * SR
        )
    (crashed / "session.json").write_text(json.dumps({
        "name": "Jam", "created_at": "2026-09-01T20:00:00", "samplerate": SR,
        "tracks": [{"name": "Gtr", "channel": 1}, {"name": "Voc", "channel": 2}],
        "takes": [],
    }))

    b = apimod2.Api.__new__(apimod2.Api)
    apimod2.Api.__init__(b)  # the constructor runs the cleanup
    ok("cleanup does not delete a rehearsal holding a draft", crashed.exists())

    drafts = b.list_drafts()
    ok("the draft is found", len(drafts) == 1)
    ok("its tracks are listed", drafts and drafts[0]["tracks"] == ["Gtr", "Voc"])
    ok("its length is known", drafts and abs(drafts[0]["duration_sec"] - 1.0) < 0.01)

    rec3 = b.recover_draft(drafts[0]["dir"], "Recovered jam")
    ok("recovered", rec3["ok"])
    for t in rec3["take"]["tracks"]:
        path = Path(t["file"])
        ok(f"{path.name} is a real wav now", path.exists() and path.suffix == ".wav")
        with wave.open(str(path)) as w:
            ok(f"{path.name} has the right length", w.getnframes() == SR)
    ok("it shows up in history", b.list_rehearsals()[0]["take_count"] == 1)
    ok("no drafts left", b.list_drafts() == [])

    print("\n[13b] A crashed 24-bit take recovers as 24-bit")
    # The depth lives in session.json, because the raw bytes on disk do not
    # say how wide they are. Get that wrong and a rescued take is noise.
    tmp3 = Path(tempfile.mkdtemp())
    apimod3, _ = fresh_api(tmp3)
    deep_crash = tmp3 / "Rec" / "Deep - 2026-09-03 21-00"
    (deep_crash / "_drafts" / "take 1").mkdir(parents=True)
    sample = struct.pack("<i", 1234 * 256)[:3]
    (deep_crash / "_drafts" / "take 1" / "Gtr.raw").write_bytes(sample * SR)
    (deep_crash / "session.json").write_text(json.dumps({
        "name": "Deep", "created_at": "2026-09-03T21:00:00", "samplerate": SR,
        "bit_depth": 24,
        "tracks": [{"name": "Gtr", "channel": 1}], "takes": [],
    }))

    c = apimod3.Api.__new__(apimod3.Api)
    apimod3.Api.__init__(c)
    drafts24 = c.list_drafts()
    ok("the draft is found", len(drafts24) == 1)
    ok("its length is right for three-byte samples",
       drafts24 and abs(drafts24[0]["duration_sec"] - 1.0) < 0.01)

    rescued = c.recover_draft(drafts24[0]["dir"], "Rescued deep")
    ok("recovered", rescued["ok"])
    wav24 = Path(rescued["take"]["tracks"][0]["file"])
    with wave.open(str(wav24)) as w:
        ok("as a 24-bit wav", w.getsampwidth() == 3)
        ok("of the right length", w.getnframes() == SR)
    player24 = TakePlayer([{"name": "Gtr", "file": str(wav24)}])
    player24.play()
    ok("and it plays at the level it was recorded at",
       abs(int(settle(player24)[:, 0].mean()) - 1234) < 30)
    player24.close()

    print("\n[14] Empty rehearsals are cleaned up")
    stale = tmp2 / "Rec" / "Nothing - 2026-09-02 10-00"
    stale.mkdir(parents=True)
    (stale / "session.json").write_text(json.dumps({
        "name": "Nothing", "created_at": "2026-09-02T10:00:00",
        "samplerate": SR, "tracks": [], "takes": [],
    }))
    removed = b.cleanup_empty_rehearsals()["removed"]
    ok("the empty one is gone", removed == 1 and not stale.exists())

    print("\n[11f] A saved take goes on its own")
    solo = tmp / "Solo"
    write_wav(solo / "one.wav", 1200)
    a.set_cloud_dir(str(tmp / "Drive" / "Auto"))
    a.set_cloud_format("wav")
    a.set_auto_publish(True, "mix")
    a.start_rehearsal("Evening", None, SR, [{"name": "A", "channel": 1}], 16)
    kept = a.keep_take(1, str(solo), "Polyn", 2.0,
                       [{"name": "A", "file": str(solo / "one.wav")}], [])
    ok("the take was saved", kept["ok"])
    ok("and is waiting to be published",
       a.session_state()["cloud_queue"] == {1: "queued"})

    a._cloud_queue.run_next()
    folder = Path(a.session_state()["folder"])
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("the mix is in the cloud folder", Path(take["cloud"]["mix"]).exists())
    ok("the queue is empty afterwards", a.session_state()["cloud_queue"] == {})
    ok("and nothing failed", "cloud_error" not in take)

    # A second pass must not mix it all over again.
    a._enqueue_publish(folder, 1)
    before = Path(take["cloud"]["mix"]).stat().st_mtime_ns
    a._cloud_queue.run_next()
    after = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"]).stat().st_mtime_ns
    ok("an unchanged take is not copied twice", before == after)

    a.set_auto_publish(False)
    a._enqueue_publish(folder, 1)
    ok("with the setting off nothing is queued",
       a.session_state()["cloud_queue"] == {})
    a.set_auto_publish(True, "mix")
    # Turning it back on with a session in progress re-queues take 1 (already
    # current) — drain that before the next checks so it doesn't interfere.
    a._cloud_queue.run_next()

    # A gap the review caught: a sync folder can vanish mid-write, raising
    # instead of returning {"ok": False}. That must still land as a recorded,
    # retryable failure — not a silently stalled take.
    solo2 = tmp / "Solo2"
    write_wav(solo2 / "two.wav", 1300)
    real_share_take = a.share_take

    def boom(*args, **kwargs):
        raise OSError("sync folder went away")

    a.share_take = boom
    try:
        a.keep_take(2, str(solo2), "Boom", 2.0,
                    [{"name": "A", "file": str(solo2 / "two.wav")}], [])
        a._cloud_queue.run_next()
    finally:
        a.share_take = real_share_take
    broken = a.get_rehearsal(str(folder))["takes"][1]
    ok("an exception from the publish is recorded",
       "sync folder went away" in (broken.get("cloud_error") or ""))

    solo3 = tmp / "Solo3"
    write_wav(solo3 / "three.wav", 1400)
    a.keep_take(3, str(solo3), "After", 2.0,
                [{"name": "A", "file": str(solo3 / "three.wav")}], [])
    ok("and a later save re-queues the failed take",
       a.session_state()["cloud_queue"].get(2) == "queued")

    # Drain the backlog (take 3, and the retried take 2) before the next
    # check, which cares only about what happens while recording.
    while a._cloud_queue.run_next():
        pass

    # Recording wins: the worker must never compete with the audio callback.
    solo4 = tmp / "Solo4"
    write_wav(solo4 / "four.wav", 1500)
    a.keep_take(4, str(solo4), "Later", 2.0,
                [{"name": "A", "file": str(solo4 / "four.wav")}], [])
    a._recorder = object()  # sentinel: stands in for an active recorder
    ok("nothing runs while recording", a._cloud_queue.run_next() is False)
    take4 = a.get_rehearsal(str(folder))["takes"][3]
    ok("and the take was not copied", "cloud" not in take4)
    a._recorder = None
    ok("but once recording stops it publishes", a._cloud_queue.run_next() is True)
    take4 = a.get_rehearsal(str(folder))["takes"][3]
    ok("and now it is in the cloud folder", Path(take4["cloud"]["mix"]).exists())

    # A rename that lands while the mix is being written must survive it, and
    # the copy must not claim to be current for a name it was not written
    # under. `mixdown` is where the slow part happens, so that is where a
    # real rename would land.
    prior_publish = a.get_settings()
    a.set_auto_publish(False)
    write_wav(solo / "three.wav", 700)
    a.keep_take(9, str(solo), "Before", 2.0,
                [{"name": "A", "file": str(solo / "three.wav")}], [])
    folder9 = Path(a.session_state()["folder"])
    real_mixdown = apimod.mixdown

    def rename_midway(*args, **kwargs):
        out = real_mixdown(*args, **kwargs)
        a.rename_take(str(folder9), 9, "After")
        return out

    apimod.mixdown = rename_midway
    try:
        a.share_take(str(folder9), 9, "mix")
    finally:
        apimod.mixdown = real_mixdown
        # The later [11g]/[11h] sections assume auto-publish is on, same as
        # every other check in this section left it — don't leave it off
        # behind us just because this one check needed it off.
        a.set_auto_publish(prior_publish["auto_publish"], prior_publish["auto_publish_what"])

    take9 = next(t for t in a.get_rehearsal(str(folder9))["takes"]
                 if t["take_number"] == 9)
    ok("a rename during the mix is not reverted by it", take9["name"] == "After")
    ok("and the copy still records the name it was written under",
       take9["cloud"]["source"]["name"] == "Before")
    ok("so it does not claim to be current",
       not cloudmod.is_current(take9, "mix", a.get_settings()["volumes"], "wav",
                               a._cloud_target(folder9)))

    # The balance is the other half of the same fingerprint, and a fader can
    # move mid-publish exactly as a rename can land mid-publish. What is
    # recorded has to be the balance the mix was actually rendered with — a
    # fingerprint describing a balance the file was never made from would
    # make the take report itself current and keep the wrong mix in the
    # cloud folder for good.
    a.save_mix({"A": 0.9})

    def fade_midway(*args, **kwargs):
        out = real_mixdown(*args, **kwargs)
        a.save_mix({"A": 0.2})
        return out

    apimod.mixdown = fade_midway
    try:
        a.share_take(str(folder9), 9, "mix")
    finally:
        apimod.mixdown = real_mixdown

    take9 = next(t for t in a.get_rehearsal(str(folder9))["takes"]
                 if t["take_number"] == 9)
    ok("the copy records the balance it was rendered with",
       take9["cloud"]["source"]["volumes"] == {"A": 0.9})
    ok("so a fader moved during the mix leaves it not current",
       not cloudmod.is_current(take9, "mix", a.get_settings()["volumes"], "wav",
                               a._cloud_target(folder9)))

    # A listing can run while the worker is writing. Whatever a reader sees
    # at the worst moment must be a whole document, so the file is swapped
    # into place rather than truncated and refilled.
    seen = {}
    real_replace = apimod.os.replace

    def watch_replace(src, dst):
        seen["during"] = Path(dst).read_text()
        return real_replace(src, dst)

    meta_before = a._read_meta(folder9)
    apimod.os.replace = watch_replace
    try:
        a.rename_take(str(folder9), 9, "Renamed once more")
    finally:
        apimod.os.replace = real_replace

    ok("the meta is swapped into place, never half-written",
       json.loads(seen["during"])["takes"] == meta_before["takes"])
    ok("and the new name is there once the swap is done",
       a._read_meta(folder9)["takes"][-1]["name"] == "Renamed once more")
    ok("no leftover temporary files",
       not list(Path(folder9).glob("session.json.*")))

    # Restoring auto-publish above re-queued every take of the still-open
    # session (that is what turning it on does) — drain that before handing
    # off to the next section, which should start from an empty queue.
    while a._cloud_queue.run_next():
        pass

    print("\n[11g] A rename and a new balance send it again")
    folder = Path(a.session_state()["folder"])
    old_mix = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"])
    a.rename_take(str(folder), 1, "Polyn again")
    ok("renaming queues the take again",
       a.session_state()["cloud_queue"] == {1: "queued"})
    a._cloud_queue.run_next()
    new_mix = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"])
    ok("the copy is named after the new name", "Polyn again" in new_mix.name)
    ok("and the copy under the old name is gone", not old_mix.exists())

    a.save_mix({"A": 0.5})
    queued = a.session_state()["cloud_queue"]
    ok("a new balance queues the rehearsal's takes",
       queued == {t["take_number"]: "queued" for t in a.session_state()["takes"]}
       and len(queued) > 1)
    a._cloud_queue.run_next()
    ok("and the take is current again",
       cloudmod.is_current(a.get_rehearsal(str(folder))["takes"][0], "mix",
                           a.get_settings()["volumes"], "wav",
                           a._cloud_target(folder)))

    print("\n[11h] When the cloud folder is not there")

    # [11g] leaves takes queued behind it. Clear them while there is still a
    # cloud folder to publish into, so what follows is about this take alone.
    while a._cloud_queue.run_next():
        pass

    folder = Path(a.session_state()["folder"])
    a._config.pop("cloud_dir", None)
    a.rename_take(str(folder), 1, "Polyn third")
    a._cloud_queue.run_next()
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("the take says why it is not in the cloud",
       "cloud folder" in (take.get("cloud_error") or "").lower())
    ok("and the recording itself is untouched",
       Path(take["tracks"][0]["file"]).exists())

    # Saving the next take is what sweeps up what the folder's absence broke.
    a.set_cloud_dir(str(tmp / "Drive" / "Auto"))
    write_wav(solo / "ten.wav", 900)
    a.keep_take(10, str(solo), "Later", 2.0,
                [{"name": "A", "file": str(solo / "ten.wav")}], [])
    ok("the failed take is queued again alongside the new one",
       a.session_state()["cloud_queue"].get(1) == "queued")
    a._cloud_queue.run_next()
    a._cloud_queue.run_next()
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("a later run puts it there after all", Path(take["cloud"]["mix"]).exists())
    ok("and the complaint is gone", "cloud_error" not in take)

    print("\n[11i] Where a copy went is part of what it was made from")

    # [11h] left the rest of its backlog queued. Clear it, so what follows is
    # about this take alone.
    while a._cloud_queue.run_next():
        pass

    folder = Path(a.session_state()["folder"])
    balance = a.get_settings()["volumes"]
    moved = tmp / "Drive" / "Moved"
    a.set_cloud_dir(str(moved))
    ok("pointing at another cloud folder queues the rehearsal's takes",
       a.session_state()["cloud_queue"].get(1) == "queued")
    ok("and a take copied to the old one no longer counts as current",
       not cloudmod.is_current(a.get_rehearsal(str(folder))["takes"][0], "mix",
                               balance, "wav", a._cloud_target(folder)))
    while a._cloud_queue.run_next():
        pass
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("running the queue puts the copy in the new folder",
       _is_inside(Path(take["cloud"]["mix"]), moved)
       and Path(take["cloud"]["mix"]).exists())

    # A sync client that logs out and re-creates its folder empty leaves the
    # record pointing at nothing at all.
    Path(take["cloud"]["mix"]).unlink()
    ok("a copy deleted behind the app's back is not current",
       not cloudmod.is_current(take, "mix", balance, "wav",
                               a._cloud_target(folder)))
    a._enqueue_publish(folder, 1)
    a._cloud_queue.run_next()
    ok("so it is sent again",
       Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"]).exists())

    # The copies live in a folder named after the rehearsal, so renaming it
    # leaves them under a name that is no longer anybody's.
    folder = Path(a.rename_rehearsal(str(folder), "Late evening")["folder"])
    ok("renaming the rehearsal queues its takes",
       a.session_state()["cloud_queue"].get(1) == "queued")
    while a._cloud_queue.run_next():
        pass
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("and the copies follow it to a folder under the new name",
       Path(take["cloud"]["mix"]).parent.name.startswith("Late evening"))

    # The format is in the fingerprint as well, so choosing another one makes
    # every copy of this rehearsal stale by definition.
    a.set_cloud_format("flac")
    ok("changing the format queues the rehearsal's takes",
       a.session_state()["cloud_queue"].get(1) == "queued")
    a.set_cloud_format("wav")
    while a._cloud_queue.run_next():
        pass

    print("\n[11j] Forgetting the cloud folder stops publishing on its own")
    # Left on with nowhere to publish to, every take saved afterwards is
    # queued, refused and marked "No cloud folder chosen" — the whole list
    # reads as failed when nothing has gone wrong.
    a.clear_cloud_dir()
    ok("the folder is forgotten", a.get_settings()["cloud_dir"] is None)
    ok("and automatic publishing goes with it",
       a.get_settings()["auto_publish"] is False)
    a._enqueue_publish(folder, 1)
    ok("so nothing is queued for nowhere",
       a.session_state()["cloud_queue"] == {})

    # Leave the fixture as it was found.
    a.set_cloud_dir(str(moved))
    a.set_auto_publish(True, "mix")
    while a._cloud_queue.run_next():
        pass

    print("\n[11k] A copy cut off half-written is not left looking like a take")
    # Nothing is written on the take until the copy succeeds, so a plausible
    # half file in the synced folder has no record anywhere and can never be
    # cleaned up — and the sync client uploads it. Finishing a rehearsal and
    # closing the app while the last take publishes is the normal end of an
    # evening, so this is the ordinary case, not the unlucky one.
    target = a._cloud_target(folder)
    plain_mixdown = apimod.mixdown
    asked = []

    def watch_mixdown(tracks, out_path, volumes=None):
        asked.append(Path(out_path))
        return plain_mixdown(tracks, out_path, volumes)

    apimod.mixdown = watch_mixdown
    try:
        res = a.share_take(str(folder), 1, "both")
    finally:
        apimod.mixdown = plain_mixdown

    take1 = a.get_rehearsal(str(folder))["takes"][0]
    ok("the mix is written under a name nobody would take for a take",
       bool(asked) and asked[-1].name.startswith(apimod.WRITING_PREFIX))
    ok("and lands on its real name once it is whole",
       Path(res["cloud"]["mix"]).exists()
       and Path(res["cloud"]["mix"]).name == f"01 - {take1['name']}.wav")
    ok("the tracks go the same way",
       all(not f.name.startswith(apimod.WRITING_PREFIX)
           for f in Path(res["cloud"]["tracks"]).iterdir()))
    ok("with nothing half-written left behind",
       not list(target.rglob(apimod.WRITING_PREFIX + "*")))

    def die_midway(tracks, out_path, volumes=None):
        # What being killed mid-mixdown leaves on disk: a real file, opened
        # and part written.
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_bytes(b"RIFF" + b"\0" * 64)
        raise OSError("the app was closed")

    apimod.mixdown = die_midway
    try:
        a.share_take(str(folder), 1, "mix")
    except OSError:
        pass
    finally:
        apimod.mixdown = plain_mixdown

    # The folder holds the other takes of the rehearsal too; what matters is
    # that nothing under this take's own name was left behind.
    left = [p for p in target.iterdir()
            if p.is_file() and f"01 - {take1['name']}" in p.name]
    ok("a copy cut off mid-write is left obviously unfinished",
       bool(left) and all(p.name.startswith(apimod.WRITING_PREFIX) for p in left))
    ok("and the take does not claim the copy that was trashed for it",
       not cloudmod.is_current(a.get_rehearsal(str(folder))["takes"][0], "mix",
                               a.get_settings()["volumes"], "wav", target))

    for p in left:
        p.unlink()
    a._enqueue_publish(folder, 1)
    while a._cloud_queue.run_next():
        pass
    ok("and the next pass puts a whole one there",
       Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"]).exists())

    # The worker is a daemon thread: unless it is told, it is killed at
    # interpreter exit wherever it happens to be.
    idle = cloudmod.PublishQueue(step=lambda f, n: None, paused=lambda: False)
    idle.start()
    real_queue, a._cloud_queue = a._cloud_queue, idle
    try:
        a.shutdown()
    finally:
        a._cloud_queue = real_queue
    ok("closing the app stands the worker down", not idle._thread.is_alive())

    print("\n[11l] A recovered draft goes to the cloud like any other take")
    # The app died mid-take and the draft is rescued on the next run. That is
    # the very case the design argues from when it decides there is no
    # startup sweep, so the recovered take has to reach the cloud folder the
    # way a saved one does.
    rescued_draft = folder / "_drafts" / "take 11"
    rescued_draft.mkdir(parents=True, exist_ok=True)
    (rescued_draft / "A.raw").write_bytes(struct.pack("<h", 1100) * SR)
    rescued = a.recover_draft(str(rescued_draft), "Rescued")
    ok("the draft became a take", rescued["ok"])
    ok("and is waiting to be published",
       a.session_state()["cloud_queue"].get(rescued["take"]["take_number"])
       == "queued")
    while a._cloud_queue.run_next():
        pass
    recovered = next(t for t in a.get_rehearsal(str(folder))["takes"]
                     if t["take_number"] == rescued["take"]["take_number"])
    ok("and it lands in the cloud folder",
       Path((recovered.get("cloud") or {}).get("mix", "")).exists())

    print("\n[15] The version the app is running")
    import rehearsal_recorder

    # The version comes from the release tag, written into the package when it
    # is installed or built. This suite also runs from a clone that was never
    # installed, where there is no such file and the honest answer is that it
    # does not know — so both shapes are allowed, and nothing else is.
    ok("the interface can be told which version it is running",
       a.get_settings()["version"] == rehearsal_recorder.__version__)
    reported = a.get_settings()["version"]
    ok("and it is either the tag it was built from or an honest 'unknown'",
       reported == "unknown" or re.match(r"\d+\.\d+", reported) is not None)

    print("\n[16] History says what was rehearsed")
    # The history list shows a name, a date and a take count, which is not
    # enough to recognise a rehearsal months later. What was played is already
    # on disk: take names carry the song, because each new take inherits the
    # last one's name with the attempt number bumped.
    tmp4 = Path(tempfile.mkdtemp())
    apimod4, d = fresh_api(tmp4)

    def past_rehearsal(name, created_at, take_names, seconds=60.0):
        folder = tmp4 / "Rec" / f"{name} - {created_at[:10]} 19-00"
        folder.mkdir(parents=True)
        (folder / "session.json").write_text(json.dumps({
            "name": name, "created_at": created_at, "samplerate": SR,
            "tracks": [{"name": "Gtr", "channel": 1}],
            "takes": [
                {"take_number": i + 1, "name": n,
                 "duration_sec": seconds, "tracks": []}
                for i, n in enumerate(take_names)
            ],
        }))
        return folder

    past_rehearsal("Songs", "2026-09-10T19:00:00",
                   ["Polyn", "Polyn 2", "Polyn 3", "Vesna", "Vesna 2", "Ogon"])
    past_rehearsal("Unnamed", "2026-09-09T19:00:00", ["Take 1", "Take 2"])
    past_rehearsal("Half", "2026-09-08T19:00:00", ["Take 1", "Polyn", "polyn 2"])

    by_name = {r["name"]: r for r in d.list_rehearsals()}

    ok("each song is named once, with the attempts counted",
       [(s["name"], s["takes"]) for s in by_name["Songs"]["songs"]]
       == [("Polyn", 3), ("Vesna", 2), ("Ogon", 1)])
    ok("in the order they were first played",
       [s["name"] for s in by_name["Songs"]["songs"]][0] == "Polyn")
    ok("and the rehearsal knows how long it ran",
       abs(by_name["Songs"]["total_duration_sec"] - 360.0) < 0.01)

    # "Take 2" is what the app calls a take nobody named. Reporting that as a
    # song is worse than saying nothing: "Take ×2" next to "2 takes".
    ok("takes nobody named are not songs", by_name["Unnamed"]["songs"] == [])
    ok("but they are still takes", by_name["Unnamed"]["take_count"] == 2)

    ok("a half-named rehearsal reports what it has, case and all",
       [(s["name"], s["takes"]) for s in by_name["Half"]["songs"]]
       == [("Polyn", 2)])
    ok("without dropping the unnamed one from the count",
       by_name["Half"]["take_count"] == 3)

    print("\n[16b] And how much of the disk it is using")
    # Walked rather than estimated from the durations: a take encoded
    # differently, or one that never finished, makes any guess wrong.
    sized = past_rehearsal("Sized", "2026-09-07T19:00:00", ["Polyn"])
    def bytes_of(name):
        return {r["name"]: r for r in d.list_rehearsals()}[name]["disk_bytes"]

    empty_handed = bytes_of("Sized")
    ok("a folder is measured, not guessed at", empty_handed > 0)

    (sized / "01 - Polyn").mkdir(parents=True)
    (sized / "01 - Polyn" / "Gtr.wav").write_bytes(b"\0" * 5000)
    (sized / "_drafts" / "take 2").mkdir(parents=True)
    (sized / "_drafts" / "take 2" / "Gtr.raw").write_bytes(b"\0" * 1000)
    with_audio = bytes_of("Sized")
    ok("every file counts, the unfinished draft included",
       with_audio - empty_handed == 6000)

    # Deleting moves a take out to _deleted beside the rehearsals, so the
    # rehearsal stops being charged for it — which is what makes the number
    # worth showing next to a Delete button.
    gone = tmp4 / "Rec" / "_deleted" / "old take"
    gone.mkdir(parents=True)
    (gone / "Gtr.wav").write_bytes(b"\0" * 9000)
    ok("what was deleted is charged to nobody", bytes_of("Sized") == with_audio)
    ok("and the bin is not mistaken for a rehearsal",
       "_deleted" not in {r["name"] for r in d.list_rehearsals()})

    print("\n[17] A discarded take is moved, not destroyed")
    # "Discard" on the review screen used to be the one place in this app where
    # a recording really did vanish: an rmtree of whatever path it was handed,
    # with no check that the path was even inside the recordings folder. A take
    # dropped there and a draft rescued after a crash are the same thing on
    # disk, so they now go the same way.
    tmp5 = Path(tempfile.mkdtemp())
    apimod5, e = fresh_api(tmp5)
    e.start_rehearsal("Evening", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    draft = Path(e._session["folder"]) / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1000, seconds=1.0)

    gone = e.discard_take(str(draft))
    ok("discarding a take says where it went", gone["ok"])
    ok("it leaves the rehearsal", not draft.exists())
    ok("but it is somewhere, not gone",
       gone.get("trashed") is True
       or Path(gone.get("location") or "/nowhere").exists())

    outside = tmp5 / "not-ours"
    outside.mkdir()
    (outside / "keep.txt").write_text("someone else's")
    refused = e.discard_take(str(outside))
    ok("a path outside the recordings folder is refused", not refused["ok"])
    ok("and nothing there is touched", (outside / "keep.txt").exists())

    print("\n[18] Cutting a wav down to a range")
    # The one operation under a crop: write the part worth keeping. Moving the
    # original out of the way is the caller's job — in this app, the Trash.
    from rehearsal_recorder.audio.crop import crop_wav

    def wav_frames(path):
        with wave.open(str(path)) as w:
            return w.getnframes()

    def wav_samples(path):
        """Every sample of a mono wav, at its own scale."""
        with wave.open(str(path)) as w:
            frames, width = w.getnframes(), w.getsampwidth()
            raw = w.readframes(frames)
        if width == 2:
            return list(struct.unpack("<%dh" % frames, raw))
        return [int.from_bytes(raw[i * 3:i * 3 + 3], "little", signed=True)
                for i in range(frames)]

    tmp6 = Path(tempfile.mkdtemp())
    write_wav(tmp6 / "long.wav", 1000, seconds=2.0)

    cut = crop_wav(tmp6 / "long.wav", tmp6 / "cut.wav", 0.5, 1.5)
    ok("a crop says how much it kept", cut["ok"] and cut["frames"] == SR)
    with wave.open(str(tmp6 / "cut.wav")) as w:
        ok("and writes exactly that",
           w.getnframes() == SR and w.getframerate() == SR
           and w.getsampwidth() == 2 and w.getnchannels() == 1)

    middle = wav_samples(tmp6 / "cut.wav")
    ok("the audio between the cuts is untouched", middle[SR // 2] == 1000)
    # A cut lands on whatever sample was there, and a non-zero sample at the
    # edge of a file is a click.
    ok("but each cut edge is ramped rather than stepped",
       middle[0] == 0 and abs(middle[-1]) < 50)

    head = crop_wav(tmp6 / "long.wav", tmp6 / "head.wav", 0.0, 1.0)
    ok("a region that starts at the beginning keeps the original attack",
       head["ok"] and wav_samples(tmp6 / "head.wav")[0] == 1000)

    write_wav(tmp6 / "deep.wav", 1000, seconds=1.0, depth=24)
    deep = crop_wav(tmp6 / "deep.wav", tmp6 / "deepcut.wav", 0.25, 0.75)
    with wave.open(str(tmp6 / "deepcut.wav")) as w:
        ok("24-bit comes out 24-bit",
           deep["ok"] and w.getsampwidth() == 3 and w.getnframes() == SR // 2)
    deep_samples = wav_samples(tmp6 / "deepcut.wav")
    ok("and its samples come through whole",
       deep_samples[SR // 4] == 1000 * 256)
    # SR // 4 above lands in the untouched raw-copy middle, so it never runs
    # the unpack24 / scale / << 8 / pack24 round trip in _faded — the most
    # bit-fragile code in the module. The head ramp's first frame is exactly
    # 0 either way, but the tail ramp's last frame (240 frames = 0.005s at
    # 48000Hz) is round(256000 * 1/240) = 1067; a missing `<< 8` would instead
    # produce 4 (the value divided by 256 and truncated by pack24 keeping the
    # wrong three bytes), so this is precise enough to actually catch that.
    ok("and a 24-bit edge is ramped through the same pack24 path",
       deep_samples[0] == 0 and deep_samples[-1] == 1067)

    past = crop_wav(tmp6 / "long.wav", tmp6 / "nothing.wav", 5.0, 6.0)
    ok("a range past the end of the file is refused", not past["ok"])
    ok("and leaves nothing behind when it is",
       not (tmp6 / "nothing.wav").exists())

    print("\n[19] Cropping a take to the region")
    tmp7 = Path(tempfile.mkdtemp())
    apimod7, c = fresh_api(tmp7)
    c.start_rehearsal("Cutting", None, SR,
                      [{"name": "Gtr", "channel": 1},
                       {"name": "Bass", "channel": 2}], 16)
    draft = Path(c._session["folder"]) / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1000, seconds=4.0)
    write_wav(draft / "Bass.wav", 2000, seconds=4.0)
    saved = c.keep_take(
        1, str(draft), "Polyn", 4.0,
        [{"name": "Gtr", "file": str(draft / "Gtr.wav")},
         {"name": "Bass", "file": str(draft / "Bass.wav")}],
        [{"at": 0.5, "note": "count-in", "kind": "note"},
         {"at": 2.0, "note": "here", "kind": "good"},
         {"at": 3.8, "note": "stopped", "kind": "bad"}],
    )
    folder = str(c._session["folder"])
    take_dir = Path(saved["take"]["tracks"][0]["file"]).parent

    # The player holds every track through a memmap, and Windows will not
    # rename a mapped file — so cropping has to let go of them first.
    c.player_open(saved["take"]["tracks"])
    ok("a take can be open in the player", c.player_state().get("open") is True)

    res = c.crop_take(folder, 1, 1.0, 3.0)
    ok("cropping says what it kept",
       res["ok"] and abs(res["take"]["duration_sec"] - 2.0) < 0.01)
    ok("and let go of the files before rewriting them",
       c.player_state().get("open") is not True)
    ok("every track is the region now",
       all(wav_frames(t["file"]) == 2 * SR for t in res["take"]["tracks"]))
    ok("the markers move with the audio they pointed at",
       [m["at"] for m in res["take"]["markers"]] == [1.0])
    ok("and the ones outside it are counted, not silently dropped",
       res["markers_dropped"] == 2)
    ok("the originals leave as one folder, not eight loose files",
       res["trashed"] is True
       or Path(res["location"] or "").name.endswith("(before crop)"))
    ok("and the take folder is left with only its tracks",
       sorted(p.name for p in take_dir.iterdir()) == ["Bass.wav", "Gtr.wav"])

    # The cloud fingerprint records the name, format, folder and balance —
    # never the length. A cropped take would go on matching it, and the
    # uncropped copy would stay in the cloud folder as the copy of record.
    c.set_cloud_dir(str(tmp7 / "Cloud"))
    c.share_take(folder, 1, "mix")
    ok("a shared take knows where its copy is",
       bool((c.session_state()["takes"][0].get("cloud") or {}).get("mix")))
    c.crop_take(folder, 1, 0.25, 1.75)
    ok("cropping forgets a copy that is now of a different take",
       not (c.session_state()["takes"][0].get("cloud") or {}).get("mix"))

    ok("a region shorter than a second is refused",
       not c.crop_take(folder, 1, 0.1, 0.4)["ok"])
    ok("and a folder outside the recordings directory is refused",
       not c.crop_take(str(tmp7 / "elsewhere"), 1, 0.0, 2.0)["ok"])

    # By the time the originals are swept up, the crop has already succeeded
    # — the new files are in place. A full disk or a permissions problem on
    # the sweep must not be reported as a failed crop, and it must not lose
    # track of where the originals actually are: that folder is the only way
    # back to them. Full range, so the take's duration comes out exactly
    # what it already was — the checks below still assume a 1.5s take.
    real_move_to_trash = apimod7.move_to_trash
    apimod7.move_to_trash = lambda *a, **k: {"ok": False, "error": "no room"}
    try:
        stuck = c.crop_take(folder, 1, 0.0, 1.5)
    finally:
        apimod7.move_to_trash = real_move_to_trash
    ok("a crop still succeeds even when the sweep of the originals fails",
       stuck["ok"])
    ok("and is not mistaken for having reached the Trash",
       stuck["trashed"] is False)
    stuck_dir = Path(stuck["location"] or "")
    ok("its location names the folder the originals are actually still in",
       stuck_dir.name.endswith("(before crop)") and stuck_dir.is_dir())
    ok("with the originals really inside it, not just a claim",
       sorted(p.name for p in stuck_dir.iterdir()) == ["Bass.wav", "Gtr.wav"])

    # Moving the originals aside is the one step that can stop half way: on
    # Windows, renaming a file another process holds open raises. Half the
    # tracks aside and half in place, behind an error that reads as "nothing
    # happened", is how a take ends up with tracks of different lengths — the
    # next crop quietly drops the missing ones and cuts only the survivors.
    c.player_open(c.session_state()["takes"][0]["tracks"])
    was = {p.name: wav_frames(p) for p in take_dir.iterdir()}
    beside = sorted(p.name for p in take_dir.parent.iterdir())
    real_move = apimod7.shutil.move
    moves = {"n": 0}

    def flaky_move(src, dst):
        moves["n"] += 1
        if moves["n"] == 2:            # the second track, mid-way through
            raise PermissionError("the file is open in another process")
        return real_move(src, dst)

    apimod7.shutil.move = flaky_move
    try:
        half = c.crop_take(folder, 1, 0.25, 1.25)
    finally:
        # Not in an `if`: a stub left behind here would poison every section
        # after this one.
        apimod7.shutil.move = real_move
    ok("a move that fails part way is a failed crop", not half["ok"])
    ok("and the take is exactly what it was, not half of a crop",
       {p.name: wav_frames(p) for p in take_dir.iterdir()} == was)
    ok("with no half-written file left over",
       not any(p.name.startswith(".writing-") for p in take_dir.iterdir()))
    ok("and no empty folder of originals beside the take",
       sorted(p.name for p in take_dir.parent.iterdir()) == beside)
    # Python let go of the files before rewriting them. On the failure path
    # nothing else puts the player back — the take's tracks have not changed,
    # so the interface's open effect never re-runs — and the transport would
    # go on driving a player that is not there.
    ok("and the take it was playing is still open",
       c.player_state().get("open") is True)
    c.player_close()

    # Nothing is replaced until every new file exists, so a track that cannot
    # be read costs the crop and nothing else.
    (take_dir / "Bass.wav").write_bytes(b"not a wav at all")
    broken = c.crop_take(folder, 1, 0.25, 1.5)
    ok("one unreadable track stops the whole crop", not broken["ok"])
    ok("and leaves no half-written files behind",
       not any(p.name.startswith(".writing-") for p in take_dir.iterdir()))
    ok("with the other track still where it was",
       wav_frames(take_dir / "Gtr.wav") > 0)

    # A take on the review screen is a proper wav already; it just has no
    # entry in session.json yet.
    draft2 = Path(c._session["folder"]) / "_drafts" / "take 2"
    write_wav(draft2 / "Gtr.wav", 1000, seconds=4.0)
    pending = [{"name": "Gtr", "file": str(draft2 / "Gtr.wav")}]
    early = c.crop_draft(str(draft2), pending, 1.0, 3.0)
    ok("a take can be cropped before it is ever saved",
       early["ok"] and abs(early["duration_sec"] - 2.0) < 0.01)
    ok("in place, so saving it afterwards needs no new paths",
       wav_frames(draft2 / "Gtr.wav") == 2 * SR
       and early["tracks"][0]["file"] == str(draft2 / "Gtr.wav"))

    # A draft has no stored length to clamp the end against, so the region
    # asked for can run past the audio. The length reported is the length
    # written — Review hands this straight to keep_take and it ends up in
    # meta.json, where a number nobody measured is a lie that outlives the
    # take.
    past_end = c.crop_draft(str(draft2), pending, 1.5, 3.0)
    ok("a crop running past the end reports what it really kept",
       past_end["ok"] and abs(past_end["duration_sec"] - 0.5) < 0.01
       and wav_frames(draft2 / "Gtr.wav") == SR // 2)

    print("\n[20] The waveform can be asked for one part of a take")
    # Zoomed in, the same 900 bars have to describe two seconds instead of
    # nine minutes, or zooming only stretches the same smear.
    tmp8 = Path(tempfile.mkdtemp())
    with wave.open(str(tmp8 / "half.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack("<h", 0) * SR)       # a second of silence
        w.writeframes(struct.pack("<h", 8000) * SR)    # then a second of tone

    whole, frames_whole, _ = wav_peaks(tmp8 / "half.wav", buckets=8)
    ok("the whole file is half silence and half tone",
       whole[0] == 0 and whole[7] > 0.2)

    loud, frames_loud, _ = wav_peaks(tmp8 / "half.wav", buckets=8,
                                     start_sec=1.0, end_sec=2.0)
    ok("asked for the second half, every bar is the tone",
       all(p > 0.2 for p in loud))
    quiet, _, _ = wav_peaks(tmp8 / "half.wav", buckets=8,
                            start_sec=0.0, end_sec=1.0)
    ok("and asked for the first, none of them is", all(p == 0 for p in quiet))
    # take_media turns this into the player's duration, which must not change
    # when the view does.
    ok("the file still reports its own length, not the window's",
       frames_loud == frames_whole == 2 * SR)

    # Without bounding reads to the window, the loop reads whole bars past the
    # end whenever the window is shorter than the bar count: per_bucket floors
    # to 1, and nothing stops the loop but real EOF. This arrangement exposes
    # it: a short silent window followed by loud audio.
    tmp9 = Path(tempfile.mkdtemp())
    with wave.open(str(tmp9 / "short_window.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack("<h", 0) * int(0.01 * SR))  # 10ms silence
        w.writeframes(struct.pack("<h", 8000) * SR)           # then a second of tone

    short_silent, _, _ = wav_peaks(tmp9 / "short_window.wav", buckets=900,
                                   start_sec=0.0, end_sec=0.01)
    ok("a window shorter than the bar count does not leak past its end",
       all(p == 0 for p in short_silent))

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("Python side: all checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
