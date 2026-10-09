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
# only, 2 refuses anything but 44100, and 3 is a desk with eight outputs.
_DEVICES = [
    {"name": "Interface", "max_output_channels": 2, "max_input_channels": 8,
     "hostapi": 0, "default_samplerate": 48000},
    {"name": "Podcast mic", "max_output_channels": 0, "max_input_channels": 1,
     "hostapi": 0, "default_samplerate": 44100},
    {"name": "Fussy DAC", "max_output_channels": 2, "max_input_channels": 0,
     "hostapi": 0, "default_samplerate": 44100},
    {"name": "Desk", "max_output_channels": 8, "max_input_channels": 0,
     "hostapi": 0, "default_samplerate": 48000},
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
# No suite opens a real MIDI port. With None in sys.modules, importing the
# library raises ImportError, which midi/ports.open_system() answers as "MIDI is
# not available" — whatever is plugged into the machine running them.
sys.modules["pylibremidi"] = None

import numpy as np  # noqa: E402

from rehearsal_recorder.api import _is_inside  # noqa: E402
from rehearsal_recorder.audio.player import TakePlayer  # noqa: E402

SR = 48000
problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else,
    # such as "★" or "▶", taking the whole suite down with it.
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
       abs(levels["A"][0] - 1000 / 32768) < 0.005
       and abs(levels["B"][0] - 2000 / 32768) < 0.005)

    p.set_volume("B", 0.5)
    settle(p)
    ok("and says it after the fader, not before",
       abs(p.state()["levels"]["B"][0] - 1000 / 32768) < 0.005)
    p.set_volume("B", 1.0)

    p.set_muted("A", True)
    settle(p)
    ok("a muted track reads nothing at all", p.state()["levels"]["A"][0] == 0.0)
    p.set_muted("A", False)
    settle(p)

    ok("the whole mix says how loud it came out",
       abs(p.state()["master_level"] - 3000 / 32768) < 0.005)

    p.pause()
    ok("and nothing reads anything the moment playback stops",
       all(c == 0.0 for v in p.state()["levels"].values() for c in v)
       and p.state()["master_level"] == 0.0)
    p._render(256)
    ok("nor after",
       all(c == 0.0 for v in p.state()["levels"].values() for c in v))

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

    print("\n[2b] The whole mix turned down")
    p.seek(0)
    p.set_master(0.5)
    ok("the master turns the whole mix down",
       abs(int(settle(p)[:, 0].mean()) - 1500) < 30)
    # The faders are the band's balance and the cloud mix is made from them;
    # the master is only how loud somebody listens, so the meters beside the
    # faders stay where the faders put them.
    ok("while each track still reads what its own fader lets through",
       abs(p.state()["levels"]["B"][0] - 2000 / 32768) < 0.005)
    ok("and the state says where it is", p.state()["master"] == 0.5)
    ok("the whole mix's meter reads after it",
       abs(p.state()["master_level"] - 1500 / 32768) < 0.005)
    p.set_master(7)
    ok("it goes no higher than full", p.state()["master"] == 1.0)
    # Turned down while paused, the first block after play is already quiet
    # — easing down from full over the first blocks is a burst of loud.
    p.pause()
    p.set_master(0.1)
    p._render(256)
    p.play()
    first = p._render(256)
    ok("turned down while paused, it starts quiet",
       abs(int(first[:, 0].mean()) - 300) < 30)
    p.set_master(1.0)
    settle(p)

    # Two tracks each well short of full scale can still add up past it, and
    # the mix is where that shows: it is clipped on the way out.
    write_wav(tmp / "loud1.wav", 20000)
    write_wav(tmp / "loud2.wav", 20000)
    loud = TakePlayer([
        {"name": "L1", "file": str(tmp / "loud1.wav")},
        {"name": "L2", "file": str(tmp / "loud2.wav")},
    ])
    loud.play()
    settle(loud)
    st = loud.state()
    ok("a sum past full scale reads full on the mix's meter",
       st["master_level"] == 1.0 and st["levels"]["L1"][0] < 0.7)
    loud.set_master(0.5)
    settle(loud)
    ok("and turned down it no longer does",
       abs(loud.state()["master_level"] - 20000 / 32768) < 0.005)
    loud.close()

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

    print("\n[4d] A saved device is found again after the list moves")
    from rehearsal_recorder.audio.devices import device_identity, saved_device

    # The shape Windows takes once ASIO is loaded: the same mixer through
    # three systems, ASIO inserted in the middle so later indices shift.
    win_apis = [{"name": "MME"}, {"name": "ASIO"}, {"name": "Windows WASAPI"}]
    win_devices = [
        {"name": "X32", "hostapi": 0, "max_input_channels": 2,
         "max_output_channels": 2, "default_samplerate": 48000},
        {"name": "X32", "hostapi": 1, "max_input_channels": 16,
         "max_output_channels": 16, "default_samplerate": 48000},
        {"name": "X32", "hostapi": 2, "max_input_channels": 8,
         "max_output_channels": 2, "default_samplerate": 48000},
        {"name": "X32", "hostapi": 2, "max_input_channels": 8,
         "max_output_channels": 2, "default_samplerate": 48000},
    ]
    real_q, real_h = _sd.query_devices, _sd.query_hostapis
    _sd.query_hostapis = lambda: win_apis
    _sd.query_devices = (
        lambda index=None, kind=None:
        win_devices if index is None else win_devices[index]
    )
    try:
        ok("a device is described by name and audio system",
           device_identity(2) == {"name": "X32", "host_api": "Windows WASAPI"})
        ok("nothing chosen describes as nothing", device_identity(None) is None)
        ok("an unknown index describes as nothing", device_identity(99) is None)

        # Saved as WASAPI when it was index 1, before ASIO pushed it along.
        cfg = {"device_index": 1,
               "device": {"name": "X32", "host_api": "Windows WASAPI"}}
        ok("it is found by name and system, not by the old index",
           saved_device(cfg, "device", True, "win32") == 2)

        cfg = {"device_index": 3,
               "device": {"name": "X32", "host_api": "Windows WASAPI"}}
        ok("of two identical cards the stored index still picks one",
           saved_device(cfg, "device", True, "win32") == 3)

        cfg = {"device_index": 0,
               "device": {"name": "Behringer", "host_api": "ASIO"}}
        ok("a card that is not plugged in is not chosen",
           saved_device(cfg, "device", True, "win32") is None)

        ok("on Windows an index with no name is not trusted",
           saved_device({"device_index": 2}, "device", True, "win32") is None)
        ok("elsewhere it is used as before",
           saved_device({"device_index": 2}, "device", True, "darwin") == 2)
        ok("nothing saved is nothing chosen",
           saved_device({}, "device", True, "win32") is None)
        ok("the output is read from its own keys",
           saved_device({"output_device_index": 5,
                         "output_device": {"name": "X32", "host_api": "ASIO"}},
                        "output_device", False, "win32") == 1)
    finally:
        _sd.query_devices, _sd.query_hostapis = real_q, real_h

    print("\n[4e] Settings save what the device is and read it back")
    apimod, a = fresh_api(tmp / "devices")
    a.set_recording_format(0, 48000, 24)
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("the recording interface is saved by name and system",
       saved.get("device") == {"name": "Interface", "host_api": "CoreAudio"})
    a.set_output_device(2)
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("so is the playback output",
       saved.get("output_device") == {"name": "Fussy DAC", "host_api": "CoreAudio"})
    a.set_output_device(None)
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("the system output leaves no name behind",
       saved.get("output_device") is None
       and saved.get("output_device_index") is None)

    # device_index here says which card the layout belongs to. It does not
    # change the recording device: that choice is made in Settings, and a
    # template saved on the setup screen must not quietly move it.
    before = a._config.get("device")
    a.save_default_tracks({"device_index": 1, "tracks": [{"name": "V", "channel": 1}]})
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("the setup screen's template is saved as that card's input map",
       saved.get("layouts", [{}])[0]
       == {"device": {"name": "Podcast mic", "host_api": "CoreAudio"},
           "inputs": {"V": 1}}
       and saved.get("tracks") == [{"name": "V"}])
    ok("and leaves the chosen recording device alone",
       a._config.get("device") == before)

    # The card moved: identity says index 0 now, the stored index says 1.
    a._config["device_index"] = 1
    a._config["device"] = {"name": "Interface", "host_api": "CoreAudio"}
    ok("settings report where the card is now",
       a.get_settings()["device_index"] == 0)
    ok("and so does the template the setup screen loads",
       a.load_default_tracks()["device_index"] == 0)
    ok("every device says which system it came through, even alone",
       all(d["host_api"] == "CoreAudio" for d in a.list_input_devices()))

    # Settings sends the *resolved* device_index, which is None when the
    # saved card is unplugged. Recording has no "system input", so that None
    # must not be read as "forget the card" — only as "nothing to change".
    a.set_recording_format(0, 48000, 24)
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    a.set_recording_format(None, 44100, 16)
    saved2 = json.loads(apimod.CONFIG_PATH.read_text())
    ok("an unplugged card does not wipe the saved identity",
       saved2.get("device") == saved.get("device") == {"name": "Interface", "host_api": "CoreAudio"})
    ok("but the rate and depth still change",
       saved2.get("samplerate") == 44100 and saved2.get("bit_depth") == 16)

    print("\n[4f] Playback through a chosen pair of outputs")
    p4 = TakePlayer(tracks)
    complaint = p4.open_output(3, (3, 4))
    ok("the stream is opened wide enough to reach 3–4",
       p4._stream.kw["channels"] == 4 and complaint is None)
    p4.play()
    settle(p4)
    block = np.zeros((512, 4), dtype=np.int16)
    p4._callback(block, 512, None, None)
    ok("the mix comes out of 3 and 4",
       abs(int(block[:, 2].mean()) - 3000) < 30
       and abs(int(block[:, 3].mean()) - 3000) < 30)
    ok("and 1 and 2 stay silent", not block[:, :2].any())

    complaint = p4.open_output(3, (5,))
    ok("one output on its own opens as far as that output",
       p4._stream.kw["channels"] == 5 and complaint is None)
    block = np.full((512, 5), 7, dtype=np.int16)
    p4._callback(block, 512, None, None)
    ok("the mix comes out of that one alone, at the same level",
       abs(int(block[:, 4].mean()) - 3000) < 30 and not block[:, :4].any())

    complaint = p4.open_output(0, (3, 4))
    ok("a card without those outputs plays through 1–2",
       p4._stream.kw["channels"] == 2)
    ok("and says so", complaint and "3–4" in complaint and "1–2" in complaint)

    complaint = p4.open_output(None, (3, 4))
    ok("the system output is always 1–2, without a word",
       p4._stream.kw["channels"] == 2 and complaint is None)
    p4.close()

    a.set_output_device(3)
    ok("a new card starts on 1–2", a.get_settings()["output_channels"] == [1, 2])
    res = a.set_output_channels([3, 4])
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("a pair is saved", res["ok"] and saved.get("output_channels") == [3, 4])
    ok("and reported back", a.get_settings()["output_channels"] == [3, 4])
    ok("so is a single output", a.set_output_channels([5])["ok"]
       and a.get_settings()["output_channels"] == [5])
    ok("two outputs that are not a pair are refused",
       not a.set_output_channels([2, 3])["ok"])
    ok("and so is output 0", not a.set_output_channels([0])["ok"])
    ok("and nothing refused was saved", a.get_settings()["output_channels"] == [5])

    a.set_output_channels([3, 4])
    opened = a.player_open(tracks)
    ok("a take opens on the saved pair",
       opened["ok"] and a._player._stream.kw["channels"] == 4)
    a.set_output_channels([1, 2])
    ok("changing the pair mid-take reopens the output",
       a._player._stream.kw["channels"] == 2)
    a.set_output_channels([3, 4])
    a.set_output_device(0)
    ok("choosing another card starts it again from 1–2",
       a.get_settings()["output_channels"] == [1, 2]
       and a._player._stream.kw["channels"] == 2)

    ok("the master starts at full", a.player_state()["master"] == 1.0)
    a.player_set_master(0.4)
    ok("and turns down in the take that is open",
       a.player_state()["master"] == 0.4)
    a.save_master_volume(0.4)
    saved = json.loads(apimod.CONFIG_PATH.read_text())
    ok("where it was left is saved", saved.get("master_volume") == 0.4)
    a.player_close()
    ok("and the settings say so with no take open, for the header's slider",
       a.get_settings()["master_volume"] == 0.4)
    ok("and the next take opens at it",
       a.player_open(tracks)["master"] == 0.4)
    a.save_master_volume(-3)
    ok("nothing below silence is saved",
       json.loads(apimod.CONFIG_PATH.read_text()).get("master_volume") == 0.0)
    a.save_master_volume(1.0)
    a.player_close()

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

    peaks24_rows, frames24, rate24 = wav_peaks(deep / "B.wav", buckets=8)
    peaks24 = peaks24_rows[0]
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
       abs(rec24.get_levels()["Gtr"][0] - (1000 * 256 * 256) / 2 ** 31) < 0.001)

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
    ok("a negative peak counts", abs(levels["Gtr"][0] - 32000 / 32768) < 0.001)
    ok("a quiet track reads quiet", levels["Voc"][0] < 0.01)
    for f in rec4._raw_files.values():
        f.close()
    ok("and they are the samples we sent",
       (tmp / "levels" / "Gtr.raw").read_bytes()[:2] == struct.pack("<h", -32000))

    print("\n[7d] A take can be saved and dropped while it is still playing")
    # The review screen plays the take it is asking about, so its files are
    # memory-mapped when Save or Discard arrives. Windows will not move or
    # remove a mapped file; on a Mac this passed, on Windows Save did nothing.
    _, busy = fresh_api(tmp / "busy")
    busy.start_rehearsal("Busy", 0, SR, [{"name": "Gtr", "channel": 1}])
    busy_folder = Path(busy._session["folder"])
    for number in (1, 2):
        d = busy_folder / "_drafts" / f"take {number}"
        write_wav(d / "Gtr.wav", 100, seconds=1.0)
    first = busy_folder / "_drafts" / "take 1"
    busy.player_open([{"name": "Gtr", "file": str(first / "Gtr.wav")}])
    kept = busy.keep_take(1, str(first), "Open one", 1.0,
                          [{"name": "Gtr", "file": str(first / "Gtr.wav")}])
    ok("saving a take that is open in the player works",
       kept.get("ok") and Path(kept["take"]["tracks"][0]["file"]).exists())
    ok("and nothing is left behind in the drafts", not first.exists())

    second = busy_folder / "_drafts" / "take 2"
    busy.player_open([{"name": "Gtr", "file": str(second / "Gtr.wav")}])
    dropped = busy.discard_take(str(second))
    ok("dropping one that is open works too",
       dropped.get("ok") and not second.exists())

    # The same trap after saving: the rehearsal screen plays the take that is
    # selected, and deleting it is done from the same screen.
    busy.player_open(kept["take"]["tracks"])
    gone = busy.delete_take(str(busy_folder), 1)
    ok("deleting a take that is playing works",
       gone.get("ok") and not Path(kept["take"]["tracks"][0]["file"]).exists())

    busy.start_rehearsal("Other", 0, SR, [{"name": "Gtr", "channel": 1}])
    d = Path(busy._session["folder"]) / "_drafts" / "take 1"
    write_wav(d / "Gtr.wav", 100, seconds=1.0)
    old = busy.keep_take(1, str(d), "Old", 1.0,
                         [{"name": "Gtr", "file": str(d / "Gtr.wav")}])
    old_folder = Path(busy._session["folder"])
    busy._session = None  # a past rehearsal, as seen from History
    busy.player_open(old["take"]["tracks"])
    ok("so does deleting a whole rehearsal with a take playing",
       busy.delete_rehearsal(str(old_folder)).get("ok")
       and not old_folder.exists())

    # And only the take being moved is let go of.
    busy.start_rehearsal("Third", 0, SR, [{"name": "Gtr", "channel": 1}])
    third = Path(busy._session["folder"])
    for number in (1, 2):
        d = third / "_drafts" / f"take {number}"
        write_wav(d / "Gtr.wav", 100, seconds=1.0)
    listening = [{"name": "Gtr", "file": str(third / "_drafts" / "take 2" / "Gtr.wav")}]
    busy.player_open(listening)
    busy.discard_take(str(third / "_drafts" / "take 1"))
    ok("a player on another take keeps playing", busy._player is not None)
    busy.player_close()

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
    ok("the next take is another go at the same song",
       a.suggest_take_name() == "Polyn" and a.session_state()["next_take_go"] == 2)
    keep(2, a.suggest_take_name())
    ok("the go keeps climbing",
       a.suggest_take_name() == "Polyn" and a.session_state()["next_take_go"] == 3)

    # The band moves on to another song, and says so on the rehearsal screen
    # before the take rather than retyping it after.
    ok("a name picked for the next take is the one it gets",
       a.set_next_take_name(" Vesna ")["next_take_name"] == "Vesna"
       and a.session_state()["next_take_name"] == "Vesna")
    ok("and the name it would have had is still known, to go back to",
       a.session_state()["next_take_default"] == "Polyn")
    a._session["take_counter"] = 3
    ok("the review screen is offered it for the take just recorded",
       a.suggest_take_name(3) == "Vesna")
    a._session["take_counter"] = 2
    ok("a take thrown away leaves it for the next go", a.suggest_take_name() == "Vesna")
    keep(3, "Vesna")
    ok("a kept take uses it up, and the next follows on from it",
       a.suggest_take_name() == "Vesna" and a.session_state()["next_take_go"] == 2)
    a.set_next_take_name("Ogon")
    a.set_next_take_name("  ")
    ok("blank goes back to the name it would have had", a.suggest_take_name() == "Vesna")
    a.set_next_take_name("Ogon")
    d = folder / "_drafts" / "take 4"
    write_wav(d / "Gtr.wav", 100, seconds=1.0)
    a._session["take_counter"] = 5
    a.keep_take(4, str(d), "Rescued", 1.0, [{"name": "Gtr", "file": str(d / "Gtr.wav")}])
    ok("a draft rescued from an earlier take leaves it alone",
       a.suggest_take_name() == "Ogon")
    a.set_next_take_name("")

    def plain(choices):
        """A list of song choices as song and go only."""
        return [{"song": c["song"], "go": c["go"]} for c in choices]

    # Naming a take offers the songs already played, as the name it would get.
    ok("the songs of the rehearsal in progress, as the next go at each",
       plain(a.song_choices()["here"]) == [{"song": "Polyn", "go": 3},
                                           {"song": "Vesna", "go": 2},
                                           {"song": "Rescued", "go": 2}])
    ok("each with the number of its latest take",
       [c["last_take"] for c in a.song_choices()["here"]] == [2, 3, 4])
    ok("the take being renamed keeps its own go at its own song",
       plain(a.song_choices(str(folder), 2)["here"])[0] == {"song": "Polyn", "go": 2})
    ok("nothing to name after with no rehearsal and no library",
       fresh_api(tmp / "nothing")[1].song_choices() == {"here": [], "other": []})

    print("\n[8b] A take can arrive with marks already on it")
    # Marks made on the review screen, before the take had a folder, travel
    # with keep_take rather than being written as they are placed.
    d = folder / "_drafts" / "take 9"
    write_wav(d / "Gtr.wav", 100, seconds=1.0)
    a._session["take_counter"] = 9
    with_marks = a.keep_take(
        9, str(d), "Marked on review", 1.0,
        [{"name": "Gtr", "file": str(d / "Gtr.wav")}],
        [{"at": 0.5, "note": "the good bit", "label_id": 2},
         {"at": 2.25, "note": "", "label_id": 1}],
    )
    ok("saved with its marks", with_marks["ok"])
    marks = with_marks["take"]["markers"]
    ok("both are there, in order", [m["at"] for m in marks] == [0.5, 2.25])
    ok("with their notes", marks[0]["note"] == "the good bit")
    ok("and their labels", marks[0]["label_id"] == 2 and marks[1]["label_id"] == 1)
    ok("and they survive a read from disk",
       [m["at"] for m in a.get_rehearsal(str(folder))["takes"][-1]["markers"]]
       == [0.5, 2.25])

    # A take saved the ordinary way still starts clean.
    keep(10, "Plain")
    ok("a take saved without marks has none",
       a.get_rehearsal(str(folder))["takes"][-1]["markers"] == [])

    print("\n[8c] Names in any script, and renaming what is playing")
    # session.json and config.json were written in the system's code page.
    # On Windows that is cp1252, which has no Cyrillic: renaming a take
    # "Полынь" raised UnicodeEncodeError and nothing was renamed.
    from rehearsal_recorder.store.importer import import_all
    from rehearsal_recorder.store.library import Library

    _, ru = fresh_api(tmp / "names")
    ru.start_rehearsal("Names", 0, SR, [{"name": "Gtr", "channel": 1}])
    ru_folder = Path(ru._session["folder"])
    d = ru_folder / "_drafts" / "take 1"
    write_wav(d / "Gtr.wav", 100, seconds=1.0)
    first = ru.keep_take(1, str(d), "Take 1", 1.0,
                         [{"name": "Gtr", "file": str(d / "Gtr.wav")}])
    renamed = ru.rename_take(str(ru_folder), 1, "Полынь")
    ok("a take can be named in Cyrillic", renamed.get("ok"))
    ok("and the name is kept, readable back",
       ru._lib.rehearsal(ru_folder)["takes"][0]["name"] == "Полынь 1")
    reopened = Library(ru.recordings_dir)
    ok("from the file on disk too, whatever the system's code page",
       reopened.rehearsal(ru_folder)["takes"][0]["name"] == "Полынь 1")
    reopened.close()

    # The rehearsal screen plays the take it offers to rename, and Windows
    # will not rename a folder holding a mapped file — the folder stayed
    # "01 - Take 1" without a word.
    ru.player_open(renamed["take"]["tracks"])
    again = ru.rename_take(str(ru_folder), 1, "Весна")
    ok("renaming the take that is playing renames its folder too",
       again.get("ok")
       and Path(again["take"]["tracks"][0]["file"]).parent.name == "01 - Весна 1"
       and Path(again["take"]["tracks"][0]["file"]).exists())

    ru.player_open(again["take"]["tracks"])
    whole = ru.rename_rehearsal(str(ru_folder), "Репетиция")
    ok("and so does renaming the rehearsal it is in",
       whole.get("ok") and Path(whole["folder"]).exists()
       and ru._lib.rehearsal(whole["folder"])["name"] == "Репетиция")
    ru.player_close()

    names_cfg = ru.save_default_tracks({"tracks": [{"name": "Гитара", "channel": 1}]})
    ok("the config takes Cyrillic track names",
       names_cfg.get("ok")
       and "Гитара" in (tmp / "names" / "config.json").read_bytes().decode("utf-8"))

    # A file an older version wrote on Windows is in cp1252. Reading it as
    # UTF-8 alone would make the rehearsal vanish from History.
    legacy = ru.recordings_dir / "Café - 2026-08-01 19-00"
    legacy.mkdir()
    (legacy / "session.json").write_bytes(
        json.dumps({"name": "Café", "takes": []}, ensure_ascii=False).encode("cp1252"))
    import_all(ru._lib, ru._cloud_dir)
    ok("a session.json an older version wrote is still read",
       (ru._lib.rehearsal(legacy) or {}).get("name") == "Café")

    print("\n[9] Renaming")
    r = a.rename_take(str(folder), 1, "Polyn (best)")
    ok("take renamed", r["ok"])
    ok("its file still exists", Path(r["take"]["tracks"][0]["file"]).exists())
    ok("the folder on disk was renamed too",
       any(p.name.startswith("01 - Polyn (best)") for p in folder.iterdir()))

    # A rename to the take's own name, or only a case variant of it, must
    # not chase it into "... (2)": _unique_path saw the take's own folder as
    # already taken (it is — it's itself) and moved it sideways every time.
    _, rn = fresh_api(tmp / "rename_own")
    rn.start_rehearsal("Case", 0, SR, [{"name": "Gtr", "channel": 1}])
    rn_folder = Path(rn._session["folder"])
    d9 = rn_folder / "_drafts" / "take 1"
    write_wav(d9 / "Gtr.wav", 100, seconds=1.0)
    rn.keep_take(1, str(d9), "Polyn", 1.0, [{"name": "Gtr", "file": str(d9 / "Gtr.wav")}])

    unchanged = rn.rename_take(str(rn_folder), 1, "Polyn")
    ok("renaming a take to the name it already has succeeds", unchanged.get("ok"))
    ok("its folder is unchanged",
       Path(unchanged["take"]["tracks"][0]["file"]).parent.name == "01 - Polyn 1")
    ok("and no '(2)' folder was created",
       not any(p.name == "01 - Polyn 1 (2)" for p in rn_folder.iterdir()))

    # A separate take, so the case-only rename starts from "01 - Polyn 1"
    # rather than whatever the check above left behind.
    _, rn2 = fresh_api(tmp / "rename_case")
    rn2.start_rehearsal("Case2", 0, SR, [{"name": "Gtr", "channel": 1}])
    rn2_folder = Path(rn2._session["folder"])
    d9b = rn2_folder / "_drafts" / "take 1"
    write_wav(d9b / "Gtr.wav", 100, seconds=1.0)
    rn2.keep_take(1, str(d9b), "Polyn", 1.0, [{"name": "Gtr", "file": str(d9b / "Gtr.wav")}])

    cased = rn2.rename_take(str(rn2_folder), 1, "POLYN")
    ok("renaming to a case-only variant succeeds", cased.get("ok"))
    ok("the folder's name takes the new case",
       Path(cased["take"]["tracks"][0]["file"]).parent.name == "01 - POLYN 1")
    ok("and no '(2)' folder exists",
       not any(p.name in ("01 - Polyn 1 (2)", "01 - POLYN 1 (2)") for p in rn2_folder.iterdir()))

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
    a.add_take_marker(str(new_folder), 1, 12.5, "bridge falls apart", 3)
    a.add_take_marker(str(new_folder), 1, 3.25)
    markers = a.get_rehearsal(str(new_folder))["takes"][0]["markers"]
    ok("markers stored in order", [m["at"] for m in markers] == [3.25, 12.5])
    ok("the note is kept", markers[1]["note"] == "bridge falls apart")
    ok("the label is kept", markers[1]["label_id"] == 3)
    ok("a bare marker gets the first label",
       markers[0]["label_id"] == 1 and markers[0]["note"] == "")

    a.update_take_marker(str(new_folder), 1, 3.25, "nice ending", 2)
    edited = a.get_rehearsal(str(new_folder))["takes"][0]["markers"][0]
    ok("editing a marker keeps its position", edited["at"] == 3.25)
    ok("and applies the new note and label",
       edited["note"] == "nice ending" and edited["label_id"] == 2)

    a.add_take_marker(str(new_folder), 1, 3.25, "changed my mind", 4)
    same_spot = a.get_rehearsal(str(new_folder))["takes"][0]["markers"]
    ok("marking the same spot replaces, not duplicates", len(same_spot) == 2)
    ok("with the newer note", same_spot[0]["note"] == "changed my mind")

    a.remove_take_marker(str(new_folder), 1, 12.5)
    ok("marker removed",
       [m["at"] for m in a.get_rehearsal(str(new_folder))["takes"][0]["markers"]]
       == [3.25])

    # Rehearsals recorded before markers had notes stored plain numbers, in
    # a session.json the importer brings in.
    old_markers = a.recordings_dir / "Old marks - 2026-08-02 19-00"
    old_markers.mkdir()
    (old_markers / "session.json").write_text(json.dumps({
        "name": "Old marks", "created_at": "2026-08-02T19:00:00",
        "samplerate": SR, "tracks": [{"name": "Gtr", "channel": 1}],
        "takes": [{"take_number": 1, "name": "Take 1", "duration_sec": 10.0,
                   "tracks": [], "markers": [7.5, 1.25]}],
    }), encoding="utf-8")
    import_all(a._lib, a._cloud_dir)
    upgraded = a.get_rehearsal(str(old_markers))["takes"][0]["markers"]
    ok("old numeric markers still load",
       [m["at"] for m in upgraded] == [1.25, 7.5])
    ok("and come back as proper markers",
       all(m["label_id"] == 1 and m["note"] == "" for m in upgraded))
    a._lib.forget_rehearsal(old_markers)
    old_markers.rmdir()

    print("\n[11] Sharing to the cloud")
    cloud = tmp / "Drive" / "Band"
    a.set_cloud_dir(str(cloud))
    ok("the cloud folder is remembered",
       a.get_settings()["cloud_dir"] == str(cloud))

    detail = a.get_rehearsal(str(new_folder))
    first = detail["takes"][0]
    shared = a._copy_to_cloud(str(new_folder), first["take_number"], "both")
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
    again = a._copy_to_cloud(str(new_folder), first["take_number"], "mix")
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
    packed = a._copy_to_cloud(str(new_folder), first["take_number"], "both")
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
        deep_take = new_folder / "24 - Deep take"
        deep_take.mkdir(parents=True, exist_ok=True)
        write_wav(deep_take / "Gtr.wav", 1500, seconds=1.0, depth=24)
        a._lib.add_take(new_folder, {
            "take_number": 24, "name": "Deep take", "duration_sec": 1.0,
            "tracks": [{"name": "Gtr", "file": str(deep_take / "Gtr.wav")}],
            "markers": [],
        })
        deep_shared = a._copy_to_cloud(str(new_folder), 24, "tracks")
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
    a._copy_to_cloud(str(new_folder), take["take_number"], "mix")
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
    ok("and neither is another subfolder of the cloud folder",
       not cloudmod.is_current(take, "mix", volumes, "wav", "Elsewhere"))

    renamed = dict(take, name="Something else")
    ok("a renamed take is not current",
       not cloudmod.is_current(renamed, "mix", volumes, "wav", where))
    # A crop changes nothing else in this record — same name, same format,
    # same folder, same balance — and share_take reads the take's files
    # outside any transaction, so a copy that started before a crop can
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
        step=lambda folder, n, what=None: done.append((folder, n)),
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
        step=lambda folder, n, what=None: (
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
    # The depth lives with the rehearsal, because the raw bytes on disk do not
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
    import_all(b._lib, b._cloud_dir)
    removed = b.cleanup_empty_rehearsals()["removed"]
    ok("the empty one is gone", removed == 1 and not stale.exists())

    print("\n[11e2] Each take can go to the cloud or not, whatever the setting")
    # The review screen says whether this take will be sent and lets that be
    # turned the other way for this one take: a false start kept anyway need
    # not go up, and the one good take of an evening can, with sending off.
    _, c = fresh_api(tmp / "choice")
    c.set_cloud_dir(str(tmp / "choice" / "Drive"))
    c.set_cloud_format("wav")
    c.start_rehearsal("Choice", None, SR, [{"name": "A", "channel": 1}], 16)
    choice_folder = Path(c._session["folder"])

    def keep_one(number, send):
        d = choice_folder / "_drafts" / f"take {number}"
        write_wav(d / "one.wav", 900)
        c._session["take_counter"] = number
        return c.keep_take(number, str(d), f"Take {number}", 2.0,
                           [{"name": "A", "file": str(d / "one.wav")}], [], send)

    c.set_auto_publish(True, "mix")
    keep_one(1, False)
    ok("with sending on, a take kept with 'not this one' is not queued",
       c.session_state()["cloud_queue"] == {})
    c.set_cloud_format("flac")  # a change that re-sends the whole rehearsal
    ok("and a later re-send of the rehearsal leaves it out too",
       1 not in c.session_state()["cloud_queue"])
    while c._cloud_queue.run_next():
        pass
    ok("so it never reaches the cloud folder",
       not c.get_rehearsal(str(choice_folder))["takes"][0]["cloud"])

    c.set_auto_publish(False)
    keep_one(2, True)
    ok("with sending off, a take kept with 'send this one' is queued",
       c.session_state()["cloud_queue"] == {2: "queued"})
    while c._cloud_queue.run_next():
        pass
    sent = c.get_rehearsal(str(choice_folder))["takes"][1]
    ok("and it is sent", Path(sent.get("cloud", {}).get("mix", "")).exists())

    keep_one(3, None)
    ok("left to the setting, it follows the setting",
       3 not in c.session_state()["cloud_queue"])

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
    real_copy = a._copy_to_cloud

    def boom(*args, **kwargs):
        raise OSError("sync folder went away")

    a._copy_to_cloud = boom
    try:
        a.keep_take(2, str(solo2), "Boom", 2.0,
                    [{"name": "A", "file": str(solo2 / "two.wav")}], [])
        a._cloud_queue.run_next()
    finally:
        a._copy_to_cloud = real_copy
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
    ok("and the take was not copied", not take4["cloud"])
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
        a._copy_to_cloud(str(folder9), 9, "mix")
    finally:
        apimod.mixdown = real_mixdown
        # The later [11g]/[11h] sections assume auto-publish is on, same as
        # every other check in this section left it — don't leave it off
        # behind us just because this one check needed it off.
        a.set_auto_publish(prior_publish["auto_publish"], prior_publish["auto_publish_what"])

    take9 = next(t for t in a.get_rehearsal(str(folder9))["takes"]
                 if t["take_number"] == 9)
    ok("a rename during the mix is not reverted by it", take9["name"] == "After 2")
    ok("and the copy still records the name it was written under",
       take9["cloud"]["source"]["name"] == "Before 1")
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
        a._copy_to_cloud(str(folder9), 9, "mix")
    finally:
        apimod.mixdown = real_mixdown

    take9 = next(t for t in a.get_rehearsal(str(folder9))["takes"]
                 if t["take_number"] == 9)
    ok("the copy records the balance it was rendered with",
       take9["cloud"]["source"]["volumes"] == {"A": 0.9})
    ok("so a fader moved during the mix leaves it not current",
       not cloudmod.is_current(take9, "mix", a.get_settings()["volumes"], "wav",
                               a._cloud_target(folder9)))

    # A listing can run while the worker is writing. The rename is one
    # transaction in the database, so a reader sees all of it or none of it,
    # and nothing is left half done beside the rehearsal.
    a.rename_take(str(folder9), 9, "Renamed once more")
    renamed9 = a._lib.take(folder9, 9)
    ok("the new name is in the database once the rename is done",
       renamed9["name"] == "Renamed once more 1"
       and all(Path(t["file"]).exists() for t in renamed9["tracks"]))
    ok("and no session.json is written beside it",
       not list(Path(folder9).glob("session.json*")))

    # Restoring auto-publish above re-queued every take of the still-open
    # session (that is what turning it on does) — drain that before handing
    # off to the next section, which should start from an empty queue.
    while a._cloud_queue.run_next():
        pass

    print("\n[11g] A rename moves the copy, and a new balance sends it again")
    folder = Path(a.session_state()["folder"])
    old_mix = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"])
    a.rename_take(str(folder), 1, "Polyn again")
    ok("renaming does not mix the take again",
       a.session_state()["cloud_queue"] == {})
    new_mix = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"])
    ok("the copy is named after the new name",
       "Polyn again" in new_mix.name and new_mix.exists())
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
    # would leave them under a name that is no longer anybody's.
    old_sub = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"]).parent
    folder = Path(a.rename_rehearsal(str(folder), "Late evening")["folder"])
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("renaming the rehearsal moves its copies to a folder under the new name",
       Path(take["cloud"]["mix"]).parent.name.startswith("Late evening")
       and Path(take["cloud"]["mix"]).exists())
    ok("without mixing them again, and without the old folder left behind",
       a.session_state()["cloud_queue"] == {} and not old_sub.exists())

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
    target = apimod._cloud_subfolder(a._cloud_dir, folder)
    plain_mixdown = apimod.mixdown
    asked = []

    def watch_mixdown(tracks, out_path, volumes=None, progress=None):
        asked.append(Path(out_path))
        return plain_mixdown(tracks, out_path, volumes, progress=progress)

    apimod.mixdown = watch_mixdown
    try:
        res = a._copy_to_cloud(str(folder), 1, "both")
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

    def die_midway(tracks, out_path, volumes=None, progress=None):
        # What being killed mid-mixdown leaves on disk: a real file, opened
        # and part written.
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_bytes(b"RIFF" + b"\0" * 64)
        raise OSError("the app was closed")

    apimod.mixdown = die_midway
    try:
        a._copy_to_cloud(str(folder), 1, "mix")
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
                               a.get_settings()["volumes"], "wav",
                               a._cloud_target(folder)))

    for p in left:
        p.unlink()
    a._enqueue_publish(folder, 1)
    while a._cloud_queue.run_next():
        pass
    ok("and the next pass puts a whole one there",
       Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"]).exists())

    # The worker is a daemon thread: unless it is told, it is killed at
    # interpreter exit wherever it happens to be.
    idle = cloudmod.PublishQueue(step=lambda f, n, what=None: None,
                                 paused=lambda: False)
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

    print("\n[11m] A copy in the cloud follows its take, however it got there")
    # Sending on its own decides whether a new take goes up; it has no say in
    # what happens to one that is already there. A take that is renamed,
    # cropped or deleted takes its copy with it — sent by hand or not, from
    # the rehearsal still open or one long finished — and a rename moves the
    # files rather than mixing them again.
    tmpc = Path(tempfile.mkdtemp())
    _, fc = fresh_api(tmpc)
    band = tmpc / "Drive" / "Band"
    fc.set_cloud_dir(str(band))
    fc.set_auto_publish(False, "mix")
    fc.start_rehearsal("Tuesday", 0, SR, [{"name": "Gtr", "channel": 1}])
    cf = Path(fc._session["folder"])
    for number, name in ((1, "Polyn"), (2, "Vesna")):
        draft = cf / "_drafts" / f"take {number}"
        write_wav(draft / "Gtr.wav", 1000 * number, seconds=3.0)
        fc._session["take_counter"] = number
        fc.keep_take(number, str(draft), name, 3.0,
                     [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    fc._copy_to_cloud(str(cf), 1, "both")
    fc._copy_to_cloud(str(cf), 2, "mix")

    def drain_c():
        while fc._cloud_queue.run_next():
            pass

    def copy_of(n, where=None):
        take = next(t for t in fc.get_rehearsal(str(where or cf))["takes"]
                    if t["take_number"] == n)
        return take, take.get("cloud") or {}

    def current(n, what, where=None):
        where = where or cf
        take, _ = copy_of(n, where)
        return cloudmod.is_current(take, what, fc.get_settings()["volumes"],
                                   "wav", fc._cloud_target(where))

    def listing():
        return sorted(str(p.relative_to(band)).replace("\\", "/")
                      for p in band.rglob("*")) if band.exists() else []

    def is_file(path):
        """A file that is there: an empty path is the current folder, not one."""
        return bool(path) and Path(path).is_file()

    def is_dir(path):
        return bool(path) and Path(path).is_dir()

    _, before = copy_of(1)
    mix_written = Path(before["mix"]).stat().st_mtime_ns
    fc.rename_take(str(cf), 1, "Polyn best")
    _, after = copy_of(1)
    ok("a take sent by hand, with sending off, is renamed in the cloud too",
       Path(after.get("mix", "")).name == "01 - Polyn best 1.wav"
       and is_file(after["mix"]) and not Path(before["mix"]).exists())
    ok("its tracks as well as its mix",
       Path(after.get("tracks", "")).name == "01 - Polyn best 1"
       and is_dir(after["tracks"]) and not Path(before["tracks"]).exists())
    ok("by moving the files, not by mixing them again",
       is_file(after.get("mix")) and "Polyn best" in after["mix"]
       and Path(after["mix"]).stat().st_mtime_ns == mix_written
       and fc.session_state()["cloud_queue"] == {})
    ok("and the copy still counts as current", current(1, "both"))

    fc.finish_rehearsal()
    old_sub = band / cf.name
    cf = Path(fc.rename_rehearsal(str(cf), "Friday")["folder"])
    new_sub = band / cf.name
    ok("a finished rehearsal renamed from History moves its cloud folder",
       new_sub.is_dir() and not old_sub.exists() and old_sub != new_sub)
    ok("with every copy in it, and the records pointing there",
       all(Path(v).exists() and Path(v).parent == new_sub
           for n in (1, 2) for k, v in copy_of(n)[1].items() if k in ("mix", "tracks")))
    ok("still current, mixed no more times than before",
       current(1, "both") and current(2, "mix") and fc._cloud_queue.states(str(cf)) == {})

    cropped = fc.crop_take(str(cf), 1, 0.5, 2.0)
    drain_c()
    take1, now1 = copy_of(1)
    ok("a cropped take sent by hand is sent again, with sending off",
       cropped["ok"] and is_file(now1.get("mix")))
    ok("in the shape it had: the tracks come back with the mix",
       is_dir(now1.get("tracks")))
    frames = 0
    if is_file(now1.get("mix")):
        with wave.open(now1["mix"]) as w:
            frames = w.getnframes()
    ok("and what is there is the cropped take",
       abs(frames / SR - take1["duration_sec"]) < 0.01
       and take1["duration_sec"] < 2.0)

    mix2 = Path(copy_of(2)[1].get("mix", ""))
    fc.delete_take(str(cf), 2)
    ok("a deleted take takes its copy out of the cloud",
       mix2.name and not mix2.exists())
    ok("and leaves the other take's alone",
       is_file(copy_of(1)[1].get("mix")))

    listed = next(r for r in fc.list_rehearsals() if r["folder"] == str(cf))
    ok("History says how many of a rehearsal's takes are in the cloud, "
       "for the question before deleting it", listed.get("in_cloud") == 1)
    fc.delete_rehearsal(str(cf))
    ok("a deleted rehearsal takes its copies, and its emptied folder, with it",
       not new_sub.exists())
    ok("and nothing of it is left in the cloud folder", listing() == [])

    # A copy of the rehearsal still open, sent with sending on, is mixed
    # again when the balance moves — but not stripped down to what sending
    # on its own would send: somebody put the tracks there by hand.
    fc.set_auto_publish(True, "mix")
    fc.start_rehearsal("Saturday", 0, SR, [{"name": "Gtr", "channel": 1}])
    sf = Path(fc._session["folder"])
    draft = sf / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1500, seconds=3.0)
    fc._session["take_counter"] = 1
    fc.keep_take(1, str(draft), "Ogon", 3.0,
                 [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    drain_c()
    fc._copy_to_cloud(str(sf), 1, "both")
    fc.save_mix({"Gtr": 0.4})
    drain_c()
    _, redone = copy_of(1, sf)
    ok("a new balance mixes it again without dropping the tracks sent by hand",
       is_file(redone.get("mix")) and is_dir(redone.get("tracks"))
       and current(1, "both", sf))
    fc.set_auto_publish(False, "mix")
    drain_c()
    fc.save_mix({"Gtr": 0.7})
    drain_c()
    ok("with sending off, a take sent by hand is mixed again with a new balance too",
       current(1, "both", sf))

    # A copy that is not where its record says — a sync client that has not
    # caught up, a file moved by hand — cannot be moved, so it is made again.
    Path(redone["mix"]).unlink()
    fc.rename_take(str(sf), 1, "Zima")
    drain_c()
    _, remade = copy_of(1, sf)
    ok("a copy that could not be moved is made again under the new name",
       Path(remade.get("mix", "")).name == "01 - Zima 1.wav"
       and is_file(remade["mix"]) and is_dir(remade.get("tracks")))

    # A take deleted while its copy is being made: the copy finishes after it
    # and has no take left to belong to.
    real_set = fc._lib.set_cloud_copy

    def deleted_meanwhile(folder, number, shared, cloud_dir):
        fc._lib.delete_take(folder, number)
        return real_set(folder, number, shared, cloud_dir)

    fc._lib.set_cloud_copy = deleted_meanwhile
    try:
        fc._copy_to_cloud(str(sf), 1, "both")
    finally:
        fc._lib.set_cloud_copy = real_set
    ok("a copy that finishes after its take was deleted is not left behind",
       not any(p.name.startswith("01 - Zima") for p in band.rglob("*")))

    print("\n[11n] Emptied folders already in the cloud are swept up")
    # Earlier versions left a rehearsal's folder behind in the cloud when its
    # copies moved out of it. Only folders that are empty and are named the
    # way the app names them go: the cloud folder is the band's, and anything
    # else in it is somebody's.
    for name in ("Tuesday jam - 2026-09-22 19-00", "Old - 2026-09-01 10-00 (2)",
                 "Band photos", "Soundcheck - 2026-09-12 18-30"):
        (band / name).mkdir(parents=True, exist_ok=True)
    (band / "Soundcheck - 2026-09-12 18-30" / "notes.txt").write_text("keep")
    fc._sweep_empty_cloud_dirs()
    ok("an emptied rehearsal folder is swept up",
       not (band / "Tuesday jam - 2026-09-22 19-00").exists()
       and not (band / "Old - 2026-09-01 10-00 (2)").exists())
    ok("a folder with something in it stays",
       (band / "Soundcheck - 2026-09-12 18-30" / "notes.txt").exists())
    ok("and so does an empty one the app did not name",
       (band / "Band photos").is_dir())

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
        import_all(d._lib, d._cloud_dir)
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

    # The rehearsal's own overview groups its takes the same way, so it is
    # told which takes each song is rather than working the rule out again.
    opened = d.get_rehearsal(str(tmp4 / "Rec" / "Half - 2026-09-08 19-00"))
    ok("an opened rehearsal says which takes each song is",
       [(s["name"], s["take_numbers"]) for s in opened["songs"]]
       == [("Polyn", [2, 3])])

    d.start_rehearsal("Live", 0, SR, [{"name": "Gtr", "channel": 1}])
    live_folder = Path(d._session["folder"])
    for number, name in ((1, "Vesna"), (2, "Take 2"), (3, "Vesna 2")):
        draft = live_folder / "_drafts" / f"take {number}"
        write_wav(draft / "Gtr.wav", 100, seconds=0.5)
        d._session["take_counter"] = number
        d.keep_take(number, str(draft), name, 0.5,
                    [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    ok("so does the one being recorded",
       [(s["name"], s["take_numbers"]) for s in d.session_state()["songs"]]
       == [("Vesna", [1, 3])])
    ok("and the history list keeps its count",
       all("takes" in s for s in by_name["Songs"]["songs"]))

    print("\n[16a] The next take knows how long the last go at its song ran")
    # The recording screen puts "Vesna took 2:21 last time" under its clock,
    # so the band can see how far into the song they are. The song is the
    # next take's name less its attempt number — the same rule as above, so
    # the interface is handed the answer rather than a second copy of it.
    ok("the next take is another go at Vesna",
       d.session_state()["next_take_name"] == "Vesna"
       and d.session_state()["next_take_go"] == 5)
    ok("so it is told how long the last go at Vesna ran",
       d.session_state().get("last_attempt") == {"song": "Vesna", "duration_sec": 0.5})
    draft = live_folder / "_drafts" / "take 4"
    write_wav(draft / "Gtr.wav", 100, seconds=0.25)
    d._session["take_counter"] = 4
    d.keep_take(4, str(draft), "vesna 3", 0.25,
                [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    ok("the latest go, not the first, and spelled another way it is still that song",
       d.session_state().get("last_attempt") == {"song": "Vesna", "duration_sec": 0.25})
    draft = live_folder / "_drafts" / "take 5"
    write_wav(draft / "Gtr.wav", 100, seconds=0.25)
    d._session["take_counter"] = 5
    d.keep_take(5, str(draft), "Take 5", 0.25,
                [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    ok("a take nobody named is no song, so there is nothing to compare with",
       d.session_state()["next_take_name"] == "Take 6"
       and "last_attempt" in d.session_state()
       and d.session_state()["last_attempt"] is None)

    print("\n[16b] And how much of the disk it is using")
    # Walked rather than estimated from the durations: a take encoded
    # differently, or one that never finished, makes any guess wrong.
    sized = past_rehearsal("Sized", "2026-09-07T19:00:00", ["Polyn"])
    def bytes_of(name):
        return {r["name"]: r for r in d.list_rehearsals()}[name]["disk_bytes"]

    # Its takes say a minute of audio, but nothing of it is on disk yet.
    empty_handed = bytes_of("Sized")
    ok("a folder is measured, not guessed at", empty_handed == 0)

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

    print("\n[16c] The evening as it went, and last time on the setup screen")
    # History draws each rehearsal as a strip of its takes and the setup
    # screen goes over the last one song by song. Marks are few in practice,
    # so both stand on what every take has: its song, its place and its length.
    tmp5 = Path(tempfile.mkdtemp())
    _, e = fresh_api(tmp5)

    def rehearsal(name, created_at, takes):
        """takes: (name, seconds, marker kinds)."""
        folder = tmp5 / "Rec" / f"{name} - {created_at[:10]} {created_at[11:13]}-00"
        folder.mkdir(parents=True)
        (folder / "session.json").write_text(json.dumps({
            "name": name, "created_at": created_at, "samplerate": SR,
            "tracks": [{"name": "Gtr", "channel": 1}],
            "takes": [
                {"take_number": i + 1, "name": n, "duration_sec": sec, "tracks": [],
                 "markers": [{"at": 1.0, "kind": k, "note": ""} for k in kinds]}
                for i, (n, sec, kinds) in enumerate(takes)
            ],
        }))
        import_all(e._lib, e._cloud_dir)
        return str(folder)

    ok("with no rehearsal at all there is no last time",
       e.last_time() == {"last": None, "not_played": [], "earlier": [], "count": 0})

    older = rehearsal("First", "2026-08-25T19:00:00", [
        ("Polyn", 200, ()), ("Doroga", 230, ()), ("Doroga 2", 240, ("good",))])
    mid = rehearsal("New songs", "2026-09-19T15:00:00", [
        ("Dym", 280, ()), ("Dym 2", 270, ("good",)), ("Ptaha", 250, ())])
    last = rehearsal("Tuesday jam", "2026-09-22T19:00:00", [
        ("Polyn", 185, ("issue",)), ("Polyn 2", 198, ("good", "redo")),
        ("Vesna", 250, ()), ("Take 4", 130, ()), ("polyn 3", 190, ())])
    rehearsal("Soundcheck", "2026-09-26T18:00:00", [("Take 1", 140, ()), ("Take 2", 165, ())])

    runs = {r["name"]: r["runs"] for r in e.list_rehearsals()}
    ok("history gets the evening as runs of goes at a song, in the order played",
       [(r["song"], len(r["takes"])) for r in runs["Tuesday jam"]]
       == [("Polyn", 2), ("Vesna", 1), (None, 1), ("Polyn", 1)])
    ok("each go with its length, and whether it is starred; a good mark stars nothing",
       runs["Tuesday jam"][0]["takes"]
       == [{"duration_sec": 185, "starred": False}, {"duration_sec": 198, "starred": False}])
    ok("a song spelled another way is still the one the song list names",
       runs["Tuesday jam"][-1]["song"] == "Polyn")
    ok("and takes nobody named are one run with no song",
       runs["Soundcheck"] == [{"song": None, "takes": [
           {"duration_sec": 140, "starred": False}, {"duration_sec": 165, "starred": False}]}])

    lt = e.last_time()
    ok("last time is the newest rehearsal that played a song, past a soundcheck",
       lt["last"]["folder"] == last and lt["last"]["name"] == "Tuesday jam")
    ok("with every take as the player needs it, and its songs",
       [t["name"] for t in lt["last"]["takes"]]
       == ["Polyn 2", "Polyn 3", "Vesna 1", "Take 4", "Polyn 4"]
       and all("tracks" in t and "markers" in t for t in lt["last"]["takes"])
       and [(s["name"], s["take_numbers"]) for s in lt["last"]["songs"]]
       == [("Polyn", [1, 2, 5]), ("Vesna", [3])])
    ok("and its evening, drawn the same way as in history",
       lt["last"]["runs"] == runs["Tuesday jam"])
    ok("songs it did not play come from the rehearsals before it, the latest first",
       [(s["name"], s["rehearsal"], s["goes"]) for s in lt["not_played"]]
       == [("Dym", "New songs", 2), ("Ptaha", "New songs", 1), ("Doroga", "First", 2)])
    ok("each with its last go, ready to play",
       [s["take"]["name"] for s in lt["not_played"]] == ["Dym 2", "Ptaha 1", "Doroga 2"]
       and lt["not_played"][0]["folder"] == mid and lt["not_played"][2]["folder"] == older)
    ok("a song it did play is not among them, however long ago it was first played",
       "Polyn" not in {s["name"] for s in lt["not_played"]})
    ok("the other rehearsals follow, newest first, the soundcheck included",
       [r["name"] for r in lt["earlier"]] == ["Soundcheck", "New songs", "First"]
       and lt["earlier"][0]["take_count"] == 2
       and lt["earlier"][0]["total_duration_sec"] == 305)
    ok("and how many there are in all", lt["count"] == 4)

    # Naming a take in one of them offers the whole repertoire.
    ch = e.song_choices(last)
    ok("naming a take offers what its rehearsal played, as the next go at each",
       plain(ch["here"]) == [{"song": "Polyn", "go": 5},
                             {"song": "Vesna", "go": 2}])
    ok("and every other song, the most recently played first, each at its next go",
       plain(ch["other"]) == [{"song": "Dym", "go": 3}, {"song": "Ptaha", "go": 2},
                              {"song": "Doroga", "go": 3}])
    ok("a take being renamed keeps its own go at its own song",
       e.song_choices(last, 2)["here"][0]["go"] == 3
       and e.song_choices(last, 5)["here"][0]["go"] == 4)
    ok("an older rehearsal is offered the songs played after it too",
       [c["song"] for c in e.song_choices(older)["other"]] == ["Vesna", "Dym", "Ptaha"]
       and plain(e.song_choices(older)["here"])[1] == {"song": "Doroga", "go": 3})
    ok("with no rehearsal in progress every song is another's",
       e.song_choices()["here"] == []
       and [c["song"] for c in e.song_choices()["other"]]
       == ["Polyn", "Vesna", "Dym", "Ptaha", "Doroga"])

    # A folder that has gone is nothing to play from.
    import shutil as _shutil
    _shutil.move(mid, str(tmp5 / "elsewhere"))
    lt = e.last_time()
    ok("a rehearsal not on disk gives no songs to play",
       [s["name"] for s in lt["not_played"]] == ["Doroga"])
    ok("but is still listed among the others, as missing",
       [(r["name"], r["missing"]) for r in lt["earlier"]][1] == ("New songs", True))

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
        [{"at": 0.5, "note": "count-in", "label_id": 1},
         {"at": 2.0, "note": "here", "label_id": 2},
         {"at": 3.8, "note": "stopped", "label_id": 3}],
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
    c._copy_to_cloud(folder, 1, "mix")
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
    # record in the database yet.
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

    whole_rows, frames_whole, _ = wav_peaks(tmp8 / "half.wav", buckets=8)
    whole = whole_rows[0]
    ok("the whole file is half silence and half tone",
       whole[0] == 0 and whole[7] > 0.2)

    loud_rows, frames_loud, _ = wav_peaks(tmp8 / "half.wav", buckets=8,
                                     start_sec=1.0, end_sec=2.0)
    loud = loud_rows[0]
    ok("asked for the second half, every bar is the tone",
       all(p > 0.2 for p in loud))
    quiet_rows, _, _ = wav_peaks(tmp8 / "half.wav", buckets=8,
                            start_sec=0.0, end_sec=1.0)
    quiet = quiet_rows[0]
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

    short_silent_rows, _, _ = wav_peaks(tmp9 / "short_window.wav", buckets=900,
                                   start_sec=0.0, end_sec=0.01)
    short_silent = short_silent_rows[0]
    ok("a window shorter than the bar count does not leak past its end",
       all(p == 0 for p in short_silent))

    print("\n[21] The history lives in the database")
    import logging
    import shutil as _shutil

    from sqlalchemy import text as _sql

    from rehearsal_recorder.store.db import (
        NEWER_DATABASE, LibraryUnavailable, database_path, make_engine,
    )

    class _Collect(logging.Handler):
        """Keeps what was logged, so it can be looked at — and so nothing
        falls through to Python's last-resort print while it is attached."""

        def __init__(self):
            super().__init__(logging.DEBUG)
            self.records = []

        def emit(self, record):
            self.records.append(record)

    api_log = logging.getLogger("rehearsal_recorder.api")

    tmp10 = Path(tempfile.mkdtemp())
    apimod10, h = fresh_api(tmp10)
    h.start_rehearsal("Stored", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    hf = Path(h._session["folder"])
    ok("a started rehearsal is in the database",
       h._lib.has(hf) and h._lib.rehearsal(hf)["name"] == "Stored")

    draft = hf / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1000, seconds=2.0)
    h._session["take_counter"] = 1
    kept = h.keep_take(1, str(draft), "Polyn", 2.0,
                       [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    ok("a kept take is in session_state without anything copied over",
       kept["ok"] and [t["name"] for t in h.session_state()["takes"]] == ["Polyn 1"])

    h.rename_take(str(hf), 1, "Polyn best")
    hf = Path(h.rename_rehearsal(str(hf), "Stored again")["folder"])
    h.add_take_marker(str(hf), 1, 0.5, "the riff", "good")
    h.crop_take(str(hf), 1, 0.0, 1.5)
    h.set_cloud_dir(str(tmp10 / "Cloud"))
    h._copy_to_cloud(str(hf), 1, "mix")
    stored = h._lib.take(hf, 1)
    ok("renames, markers, a crop and a copy all reach the database",
       stored["name"] == "Polyn best 1"
       and [m["at"] for m in stored["markers"]] == [0.5]
       and abs(stored["duration_sec"] - 1.5) < 0.01
       and Path(stored["cloud"].get("mix", "")).exists())

    # A publish that fails on the worker is seen by the rehearsal screen at
    # once: there is no copy in memory to bring up to date.
    draft = hf / "_drafts" / "take 2"
    write_wav(draft / "Gtr.wav", 1000, seconds=2.0)
    h._session["take_counter"] = 2
    h.keep_take(2, str(draft), "Polyn 2", 2.0,
                [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    cloud_setting = h._config.pop("cloud_dir")
    h._config["auto_publish"] = True
    h._publish_step(str(hf), 2)
    h._config["cloud_dir"], h._config["auto_publish"] = cloud_setting, False
    ok("a cloud error from the publishing step shows in session_state",
       "cloud folder" in (h.session_state()["takes"][1].get("cloud_error") or "").lower())

    h.delete_take(str(hf), 1)
    ok("a deleted take leaves the database",
       [t["take_number"] for t in h._lib.rehearsal(hf)["takes"]] == [2])
    ok("and no session.json was written anywhere along the way",
       not list(h.recordings_dir.rglob("session.json*")))

    # A folder deleted by hand, or on a drive that is not plugged in.
    h.finish_rehearsal()
    h.player_close()
    _shutil.rmtree(hf)
    item = next(r for r in h.list_rehearsals() if r["folder"] == str(hf))
    ok("a rehearsal whose folder is gone stays in History, marked",
       item["missing"] is True and item["take_count"] == 1)
    ok("and is not measured", item["disk_bytes"] == 0)
    ok("an existing one is not marked",
       all(r["missing"] is False for r in h.list_rehearsals() if r["folder"] != str(hf)))
    ok("it cannot be opened",
       h.get_rehearsal(str(hf)) == {"ok": False, "missing": True,
                                     "error": "The rehearsal's folder is not on disk"})

    h.start_rehearsal("Other", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    other = Path(h._session["folder"])
    draft = other / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1000, seconds=1.0)
    h._session["take_counter"] = 1
    h.keep_take(1, str(draft), "Kept", 1.0,
                [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    refused = h.forget_rehearsal(str(other))
    ok("the rehearsal in progress cannot be forgotten",
       not refused["ok"] and h._lib.has(other))

    # Files are moved first and the record written after. When the record
    # cannot be written, the move is undone: a folder nothing points at never
    # shows up anywhere.
    def refuse(*args, **kwargs):
        raise OSError("disk full")

    def raises(call):
        try:
            call()
        except OSError:
            return True
        return False

    draft = other / "_drafts" / "take 2"
    write_wav(draft / "Gtr.wav", 1000, seconds=1.0)
    h._session["take_counter"] = 2
    h._library.add_take = refuse
    try:
        failed = raises(lambda: h.keep_take(
            2, str(draft), "Unkept", 1.0,
            [{"name": "Gtr", "file": str(draft / "Gtr.wav")}]))
    finally:
        del h._library.add_take
    ok("a take whose record cannot be written stays a draft",
       failed and (draft / "Gtr.wav").exists()
       and not (other / "02 - Unkept 1").exists())

    take_dir = Path(h._lib.take(other, 1)["tracks"][0]["file"]).parent
    h._library.update_take = refuse
    try:
        failed = raises(lambda: h.rename_take(str(other), 1, "Renamed"))
    finally:
        del h._library.update_take
    ok("a take folder is renamed back when its record cannot be",
       failed and take_dir.is_dir() and not (other / "01 - Renamed 1").exists())

    h._library.move_rehearsal = refuse
    try:
        failed = raises(lambda: h.rename_rehearsal(str(other), "Moved"))
    finally:
        del h._library.move_rehearsal
    ok("and so is a rehearsal folder",
       failed and other.is_dir() and Path(h._session["folder"]) == other)
    h.finish_rehearsal()

    outside = tmp10 / "Somewhere else"
    outside.mkdir()
    ok("locating onto a folder outside the recordings folder is refused",
       h.locate_rehearsal(str(hf), str(outside))
       == {"ok": False, "error": "Pick a folder inside the recordings folder"})
    a_file = h.recordings_dir / "notes.txt"
    a_file.write_text("not a folder")
    ok("so is locating onto a file",
       not h.locate_rehearsal(str(hf), str(a_file))["ok"])
    ok("and onto another rehearsal's folder",
       h.locate_rehearsal(str(hf), str(other))
       == {"ok": False, "error": "That folder is already another rehearsal"})
    found = h.recordings_dir / "Found again"
    found.mkdir()
    located = h.locate_rehearsal(str(hf), str(found))
    ok("a real folder is accepted",
       located == {"ok": True, "folder": str(found)})
    ok("and the rehearsal opens again",
       h.get_rehearsal(str(found)).get("ok") is True
       and not h._lib.has(hf))

    _shutil.rmtree(found)
    ok("a missing rehearsal can be taken out of History",
       h.forget_rehearsal(str(found)) == {"ok": True}
       and all(r["folder"] != str(found) for r in h.list_rehearsals()))
    ok("once", h.forget_rehearsal(str(found))
       == {"ok": False, "error": "Rehearsal not found"})

    # A recordings folder a newer version has already migrated past.
    def newer_folder(path):
        path.mkdir(parents=True)
        engine = make_engine(database_path(path))
        with engine.begin() as c:
            c.execute(_sql("CREATE TABLE alembic_version "
                           "(version_num VARCHAR(32) NOT NULL)"))
            c.execute(_sql("INSERT INTO alembic_version VALUES ('9999')"))
        engine.dispose()
        return path

    newer = newer_folder(tmp10 / "Newer")
    collected = _Collect()
    api_log.addHandler(collected)
    try:
        before = h.recordings_dir
        switched = h.set_recordings_dir(str(newer))
    finally:
        api_log.removeHandler(collected)
    ok("switching to a folder a newer version opened is refused",
       switched == {"ok": False, "error": NEWER_DATABASE})
    ok("and the old folder stays in use",
       h.recordings_dir == before and h._lib.has(other))

    tmp11 = Path(tempfile.mkdtemp())
    newer_folder(tmp11 / "Rec")
    collected = _Collect()
    api_log.addHandler(collected)
    try:
        _, stuck = fresh_api(tmp11)
    finally:
        api_log.removeHandler(collected)
    ok("the app still starts on such a folder, and says why once",
       stuck.startup_problems()
       == [{"name": "LibraryUnavailable", "message": NEWER_DATABASE}]
       and stuck.startup_problems() == [])
    ok("the reason goes to the log, at ERROR",
       any(r.levelno == logging.ERROR and r.name == "rehearsal_recorder.api"
           for r in collected.records))
    try:
        stuck.list_rehearsals()
        listed = "listed"
    except LibraryUnavailable as e:
        listed = str(e)
    ok("History says the folder cannot be used", listed == NEWER_DATABASE)
    ok("and Settings still work",
       stuck.get_settings()["recordings_dir"] == str(tmp11 / "Rec"))

    tmp12 = Path(tempfile.mkdtemp())
    broken_dir = tmp12 / "Rec" / "Broken - 2026-09-04 19-00"
    broken_dir.mkdir(parents=True)
    (broken_dir / "session.json").write_text("{not json")
    collected = _Collect()
    api_log.addHandler(collected)
    try:
        _, damaged = fresh_api(tmp12)
    finally:
        api_log.removeHandler(collected)
    problems_seen = damaged.startup_problems()
    ok("a session.json that cannot be read is reported once, by folder",
       len(problems_seen) == 1 and broken_dir.name in problems_seen[0]["message"])
    ok("and left where it is", (broken_dir / "session.json").exists())

    # The config is written beside itself and swapped in, as session.json was.
    swaps = []
    real_replace = apimod10.os.replace

    def watch_replace(src, dst):
        swaps.append((Path(src).name, Path(dst).name))
        return real_replace(src, dst)

    apimod10.os.replace = watch_replace
    try:
        h.save_appearance("light", 1.25)
    finally:
        apimod10.os.replace = real_replace
    ok("config.json is written through config.json.writing",
       ("config.json.writing", "config.json") in swaps)
    ok("which is not left behind, and the file is whole",
       not apimod10.CONFIG_PATH.with_name("config.json.writing").exists()
       and json.loads(apimod10.CONFIG_PATH.read_text(encoding="utf-8"))["theme"] == "light")

    print("\n[23] Locating a missing folder never hands a user's folder to cleanup")
    # A record in the database is no proof the app made the folder it points
    # at: "Locate folder…" can point it anywhere. The cleanup of empty
    # rehearsals must then not take a folder full of someone's own files.
    tmp13 = Path(tempfile.mkdtemp())
    _, g = fresh_api(tmp13)
    rec13 = g.recordings_dir
    ghost = rec13 / "Ghost - 2026-09-01 20-00"
    g._lib.create_rehearsal(ghost, "Ghost", "2026-09-01T20:00:00", SR, 16,
                            [{"name": "Gtr", "channel": 1}])
    mixes = rec13 / "Mixes for the band"
    mixes.mkdir(parents=True)
    (mixes / "final mix.mp3").write_bytes(b"ID3 not really audio")
    (mixes / "lyrics.pdf").write_bytes(b"%PDF-1.4")
    located = g.locate_rehearsal(str(ghost), str(mixes))
    g.list_rehearsals()
    ok("an empty rehearsal located onto a folder of other files leaves it be",
       located.get("ok") is True and mixes.is_dir()
       and (mixes / "final mix.mp3").exists() and (mixes / "lyrics.pdf").exists())

    g.start_rehearsal("Live", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    live = Path(g._session["folder"])
    draft = live / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1000, seconds=1.0)
    g._session["take_counter"] = 1
    g.keep_take(1, str(draft), "Kept", 1.0,
                [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    lost = rec13 / "Lost - 2026-09-02 20-00"
    g._lib.create_rehearsal(lost, "Lost", "2026-09-02T20:00:00", SR, 16,
                            [{"name": "Gtr", "channel": 1}])
    spare = rec13 / "Spare"
    spare.mkdir()
    ok("a rehearsal outside the recordings folder is refused",
       g.locate_rehearsal(str(tmp13 / "Elsewhere"), str(spare))
       == {"ok": False, "error": "Folder is outside the recordings directory"})
    ok("so is the rehearsal in progress",
       g.locate_rehearsal(str(live), str(spare))
       == {"ok": False, "error": "Cannot relocate the rehearsal in progress"})
    ok("and one whose folder is still there",
       g.locate_rehearsal(str(mixes), str(spare))
       == {"ok": False, "error": "That rehearsal's folder is not missing"})
    part = {"ok": False, "error": "That folder is part of another rehearsal"}
    ok("the live rehearsal's folder is not a place to locate onto",
       g.locate_rehearsal(str(lost), str(live)) == part)
    ok("nor a folder inside another rehearsal's",
       g.locate_rehearsal(str(lost), str(live / "01 - Kept 1")) == part)
    box = rec13 / "Box"
    inner = box / "Old - 2026-08-01 20-00"
    inner.mkdir(parents=True)
    g._lib.create_rehearsal(inner, "Old", "2026-08-01T20:00:00", SR, 16,
                            [{"name": "Gtr", "channel": 1}])
    ok("nor a folder holding another rehearsal's",
       g.locate_rehearsal(str(lost), str(box)) == part)
    ok("and the refused one is still where it was, missing",
       g._lib.rehearsal(lost)["missing"] is True)

    # A folder can be renamed to a different case alone from Explorer
    # ("Other" -> "other"); the database still has the old spelling, so the
    # exact-case lookup that "already another rehearsal" relies on misses
    # it. The "part of another rehearsal" check must catch the folder
    # itself, not only its parents or children, or a second rehearsal can
    # be pointed at the same files.
    other_case = rec13 / "Other"
    other_case.mkdir()
    g._lib.create_rehearsal(other_case, "Other", "2026-09-04T20:00:00", SR, 16,
                            [{"name": "Gtr", "channel": 1}])
    renamed_tmp = rec13 / "Other-renaming"
    other_case.rename(renamed_tmp)
    renamed_tmp.rename(rec13 / "other")
    # Only meaningful where the filesystem does not tell the two apart —
    # on a case-sensitive one "other" is simply a different, unrelated
    # folder, and there is nothing here to refuse.
    if (rec13 / "OTHER").exists():
        lost2 = rec13 / "Lost2 - 2026-09-06 20-00"
        g._lib.create_rehearsal(lost2, "Lost2", "2026-09-06T20:00:00", SR, 16,
                                [{"name": "Gtr", "channel": 1}])
        ok("a folder that is another rehearsal's, only renamed by case, "
           "is still refused",
           g.locate_rehearsal(str(lost2), str(rec13 / "other")) == part)

    # The fallback trash folder, and anything under it, is not a rehearsal's
    # to have either: the next thing deleted would land inside a rehearsal,
    # and the next cleanup would carry it away.
    from rehearsal_recorder.platform_support import FALLBACK_TRASH

    trash = rec13 / FALLBACK_TRASH
    trash.mkdir()
    ok("the fallback trash folder is refused",
       g.locate_rehearsal(str(lost), str(trash))
       == {"ok": False, "error": "That folder is where deleted things go"})
    trashed = trash / "Old rehearsal - 2026-09-01 20-00"
    trashed.mkdir()
    ok("and so is anything under it",
       g.locate_rehearsal(str(lost), str(trashed))
       == {"ok": False, "error": "That folder is where deleted things go"})

    g.finish_rehearsal()

    # What the app itself left behind is still cleared away.
    empty_one = rec13 / "Empty - 2026-09-03 20-00"
    empty_one.mkdir()
    with_drafts = rec13 / "Drafts - 2026-09-03 21-00"
    (with_drafts / "_drafts").mkdir(parents=True)
    for f, name in ((empty_one, "Empty"), (with_drafts, "Drafts")):
        g._lib.create_rehearsal(f, name, "2026-09-03T20:00:00", SR, 16,
                                [{"name": "Gtr", "channel": 1}])
    g.cleanup_empty_rehearsals()
    ok("an empty rehearsal folder is still cleaned up",
       not empty_one.exists() and not g._lib.has(empty_one))
    ok("and so is one holding only an empty _drafts",
       not with_drafts.exists() and not g._lib.has(with_drafts))

    # os.path.isjunction only exists from Python 3.12 (pyproject.toml allows
    # 3.10), so cleanup must not depend on it being there.
    import os as _os

    no_isjunction = rec13 / "Drafts too - 2026-09-03 22-00"
    (no_isjunction / "_drafts").mkdir(parents=True)
    g._lib.create_rehearsal(no_isjunction, "Drafts too", "2026-09-03T22:00:00", SR, 16,
                            [{"name": "Gtr", "channel": 1}])
    saved_isjunction = _os.path.isjunction
    delattr(_os.path, "isjunction")
    try:
        raised = False
        try:
            g.cleanup_empty_rehearsals()
        except AttributeError:
            raised = True
    finally:
        _os.path.isjunction = saved_isjunction
    ok("cleanup does not need os.path.isjunction, missing before Python 3.12",
       not raised and not no_isjunction.exists() and not g._lib.has(no_isjunction))

    g.start_rehearsal("Nothing kept", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    unkept = Path(g._session["folder"])
    (unkept / "setlist.txt").write_text("1. Polyn")
    finished = g.finish_rehearsal()
    ok("finishing an empty rehearsal with a stray file keeps the folder",
       unkept.is_dir() and (unkept / "setlist.txt").exists()
       and finished["folder_removed"] is False)
    g.start_rehearsal("Nothing at all", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    bare = Path(g._session["folder"])
    finished = g.finish_rehearsal()
    ok("and one with nothing in it is still removed",
       not bare.exists() and finished["folder_removed"] is True)

    print("\n[24] A marker placed while a take is being cropped is kept")
    g.start_rehearsal("Cropping", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    cf = Path(g._session["folder"])
    draft = cf / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1000, seconds=2.0)
    g._session["take_counter"] = 1
    g.keep_take(1, str(draft), "Polyn", 2.0,
                [{"name": "Gtr", "file": str(draft / "Gtr.wav")}],
                [{"at": 0.3, "note": "", "label_id": 1},
                 {"at": 1.0, "note": "", "label_id": 2}])
    real_crop = g._crop_tracks

    def crop_with_a_marker(*args, **kwargs):
        result = real_crop(*args, **kwargs)
        g.add_take_marker(str(cf), 1, 1.2, "while cropping", 3)
        return result

    g._crop_tracks = crop_with_a_marker
    try:
        cropped = g.crop_take(str(cf), 1, 0.5, 1.9)
    finally:
        del g._crop_tracks
    ok("the marker added during the crop survives it, shifted",
       cropped["ok"] and [m["at"] for m in cropped["take"]["markers"]] == [0.5, 0.7]
       and cropped["take"]["markers"][1]["note"] == "while cropping")
    ok("and the dropped ones are still counted", cropped["markers_dropped"] == 1)

    def crop_and_delete(*args, **kwargs):
        result = real_crop(*args, **kwargs)
        g._lib.delete_take(cf, 1)
        return result

    g._crop_tracks = crop_and_delete
    try:
        vanished = g.crop_take(str(cf), 1, 0.1, 1.2)
    finally:
        del g._crop_tracks
    ok("a take deleted during its crop is reported as not found",
       vanished == {"ok": False, "error": "Take not found"})
    g.finish_rehearsal()

    print("\n[25] A rehearsal whose record vanishes during a rename")
    g.start_rehearsal("Renaming", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    rf = Path(g._session["folder"])
    draft = rf / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1000, seconds=1.0)
    g._session["take_counter"] = 1
    g.keep_take(1, str(draft), "Kept", 1.0,
                [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])
    g._library.move_rehearsal = lambda *args, **kwargs: False
    try:
        renamed = g.rename_rehearsal(str(rf), "Renamed")
    finally:
        del g._library.move_rehearsal
    ok("is reported as not found, with its folder named back",
       renamed == {"ok": False, "error": "Rehearsal not found"}
       and rf.is_dir() and not list(rec13.glob("Renamed - *")))
    g.finish_rehearsal()

    print("\n[26] session.json that cannot be deleted after its import")
    tmp14 = Path(tempfile.mkdtemp())
    sticky = tmp14 / "Rec" / "Sticky - 2026-09-05 19-00"
    sticky.mkdir(parents=True)
    (sticky / "session.json").write_text(json.dumps({
        "name": "Sticky", "created_at": "2026-09-05T19:00:00", "samplerate": SR,
        "tracks": [{"name": "Gtr", "channel": 1}], "takes": [],
    }))
    import rehearsal_recorder.store.importer as importer_mod
    real_remove = importer_mod._remove

    def locked(folder):
        raise PermissionError("in use by another process")

    importer_mod._remove = locked
    collected = _Collect()
    importer_log = logging.getLogger("rehearsal_recorder.store.importer")
    importer_log.addHandler(collected)
    try:
        _, st = fresh_api(tmp14)
        counted = import_all(st._lib, st._cloud_dir)
    finally:
        importer_mod._remove = real_remove
        importer_log.removeHandler(collected)
    ok("is not reported as a history that could not be read",
       st.startup_problems() == [] and st._lib.has(sticky))
    ok("it says so in the log, as a warning",
       any(r.levelno == logging.WARNING for r in collected.records))
    ok("nor while the file stays locked on later passes", counted["failed"] == 0)
    ok("and it is removed once it can be",
       import_all(st._lib, st._cloud_dir) == {"imported": 0, "failed": 0}
       and not (sticky / "session.json").exists())

    print("\n[27] The disk and the settings are asked outside the transaction")
    # A read holds the database's lock; a slow drive answering is_dir() must
    # not hold it with it.
    lib = g._lib
    seen = []
    real_cloud = lib._cloud_dir
    real_is_dir = Path.is_dir

    def watching_cloud():
        seen.append(("cloud", lib._engine.pool.checkedout()))
        return real_cloud()

    def watching_is_dir(self, *args, **kwargs):
        if self.parent == rec13:
            seen.append(("disk", lib._engine.pool.checkedout()))
        return real_is_dir(self, *args, **kwargs)

    lib._cloud_dir = watching_cloud
    Path.is_dir = watching_is_dir
    try:
        listed = lib.rehearsals()
        one = lib.rehearsal(rf)
        a_take = lib.take(rf, 1)
    finally:
        Path.is_dir = real_is_dir
        lib._cloud_dir = real_cloud
    ok("the reads still answer",
       listed and one is not None and a_take is not None
       and one["missing"] is False)
    ok("with neither asked while the database is held",
       {k for k, _ in seen} == {"cloud", "disk"}
       and all(held == 0 for _, held in seen))

    print("\n[28] Telling apart why a card refuses to open")
    from rehearsal_recorder.audio.probe import AS_CONFIGURED, attempts, verdict

    plan = attempts(samplerate=48000, channels=4, bit_depth=24,
                    driver_samplerate=44100)
    labels = [a["label"] for a in plan]
    ok("the settings in force are tried first", labels[0] == AS_CONFIGURED)
    ok("and each remaining attempt changes exactly one thing",
       len(labels) >= 6 and len(set(labels)) == len(labels))

    def only(*opens):
        """A result per attempt, with only the named ones opening — and
        sending, once open."""
        return [
            {
                "label": a["label"],
                "opened": a["label"] in opens,
                "flowing": a["label"] in opens,
                "error": None if a["label"] in opens else
                "Unanticipated host error [PaErrorCode -9999]",
            }
            for a in plan
        ]

    by_cause = {a["cause"]: a["label"] for a in plan if a["cause"]}

    ok("nothing opens — the driver is held elsewhere or the card is absent",
       verdict(only())["cause"] == "driver")
    ok("only the duplex attempt opens — the driver will not open inputs alone",
       verdict(only(by_cause["input_only"]))["cause"] == "input_only")
    ok("fewer channels open — too many were asked for",
       verdict(only(by_cause["channels"], by_cause["input_only"]))["cause"]
       == "channels")
    ok("the driver's own rate opens — the rate was the problem",
       verdict(only(by_cause["samplerate"]))["cause"] == "samplerate")
    ok("16-bit opens — the depth was the problem",
       verdict(only(by_cause["bit_depth"]))["cause"] == "bit_depth")
    ok("the driver's own block size opens — the block size was the problem",
       verdict(only(by_cause["blocksize"]))["cause"] == "blocksize")
    ok("everything opens — the settings are not what refused",
       verdict(only(*labels))["cause"] == "none")
    ok("every verdict says something a person can act on",
       all(verdict(only(*w))["advice"].strip()
           for w in ([], [by_cause["input_only"]], [by_cause["channels"]], labels)))

    def opened_quiet(*sending):
        """Every attempt opens; only the named ones send anything."""
        return [{"label": a["label"], "opened": True,
                 "flowing": a["label"] in sending, "error": None} for a in plan]

    ok("everything opens but nothing sends — the card is not delivering",
       verdict(opened_quiet())["cause"] == "no_sound")
    ok("and that says something a person can act on too",
       verdict(opened_quiet())["advice"].strip() != "")
    ok("opens everywhere, only the driver's own block size sends — the block size",
       verdict(opened_quiet(by_cause["blocksize"]))["cause"] == "blocksize")

    # Listening, not just opening. Realtek's ASIO driver opens every time
    # and then sends one block and nothing more; the probe used to call
    # that "ok". And it opened the card from the main thread in blocking
    # mode, which crashed that same driver and could not have shown a card
    # that fails from any other thread.
    import threading as _th
    import time as _t

    from rehearsal_recorder.audio import probe as probemod

    class _Card:
        """Sends `blocks` blocks (None: for as long as it is open), the first
        after `delay` seconds; a quarter of full scale on input 1 and silence
        on the rest, from a thread of its own, the way PortAudio calls."""

        blocks = None
        delay = 0.0
        refuse = None
        made_on = []
        # What each opening asked for, as PortAudio would be asked.
        asked = []
        out_dirty = False
        # False: blocks of silence, the way a card with nothing plugged in sends.
        loud = True

        def __init__(self, **kw):
            if self.refuse:
                raise RuntimeError(self.refuse)
            _Card.made_on.append(_th.current_thread().name)
            _Card.asked.append(kw)
            self.kw = kw
            self._halt = _th.Event()
            self._thread = None

        def start(self):
            self._thread = _th.Thread(target=self._run, daemon=True)
            self._thread.start()

        def _run(self):
            kw = self.kw
            duplex = isinstance(kw["channels"], tuple)
            ins = kw["channels"][0] if duplex else kw["channels"]
            frames = kw.get("blocksize") or 512
            dtype = np.dtype(kw["dtype"])
            if self._halt.wait(self.delay):
                return
            # Paced by the clock, not by the length of a sleep: each time it
            # wakes it sends every block due by then, at twice real time. A
            # CI machine can stretch a 10 ms sleep several times over.
            began = _t.monotonic()
            sent = 0
            while not self._halt.is_set():
                due = int((_t.monotonic() - began) * kw["samplerate"] * 2 / frames) + 1
                while sent < due and (self.blocks is None or sent < self.blocks):
                    block = np.zeros((frames, ins), dtype=dtype)
                    if self.loud:
                        block[:, 0] = (np.iinfo(dtype).max + 1) // 4
                    if duplex:
                        out = np.ones((frames, kw["channels"][1]), dtype=dtype)
                        kw["callback"](block, out, frames, None, None)
                        _Card.out_dirty = _Card.out_dirty or bool(out.any())
                    else:
                        kw["callback"](block, frames, None, None)
                    sent += 1
                if self.blocks is not None and sent >= self.blocks:
                    return
                self._halt.wait(0.005)

        def stop(self):
            self._halt.set()
            if self._thread is not None:
                self._thread.join()

        def close(self):
            pass

    class _Sends(_Card):
        pass

    class _Stalls(_Card):
        blocks = 1

    class _Slow(_Card):
        delay = 0.3

    class _Mute(_Card):
        blocks = 0

    class _Refuses(_Card):
        refuse = "Unanticipated host error [PaErrorCode -9999]"

    def card(cls):
        return types.SimpleNamespace(InputStream=cls, Stream=cls)

    plan2 = attempts(samplerate=48000, channels=2, bit_depth=24,
                     driver_samplerate=48000)

    def listen(cls, attempt=None, first_block=0.6):
        return probemod.try_attempt(card(cls), 0, attempt or plan2[0],
                                    seconds=0.25, first_block=first_block)

    def heard(row):
        """Whether the probe heard it — and when not, what it counted, so a
        CI log says more than FAIL."""
        if row.get("flowing") is True:
            return True
        print(f"       heard {row.get('frames')} of {row.get('expected')} "
              f"frames; opened {row.get('opened')}; {row.get('error')}")
        return False

    _Card.made_on.clear()
    _Card.asked.clear()
    sent = listen(_Sends)
    ok("a card that sends is heard: it opened, and sound arrived",
       sent["opened"] and heard(sent))
    ok("it is opened the way the app opens a card, on the audio thread",
       _Card.made_on == ["audio"])
    ok("and with the short latency a take asks for, not the driver's own",
       len(_Card.asked) == 1
       and isinstance(_Card.asked[0].get("latency"), float)
       and 0 < _Card.asked[0]["latency"] <= 0.1)
    peaks = sent.get("peaks") or [0.0, 1.0]
    ok("each input's loudest moment is measured — the first loud, the second not",
       abs(peaks[0] - 0.25) < 0.01 and peaks[1] == 0)
    stalled = listen(_Stalls)
    ok("a card that opens and then sends one block is not heard",
       stalled["opened"] and stalled.get("flowing") is False)
    ok("a card slow to send its first block is waited for",
       heard(listen(_Slow)))
    began = _t.monotonic()
    mute = listen(_Mute, first_block=0.3)
    ok("one that sends nothing is given up on after the wait for a first block",
       mute["opened"] and mute.get("flowing") is False
       and _t.monotonic() - began < 2)
    refused = listen(_Refuses)
    ok("a refusal did not open, and keeps the driver's words",
       not refused["opened"] and refused.get("flowing") is False
       and "-9999" in (refused["error"] or ""))
    duplex = next(a for a in plan2 if a["label"] == probemod.WITH_OUTPUTS)
    ok("the attempt with the outputs attached is heard too",
       heard(listen(_Sends, duplex)))
    ok("and it plays silence while it listens", not _Card.out_dirty)

    rows = probemod.probe(card(_Sends), 0, plan2, first_seconds=0.25,
                          seconds=0.25, first_block=0.6)
    ok("when the settings in force are heard, nothing else is tried",
       heard(rows[0]) and [r["label"] for r in rows] == [AS_CONFIGURED]
       and verdict(rows)["cause"] == "none")
    rows = probemod.probe(card(_Stalls), 0, plan2, first_seconds=0.25,
                          seconds=0.25, first_block=0.3)
    ok("when they are not, every other attempt is tried in turn",
       [r["label"] for r in rows] == [a["label"] for a in plan2])
    ok("and a card that opens every time but never sends says so",
       verdict(rows)["cause"] == "no_sound")

    ok("the channels asked for reach the second half of a stereo track",
       probemod.channels_for([{"name": "Keys", "channel": 17, "stereo": True},
                              {"name": "Vox", "channel": 3}]) == 18)
    ok("and with no tracks saved, two", probemod.channels_for([]) == 2)

    def safely(fn):
        try:
            return fn()
        except Exception:
            return None

    ok("a track left without an input asks for nothing",
       safely(lambda: probemod.channels_for(
           [{"name": "Sax", "channel": None}, {"name": "Vox", "channel": 3}])) == 3)
    # The config as the app writes it: the band's names in `tracks`, and
    # each card's inputs in `layouts` — see rehearsal_recorder/layouts.py.
    band_cfg = {
        "tracks": [{"name": "Vox"}, {"name": "Keys", "stereo": True}],
        "layouts": [{"device": {"name": "XR18", "host_api": "ASIO"},
                     "inputs": {"Vox": 1, "Keys": 17}}],
    }
    xr18 = {"name": "XR18", "host_api": "ASIO"}
    ok("the tracks are the band placed on this card's own inputs",
       safely(lambda: probemod.channels_for(
           probemod.tracks_for(band_cfg, xr18, 18))) == 18)
    ok("and on a card that has never seen them, the lowest free inputs",
       safely(lambda: probemod.channels_for(probemod.tracks_for(
           band_cfg, {"name": "FlexASIO", "host_api": "ASIO"}, 8))) == 3)

    ok("which inputs have signal, numbered the way the person numbers them",
       probemod.signal_line([0.3, 0.0, 0.05])
       == "signal on inputs 1, 3; the rest silent")
    ok("one of them", probemod.signal_line([0.0, 0.4])
       == "signal on input 2; the rest silent")
    ok("all of them", probemod.signal_line([0.5, 0.5]) == "signal on every input")
    ok("none of them, with what to do about it",
       probemod.signal_line([0.0, 0.001])
       .startswith("sound arrives, but every input is silent"))
    # Where the meters draw the line: a band sets its gain for the loudest
    # hit, so an input played quietly sits around −48 dBFS, and a dead one on
    # a desk's preamp lies far below −60.
    ok("an input played quietly, at -48 dBFS, has signal; one at -66 does not",
       probemod.signal_line([0.004, 0.0005])
       == "signal on input 1; the rest silent")

    print("\n[29] Asking an ASIO card what it can do, without wearing it out")
    from rehearsal_recorder.audio.devices import recording_formats as _formats

    asked = []

    def counting_check(device=None, channels=1, samplerate=None, dtype=None):
        asked.append((device, samplerate, dtype))
        if samplerate == 96000:
            raise ValueError("unsupported samplerate")

    asio_apis = [{"name": "MME"}, {"name": "ASIO"}]
    asio_devices = [
        {"name": "Scarlett", "hostapi": 0, "max_input_channels": 2,
         "max_output_channels": 2, "default_samplerate": 48000},
        {"name": "Scarlett", "hostapi": 1, "max_input_channels": 8,
         "max_output_channels": 8, "default_samplerate": 48000},
    ]
    real_q, real_h = _sd.query_devices, _sd.query_hostapis
    real_check = _sd.check_input_settings
    _sd.query_hostapis = lambda: asio_apis
    _sd.query_devices = (
        lambda index=None, kind=None:
        asio_devices if index is None else asio_devices[index]
    )
    _sd.check_input_settings = counting_check
    try:
        got, trouble = _formats(1, 2)
        ok("the rates the card takes are still offered at both depths",
           got.get("48000") == [16, 24] and got.get("44100") == [16, 24])
        ok("and a rate it refuses is still left out", "96000" not in got)
        ok("a card that answered is not reported as trouble", trouble is None)
        # Every ask loads and unloads the ASIO driver in full, and PortAudio's
        # ASIO backend never looks at the sample format — so asking once per
        # depth is wear on the driver for an answer already known.
        ok("an ASIO driver is loaded once per rate, not once per combination",
           len(asked) == 3)

        asked.clear()
        _formats(0, 2)
        ok("every other audio system is still asked about each combination",
           len(asked) == 6)

        # A card that will not answer at all is not a card that answered "none
        # of those". Told apart, or the interface offers rates nothing ever
        # confirmed — which is how a card with no 96 kHz came to have it on
        # screen.
        def refuses(device=None, channels=1, samplerate=None, dtype=None):
            raise Exception("Unanticipated host error", -9999)

        _sd.check_input_settings = refuses
        none_at_all, trouble = _formats(1, 2)
        ok("a card that would not answer says so",
           none_at_all == {} and bool(trouble))
        ok("and keeps what the driver said", "-9999" in trouble)

        # The settings screen asks about two channels whatever the card is.
        # A one-input card answers paInvalidChannelCount to every rate, so
        # the whole list came back empty and blamed the card — when the
        # question was the thing that was wrong.
        seen_ch = []

        def channel_fussy(device=None, channels=1, samplerate=None, dtype=None):
            seen_ch.append(channels)
            if channels > asio_devices[device]["max_input_channels"]:
                raise Exception("Invalid number of channels", -9998)

        _sd.check_input_settings = channel_fussy
        narrow, no_trouble = _formats(0, 8)  # the MME entry has 2 inputs
        ok("a card is never asked about more channels than it has",
           set(seen_ch) == {2})
        ok("so it answers, instead of refusing every rate",
           bool(narrow) and no_trouble is None)
    finally:
        _sd.query_devices, _sd.query_hostapis = real_q, real_h
        _sd.check_input_settings = real_check

    print("\n[30] A playback device that refuses says what actually refused")
    from rehearsal_recorder.audio.devices import output_complaint

    busy = Exception("Device unavailable", -9985)
    wrong_rate = Exception("Invalid sample rate", -9997)
    strange = Exception("Unanticipated host error", -9999)

    ok("a card already in use is not reported as refusing the rate",
       "48000 Hz" not in output_complaint("X32", busy, 48000)
       and "in use" in output_complaint("X32", busy, 48000))
    ok("a card that will not take the rate still says so",
       "48000 Hz" in output_complaint("X32", wrong_rate, 48000))
    ok("anything else keeps the driver's own words",
       "Unanticipated host error" in output_complaint("X32", strange, 48000))
    ok("and the place to go and look is one this system has",
       "Audio MIDI Setup" in output_complaint("X32", wrong_rate, 48000, "darwin")
       and "Audio MIDI Setup"
       not in output_complaint("X32", wrong_rate, 48000, "win32"))

    asked_out = []

    def counting_output_check(device=None, channels=2, samplerate=None,
                              dtype=None):
        asked_out.append(device)

    write_wav(tmp / "p30" / "A.wav", 1000)
    solo = [{"name": "A", "file": str(tmp / "p30" / "A.wav")}]

    real_q, real_h = _sd.query_devices, _sd.query_hostapis
    real_out_check, real_out = _sd.check_output_settings, _sd.OutputStream

    def refusing_output(**kw):
        """A card that is listed and looks fine, but will not open — the shape
        an ASIO card takes while another program holds it."""
        if kw.get("device") == 1:
            raise Exception("Device unavailable", -9985)
        return real_out(**kw)

    _sd.query_hostapis = lambda: asio_apis
    _sd.query_devices = (
        lambda index=None, kind=None:
        asio_devices if index is None else asio_devices[index]
    )
    _sd.check_output_settings = counting_output_check
    try:
        usable_output(1, 48000)
        ok("an ASIO card is not made to load its driver just to be asked",
           asked_out == [])
        usable_output(0, 48000)
        ok("every other audio system is still asked before anything opens",
           asked_out == [0])

        _sd.OutputStream = refusing_output
        p30 = TakePlayer(solo)
        complaint = p30.open_output(1, (1, 2))
        ok("a card that refuses as it opens falls back instead of failing "
           "the take", p30._stream is not None)
        ok("and says it is in use, not that the rate is wrong",
           complaint and "in use" in complaint and "48000 Hz" not in complaint)
        p30.close()
    finally:
        _sd.query_devices, _sd.query_hostapis = real_q, real_h
        _sd.check_output_settings, _sd.OutputStream = real_out_check, real_out

    print("\n[31] Tracks left pointing at another card's inputs")
    # Tracks are saved as a template with their input numbers, and changing
    # the interface does not touch them. Set up on an 18-input desk and then
    # moved to a two-input box, they still ask for input 8, and what came
    # back was PortAudio's paInvalidChannelCount — a number about a card,
    # for a mistake about a template.
    from rehearsal_recorder.audio.devices import channels_available

    def on(*channels):
        return [{"name": f"T{c}", "channel": c} for c in channels]

    ok("a card with enough inputs is nothing to say",
       channels_available(0, on(1, 8)) is None)   # Interface: 8 in

    # Two tracks, one input: no arrangement of them works, so telling anyone
    # to pick again is telling them to do the impossible.
    wont_fit = channels_available(1, on(1, 2))     # Podcast mic: 1 in
    ok("a card with fewer inputs than tracks says they will not fit",
       wont_fit and "2 tracks" in wont_fit and "1 input" in wont_fit)
    ok("and offers something that can actually be done",
       wont_fit and "fewer" in wont_fit and "Pick again" not in wont_fit)

    # Two tracks, eight inputs, but numbered for an eighteen-input desk —
    # here picking again is exactly the answer.
    misnumbered = channels_available(0, on(1, 12))
    ok("a card with room but wrong numbers says to pick again",
       misnumbered and "up to 12" in misnumbered
       and "another interface" in misnumbered)

    ok("a device nobody can describe is left to PortAudio",
       channels_available(99, on(2)) is None)

    _, a31 = fresh_api(Path(tempfile.mkdtemp()))
    refused = a31.start_monitor(1, SR, on(4))
    ok("the signal check says so rather than opening the card",
       refused["ok"] is False and "input" in refused["error"])
    fine = a31.start_monitor(0, SR, on(4))
    ok("and a card that has the inputs still opens", fine["ok"] is True)
    a31.stop_monitor()

    print("\n[32] The band is one list; the inputs belong to the card")
    from rehearsal_recorder import layouts as L

    xr18 = {"name": "X AIR XR18", "host_api": "ASIO"}
    little = {"name": "Scarlett 2i2", "host_api": "Windows WASAPI"}

    print("  migration")
    flat = L.migrate({"tracks": [{"name": "Guitar", "channel": 3},
                                 {"name": "Vocals", "channel": 7}],
                      "device": xr18})
    ok("a flat list becomes the band, by name and in order",
       flat["tracks"] == [{"name": "Guitar"}, {"name": "Vocals"}])
    ok("and its numbers become that card's input map",
       flat["layouts"] == [{"device": xr18,
                            "inputs": {"Guitar": 3, "Vocals": 7}}])
    ok("migrating twice changes nothing", L.migrate(L.migrate(flat)) == flat)
    ok("nothing saved migrates to nothing",
       L.migrate({}) == {"tracks": [], "layouts": []})

    # The shape where each card carried its own band: nobody may be lost by
    # reading it, so the band is everyone who appeared on any card.
    per_card = L.migrate({"layouts": [
        {"device": little, "tracks": [{"name": "Guitar", "channel": 1}]},
        {"device": xr18, "tracks": [{"name": "Guitar", "channel": 3},
                                    {"name": "Drums", "channel": 9}]}]})
    ok("a per-card band becomes one band, losing nobody",
       per_card["tracks"] == [{"name": "Guitar"}, {"name": "Drums"}])
    ok("and each card keeps the inputs it knew",
       L.inputs_for(per_card["layouts"], xr18) == {"Guitar": 3, "Drums": 9}
       and L.inputs_for(per_card["layouts"], little) == {"Guitar": 1})

    print("  switching cards")
    band = [{"name": "Guitar"}, {"name": "Vocals"}]
    saved = L.remember([], xr18, [{"name": "Guitar", "channel": 3},
                                  {"name": "Vocals", "channel": 7}])
    ok("a card remembers where each name is plugged in",
       L.inputs_for(saved, xr18) == {"Guitar": 3, "Vocals": 7})
    ok("and gives those numbers back",
       L.for_device(band, saved, xr18, 18)
       == [{"name": "Guitar", "channel": 3, "stereo": False},
           {"name": "Vocals", "channel": 7, "stereo": False}])

    # The whole point: a card nobody has used yet keeps the band entire.
    ok("an unused card keeps everyone, counted from the first free input",
       L.for_device(band, saved, little, 2)
       == [{"name": "Guitar", "channel": 1, "stereo": False},
           {"name": "Vocals", "channel": 2, "stereo": False}])

    both = L.remember(saved, little, [{"name": "Guitar", "channel": 1},
                                      {"name": "Vocals", "channel": 2}])
    ok("going back to the first card brings its own numbers back",
       L.for_device(band, both, xr18, 18)
       == [{"name": "Guitar", "channel": 3, "stereo": False},
           {"name": "Vocals", "channel": 7, "stereo": False}])
    ok("and the other card keeps its own",
       L.for_device(band, both, little, 2)
       == [{"name": "Guitar", "channel": 1, "stereo": False},
           {"name": "Vocals", "channel": 2, "stereo": False}])

    print("  the band changes")
    # Somebody joins on one card. Every other card must show them too — that
    # is the whole reason the band is one list.
    grew = [{"name": "Guitar"}, {"name": "Vocals"}, {"name": "Drums"}]
    ok("a new member appears on a card that never saw them",
       L.for_device(grew, both, xr18, 18)
       == [{"name": "Guitar", "channel": 3, "stereo": False},
           {"name": "Vocals", "channel": 7, "stereo": False},
           {"name": "Drums", "channel": 1, "stereo": False}])
    ok("on the lowest input nobody else is on",
       L.for_device(grew, both, little, 2)[2] == {"name": "Drums", "channel": None,
                                                  "stereo": False})

    ok("and when the inputs run out, the rest simply have none",
       [t["channel"] for t in L.for_device(
           [{"name": n} for n in "ABCD"], [], xr18, 2)] == [1, 2, None, None])
    ok("but nobody is dropped — who sits out is not the app's to decide",
       [t["name"] for t in L.for_device(
           [{"name": n} for n in "ABCD"], [], xr18, 2)] == ["A", "B", "C", "D"])

    dropped = L.remember(both, xr18, [{"name": "Guitar", "channel": 3}])
    ok("a name left out of a save keeps its socket for when it returns",
       L.inputs_for(dropped, xr18)["Vocals"] == 7)

    ok("with no band at all, the usual two",
       [t["name"] for t in L.for_device([], [], xr18, 8)]
       == ["Guitar 1", "Vocals"])

    print("  through the app")
    big = {"name": "Interface", "host_api": "CoreAudio"}
    apimod32, a32 = fresh_api(Path(tempfile.mkdtemp()))

    a32._remember_device("device", 0)
    a32.save_default_tracks({"device_index": 0, "tracks": [
        {"name": "Guitar", "channel": 5}, {"name": "Vocals", "channel": 6}]})
    ok("the template saves the band once",
       a32._config["tracks"] == [{"name": "Guitar"}, {"name": "Vocals"}])
    ok("and the numbers under the card they were set on",
       L.inputs_for(a32._config["layouts"], big) == {"Guitar": 5, "Vocals": 6})
    ok("the card gets its own numbers back",
       a32.load_default_tracks()["tracks"]
       == [{"name": "Guitar", "channel": 5, "stereo": False},
           {"name": "Vocals", "channel": 6, "stereo": False}])

    # Device 1 is the one-input "Podcast mic": the band survives the move.
    a32._remember_device("device", 1)
    moved_tracks = a32.load_default_tracks()["tracks"]
    ok("switching to a one-input card keeps the whole band",
       [t["name"] for t in moved_tracks] == ["Guitar", "Vocals"])
    ok("with the one who does not fit left waiting for an input",
       [t["channel"] for t in moved_tracks] == [1, None])

    a32._remember_device("device", 0)
    started = a32.start_rehearsal("Layouts", 0, SR, [
        {"name": "Guitar", "channel": 2}, {"name": "Vocals", "channel": 6}], 16)
    ok("starting a rehearsal remembers the layout without being asked",
       started["ok"]
       and L.inputs_for(a32._config["layouts"], big) == {"Guitar": 2,
                                                         "Vocals": 6})
    a32.finish_rehearsal()

    print("  a track with no input at all")
    unplaced = [{"name": "Guitar", "channel": 1}, {"name": "Keys", "channel": None}]
    said = channels_available(0, unplaced)
    ok("is refused by name rather than by a number from PortAudio",
       said and "Keys" in said and "no input" in said)
    ok("and the signal check will not open the card",
       a32.start_monitor(0, SR, unplaced)["ok"] is False)

    print("\n[33] A track can be stereo")
    # A keyboard has two outputs, and one mono file throws away half of what
    # arrived. A stereo track takes two adjacent inputs and writes them
    # interleaved into the one file, which is what makes it one track.
    from rehearsal_recorder.audio.capture import AudioRecorder as _Rec
    from rehearsal_recorder.audio.capture import raw_to_wav as _r2w

    st = tmp / "stereo"
    rec = _Rec(0, SR, [{"name": "Keys", "channel": 3, "stereo": True},
                       {"name": "Gtr", "channel": 1}], st, bit_depth=16)
    ok("the stream is opened wide enough to reach the pair",
       rec._max_channel == 4)
    rec._raw_files = {"Keys": open(st / "Keys.raw", "wb"),
                      "Gtr": open(st / "Gtr.raw", "wb")}
    block = np.zeros((128, 4), dtype=np.int16)
    block[:, 0] = 100   # Gtr, input 1
    block[:, 2] = 200   # Keys left, input 3
    block[:, 3] = 300   # Keys right, input 4
    rec._callback(block, 128, None, None)
    for f in rec._raw_files.values():
        f.close()

    ok("a stereo track writes two samples per frame",
       (st / "Keys.raw").stat().st_size == 128 * 2 * 2)
    ok("and a mono one still writes one",
       (st / "Gtr.raw").stat().st_size == 128 * 2)
    written = np.fromfile(st / "Keys.raw", dtype="<i2")
    ok("left and right interleaved, in that order",
       (written[0::2] == 200).all() and (written[1::2] == 300).all())

    lv = rec.get_levels()
    ok("a stereo track reports a level for each channel",
       len(lv["Keys"]) == 2 and abs(lv["Keys"][1] - 300 / 32768) < 1e-4)
    ok("and a mono one reports the one it has", len(lv["Gtr"]) == 1)

    _r2w(st / "Keys.raw", st / "Keys.wav", SR, 16, channels=2)
    with wave.open(str(st / "Keys.wav")) as w:
        ok("its wav says two channels, and the frames divide out",
           w.getnchannels() == 2 and w.getnframes() == 128)

    # 24-bit packs three bytes a sample, both channels alike.
    st24 = tmp / "stereo24"
    rec24 = _Rec(0, SR, [{"name": "Keys", "channel": 1, "stereo": True}],
                 st24, bit_depth=24)
    rec24._raw_files = {"Keys": open(st24 / "Keys.raw", "wb")}
    block32 = np.zeros((64, 2), dtype=np.int32)
    block32[:, 0] = 1000 * 256 * 256
    block32[:, 1] = -2000 * 256 * 256
    rec24._callback(block32, 64, None, None)
    rec24._raw_files["Keys"].close()
    ok("at 24 bits a stereo frame is six bytes",
       (st24 / "Keys.raw").stat().st_size == 64 * 2 * 3)

    print("  recovering one after a crash")
    # A .raw file carries no header, so nothing in the folder says which
    # tracks were stereo. Recovery has to be told, or a rescued keyboard
    # comes back as one channel of twice the length.
    crashed = tmp / "crashst"
    rec3 = _Rec(0, SR, [{"name": "Keys", "channel": 1, "stereo": True},
                        {"name": "Gtr", "channel": 3}], crashed, bit_depth=16)
    rec3.start()
    rec3._callback(np.full((100, 4), 700, dtype=np.int16), 100, None, None)
    rec3._stop_flush.set()
    for f in rec3._raw_files.values():
        f.close()

    from rehearsal_recorder.audio.drafts import finalize as _finalize
    rescued = _finalize(crashed, SR, 16)
    with wave.open(str(crashed / "Keys.wav")) as w:
        ok("a crashed stereo take comes back as a two-channel wav",
           w.getnchannels() == 2 and w.getnframes() == 100)
    with wave.open(str(crashed / "Gtr.wav")) as w:
        ok("and a mono one beside it is untouched",
           w.getnchannels() == 1 and w.getnframes() == 100)
    ok("the take is as long as it was recorded, not twice that",
       abs(rescued["duration_sec"] - 100 / SR) < 1e-6)

    print("  its waveform")
    # Averaging the two channels, or reading only the first, hides a side
    # that stopped arriving — which is the one thing a waveform is looked at
    # for after a take that felt wrong.
    from rehearsal_recorder.audio.waveform import wav_peaks as _peaks
    lopsided = tmp / "lopsided.wav"
    with wave.open(str(lopsided), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack("<hh", 30000, 0) * SR)
    pk, _, _ = _peaks(lopsided, 16)
    ok("a stereo track's waveform is computed per channel", len(pk) == 2)
    ok("so a silent right side reads as silent",
       min(pk[0]) > 0.8 and max(pk[1]) == 0.0)
    write_wav(tmp / "plain.wav", 8000, seconds=1.0)
    mono_pk, _, _ = _peaks(tmp / "plain.wav", 16)
    ok("and a mono track has the one row it has", len(mono_pk) == 1)

    print("  a stereo member of the band")
    ok("a band of bare names becomes objects",
       L.migrate({"tracks": ["Gtr"]})["tracks"] == [{"name": "Gtr"}])
    ok("and converting twice changes nothing",
       L.migrate(L.migrate({"tracks": ["Gtr"]})) == L.migrate({"tracks": ["Gtr"]}))

    band2 = [{"name": "Gtr"}, {"name": "Keys", "stereo": True}]
    ok("a stereo member takes a pair, counted from the first free input",
       L.for_device(band2, [], xr18, 8)
       == [{"name": "Gtr", "channel": 1, "stereo": False},
           {"name": "Keys", "channel": 2, "stereo": True}])
    ok("and the pair it takes is not offered to anybody else",
       L.for_device(band2 + [{"name": "Voc"}], [], xr18, 8)[2]["channel"] == 4)
    ok("a stereo member with no room for its second input has none",
       L.for_device([{"name": "Keys", "stereo": True}], [], xr18, 1)[0]["channel"]
       is None)
    ok("a remembered pair comes back as a pair",
       L.for_device(band2, L.remember([], xr18, [
           {"name": "Keys", "channel": 5, "stereo": True}]), xr18, 8)[1]
       == {"name": "Keys", "channel": 5, "stereo": True})

    print("  what the card and the disk make of it")
    # Device 0 is the eight-input "Interface".
    ok("a stereo track on the last input has nowhere to put its right side",
       channels_available(0, [{"name": "Keys", "channel": 8, "stereo": True}]))
    ok("but one input earlier fits",
       channels_available(0, [{"name": "Keys", "channel": 7, "stereo": True}])
       is None)
    ok("and two tracks may not share an input",
       channels_available(0, [{"name": "Keys", "channel": 3, "stereo": True},
                              {"name": "Gtr", "channel": 4}]))

    # The estimate is asked for with a number of channels; what matters is
    # that whoever asks counts a stereo track as the two it writes. While
    # recording, that is recording_health, from the session's own tracks.
    apimod33, a33 = fresh_api(Path(tempfile.mkdtemp()))
    real_usage = apimod33.shutil.disk_usage
    apimod33.shutil.disk_usage = lambda path: types.SimpleNamespace(
        free=3 * SR * 2 * 60 * 100)  # a hundred minutes of three channels
    a33._recorder = types.SimpleNamespace(
        error=None, problem=lambda: None, is_active=lambda: True)
    a33._session = {"samplerate": SR, "bit_depth": 16, "tracks": [
        {"name": "Keys", "channel": 3, "stereo": True},
        {"name": "Gtr", "channel": 1}]}
    try:
        health = a33.recording_health()
    finally:
        a33._recorder = None
        apimod33.shutil.disk_usage = real_usage
    ok("while recording, a stereo track is counted as the two channels it "
       "writes", abs(health["minutes_left"] - 100) < 0.01)

    print("  playing one back")
    # Left and right deliberately different, and the right one silent later,
    # so that keeping both sides apart can be told from averaging them.
    sides = tmp / "sides"
    sides.mkdir(parents=True, exist_ok=True)
    with wave.open(str(sides / "Keys.wav"), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        frame = struct.pack("<hh", 1000, -3000)
        w.writeframes(frame * SR)
    write_wav(sides / "Gtr.wav", 500, seconds=1.0)

    sp = TakePlayer([{"name": "Keys", "file": str(sides / "Keys.wav")},
                     {"name": "Gtr", "file": str(sides / "Gtr.wav")}])
    sp.play()
    out = settle(sp)
    ok("a stereo track's left channel reaches the left output only",
       abs(int(out[:, 0].mean()) - (1000 + 500)) < 30)
    ok("and its right channel the right output",
       abs(int(out[:, 1].mean()) - (-3000 + 500)) < 30)

    lv = sp.state()["levels"]
    ok("its level is reported per channel, not reduced to the louder",
       len(lv["Keys"]) == 2
       and abs(lv["Keys"][0] - 1000 / 32768) < 0.01
       and abs(lv["Keys"][1] - 3000 / 32768) < 0.01)
    ok("and a mono track reports the one channel it has", len(lv["Gtr"]) == 1)

    sp.set_volume("Keys", 0.0)
    out = settle(sp)
    ok("volume still applies to both sides of a stereo track",
       abs(int(out[:, 0].mean()) - 500) < 30
       and abs(int(out[:, 1].mean()) - 500) < 30)
    sp.close()

    print("  an instrument's icon")
    # Chosen on the setup screen and kept with the band, as stereo is: the
    # bass player's icon is theirs whichever card they plug into.
    ok("a member's icon comes back with it",
       L.for_device([{"name": "Bass", "icon": "bass"}], [], xr18, 8)
       == [{"name": "Bass", "channel": 1, "stereo": False, "icon": "bass"}])
    ok("and one with no icon has none, rather than a guess",
       "icon" not in L.for_device([{"name": "Gtr"}], [], xr18, 8)[0])

    apimod35, a35 = fresh_api(Path(tempfile.mkdtemp()))
    a35.save_default_tracks({"device_index": 0, "tracks": [
        {"name": "Bass", "channel": 1, "icon": "bass"},
        {"name": "Keys", "channel": 2, "stereo": True, "icon": "keys"},
        {"name": "Gtr", "channel": 4}]})
    ok("the template keeps each member's icon",
       a35._config["tracks"] == [{"name": "Bass", "icon": "bass"},
                                 {"name": "Keys", "stereo": True, "icon": "keys"},
                                 {"name": "Gtr"}])
    ok("and the setup screen gets them back",
       [t.get("icon") for t in a35.load_default_tracks()["tracks"]]
       == ["bass", "keys", None])
    ok("as it does the band on screen, placed again after a rescan",
       a35.load_default_tracks([{"name": "Vox", "icon": "vocals"}])["tracks"][0]
       .get("icon") == "vocals")

    # The player is shown takes, and a take's tracks are only names and
    # files: the icon is the band's, found by the name.
    media = a35.take_media([{"name": "Bass", "file": str(sides / "Gtr.wav")},
                            {"name": "Gtr", "file": str(sides / "Gtr.wav")},
                            {"name": "Keys", "file": str(sides / "nowhere.wav")}])
    ok("the player is told each track's icon, by its name in the band",
       [m.get("icon") for m in media] == ["bass", None, "keys"])

    print("\n[34] Looking for interfaces again")
    # PortAudio lists devices once, when it starts, so a card plugged in
    # later is not offered until it is torn down and started again. The fake
    # PortAudio here counts its starts the way the real one does, swaps in
    # the next list of devices when it is started, and complains if it is
    # torn down while a stream of the app's is still open.
    import threading
    from rehearsal_recorder.audio import devices as devmod

    before_list = list(_DEVICES)
    xr18 = {"name": "X18/XR18", "max_output_channels": 18,
            "max_input_channels": 18, "hostapi": 0, "default_samplerate": 48000}
    pa = {"count": 1, "terminated": 0, "initialised": 0, "next": None,
          "fail": 0, "open_at_terminate": []}
    player_ref = {"p": None}

    def fake_terminate():
        pa["terminated"] += 1
        p = player_ref["p"]
        if p is not None and p._stream is not None:
            pa["open_at_terminate"].append("player")
        pa["count"] -= 1
        _sd._initialized -= 1

    def fake_initialize():
        if pa["fail"]:
            pa["fail"] -= 1
            raise RuntimeError("Error initializing PortAudio")
        pa["initialised"] += 1
        pa["count"] += 1
        _sd._initialized += 1
        if pa["next"] is not None:
            _DEVICES[:] = pa["next"]

    _sd._initialized = 1
    _sd._terminate = fake_terminate
    _sd._initialize = fake_initialize

    apimod34, a34 = fresh_api(Path(tempfile.mkdtemp()))
    a34._remember_device("device", 0)
    try:
        pa["next"] = before_list + [xr18]
        res = a34.rescan_devices()
        ok("a rescan succeeds", res.get("ok") is True)
        ok("and the card plugged in after start is offered",
           any(d["name"] == "X18/XR18" for d in a34.list_input_devices()))
        ok("and named as found", res.get("found") == ["X18/XR18"])
        ok("with nothing gone", res.get("gone") == [])
        ok("PortAudio was torn down and started once each",
           pa["terminated"] == 1 and pa["initialised"] == 1)

        pa["next"] = before_list
        res = a34.rescan_devices()
        ok("a card unplugged is named as gone",
           res.get("gone") == ["X18/XR18"] and res.get("found") == [])

        # Two starts are undone as two: one terminate after two initialises
        # rebuilds nothing, since PortAudio only tears down at zero.
        pa.update(terminated=0, initialised=0)
        _sd._initialized = 2
        pa["count"] = 2
        a34.rescan_devices()
        ok("two starts are undone as two and put back as two",
           pa["terminated"] == 2 and pa["initialised"] == 2
           and _sd._initialized == 2)
        _sd._initialized = 1
        pa["count"] = 1

        # A recording is never risked for a device list.
        pa.update(terminated=0, initialised=0)
        a34._recorder = types.SimpleNamespace(error=None, is_active=lambda: True)
        res = a34.rescan_devices()
        a34._recorder = None
        ok("a rescan during a recording is refused",
           res.get("ok") is False and "recording" in res.get("error", "").lower())
        ok("and PortAudio is not touched", pa["terminated"] == 0)

        # The signal check is only a check: it is stopped.
        stopped = []
        a34._monitor = types.SimpleNamespace(stop=lambda: stopped.append(1))
        a34.rescan_devices()
        ok("the signal check is stopped first",
           stopped == [1] and a34._monitor is None)

        # The player keeps its take; only its output is let go and put back.
        rescan_dir = Path(tempfile.mkdtemp())
        write_wav(rescan_dir / "A.wav", 1000, seconds=4.0)
        a34.player_open([{"name": "A", "file": str(rescan_dir / "A.wav")}])
        player_ref["p"] = a34._player
        a34._player.seek(1.5)
        a34._player.play()
        pa["open_at_terminate"].clear()
        res = a34.rescan_devices()
        ok("the player's output is closed before PortAudio is torn down",
           res.get("ok") is True and pa["open_at_terminate"] == [])
        state = a34._player.state()
        ok("and reopened after, where it was and still playing",
           a34._player._stream is not None
           and abs(state["position"] - 1.5) < 0.2 and state["playing"])
        a34.player_close()
        player_ref["p"] = None

        # PortAudio that will not start again is tried once more.
        pa.update(fail=1, terminated=0, initialised=0)
        res = a34.rescan_devices()
        ok("a failed start is tried again",
           res.get("ok") is True and pa["initialised"] == 1)
        pa.update(fail=2)
        res = a34.rescan_devices()
        ok("and two failures say the app has to be restarted",
           res.get("ok") is False and "restart" in res.get("error", "").lower())
        pa["fail"] = 0
        _sd._initialized = 1

        # Without sounddevice's private calls nothing is touched.
        saved_terminate = _sd._terminate
        del _sd._terminate
        pa.update(terminated=0, initialised=0)
        try:
            res = a34.rescan_devices()
        finally:
            _sd._terminate = saved_terminate
        ok("without sounddevice's own calls nothing is touched",
           pa["initialised"] == 0 and res.get("ok") is False
           and "restart" in res.get("error", "").lower())

        # Asking a card its rates can take seconds on ASIO; a rescan arriving
        # meanwhile has to wait for the answer.
        held = []
        real_check = _sd.check_input_settings

        def watching_check(**kw):
            got = []
            t = threading.Thread(
                target=lambda: got.append(devmod.STREAM_LOCK.acquire(blocking=False)))
            t.start()
            t.join()
            if got[0]:
                devmod.STREAM_LOCK.release()
            held.append(not got[0])
            return real_check(**kw)

        _sd.check_input_settings = watching_check
        try:
            devmod.recording_formats(0, 2)
        finally:
            _sd.check_input_settings = real_check
        ok("asking a card its rates holds the stream lock",
           bool(held) and all(held))

        # A saved card that is not plugged in is reported by name.
        _DEVICES[:] = before_list + [xr18]
        a34._remember_device("device", len(before_list))
        ok("a saved card that is present is not reported missing",
           a34.get_settings()["missing_device"] is None)
        _DEVICES[:] = before_list
        missing = a34.get_settings()["missing_device"]
        ok("a saved card that is absent is reported by name",
           missing == {"name": "X18/XR18", "host_api": "CoreAudio"})
        ok("and does not count as a device in force",
           a34.get_settings()["device_index"] is None)

        # The band on screen is placed, not the saved one.
        a34._remember_device("device", 0)
        placed = a34.load_default_tracks(
            [{"name": "Bass"}, {"name": "Keys", "stereo": True}])["tracks"]
        ok("the band passed in is the band placed",
           [t["name"] for t in placed] == ["Bass", "Keys"]
           and placed[1]["stereo"] is True
           and placed[0]["channel"] == 1 and placed[1]["channel"] == 2)
        ok("and without one the saved band is used",
           [t["name"] for t in a34.load_default_tracks()["tracks"]]
           == [t["name"] for t in a34._config.get("tracks")
               or [{"name": "Guitar 1"}, {"name": "Vocals"}]])
    finally:
        _DEVICES[:] = before_list
        for attr in ("_initialized", "_terminate", "_initialize"):
            if hasattr(_sd, attr):
                delattr(_sd, attr)

    print("\n[35] Every card is opened from one thread that is ready for it")
    # On Windows an ASIO driver is a COM object, loaded by whichever thread
    # asks PortAudio for it — and only a thread that has joined a COM
    # apartment can load one. PortAudio joins one for the thread that starts
    # it and leaves every other thread to its caller. pywebview answers each
    # interface call on a fresh thread that has joined nothing, so every ASIO
    # stream the app opened came back "Failed to load ASIO driver". Opening,
    # starting, stopping, closing and asking all go to one long-lived thread
    # now, which joins at birth.
    from rehearsal_recorder.audio.capture import AudioRecorder

    seen = []

    def saw(what):
        seen.append((what, threading.current_thread()))

    # Standalone rather than built on _FakeStream: [3] has one of its own by
    # that name, which is the one in scope here.
    class _WatchedStream:
        def __init__(self, **kw):
            saw("open")
            self.kw = kw
            self.active = False

        def start(self):
            saw("start")
            self.active = True

        def stop(self):
            saw("stop")
            self.active = False

        def close(self):
            saw("close")

    real = {name: getattr(_sd, name) for name in (
        "InputStream", "OutputStream",
        "check_input_settings", "check_output_settings")}

    def watched(name):
        def call(**kw):
            saw(name)
            return real[name](**kw)
        return call

    _sd.InputStream = _sd.OutputStream = _WatchedStream
    _sd.check_input_settings = watched("check_input_settings")
    _sd.check_output_settings = watched("check_output_settings")
    _sd._initialized = 1
    _sd._terminate = lambda: (saw("terminate"), setattr(
        _sd, "_initialized", _sd._initialized - 1))
    _sd._initialize = lambda: (saw("initialize"), setattr(
        _sd, "_initialized", _sd._initialized + 1))

    _, a35 = fresh_api(Path(tempfile.mkdtemp()))
    take35 = Path(tempfile.mkdtemp())
    write_wav(take35 / "A.wav", 1000)
    one_track = [{"name": "A", "channel": 1}]
    answers = {}

    def as_the_interface_calls():
        answers["monitor"] = a35.start_monitor(0, 48000, one_track)
        a35.stop_monitor()
        recorder = AudioRecorder(0, 48000, one_track, take35 / "take", 16)
        recorder.start()
        recorder.stop()
        player = TakePlayer([{"name": "A", "file": str(take35 / "A.wav")}])
        player.open_output(0)
        player.close()
        devmod.recording_formats(0, 2)

    def looking_again():
        answers["rescan"] = devmod.rescan()

    try:
        callers = [threading.Thread(target=as_the_interface_calls),
                   threading.Thread(target=looking_again)]
        for caller in callers:
            caller.start()
            caller.join()

        ok("the calls went through", answers["monitor"].get("ok") is True
           and answers["rescan"] is None)
        ok("every kind of call was seen",
           {what for what, _ in seen} >= {
               "open", "start", "stop", "close", "check_input_settings",
               "check_output_settings", "terminate", "initialize"})
        threads = {t for _, t in seen}
        ok("all of them on one thread, whoever asked", len(threads) == 1)
        audio_thread = threads.pop() if len(threads) == 1 else None
        ok("which is none of the callers",
           audio_thread is not None
           and audio_thread not in callers
           and audio_thread is not threading.main_thread())
        ok("and outlives them, so what it loaded stays loaded",
           audio_thread is not None and audio_thread.is_alive())

        # What refuses on that thread still comes back to whoever asked.
        class _Refusing:
            def __init__(self, **kw):
                raise RuntimeError("Failed to load ASIO driver")

        _sd.InputStream = _Refusing
        refused = a35.start_monitor(0, 48000, one_track)
        ok("a refusal on the audio thread reaches the caller",
           refused.get("ok") is False
           and "Failed to load ASIO driver" in refused.get("error", ""))

        # A stream that opens but will not start is closed again: left open,
        # an ASIO card stays taken, and every later attempt says "in use".
        class _WontStart(_WatchedStream):
            def start(self):
                raise RuntimeError("ASIOStart failed")

        _sd.InputStream = _WontStart
        seen.clear()
        a35.start_monitor(0, 48000, one_track)
        ok("a stream that will not start is closed, not left holding the card",
           [what for what, _ in seen] == ["open", "close"])
    finally:
        for name, fn in real.items():
            setattr(_sd, name, fn)
        for attr in ("_initialized", "_terminate", "_initialize"):
            if hasattr(_sd, attr):
                delattr(_sd, attr)

    # The thread itself: it joins once, before anything runs on it, and a
    # job that asks for the thread it is already on is simply run.
    joined = []
    worker = devmod.AudioThread(
        prepare=lambda: joined.append(threading.current_thread()))
    first = worker.run(threading.current_thread)
    second = worker.run(threading.current_thread)
    ok("the thread joins once, on itself, before its first job",
       joined == [first] and first is second)
    ok("a job that asks from the thread itself does not wait for itself",
       worker.run(lambda: worker.run(lambda: "inline")) == "inline")

    print("\n[36] A card that goes quiet, or a driver that stops answering")
    # PortAudio's ASIO backend ignores the driver's reset request, which is
    # what an unplugged card sends: the stream simply stops being called and
    # still reports itself active. The take has to notice on its own.
    import time as _time

    from rehearsal_recorder.audio import heartbeat as hbmod

    quiet_dir = Path(tempfile.mkdtemp())
    quiet = AudioRecorder(0, SR, [{"name": "Gtr", "channel": 1}], quiet_dir / "q")
    quiet.start()
    ok("a take that has only just started is not called stalled",
       quiet.problem() is None)
    quiet._callback(np.zeros((256, 1), dtype=np.int16), 256, None, None)
    quiet._heartbeat._last -= hbmod.SILENCE_SEC + 1
    said = quiet.problem() or ""
    ok("no sound for longer than that stops the take, and says why",
       "stopped" in said.lower() and "interface" in said.lower())
    _, a36 = fresh_api(Path(tempfile.mkdtemp()))
    a36._recorder = quiet
    ok("the health check reports it, so the screen stops and saves the take",
       a36.recording_health()["error"] == said)
    a36._recorder = None
    quiet.stop()

    flowing = AudioRecorder(0, SR, [{"name": "Gtr", "channel": 1}], quiet_dir / "f")
    flowing.start()
    flowing._heartbeat._last -= hbmod.SILENCE_SEC + 1
    flowing._callback(np.zeros((256, 1), dtype=np.int16), 256, None, None)
    ok("a block arriving means the card is still there",
       flowing.problem() is None)
    flowing.stop()
    flowing._heartbeat._last -= hbmod.SILENCE_SEC + 1
    ok("and a take that has been stopped is not called stalled afterwards",
       flowing.problem() is None)

    # A driver that never comes back from stopping must not take the
    # recording with it: the take is finished all the same, and until the
    # driver answers again, anything else asked of it says so at once
    # instead of waiting behind it.
    patience = devmod.DRIVER_PATIENCE_SEC
    devmod.DRIVER_PATIENCE_SEC = 0.3
    hold = threading.Event()
    opened_before = []

    class _HangsOnStop:
        def __init__(self, **kw):
            opened_before.append(1)
            self.active = False

        def start(self):
            self.active = True

        def stop(self):
            hold.wait(10)

        def close(self):
            pass

    try:
        _sd.InputStream = _HangsOnStop
        stuck = AudioRecorder(0, SR, [{"name": "Gtr", "channel": 1}],
                              quiet_dir / "stuck")
        stuck.start()
        stuck._callback(np.full((256, 1), 900, dtype=np.int16), 256, None, None)
        began = _time.monotonic()
        result = stuck.stop()
        ok("stopping gives up on a driver that does not answer",
           _time.monotonic() - began < 3)
        ok("and the take is finished all the same",
           result["tracks"] and Path(result["tracks"][0]["file"]).exists()
           and abs(result["duration_sec"] - 256 / SR) < 0.001)

        opened_before.clear()
        began = _time.monotonic()
        refused = a36.start_monitor(0, 48000, [{"name": "A", "channel": 1}])
        ok("while it is stuck, opening says so at once rather than waiting",
           refused.get("ok") is False
           and "stopped answering" in refused.get("error", "")
           and _time.monotonic() - began < 0.2 and opened_before == [])

        _sd._initialized = 1
        _sd._terminate = _sd._initialize = lambda: None
        try:
            rescanned = devmod.rescan()
        finally:
            for attr in ("_initialized", "_terminate", "_initialize"):
                delattr(_sd, attr)
        ok("and looking for interfaces again says so too, not 'restart'",
           rescanned == devmod.NOT_ANSWERING)

        hold.set()
        answered = False
        for _ in range(40):
            _time.sleep(0.05)
            if a36.start_monitor(0, 48000, [{"name": "A", "channel": 1}]).get("ok"):
                answered = True
                break
        a36.stop_monitor()
        ok("once the driver answers, the card can be opened again", answered)

        # A card that opens only after the app has stopped waiting for it is
        # closed again, not left holding the card with nobody to close it.
        late_hold = threading.Event()
        late_streams = []

        class _SlowToOpen(_HangsOnStop):
            def __init__(self, **kw):
                late_hold.wait(10)
                super().__init__(**kw)
                self.closed = False
                late_streams.append(self)

            def stop(self):
                pass

            def close(self):
                self.closed = True

        _sd.InputStream = _SlowToOpen
        late = a36.start_monitor(0, 48000, [{"name": "A", "channel": 1}])
        ok("an opening that takes too long is given up on",
           late.get("ok") is False and "stopped answering" in late.get("error", ""))
        late_hold.set()
        for _ in range(40):
            _time.sleep(0.05)
            if late_streams and late_streams[0].closed:
                break
        ok("and the stream it opened late is closed, not left open",
           len(late_streams) == 1 and late_streams[0].closed)
    finally:
        hold.set()
        _sd.InputStream = real["InputStream"]
        devmod.DRIVER_PATIENCE_SEC = patience

    # Calls queued behind one that never came back are dropped once their
    # callers have given up, rather than run at some random moment later.
    lone = devmod.AudioThread(prepare=lambda: None)
    blocked = threading.Event()
    behind = []
    first_caller = threading.Thread(
        target=lambda: _try(lambda: lone.run(lambda: blocked.wait(10), timeout=0.3)))

    def _try(fn):
        try:
            fn()
        except devmod.DriverNotAnswering:
            pass

    first_caller.start()
    _time.sleep(0.05)
    _try(lambda: lone.run(lambda: behind.append(1), timeout=0.3))
    first_caller.join()
    blocked.set()
    _time.sleep(0.2)
    ok("a call whose caller gave up is not run afterwards", behind == [])
    ok("and the thread takes new calls once the stuck one is back",
       lone.run(lambda: "again") == "again")

    # A call that was only slow, not stuck — a sluggish driver loading while
    # a quicker question waited behind it and gave up — must not leave the
    # thread refusing everything once the slow one has finished.
    slow_done = threading.Event()
    slow_caller = threading.Thread(target=lambda: lone.run(
        lambda: (_time.sleep(0.5), slow_done.set()), timeout=5))
    slow_caller.start()
    _time.sleep(0.05)
    _try(lambda: lone.run(lambda: "impatient", timeout=0.2))
    slow_caller.join()
    ok("a slow call that finishes clears the way for the next one",
       slow_done.is_set() and lone.run(lambda: "after") == "after")

    # A late answer's clean-up is still the thread being busy: until it is
    # done, the next caller is told so at once rather than left to wait.
    tidy = threading.Event()
    _try(lambda: lone.run(lambda: _time.sleep(0.3), timeout=0.1,
                          late=lambda _: tidy.wait(10)))
    _time.sleep(0.4)
    began = _time.monotonic()
    _try(lambda: lone.run(lambda: None, timeout=5))
    ok("while a late answer is being tidied up, callers are told at once",
       _time.monotonic() - began < 0.1)
    tidy.set()
    _time.sleep(0.1)
    ok("and served again once it is", lone.run(lambda: "tidy") == "tidy")

    print("\n[38] What a stuck driver must not be mistaken for")
    patience = devmod.DRIVER_PATIENCE_SEC
    devmod.DRIVER_PATIENCE_SEC = 0.2

    def settle_audio_thread():
        for _ in range(60):
            try:
                devmod.AUDIO_THREAD.run(lambda: None)
                return
            except devmod.DriverNotAnswering:
                _time.sleep(0.05)

    try:
        # Asking the rates: a card that stops answering half-way has not
        # refused the rates it was not asked about.
        wake = threading.Event()
        real_check = _sd.check_input_settings

        def answers_then_hangs(**kw):
            if kw["samplerate"] == 48000:
                wake.wait(10)
            return real_check(**kw)

        _sd.check_input_settings = answers_then_hangs
        formats, trouble = devmod.recording_formats(0, 2)
        _sd.check_input_settings = real_check
        wake.set()
        settle_audio_thread()
        ok("a driver that stops answering mid-list is not a list of refusals",
           formats == {} and trouble == devmod.NOT_ANSWERING)

        # Playback: not answering is not "will not take 48000 Hz".
        real_run = devmod.AUDIO_THREAD.run

        def refuse(job, **kw):
            raise devmod.DriverNotAnswering(devmod.NOT_ANSWERING)

        devmod.AUDIO_THREAD.run = refuse
        try:
            where, why = devmod.usable_output(0, 48000)
        finally:
            devmod.AUDIO_THREAD.run = real_run
        ok("a playback card that did not answer is not blamed on the rate",
           where is None and "Hz" not in (why or "")
           and "answer" in (why or ""))

        # Closing while stuck: the stream is not dropped on the floor. The
        # caller has already let go of it, so if this close were thrown away
        # it would run on, calling into an object nobody holds.
        held = threading.Event()
        _try(lambda: devmod.AUDIO_THREAD.run(lambda: held.wait(10)))

        class _Closable:
            closed = False

            def stop(self):
                pass

            def close(self):
                self.closed = True

        orphan = _Closable()
        began = _time.monotonic()
        refused_close = False
        try:
            devmod.close_stream(orphan)
        except devmod.DriverNotAnswering:
            refused_close = True
        ok("closing while the driver is stuck says so at once",
           refused_close and _time.monotonic() - began < 0.1)
        held.set()
        settle_audio_thread()
        ok("and the stream is closed as soon as the driver is back",
           orphan.closed)

        # Looking again waits for PortAudio to stop and start however long
        # it takes: given up on half-way, PortAudio would be left half torn
        # down with the device list read from under it.
        steps = []
        _sd._initialized = 1
        _sd._terminate = lambda: (_time.sleep(0.5), steps.append("stop"),
                                  setattr(_sd, "_initialized", 0))
        _sd._initialize = lambda: (steps.append("start"),
                                   setattr(_sd, "_initialized", 1))
        try:
            restarted = devmod.rescan()
        finally:
            for attr in ("_initialized", "_terminate", "_initialize"):
                delattr(_sd, attr)
        ok("looking again waits for a slow PortAudio rather than giving up",
           restarted is None and steps == ["stop", "start"])
    finally:
        devmod.DRIVER_PATIENCE_SEC = patience

    # A block that takes long to write — a slow disk — is not a card gone
    # quiet: the card delivered it, the app is busy with it.
    stall = hbmod.SILENCE_SEC
    hbmod.SILENCE_SEC = 0.2
    try:
        slow_dir = Path(tempfile.mkdtemp())
        slow = AudioRecorder(0, SR, [{"name": "Gtr", "channel": 1}], slow_dir)
        slow.start()
        disk = threading.Event()

        class _SlowDisk:
            def write(self, data):
                disk.wait(10)

        real_file = slow._raw_files["Gtr"]
        slow._raw_files["Gtr"] = _SlowDisk()
        writer = threading.Thread(target=lambda: slow._callback(
            np.zeros((256, 1), dtype=np.int16), 256, None, None))
        writer.start()
        _time.sleep(0.4)
        ok("a block still being written is not a stalled card",
           slow.problem() is None)
        disk.set()
        writer.join()
        slow._raw_files["Gtr"] = real_file
        ok("nor is the moment after it", slow.problem() is None)
        _time.sleep(0.3)
        ok("but silence after it still is", slow.problem() is not None)
        slow.stop()
    finally:
        hbmod.SILENCE_SEC = stall

    # A take that will not start leaves nothing that looks like one.
    import gc
    import weakref

    class _Refuses:
        def __init__(self, **kw):
            raise RuntimeError("Failed to load ASIO driver")

    _sd.InputStream = _Refuses
    try:
        refused_dir = Path(tempfile.mkdtemp()) / "_drafts" / "take 1"
        doomed = AudioRecorder(0, SR, [{"name": "Gtr", "channel": 1}], refused_dir)
        files = []
        try:
            doomed.start()
            began_ok = True
        except RuntimeError:
            began_ok = False
        files = list(doomed._raw_files.values())
        ok("the refusal reaches whoever started the take", not began_ok)
        ok("no empty raw files or record are left to pass for an unsaved take",
           not refused_dir.exists() or not any(refused_dir.iterdir()))
        ok("and no file is left open", files and all(f.closed for f in files))
        gone = weakref.ref(doomed)
        del doomed, files
        gc_was = gc.isenabled()
        gc.disable()
        try:
            ok("and the failed take is let go of at once, not kept by the "
               "audio thread", gone() is None)
        finally:
            if gc_was:
                gc.enable()
    finally:
        _sd.InputStream = real["InputStream"]

    # The same when it is the disk that refuses, part-way through making the
    # files: what was made is taken back, and the disk's own error is the
    # one that comes back — not one from the tidying up.
    blocked_dir = Path(tempfile.mkdtemp()) / "_drafts" / "take 1"
    two = [{"name": "Gtr", "channel": 1}, {"name": "Bass", "channel": 2}]
    halfway = AudioRecorder(0, SR, two, blocked_dir)
    (blocked_dir / "Bass.raw").mkdir()  # a file cannot be made where a folder is
    try:
        halfway.start()
        refusal = None
    except OSError as e:
        refusal = e
    ok("a take whose files cannot all be made does not start",
       refusal is not None and "Bass.raw" in str(refusal))
    ok("and takes back the ones it did make",
       not (blocked_dir / "Gtr.raw").exists()
       and not (blocked_dir / "take.json").exists()
       and all(f.closed for f in halfway._raw_files.values()))
    ok("leaving alone what it did not",
       (blocked_dir / "Bass.raw").is_dir())

    print("\n[37] Closing the app with a card open")
    # Closing the window mid-take used to leave the take recording until the
    # interpreter went down around it. It lets go of the card and its files
    # at once, and waits as raw files for the drafts to recover — not
    # finished there and then, which would rewrite every track after the
    # window had gone. The player lets go of its card too.
    from rehearsal_recorder.audio.drafts import draft_dirs

    _, a37 = fresh_api(Path(tempfile.mkdtemp()))
    a37.start_rehearsal("Late night", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    a37.start_take()
    a37._recorder._callback(np.full((256, 1), 900, dtype=np.int16), 256, None, None)
    a37_files = list(a37._recorder._raw_files.values())
    folder37 = Path(a37._session["folder"])
    player_dir = Path(tempfile.mkdtemp())
    write_wav(player_dir / "A.wav", 1000)
    a37.player_open([{"name": "A", "file": str(player_dir / "A.wav")}])
    a37.shutdown()
    kept = draft_dirs(folder37)
    ok("closing the window mid-take lets go of the take at once",
       a37._recorder is None and len(kept) == 1
       and (kept[0] / "Gtr.raw").exists()
       and (kept[0] / "take.json").exists()
       and not (kept[0] / "Gtr.wav").exists())
    ok("with every byte written and the files closed",
       (kept[0] / "Gtr.raw").stat().st_size == 256 * 2
       and all(f.closed for f in a37_files))
    ok("and the player lets go of its card", a37._player is None)
    from rehearsal_recorder.audio.drafts import describe, finalize

    ok("the unsaved take says how long it is",
       abs(describe(kept[0], SR, 16)["duration_sec"] - 256 / SR) < 1e-6)
    recovered = finalize(kept[0], SR, 16)
    ok("and is recovered at that length",
       abs(recovered["duration_sec"] - 256 / SR) < 1e-6)
    # A draft that is already .wav — stopped, then left unsaved when the
    # window closed — has its length in its header, not in the size of a raw
    # file: it used to be listed, and recovered, as 0:00.
    ok("a draft that is already .wav says how long it is too",
       abs(describe(kept[0], SR, 16)["duration_sec"] - 256 / SR) < 1e-6
       and abs(finalize(kept[0], SR, 16)["duration_sec"] - 256 / SR) < 1e-6)
    shut_cleanly = True
    try:
        a37.shutdown()
    except Exception:
        shut_cleanly = False
    ok("closing twice is harmless", shut_cleanly)

    # sounddevice stops PortAudio at exit from the main thread, closing any
    # stream still open there. On ASIO that is a driver loaded on the audio
    # thread being let go from another, so the app stops PortAudio first, on
    # the audio thread.
    ends = []
    _sd._initialized = 2
    _sd._terminate = lambda: (ends.append(threading.current_thread()),
                              setattr(_sd, "_initialized", _sd._initialized - 1))
    try:
        devmod.release_at_exit()
        ok("PortAudio is stopped as many times as it was started",
           len(ends) == 2 and _sd._initialized == 0)
        ok("on the audio thread",
           all(t is devmod.AUDIO_THREAD._thread for t in ends))
    finally:
        for attr in ("_initialized", "_terminate"):
            if hasattr(_sd, attr):
                delattr(_sd, attr)
    try:
        devmod.release_at_exit()
        left_alone = True
    except Exception:
        left_alone = False
    ok("and a build without those calls is left alone", left_alone)

    print("\n[39] The signal check and the player notice a card gone quiet")
    # The take's own watch, shared: a stream nobody has called for a few
    # seconds, and that is not in the middle of a call, has lost its card.
    beat = hbmod.Heartbeat()
    ok("a stream not yet running is not silent", not beat.silent())
    beat.start()
    ok("one that has just started is not either", not beat.silent())
    # A driver can take a couple of seconds to send its first block —
    # FlexASIO took two — so a card is given five before it is called gone.
    beat._last -= 4
    ok("a card that has sent nothing yet is given more than three seconds",
       not beat.silent())
    beat._last -= 2
    ok("but not more than five", beat.silent())
    beat.enter()
    beat.leave()
    beat._last -= 4
    ok("once it has sent a block, three seconds without one is silence",
       beat.silent())
    beat.start()
    beat._last -= 4
    ok("a stream started again is given its five seconds again",
       not beat.silent())
    beat.enter()
    beat.leave()
    beat._last -= hbmod.SILENCE_SEC + 1
    ok("one not called for longer than that is", beat.silent())
    beat.enter()
    beat._last -= hbmod.SILENCE_SEC + 1
    ok("unless it is in the middle of a call", not beat.silent())
    beat.leave()
    ok("and just after one it is not", not beat.silent())
    beat.stop()
    beat._last = None
    ok("a stopped stream is never silent", not beat.silent())

    _, a39 = fresh_api(Path(tempfile.mkdtemp()))
    one = [{"name": "A", "channel": 1}]
    ok("no check, nothing to report",
       a39.monitor_health() == {"checking": False, "problem": None})
    a39.start_monitor(0, 48000, one)
    ok("a check that has just started is healthy",
       a39.monitor_health() == {"checking": True, "problem": None})
    # The fake streams here are never called, so these cards have sent
    # nothing at all: gone is past the wait for a first block.
    gone = hbmod.FIRST_BLOCK_SEC + 1
    a39._monitor._heartbeat._last -= gone
    said = a39.monitor_health()
    ok("a card gone quiet during the check says so, by name",
       said["checking"] is True and "“Interface”" in (said["problem"] or "")
       and "Check signal" in (said["problem"] or ""))
    ok("the health poll only reports it; stopping is the screen's call",
       a39._monitor is not None)
    a39.stop_monitor()
    ok("and once stopped there is nothing to report",
       a39.monitor_health() == {"checking": False, "problem": None})

    a39.start_monitor(0, 48000, one)
    a39._monitor._heartbeat._last -= hbmod.SILENCE_SEC + 1
    a39._monitor._callback(np.zeros((256, 1), dtype=np.int16), 256, None, None)
    ok("a block arriving means the card is still there",
       a39.monitor_health()["problem"] is None)
    a39.stop_monitor()

    # The player: a playback card gone quiet pauses the take and says so.
    # Play again tries the chosen card before anything else.
    play_dir = Path(tempfile.mkdtemp())
    write_wav(play_dir / "A.wav", 1000, seconds=4.0)
    a39._remember_device("output_device", 0)
    opened = a39.player_open([{"name": "A", "file": str(play_dir / "A.wav")}])
    ok("a healthy player has nothing to report",
       opened.get("ok") and opened.get("problem") is None)
    a39.player_play()
    a39._player._heartbeat._last -= gone
    lost = a39.player_state()
    ok("a playback card gone quiet stops playback",
       lost["playing"] is False)
    ok("and says which card, and what to do",
       "“Interface”" in (lost.get("problem") or "")
       and "play" in (lost.get("problem") or "").lower())
    stream_before = a39._player._stream
    back = a39.player_play()
    ok("play gives it its card back and plays",
       back.get("ok") and back.get("reopened") is True and back["playing"] is True
       and a39._player._stream is not stream_before
       and a39._player._stream.kw.get("device") == 0)
    ok("with nothing left to report", back.get("problem") is None
       and "warning" not in back)
    a39._player._heartbeat._last -= gone
    a39.player_state()

    # Still gone when play is pressed. PortAudio's list does not change when
    # a card is unplugged; the card just refuses to open. Then the system
    # output, and the usual warning about it.
    real_output = _sd.OutputStream

    def unplugged(**kw):
        if kw.get("device") == 0:
            raise RuntimeError("Error opening OutputStream: device unavailable")
        return real_output(**kw)

    _sd.OutputStream = unplugged
    try:
        again = a39.player_toggle()
    finally:
        _sd.OutputStream = real_output
    ok("a card still gone is played around, through the system output",
       again.get("ok") and again.get("reopened") is True
       and a39._player._stream.kw.get("device") is None
       and "system output" in (again.get("warning") or ""))
    ok("pausing a player that is fine does not reopen anything",
       "reopened" not in a39.player_toggle())

    # Gone quiet while paused, with nobody polling: the first press of play
    # still notices, rather than playing into a dead stream first.
    a39._player._heartbeat._last -= gone
    first_press = a39.player_play()
    ok("a card lost while paused is given back on the first play",
       first_press.get("reopened") is True and first_press["playing"] is True)
    a39.player_close()

    print("\n[40] The journal of long work")
    from rehearsal_recorder import activity as actmod

    j = actmod.Journal()
    e = j.begin("cloud", "“Polyn” → cloud", "/rec/One", 2, waiting=True)
    snap = j.snapshot()
    ok("a queued job is listed as waiting",
       snap[0]["state"] == "waiting" and snap[0]["take_number"] == 2
       and snap[0]["fraction"] == 0.0)
    e.start("Mixing")
    e.progress(0.25)
    e.progress(0.1)  # never backwards
    ok("a running job says how far along it is",
       j.snapshot()[0]["state"] == "running"
       and j.snapshot()[0]["fraction"] == 0.25
       and j.snapshot()[0]["step"] == "Mixing")
    e.done("MP3 of the mix")
    got = j.snapshot()[0]
    ok("a finished one says what it came to, unseen",
       got["state"] == "done" and got["fraction"] == 1.0
       and got["detail"] == "MP3 of the mix" and got["seen"] is False)
    bad = j.begin("cloud", "“Take 3” → cloud", "/rec/One", 3)
    bad.start()
    bad.fail("The cloud folder is gone", retry="both")
    ok("a failure keeps why and what to retry",
       j.find(bad.id).snapshot()["error"] == "The cloud folder is gone"
       and j.find(bad.id).snapshot()["retry"] == "both")
    running = j.begin("crop", "Cropping “Polyn”", "/rec/One", 1)
    running.start()
    order = [x["id"] for x in j.snapshot()]
    ok("what is running comes first, then the finished, newest first",
       order == [running.id, bad.id, e.id])
    j.mark_seen()
    ok("looking marks the finished ones seen, not the running",
       all(x["seen"] for x in j.snapshot() if x["state"] in ("done", "failed")))
    gone = j.begin("cloud", "nothing to do", "/rec/One", 4, waiting=True)
    gone.discard()
    ok("a job with nothing to do leaves no trace",
       all(x["id"] != gone.id for x in j.snapshot()))
    for i in range(30):
        f = j.begin("cloud", f"t{i}", "/rec/Two", i)
        f.done()
    ok("only the last twenty finished are kept",
       sum(1 for x in j.snapshot() if x["state"] != "running") == 20
       and j.snapshot()[1]["title"] == "t29")
    j.clear()
    ok("clearing drops the finished and keeps the running",
       [x["id"] for x in j.snapshot()] == [running.id])

    seen_parts = []
    stages = actmod.Stages([("Mixing", 2), ("Encoding the mix", 1),
                            ("Encoding the tracks", 0)],
                           lambda f, s: seen_parts.append((round(f, 3), s)))
    stages.part(0)(0.5)
    stages.part(0)(1.0)
    stages.part(1)(0.5)
    stages.part(2)(1.0)
    ok("stages add up by weight",
       seen_parts == [(0.333, "Mixing"), (0.667, "Mixing"),
                      (0.833, "Encoding the mix"), (1.0, "Encoding the tracks")])

    _, a40 = fresh_api(Path(tempfile.mkdtemp()))
    first = a40._journal.begin("crop", "Cropping", "/rec/X", 1)
    first.start()
    ok("the interface can ask for it",
       a40.activity()["entries"][0]["kind"] == "crop"
       and a40.activity()["recording"] is False)
    first.done()
    a40.activity_seen()
    ok("and mark it seen", a40.activity()["entries"][0]["seen"] is True)
    a40.clear_activity()
    ok("and clear it", a40.activity()["entries"] == [])
    from rehearsal_recorder import mediaserver
    ok("it is polled over http", "activity" in mediaserver.POLLABLE)

    print("\n[41] Long loops say how far along they are")
    from rehearsal_recorder.audio.capture import raw_to_wav as r2w
    from rehearsal_recorder.audio.crop import crop_wav as cw
    from rehearsal_recorder.audio.encode import encode as enc
    from rehearsal_recorder.audio.mixdown import mixdown as md

    def reference_wav(raw, wav, rate, depth, channels):
        # The old raw_to_wav, kept here to compare against byte for byte.
        width = (2 if depth == 16 else 3) * channels
        data = Path(raw).read_bytes()
        usable = len(data) - (len(data) % width)
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(channels)
            w.setsampwidth(2 if depth == 16 else 3)
            w.setframerate(rate)
            w.writeframes(data[:usable])

    loops = Path(tempfile.mkdtemp())
    rng = np.random.default_rng(7)
    for depth, channels, size in ((16, 1, 10_000_003), (24, 2, 12_345_677),
                                  (16, 2, 0), (24, 1, 5)):
        raw = loops / f"r{depth}{channels}{size}.raw"
        raw.write_bytes(rng.integers(0, 256, size, dtype=np.uint8).tobytes())
        mine, theirs = loops / "mine.wav", loops / "theirs.wav"
        steps = []
        r2w(raw, mine, SR, depth, channels=channels, progress=steps.append)
        reference_wav(raw, theirs, SR, depth, channels)
        ok(f"a {depth}-bit, {channels}-channel raw of {size} bytes is wrapped "
           "exactly as before", mine.read_bytes() == theirs.read_bytes())
        ok("and says how far along it is, up to the end",
           steps and steps[-1] == 1.0 and steps == sorted(steps))

    write_wav(loops / "A.wav", 1000, seconds=3.0)
    write_wav(loops / "B.wav", 2000, seconds=2.0)
    steps = []
    md([{"name": "A", "file": str(loops / "A.wav")},
        {"name": "B", "file": str(loops / "B.wav")}],
       loops / "mix.wav", progress=steps.append)
    ok("a mixdown says how far along it is",
       len(steps) > 2 and steps[-1] == 1.0 and steps == sorted(steps)
       and any(0.4 < s < 0.6 for s in steps))

    steps = []
    enc(loops / "mix.wav", "flac", progress=steps.append)
    ok("so does an encode", steps and steps[-1] == 1.0 and steps == sorted(steps))

    steps = []
    cw(loops / "A.wav", loops / "A-cut.wav", 0.5, 2.5, progress=steps.append)
    ok("and a crop", steps and steps[-1] == 1.0 and steps == sorted(steps))

    print("\n[42] Crop, stop and recover say how far along they are")
    _, a42 = fresh_api(Path(tempfile.mkdtemp()))
    seen42 = []
    real_begin = a42._journal.begin

    def spying_begin(kind, title, *args, **kwargs):
        entry = real_begin(kind, title, *args, **kwargs)
        real_progress = entry.progress

        def spy(fraction, step=None):
            seen42.append((kind, fraction))
            real_progress(fraction, step)

        entry.progress = spy
        return entry

    a42._journal.begin = spying_begin
    a42.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1},
                                          {"name": "Bass", "channel": 2}], 16)
    a42.start_take()
    # Three seconds: a crop has to leave at least one.
    a42._recorder._callback(np.full((3 * SR, 2), 900, dtype=np.int16), 3 * SR,
                            None, None)
    stopped = a42.stop_take()
    kinds = {e["kind"]: e for e in a42.activity()["entries"]}
    ok("stopping a take is in the journal, finished",
       kinds.get("stop", {}).get("state") == "done"
       and "Saving" in kinds["stop"]["title"])
    ok("and said how far along it was",
       [f for k, f in seen42 if k == "stop"][-1:] == [1.0])

    seen42.clear()
    cut = a42.crop_draft(stopped["temp_dir"], stopped["tracks"], 0.5, 2.0)
    ok("cropping a take under review is in the journal",
       cut["ok"] and any(e["kind"] == "crop" and e["state"] == "done"
                         for e in a42.activity()["entries"])
       and [f for k, f in seen42 if k == "crop"][-1:] == [1.0])

    # A draft left behind by a crash, recovered.
    folder42 = Path(a42._session["folder"])
    draft = folder42 / "_drafts" / "take 9"
    draft.mkdir(parents=True)
    (draft / "Gtr.raw").write_bytes(struct.pack("<h", 700) * 4800)
    seen42.clear()
    a42.recover_draft(str(draft))
    ok("recovering a draft is in the journal",
       any(e["kind"] == "recover" and e["state"] == "done"
           for e in a42.activity()["entries"])
       and [f for k, f in seen42 if k == "recover"][-1:] == [1.0])

    # A crop that fails is in the journal as failed, with the reason.
    bad = a42.crop_take(str(folder42), 99, 0.0, 1.0)
    ok("a crop that is refused before it starts leaves no entry",
       not bad["ok"] and sum(1 for e in a42.activity()["entries"]
                             if e["kind"] == "crop") == 1)

    print("\n[43] Cloud copies run in the background")
    root43 = Path(tempfile.mkdtemp())
    _, a43 = fresh_api(root43)
    a43.set_cloud_dir(str(root43 / "Cloud"))
    a43.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    a43.start_take()
    a43._recorder._callback(np.full((4800, 1), 900, dtype=np.int16), 4800, None, None)
    s43 = a43.stop_take()
    a43.keep_take(s43["take_number"], s43["temp_dir"], "Polyn",
                  s43["duration_sec"], s43["tracks"])
    folder43 = a43._session["folder"]
    n43 = s43["take_number"]
    while a43._cloud_queue.run_next():
        pass
    a43.clear_activity()

    queued = a43.share_take(str(folder43), n43, "both")
    ok("sharing by hand answers at once, queued",
       queued["ok"] and queued.get("queued") is True
       and a43._cloud_queue.states(str(folder43)) == {n43: "queued"})
    entry43 = a43.activity()["entries"][0]
    ok("and is in the journal, waiting",
       entry43["kind"] == "cloud" and entry43["state"] == "waiting"
       and "Polyn" in entry43["title"])
    fractions = []
    real_step = a43._copy_to_cloud

    def watching(*args, **kwargs):
        inner = kwargs.get("progress")
        kwargs["progress"] = lambda f, s=None: (fractions.append(f), inner(f, s))
        return real_step(*args, **kwargs)

    a43._copy_to_cloud = watching
    a43._cloud_queue.run_next()
    a43._copy_to_cloud = real_step
    finished = a43.activity()["entries"][0]
    ok("it runs, rising to the end",
       fractions and fractions[-1] == 1.0 and fractions == sorted(fractions))
    ok("and says what it came to",
       finished["state"] == "done" and finished["detail"])
    ok("the take has its copies", a43._lib.take(folder43, n43)["cloud"].get("mix"))

    # Queued automatically, then by hand, before either ran: one job, doing
    # what the hand asked for.
    a43._cloud_queue.enqueue(str(folder43), n43)
    a43.share_take(str(folder43), n43, "tracks")
    ok("a manual request replaces a waiting automatic one",
       a43._cloud_queue._jobs == [[str(folder43), n43, "tracks"]]
       and sum(1 for e in a43.activity()["entries"]
               if e["state"] == "waiting") == 1)
    while a43._cloud_queue.run_next():
        pass

    # A failure: the cloud folder cannot be written. Journal and take both
    # say so; retry queues it again as a manual job.
    a43.clear_activity()
    real_copy = a43._copy_to_cloud
    a43._copy_to_cloud = lambda *a, **k: {"ok": False, "error": "The cloud folder is gone"}
    a43.share_take(str(folder43), n43, "mix")
    a43._cloud_queue.run_next()
    failed = a43.activity()["entries"][0]
    ok("a copy that fails is in the journal with why, and can be retried",
       failed["state"] == "failed" and failed["error"] == "The cloud folder is gone"
       and failed["retry"] == "mix")
    ok("and the take says so too",
       a43._lib.take(folder43, n43).get("cloud_error") == "The cloud folder is gone")
    a43._copy_to_cloud = real_copy
    again = a43.retry_cloud(failed["id"])
    ok("retry queues it again", again["ok"] and
       a43._cloud_queue._jobs == [[str(folder43), n43, "mix"]])
    a43._cloud_queue.run_next()
    ok("and a retry that works clears the failure",
       a43.activity()["entries"][0]["state"] == "done"
       and not a43._lib.take(folder43, n43).get("cloud_error"))
    ok("retrying something that is not a failed copy is refused",
       a43.retry_cloud(10_000)["ok"] is False)

    # An automatic job with nothing to do leaves no trace.
    a43.clear_activity()
    a43.set_auto_publish(True, "mix")
    a43._enqueue_publish(folder43, n43)
    a43._cloud_queue.run_next()
    ok("an automatic copy that was already current leaves no entry",
       a43.activity()["entries"] == [])

    # A take deleted while its copy waits: failed, not a dead worker.
    a43.share_take(str(folder43), n43, "mix")
    real_take = a43._lib.take
    a43._lib.take = lambda *a, **k: None
    a43._cloud_queue.run_next()
    a43._lib.take = real_take
    ok("a take gone while it waited fails with its own reason",
       a43.activity()["entries"][0]["state"] == "failed"
       and "not found" in a43.activity()["entries"][0]["error"].lower())

    # Re-queued while running: the rerun waits and the running one finishes.
    rerun_seen = []

    def requeue_mid_copy(*args, **kwargs):
        a43.share_take(str(folder43), n43, "mix")
        rerun_seen.append([e["state"] for e in a43.activity()["entries"]])
        return real_copy(*args, **kwargs)

    a43.clear_activity()
    a43._copy_to_cloud = requeue_mid_copy
    a43.share_take(str(folder43), n43, "mix")
    a43._cloud_queue.run_next()
    a43._copy_to_cloud = real_copy
    ok("a take re-queued mid-copy waits while the first copy finishes",
       rerun_seen and rerun_seen[0] == ["running", "waiting"]
       and [e["state"] for e in a43.activity()["entries"]] == ["waiting", "done"])
    while a43._cloud_queue.run_next():
        pass

    print("\n[44] Nothing is left spinning, and a stop always stops")
    root44 = Path(tempfile.mkdtemp())
    _, a44 = fresh_api(root44)
    a44.set_cloud_dir(str(root44 / "Cloud"))
    a44.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    a44.start_take()
    a44._recorder._callback(np.full((4800, 1), 900, dtype=np.int16), 4800, None, None)
    s44 = a44.stop_take()
    a44.keep_take(s44["take_number"], s44["temp_dir"], "Polyn",
                  s44["duration_sec"], s44["tracks"])
    folder44, n44 = a44._session["folder"], s44["take_number"]
    while a44._cloud_queue.run_next():
        pass
    a44.clear_activity()

    def locked(*args, **kwargs):
        raise RuntimeError("database is locked")

    # The library fails on the publishing thread before the copy starts.
    a44.share_take(str(folder44), n44, "mix")
    real_take = a44._lib.take
    a44._lib.take = locked
    try:
        a44._cloud_queue.run_next()
    except Exception:
        pass
    finally:
        a44._lib.take = real_take
    ok("a library error on the worker fails the copy instead of leaving it waiting",
       [e["state"] for e in a44.activity()["entries"]] == ["failed"])

    # The copy fails, and so does writing the failure down.
    a44.clear_activity()
    a44.share_take(str(folder44), n44, "mix")
    real_copy, real_record = a44._copy_to_cloud, a44._record_cloud_error
    a44._copy_to_cloud = lambda *a, **k: {"ok": False, "error": "The cloud folder is gone"}
    a44._record_cloud_error = locked
    try:
        a44._cloud_queue.run_next()
    except Exception:
        pass
    finally:
        a44._copy_to_cloud, a44._record_cloud_error = real_copy, real_record
    ok("a failed copy still says so when its failure cannot be written down",
       [e["state"] for e in a44.activity()["entries"]] == ["failed"])

    # Stop: the name of the take is looked up in the library; a lookup that
    # fails must not keep the take recording.
    a44.start_take()
    a44._recorder._callback(np.full((4800, 1), 900, dtype=np.int16), 4800, None, None)
    real_suggest = a44.suggest_take_name
    a44.suggest_take_name = locked
    try:
        stopped44 = a44.stop_take()
    except Exception as e:
        stopped44 = {"ok": False, "error": str(e)}
    finally:
        a44.suggest_take_name = real_suggest
    ok("a stop whose name cannot be looked up still stops and keeps the take",
       stopped44.get("ok") is True and a44._recorder is None
       and (Path(stopped44["temp_dir"]) / "Gtr.wav").exists()
       and stopped44["suggested_name"] == f"Take {stopped44['take_number']}"
       and stopped44["default_name"] == f"Take {stopped44['take_number']}")

    print("\n[45] Removing a copy that is on its way, and saying what a copy is")
    root45 = Path(tempfile.mkdtemp())
    _, a45 = fresh_api(root45)
    a45.set_cloud_dir(str(root45 / "Cloud"))
    a45.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    a45.start_take()
    a45._recorder._callback(np.full((4800, 1), 900, dtype=np.int16), 4800, None, None)
    s45 = a45.stop_take()
    a45.keep_take(s45["take_number"], s45["temp_dir"], "Polyn",
                  s45["duration_sec"], s45["tracks"])
    folder45, n45 = a45._session["folder"], s45["take_number"]
    while a45._cloud_queue.run_next():
        pass

    # Queued: removing now would be undone the moment the copy runs.
    a45.share_take(str(folder45), n45, "mix")
    waiting_remove = a45.unshare_take(str(folder45), n45)
    ok("a copy still waiting cannot be removed yet, and says why",
       waiting_remove["ok"] is False
       and "copy" in waiting_remove["error"].lower())
    # Running: the same, asked in the middle of the copy.
    during = []
    real_copy45 = a45._copy_to_cloud

    def remove_mid_copy(*args, **kwargs):
        during.append(a45.unshare_take(str(folder45), n45))
        return real_copy45(*args, **kwargs)

    a45._copy_to_cloud = remove_mid_copy
    a45._cloud_queue.run_next()
    a45._copy_to_cloud = real_copy45
    ok("nor one being copied",
       during and during[0]["ok"] is False)
    ok("and once it is done it can be",
       a45.unshare_take(str(folder45), n45)["ok"] is True
       and not a45._lib.take(folder45, n45).get("cloud"))

    # A copy of the tracks that could not be compressed is WAV, and is
    # described as WAV — not as the format it was asked for.
    from rehearsal_recorder.audio import encode as encmod

    a45.set_cloud_format("mp3")
    real_sf = encmod._soundfile
    encmod._soundfile = lambda: None
    try:
        plain = a45._copy_to_cloud(str(folder45), n45, "tracks")
    finally:
        encmod._soundfile = real_sf
    ok("tracks that stayed WAV are recorded as WAV",
       plain["ok"] and plain["cloud"]["tracks_format"] == "wav")
    import rehearsal_recorder.api as apimod45
    said45 = apimod45._copy_detail("tracks", plain)
    ok("and said to be WAV", said45.startswith("WAV of every track"))
    ok("a mix and tracks that came out differently say so",
       apimod45._copy_detail("both", {"cloud": {"mix_format": "mp3",
                                                "tracks_format": "wav"}})
       == "MP3 of the mix, WAV of every track")
    ok("and the same format is said once",
       apimod45._copy_detail("both", {"cloud": {"mix_format": "mp3",
                                                "tracks_format": "mp3"}})
       == "MP3 of the mix and every track")

    print("\n[46] Under the hood: what the app runs on, and where it keeps things")
    # The page a person opens when something is wrong, and the text they
    # paste into a message about it. Everything on it is asked of the machine
    # as it is now, not remembered.
    import rehearsal_recorder
    from rehearsal_recorder import diagnostics as diag

    tmp46 = Path(tempfile.mkdtemp())
    apimod46, h46 = fresh_api(tmp46)
    apimod46.CRASH_LOG = tmp46 / "crash.log"
    real_pa = getattr(_sd, "get_portaudio_version", None)
    _sd.get_portaudio_version = lambda: (1246976, "PortAudio V19.7.0-devel, revision unknown")
    h46._remember_device("device", 0)
    h46._config["samplerate"] = 48000
    h46._config["bit_depth"] = 24
    h46._config["tracks"] = [{"name": "Gtr"}, {"name": "Keys", "stereo": True}]
    info = h46.under_the_hood()
    ok("it says which version is running, and whether it is the built app",
       info["version"] == rehearsal_recorder.__version__
       and info["running_as"] in ("built", "source"))
    ok("the audio engine, without PortAudio's 'revision unknown'",
       info["audio"]["engine"] == "PortAudio V19.7.0-devel")
    ok("every audio system on the machine, with how many devices it has",
       info["audio"]["systems"] == [{"name": "CoreAudio", "devices": 4}])
    ok("what it records with",
       info["audio"]["recording"] == {"name": "Interface", "host_api": "CoreAudio",
                                      "inputs": 8, "samplerate": 48000,
                                      "bit_depth": 24})
    ok("and where it plays back", info["audio"]["playback"] == "System output")
    files46 = {f["key"]: f for f in info["files"]}
    ok("where its own files are: the settings, the history, the crash log",
       set(files46) == {"settings", "history", "crash_log"}
       and files46["settings"]["path"] == str(apimod46.CONFIG_PATH)
       and files46["history"]["path"] == str(tmp46 / "Rec" / "library.sqlite"))
    ok("a crash log never written is said not to be there",
       files46["crash_log"]["exists"] is False and files46["crash_log"]["modified"] is None)
    (tmp46 / "crash.log").write_text("boom\n", encoding="utf-8")
    written = {f["key"]: f for f in h46.under_the_hood()["files"]}["crash_log"]
    ok("and one that was, with when", written["exists"] and written["modified"])

    fake_win = types.SimpleNamespace(
        system=lambda: "Windows", win32_ver=lambda: ("11", "10.0.26200", "SP0", ""),
        win32_edition=lambda: "Professional", machine=lambda: "AMD64")
    ok("Windows is named the way its own About box names it",
       diag.system_line(fake_win) == "Windows 11 Pro 10.0.26200, x64")
    fake_mac = types.SimpleNamespace(
        system=lambda: "Darwin", mac_ver=lambda: ("15.1", ("", "", ""), "arm64"),
        machine=lambda: "arm64")
    ok("and so is a Mac", diag.system_line(fake_mac) == "macOS 15.1, arm64")

    shown46 = []
    real_reveal = apimod46.reveal_in_file_manager
    apimod46.reveal_in_file_manager = lambda p: shown46.append(str(p)) or {"ok": True}
    try:
        h46._write_config()
        h46.show_file("settings")
        ok("Show opens the file's folder, with the file picked out",
           shown46 == [str(apimod46.CONFIG_PATH)])
        h46.show_file("crash_log")
        ok("and for a file not written yet, the folder it will be in",
           shown46[-1] == str(tmp46) if not (tmp46 / "crash.log").exists()
           else shown46[-1] == str(tmp46 / "crash.log"))
        shown46[:] = shown46[:1]
        refused46 = h46.show_file(str(tmp46))
        ok("and only the app's own files can be shown that way",
           refused46["ok"] is False and len(shown46) == 1)
    finally:
        apimod46.reveal_in_file_manager = real_reveal

    report46 = h46.bug_report()["text"]
    ok("the report for a bug starts with the version and the system",
       report46.splitlines()[0].startswith(f"РЭХА {rehearsal_recorder.__version__}")
       and diag.system_line() in report46)
    ok("and says what it records with, and the band on its inputs",
       "Recording with: Interface — CoreAudio, 8 inputs, 48000 Hz, 24 bit" in report46
       and "Tracks: Gtr on input 1, Keys on inputs 2–3 (stereo)" in report46)
    ok("the audio systems it could see",
       "Audio systems: CoreAudio (4)" in report46)
    ok("and where its files are",
       str(apimod46.CONFIG_PATH) in report46 and "library.sqlite" in report46)

    print("\n[47] Checking the interface from the window")
    # --audio-probe for someone at a rehearsal with no command line: the same
    # attempts, run in the background, with what it has found readable while
    # it goes, and a verdict at the end.
    from rehearsal_recorder.audio import heartbeat as hb47

    real_streams = (_sd.InputStream, getattr(_sd, "Stream", None))
    real_listen = (probemod.LISTEN_FIRST_SEC, probemod.LISTEN_SEC, hb47.FIRST_BLOCK_SEC)
    probemod.LISTEN_FIRST_SEC = probemod.LISTEN_SEC = 0.25
    hb47.FIRST_BLOCK_SEC = 0.6

    def check_with(cls):
        _sd.InputStream = _sd.Stream = cls
        started = h46.start_interface_check()
        h46._check.wait(20)
        return started, h46.interface_check()

    class _Monitor:
        stopped = False

        def stop(self):
            _Monitor.stopped = True

    try:
        h46._monitor = _Monitor()
        _sd.InputStream = _sd.Stream = _Sends
        started = h46.start_interface_check()
        ok("the check starts", started.get("ok") is True)
        ok("and says it is listening while it does",
           h46.interface_check().get("running") is True)
        ok("a second one is not started over it",
           h46.start_interface_check().get("ok") is False)
        ok("the signal check lets go of the card for it",
           _Monitor.stopped and h46._monitor is None)
        h46._check.wait(20)
        done = h46.interface_check()
        ok("a card that sends is found to work with the settings in force",
           done.get("running") is False
           and (done.get("verdict") or {}).get("cause") == "none"
           and [r["label"] for r in done.get("rows", [])] == [probemod.AS_CONFIGURED])
        ok("with which inputs had signal",
           (done.get("peaks") or [0])[0] > 0.2
           and all(p == 0 for p in (done.get("peaks") or [1, 1])[1:])
           and done.get("signal") == "signal on input 1; the rest silent")
        ok("and what it asked, to say back",
           done.get("device") == {"name": "Interface", "host_api": "CoreAudio",
                                  "channels": 3, "samplerate": 48000, "bit_depth": 24}
           and bool(done.get("checked_at")))

        class _Hushed(_Card):
            loud = False

        started, hushed = check_with(_Hushed)
        ok("a card that sends only silence opens, and says every input was silent",
           (hushed.get("verdict") or {}).get("cause") == "none"
           and "every input is silent" in (hushed.get("signal") or ""))
        ok("and the report does not call that working",
           "opens and sends, but every input was silent" in h46.bug_report()["text"])

        started, bad = check_with(_Stalls)
        ok("a card that opens and never sends is found out, every other way tried",
           (bad.get("verdict") or {}).get("cause") == "no_sound"
           and len(bad.get("rows", [])) > 1 and bad.get("peaks") is None)
        ok("the report for a bug carries the last check",
           "Last check of the interface" in h46.bug_report()["text"])

        _sd.InputStream = _sd.Stream = _Stalls
        h46.start_interface_check()
        h46.stop_interface_check()
        h46._check.wait(20)
        halted = h46.interface_check()
        ok("Stop ends it after the attempt under way, and says it was stopped",
           halted.get("stopped") is True and halted.get("verdict") is None
           and len(halted.get("rows", [])) <= 1)

        h46._recorder = object()
        try:
            ok("it is not run while a take records",
               h46.start_interface_check().get("ok") is False)
        finally:
            h46._recorder = None

        h46._config.pop("device_index", None)
        h46._config.pop("device", None)
        nothing = h46.start_interface_check()
        ok("with no interface chosen it says to choose one",
           nothing.get("ok") is False and "Settings" in (nothing.get("error") or ""))
    finally:
        _sd.InputStream = real_streams[0]
        if real_streams[1] is not None:
            _sd.Stream = real_streams[1]
        probemod.LISTEN_FIRST_SEC, probemod.LISTEN_SEC, hb47.FIRST_BLOCK_SEC = real_listen
        if real_pa is None:
            del _sd.get_portaudio_version
        else:
            _sd.get_portaudio_version = real_pa

    print("\n[48] An input arrives as it is played, not a second later")
    # Opened without a latency, PortAudio takes the driver's "high" one, and
    # FlexASIO's is a second: the meters ran a second behind the voice, and
    # the sound came in one burst a second, so a tile lit up and went dark
    # rather than following it.
    from rehearsal_recorder.audio.monitor import LevelMonitor

    real_interface = _DEVICES[0]
    _DEVICES[0] = {**real_interface, "default_low_input_latency": 0.02,
                   "default_high_input_latency": 1.0}
    try:
        def latency_of(opened):
            opened.start()
            try:
                return (opened._stream.kw or {}).get("latency")
            finally:
                opened.stop()

        one = [{"name": "Gtr", "channel": 1}]
        asked = latency_of(AudioRecorder(0, SR, one, Path(tempfile.mkdtemp()) / "t"))
        ok("a take asks the card for a short latency, not its second-long one",
           isinstance(asked, float) and 0 < asked <= 0.1)
        asked = latency_of(LevelMonitor(0, SR, one))
        ok("and so does the signal check",
           isinstance(asked, float) and 0 < asked <= 0.1)
        _DEVICES[0] = {**_DEVICES[0], "default_low_input_latency": 0.09}
        asked = latency_of(AudioRecorder(0, SR, one, Path(tempfile.mkdtemp()) / "t"))
        ok("but never less than what the driver itself calls low", asked == 0.09)
    finally:
        _DEVICES[0] = real_interface

    print("\n[48b] A take sounds when Play is pressed, not seconds later")
    # The same as the inputs, the other way. Opened without a latency,
    # PortAudio takes the driver's "high" one, and on FlexASIO the player's
    # stream held 2.75 s: what was played was heard 3.3 s later, so Play
    # sounded three seconds late, Pause stopped three seconds after it was
    # pressed, and the playhead and the meters ran three seconds ahead of
    # the sound.
    real_interface = _DEVICES[0]
    _DEVICES[0] = {**real_interface, "default_low_output_latency": 0.02,
                   "default_high_output_latency": 1.0}
    try:
        tone = Path(tempfile.mkdtemp()) / "tone.wav"
        write_wav(tone, 500, seconds=1.0)
        heard = TakePlayer([{"name": "Gtr", "file": str(tone)}])
        heard.open_output(0)
        asked = heard._stream.kw.get("latency")
        ok("the player asks the card for a short latency, not its second-long one",
           isinstance(asked, float) and 0 < asked <= 0.1)
        heard.open_output(None)
        asked = heard._stream.kw.get("latency")
        ok("and so it does of the system's output",
           isinstance(asked, float) and 0 < asked <= 0.1)
        _DEVICES[0] = {**_DEVICES[0], "default_low_output_latency": 0.09}
        heard.open_output(0)
        ok("but never less than what the driver itself calls low",
           heard._stream.kw.get("latency") == 0.09)
        heard.close()
    finally:
        _DEVICES[0] = real_interface

    print("\n[49] Saying that a newer version is out")
    from rehearsal_recorder import updates as U
    from rehearsal_recorder.mediaserver import POLLABLE

    ok("a release is newer than the one before it", U.newer("0.8.0", "0.8.1"))
    ok("and than one with a lower minor", U.newer("0.7.13", "0.8.0"))
    ok("but not newer than itself", not U.newer("0.8.0", "0.8.0"))
    ok("nor than one we are already past", not U.newer("0.8.2", "0.8.1"))
    ok("the numbers are compared as numbers, not as text",
       U.newer("0.8.9", "0.8.10") and not U.newer("0.8.10", "0.8.9"))
    ok("a tag with a v in front reads the same", U.newer("0.8.0", "v0.8.1"))
    # setuptools-scm names a build between releases after the release to
    # come: 0.8.1.dev32+g7663602 is on its way to 0.8.1, past 0.8.0.
    ok("a development build after a release is not out of date",
       not U.newer("0.8.1.dev32+g7663602", "0.8.0"))
    ok("nor is one of the version that has just come out",
       not U.newer("0.8.1.dev3+gabc1234", "0.8.1"))
    ok("and a version that cannot be read is never told it is out of date",
       not U.newer("unknown", "0.8.1") and not U.newer("0.8.0", "nightly"))

    import io as _io

    class _Answer(_io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.close()

    asked = {}

    def github(body):
        def opener(request, timeout, context):
            asked.update(url=request.full_url, timeout=timeout,
                         agent=request.get_header("User-agent"),
                         headers=dict(request.header_items()))
            return _Answer(json.dumps(body).encode())
        return opener

    ok("GitHub is asked for its latest release",
       U.fetch_latest(github({"tag_name": "0.8.1", "prerelease": False}))["version"]
       == "0.8.1"
       and asked["url"].endswith("/repos/voronizer/rehearsal-recorder/releases/latest"))
    ok("and told nothing but the app's name",
       asked["agent"] == "rehearsal-recorder"
       and set(asked["headers"]) <= {"User-agent", "Accept"})
    ok("without waiting long for an answer", 0 < asked["timeout"] <= 10)
    ok("a pre-release is never offered to someone on a stable version",
       U.fetch_latest(github({"tag_name": "0.9.0rc1", "prerelease": True})) is None)
    ok("nor is an answer with no version in it",
       U.fetch_latest(github({"message": "Not Found"})) is None)

    answers = []

    def fetch():
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    now = {"on": True, "busy": False}
    chk = U.UpdateChecker("0.8.0", enabled=lambda: now["on"],
                          busy=lambda: now["busy"], fetch=fetch)
    ok("before any check there is nothing to say",
       chk.status() == {"on": True, "latest": None, "download": None, "checked": False})
    answers.append({"version": "0.8.1"})
    ok("a check that finds a newer release says which",
       chk.check_now() is True and chk.status()["latest"] == {"version": "0.8.1"})
    ok("and that it has been checked", chk.status()["checked"] is True)
    answers.append({"version": "0.8.0"})
    chk.check_now()
    ok("and one that finds this same version says nothing",
       chk.status()["latest"] is None)
    answers.append({"version": "0.8.1"})
    chk.check_now()
    answers.append(OSError("no route to host"))
    ok("a check with no network in the room is not an error",
       chk.check_now() is True)
    ok("and forgets nothing it found before", chk.status()["latest"] == {"version": "0.8.1"})
    unanswered = U.UpdateChecker("0.8.0", enabled=lambda: True, busy=lambda: False,
                                 fetch=lambda: (_ for _ in ()).throw(OSError("offline")))
    unanswered.check_now()
    ok("a check that got no answer is not said to have checked: nobody knows "
       "yet whether this is the latest", unanswered.status()["checked"] is False)

    now["busy"] = True
    answers.append({"version": "0.8.2"})
    ok("nothing is asked while a take records, and the check waits",
       chk.check_now() is False and len(answers) == 1)
    now["busy"] = False
    chk.check_now()
    ok("until it has stopped", chk.status()["latest"] == {"version": "0.8.2"})

    now["on"] = False
    answers.append({"version": "9.9.9"})
    ok("switched off, nothing is asked", chk.check_now() is False and len(answers) == 1)
    ok("and nothing is said, even what was found before",
       chk.status() == {"on": False, "latest": None, "download": None, "checked": False})
    answers.clear()

    apimod49, a49 = fresh_api(Path(tempfile.mkdtemp()))
    ok("checking is on until somebody switches it off",
       a49.get_settings()["check_updates"] is True and a49.update_status()["on"] is True)
    a49.set_check_updates(False)
    ok("switched off, it says so, and the config keeps it",
       a49.get_settings()["check_updates"] is False
       and a49.update_status()["on"] is False
       and json.loads(apimod49.CONFIG_PATH.read_text(encoding="utf-8"))["check_updates"]
       is False)
    a49.set_check_updates(True)
    # This suite runs from source, like anyone developing the app: its version
    # is a development build's and would read as out of date at every start.
    ok("run from source, the app never asks", a49.start_update_checks() is False)
    a49._updates._fetch = lambda: {"version": "99.0"}
    a49._recorder = object()
    try:
        ok("and the app's own check waits while a take records",
           a49._updates.check_now() is False)
    finally:
        a49._recorder = None
    ok("the interface asks for it over the local server, as it does the meters",
       "update_status" in POLLABLE)

    print("\n[50] Fetching a newer version and handing it over")
    import hashlib
    import zipfile

    # A real zip, small: what is checked is that it opens and every file in
    # it is whole, as well as its size and its digest.
    made = _io.BytesIO()
    with zipfile.ZipFile(made, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("Reha/Reha.exe", b"MZ" + b"x" * 5000)
        z.writestr("Reha/_internal/python312.dll", b"y" * 9000)
    archive = made.getvalue()
    digest = hashlib.sha256(archive).hexdigest()

    release = {
        "tag_name": "0.9.0", "prerelease": False,
        "assets": [
            {"name": "RehearsalRecorder-macos.zip", "size": 1, "digest": "sha256:" + "0" * 64},
            {"name": "RehearsalRecorder-windows.zip", "size": len(archive),
             "digest": "sha256:" + digest,
             "browser_download_url": "https://elsewhere.example/evil.zip"},
        ],
    }
    found = U.fetch_latest(github(release), system="win32")
    ok("the answer brings this system's archive, its size and its digest",
       found["asset"] == {"name": "RehearsalRecorder-windows.zip", "size": len(archive),
                          "sha256": digest})
    ok("and the other system's is not taken for it",
       U.fetch_latest(github(release), system="darwin")["asset"]["size"] == 1)
    ok("a system with no build of its own gets no archive",
       U.fetch_latest(github(release), system="linux")["asset"] is None)
    ok("it is fetched from the release's own address, never one in the answer",
       U.download_url(found) == "https://github.com/voronizer/rehearsal-recorder/"
       "releases/download/0.9.0/RehearsalRecorder-windows.zip")

    served = []

    def serving(body):
        def opener(request, timeout, context):
            served.append(request.full_url)
            return _Answer(body)
        return opener

    shown = []
    folder = Path(tempfile.mkdtemp())
    dl_now = {"busy": False}

    def checker(body):
        c = U.UpdateChecker("0.8.0", enabled=lambda: True,
                            busy=lambda: dl_now["busy"], fetch=lambda: found,
                            opener=serving(body), downloads=lambda: folder,
                            reveal=shown.append)
        c.check_now()
        return c

    whole = checker(archive)
    ok("before anybody asks, nothing is downloaded",
       whole.status()["download"] is None and not served)
    whole.download_now()
    saved = folder / "RehearsalRecorder-0.9.0-windows.zip"
    ok("asked, it is fetched into Downloads under its version's name",
       saved.is_file() and saved.read_bytes() == archive)
    ok("from the release's own address", served[-1] == U.download_url(found))
    ok("said to be done, with the file's name",
       whole.status()["download"] == {"state": "done", "version": "0.9.0",
                                      "fraction": 1.0, "file": saved.name})
    ok("and the folder is opened with it picked out", shown == [saved])
    ok("nothing half-written is left beside it",
       sorted(p.name for p in folder.iterdir()) == [saved.name])
    whole.show_download()
    ok("Show in folder opens it again", shown == [saved, saved])

    asked_before = len(served)
    checker(archive).download_now()
    ok("one already there and whole is not fetched again", len(served) == asked_before)

    for name, body, said in [
        ("cut short", archive[:-500], "cut short"),
        ("not what the release has", archive[:-4] + b"oops", "does not match"),
    ]:
        saved.unlink(missing_ok=True)
        broken = checker(body)
        broken.download_now()
        state = broken.status()["download"]
        ok(f"one {name} is said to have failed, and why",
           state["state"] == "failed" and said in state["error"])
        ok("and nothing of it is left in Downloads", list(folder.iterdir()) == [])

    def no_network(request, timeout, context):
        raise OSError("no route to host")

    offline = U.UpdateChecker("0.8.0", enabled=lambda: True, busy=lambda: False,
                              fetch=lambda: found, opener=no_network,
                              downloads=lambda: folder, reveal=shown.append)
    offline.check_now()
    offline.download_now()
    ok("with no network it fails, saying so, rather than hanging on",
       offline.status()["download"]["state"] == "failed"
       and "no route to host" in offline.status()["download"]["error"])

    dl_now["busy"] = True
    refused = checker(archive)
    ok("it cannot be started while a take records",
       refused.start_download()["ok"] is False and refused.status()["download"] is None)
    dl_now["busy"] = False
    nothing = U.UpdateChecker("0.8.0", enabled=lambda: True, busy=lambda: False,
                              fetch=lambda: None)
    ok("nor when there is nothing newer to fetch", nothing.start_download()["ok"] is False)

    print("\n[51] After Stop, the name the take would have had without one picked")
    _, a51 = fresh_api(Path(tempfile.mkdtemp()))
    a51.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1}], 16)

    def record51():
        a51.start_take()
        a51._recorder._callback(np.full((SR, 1), 900, dtype=np.int16), SR, None, None)
        return a51.stop_take()

    first51 = record51()
    ok("a first take with no name picked would be Take 1 either way",
       first51["suggested_name"] == "Take 1" and first51["default_name"] == "Take 1")
    a51.keep_take(first51["take_number"], first51["temp_dir"], "Polyn",
                  first51["duration_sec"], first51["tracks"])
    a51.set_next_take_name("Vesna")
    second51 = record51()
    ok("a name picked before recording is offered, and the one it would have had beside it",
       second51["suggested_name"] == "Vesna" and second51["default_name"] == "Polyn")

    def no_lookup():
        raise RuntimeError("database is locked")

    a51.set_next_take_name("Ogon")
    real_session_takes51 = a51._session_takes
    a51._session_takes = no_lookup
    try:
        third51 = record51()
    finally:
        a51._session_takes = real_session_takes51
    ok("a name picked before recording survives a library that cannot say "
       "what the take would have been called",
       third51["suggested_name"] == "Ogon"
       and third51["default_name"] == f"Take {third51['take_number']}")

    print("\n[52] A take is a go at a song, numbered across the library")
    _, s52 = fresh_api(Path(tempfile.mkdtemp()))

    def keep52(number, name):
        here = Path(s52._session["folder"])
        draft = here / "_drafts" / f"take {number}"
        write_wav(draft / "Gtr.wav", 100, seconds=0.5)
        s52._session["take_counter"] = number
        return s52.keep_take(number, str(draft), name, 0.5,
                             [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])["take"]

    def folder_of(take):
        return Path(take["tracks"][0]["file"]).parent.name

    s52.start_rehearsal("Monday", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    first52 = keep52(1, "Polyn")
    ok("a take is a go at its song: its name is the title and the go, folder and all",
       (first52["name"], first52["song"], first52["go"]) == ("Polyn 1", "Polyn", 1)
       and folder_of(first52) == "01 - Polyn 1")
    ok("the field is offered the title alone, with the go beside it",
       s52.session_state()["next_take_name"] == "Polyn"
       and s52.session_state()["next_take_go"] == 2)
    keep52(2, s52.suggest_take_name())
    s52.finish_rehearsal()

    s52.start_rehearsal("Tuesday", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    f52 = Path(s52._session["folder"])
    named52 = s52.set_next_take_name("polyn")
    ok("goes run on across rehearsals: yesterday's 2 is followed by 3",
       named52 == {"ok": True, "next_take_name": "Polyn", "next_take_go": 3})
    typed52 = keep52(1, "Polyn 7")
    ok("a number typed after the title names the song; the go is the app's",
       typed52["name"] == "Polyn 3" and folder_of(typed52) == "01 - Polyn 3")
    unnamed52 = keep52(2, "Take 9")
    ok("a take nobody named is called by its own number",
       (unnamed52["name"], unnamed52["song"]) == ("Take 2", None)
       and folder_of(unnamed52) == "02 - Take 2")
    titled52 = keep52(3, "Song 2")
    ok("a title ending in a number is a song of its own when no shorter one exists",
       (titled52["name"], titled52["song"], titled52["go"]) == ("Song 2 1", "Song 2", 1))
    state52 = s52.session_state()
    ok("after a take, the next is another go at its song",
       state52["next_take_name"] == "Song 2" and state52["next_take_go"] == 2)
    ok("songs, runs and how long the last go ran come from the songs",
       [(s["name"], s["take_numbers"]) for s in state52["songs"]]
       == [("Polyn", [1]), ("Song 2", [3])]
       and [(r["song"], len(r["takes"])) for r in next(
           r for r in s52.list_rehearsals() if r["name"] == "Tuesday")["runs"]]
       == [("Polyn", 1), (None, 1), ("Song 2", 1)]
       and state52["last_attempt"] == {"song": "Song 2", "duration_sec": 0.5})
    ok("every song offered says which go it would be",
       [(c["song"], c["go"]) for c in s52.song_choices()["here"]]
       == [("Polyn", 4), ("Song 2", 2)])
    ok("the take being renamed keeps its own go at its own song",
       [(c["song"], c["go"]) for c in s52.song_choices(str(f52), 1)["here"]][0] == ("Polyn", 3))

    same52 = s52.rename_take(str(f52), 1, "Polyn")
    ok("renamed to its own song, a take keeps its go and its folder",
       same52["ok"] and same52["take"]["name"] == "Polyn 3"
       and folder_of(same52["take"]) == "01 - Polyn 3"
       and not any(p.name.startswith("01 - Polyn 3 (") for p in f52.iterdir()))
    moved52 = s52.rename_take(str(f52), 2, "polyn")
    ok("renamed to a song, a take is its next go, folder and all",
       moved52["take"]["name"] == "Polyn 4" and folder_of(moved52["take"]) == "02 - Polyn 4"
       and Path(moved52["take"]["tracks"][0]["file"]).exists())
    ok("a blank name is still refused",
       s52.rename_take(str(f52), 2, "  ") == {"ok": False, "error": "Name cannot be empty"})

    rescued52 = f52 / "_drafts" / "take 9"
    rescued52.mkdir(parents=True)
    (rescued52 / "Gtr.raw").write_bytes(struct.pack("<h", 1234) * SR)
    got52 = s52.recover_draft(str(rescued52))
    ok("a draft rescued with no name is a take nobody named",
       got52["ok"] and got52["take"]["name"] == "Take 4"
       and folder_of(got52["take"]) == "04 - Take 4")

    print("\n[53] Putting names right")
    import shutil
    from sqlalchemy import text as sql_text
    from rehearsal_recorder.activity import Journal
    from rehearsal_recorder.names_pass import NamesPass
    from rehearsal_recorder.store import db as dbmod

    # The loop: waits while files are busy, renames take by take, one entry.
    journal53 = Journal()
    fixed53 = []
    waits53 = iter([True, True, False, False])

    def fix53(folder, number):
        fixed53.append(number)
        if number == 1:
            return {"renamed": True, "error": None}
        return {"renamed": False, "error": "it is open elsewhere"}

    loop53 = NamesPass(find=lambda: [("/r", 1, "Polyn 1"), ("/r", 2, "Vesna 1")], fix=fix53,
                       busy=lambda: next(waits53, False), journal=journal53, wait=0.001)
    ok("it waits while files are in use, then renames take by take",
       loop53.run() == 1 and fixed53 == [1, 2])
    entry53 = journal53.snapshot()[0]
    ok("one entry for the whole pass, saying which take was left and why",
       entry53["kind"] == "names" and entry53["title"] == "Putting names right"
       and entry53["state"] == "failed"
       and "“Vesna 1”: it is open elsewhere" in entry53["error"])
    boom_journal53 = Journal()
    boomed53 = []

    def boom53(folder, number):
        boomed53.append(number)
        if number == 1:
            raise RuntimeError("the database is locked")
        return {"renamed": True, "error": None}

    boom_loop53 = NamesPass(find=lambda: [("/r", 1, "Polyn 1"), ("/r", 2, "Vesna 1")],
                            fix=boom53, busy=lambda: False, journal=boom_journal53)
    boom_count53 = boom_loop53.run()
    boom_entry53 = boom_journal53.snapshot()[0]
    ok("a take that raises is that take's failure: the pass carries on and ends failed",
       boom_count53 == 1 and boomed53 == [1, 2] and boom_entry53["state"] == "failed"
       and "“Polyn 1”: the database is locked" in boom_entry53["error"])
    quiet53 = Journal()
    ok("with nothing to put right it shows nothing",
       NamesPass(find=lambda: [], fix=fix53, busy=lambda: False, journal=quiet53).run() == 0
       and quiet53.snapshot() == [])
    stopped53 = Journal()
    halted53 = NamesPass(find=lambda: [("/r", 3, "Ogon 1")], fix=fix53, busy=lambda: True,
                         journal=stopped53, wait=0.001)
    halted53.stop()
    ok("stopped while it waits, it renames nothing and leaves nothing behind",
       halted53.run() == 0 and 3 not in fixed53 and stopped53.snapshot() == [])

    # The real thing: a library from before songs, opened by this version.
    tmp53 = Path(tempfile.mkdtemp())
    rec53, cloud53 = tmp53 / "Rec", tmp53 / "Drive"
    jam53 = rec53 / "Jam - 2026-01-10 19-00"
    later53 = rec53 / "Later - 2026-01-17 19-00"
    upto53 = tmp53 / "migrations"
    shutil.copytree(dbmod.MIGRATIONS, upto53, ignore=shutil.ignore_patterns("__pycache__"))
    for f in (upto53 / "versions").glob("*.py"):
        if f.name[:4] > "0001":
            f.unlink()
    rec53.mkdir(parents=True)
    dbmod.open_engine(rec53, upto53).dispose()
    engine53 = dbmod.make_engine(dbmod.database_path(rec53))
    with engine53.begin() as c:
        for folder53, created53, names53 in (
                (jam53, "2026-01-10T19:00:00", ["Polyn", "polyn 2", "Recovered take 3", "polyn 4"]),
                (later53, "2026-01-17T19:00:00", ["Polyn"])):
            rid = c.execute(sql_text(
                "INSERT INTO rehearsal (folder, name, created_at, samplerate, bit_depth) "
                "VALUES (:f, :f, :c, 48000, 16)"), {"f": folder53.name, "c": created53}).lastrowid
            for n, old in enumerate(names53, start=1):
                take_dir = folder53 / f"{n:02d} - {old}"
                write_wav(take_dir / "Gtr.wav", 100, seconds=0.5)
                tid = c.execute(sql_text(
                    "INSERT INTO take (rehearsal_id, take_number, name, duration_sec, "
                    "cloud_skip, cloud_send) VALUES (:r, :n, :name, 0.5, 0, 0)"),
                    {"r": rid, "n": n, "name": old}).lastrowid
                c.execute(sql_text("INSERT INTO take_file (take_id, position, name, file) "
                                   "VALUES (:t, 0, 'Gtr', :f)"),
                          {"t": tid, "f": f"{take_dir.name}/Gtr.wav"})
                if folder53 == jam53 and n == 2:
                    mix = cloud53 / jam53.name / f"{n:02d} - {old}.wav"
                    mix.parent.mkdir(parents=True)
                    mix.write_bytes(b"RIFF")
                    c.execute(sql_text("INSERT INTO cloud_copy (take_id, mix, mix_format, source) "
                                       "VALUES (:t, :m, 'wav', '{}')"),
                              {"t": tid, "m": f"{jam53.name}/{mix.name}"})
    engine53.dispose()
    (tmp53 / "config.json").write_text(json.dumps(
        {"recordings_dir": str(rec53), "cloud_dir": str(cloud53)}), encoding="utf-8")
    _, p53 = fresh_api(tmp53)

    def dirs53(folder=jam53):
        return sorted(p.name for p in folder.iterdir() if p.is_dir())

    real_move53 = p53._move_take_dir

    def refuse_take_4(folder, number, take, name):
        if number == 4:
            return None, None, "the folder is open in another program"
        return real_move53(folder, number, take, name)

    p53._move_take_dir = refuse_take_4
    try:
        renamed53 = p53._names_pass.run()
    finally:
        p53._move_take_dir = real_move53
    takes53 = {t["take_number"]: t for t in p53.get_rehearsal(str(jam53))["takes"]}
    ok("old names are put right on disk: the first go gains its number, a case-only "
       "rename is made, and a recovered take is Take N",
       renamed53 == 4
       and dirs53() == ["01 - Polyn 1", "02 - Polyn 2", "03 - Take 3", "04 - polyn 4"]
       and Path(takes53[2]["tracks"][0]["file"]).exists())
    ok("goes are numbered across the library on disk too",
       dirs53(later53) == ["01 - Polyn 4"])
    ok("and in the cloud folder",
       Path(takes53[2]["cloud"]["mix"]).name == "02 - Polyn 2.wav"
       and sorted(p.name for p in (cloud53 / jam53.name).iterdir()) == ["02 - Polyn 2.wav"])
    names_entry53 = next(e for e in p53.activity()["entries"] if e["kind"] == "names")
    ok("a take that could not be renamed is left, and the background work says which and why",
       names_entry53["state"] == "failed" and "“Polyn 3”" in names_entry53["error"]
       and "open in another program" in names_entry53["error"])
    ok("the next pass picks it up",
       p53._names_pass.run() == 1 and "04 - Polyn 3" in dirs53())
    entries53 = len(p53.activity()["entries"])
    ok("once every name matches, a pass renames nothing and says nothing",
       p53._names_pass.run() == 0 and len(p53.activity()["entries"]) == entries53)

    takes53 = {t["take_number"]: t for t in p53.get_rehearsal(str(jam53))["takes"]}
    taken53 = jam53 / "03 - Take 3 (2)"
    Path(takes53[3]["tracks"][0]["file"]).parent.rename(taken53)
    p53._lib.update_take(jam53, 3, tracks=[{"name": "Gtr", "file": str(taken53 / "Gtr.wav")}])
    ok("a folder that took “(2)” because the name was taken counts as carrying it",
       all(n != 3 for _, n, _ in p53._names_out_of_line()))

    lower53 = jam53 / "01 - polyn 1"
    Path(takes53[1]["tracks"][0]["file"]).parent.rename(lower53)
    p53._lib.update_take(jam53, 1, tracks=[{"name": "Gtr", "file": str(lower53 / "Gtr.wav")}])
    p53.player_open([{"name": "Gtr", "file": str(lower53 / "Gtr.wav")}])
    ok("a take open in the player is left for next time, not closed under the listener",
       p53._names_pass.run() == 0 and "01 - polyn 1" in dirs53()
       and p53._open_tracks is not None)
    p53.player_close()
    ok("and is renamed once the player lets go",
       p53._names_pass.run() == 1 and "01 - Polyn 1" in dirs53())

    p53._recorder = object()
    ok("it waits while a take records", p53._names_must_wait())
    p53._recorder = None
    crop53 = p53._journal.begin("crop", "Cropping")
    ok("and while a take is being cropped", p53._names_must_wait())
    crop53.done()
    ok("and not otherwise", not p53._names_must_wait())

    # Copies in the cloud: renamed if they are there, never made again if not.
    cloud_rec53 = dict(p53.get_rehearsal(str(jam53))["takes"][1]["cloud"])
    stale53 = cloud53 / jam53.name / "02 - old.wav"
    Path(cloud_rec53["mix"]).rename(stale53)
    p53._lib.set_cloud_copy(jam53, 2, {**cloud_rec53, "mix": str(stale53)}, cloud53)
    away53 = tmp53 / "Drive-away"
    cloud53.rename(away53)
    cloud_entries53 = sum(e["kind"] == "cloud" for e in p53.activity()["entries"])
    ok("a cloud folder that is not there: nothing is queued, nothing reported renamed",
       p53._names_pass.run() == 0 and p53._cloud_queue.states(str(jam53)) == {}
       and sum(e["kind"] == "cloud" for e in p53.activity()["entries"]) == cloud_entries53)
    away53.rename(cloud53)
    stale53.unlink()
    ok("a copy the band deleted: nothing is queued, nothing reported renamed",
       p53._names_pass.run() == 0 and p53._cloud_queue.states(str(jam53)) == {}
       and sum(e["kind"] == "cloud" for e in p53.activity()["entries"]) == cloud_entries53)
    stale53.write_bytes(b"RIFF")
    ok("and once it is there, it is renamed, case or not",
       p53._names_pass.run() == 1 and (cloud53 / jam53.name / "02 - Polyn 2.wav").exists())

    print("\n[54] Stars: a star on a take, and the go a song's play button plays")
    tmp54 = Path(tempfile.mkdtemp())
    _, s54 = fresh_api(tmp54)

    def rehearsal54(name, created_at, names):
        """A rehearsal from an old session.json, its takes 100 s each."""
        folder = tmp54 / "Rec" / f"{name} - {created_at[:10]} {created_at[11:13]}-00"
        folder.mkdir(parents=True)
        (folder / "session.json").write_text(json.dumps({
            "name": name, "created_at": created_at, "samplerate": SR,
            "tracks": [{"name": "Gtr", "channel": 1}],
            "takes": [{"take_number": i + 1, "name": n, "duration_sec": 100,
                       "tracks": [], "markers": []} for i, n in enumerate(names)],
        }))
        import_all(s54._lib, s54._cloud_dir)
        return str(folder)

    # Polyn 1, Polyn 2, Doroga 1, Doroga 2.
    first54 = rehearsal54("First", "2026-08-25T19:00:00",
                          ["Polyn", "Polyn 2", "Doroga", "Doroga 2"])
    # Polyn 3, Vesna 1.
    mid54 = rehearsal54("Middle", "2026-09-10T19:00:00", ["Polyn", "Vesna"])
    # Polyn 4, Vesna 2, Polyn 5, Take 4.
    last54 = rehearsal54("Tuesday", "2026-09-22T19:00:00",
                         ["Polyn", "Vesna", "Polyn 2", "Take 4"])

    def plays54(name):
        """(folder, take_number) of what the song's ▶ plays in last_time."""
        lt = s54.last_time()
        for s in lt["last"]["songs"] + lt["not_played"]:
            if s["name"] == name:
                return (s["plays"]["folder"], s["plays"]["take"]["take_number"])
        return None

    ok("with no star, a song's play button plays its last go, as before",
       plays54("Polyn") == (last54, 3) and plays54("Vesna") == (last54, 2))
    ok("and a song not played last time plays its last go then, which it still lists",
       plays54("Doroga") == (first54, 4)
       and s54.last_time()["not_played"][0]["take"]["take_number"] == 4)

    jam54 = s54.set_take_star(last54, 4, True)
    ok("a star goes on a take with no song", jam54["ok"] and jam54["take"]["starred"]
       and jam54["take"]["song"] is None)
    ok("and history's strip draws it",
       [t["starred"] for r in next(x for x in s54.list_rehearsals()
                                   if x["name"] == "Tuesday")["runs"] for t in r["takes"]]
       == [False, False, False, True])

    s54.set_take_star(first54, 2, True)
    s54.set_take_star(mid54, 1, True)
    ok("a song's play button plays its newest starred go, from whichever rehearsal it was played at",
       plays54("Polyn") == (mid54, 1))
    polyn54 = next(s for s in s54.last_time()["last"]["songs"] if s["name"] == "Polyn")
    ok("with that rehearsal's name and day, to say so",
       polyn54["plays"]["rehearsal"] == "Middle"
       and polyn54["plays"]["created_at"] == "2026-09-10T19:00:00"
       and polyn54["plays"]["take"]["name"] == "Polyn 3")
    s54.set_take_star(last54, 1, True)
    ok("last time's own starred go is newer than any before it",
       plays54("Polyn") == (last54, 1))
    s54.set_take_star(last54, 3, True)
    ok("two starred goes in one evening: the later one is the newest",
       plays54("Polyn") == (last54, 3))
    s54.set_take_star(last54, 1, False)
    s54.set_take_star(last54, 3, False)
    ok("taken off again, the newest starred go is the older rehearsal's",
       plays54("Polyn") == (mid54, 1))
    s54.set_take_star(first54, 3, True)
    ok("a song not played last time plays its starred go too",
       plays54("Doroga") == (first54, 3)
       and s54.last_time()["not_played"][0]["take"]["take_number"] == 4)

    import shutil as _shutil54
    _shutil54.move(mid54, str(tmp54 / "elsewhere"))
    ok("a starred go in a rehearsal not on disk is passed over for one that is",
       plays54("Polyn") == (first54, 2))

    ok("a folder outside the recordings is refused",
       s54.set_take_star(str(tmp54 / "nowhere"), 1, True)
       == {"ok": False, "error": "Folder is outside the recordings directory"})
    ok("a rehearsal that is not there is said so",
       s54.set_take_star(str(tmp54 / "Rec" / "Gone"), 1, True)
       == {"ok": False, "error": "Rehearsal not found"})
    ok("and a take that is not there",
       s54.set_take_star(last54, 9, True) == {"ok": False, "error": "Take not found"})

    # The live side: a saved take, renamed, cropped and deleted.
    _, l54 = fresh_api(Path(tempfile.mkdtemp()))
    l54.start_rehearsal("Live", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    live54 = Path(l54._session["folder"])
    cloud54 = Path(tempfile.mkdtemp()) / "Cloud"
    l54.set_cloud_dir(str(cloud54))
    l54.set_auto_publish(True)

    def keep54(number, name):
        draft = live54 / "_drafts" / f"take {number}"
        write_wav(draft / "Gtr.wav", 100, seconds=3.0)
        l54._session["take_counter"] = number
        return l54.keep_take(number, str(draft), name, 3.0,
                             [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])["take"]

    saved54 = keep54(1, "Ogon")
    keep54(2, "Ogon")
    ok("a take is saved without a star", saved54["starred"] is False)
    l54.set_take_star(str(live54), 1, True)
    renamed54 = l54.rename_take(str(live54), 1, "Sonce")
    ok("the star stays with its take renamed to another song",
       renamed54["ok"] and renamed54["take"]["song"] == "Sonce" and renamed54["take"]["starred"])
    unnamed54 = l54.rename_take(str(live54), 1, "Take 1")
    ok("and renamed to no song at all",
       unnamed54["ok"] and unnamed54["take"]["song"] is None and unnamed54["take"]["starred"])
    cropped54 = l54.crop_take(str(live54), 1, 0.5, 2.5)
    ok("and cropped", cropped54["ok"] and cropped54["take"]["starred"])
    queued54 = dict(l54._cloud_queue.states(str(live54)))
    l54.set_take_star(str(live54), 2, True)
    ok("the kept takes are queued for the cloud, to compare against",
       len(queued54) > 0)
    ok("a star queues no copy for the cloud, and renames nothing on disk",
       dict(l54._cloud_queue.states(str(live54))) == queued54
       and Path(l54._lib.take(live54, 2)["tracks"][0]["file"]).exists())
    l54.delete_take(str(live54), 1)
    ok("a deleted take is not there to star",
       l54.set_take_star(str(live54), 1, True) == {"ok": False, "error": "Take not found"})

    print("\n[55] Labels: made, named, coloured, ordered and deleted, and a mark's own")
    tmp55 = Path(tempfile.mkdtemp())
    _, l55 = fresh_api(tmp55)
    ok("a library starts with the four labels marks always had",
       [(lb["id"], lb["name"], lb["colour"], lb["marks"]) for lb in l55.list_labels()]
       == [(1, "Note", "grey", 0), (2, "Keep this", "green", 0),
           (3, "Went wrong", "red", 0), (4, "Do again", "amber", 0)])

    solo55 = l55.add_label("Solo", "violet")
    ok("a change answers with every label",
       solo55["ok"] and [lb["name"] for lb in solo55["labels"]][-1] == "Solo")
    solo_id = solo55["labels"][-1]["id"]
    ok("a refused one answers why",
       l55.add_label("solo", "grey") == {"ok": False,
                                         "error": "There is already a label called Solo"})
    ok("renamed", l55.rename_label(solo_id, "Riff")["labels"][-1]["name"] == "Riff")
    ok("recoloured", l55.recolour_label(solo_id, "teal")["labels"][-1]["colour"] == "teal")
    ok("moved", [lb["id"] for lb in l55.move_label(solo_id, 0)["labels"]][0] == solo_id)
    ok("a colour not in the palette is refused",
       l55.recolour_label(solo_id, "orange")
       == {"ok": False, "error": "Pick a colour from the palette"})

    l55.start_rehearsal("Labels", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    f55 = Path(l55._session["folder"])
    d55 = f55 / "_drafts" / "take 1"
    write_wav(d55 / "Gtr.wav", 1000, seconds=4.0)
    l55._session["take_counter"] = 1
    kept55 = l55.keep_take(1, str(d55), "Polyn", 4.0,
                           [{"name": "Gtr", "file": str(d55 / "Gtr.wav")}],
                           [{"at": 0.5, "note": "no label"},
                            {"at": 1.0, "note": "", "label_id": 99}])
    ok("marks saved with a take and no label there get the first label",
       [m["label_id"] for m in kept55["take"]["markers"]] == [solo_id, solo_id])
    added55 = l55.add_take_marker(str(f55), 1, 2.0)
    ok("a mark dropped with no label gets the first one",
       [m["label_id"] for m in added55["markers"] if m["at"] == 2.0] == [solo_id])
    l55.update_take_marker(str(f55), 1, 2.0, "the riff", 3)
    l55.update_take_marker(str(f55), 1, 2.0, "the riff, again")
    m55 = next(m for m in l55._lib.take(f55, 1)["markers"] if m["at"] == 2.0)
    ok("editing only its comment leaves its label",
       m55["label_id"] == 3 and m55["note"] == "the riff, again")
    l55.add_label("Gone", "pink")
    gone55 = l55.list_labels()[-1]["id"]
    l55.delete_label(gone55)
    l55.update_take_marker(str(f55), 1, 2.0, None, gone55)
    ok("a label deleted meanwhile is not kept on a mark: it gets the first",
       next(m for m in l55._lib.take(f55, 1)["markers"] if m["at"] == 2.0)["label_id"]
       == solo_id)

    ok("the count of a label's marks is the library's",
       next(lb for lb in l55.list_labels() if lb["id"] == solo_id)["marks"] == 3)
    ok("a label in use is not deleted without saying where its marks go",
       l55.delete_label(solo_id)
       == {"ok": False, "error": "Say which label the marks of Riff get"})
    moved55 = l55.delete_label(solo_id, 1)
    ok("and with it, they go there",
       moved55["ok"] and solo_id not in [lb["id"] for lb in moved55["labels"]]
       and all(m["label_id"] == 1 for m in l55._lib.take(f55, 1)["markers"]))

    saved55 = l55._library
    l55._library = None
    ok("with no database open there are no labels, and no second error about it",
       l55.list_labels() == [])
    l55._library = saved55

    print("\n[56] Songs: every song with its goes, and a song's goes by rehearsal")
    tmp56 = Path(tempfile.mkdtemp())
    _, s56 = fresh_api(tmp56)

    def rehearsal56(name, created_at, names):
        """A rehearsal from an old session.json, its takes 100 s each."""
        folder = tmp56 / "Rec" / f"{name} - {created_at[:10]} {created_at[11:13]}-00"
        folder.mkdir(parents=True)
        (folder / "session.json").write_text(json.dumps({
            "name": name, "created_at": created_at, "samplerate": SR,
            "tracks": [{"name": "Gtr", "channel": 1}],
            "takes": [{"take_number": i + 1, "name": n, "duration_sec": 100,
                       "tracks": [], "markers": []} for i, n in enumerate(names)],
        }))
        import_all(s56._lib, s56._cloud_dir)
        return str(folder)

    # Polyn 1, Polyn 2, Doroga 1, Take 4.
    first56 = rehearsal56("First", "2026-08-25T19:00:00",
                          ["Polyn", "Polyn 2", "Doroga", "Take 4"])
    # Polyn 3, Vesna 1.
    mid56 = rehearsal56("Middle", "2026-09-10T19:00:00", ["Polyn", "Vesna"])
    # Vesna 2, Polyn 4, Polyn 5, Take 4.
    last56 = rehearsal56("Tuesday", "2026-09-22T19:00:00",
                         ["Vesna", "Polyn", "Polyn 2", "Take 4"])

    def song56(title):
        return next((s for s in s56.list_songs()["songs"] if s["title"] == title), None)

    def goes56(song_id):
        return [(g["folder"], g["take"]["take_number"]) for g in s56.get_song(song_id)["goes"]]

    def plays56(song_id):
        p = s56.get_song(song_id)["plays"]
        return None if p is None else (p["folder"], p["take"]["take_number"])

    listed56 = s56.list_songs()
    ok("every song is listed with how many goes and rehearsals it has",
       [(s["title"], s["goes"], s["rehearsals"]) for s in listed56["songs"]]
       == [("Doroga", 1, 1), ("Polyn", 5, 3), ("Vesna", 2, 2)])
    polyn56 = song56("Polyn")
    ok("and when it was first and last played",
       polyn56["first_played"] == "2026-08-25T19:00:00"
       and polyn56["last_played"] == "2026-09-22T19:00:00")
    ok("the takes with no song are counted apart",
       listed56["not_named"] == {"takes": 2, "rehearsals": 2,
                                 "last_played": "2026-09-22T19:00:00"})
    page56 = s56.get_song(polyn56["id"])
    ok("a song's goes come newest rehearsal first, in the order played within one",
       page56["ok"] and page56["title"] == "Polyn"
       and goes56(polyn56["id"]) == [(last56, 2), (last56, 3), (mid56, 1),
                                     (first56, 1), (first56, 2)])
    ok("each go is the take as a rehearsal gives it, and on disk",
       page56["goes"][0]["take"]["name"] == "Polyn 4"
       and page56["goes"][0]["rehearsal"] == "Tuesday"
       and not any(g["missing"] for g in page56["goes"]))
    ok("with no star, the play button plays the last go at the newest rehearsal",
       plays56(polyn56["id"]) == (last56, 3))

    s56.set_take_star(first56, 1, True)
    s56.set_take_star(last56, 2, True)
    ok("a song counts its starred goes",
       song56("Polyn")["starred"] == 2)
    ok("and plays its newest starred go, not the highest go number",
       plays56(polyn56["id"]) == (last56, 2))

    unnamed56 = s56.get_song(None)
    ok("the takes with no song have a page of their own, newest first",
       unnamed56["ok"] and unnamed56["title"] is None
       and goes56(None) == [(last56, 4), (first56, 4)])
    ok("a song nobody has is not found",
       s56.get_song(9999) == {"ok": False, "error": "Song not found"})

    shutil.move(last56, str(tmp56 / "elsewhere"))
    gone56 = s56.get_song(polyn56["id"])
    ok("a rehearsal not on disk is still counted",
       (song56("Polyn")["goes"], song56("Polyn")["rehearsals"]) == (5, 3))
    ok("its goes are listed as missing, and only its",
       [g["missing"] for g in gone56["goes"]] == [True, True, False, False, False])
    ok("and the play button passes over them, to the starred go on disk",
       plays56(polyn56["id"]) == (first56, 1))
    shutil.move(str(tmp56 / "elsewhere"), last56)

    s56._lib.delete_take(first56, 3)
    ok("a song with no goes left is not listed",
       song56("Doroga") is None)

    spelling56 = rehearsal56("Spelling", "2026-09-25T19:00:00", ["opus"])
    s56._lib.update_take(spelling56, 1, name="Opus")
    ok("a song respelled is listed under its new title",
       song56("Opus") is not None and song56("opus") is None)

    from sqlalchemy import event as sa_event
    statements56 = []

    def count56(_conn, _cursor, statement, *_):
        # Every session opens with a BEGIN IMMEDIATE of its own (store/db.py);
        # what is counted is what is asked of the tables.
        if statement.lstrip().upper().startswith("SELECT"):
            statements56.append(statement)

    sa_event.listen(s56._lib._engine, "before_cursor_execute", count56)
    s56.list_songs()
    sa_event.remove(s56._lib._engine, "before_cursor_execute", count56)
    ok("the list of songs is two queries, its songs and their old names, however many",
       len(statements56) == 2)

    ok("History opens on its Rehearsals view until another is chosen",
       s56.get_settings()["history_view"] == "rehearsals")
    ok("choosing the Songs view is kept",
       s56.save_history_view("songs") == {"ok": True})
    _, again56 = fresh_api(tmp56)
    ok("and is still the view after a restart",
       again56.get_settings()["history_view"] == "songs")
    ok("a view History has not got is refused",
       again56.save_history_view("albums") == {"ok": False, "error": "Unknown view"}
       and again56.get_settings()["history_view"] == "songs")
    cfg56 = json.loads((tmp56 / "config.json").read_text())
    cfg56["history_view"] = 3
    (tmp56 / "config.json").write_text(json.dumps(cfg56))
    _, odd56 = fresh_api(tmp56)
    ok("and one written by hand that makes no sense reads as Rehearsals",
       odd56.get_settings()["history_view"] == "rehearsals")

    print("\n[57] A rehearsal's folder, shown; the session's size on disk")
    # The player's header has a button to the rehearsal's folder. The window
    # names the folder, so only one the library knows is ever opened.
    tmp57 = Path(tempfile.mkdtemp())
    api57mod, s57 = fresh_api(tmp57)
    opened57 = []
    real_open57 = api57mod.open_in_file_manager
    api57mod.open_in_file_manager = lambda path: opened57.append(str(path)) or {"ok": True}
    try:
        old57 = tmp57 / "Rec" / "Jam - 2026-09-22 19-00"
        old57.mkdir(parents=True)
        (old57 / "session.json").write_text(json.dumps({
            "name": "Jam", "created_at": "2026-09-22T19:00:00", "samplerate": SR,
            "tracks": [{"name": "Gtr", "channel": 1}],
            "takes": [{"take_number": 1, "name": "Polyn", "duration_sec": 100,
                       "tracks": [], "markers": []}],
        }))
        import_all(s57._lib, s57._cloud_dir)
        ok("a rehearsal the library knows has its folder opened",
           s57.show_rehearsal_folder(str(old57)) == {"ok": True}
           and opened57 == [str(old57)])
        stranger57 = tmp57 / "Elsewhere"
        stranger57.mkdir()
        ok("a folder the library does not know is refused, and nothing opened",
           s57.show_rehearsal_folder(str(stranger57))["ok"] is False
           and len(opened57) == 1)
        shutil.move(str(old57), str(tmp57 / "moved"))
        ok("a known rehearsal whose folder is gone is refused",
           s57.show_rehearsal_folder(str(old57))
           == {"ok": False, "error": "The rehearsal's folder is not on disk"}
           and len(opened57) == 1)
        shutil.move(str(tmp57 / "moved"), str(old57))

        s57.start_rehearsal("Live", 0, SR, [{"name": "Gtr", "channel": 1}])
        live57 = Path(s57._session["folder"])
        ok("the rehearsal being recorded has its folder opened too",
           s57.show_rehearsal_folder(str(live57)) == {"ok": True}
           and opened57[-1] == str(live57))
        write_wav(live57 / "_drafts" / "take 1" / "Gtr.wav", 100, seconds=1.0)
        state57 = s57.session_state()
        ok("the session says how much of the disk its folder uses",
           isinstance(state57.get("disk_bytes"), int)
           and state57["disk_bytes"] == api57mod._folder_bytes(live57)
           and state57["disk_bytes"] > 0)
        s57.finish_rehearsal()
    finally:
        api57mod.open_in_file_manager = real_open57

    print("\n[58] The first go tonight against the go before tonight")
    # The recording screen measures the first go of a song tonight against a
    # go from before tonight, with its day: the newest starred one, else the
    # last go of the latest rehearsal that played it. (Before tonight, the
    # card that showed those goes on the rehearsal screen, is gone.)
    import shutil as shutil58
    tmp58 = Path(tempfile.mkdtemp())
    _, s58 = fresh_api(tmp58)

    def rehearsal58(name, created_at, takes):
        """A rehearsal from an old session.json: (name, seconds) per take."""
        folder = tmp58 / "Rec" / f"{name} - {created_at[:10]} {created_at[11:13]}-00"
        folder.mkdir(parents=True)
        (folder / "session.json").write_text(json.dumps({
            "name": name, "created_at": created_at, "samplerate": SR,
            "tracks": [{"name": "Gtr", "channel": 1}],
            "takes": [{"take_number": i + 1, "name": n, "duration_sec": sec,
                       "tracks": [], "markers": []} for i, (n, sec) in enumerate(takes)],
        }))
        import_all(s58._lib, s58._cloud_dir)
        return str(folder)

    A58 = rehearsal58("First", "2026-08-25T19:00:00",
                      [("Polyn", 180), ("Polyn 2", 190), ("Doroga", 200)])
    rehearsal58("Middle", "2026-09-10T19:00:00", [("Polyn", 210), ("Vesna", 220)])
    C58 = rehearsal58("Tuesday", "2026-09-15T19:00:00",
                      [("Polyn", 230), ("Polyn 2", 240), ("Vesna", 250)])
    D58 = rehearsal58("Last", "2026-09-22T19:00:00", [("Vesna", 260), ("Polyn", 270)])

    s58.start_rehearsal("Live", 0, SR, [{"name": "Gtr", "channel": 1}])
    live58 = Path(s58._session["folder"])

    def keep58(number, name):
        s58._session["take_counter"] = number
        d = live58 / "_drafts" / f"take {number}"
        write_wav(d / "Gtr.wav", 100, seconds=1.0)
        return s58.keep_take(number, str(d), name, 1.0,
                             [{"name": "Gtr", "file": str(d / "Gtr.wav")}])

    def last58():
        return s58.session_state()["last_attempt"]

    s58.set_next_take_name("Polyn")
    ok("the rehearsal screen has no Before tonight any more",
       "before_tonight" not in s58.session_state())
    la58 = last58()
    ok("with no star, the last go of the latest rehearsal, with its day",
       la58 is not None and la58["duration_sec"] == 270
       and str(la58.get("created_at", "")).startswith("2026-09-22"))
    s58.set_take_star(C58, 1, True)
    ok("the newest starred go once there is one",
       last58() is not None and last58()["duration_sec"] == 230)
    s58.set_take_star(C58, 1, False)
    s58.set_take_star(A58, 1, True)
    ok("a star older than the latest rehearsals is still the one",
       last58() is not None and last58()["duration_sec"] == 180)
    s58.set_take_star(A58, 1, False)

    s58.set_next_take_name("polyn")
    ok("a title in another case finds its song",
       last58() is not None and last58()["song"] == "Polyn")

    shutil58.move(D58, str(tmp58 / "moved"))
    try:
        ok("a rehearsal not on disk is skipped",
           last58() is not None and last58()["duration_sec"] == 240)
    finally:
        shutil58.move(str(tmp58 / "moved"), D58)

    keep58(1, "Polyn")
    st58 = s58.session_state()
    ok("with a go tonight, last time is tonight's",
       st58["last_attempt"] is not None and "created_at" not in st58["last_attempt"]
       and st58["last_attempt"]["duration_sec"] == 1.0)
    keep58(2, "Sonca")
    ok("a song played only tonight is measured against tonight",
       last58() is not None and last58()["song"] == "Sonca"
       and "created_at" not in last58())
    s58.set_next_take_name("Take 3")
    ok("Take N has none", last58() is None)
    s58.set_next_take_name("Nothing yet")
    ok("a new song has none", last58() is None)

    # The library failing to answer must not take the rehearsal screen down
    # with it: the session is what it shows.
    s58.set_next_take_name("Vesna")
    goes_before58 = s58._lib.goes_before

    def broken58(*_a, **_k):
        raise RuntimeError("database is locked")

    s58._lib.goes_before = broken58
    try:
        st58 = s58.session_state()
        ok("a library that cannot answer leaves the session as it is",
           st58.get("active") is True and st58["last_attempt"] is None
           and st58["next_take_name"] == "Vesna")
    except Exception as e:
        ok(f"a library that cannot answer leaves the session as it is ({e!r})", False)
    finally:
        s58._lib.goes_before = goes_before58
    s58.finish_rehearsal()

    print("\n[59] Sorting the evening")
    # On the rehearsal screen and in History: the ★ takes sent with one
    # button, the false starts cleared with another, and how short a false
    # start is, which is a setting.
    tmp59 = Path(tempfile.mkdtemp())
    _, s59 = fresh_api(tmp59)
    ok("a false start is shorter than 30 s unless set",
       s59.get_settings()["false_start_sec"] == 30)
    r59 = s59.set_false_start(45)
    ok("the limit is saved", r59.get("ok") is True and r59.get("false_start_sec") == 45
       and s59.get_settings()["false_start_sec"] == 45
       and s59._config.get("false_start_sec") == 45)
    ok("no shorter than 5 s", s59.set_false_start(2).get("false_start_sec") == 5)
    ok("no longer than 120 s", s59.set_false_start(500).get("false_start_sec") == 120)
    ok("a limit that is not a number is refused",
       s59.set_false_start("x").get("ok") is False
       and s59.get_settings()["false_start_sec"] == 120)
    # The config is a file somebody may edit by hand.
    for written59, read59 in ((1000, 120), (1, 5), (45.0, 45), (True, 30), ("45", 30)):
        s59._config["false_start_sec"] = written59
        ok(f"a limit of {written59!r} in the config is read as {read59}",
           s59.get_settings()["false_start_sec"] == read59)
    s59.set_false_start(120)

    s59.start_rehearsal("Evening", None, SR, [{"name": "A", "channel": 1}], 16)
    live59 = s59._session["folder"]

    def keep59(number, name):
        d = tmp59 / "takes" / str(number)
        write_wav(d / "A.wav", 300 + number, seconds=1.0)
        s59._session["take_counter"] = number
        return s59.keep_take(number, str(d), name, 1.0,
                             [{"name": "A", "file": str(d / "A.wav")}], [])

    for n59, name59 in ((1, "Polyn"), (2, "Polyn"), (3, "Vesna"), (4, "Take 4")):
        keep59(n59, name59)
    s59.set_take_star(live59, 1, True)
    s59.set_take_star(live59, 3, True)

    ok("with no cloud folder nothing is sent",
       s59.send_starred(live59) == {"ok": False, "error": "No cloud folder chosen",
                                    "needs_dir": True}
       and s59._cloud_queue._jobs == [])

    cloud59 = tmp59 / "Drive"
    s59.set_cloud_dir(str(cloud59))
    s59.set_auto_publish(False, "both")
    s59._lib.set_cloud_copy(live59, 3, {"mix": str(cloud59 / "x" / "03 - Vesna.wav")},
                            str(cloud59))
    sent59 = s59.send_starred(live59)
    ok("the starred takes not in the cloud folder are sent",
       sent59 == {"ok": True, "queued": [1], "failed": []})
    ok("as Settings' What gets published says",
       [j[1:] for j in s59._cloud_queue._jobs] == [[1, "both"]])
    ok("a take already waiting is not sent again",
       s59.send_starred(live59) == {"ok": True, "queued": [], "failed": []}
       and len(s59._cloud_queue._jobs) == 1)
    keep59(5, "Polyn")
    s59.set_take_star(live59, 5, True)
    for track59 in s59._lib.take(live59, 5)["tracks"]:
        Path(track59["file"]).unlink()
    ok("a starred take that cannot be sent is said, with why",
       s59.send_starred(live59) == {
           "ok": True, "queued": [],
           "failed": [{"take_number": 5, "error": "The take has no files left on disk"}]}
       and len(s59._cloud_queue._jobs) == 1)

    take4_dir59 = Path(s59._lib.take(live59, 4)["tracks"][0]["file"]).parent
    gone59 = s59.delete_takes(live59, [2, 4, 99])
    ok("several takes are deleted",
       gone59.get("ok") is True and gone59.get("deleted") == [2, 4])
    ok("and the one that could not be is said",
       gone59.get("failed") == [{"take_number": 99, "error": "Take not found"}])
    ok("their folders are gone and the rest stay",
       not take4_dir59.exists()
       and [t["take_number"] for t in s59.get_rehearsal(live59)["takes"]] == [1, 3, 5])
    s59.finish_rehearsal()

    print("\n[60] Marks across the library: every mark with a label")
    tmp60 = Path(tempfile.mkdtemp())
    _, s60 = fresh_api(tmp60)

    def rehearsal60(name, created_at, takes):
        """A rehearsal from an old session.json: takes as (name, markers),
        100 s each."""
        folder = tmp60 / "Rec" / f"{name} - {created_at[:10]} {created_at[11:13]}-00"
        folder.mkdir(parents=True)
        (folder / "session.json").write_text(json.dumps({
            "name": name, "created_at": created_at, "samplerate": SR,
            "tracks": [{"name": "Gtr", "channel": 1}],
            "takes": [{"take_number": i + 1, "name": n, "duration_sec": 100,
                       "tracks": [], "markers": m} for i, (n, m) in enumerate(takes)],
        }))
        import_all(s60._lib, s60._cloud_dir)
        return str(folder)

    def mark60(at, note, label_id):
        # Old session.json files said a mark's kind; each became a label.
        kind = {1: "note", 2: "good", 3: "issue", 4: "redo"}[label_id]
        return {"at": at, "note": note, "kind": kind}

    # Labels as a library starts: 1 Note, 2 Keep this, 3 Went wrong, 4 Do again.
    first60 = rehearsal60("First", "2026-08-25T19:00:00", [
        ("Polyn", [mark60(30, "late", 3)]),
        ("Take 2", [mark60(10, "riff", 1)])])
    mid60 = rehearsal60("Middle", "2026-09-10T19:00:00", [
        ("Vesna", [mark60(5, "", 1)])])
    last60 = rehearsal60("Tuesday", "2026-09-22T19:00:00", [
        ("Polyn", [mark60(80, "chorus early", 3), mark60(20, "count", 3)]),
        ("Take 2", [mark60(42, "jam riff", 3)])])

    def where60(label_id):
        return [(m["folder"], m["take_number"], m["at"])
                for m in s60.list_marks(label_id)["marks"]]

    went60 = s60.list_marks(3)
    ok("a label's marks come newest rehearsal first, then by take, then by moment",
       went60.get("ok") is True
       and where60(3) == [(last60, 1, 20), (last60, 1, 80), (last60, 2, 42), (first60, 1, 30)])
    ok("each says what its row shows: the take, its rehearsal and the mark",
       went60["marks"][0] == {
           "folder": last60, "rehearsal": "Tuesday", "created_at": "2026-09-22T19:00:00",
           "missing": False, "take_number": 1, "name": "Polyn 2", "song": "Polyn",
           "duration_sec": 100, "at": 20, "note": "count"})
    ok("a take with no song is listed too",
       went60["marks"][2]["name"] == "Take 2" and went60["marks"][2]["song"] is None)
    ok("another label's marks are its own",
       where60(1) == [(mid60, 1, 5), (first60, 2, 10)])
    ok("a label that is not there is not found",
       s60.list_marks(999) == {"ok": False, "error": "Label not found"})

    shutil.move(last60, str(tmp60 / "elsewhere"))
    ok("a rehearsal not on disk keeps its marks, listed as missing, and only its",
       [m["missing"] for m in s60.list_marks(3)["marks"]] == [True, True, True, False])
    shutil.move(str(tmp60 / "elsewhere"), last60)

    labels60 = {lb["id"]: lb for lb in s60.list_labels()}
    ok("a label says in how many rehearsals it marks, and the newest",
       (labels60[3]["marks"], labels60[3]["rehearsals"], labels60[3]["last_marked"])
       == (4, 2, "2026-09-22T19:00:00")
       and (labels60[1]["rehearsals"], labels60[1]["last_marked"]) == (2, "2026-09-10T19:00:00"))
    ok("and a label with no marks has none of either",
       (labels60[4]["marks"], labels60[4]["rehearsals"], labels60[4]["last_marked"])
       == (0, 0, None))
    ok("a change to the labels answers with the same figures",
       {lb["id"]: lb["rehearsals"] for lb in s60.rename_label(4, "Again")["labels"]}
       == {1: 2, 2: 0, 3: 2, 4: 0})

    ok("the marks are grouped by rehearsal until another grouping is chosen",
       s60.get_settings()["marks_grouping"] == "rehearsal")
    ok("choosing By song is kept",
       s60.save_marks_grouping("song") == {"ok": True})
    _, again60 = fresh_api(tmp60)
    ok("and is still the grouping after a restart",
       again60.get_settings()["marks_grouping"] == "song")
    ok("a grouping there is not is refused, and changes nothing",
       again60.save_marks_grouping("album") == {"ok": False, "error": "Unknown grouping"}
       and again60.get_settings()["marks_grouping"] == "song")
    cfg60 = json.loads((tmp60 / "config.json").read_text())
    cfg60["marks_grouping"] = 3
    (tmp60 / "config.json").write_text(json.dumps(cfg60))
    _, odd60 = fresh_api(tmp60)
    ok("and one written by hand that makes no sense reads as By rehearsal",
       odd60.get_settings()["marks_grouping"] == "rehearsal")

    ok("History's Marks view is kept as the others are",
       odd60.save_history_view("marks") == {"ok": True})
    _, view60 = fresh_api(tmp60)
    ok("and is still the view after a restart",
       view60.get_settings()["history_view"] == "marks")

    renamed60 = s60.rename_take(first60, 1, "Doroga")
    hit60 = [m for m in s60.list_marks(3)["marks"] if m["folder"] == first60][0]
    ok("a take renamed to another song is listed with its new song and name",
       renamed60.get("ok") is True and hit60["song"] == "Doroga"
       and hit60["name"].startswith("Doroga"))

    s60.delete_label(3, 1)
    ok("a label's marks moved to another when it is deleted are listed under that one",
       where60(1) == [(last60, 1, 20), (last60, 1, 80), (last60, 2, 42),
                      (mid60, 1, 5), (first60, 1, 30), (first60, 2, 10)]
       and s60.list_marks(3) == {"ok": False, "error": "Label not found"})

    from sqlalchemy import event as sa_event60
    selects60 = []

    def count60(_conn, _cursor, statement, *_):
        if statement.lstrip().upper().startswith("SELECT"):
            selects60.append(statement)

    def queries60(label_id):
        selects60.clear()
        sa_event60.listen(s60._lib._engine, "before_cursor_execute", count60)
        s60.list_marks(label_id)
        sa_event60.remove(s60._lib._engine, "before_cursor_execute", count60)
        return len(selects60)

    few60 = queries60(1)
    rehearsal60("Big", "2026-09-30T19:00:00",
                [(name, [mark60(10, "a", 1), mark60(50, "b", 1)])
                 for name in ("Polyn", "Vesna", "Take 3", "Polyn", "Doroga",
                              "Take 6", "Vesna", "Polyn")])
    ok("the number of queries does not grow with the marks",
       len(s60.list_marks(1)["marks"]) == 22 and queries60(1) == few60)

    print("\n[61] Renaming and merging songs")
    from rehearsal_recorder.activity import Journal as Journal61
    from rehearsal_recorder.names_pass import NamesPass as NamesPass61

    # The loop: a pass over the takes given, under its own title.
    journal61 = Journal61()
    fixed61 = []

    def fix61(folder, number):
        fixed61.append(number)
        return {"renamed": True, "error": None}

    queued61 = NamesPass61(find=lambda: [("/r", 9, "Other 1")], fix=fix61,
                           busy=lambda: False, journal=journal61)
    queued61.request_takes([("/r", 1, "Polin 1"), ("/r", 2, "Polin 2")],
                           "Renaming Polyn to Polin")
    entry61 = None
    ok("a pass over the takes given renames only those, under its own title",
       queued61.run_queued() == 2 and fixed61 == [1, 2])
    entry61 = journal61.snapshot()[0]
    ok("and says so in its own entry",
       entry61["kind"] == "names" and entry61["title"] == "Renaming Polyn to Polin"
       and entry61["state"] == "done" and entry61["detail"] == "2 takes renamed")
    ok("once", queued61.run_queued() == 0 and fixed61 == [1, 2])
    # One pass going wrong outside a take leaves the next queued pass to run.
    queued61.request_takes([("/r", 3)], "Broken")
    queued61.request_takes([("/r", 4, "Polin 4")], "Renaming Polin to Polyn")
    ok("a queued pass that breaks does not hold up the next",
       queued61.run_queued() == 1 and fixed61 == [1, 2, 4])

    # The real thing: folders and a cloud copy following a rename and a merge.
    tmp61 = Path(tempfile.mkdtemp())
    rec61, cloud61 = tmp61 / "Rec", tmp61 / "Drive"
    cloud61.mkdir(parents=True)
    (tmp61 / "config.json").write_text(json.dumps(
        {"recordings_dir": str(rec61), "cloud_dir": str(cloud61)}), encoding="utf-8")
    _, p61 = fresh_api(tmp61)

    def rehearsal61(name, created_at, names):
        folder = rec61 / f"{name} - {created_at[:10]} 19-00"
        takes = []
        for i, n in enumerate(names, start=1):
            take_dir = folder / f"{i:02d} - {n}"
            write_wav(take_dir / "Gtr.wav", 100, seconds=0.2)
            takes.append({"take_number": i, "name": n, "duration_sec": 0.2, "markers": [],
                          "tracks": [{"name": "Gtr", "file": str(take_dir / "Gtr.wav")}]})
        (folder / "session.json").write_text(json.dumps({
            "name": name, "created_at": created_at, "samplerate": SR,
            "tracks": [{"name": "Gtr", "channel": 1}], "takes": takes}), encoding="utf-8")
        import_all(p61._lib, p61._cloud_dir)
        return folder

    def dirs61(folder):
        return sorted(d.name for d in folder.iterdir() if d.is_dir())

    def entry_of61(title):
        return next((e for e in p61.activity()["entries"] if e["title"] == title), None)

    def song61(title):
        return next((s for s in p61.list_songs()["songs"] if s["title"] == title), None)

    # Polyn 1-3; Pałyn 1-3, then Palyn 1-2 a week later.
    one61 = rehearsal61("One", "2026-09-01T19:00:00", ["Polyn", "Polyn", "Pałyn", "Pałyn"])
    two61 = rehearsal61("Two", "2026-09-08T19:00:00", ["Polyn", "Pałyn", "Viasna"])
    three61 = rehearsal61("Three", "2026-09-15T19:00:00", ["Palyn", "Palyn"])
    p61._names_pass.run()
    mix61 = cloud61 / two61.name / "01 - Polyn 3.wav"
    mix61.parent.mkdir(parents=True)
    mix61.write_bytes(b"RIFF")
    p61._lib.set_cloud_copy(two61, 1, {"mix": str(mix61), "mix_format": "wav", "source": {}},
                            cloud61)

    polyn61 = song61("Polyn")["id"]
    renamed61 = p61.rename_song(polyn61, "Polin")
    ok("a song renamed answers its title and how many goes it has",
       renamed61 == {"ok": True, "title": "Polin", "goes": 3})
    p61.player_open([{"name": "Gtr", "file": str(one61 / "02 - Polyn 2" / "Gtr.wav")}])
    p61._names_pass.run_queued()
    ok("its folders follow in the background, but not one open in the player",
       dirs61(one61) == ["01 - Polin 1", "02 - Polyn 2", "03 - Pałyn 1", "04 - Pałyn 2"]
       and dirs61(two61)[0] == "01 - Polin 3" and p61._open_tracks is not None)
    ok("and so does its copy in the cloud folder",
       sorted(p.name for p in (cloud61 / two61.name).iterdir()) == ["01 - Polin 3.wav"])
    rename_entry61 = entry_of61("Renaming Polyn to Polin \u00b7 3 takes")
    ok("the background work says what it is doing",
       rename_entry61 is not None and rename_entry61["kind"] == "names"
       and rename_entry61["state"] == "done")
    p61.player_close()
    ok("the take left is renamed by the next pass once the player lets go",
       p61._names_pass.run() == 1 and "02 - Polin 2" in dirs61(one61))

    pałyn61 = song61("Pałyn")["id"]
    ok("a title that is another song's is refused, naming that song",
       p61.rename_song(polyn61, "pałyn") == {
           "ok": False, "error": "There is already a song called Pałyn",
           "into": {"id": pałyn61, "title": "Pałyn"}})
    ok("other refusals name no song",
       p61.rename_song(polyn61, "Take 2") == {
           "ok": False, "error": "Take 2 is what a take with no song is called", "into": None})

    palyn61 = song61("Palyn")["id"]
    p61._lib.set_starred(three61, 2, True)
    p61._lib.set_starred(one61, 3, True)
    asked61 = p61.merge_songs(palyn61, pałyn61, True)
    ok("a merge asked about answers the counts and moves nothing",
       asked61 == {"ok": True, "into": "Pałyn", "goes": 2, "rehearsals": 1,
                   "first": 4, "last": 5}
       and dirs61(three61) == ["01 - Palyn 1", "02 - Palyn 2"])
    merged61 = p61.merge_songs(palyn61, pałyn61)
    p61._names_pass.run_queued()
    ok("merged, its goes are the other's next, folders and all",
       merged61 == asked61 and dirs61(three61) == ["01 - Pałyn 4", "02 - Pałyn 5"])
    merge_entry61 = entry_of61("Merging Palyn into Pa\u0142yn \u00b7 2 takes")
    ok("the background work says that too",
       merge_entry61 is not None and merge_entry61["state"] == "done")
    ok("and a whole pass after it finds nothing left to rename",
       p61._names_pass.run() == 0)
    plays61 = p61.get_song(pałyn61)["plays"]
    ok("the merged song plays its newest starred go, whichever song it was",
       plays61["folder"] == str(three61) and plays61["take"]["take_number"] == 2)
    ok("a song merged into itself is refused",
       p61.merge_songs(pałyn61, pałyn61) == {
           "ok": False, "error": "A song cannot be merged into itself"})

    ok("the songs carry their old names, for the name fields",
       next(c for c in p61.song_choices(str(two61))["here"] if c["song"] == "Pałyn")["also"]
       == ["Palyn"])
    ok("and for History", song61("Pałyn")["also"] == ["Palyn"]
       and p61.get_song(pałyn61)["also"] == ["Palyn"])
    p61.start_rehearsal("Four", 0, SR, [{"name": "Gtr", "channel": 1}])
    picked61 = p61.set_next_take_name("Palyn")
    ok("the old name typed for the next take is the song it went to",
       picked61["next_take_name"] == "Pałyn" and picked61["next_take_go"] == 6)
    ok("forgetting it", p61.forget_song_name("palyn") == {"ok": True})
    again61 = p61.set_next_take_name("Palyn")
    ok("typed again, it is a new song",
       again61["next_take_name"] == "Palyn" and again61["next_take_go"] == 1)
    ok("a name no song was called is not forgotten",
       p61.forget_song_name("Palyn") == {"ok": False, "error": "No song was called Palyn"})
    p61.finish_rehearsal()

    print("\n[62] Song sets")
    # A set is picked beside Start rehearsal: its first song is the first
    # take, the rehearsal keeps a copy of it, and History says it.
    tmp62 = Path(tempfile.mkdtemp())
    _, p62 = fresh_api(tmp62)
    tracks62 = [{"name": "Gtr", "channel": 1}]
    ok("there are no sets to begin with", p62.list_sets() == [])
    r62 = p62.add_set("Gig", ["Polyn", "Vesna", "Novaja"])
    ok("a set is made and every set comes back",
       r62.get("ok") is True and [st["name"] for st in r62["sets"]] == ["Gig"]
       and [x["title"] for x in r62["sets"][0]["songs"]] == ["Polyn", "Vesna", "Novaja"])
    gig62 = r62["sets"][0]["id"]
    ok("a taken name is refused with the reason",
       p62.add_set("GIG", []) == {"ok": False, "error": "There is already a set called Gig"})
    ok("an empty name is refused", p62.add_set(" ", [])["ok"] is False)
    ok("a set is renamed",
       p62.update_set(gig62, name="Gig on the 25th")["sets"][0]["name"] == "Gig on the 25th")
    other62 = p62.add_set("Spare", [])["sets"][1]["id"]
    ok("a set that is not there is refused",
       p62.update_set(999, name="x") == {"ok": False, "error": "Set not found"})

    ok("no set is picked to begin with", p62.get_settings()["next_set"] is None)
    ok("picking one is kept", p62.save_next_set(gig62) == {"ok": True}
       and p62.get_settings()["next_set"] == gig62 and p62._config.get("next_set") == gig62)
    p62.save_next_set(other62)
    p62.delete_set(other62)
    ok("a picked set deleted reads as none", p62.get_settings()["next_set"] is None)
    p62.save_next_set(None)
    ok("no set is kept too", p62.get_settings()["next_set"] is None)
    # Settings is where another folder is chosen when this one is gone: it
    # must open whatever the library says.
    p62.save_next_set(gig62)

    def unreadable62(*_args, **_kwargs):
        raise RuntimeError("the drive went away")

    p62._lib.set_of = p62._lib.sets = unreadable62
    try:
        answered62 = p62.get_settings()
    except Exception:
        answered62 = None
    del p62._lib.set_of, p62._lib.sets
    ok("settings still answer when the sets cannot be read, with no set picked",
       answered62 is not None and answered62["next_set"] is None)
    p62.save_next_set(None)

    p62.start_rehearsal("Played by the set", 0, SR, tracks62, set_id=gig62)
    st62 = p62.session_state()
    ok("the rehearsal says its set",
       st62["set"] == {"name": "Gig on the 25th", "songs": [
           {"title": "Polyn", "new": True}, {"title": "Vesna", "new": True},
           {"title": "Novaja", "new": True}]})
    ok("the first take is the set's first song",
       st62["next_take_name"] == "Polyn" and st62["next_take_go"] == 1)
    live62 = Path(p62._session["folder"])

    def keep62(number, name):
        p62._session["take_counter"] = number
        d = live62 / "_drafts" / f"take {number}"
        write_wav(d / "Gtr.wav", 100, seconds=1.0)
        return p62.keep_take(number, str(d), name, 1.0,
                             [{"name": "Gtr", "file": str(d / "Gtr.wav")}])

    keep62(1, "Vesna")
    ok("after a take the next take follows it, set or no set",
       p62.session_state()["next_take_name"] == "Vesna")
    ok("a song of the set played is no longer new",
       p62.session_state()["set"]["songs"][1] == {"title": "Vesna", "new": False})
    p62.update_set(gig62, name="Changed", songs=["Doroga"])
    ok("changing the set later leaves the rehearsal's copy",
       p62.session_state()["set"]["name"] == "Gig on the 25th")
    ok("the last go at a song, asked by name",
       p62.last_attempt("vesna") == {"song": "Vesna", "duration_sec": 1.0})
    ok("none for a take with no song", p62.last_attempt("Take 3") is None)
    ok("none for a song never played", p62.last_attempt("Novaja") is None)
    folder62 = p62._session["folder"]
    p62.finish_rehearsal()

    listed62 = {r["name"]: r.get("set_name") for r in p62.list_rehearsals()}
    ok("History's list says the set", listed62.get("Played by the set") == "Gig on the 25th")
    ok("and the rehearsal itself",
       p62.get_rehearsal(str(folder62))["set"]["name"] == "Gig on the 25th")

    p62.start_rehearsal("Free", 0, SR, tracks62)
    ok("played freely, there is no set", p62.session_state()["set"] is None)
    ok("and the first take is Take 1", p62.session_state()["next_take_name"] == "Take 1")
    p62.finish_rehearsal()
    p62.start_rehearsal("Gone", 0, SR, tracks62, set_id=999)
    ok("a set that is not there starts with none", p62.session_state()["set"] is None)
    p62.finish_rehearsal()

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
