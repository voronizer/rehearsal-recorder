"""
Python side, no browser: mixing, transport, disk space, crash safety,
renaming, take naming and draft recovery.

There is no sound card in the checking environment, so no stream is opened —
the renderer is called directly and the samples themselves are inspected.
"""

import json
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
    ok("the copy records what it was made from",
       take["cloud"]["source"]["what"] == "mix"
       and take["cloud"]["source"]["name"] == take["name"])
    ok("and it counts as current",
       cloudmod.is_current(take, "mix", volumes, "wav"))
    ok("asking for more than was copied is not current",
       not cloudmod.is_current(take, "both", volumes, "wav"))

    renamed = dict(take, name="Something else")
    ok("a renamed take is not current",
       not cloudmod.is_current(renamed, "mix", volumes, "wav"))
    ok("a take that was never copied is not current",
       not cloudmod.is_current({"name": "x", "tracks": []}, "mix", volumes, "wav"))

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
