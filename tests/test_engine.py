"""
Python side, no browser: mixing, transport, disk space, crash safety,
renaming, take naming and draft recovery.

There is no sound card in the checking environment, so no stream is opened —
the renderer is called directly and the samples themselves are inspected.
"""

import json
import logging
import re
import struct
import sys
import tempfile
import time
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
    last = None  # the newest one, for a check that asks what was opened

    def __init__(self, **kw):
        self.kw = kw
        _FakeStream.opened += 1
        _FakeStream.last = self
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
# A stream with inputs and outputs: a take whose click is on the recording card.
_sd.Stream = _FakeStream
sys.modules["sounddevice"] = _sd
# No suite opens a real MIDI port. With None in sys.modules, importing the
# library raises ImportError, which midi/ports.open_system() answers as "MIDI is
# not available" — whatever is plugged into the machine running them.
sys.modules["pylibremidi"] = None
# The app's log says why it has no MIDI on every Api made, and unhandled
# that would print here each time; nothing here reads it.
logging.getLogger("rehearsal_recorder.midi.ports").addHandler(logging.NullHandler())

import numpy as np  # noqa: E402

import rehearsal_recorder.api as _api_at_start  # noqa: E402
from rehearsal_recorder.api import _is_inside  # noqa: E402
from rehearsal_recorder.audio.player import TakePlayer  # noqa: E402

SR = 48000
problems = []
# The rig's two threads stay off in every Api this suite builds, however it builds
# it: most sections never touch MIDI, and a section that does asks for them.
_api_at_start.MIDI_THREADS = False


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


def fresh_api(tmp, midi_threads=False):
    import rehearsal_recorder.api as apimod

    apimod.RECORDINGS_ROOT = tmp / "Rec"
    apimod.CONFIG_PATH = tmp / "config.json"
    # The rig's two threads stay off unless a section asks for them: most
    # sections never touch MIDI, and a section that does drives the rig itself.
    apimod.MIDI_THREADS = midi_threads
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
    p.seek(0)
    p.set_master_muted(True)
    ok("master mute silences playback", np.max(np.abs(settle(p))) == 0)
    ok("master mute preserves level and track balance", p.master == 0.5 and p.tracks[0].volume == 1.0)
    p.set_master(0.25)
    p.seek(0)
    ok("volume adjustments stay silent while muted", np.max(np.abs(settle(p))) == 0)
    p.set_master_muted(False)
    p.seek(0)
    ok("unmute restores the updated playback level", abs(int(settle(p)[:, 0].mean()) - 750) < 30)
    p.pause()
    p.set_master_muted(True)
    p.play()
    ok("muted start has no first-block burst", np.max(np.abs(p._render(256))) == 0)
    p.set_master_muted(False)
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
    # Undo and the end of its notice move a removal out of the holding folder,
    # one way or the other, so they stay there too.
    blocked = []
    acting = ("delete_rehearsal", "finish_rehearsal", "stop_take",
              "player_close", "set_recordings_dir", "undo_trash", "end_trash")
    for name in acting:
        try:
            urllib.request.urlopen(base + "api/" + name, timeout=5)
        except urllib.error.HTTPError as e:
            blocked.append(e.code)
    ok("calls that change things are not reachable over http",
       blocked == [404] * len(acting))
    ok("though each of them is there on the bridge",
       all(callable(getattr(api_s, name, None)) for name in acting))

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
    rec._seen_wall = None  # not started: no sleep to tell (see [63])
    rec._finished()  # as if the stream stopped by itself
    ok("an unrequested stop is flagged as an error", rec.error is not None)

    rec2 = AudioRecorder.__new__(AudioRecorder)
    rec2.error = None
    rec2._stopping = True
    rec2._seen_wall = None
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

    def watch_mixdown(tracks, out_path, volumes=None, progress=None, acid=None):
        asked.append(Path(out_path))
        return plain_mixdown(tracks, out_path, volumes, progress=progress, acid=acid)

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

    def die_midway(tracks, out_path, volumes=None, progress=None, acid=None):
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

    # A deletion can be undone until its notice ends (end_trash), and Undo
    # puts back a take whose copy is still there: the copy leaves with the
    # take, at that end, and not before.
    mix2 = Path(copy_of(2)[1].get("mix", ""))
    deleted2 = fc.delete_take(str(cf), 2)
    ok("a deleted take keeps its copy in the cloud while its Undo waits",
       mix2.name and mix2.exists())
    fc.end_trash(deleted2.get("undo"))
    ok("a deleted take takes its copy out of the cloud once its notice ends",
       mix2.name and not mix2.exists())
    ok("and leaves the other take's alone",
       is_file(copy_of(1)[1].get("mix")))

    listed = next(r for r in fc.list_rehearsals() if r["folder"] == str(cf))
    ok("History says how many of a rehearsal's takes are in the cloud, "
       "for the question before deleting it", listed.get("in_cloud") == 1)
    deleted = fc.delete_rehearsal(str(cf))
    ok("a deleted rehearsal keeps its copies while its Undo waits", new_sub.is_dir())
    fc.end_trash(deleted.get("undo"))
    ok("and takes them, and its emptied folder, with it once its notice ends",
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

    # Nor what waits for its Undo: a take deleted moves into the holding
    # folder, which sits beside the rehearsals too, never inside one, so the
    # rehearsal stops being charged for it at once.
    vesna16 = sized / "02 - Vesna 1"
    vesna16.mkdir()
    (vesna16 / "Gtr.wav").write_bytes(b"\0" * 7000)
    d._lib.add_take(sized, {"take_number": 2, "name": "Vesna", "duration_sec": 1.0,
                            "tracks": [{"name": "Gtr", "file": str(vesna16 / "Gtr.wav")}]})
    with_vesna = bytes_of("Sized")
    waiting16 = d.delete_take(str(sized), 2).get("undo")
    ok("what waits for its Undo is charged to nobody either",
       with_vesna - with_audio == 7000 and waiting16 is not None
       and (tmp4 / "Rec" / "_deleting" / waiting16).is_dir() and not vesna16.exists()
       and bytes_of("Sized") == with_audio)
    ok("and the holding folder is not mistaken for a rehearsal",
       "_deleting" not in {Path(r["folder"]).name for r in d.list_rehearsals()})
    d.undo_trash(waiting16)

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
       e.last_time() == {"last": None, "earlier": []})

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
    ok("the other rehearsals follow, newest first, the soundcheck included",
       [r["name"] for r in lt["earlier"]] == ["Soundcheck", "New songs", "First"]
       and lt["earlier"][0]["take_count"] == 2
       and lt["earlier"][0]["total_duration_sec"] == 305)

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
    ok("a rehearsal not on disk is still listed among the others, as missing",
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
    ok("discarding a take answers an Undo",
       gone["ok"] and isinstance(gone.get("undo"), str) and "trashed" not in gone)
    ok("it leaves the rehearsal", not draft.exists())
    ok("but it is somewhere, not gone: waiting under _deleting for its Undo",
       (e.recordings_dir / "_deleting" / str(gone.get("undo")) / "0" / "take 1"
        / "Gtr.wav").is_file())

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
    held19 = (c.recordings_dir / "_deleting" / str(res.get("undo")) / "0"
              / f"{take_dir.name} (before crop)")
    ok("the originals wait for the crop's Undo as one folder, not eight loose files",
       "trashed" not in res and "location" not in res and held19.is_dir()
       and sorted(p.name for p in held19.iterdir()) == ["Bass.wav", "Gtr.wav"]
       and all(wav_frames(p) == 4 * SR for p in held19.iterdir()))
    ok("and the take folder is left with only its tracks",
       sorted(p.name for p in take_dir.iterdir()) == ["Bass.wav", "Gtr.wav"])

    # The cloud fingerprint records the name, format, folder and balance —
    # never the length. A cropped take would go on matching it, and the
    # uncropped copy would stay in the cloud folder as the copy of record.
    c.set_cloud_dir(str(tmp7 / "Cloud"))
    c._copy_to_cloud(folder, 1, "mix")
    ok("a shared take knows where its copy is",
       bool((c.session_state()["takes"][0].get("cloud") or {}).get("mix")))
    recropped = c.crop_take(folder, 1, 0.25, 1.75)
    ok("cropping forgets a copy that is now of a different take",
       not (c.session_state()["takes"][0].get("cloud") or {}).get("mix"))
    # Its notice ends: the uncut take goes on, before anything below stands
    # in for the file system.
    c.end_trash(recropped.get("undo"))

    ok("a region shorter than a second is refused",
       not c.crop_take(folder, 1, 0.1, 0.4)["ok"])
    ok("and a folder outside the recordings directory is refused",
       not c.crop_take(str(tmp7 / "elsewhere"), 1, 0.0, 2.0)["ok"])

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

    # So is the folder where a removal waits for its Undo: a rehearsal
    # pointed there would go to the Trash with the entry it was pointed at.
    holding23 = rec13 / "_deleting"
    waiting23 = holding23 / "0123abcd" / "0" / "Old rehearsal - 2026-09-01 20-00"
    waiting23.mkdir(parents=True)
    ok("the folder where removals wait for their Undo is refused",
       g.locate_rehearsal(str(lost), str(holding23))
       == {"ok": False, "error": "That folder is where deleted things go"})
    ok("and so is anything under it",
       g.locate_rehearsal(str(lost), str(waiting23))
       == {"ok": False, "error": "That folder is where deleted things go"})
    for empty23 in (waiting23, waiting23.parent, waiting23.parent.parent, holding23):
        empty23.rmdir()

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
       vanished == {"ok": False, "error": "Take not found", "ended": []})
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
    ok("nothing saved migrates to no band, and Band as its one lineup",
       L.migrate({}) == {"tracks": [], "layouts": [], "lineup": "Band",
                         "lineups": [{"name": "Band", "tracks": [], "layouts": []}]})

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
       == [{"name": "Guitar", "channel": 3, "stereo": False, "mode": "audio"},
           {"name": "Vocals", "channel": 7, "stereo": False, "mode": "audio"}])

    # The whole point: a card nobody has used yet keeps the band entire.
    ok("an unused card keeps everyone, counted from the first free input",
       L.for_device(band, saved, little, 2)
       == [{"name": "Guitar", "channel": 1, "stereo": False, "mode": "audio"},
           {"name": "Vocals", "channel": 2, "stereo": False, "mode": "audio"}])

    both = L.remember(saved, little, [{"name": "Guitar", "channel": 1},
                                      {"name": "Vocals", "channel": 2}])
    ok("going back to the first card brings its own numbers back",
       L.for_device(band, both, xr18, 18)
       == [{"name": "Guitar", "channel": 3, "stereo": False, "mode": "audio"},
           {"name": "Vocals", "channel": 7, "stereo": False, "mode": "audio"}])
    ok("and the other card keeps its own",
       L.for_device(band, both, little, 2)
       == [{"name": "Guitar", "channel": 1, "stereo": False, "mode": "audio"},
           {"name": "Vocals", "channel": 2, "stereo": False, "mode": "audio"}])

    print("  the band changes")
    # Somebody joins on one card. Every other card must show them too — that
    # is the whole reason the band is one list.
    grew = [{"name": "Guitar"}, {"name": "Vocals"}, {"name": "Drums"}]
    ok("a new member appears on a card that never saw them",
       L.for_device(grew, both, xr18, 18)
       == [{"name": "Guitar", "channel": 3, "stereo": False, "mode": "audio"},
           {"name": "Vocals", "channel": 7, "stereo": False, "mode": "audio"},
           {"name": "Drums", "channel": 1, "stereo": False, "mode": "audio"}])
    ok("on the lowest input nobody else is on",
       L.for_device(grew, both, little, 2)[2] == {"name": "Drums", "channel": None,
                                                  "stereo": False, "mode": "audio"})

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
       == [{"name": "Guitar", "channel": 5, "stereo": False, "mode": "audio"},
           {"name": "Vocals", "channel": 6, "stereo": False, "mode": "audio"}])

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
       == [{"name": "Gtr", "channel": 1, "stereo": False, "mode": "audio"},
           {"name": "Keys", "channel": 2, "stereo": True, "mode": "audio"}])
    ok("and the pair it takes is not offered to anybody else",
       L.for_device(band2 + [{"name": "Voc"}], [], xr18, 8)[2]["channel"] == 4)
    ok("a stereo member with no room for its second input has none",
       L.for_device([{"name": "Keys", "stereo": True}], [], xr18, 1)[0]["channel"]
       is None)
    ok("a remembered pair comes back as a pair",
       L.for_device(band2, L.remember([], xr18, [
           {"name": "Keys", "channel": 5, "stereo": True}]), xr18, 8)[1]
       == {"name": "Keys", "channel": 5, "stereo": True, "mode": "audio"})

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
       == [{"name": "Bass", "channel": 1, "stereo": False, "icon": "bass", "mode": "audio"}])
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

    # The player is shown takes, and a take keeps each track's icon (lineups
    # spec, Part 3): the band's icons draw no take.
    media = a35.take_media([{"name": "Bass", "file": str(sides / "Gtr.wav"), "icon": "bass"},
                            {"name": "Gtr", "file": str(sides / "Gtr.wav")},
                            {"name": "Keys", "file": str(sides / "nowhere.wav"), "icon": "keys"}])
    ok("the player is told each track's icon, as the take keeps it",
       [m.get("icon") for m in media] == ["bass", None, "keys"])
    ok("and none for a track the take keeps none for, though the band has one",
       "icon" not in a35.take_media([{"name": "Bass", "file": str(sides / "Gtr.wav")}])[0])

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
           nothing.get("ok") is False and "pick an interface in Audio" in (nothing.get("error") or ""))
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
       chk.status() == {"on": True, "latest": None, "download": None, "checked": False,
                       "replace": False, "install": None, "updated": None})
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
       chk.status() == {"on": False, "latest": None, "download": None, "checked": False,
                       "replace": False, "install": None, "updated": None})
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
            return None, None, None, "the folder is open in another program"
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
        for s in lt["last"]["songs"]:
            if s["name"] == name:
                return (s["plays"]["folder"], s["plays"]["take"]["take_number"])
        return None

    ok("with no star, a song's play button plays its last go, as before",
       plays54("Polyn") == (last54, 3) and plays54("Vesna") == (last54, 2))

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
    ok("the list of songs is three queries, its songs, those with no takes and their old names, however many",
       len(statements56) == 3)

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
    ok("as Settings' What gets sent says",
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
    ok("several takes are deleted, with one Undo for them all",
       gone59.get("ok") is True and gone59.get("deleted") == [2, 4]
       and isinstance(gone59.get("undo"), str) and "trashed" not in gone59)
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
    ok("forgetting it says whose it was and how it was spelt",
       p61.forget_song_name("palyn") == {"ok": True, "song_id": pałyn61, "name": "Palyn"})
    again61 = p61.set_next_take_name("Palyn")
    ok("typed again, it is a new song",
       again61["next_take_name"] == "Palyn" and again61["next_take_go"] == 1)
    ok("a name no song was called is not forgotten",
       p61.forget_song_name("Palyn") == {"ok": False, "error": "No song was called Palyn"})
    ok("brought back, it is the song's again",
       p61.remember_song_name(pałyn61, "Palyn") == {"ok": True})
    back61 = p61.set_next_take_name("Palyn")
    ok("and typed, it is the song's next go as before",
       back61["next_take_name"] == "Pałyn" and back61["next_take_go"] == 6)
    ok("a name that is a song's title now is refused, with the reason",
       p61.remember_song_name(pałyn61, "polin")
       == {"ok": False, "error": "There is already a song called Polin"})
    ok("so is one for a song that is gone",
       p61.remember_song_name(999, "Palyn") == {"ok": False, "error": "Its song is gone"})
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

    print("\n[63] Awake during a take")
    # A laptop that sleeps anyway (a closed lid, the battery) ends the take
    # where it slept: everything before kept, nothing after added, and the
    # screen told why once it wakes.
    import time as _t63

    import rehearsal_recorder.audio.capture as capmod
    from rehearsal_recorder.audio import heartbeat as hb63

    tmp63 = Path(tempfile.mkdtemp())
    one63 = [{"name": "Gtr", "channel": 1}]
    # The checks move _seen_wall back by hand; a real tick landing in between
    # would move it on again, so the tick waits out the section unless a
    # check asks for it.
    tick_was = capmod.TICK_SEC
    capmod.TICK_SEC = 3600
    block63 = np.full((256, 1), 900, dtype=np.int16)

    def recorder63(name):
        rec = capmod.AudioRecorder(0, SR, one63, tmp63 / name)
        rec.start()
        return rec

    def raw63(rec):
        rec.flush()  # written through Python's buffer until then
        return (rec.out_dir / "Gtr.raw").stat().st_size

    at63 = _t63.time() - 120
    ok("the notice says when the laptop went to sleep",
       capmod.slept_notice(at63)
       == f"The laptop went to sleep at {_t63.strftime('%H:%M', _t63.localtime(at63))}, "
          "so the take ends there. Everything up to that moment is saved.")

    told = recorder63("told")
    told._callback(block63, 256, None, None)
    told._callback(block63, 256, None, None)
    told.fell_asleep(at63)
    ok("a take told the laptop is going to sleep says so",
       told.problem() == capmod.slept_notice(at63))
    told._callback(block63, 256, None, None)
    ok("and writes nothing after it", raw63(told) == 2 * 256 * 2)
    first63 = told.stop()
    ok("so the take ends where the laptop slept",
       first63["duration_sec"] == 512 / SR)
    second63 = told.stop()
    with wave.open(first63["tracks"][0]["file"], "rb") as w63:
        frames63 = w63.getnframes()
    ok("stopping twice as the laptop wakes writes the take once",
       second63 == first63 and frames63 == 512)

    gap = recorder63("gap")
    gap._callback(block63, 256, None, None)
    gap._seen_wall -= 12
    before63 = gap._seen_wall
    gap._callback(block63, 256, None, None)
    ok("two blocks more than ten seconds apart mean the laptop slept between them",
       gap.problem() == capmod.slept_notice(before63) and raw63(gap) == 256 * 2)
    gap.stop()

    soon = recorder63("soon")
    soon._callback(block63, 256, None, None)
    soon._seen_wall -= 9
    soon._callback(block63, 256, None, None)
    ok("a block soon after the last is just a block",
       soon.problem() is None and raw63(soon) == 2 * 256 * 2)
    soon.stop()

    tick = recorder63("tick")
    tick._seen_wall -= 12
    before63 = tick._seen_wall
    tick._seen(_t63.time())
    ok("a tick after a long gap means the same",
       tick.problem() == capmod.slept_notice(before63))
    tick.stop()

    woke = recorder63("woke")
    woke._callback(block63, 256, None, None)
    woke._seen_wall -= 12
    woke._heartbeat._last -= 12
    before63 = woke._seen_wall
    ok("nothing at all since the laptop woke says it slept, not that the card went",
       woke.problem() == capmod.slept_notice(before63))
    woke.stop()

    gone = recorder63("gone")
    gone._callback(block63, 256, None, None)
    gone._heartbeat._last -= 15
    said63 = gone.problem() or ""
    ok("a card unplugged while nobody asked says the interface, not sleep",
       "interface" in said63 and "sleep" not in said63)
    gone.fell_asleep(_t63.time())
    gone._callback(block63, 256, None, None)
    ok("a card already gone stays gone",
       gone.problem() == said63 and raw63(gone) == 256 * 2)
    gone.stop()

    # A driver that ends its stream on waking (WASAPI can) says so through
    # PortAudio's finished callback, which may come before the tick or the
    # poll: a sleep must still be told as the sleep it was.
    ended = recorder63("ended")
    ended._callback(block63, 256, None, None)
    ended._seen_wall -= 60
    before63 = ended._seen_wall
    ended._finished()
    ok("a stream that ends as the laptop wakes is the sleep, not the interface",
       ended.problem() == capmod.slept_notice(before63))
    ended.stop()
    awake63 = recorder63("awake")
    awake63._callback(block63, 256, None, None)
    awake63._finished()
    ok("and one that ends while it is awake is still the interface",
       "interface stopped responding" in (awake63.problem() or ""))
    awake63.stop()

    short = recorder63("short")
    short._callback(block63, 256, None, None)
    short._seen_wall -= 4
    short._heartbeat._last -= 4
    ok("a short silence is the silent card, as today",
       short.problem() == capmod.STALLED)
    short.stop()

    capmod.TICK_SEC = 0.05
    try:
        ticking = recorder63("ticking")
        started63 = ticking._seen_wall
        _t63.sleep(0.5)
        moved63 = ticking._seen_wall > started63
        ticking.stop()
        ok("the take ticks while it records, and stops ticking with it",
           moved63 and not ticking._tick_thread.is_alive())
    finally:
        capmod.TICK_SEC = 3600
    ok("the silent-card rule is the one it was",
       hb63.SILENCE_SEC == 3.0 and capmod.SLEPT_GAP_SEC == 10.0)

    # The app holds the laptop awake from a take's start to the end of Stop.
    class Lock63:
        def __init__(self, fail=False):
            self.calls, self.fail = [], fail

        def hold(self):
            self.calls.append("hold")
            if self.fail:
                raise RuntimeError("refused")

        def release(self):
            self.calls.append("release")

    api63, a63 = fresh_api(tmp63)
    lock63 = Lock63()
    a63._awake = lock63
    a63.start_rehearsal("Late night", 0, SR, one63)
    a63.start_take()
    ok("a take that starts holds the laptop awake", lock63.calls == ["hold"])
    a63.stop_take()
    ok("and lets go once it is written", lock63.calls == ["hold", "release"])

    lock63.calls.clear()
    a63.start_take()
    broken63 = a63._recorder

    def no_disk(progress=None):
        raise OSError("the disk is full")

    broken63.stop = no_disk
    try:
        a63.stop_take()
        raised63 = False
    except OSError:
        raised63 = True
    ok("even when writing it fails",
       raised63 and lock63.calls == ["hold", "release"])
    broken63.abandon()

    class NoCard(capmod.AudioRecorder):
        def start(self):
            raise RuntimeError("no card")

    lock63.calls.clear()
    real_recorder63 = api63.AudioRecorder
    api63.AudioRecorder = NoCard
    try:
        refused63 = a63.start_take()
    finally:
        api63.AudioRecorder = real_recorder63
    ok("a take that cannot start holds nothing",
       refused63["ok"] is False and lock63.calls == [])

    a63._awake = Lock63(fail=True)
    started63 = a63.start_take()
    ok("a lock the system refuses does not stop the take",
       started63["ok"] is True and a63._recorder is not None)
    a63._awake = lock63

    a63._laptop_sleeping()
    ok("the laptop going to sleep reaches the take being recorded",
       (a63.recording_health()["error"] or "").startswith("The laptop went to sleep at "))
    a63.stop_take()
    try:
        a63._laptop_sleeping()
        quiet63 = True
    except Exception:  # noqa: BLE001
        quiet63 = False
    a63.start_take()
    ok("between takes it changes nothing",
       quiet63 and a63.recording_health()["error"] is None)

    battery_was63 = api63.battery_percent
    try:
        api63.battery_percent = lambda: 14
        ok("the health check says the charge on battery",
           a63.recording_health()["battery_percent"] == 14)
        api63.battery_percent = lambda: None
        health63 = a63.recording_health()
        ok("and none on mains",
           "battery_percent" in health63 and health63["battery_percent"] is None)

        def unreadable():
            raise OSError("no IOKit")

        api63.battery_percent = unreadable
        health63 = a63.recording_health()
        ok("a battery that cannot be read leaves the health check working",
           health63["battery_percent"] is None and "error" in health63)
    finally:
        api63.battery_percent = battery_was63

    lock63.calls.clear()
    a63.shutdown()
    ok("closing the window lets go", lock63.calls[-1:] == ["release"])
    capmod.TICK_SEC = tick_was

    print("\n[63b] A track records audio, both or MIDI")
    # The mode and the port belong to the band, as stereo and the icon do:
    # the e-kit goes with the drummer whatever interface is on the desk. A
    # MIDI track has no input, and takes none from anybody else.
    import ast

    from rehearsal_recorder import layouts
    from rehearsal_recorder.midi import rules

    print("  the band")
    port = {"name": "TD-17", "device": "TD-17", "maker": "Roland"}
    card = {"name": "Interface", "host_api": "CoreAudio"}
    ok("a member keeps its mode and port",
       layouts.band_member({"name": "Drums", "channel": 1, "icon": "drums", "mode": "both",
                            "midi_port": port})
       == {"name": "Drums", "icon": "drums", "mode": "both", "midi_port": port})
    ok("an audio member saves neither",
       layouts.band_member({"name": "Bass", "channel": 2, "mode": "audio", "midi_port": port})
       == {"name": "Bass"})
    ok("a port saved as a bare name is a port",
       layouts.band_member({"name": "K", "mode": "midi", "midi_port": "TD-17"})["midi_port"]
       == {"name": "TD-17"})
    ok("a mode nobody knows is saved as audio",
       layouts.band_member({"name": "X", "mode": "loud", "midi_port": port}) == {"name": "X"})
    ok("a Both member with no port yet saves a mode and no port",
       layouts.band_member({"name": "Drums", "mode": "both"}) == {"name": "Drums", "mode": "both"})
    ok("a port with no name is no port",
       "midi_port" not in layouts.band_member(
           {"name": "K", "mode": "midi", "midi_port": {"device": "TD-17"}}))
    placed = layouts.for_device(
        [{"name": "Keys", "mode": "midi", "midi_port": {"name": "Launchkey Mini MK3"}},
         {"name": "Bass"}], [], card, 2)
    ok("a MIDI member gets no input", placed[0]["channel"] is None and placed[0]["mode"] == "midi")
    ok("and takes none from the others", placed[1]["channel"] == 1)
    ok("an old member reads as audio", placed[1]["mode"] == "audio" and "midi_port" not in placed[1])
    ok("remember keeps no input for a MIDI member",
       "Keys" not in layouts.remember([], card, [{"name": "Keys", "channel": 3, "mode": "midi"}])[0]["inputs"])

    print("  placed on a card")
    ok("a MIDI member's port comes back with it, as a port",
       placed[0]["midi_port"] == {"name": "Launchkey Mini MK3"})
    ok("a MIDI member is not stereo, whatever the band says",
       layouts.for_device([{"name": "Keys", "stereo": True, "mode": "midi"}], [], card, 2)[0]["stereo"]
       is False)
    ok("a Both member is placed on an input like an audio one",
       layouts.for_device([{"name": "Drums", "mode": "both", "midi_port": "TD-17"}], [], card, 2)
       == [{"name": "Drums", "channel": 1, "stereo": False, "mode": "both",
            "midi_port": {"name": "TD-17"}}])
    was_audio = layouts.remember([], card, [{"name": "Keys", "channel": 1}])
    ok("a member who was on an input and is MIDI now leaves it free",
       [t["channel"] for t in layouts.for_device(
           [{"name": "Keys", "mode": "midi"}, {"name": "Bass"}], was_audio, card, 2)] == [None, 1])
    ok("and gets the input back when it records audio again",
       [t["channel"] for t in layouts.for_device(
           [{"name": "Keys", "mode": "both"}, {"name": "Bass"}], was_audio, card, 2)] == [1, 2])
    ok("an audio member's stray port is not carried",
       "midi_port" not in layouts.for_device(
           [{"name": "Bass", "mode": "audio", "midi_port": port}], [], card, 2)[0])
    ok("a band saved with a bare port name is read as a port",
       layouts.for_device([{"name": "K", "mode": "midi", "midi_port": "TD-17"}], [], card, 2)[0]["midi_port"]
       == {"name": "TD-17"})

    print("  the rules")
    ok("a track with no mode records audio", rules.mode_of({"name": "Bass"}) == "audio")
    ok("and so does one with a mode nobody knows",
       rules.mode_of({"mode": "loud"}) == "audio" and rules.mode_of({"mode": None}) == "audio"
       and rules.mode_of({"mode": ""}) == "audio")
    ok("the three modes are read as they are",
       [rules.mode_of({"mode": m}) for m in ("audio", "both", "midi")] == ["audio", "both", "midi"])
    ok("audio and Both record sound, MIDI does not",
       [rules.records_audio({"mode": m}) for m in ("audio", "both", "midi")] == [True, True, False]
       and rules.records_audio({}) is True)
    ok("Both and MIDI record notes, audio does not",
       [rules.records_notes({"mode": m}) for m in ("audio", "both", "midi")] == [False, True, True]
       and rules.records_notes({}) is False)
    ok("a port saved as a bare name is that name", rules.port_ref("TD-17") == {"name": "TD-17"})
    ok("a saved port keeps what is filled in and nothing else",
       rules.port_ref({"name": "TD-17", "device": "", "maker": "Roland", "id": None,
                       "colour": "red"}) == {"name": "TD-17", "maker": "Roland"}
       and rules.port_ref({**port, "id": "3"}) == {**port, "id": "3"})
    ok("a port with no name, or no port, is None",
       rules.port_ref({"device": "TD-17"}) is None and rules.port_ref({"name": ""}) is None
       and rules.port_ref("") is None and rules.port_ref("  ") is None
       and rules.port_ref(None) is None and rules.port_ref(5) is None
       and rules.port_ref(["TD-17"]) is None and rules.port_ref({"name": 5}) is None)
    ok("a saved port is a copy, not the dictionary it was read from",
       rules.port_ref(port) == port and rules.port_ref(port) is not port)
    ok("a track that records notes keeps the port it was given",
       rules.port_of({"mode": "both", "midi_port": "TD-17"}) == {"name": "TD-17"}
       and rules.port_of({"mode": "midi", "midi_port": port}) == port)
    ok("a track that records audio keeps none, whatever it is handed",
       rules.port_of({"mode": "audio", "midi_port": port}) is None
       and rules.port_of({"name": "Bass", "midi_port": port}) is None)
    ok("and one that records notes with no port to speak of keeps none",
       rules.port_of({"mode": "both"}) is None
       and rules.port_of({"mode": "midi", "midi_port": {"device": "TD-17"}}) is None)
    ok("the modes are stored under these words, which never change",
       (rules.AUDIO, rules.BOTH, rules.MIDI) == ("audio", "both", "midi")
       and rules.MODES == (rules.AUDIO, rules.BOTH, rules.MIDI))

    lanes = [{"name": "Gtr"}, {"name": "Keys", "mode": "midi"}, {"name": "Drums", "mode": "both"},
             {"name": "Bass"}, {"name": "Pad", "mode": "midi"}]
    heard = {"Gtr", "Drums", "Bass"}
    ok("a notes lane follows its own audio lane when it has one",
       rules.lane_after(lanes, heard, "Drums") == "Drums")
    ok("a MIDI track's lane follows the audio lane before it in the band",
       rules.lane_after(lanes, heard, "Keys") == "Gtr"
       and rules.lane_after(lanes, heard, "Pad") == "Bass")
    ok("and goes first when no audio lane is before it",
       rules.lane_after([{"name": "Keys", "mode": "midi"}, {"name": "Gtr"}], {"Gtr"}, "Keys") is None
       and rules.lane_after(lanes, set(), "Pad") is None)
    ok("an audio lane that was not recorded is not followed",
       rules.lane_after(lanes, {"Gtr", "Bass"}, "Drums") == "Gtr")
    ok("a name that is not in the band follows nobody", rules.lane_after(lanes, heard, "Nobody") is None)
    ok("a lane's place is its track's index in the band, the first at 0",
       rules.place_in(lanes, "Gtr") == {"place": 0})
    ok("and one in the middle at its own", rules.place_in(lanes, "Drums") == {"place": 2})
    ok("a name that is not in the band has no place", rules.place_in(lanes, "Nobody") == {})
    imports = {n.names[0].name if isinstance(n, ast.Import) else n.module
               for n in ast.walk(ast.parse(Path(rules.__file__).read_text(encoding="utf-8")))
               if isinstance(n, (ast.Import, ast.ImportFrom))}
    ok("the rules import neither the MIDI library nor mido",
       not imports & {"mido", "pylibremidi", "rehearsal_recorder.midi.ports"})

    print("\n[64] The recorder marks the clock")
    # A take's notes are placed on the audio's own clock (spec F1): the recorder
    # knows how many frames it has written when each block arrives, so it tells
    # the clock, and the clock does the rest.
    from rehearsal_recorder.audio.devices import input_latency
    from rehearsal_recorder.midi.clock import AudioClock

    marked_dir = tmp / "marked"
    marked_tracks = [{"name": "Gtr", "channel": 1}, {"name": "Voc", "channel": 2}]
    clock = AudioClock(SR)
    clock.latency_sec = 0.010
    keys_note = [{"file": "Keys", "port": "Launchkey Mini MK3"}]
    rec_m = AudioRecorder(0, SR, marked_tracks, marked_dir, clock=clock, notes=keys_note)
    rec_m._raw_files = {
        t["name"]: open(marked_dir / f"{t['name']}.raw", "wb") for t in marked_tracks
    }
    block = np.zeros((256, 2), dtype=np.int16)
    # The first frame of a block is as old as the block is long and the
    # interface's latency, when the driver says nothing of it.
    lag = 10_000_000 + 256 / SR * 1e9

    before = time.perf_counter_ns()
    rec_m._callback(block, 256, None, None)
    after = time.perf_counter_ns()
    one = clock.marks()
    ok("a block leaves one mark", len(one) == 1)
    ok("of its first frame", one[0][1] == 0)
    ok("at the time that frame was captured, on the clock of this process",
       before - lag <= one[0][0] <= after - lag)
    rec_m._callback(block, 256, None, None)
    ok("the next block, a moment later, is the latest and not another kept",
       [m[1] for m in clock.marks()] == [0, 256])

    # What the driver says of a block: its first frame was captured a certain time ago.
    driver = types.SimpleNamespace(currentTime=12.500, inputBufferAdcTime=12.480, outputBufferDacTime=0.0)
    before = time.perf_counter_ns()
    rec_m._callback(block, 256, driver, None)
    after = time.perf_counter_ns()
    ns, frame = clock.marks()[-1]
    ok("its word is taken: the frame was 20 ms old when the callback ran",
       frame == 512 and before - 20_000_000 - 1000 <= ns <= after - 20_000_000 + 1000)
    odd = [types.SimpleNamespace(currentTime=0.0, inputBufferAdcTime=0.0),
           types.SimpleNamespace(currentTime=5.0, inputBufferAdcTime=0.0),
           types.SimpleNamespace(currentTime=0.0, inputBufferAdcTime=5.0),
           types.SimpleNamespace(currentTime=1.0, inputBufferAdcTime=2.0),
           types.SimpleNamespace(currentTime=5.0, inputBufferAdcTime=3.0),
           types.SimpleNamespace(currentTime=float("nan"), inputBufferAdcTime=1.0),
           types.SimpleNamespace(), object()]
    stray = []
    for info in odd:
        before = time.perf_counter_ns()
        rec_m._callback(block, 256, info, None)
        after = time.perf_counter_ns()
        if not before - lag <= clock.marks()[-1][0] <= after - lag:
            stray.append(info)
    ok("a zero, a time that is not now, a missing field or no time_info are not believed", stray == [])

    # A block that is not written is not marked.
    count, last = len(clock.marks()), clock.marks()[-1]
    rec_m._callback(block, 0, None, None)
    rec_m._stopping = True
    rec_m._callback(block, 256, None, None)
    rec_m._stopping = False
    ok("a block of no frames, or one that came after Stop, is not", len(clock.marks()) == count and clock.marks()[-1] == last)
    ok("the frame of a mark is the frames written before its block",
       clock.marks()[-1][1] == rec_m._frames_written - 256)

    for _ in range(240):
        rec_m._callback(np.zeros((1024, 2), dtype=np.int16), 1024, None, None)
    ok("five seconds on, a mark a second and the latest", 5 <= len(clock.marks()) <= 8)
    ok("the latest is the last block written", clock.marks()[-1][1] == rec_m._frames_written - 1024)
    for f in rec_m._raw_files.values():
        f.close()

    # What a crashed take's folder says of its notes.
    rec_m._write_record()
    record = json.loads((marked_dir / "take.json").read_text(encoding="utf-8"))
    ok("take.json lists the notes tracks beside the audio ones",
       record["notes"] == [{"file": "Keys", "port": "Launchkey Mini MK3"}]
       and [t["file"] for t in record["tracks"]] == ["Gtr", "Voc"] and record["samplerate"] == SR)
    keys_note[0]["port"] = "Another"
    keys_note.append({"file": "Pad", "port": "Pad"})
    rec_m._write_record()
    ok("and keeps what it was given, not the list it was given",
       json.loads((marked_dir / "take.json").read_text(encoding="utf-8"))["notes"]
       == [{"file": "Keys", "port": "Launchkey Mini MK3"}])
    plain = AudioRecorder(0, SR, marked_tracks, tmp / "unmarked")
    plain._write_record()
    ok("a take with no notes lists none", json.loads((tmp / "unmarked" / "take.json").read_text(encoding="utf-8"))["notes"] == [])

    # No clock, nothing changes: the block is written as it was.
    plain._raw_files = {
        t["name"]: open(tmp / "unmarked" / f"{t['name']}.raw", "wb") for t in marked_tracks
    }
    plain._callback(block, 256, driver, None)
    for f in plain._raw_files.values():
        f.close()
    ok("with no clock a block is written all the same",
       plain._frames_written == 256 and (tmp / "unmarked" / "Gtr.raw").stat().st_size == 512)

    ok("a clock that works leaves no fault", rec_m.clock_fault is None and plain.clock_fault is None)

    # A clock that raises must not cost the audio, and must not go unsaid: the
    # first fault is kept, for the app to read at Stop.
    class _Broken:
        calls = 0

        def mark(self, *args):
            _Broken.calls += 1
            raise RuntimeError(f"clock broke {_Broken.calls}")

    rec_b = AudioRecorder(0, SR, marked_tracks, tmp / "broken", clock=_Broken())
    rec_b._raw_files = {
        t["name"]: open(tmp / "broken" / f"{t['name']}.raw", "wb") for t in marked_tracks
    }
    loud = np.full((256, 2), 1234, dtype=np.int16)
    rec_b._callback(loud, 256, None, None)
    first_fault = rec_b.clock_fault
    rec_b._callback(loud, 256, None, None)
    for f in rec_b._raw_files.values():
        f.close()
    ok("a clock that raises costs the audio nothing: both blocks are written",
       _Broken.calls == 2 and rec_b._frames_written == 512
       and (tmp / "broken" / "Gtr.raw").read_bytes() == struct.pack("<h", 1234) * 512)
    ok("and the fault is named", first_fault == "RuntimeError('clock broke 1')")
    ok("a second one leaves the first in place", rec_b.clock_fault == first_fault)

    # Starting: the clock is told when, before the stream opens, and how late the
    # stream is: what was asked for until the stream says, and then what it says.
    asked = input_latency(_sd, 0)

    class _Latent(_sd.InputStream):
        latency = 0.012

        def __init__(self, **kw):
            opened.append((started.started_ns, started.latency_sec, kw["latency"]))
            super().__init__(**kw)

    class _Vague(_sd.InputStream):
        latency = (0.01, 0.02)

    started, opened = AudioClock(SR), []
    stock = _sd.InputStream
    try:
        for kind, folder in ((_Latent, "latent"), (_Vague, "vague"), (stock, "stock")):
            _sd.InputStream = kind
            started.latency_sec = 0.5
            rec_s = AudioRecorder(0, SR, marked_tracks, tmp / folder, clock=started)
            began = time.perf_counter_ns()
            rec_s.start()
            ended = time.perf_counter_ns()
            rec_s.abandon()
            if kind is _Latent:
                ok("start() says when it began before it opens the stream",
                   len(opened) == 1 and began <= opened[0][0] <= ended)
                ok("and has the latency it asks for on the clock before the stream exists",
                   asked > 0 and opened[0][1] == asked and opened[0][2] == asked)
                ok("then takes the latency from the stream once open", started.latency_sec == 0.012)
            else:
                ok(f"a stream that gives no latency as a number leaves the one asked for ({folder})",
                   started.latency_sec == asked)
    finally:
        _sd.InputStream = stock
    ok("start() set started_ns whatever the stream", started.started_ns is not None)

    print("\n[65] A crashed take with notes")
    # A take whose app died leaves its notes as a .midraw beside the raw audio
    # (spec F3). The drafts count it as a take's recording, list it, and turn it
    # into a .mid when the take is recovered.
    from rehearsal_recorder.audio.drafts import describe as describe65
    from rehearsal_recorder.audio.drafts import draft_dirs as draft_dirs65
    from rehearsal_recorder.audio.drafts import finalize as finalize65
    from rehearsal_recorder.audio.drafts import has_audio as has_audio65
    from rehearsal_recorder.midi.clock import save_line as save_line65
    from rehearsal_recorder.midi.smf import read_events as read_events65

    ms65, t65 = 1_000_000, 9_000_000_000
    folder65 = tmp / "notes crash"
    draft = folder65 / "_drafts" / "take 1"
    draft.mkdir(parents=True)
    (draft / "take.json").write_text(json.dumps({
        "samplerate": SR, "bit_depth": 16,
        "tracks": [{"file": "Drums", "channels": 1}],
        "notes": [{"file": "Keys", "port": "Launchkey Mini MK3"}]}), encoding="utf-8")
    ok("a draft with nothing but its record is not a take",
       not has_audio65(draft) and draft_dirs65(folder65) == [])
    (draft / "Keys.midraw").write_bytes("".join([
        f"t {t65}\n",
        "s c00a\n",                                # the program the keyboard was on
        f"n {t65 + 250 * ms65} 903c40\n",          # 60 on at a quarter second
        f"n {t65 + 500 * ms65} 803c00\n",          # and off at half
        f"n {t65 + 900 * ms65} 904040\n",          # 64 on, held when the app died
        f"n {t65 + 1500 * ms65} 904140\n",         # after the audio ended
    ]).encode("ascii"))
    ok("a draft whose only recording is notes is a take, not an empty folder",
       has_audio65(draft) and draft_dirs65(folder65) == [draft])
    info = describe65(draft, SR)
    ok("describe lists the notes beside the tracks, which are the audio alone",
       info["notes"] == ["Keys"] and info["tracks"] == [] and info["duration_sec"] == 0)
    (draft / "Drums.raw").write_bytes(struct.pack("<h", 100) * SR)
    info = describe65(draft, SR)
    ok("with audio beside it, both are listed and the length is the audio's",
       info["notes"] == ["Keys"] and info["tracks"] == ["Drums"] and abs(info["duration_sec"] - 1.0) < 1e-6)

    done = finalize65(draft, SR, 16)
    ok("finalize makes the .wav and the .mid, and lists the audio and the notes apart",
       [t["name"] for t in done["tracks"]] == ["Drums"]
       and [(n["name"], n["file"]) for n in done["notes"]] == [("Keys", str(draft / "Keys.mid"))]
       and (draft / "Keys.mid").exists() and (draft / "Drums.wav").exists())
    ok("the notes carry the port take.json named, and take.json is left, for a Recover tried again",
       done["notes"][0]["port"] == "Launchkey Mini MK3" and (draft / "take.json").exists())
    ok("nothing but the .wav, the .mid and take.json is left, and the take is as long as its audio",
       sorted(p.name for p in draft.iterdir()) == ["Drums.wav", "Keys.mid", "take.json"]
       and abs(done["duration_sec"] - 1.0) < 1e-6)
    names65, events65 = read_events65(draft / "Keys.mid")
    ok("the .mid has the names, the program at the start, the keys, and the key held at the crash let go at the end",
       names65 == {"track_name": "Keys", "device_name": "Launchkey Mini MK3"}
       and [(round(sec * 1920), data) for sec, data in events65]
       == [(0, b"\xc0\x0a"), (480, b"\x90\x3c\x40"), (960, b"\x80\x3c\x00"),
           (1728, b"\x90\x40\x40"), (1920, b"\x80\x40\x00")])

    # No audio at all, notes placed by the marks that reached the disk, and a
    # record that lists no notes: the port is called by its file.
    marks_only = folder65 / "_drafts" / "take 2"
    marks_only.mkdir(parents=True)
    (marks_only / "take.json").write_text(json.dumps({"samplerate": SR, "tracks": [], "notes": []}), encoding="utf-8")
    (marks_only / "Keys.midraw").write_bytes("".join([
        f"t {t65}\n", f"n {t65 + 600 * ms65} 903c40\n", f"n {t65 + 1100 * ms65} 803c00\n"]).encode("ascii"))
    (marks_only / "take.clock").write_bytes("".join(
        save_line65(m) for m in [(t65 + 100 * ms65, 0), (t65 + 1100 * ms65, SR)]).encode("ascii"))
    done = finalize65(marks_only, SR, 16)
    names65, events65 = read_events65(marks_only / "Keys.mid")
    ok("a draft of notes alone is recovered, with no audio and no tracks",
       done["tracks"] == [] and [n["name"] for n in done["notes"]] == ["Keys"] and done["duration_sec"] == 0)
    ok("its notes are placed by take.clock: the first frame was heard 100 ms after the take began",
       [(round(sec * 1920), data) for sec, data in events65] == [(960, b"\x90\x3c\x40"), (1920, b"\x80\x3c\x00")])
    ok("and the port is called what its file is, and take.clock is gone",
       names65["device_name"] == "Keys" and done["notes"][0]["port"] == "Keys"
       and sorted(p.name for p in marks_only.iterdir()) == ["Keys.mid", "take.json"])

    # A take with no notes is recovered as it always was.
    plain65 = folder65 / "_drafts" / "take 3"
    plain65.mkdir(parents=True)
    (plain65 / "Gtr.raw").write_bytes(struct.pack("<h", 100) * SR)
    info = describe65(plain65, SR)
    done = finalize65(plain65, SR, 16)
    ok("a draft with no notes lists none and recovers none",
       info["notes"] == [] and done["notes"] == [] and [t["name"] for t in done["tracks"]] == ["Gtr"])

    # A draft stop had already converted: .mid files and no .midraw, as when the take was
    # stopped and not kept, or the app died between two tracks. They are notes of the take as
    # they are, and recovering the draft must not leave them to be deleted with its folder.
    from rehearsal_recorder.midi.smf import write_mid as write_mid65

    stopped65 = folder65 / "_drafts" / "take 4"
    write_wav(stopped65 / "Drums.wav", 100, seconds=1.0)
    for stem, device in (("Keys", "Launchkey Mini MK3"), ("Pad", "Pad Controller")):
        write_mid65(stopped65 / f"{stem}.mid", track_name=stem, port_name=device, start=[],
                    events=[(0.5, b"\x90\x3c\x40"), (0.75, b"\x80\x3c\x00")])
    (stopped65 / "Odd.mid").write_bytes(b"not a midi file")
    (stopped65 / "take.json").write_text(json.dumps({
        "samplerate": SR, "tracks": [{"file": "Drums", "channels": 1}],
        "notes": [{"file": "Keys", "port": "Keys as take.json has it"}]}), encoding="utf-8")
    kept65 = {p.name: p.read_bytes() for p in stopped65.glob("*.mid")}
    info = describe65(stopped65, SR)
    ok("describe lists a .mid that has no .midraw among the notes", info["notes"] == ["Keys", "Odd", "Pad"]
       and info["tracks"] == ["Drums"])
    done = finalize65(stopped65, SR, 16)
    ok("finalize lists them with the audio's .wav, with the port take.json names, else the file's own, else its name",
       [(n["name"], n["port"]) for n in done["notes"]]
       == [("Keys", "Keys as take.json has it"), ("Odd", "Odd"), ("Pad", "Pad Controller")]
       and [t["name"] for t in done["tracks"]] == ["Drums"])
    ok("and does not touch them",
       {p.name: p.read_bytes() for p in stopped65.glob("*.mid")} == kept65
       and [n["file"] for n in done["notes"]] == [str(stopped65 / f"{s}.mid") for s in ("Keys", "Odd", "Pad")])

    # A conversion the app died in the middle of: the .midraw is still whole, and the .part is
    # not a take's notes, not a recording, and not kept.
    halfway65 = folder65 / "_drafts" / "take 5"
    halfway65.mkdir(parents=True)
    (halfway65 / "Keys.mid.part").write_bytes(b"MThd half a file")
    ok("a half-made .mid alone is not a recording", not has_audio65(halfway65))
    (halfway65 / "Old.mid.part").write_bytes(b"MThd")
    (halfway65 / "Keys.midraw").write_bytes(f"t {t65}\nn {t65 + 250 * ms65} 903c40\n".encode("ascii"))
    ok("with a .midraw beside it the take is the .midraw, and the .part is not one of its notes",
       has_audio65(halfway65) and describe65(halfway65, SR)["notes"] == ["Keys"])
    done = finalize65(halfway65, SR, 16)
    ok("recovering it gives one Keys.mid, made from the .midraw, and leaves no .part",
       sorted(p.name for p in halfway65.iterdir()) == ["Keys.mid"] and [n["name"] for n in done["notes"]] == ["Keys"]
       and [(round(sec * 1920), d) for sec, d in read_events65(halfway65 / "Keys.mid")[1]]
       == [(480, b"\x90\x3c\x40"), (480, b"\x80\x3c\x00")])

    # A notes file that cannot be made into a .mid is left, with the take.json that names its port, so that a
    # second go can make it; the audio is recovered all the same.
    import logging as logging65
    from rehearsal_recorder.midi import capture as capture65

    stuck65 = folder65 / "_drafts" / "take 6"
    write_wav(stuck65 / "Drums.wav", 100, seconds=1.0)
    (stuck65 / "take.json").write_text(json.dumps({
        "samplerate": SR, "tracks": [{"file": "Drums", "channels": 1}],
        "notes": [{"file": "Keys", "port": "Launchkey Mini MK3"}]}), encoding="utf-8")
    (stuck65 / "Keys.midraw").write_bytes(f"t {t65}\nn {t65 + 250 * ms65} 903c40\n".encode("ascii"))
    said65 = []
    catcher65 = logging65.Handler(level=logging65.INFO)
    catcher65.emit = said65.append
    logging65.getLogger(capture65.__name__).addHandler(catcher65)

    def refused_mid(path, **kw):
        raise OSError(28, "No space left on device")

    real_write_mid65 = capture65.write_mid
    capture65.write_mid = refused_mid
    try:
        first = finalize65(stuck65, SR, 16)
    finally:
        capture65.write_mid = real_write_mid65
    ok("a notes file that cannot be made into a .mid is left where it was, with take.json, and the audio is recovered",
       first["notes"] == [] and [t["name"] for t in first["tracks"]] == ["Drums"]
       and sorted(p.name for p in stuck65.iterdir()) == ["Drums.wav", "Keys.midraw", "take.json"] and len(said65) == 1)
    again = finalize65(stuck65, SR, 16)
    logging65.getLogger(capture65.__name__).removeHandler(catcher65)
    ok("a second go makes it, with the port take.json named",
       [(n["name"], n["port"]) for n in again["notes"]] == [("Keys", "Launchkey Mini MK3")]
       and sorted(p.name for p in stuck65.iterdir()) == ["Drums.wav", "Keys.mid", "take.json"])

    # A take whose only recording is notes that are a .mid already, as a recovery that found no
    # audio leaves it (spec Part 3: has_audio counts a .midraw or a .mid).
    made65 = folder65 / "_drafts" / "take 7"
    made65.mkdir(parents=True)
    write_mid65(made65 / "Keys.mid", track_name="Keys", port_name="Launchkey Mini MK3", start=[],
                events=[(0.5, b"\x90\x3c\x40"), (0.75, b"\x80\x3c\x00")])
    ok("a draft whose only recording is a .mid is a take, not an empty folder",
       has_audio65(made65) and made65 in draft_dirs65(folder65))
    ok("and is described by its notes", describe65(made65, SR)["notes"] == ["Keys"])

    # take.json records which track each file is: a file's name is not always its track's.
    named65 = folder65 / "_drafts" / "take 8"
    named65.mkdir(parents=True)
    (named65 / "Synth_Pad.raw").write_bytes(struct.pack("<h", 100) * SR)
    (named65 / "Synth_Pad.midraw").write_bytes(f"t {t65}\nn {t65 + 250 * ms65} 903c40\n".encode("ascii"))
    (named65 / "take.json").write_text(json.dumps({
        "samplerate": SR, "bit_depth": 16,
        "tracks": [{"file": "Synth_Pad", "name": "Synth/Pad", "channels": 1}],
        "notes": [{"file": "Synth_Pad", "name": "Synth/Pad", "port": "Launchkey Mini MK3"}]}), encoding="utf-8")
    done = finalize65(named65, SR, 16)
    ok("finalize names the audio and the notes by the track take.json records for their file",
       [(t["name"], Path(t["file"]).name) for t in done["tracks"]] == [("Synth/Pad", "Synth_Pad.wav")]
       and [(n["name"], Path(n["file"]).name, n["port"]) for n in done["notes"]]
       == [("Synth/Pad", "Synth_Pad.mid", "Launchkey Mini MK3")])
    ok("and the .mid it makes says the track's name inside, as one Stop makes does",
       read_events65(named65 / "Synth_Pad.mid")[0]["track_name"] == "Synth/Pad")

    print("\n[66] MIDI before a take")
    # The setup screen's check opens the ports of the tracks that take notes, Start
    # opens exactly what the final tracks say and keeps what the check had open,
    # and Finish and closing the app let them go. A fake port system stands in for
    # the OS; with the rig's threads off the section drains the queue itself.
    sys.path.insert(0, str(PROJECT / "tests"))
    from fake_midi import FakePortSystem as Fake66

    from rehearsal_recorder.mediaserver import POLLABLE as POLLABLE66
    from rehearsal_recorder.midi.ports import PortInfo as Port66

    import rehearsal_recorder.api as apimod66

    real_open66 = apimod66.open_midi_system
    td17 = Port66("TD-17", "TD-17", "Roland")
    lkm = Port66("Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3", "Novation")
    gtr66 = {"name": "Gtr", "channel": 1}
    drums66 = {"name": "Drums", "channel": 2, "mode": "both", "midi_port": td17.saved()}
    keys66 = {"name": "Keys", "channel": None, "mode": "midi", "midi_port": lkm.saved()}
    a1_66 = "At least one track has to record sound, so the takes can be heard."

    def api66(system, error=None, threads=False):
        apimod66.open_midi_system = lambda: (system, error)
        return fresh_api(Path(tempfile.mkdtemp()), midi_threads=threads)[1]

    def folders66(api):
        return sorted(p.name for p in api._recordings_dir.iterdir() if p.is_dir())

    def open66(fake):
        return sorted(p.info.name for p in fake.open_ports)

    def get66(api, name):
        with urllib.request.urlopen(api.ui_url + "api/" + name, timeout=5) as r:
            return json.loads(r.read().decode())

    def rescan66(api):
        # Look again, with PortAudio's private calls stood in for as the section above does.
        saved = {n: getattr(_sd, n, None) for n in ("_initialized", "_terminate", "_initialize")}
        _sd._initialized = 1
        _sd._terminate = _sd._initialize = lambda: None
        try:
            return api.rescan_devices()
        finally:
            for n, value in saved.items():
                if value is None:
                    if hasattr(_sd, n):
                        delattr(_sd, n)
                else:
                    setattr(_sd, n, value)

    def scenario66(what):
        # A scenario that breaks says so as a failed check, and the rest still run.
        def run(fn):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                ok(f"{what}: stopped by {type(e).__name__}: {e}", False)
            return fn
        return run

    import contextlib as contextlib66
    import io as io66
    import urllib.request

    @scenario66("the ports")
    def _():
        print("  the ports")
        fake = Fake66([td17, lkm])
        a = api66(fake)
        listed = a.list_midi_ports()
        ok("list_midi_ports lists the system's ports, a device's own port first",
           listed["system"] == "Fake MIDI" and listed["error"] is None
           and [p["name"] for p in listed["ports"]] == ["TD-17", "Launchkey Mini MK3 MIDI Port"])
        ok("each as it is saved, with the notes counted on it so far",
           listed["ports"][0] == {**td17.saved(), "notes": 0})
        ok("both calls the window polls are served over http",
           "list_midi_ports" in POLLABLE66 and "midi_activity" in POLLABLE66
           and get66(a, "list_midi_ports") == listed and get66(a, "midi_activity") == {})
        ok("nothing is open until a check or a rehearsal wants it", not fake.open_ports)
        hood = a.under_the_hood()["midi"]
        ok("Under the hood says the system and the ports, as the picker has them",
           hood == listed and set(hood) == {"system", "ports", "error"})
        lines = [ln for ln in a.bug_report()["text"].splitlines() if ln.startswith("MIDI:")]
        ok("and Copy details has a MIDI line for each port",
           len(lines) == 2 and "TD-17" in lines[0] and "Launchkey Mini MK3 MIDI Port" in lines[1]
           and "Roland" in lines[0] and "Fake MIDI" in lines[0])

    @scenario66("the check")
    def _():
        print("  the check")
        fake = Fake66([td17, lkm])
        a = api66(fake)
        ok("the check starts", a.start_monitor(0, SR, [gtr66, drums66]) == {"ok": True})
        ok("and opens the port of the track that takes notes, and only that",
           fake.opens == {"TD-17": 1} and open66(fake) == ["TD-17"])
        ok("the card is listened to for the tracks that record sound only",
           a._monitor is not None and [t["name"] for t in a._monitor.tracks] == ["Gtr", "Drums"])
        a._midi.drain()
        seen = a.midi_activity()
        ok("Drums is heard on its port, and Gtr, which takes no notes, is not listed",
           list(seen) == ["Drums"] and seen["Drums"]["state"] == "ok" and seen["Drums"]["connected"] is True)
        fake.send("TD-17", time.perf_counter_ns(), bytes([0x99, 38, 100]))
        a._midi.drain()
        seen = a.midi_activity()
        ok("a note played counts for the track, with its loudness",
           seen["Drums"]["notes"] == 1 and abs(seen["Drums"]["vel"] - 100 / 127) < 1e-9)
        ok("and for the port in the picker", a.list_midi_ports()["ports"][0]["notes"] == 1)
        a.stop_monitor()

        # The notes' rules stop Start, never the check: it listens to every picked port.
        fake = Fake66([td17, lkm])
        k = api66(fake)
        res = k.start_monitor(0, SR, [keys66])
        ok("a band that is all MIDI is checked: A1 stops Start, not the check",
           res == {"ok": True} and fake.opens == {lkm.name: 1})
        ok("there is no card to listen to, and the card's calls say so",
           k._monitor is None and k.monitor_levels() == {}
           and k.monitor_health() == {"checking": False, "problem": None})
        k._midi.drain()
        ok("Keys is heard on its port", k.midi_activity()["Keys"]["state"] == "ok")
        res = k.start_monitor(0, SR, [gtr66, {"name": "Drums", "channel": 2, "mode": "both"}])
        ok("a Both track with no port yet does not stop the check (P3 is Start's)",
           res == {"ok": True} and k._monitor is not None)
        res = k.start_monitor(0, SR, [gtr66, drums66, {**keys66, "midi_port": td17.saved()}])
        ok("nor do two tracks on one port (P2 is Start's)", res == {"ok": True})
        res = k.start_monitor(0, SR, [gtr66, keys66])
        ok("a MIDI track is not handed to the card: it has no input to be on",
           res == {"ok": True} and [t["name"] for t in k._monitor.tracks] == ["Gtr"])
        k.stop_monitor()
        res = k.start_monitor(0, SR, [gtr66, {"name": "Bass", "channel": 9}, drums66])
        ok("the card still refuses what does not fit it, in the card's own words",
           res["ok"] is False and "8 inputs" in res["error"] and "9" in res["error"])
        ok("and a check the card refuses opens no port", not fake.open_ports and k._monitor is None)

    @scenario66("Start")
    def _():
        print("  Start")
        fake = Fake66([td17, lkm])
        a = api66(fake)
        a.start_monitor(0, SR, [gtr66, drums66])
        held = next(iter(fake.open_ports))
        ok("stop_monitor(keep_ports=True) lets go of the card and keeps the port",
           a.stop_monitor(keep_ports=True) == {"ok": True} and a._monitor is None
           and held in fake.open_ports and not held.closed)
        res = a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        ok("Start keeps the port the check opened: it was opened once and not closed in between",
           res["ok"] and fake.opens == {"TD-17": 1} and held in fake.open_ports and not held.closed)
        a._midi.drain()
        ok("and Drums is heard", a.midi_activity()["Drums"]["state"] == "ok")

        fake = Fake66([td17, lkm])
        b = api66(fake)
        b.start_monitor(0, SR, [gtr66, drums66])
        res = b.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        ok("Start without a stop_monitor first lets go of the card and keeps the port as well",
           res["ok"] and b._monitor is None and fake.opens == {"TD-17": 1} and open66(fake) == ["TD-17"])

        fake = Fake66([td17, lkm])
        c = api66(fake)
        c.start_monitor(0, SR, [gtr66, drums66])
        c.stop_monitor()
        ok("stop_monitor() alone closes the check's ports and forgets the tracks",
           not fake.open_ports and c.midi_activity() == {} and c._monitor is None)

        # The band edited between the check and Start (Review Focus 3).
        fake = Fake66([td17, lkm])
        d = api66(fake)
        d.start_monitor(0, SR, [gtr66, drums66])
        d.stop_monitor(keep_ports=True)
        kit = {**drums66, "name": "Kit", "midi_port": lkm.saved()}
        res = d.start_rehearsal("Jam", 0, SR, [gtr66, kit])
        d._midi.drain()
        seen = d.midi_activity()
        ok("Drums renamed Kit and moved to the Launchkey: TD-17 is closed and the Launchkey is open",
           res["ok"] and open66(fake) == [lkm.name] and fake.opens == {"TD-17": 1, lkm.name: 1})
        ok("and the activity is keyed by the name the track has now",
           list(seen) == ["Kit"] and seen["Kit"]["state"] == "ok")

        # Drums set back to Audio between the check and Start: no track takes notes, so every port closes.
        fake = Fake66([td17, lkm])
        d2 = api66(fake)
        d2.start_monitor(0, SR, [gtr66, drums66])
        d2.stop_monitor(keep_ports=True)
        res = d2.start_rehearsal("Jam", 0, SR, [gtr66, {**drums66, "mode": "audio"}])
        ok("Drums set back to Audio between the check and Start: every port is closed and nothing is listened to",
           res["ok"] and not fake.open_ports and d2.midi_activity() == {})

        # The check opens a keyboard's other port to count it (P7); Start lets it go.
        daw = Port66("Launchkey Mini MK3 DAW Port", "Launchkey Mini MK3", "Novation")
        fake = Fake66([lkm, daw])
        d3 = api66(fake)
        d3.start_monitor(0, SR, [gtr66, keys66])
        counted = open66(fake)
        d3.stop_monitor(keep_ports=True)
        res = d3.start_rehearsal("Jam", 0, SR, [gtr66, keys66])
        ok("the check counts a keyboard's other port too, and Start closes it but keeps the picked one",
           counted == sorted([lkm.name, daw.name]) and res["ok"] and open66(fake) == [lkm.name]
           and fake.opens == {lkm.name: 1, daw.name: 1})

        # The notes played during the check are not the rehearsal's: Start counts from nothing.
        fake = Fake66([td17, lkm])
        d4 = api66(fake)
        d4.start_monitor(0, SR, [gtr66, drums66])
        fake.send("TD-17", time.perf_counter_ns(), bytes([0x99, 38, 100]))
        d4._midi.drain()
        heard = d4.list_midi_ports()["ports"][0]["notes"]
        d4.stop_monitor(keep_ports=True)
        d4.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        d4._midi.drain()
        seen = d4.midi_activity()
        ok("notes played during the check do not show once the rehearsal has started",
           heard == 1 and seen["Drums"]["notes"] == 0 and seen["Drums"]["vel"] == 0
           and d4.list_midi_ports()["ports"][0]["notes"] == 0)

        # A Start that fails lets the check's ports go; the audio check is stopped, so the MIDI one is over too.
        real_unique = apimod66._unique_path

        def failing_unique(path):
            raise OSError("no room for a folder")

        fake = Fake66([td17, lkm])
        d5 = api66(fake)
        d5.start_monitor(0, SR, [gtr66, drums66])
        apimod66._unique_path = failing_unique
        try:
            d5.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
            raised = False
        except OSError:
            raised = True
        finally:
            apimod66._unique_path = real_unique
        d5._midi.drain()
        ok("a Start that cannot make its folder raises, and the check's port is closed with its tracks forgotten",
           raised and d5._session is None and d5._monitor is None
           and not fake.open_ports and d5.midi_activity() == {})

        fake = Fake66([td17, lkm])
        d6 = api66(fake)
        d6.start_monitor(0, SR, [gtr66, drums66])
        real_create = d6._lib.create_rehearsal

        def failing_create(*args, **kwargs):
            raise OSError("the database refused")

        d6._lib.create_rehearsal = failing_create
        try:
            d6.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
            raised = False
        except OSError:
            raised = True
        finally:
            d6._lib.create_rehearsal = real_create
        ok("and so does one the database refuses",
           raised and d6._session is None and not fake.open_ports and d6.midi_activity() == {})

        # And when letting go of the check's ports fails as well, the error that stopped Start is the one raised.
        fake = Fake66([td17, lkm])
        d8 = api66(fake)
        d8.start_monitor(0, SR, [gtr66, drums66])

        def stuck_release():
            raise RuntimeError("a port would not close")

        d8._midi.release = stuck_release
        apimod66._unique_path = failing_unique
        said = io66.StringIO()
        try:
            with contextlib66.redirect_stdout(said):
                d8.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
            raised = None
        except Exception as e:  # noqa: BLE001
            raised = e
        finally:
            apimod66._unique_path = real_unique
        ok("a Start that cannot make its folder and cannot let go of the ports raises the folder's error",
           isinstance(raised, OSError) and "no room for a folder" in str(raised)
           and "a port would not close" in said.getvalue())

        # A rehearsal under way is not undone by a second Start that fails before it begins.
        fake = Fake66([td17, lkm])
        d7 = api66(fake)
        d7.start_rehearsal("First", 0, SR, [gtr66, drums66])
        held = next(iter(fake.open_ports))
        first = d7._session
        apimod66._unique_path = failing_unique
        try:
            d7.start_rehearsal("Second", 0, SR, [gtr66, drums66])
        except OSError:
            pass
        finally:
            apimod66._unique_path = real_unique
        ok("a second Start that fails before it begins leaves the first rehearsal and its ports as they were",
           d7._session is first and held in fake.open_ports and not held.closed
           and d7.midi_activity()["Drums"]["state"] == "ok")

        # What Start refuses, in the spec's words, before any folder is made.
        fake = Fake66([td17, lkm])
        e = api66(fake)
        before = folders66(e)
        port_less = {"name": "Keys", "channel": None, "mode": "midi"}
        refused = [
            ("A1", [keys66], a1_66),
            ("P3", [gtr66, port_less], "Keys has no MIDI port yet. Pick one, or set it to Audio."),
            ("P3, plural", [gtr66, port_less, {"name": "Synth", "channel": None, "mode": "midi"}],
             "Keys, Synth have no MIDI port yet. Pick one, or set them to Audio."),
            ("P2", [gtr66, drums66, {**keys66, "midi_port": td17.saved()}],
             "Drums and Keys both take notes from TD-17."),
        ]
        for what, band, words in refused:
            res = e.start_rehearsal("Nope", 0, SR, band)
            ok(f"Start refuses {what} in the spec's words, as the other refusals are shaped",
               res == {"ok": False, "error": words})
        ok("and none of them makes a folder, a rehearsal or a port",
           folders66(e) == before and e._session is None and not fake.open_ports
           and fake.opens == {})

        # The band as the window sends it: the tracks as they are, mode and port included.
        fake = Fake66([td17, lkm])
        f = api66(fake)
        band = [{**gtr66, "mode": "audio"}, drums66, keys66]
        res = f.start_rehearsal("Jam", 0, SR, band)
        ok("a band of audio, Both and MIDI starts, and opens a port for each that takes notes",
           res["ok"] and open66(fake) == sorted([td17.name, lkm.name]))
        tracks = f.session_state()["tracks"]
        ok("the session's tracks carry the mode and the port as given",
           [t["mode"] for t in tracks] == ["audio", "both", "midi"]
           and tracks[1]["midi_port"] == td17.saved() and tracks[2]["midi_port"] == lkm.saved()
           and "midi_port" not in tracks[0])

    @scenario66("Finish and closing")
    def _():
        print("  Finish")
        fake = Fake66([td17, lkm])
        a = api66(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66, keys66])
        a._midi.drain()
        ok("two ports are open and heard", len(fake.open_ports) == 2 and list(a.midi_activity()) == ["Drums", "Keys"])
        res = a.finish_rehearsal()
        ok("finish_rehearsal closes every port and forgets the tracks",
           res["ok"] and not fake.open_ports and a.midi_activity() == {})
        ok("the ports are still listed", len(a.list_midi_ports()["ports"]) == 2)

        # Closing the app, with the rig's own threads running.
        fake = Fake66([td17, lkm])
        t = api66(fake, threads=True)
        t.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        threads = [t._midi._writer, t._midi._watcher]
        ok("with its threads, the rig has a writer and a watcher running",
           all(th is not None and th.is_alive() for th in threads) and len(fake.open_ports) == 1)
        steps = []
        for name in ("abandon_take", "shutdown"):
            real = getattr(t._midi, name)
            setattr(t._midi, name, lambda real=real, name=name: (steps.append(name), real())[1])
        t.shutdown()
        ok("shutdown lets go of a take's notes, then stops the rig", steps[:2] == ["abandon_take", "shutdown"])
        ok("the rig's threads have stopped, its ports are closed and its system is shut",
           not any(th.is_alive() for th in threads) and not fake.open_ports and fake.inputs() == [])
        ok("and nothing is listed afterwards", t.list_midi_ports()["ports"] == [])

        # A rig that fails to let go of a take must not stop the rest of closing.
        fake = Fake66([td17, lkm])
        w = api66(fake)
        w.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        order = []
        real_shutdown, real_abandon = w._midi.shutdown, w._midi.abandon_take

        def failing_abandon():
            # The Api's call fails; the rig's own, inside its shutdown, is the real one.
            order.append("abandon_take")
            if order.count("abandon_take") == 1:
                raise RuntimeError("the take would not let go")
            real_abandon()

        w._midi.abandon_take = failing_abandon
        w._midi.shutdown = lambda: (order.append("shutdown"), real_shutdown())[1]
        said = io66.StringIO()
        with contextlib66.redirect_stdout(said):
            w.shutdown()
        ok("a take that will not be let go of does not keep the rig from closing its ports and system",
           order[:2] == ["abandon_take", "shutdown"] and not fake.open_ports and fake.inputs() == []
           and "the take would not let go" in said.getvalue())

        # And a rig that fails to release does not keep Finish from clearing up the empty folder.
        fake = Fake66([td17, lkm])
        v = api66(fake)
        v.start_rehearsal("Empty", 0, SR, [gtr66, drums66])
        folder = Path(v._session["folder"])

        def failing_release():
            raise RuntimeError("a port would not close")

        v._midi.release = failing_release
        said = io66.StringIO()
        with contextlib66.redirect_stdout(said):
            res = v.finish_rehearsal()
        ok("a port that will not close does not keep Finish from finishing: the empty folder still goes",
           res["ok"] is True and v._session is None and res["folder_removed"] is True and not folder.exists()
           and "a port would not close" in said.getvalue())

        # Nor keeps the app from closing during the check: the rig, its ports and its system are still let go.
        fake = Fake66([td17, lkm])
        u = api66(fake)
        u.start_monitor(0, SR, [gtr66, drums66])
        u._midi.release = failing_release
        said = io66.StringIO()
        try:
            with contextlib66.redirect_stdout(said):
                u.shutdown()
            closed = True
        except RuntimeError:
            closed = False
        ok("a port that will not close during the check does not keep the app from closing: the rig shuts",
           closed and not fake.open_ports and fake.inputs() == [] and "a port would not close" in said.getvalue())

    @scenario66("a rehearsal under way")
    def _():
        print("  a rehearsal under way")
        fake = Fake66([td17, lkm])
        a = api66(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        held = next(iter(fake.open_ports))
        a.stop_monitor()
        ok("stop_monitor() between takes (a screen being left) does not close the rehearsal's ports",
           held in fake.open_ports and not held.closed and list(a.midi_activity()) == ["Drums"])
        res = rescan66(a)
        ok("Look again between takes reads the ports and leaves the rehearsal's open",
           res.get("ok") is True and held in fake.open_ports and not held.closed
           and a.midi_activity()["Drums"]["state"] == "ok")
        a._recorder = types.SimpleNamespace(abandon=lambda: None)
        try:
            res = a.start_rehearsal("Other", 0, SR, [gtr66, {**drums66, "name": "Kit"}])
            ok("a take recording refuses another rehearsal, and the ports stay as they were",
               res == {"ok": False, "error": "Recording in progress"} and list(a.midi_activity()) == ["Drums"])
            res = a.start_monitor(0, SR, [gtr66, {**drums66, "name": "Kit"}])
            ok("and a check, which would have changed the tracks under the take",
               res == {"ok": False, "error": "Recording in progress"} and list(a.midi_activity()) == ["Drums"]
               and held in fake.open_ports and not held.closed)
        finally:
            a._recorder = None

    @scenario66("what counts as audio")
    def _():
        print("  audio only")
        ok("_channels_of counts the channels audio tracks write, a stereo one as two, MIDI ones as none",
           apimod66._channels_of([gtr66, {**drums66, "stereo": True}, keys66, {**keys66, "stereo": True}]) == 3)
        a = api66(None, "MIDI is not available: test")
        real_usage = apimod66.shutil.disk_usage
        apimod66.shutil.disk_usage = lambda path: types.SimpleNamespace(
            free=2 * SR * 2 * 60 * 100)  # a hundred minutes of two channels
        a._recorder = types.SimpleNamespace(error=None, problem=lambda: None, is_active=lambda: True)
        a._session = {"samplerate": SR, "bit_depth": 16, "tracks": [gtr66, drums66, keys66]}
        try:
            health = a.recording_health()
        finally:
            a._recorder = None
            apimod66.shutil.disk_usage = real_usage
        ok("while recording, the disk estimate counts the audio channels only (Keys writes none)",
           abs(health["minutes_left"] - 100) < 0.01)

    @scenario66("Copy details names the ports")
    def _():
        print("  Copy details")
        a = api66(Fake66([td17, lkm]))
        a._remember_device("device", 0)
        a._config["tracks"] = [
            {"name": "Gtr"},
            {"name": "Drums", "mode": "both", "midi_port": td17.saved()},
            {"name": "Keys", "mode": "midi", "midi_port": lkm.saved()},
            {"name": "Pad", "mode": "midi"}]
        text = a.bug_report()["text"]
        ok("a MIDI track is said by its port, a Both track by its input and its port, and no port as none",
           "Tracks: Gtr on input 1, Drums on input 2 and MIDI port TD-17, "
           "Keys on MIDI port Launchkey Mini MK3 MIDI Port, Pad on no MIDI port" in text)
        ok("and a MIDI track is not said to be on no input", "Keys on no input" not in text)
        real_tracks_for = apimod66.tracks_for

        def cannot_place(*args, **kwargs):
            raise RuntimeError("the card cannot be asked")

        apimod66.tracks_for = cannot_place
        try:
            text = a.bug_report()["text"]
        finally:
            apimod66.tracks_for = real_tracks_for
        ok("when the card cannot be asked, the inputs are unknown, not none, and the ports are still said",
           "Tracks: Gtr on an unknown input, Drums on an unknown input and MIDI port TD-17, "
           "Keys on MIDI port Launchkey Mini MK3 MIDI Port, Pad on no MIDI port" in text)

    @scenario66("no MIDI system")
    def _():
        print("  no MIDI system")
        a = api66(None, "MIDI is not available: test")
        ok("list_midi_ports says why there are none",
           a.list_midi_ports() == {"system": None, "ports": [], "error": "MIDI is not available: test"})
        ok("Under the hood says the same", a.under_the_hood()["midi"] == a.list_midi_ports())
        lines = [ln for ln in a.bug_report()["text"].splitlines() if ln.startswith("MIDI:")]
        ok("and Copy details has one MIDI line, with the reason",
           lines == ["MIDI: MIDI is not available: test"])
        ok("the check still listens to the card", a.start_monitor(0, SR, [gtr66, drums66]) == {"ok": True}
           and a._monitor is not None)
        res = a.start_monitor(0, SR, [keys66])
        ok("a check of a band that is all MIDI runs too, and Keys is not connected",
           res == {"ok": True} and a._monitor is None and a.midi_activity()["Keys"]["connected"] is False)
        a.stop_monitor()
        res = a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        a._midi.drain()
        seen = a.midi_activity()
        ok("a rehearsal with Drums on Both starts, and Drums is not connected",
           res["ok"] and seen["Drums"]["connected"] is False)
        ok("it can be finished and the app closed", a.finish_rehearsal()["ok"] and a.shutdown() is None)

        fake = Fake66([])
        e = api66(fake)
        lines = [ln for ln in e.bug_report()["text"].splitlines() if ln.startswith("MIDI:")]
        ok("a system with no ports says so in one line, and which system it is", lines == ["MIDI: no ports, Fake MIDI"])
        from rehearsal_recorder import diagnostics as diag66

        port66 = {"name": "TD-17", "device": "TD-17", "maker": "Roland", "id": "7", "notes": 0}
        ok("a port is said as it was, with its system after it",
           diag66.midi_lines({"system": "CoreMIDI", "ports": [port66], "error": None})
           == ["MIDI: TD-17 (Roland, id 7), CoreMIDI"])
        ok("no ports on Windows MIDI Services says so, and the system",
           diag66.midi_lines({"system": "Windows MIDI Services", "ports": [], "error": None})
           == ["MIDI: no ports, Windows MIDI Services"])
        ok("no system says why, as it did",
           diag66.midi_lines({"system": None, "ports": [], "error": "MIDI is not available: test"})
           == ["MIDI: MIDI is not available: test"])
        ok("and with neither a system nor a reason, only that there are no ports",
           diag66.midi_lines({"system": None, "ports": [], "error": None}) == ["MIDI: no ports"]
           and diag66.midi_lines(None) == ["MIDI: no ports"])

    @scenario66("Look again")
    def _():
        print("  Look again")
        fake = Fake66([td17])
        fake.notify = False
        a = api66(fake)
        fake.plug(lkm)
        ok("a port the system did not tell us of is not listed yet", len(a.list_midi_ports()["ports"]) == 1)
        res = rescan66(a)
        ok("Look again reads the MIDI ports too", res.get("ok") is True
           and [p["name"] for p in a.list_midi_ports()["ports"]] == ["TD-17", lkm.name])

    apimod66.open_midi_system = real_open66
    apimod66.MIDI_THREADS = False

    print("\n[67] A take with notes")
    # Start gives the card the tracks that record sound and the rig the clock, Stop
    # stops the audio and then makes the .mid files, Keep and Recover move them
    # beside the WAVs. The audio side is driven by the recorder's own callback, the
    # MIDI side by a fake port system.
    import logging as logging67

    from rehearsal_recorder.audio.capture import AudioRecorder as Recorder67
    from rehearsal_recorder.midi import capture as capture67
    from rehearsal_recorder.midi.smf import read_events as read_events67

    lkm67 = Port66("Launchkey Mini MK3", "Launchkey Mini MK3", "Novation")
    keys67 = {"name": "Keys", "channel": None, "mode": "midi", "midi_port": lkm67.saved()}
    on67, off67 = bytes([0x99, 38, 100]), bytes([0x89, 38, 0])

    said67 = []
    catcher67 = logging67.Handler(level=logging67.INFO)
    catcher67.emit = said67.append
    logging67.getLogger("rehearsal_recorder").addHandler(catcher67)

    def errors67(since=0):
        return [r for r in said67[since:] if r.levelno >= logging67.ERROR]

    def api67(system, root=None):
        apimod66.open_midi_system = lambda: (system, None)
        return fresh_api(root or Path(tempfile.mkdtemp()))[1]

    def play67(a, fake, notes=True, blocks=5, silent=False, port="TD-17", data=(on67, off67)):
        # Five blocks of 0.1 s: a note struck after the first and let go after the
        # third. Under half a second, so the clock's marks make no steep line.
        rec = a._recorder
        block = np.full((4800, rec._max_channel), 0 if silent else 900, dtype=np.int16)
        for i in range(blocks):
            rec._callback(block, 4800, None, None)
            if notes and i == 0:
                fake.send(port, time.perf_counter_ns(), data[0])
            if notes and i == 2:
                fake.send(port, time.perf_counter_ns(), data[1])

    def heard67(path):
        names, events = read_events67(path)
        return names, [data for _, data in events]

    def names67(folder):
        return sorted(p.name for p in Path(folder).iterdir())

    def refused_mid67(path, **kw):
        raise OSError(28, "No space left on device")

    import contextlib as contextlib67

    @contextlib67.contextmanager
    def refused_move67(name):
        # A move of the file called `name` fails, as Windows fails it while another
        # program holds the file open (a sharing violation); every other move goes.
        real = apimod66.shutil.move

        def move(src, dst, *args, **kw):
            if Path(src).name == name:
                raise PermissionError(13, "The process cannot access the file because it is "
                                          "being used by another process")
            return real(src, dst, *args, **kw)

        apimod66.shutil.move = move
        try:
            yield
        finally:
            apimod66.shutil.move = real

    def dirs67(folder):
        return sorted(p.name for p in Path(folder).iterdir() if p.is_dir())

    def scenario67(what):
        def run(fn):
            try:
                fn()
            except Exception as e:  # noqa: BLE001
                ok(f"{what}: stopped by {type(e).__name__}: {e}", False)
            return fn
        return run

    @scenario67("stop and keep")
    def _():
        print("  stop and keep")
        fake = Fake66([td17])  # the Launchkey is not plugged in
        a = api67(fake)
        res = a.start_rehearsal("Jam", 0, SR, [gtr66, drums66, keys67])
        folder = Path(a._session["folder"])
        spy = []
        real_begin = a._midi.begin_take
        a._midi.begin_take = lambda out_dir, anchor: (spy.append((out_dir, anchor)), real_begin(out_dir, anchor))[1]
        errors_before = len(said67)
        res = a.start_take()
        rec = a._recorder
        temp = Path(a._recorder_temp_dir)
        ok("a rehearsal of audio, Both and MIDI starts a take", res == {"ok": True, "take_number": 1})
        ok("the card is given the tracks that record sound only, and no channel arithmetic touches Keys",
           [t["name"] for t in rec.tracks] == ["Gtr", "Drums"] and rec._max_channel == 2)
        ok("the rig is begun once, on the take's folder and on the recorder's own clock, started",
           len(spy) == 1 and spy[0][0] == temp and spy[0][1] is rec._clock
           and rec._clock is not None and rec._clock.started_ns is not None)
        record = json.loads((temp / "take.json").read_text(encoding="utf-8"))
        ok("take.json names each notes track's file, track, port and icon, the one that is not plugged in too",
           record["notes"] == [{"file": "Drums", "name": "Drums", "port": "TD-17", "icon": None},
                               {"file": "Keys", "name": "Keys", "port": "Launchkey Mini MK3", "icon": None}]
           and [(t["file"], t.get("name")) for t in record["tracks"]] == [("Gtr", "Gtr"), ("Drums", "Drums")])
        play67(a, fake)
        a._midi.drain()
        ok("the notes of a port that is there are on disk as they are played, and a port that is not has no file",
           (temp / "Drums.midraw").exists() and not (temp / "Keys.midraw").exists()
           and (temp / "take.json").exists())
        health = a.recording_health()
        ok("the health check has nothing to say about the notes", health["recording"] and health["error"] is None)

        stop = a.stop_take()
        ok("Stop names the audio tracks alone",
           stop["ok"] and [t["name"] for t in stop["tracks"]] == ["Gtr", "Drums"])
        ok("and the notes, each with its port and the audio lane it follows",
           stop["notes"] == [{"name": "Drums", "file": str(temp / "Drums.mid"), "port": "TD-17",
                              "after": "Drums", "place": 1}])
        ok("and the track whose port was not there, which has no file (F5)",
           stop["notes_missing"] == [{"name": "Keys", "port": "Launchkey Mini MK3", "after": "Drums", "place": 2}])
        ok("each lane carries its track's place in the band, for the player to keep them in band order",
           [n.get("place") for n in stop["notes"]] == [1] and [n.get("place") for n in stop["notes_missing"]] == [2])
        ok("the draft holds the WAVs and the .mid and nothing else: take.json and take.clock are gone with the .midraw",
           names67(temp) == ["Drums.mid", "Drums.wav", "Gtr.wav"])
        meta, data = heard67(temp / "Drums.mid")
        ok("the .mid has the track and the port and the note, held and let go",
           meta == {"track_name": "Drums", "device_name": "TD-17"} and data == [on67, off67])
        ok("and nothing was said at ERROR on the way", errors67(errors_before) == [])
        ok("a second Stop has nothing to stop", a.stop_take() == {"ok": False, "error": "Not recording"})
        ok("and leaves the draft as it was", names67(temp) == ["Drums.mid", "Drums.wav", "Gtr.wav"])

        kept = a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                           notes=stop["notes"])
        take = kept["take"]
        there = Path(take["tracks"][0]["file"]).parent
        ok("keep_take moves the .mid into the take's folder beside the WAVs",
           kept["ok"] and names67(there) == ["Drums.mid", "Drums.wav", "Gtr.wav"])
        ok("the drafts folder is gone", not temp.exists() and not (folder / "_drafts").exists())
        ok("the kept take lists the notes lane after its audio, and the track that has none",
           take["notes"] == [{"name": "Drums", "file": str(there / "Drums.mid"), "port": "TD-17",
                              "after": "Drums", "place": 1}]
           and take["notes_missing"] == [{"name": "Keys", "port": "Launchkey Mini MK3", "after": "Drums", "place": 2}]
           and [t["name"] for t in take["tracks"]] == ["Gtr", "Drums"])
        ok("the kept take's lanes carry their tracks' places in the band too",
           [n.get("place") for n in take["notes"]] == [1] and [n.get("place") for n in take["notes_missing"]] == [2])
        ok("and the library gives it back the same", a.get_rehearsal(str(folder))["takes"][0]["notes"] == take["notes"])

        # An older interface asks for the take without its notes: the audio is saved, and Keep finds
        # the .mid Stop made in the draft itself rather than delete it with the drafts folder.
        a.start_take()
        play67(a, fake)
        stop = a.stop_take()
        kept = a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"])
        take = kept["take"]
        there2 = Path(take["tracks"][0]["file"]).parent
        ok("keep_take without notes still saves the audio",
           kept["ok"] and [t["name"] for t in take["tracks"]] == ["Gtr", "Drums"]
           and all(Path(t["file"]).exists() for t in take["tracks"]))
        ok("and keeps the .mid Stop made beside the WAVs, listed with its port and lane, Keys alone missing",
           names67(there2) == ["Drums.mid", "Drums.wav", "Gtr.wav"]
           and take["notes"] == [{"name": "Drums", "file": str(there2 / "Drums.mid"), "port": "TD-17",
                                  "after": "Drums", "place": 1}]
           and [n["name"] for n in take["notes_missing"]] == ["Keys"])

        # Discard throws the whole draft away, the notes with it.
        a.start_take()
        play67(a, fake)
        stop = a.stop_take()
        gone = a.discard_take(stop["temp_dir"])
        ok("discarding a take with notes takes its .mid with it: only the kept takes' are left in the rehearsal",
           gone["ok"] and not Path(stop["temp_dir"]).exists() and not (folder / "_drafts").exists()
           and sorted(p.parent.name for p in folder.rglob("*.mid*")) == sorted([there.name, there2.name]))
        ok("a take that was discarded used its number: the next is the one after",
           stop["take_number"] == 3 and a.start_take()["take_number"] == 4)
        a.stop_take()

    @scenario67("the stop")
    def _():
        print("  the stop")
        fake = Fake66([td17])
        a = api67(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66, keys67])

        # The notes' lanes follow the audio that the take really has.
        a.start_take()
        play67(a, fake)
        real_stop = a._recorder.stop
        recorder = a._recorder

        def without_drums(progress=None):
            done = real_stop(progress=progress)
            return {**done, "tracks": [t for t in done["tracks"] if t["name"] != "Drums"]}

        recorder.stop = without_drums
        stop = a.stop_take()
        ok("a take whose Drums audio produced no file does not anchor Drums' notes lane to it",
           [n["after"] for n in stop["notes"]] == ["Gtr"] and [n["after"] for n in stop["notes_missing"]] == ["Gtr"])

        # Two tracks of notes alone after one audio lane, the first one's port
        # not there: each carries its place, which is all that says Pads
        # stood before Synth. A .mid of a track the band does not have has none.
        lanes, gone = type(a)._note_lanes(
            [{"name": "Gtr", "channel": 1},
             {"name": "Pads", "channel": None, "mode": "midi", "midi_port": {"name": "Pad box"}},
             {"name": "Synth", "channel": None, "mode": "midi", "midi_port": {"name": "Synth port"}},
             {"name": "Bass", "channel": 2}],
            [{"name": "Gtr", "file": "Gtr.wav"}, {"name": "Bass", "file": "Bass.wav"}],
            [{"name": "Synth", "file": "Synth.mid", "port": "Synth port"},
             {"name": "Stray", "file": "Stray.mid", "port": "Elsewhere"}])
        ok("a saved and a missing lane after the same audio lane each carry their place in the band",
           [(n["name"], n["after"], n.get("place")) for n in lanes] == [("Synth", "Gtr", 2), ("Stray", None, None)]
           and gone == [{"name": "Pads", "port": "Pad box", "after": "Gtr", "place": 1}])
        ok("and a .mid whose track is not in the band has no place at all", "place" not in lanes[1])

        # A laptop that slept ends the take where it slept: the notes are as long as the audio.
        a.start_take()
        rec = a._recorder
        block = np.full((4800, 2), 900, dtype=np.int16)
        for i in range(5):
            rec._callback(block, 4800, None, None)
            if i == 0:
                fake.send("TD-17", time.perf_counter_ns(), on67)
        a._laptop_sleeping()
        rec._callback(block, 4800, None, None)
        fake.send("TD-17", time.perf_counter_ns() + 5_000_000_000, bytes([0x99, 40, 90]))
        stop = a.stop_take()
        _, data = heard67(stop["notes"][0]["file"])
        ok("the audio ends where the laptop slept, and the notes with it: the key held then is let go, the note after is not",
           abs(stop["duration_sec"] - 0.5) < 1e-6 and data == [on67, off67])

        # The audio fails to finish: the notes stay as raw files, as a crash would leave them, and the rig is not left in a take.
        a.start_take()
        play67(a, fake)
        temp = Path(a._recorder_temp_dir)

        def no_disk(progress=None):
            raise OSError("the disk is full")

        a._recorder.stop = no_disk
        try:
            a.stop_take()
            raised = False
        except OSError:
            raised = True
        ok("a take whose audio cannot be finished raises as before, and its notes stay for the drafts",
           raised and (temp / "Drums.midraw").exists() and (temp / "take.json").exists())
        ok("and the rig is no longer in that take", a._midi.end_take(1.0) == [] and a._recorder is None)

        # The notes' clock fails in the audio callback: the audio is kept, and Stop says so once, at ERROR.
        before = len(said67)
        a.start_take()
        clock = a._recorder._clock

        def broken(*args):
            raise RuntimeError("the clock broke")

        clock.mark = broken
        play67(a, fake)
        stop = a.stop_take()
        said = errors67(before)
        ok("a clock that fails costs the audio nothing and the notes still become a .mid",
           stop["ok"] and len(stop["tracks"]) == 2 and [n["name"] for n in stop["notes"]] == ["Drums"])
        ok("and Stop says so in the app's log, once, at ERROR",
           len(said) == 1 and "the clock broke" in said[0].getMessage())

        # The MIDI side fails when the take is stopped: the audio is saved all the same.
        before = len(said67)
        a.start_take()
        play67(a, fake)
        a._midi.drain()
        temp = Path(a._recorder_temp_dir)

        def boom(*args):
            raise RuntimeError("the writer broke")

        real_end = a._midi.end_take
        a._midi.end_take = boom
        stop = a.stop_take()
        a._midi.end_take = real_end
        ok("a rig that fails at Stop does not cost the take its audio",
           stop["ok"] and [t["name"] for t in stop["tracks"]] == ["Gtr", "Drums"]
           and all(Path(t["file"]).exists() for t in stop["tracks"]) and stop["notes"] == [])
        ok("both tracks that take notes are missing, and it is said at ERROR",
           [n["name"] for n in stop["notes_missing"]] == ["Drums", "Keys"] and len(errors67(before)) == 1)
        ok("the notes stay as they are for the drafts, with the record that names their ports",
           (temp / "Drums.midraw").exists() and (temp / "take.json").exists())
        a._midi.abandon_take()

        # And at Start: a rig that cannot begin leaves a take with audio and no notes.
        before = len(said67)
        real_begin = a._midi.begin_take
        a._midi.begin_take = boom
        res = a.start_take()
        a._midi.begin_take = real_begin
        play67(a, fake)
        stop = a.stop_take()
        ok("a rig that cannot begin does not stop the take: audio, no notes, said at ERROR",
           res["ok"] and stop["ok"] and len(stop["tracks"]) == 2 and stop["notes"] == []
           and [n["name"] for n in stop["notes_missing"]] == ["Drums", "Keys"] and len(errors67(before)) == 1)

    @scenario67("a port pulled")
    def _():
        print("  a port pulled")
        fake = Fake66([td17])
        a = api67(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        a.start_take()
        play67(a, fake, blocks=2, data=(on67, off67))
        fake.pull("TD-17")
        a._midi.tick()
        a._recorder._callback(np.full((4800, 2), 900, dtype=np.int16), 4800, None, None)
        health = a.recording_health()
        ok("the kit pulled mid-take: the health check has no error and the take is still recording",
           health["recording"] is True and health["error"] is None and health["active"] is True)
        play67(a, fake, notes=False, blocks=2)
        stop = a.stop_take()
        _, data = heard67(stop["notes"][0]["file"])
        ok("the take goes on, with the notes it had and the key held when it went let go",
           stop["ok"] and len(stop["tracks"]) == 2 and data == [on67, off67])

    @scenario67("notes only")
    def _():
        print("  notes on a Both track")
        fake = Fake66([td17])
        a = api67(fake)
        a.start_rehearsal("Pads", 0, SR, [drums66])
        a.start_take()
        play67(a, fake, silent=True)
        stop = a.stop_take()
        with wave.open(stop["tracks"][0]["file"], "rb") as w:
            silent = not any(w.readframes(w.getnframes()))
        kept = a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                           notes=stop["notes"])["take"]
        _, data = heard67(kept["notes"][0]["file"])
        ok("a take where only notes arrived on a Both track keeps its silent audio and its .mid",
           silent and [t["name"] for t in kept["tracks"]] == ["Drums"] and data == [on67, off67]
           and [(n["name"], n["after"]) for n in kept["notes"]] == [("Drums", "Drums")] and kept["notes_missing"] == [])

    @scenario67("a track that is MIDI only")
    def _():
        print("  a track that is MIDI only")
        fake = Fake66([td17, lkm67])
        a = api67(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, keys67])
        res = a.start_take()
        rec = a._recorder
        ok("a rehearsal of Gtr and a MIDI track starts a take: the card is given Gtr alone",
           res == {"ok": True, "take_number": 1} and [t["name"] for t in rec.tracks] == ["Gtr"]
           and rec._max_channel == 1)
        play67(a, fake, port="Launchkey Mini MK3", data=(bytes([0x90, 60, 90]), bytes([0x80, 60, 0])))
        stop = a.stop_take()
        ok("and its notes are a .mid after the audio lane before it",
           [t["name"] for t in stop["tracks"]] == ["Gtr"] and [(n["name"], n["after"]) for n in stop["notes"]]
           == [("Keys", "Gtr")] and stop["notes_missing"] == [])

        # Refused or failed before the recorder starts: no take number is used up.
        folder = Path(a._session["folder"])
        counter = a._session["take_counter"]
        band = a._session["tracks"]
        spy = []
        real_begin = a._midi.begin_take
        a._midi.begin_take = lambda *args: (spy.append(args), real_begin(*args))[1]
        a._session["tracks"] = [keys67]
        res = a.start_take()
        ok("a session with no track that records sound is refused in the rule's words, and no take number is used",
           res == {"ok": False, "error": a1_66} and a._session["take_counter"] == counter and a._recorder is None)
        a._session["tracks"] = band

        class NoCard67(Recorder67):
            def start(self):
                raise RuntimeError("no card")

        real_recorder = apimod66.AudioRecorder
        apimod66.AudioRecorder = NoCard67
        try:
            res = a.start_take()
        finally:
            apimod66.AudioRecorder = real_recorder
        ok("a card that will not open uses no take number either, and the notes were not begun",
           res["ok"] is False and a._session["take_counter"] == counter and spy == [] and a._recorder is None)
        res = a.start_take()
        ok("the next take has the number after the last one that was recorded",
           res["take_number"] == counter + 1)
        a.stop_take()
        a._midi.begin_take = real_begin
        ok("and the refusal left no folder for a take that never started",
           sorted(p.name for p in (folder / "_drafts").iterdir()) == [f"take {n}" for n in range(1, counter + 2)])

    @scenario67("a check between takes")
    def _():
        print("  a check between takes")
        fake = Fake66([td17, lkm67])
        a = api67(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        ok("the check of another band, between takes, leaves the rig on that band's ports",
           a.start_monitor(0, SR, [gtr66, keys67]) == {"ok": True} and a.stop_monitor() == {"ok": True}
           and open66(fake) == ["Launchkey Mini MK3"])
        a.start_take()
        ok("the next take puts the session's tracks back before it begins: its port is open, the check's closed",
           open66(fake) == ["TD-17"] and fake.opens == {"Launchkey Mini MK3": 1, "TD-17": 2})
        play67(a, fake)
        stop = a.stop_take()
        ok("and records the session's notes track, not the check's",
           [n["name"] for n in stop["notes"]] == ["Drums"] and stop["notes_missing"] == [])

    @scenario67("no notes")
    def _():
        print("  a take with no notes tracks")
        fake = Fake66([td17])
        a = api67(fake)
        bass67 = {"name": "Bass", "channel": 2}
        a.start_rehearsal("Jam", 0, SR, [gtr66, bass67])
        spy = []
        for name in ("use", "begin_take", "end_take"):
            real = getattr(a._midi, name)
            setattr(a._midi, name, lambda *args, real=real, name=name: (spy.append(name), real(*args))[1])
        a.start_take()
        temp = Path(a._recorder_temp_dir)
        rec = a._recorder
        record = json.loads((temp / "take.json").read_text(encoding="utf-8"))
        ok("the recorder has no clock and lists no notes, as before",
           rec._clock is None and record["notes"] == [])
        play67(a, fake, notes=False)
        stop = a.stop_take()
        ok("the rig is not asked for anything", spy == [])
        ok("the take is stopped as it always was: the WAVs alone, take.json gone",
           [t["name"] for t in stop["tracks"]] == ["Gtr", "Bass"] and names67(temp) == ["Bass.wav", "Gtr.wav"])
        ok("with no notes and none missing", stop["notes"] == [] and stop["notes_missing"] == [])

        # The recorder itself: a take with notes keeps take.json for the notes to find their ports in.
        for label, notes in (("with notes", [{"file": "Keys", "port": "Launchkey Mini MK3"}]), ("with none", [])):
            folder = tmp / ("direct67 " + label)
            direct = Recorder67(0, SR, [{"name": "Gtr", "channel": 1}], folder, notes=notes)
            direct._write_record()
            direct._raw_files = {"Gtr": open(folder / "Gtr.raw", "wb")}
            direct._callback(np.zeros((256, 1), dtype=np.int16), 256, None, None)
            direct.stop()
            ok(f"AudioRecorder.stop {label} {'leaves' if notes else 'removes'} take.json",
               (folder / "take.json").exists() == bool(notes) and (folder / "Gtr.wav").exists())

    @scenario67("R40")
    def _():
        print("  a .mid the disk refused")
        fake = Fake66([td17])
        a = api67(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66, keys67])
        folder = Path(a._session["folder"])
        before = len(said67)
        a.start_take()
        play67(a, fake)
        temp = Path(a._recorder_temp_dir)
        real_write = capture67.write_mid
        capture67.write_mid = refused_mid67
        try:
            stop = a.stop_take()
        finally:
            capture67.write_mid = real_write
        said = errors67(before)
        ok("a .mid the disk refused at Stop is said at ERROR in the app's log, by its track",
           len(said) == 1 and said[0].getMessage().startswith("Drums:"))
        ok("Stop still answers: the audio is saved, Drums is among the notes with no file",
           stop["ok"] and len(stop["tracks"]) == 2 and stop["notes"] == []
           and [n["name"] for n in stop["notes_missing"]] == ["Drums", "Keys"])
        ok("its .midraw stays in the draft with take.json and take.clock, which a later try needs",
           names67(temp) == ["Drums.midraw", "Drums.wav", "Gtr.wav", "take.clock", "take.json"])

        # The library cannot write the take: what Keep moved goes back, the leftovers too.
        def locked(*args, **kw):
            raise RuntimeError("database is locked")

        a._lib.add_take = locked
        try:
            a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                        notes=stop["notes"])
            raised = None
        except RuntimeError as e:
            raised = e
        finally:
            del a._lib.add_take
        ok("a take the library cannot write puts the .midraw, take.clock and take.json back in the draft with the WAVs",
           raised is not None and names67(temp) == ["Drums.midraw", "Drums.wav", "Gtr.wav", "take.clock", "take.json"])
        ok("and leaves no take folder and no take",
           dirs67(folder) == ["_drafts"] and a.get_rehearsal(str(folder))["takes"] == [])

        # The leftovers' own move fails: everything Keep moved before it goes back.
        with refused_move67("take.json"):
            try:
                a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                            notes=stop["notes"])
                raised = None
            except PermissionError as e:
                raised = e
        ok("a take.json that will not move puts the WAVs, the .midraw and take.clock back, and leaves no take",
           raised is not None and names67(temp) == ["Drums.midraw", "Drums.wav", "Gtr.wav", "take.clock", "take.json"]
           and dirs67(folder) == ["_drafts"] and a.get_rehearsal(str(folder))["takes"] == [])

        kept = a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                           notes=stop["notes"])
        take = kept["take"]
        there = Path(take["tracks"][0]["file"]).parent
        ok("Keep moves the .midraw, unconverted, into the take's folder with the files that make it a .mid",
           kept["ok"] and names67(there) == ["Drums.midraw", "Drums.wav", "Gtr.wav", "take.clock", "take.json"])
        ok("the take lists Drums among the notes it lacks, and the drafts folder is removed as usual",
           take["notes"] == [] and [n["name"] for n in take["notes_missing"]] == ["Drums", "Keys"]
           and not temp.exists() and not (folder / "_drafts").exists())
        made = capture67.finish_draft(there, take["duration_sec"], SR)
        ok("nothing was lost: it still becomes a .mid, with its port",
           [(n["name"], n["port"]) for n in made] == [("Drums", "TD-17")] and heard67(there / "Drums.mid")[1] == [on67, off67])
        a.shutdown()

    @scenario67("recover")
    def _():
        print("  a crash")
        fake = Fake66([td17])
        root = Path(tempfile.mkdtemp())
        a = api67(fake, root)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66, keys67])
        folder = Path(a._session["folder"])
        a.start_take()
        play67(a, fake, blocks=5)
        temp = Path(a._recorder_temp_dir)
        a.shutdown()
        ok("closing the window mid-take leaves the notes beside the audio, with the clock's marks",
           names67(temp) == ["Drums.midraw", "Drums.raw", "Gtr.raw", "take.clock", "take.json"])

        b = api67(Fake66([td17]), root)
        found = b.list_drafts()
        ok("list_drafts shows the draft with its audio and its notes",
           len(found) == 1 and found[0]["dir"] == str(temp) and found[0]["notes"] == ["Drums"]
           and found[0]["tracks"] == ["Drums", "Gtr"] and abs(found[0]["duration_sec"] - 0.5) < 1e-6)
        before = len(said67)
        res = b.recover_draft(found[0]["dir"])
        take = res["take"]
        there = Path(take["tracks"][0]["file"]).parent
        ok("recover_draft gives a take with the audio and Drums.mid, in its folder",
           res["ok"] and [t["name"] for t in take["tracks"]] == ["Drums", "Gtr"]
           and names67(there) == ["Drums.mid", "Drums.wav", "Gtr.wav"])
        ok("the notes are listed with their port and lane, and the track with no notes is missing",
           take["notes"] == [{"name": "Drums", "file": str(there / "Drums.mid"), "port": "TD-17",
                              "after": "Drums", "place": 1}]
           and take["notes_missing"] == [{"name": "Keys", "port": "Launchkey Mini MK3", "after": "Drums", "place": 2}])
        ok("the note played is in the .mid", on67 in heard67(there / "Drums.mid")[1])
        ok("nothing of the draft is left to be lost or to be found again",
           not temp.exists() and not (folder / "_drafts").exists() and b.list_drafts() == []
           and not [p for p in folder.rglob("*") if p.suffix in (".midraw", ".json", ".clock", ".raw")])
        ok("and nothing was said at ERROR", errors67(before) == [])

        # A .mid the disk refuses at recovery: moved, unconverted, with the take.
        root = Path(tempfile.mkdtemp())
        fake = Fake66([td17])
        a = api67(fake, root)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        folder = Path(a._session["folder"])
        a.start_take()
        play67(a, fake)
        temp = Path(a._recorder_temp_dir)
        a.shutdown()
        b = api67(Fake66([td17]), root)
        before = len(said67)
        real_write = capture67.write_mid
        capture67.write_mid = refused_mid67
        try:
            res = b.recover_draft(str(temp))
        finally:
            capture67.write_mid = real_write
        take = res["take"]
        there = Path(take["tracks"][0]["file"]).parent
        ok("a .mid the disk refuses at recovery is said at ERROR, and the audio is recovered",
           res["ok"] and len(errors67(before)) == 1 and [t["name"] for t in take["tracks"]] == ["Drums", "Gtr"])
        ok("its .midraw is moved into the take's folder, unconverted, and the take lists the track as missing",
           names67(there) == ["Drums.midraw", "Drums.wav", "Gtr.wav", "take.clock", "take.json"]
           and take["notes"] == [] and [n["name"] for n in take["notes_missing"]] == ["Drums"])
        ok("the drafts folder is removed as usual", not temp.exists() and not (folder / "_drafts").exists())

        # A take that was stopped and never kept: its .mid files are made, and recovery moves them.
        root = Path(tempfile.mkdtemp())
        fake = Fake66([td17])
        a = api67(fake, root)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66, keys67])
        folder = Path(a._session["folder"])
        a.start_take()
        play67(a, fake)
        stop = a.stop_take()
        temp = Path(stop["temp_dir"])
        a.shutdown()
        b = api67(Fake66([td17]), root)
        found = b.list_drafts()
        ok("a take that was stopped and not kept is a draft with its .mid listed among the notes",
           len(found) == 1 and found[0]["notes"] == ["Drums"] and found[0]["tracks"] == ["Drums", "Gtr"])
        res = b.recover_draft(found[0]["dir"])
        take = res["take"]
        there = Path(take["tracks"][0]["file"]).parent
        ok("recovering it moves the .mid Stop had made, which finalize lists with the notes",
           res["ok"] and names67(there) == ["Drums.mid", "Drums.wav", "Gtr.wav"]
           and [(n["name"], n["port"]) for n in take["notes"]] == [("Drums", "TD-17")]
           and heard67(there / "Drums.mid")[1] == [on67, off67] and not temp.exists())

        # A track whose name is not a file name: the notes are the track's, not the file's.
        fake = Fake66([lkm67, td17])
        root = Path(tempfile.mkdtemp())
        a = api67(fake, root)
        pad = {"name": "Synth/Pad", "channel": None, "mode": "midi", "midi_port": lkm67.saved()}
        a.start_rehearsal("Jam", 0, SR, [gtr66, pad])
        a.start_take()
        play67(a, fake, port="Launchkey Mini MK3", data=(bytes([0x90, 60, 90]), bytes([0x80, 60, 0])))
        temp = Path(a._recorder_temp_dir)
        a.shutdown()
        b = api67(Fake66([lkm67]), root)
        found = b.list_drafts()
        take = b.recover_draft(found[0]["dir"])["take"]
        ok("a draft's notes file Synth_Pad comes back as the track Synth/Pad, not as a track that is missing",
           found[0]["notes"] == ["Synth_Pad"] and [(n["name"], n["after"]) for n in take["notes"]] == [("Synth/Pad", "Gtr")]
           and take["notes_missing"] == [])

        # A Both track of that name: its audio and its notes come back under the one name, so the
        # notes lane follows the track's own audio, as it does for a take that was kept.
        def both_crash():
            root, fake = Path(tempfile.mkdtemp()), Fake66([lkm67])
            a = api67(fake, root)
            both = {"name": "Synth/Pad", "channel": 2, "mode": "both", "midi_port": lkm67.saved()}
            a.start_rehearsal("Jam", 0, SR, [gtr66, both])
            a.start_take()
            play67(a, fake, port="Launchkey Mini MK3", data=(bytes([0x90, 60, 90]), bytes([0x80, 60, 0])))
            temp = Path(a._recorder_temp_dir)
            a.shutdown()
            return root, temp

        root, temp = both_crash()
        record = json.loads((temp / "take.json").read_text(encoding="utf-8"))
        ok("take.json records the name of each track beside its file, audio and notes",
           [(t["file"], t.get("name")) for t in record["tracks"]] == [("Gtr", "Gtr"), ("Synth_Pad", "Synth/Pad")]
           and [(n["file"], n.get("name")) for n in record["notes"]] == [("Synth_Pad", "Synth/Pad")])
        b = api67(Fake66([lkm67]), root)
        take = b.recover_draft(str(temp))["take"]
        ok("a recovered Both track Synth/Pad has its audio and its notes under that name, the notes after its own audio",
           [t["name"] for t in take["tracks"]] == ["Gtr", "Synth/Pad"]
           and [(n["name"], n["after"]) for n in take["notes"]] == [("Synth/Pad", "Synth/Pad")]
           and take["notes_missing"] == [])
        b.shutdown()

        # A draft whose take.json names no track, as one written before it did: as it was.
        root, temp = both_crash()
        record = json.loads((temp / "take.json").read_text(encoding="utf-8"))
        for entry in record["tracks"] + record["notes"]:
            entry.pop("name", None)
        (temp / "take.json").write_text(json.dumps(record), encoding="utf-8")
        b = api67(Fake66([lkm67]), root)
        take = b.recover_draft(str(temp))["take"]
        ok("a take.json with no names: the audio and the notes are named as the band's track, Synth_Pad as Synth/Pad",
           [t["name"] for t in take["tracks"]] == ["Gtr", "Synth/Pad"]
           and [n["name"] for n in take["notes"]] == ["Synth/Pad"])
        b.shutdown()

        # Stopped and never kept: the app was closed on the review screen. Stop made the .mid files and
        # took take.json away, so the draft knows its files by their stems alone ("Keys_Pad"). The
        # audio and the notes of the Both track Keys/Pad still come back under its one name.
        root, fake = Path(tempfile.mkdtemp()), Fake66([lkm67])
        a = api67(fake, root)
        keys_pad = {"name": "Keys/Pad", "channel": 2, "mode": "both", "midi_port": lkm67.saved()}
        a.start_rehearsal("Jam", 0, SR, [gtr66, keys_pad])
        a.start_take()
        play67(a, fake, port="Launchkey Mini MK3", data=(bytes([0x90, 60, 90]), bytes([0x80, 60, 0])))
        temp = Path(a.stop_take()["temp_dir"])
        a.shutdown()
        (temp / "take.json").unlink(missing_ok=True)
        b = api67(Fake66([lkm67]), root)
        take = b.recover_draft(str(temp))["take"]
        ok("Keys/Pad stopped, not kept and recovered with no take.json: one name for its audio and its notes, "
           "the notes after its own audio",
           [t["name"] for t in take["tracks"]] == ["Gtr", "Keys/Pad"]
           and [(n["name"], n["after"]) for n in take["notes"]] == [("Keys/Pad", "Keys/Pad")]
           and take["notes_missing"] == [])
        b.shutdown()

        # "A_B" is the file of the track "A/B", and the track "A_B" has "A_B (2)": a name take.json
        # gave is not taken for a file's and named again.
        root, fake = Path(tempfile.mkdtemp()), Fake66([lkm67, td17])
        a = api67(fake, root)
        slash = {"name": "A/B", "channel": None, "mode": "midi", "midi_port": lkm67.saved()}
        under = {"name": "A_B", "channel": None, "mode": "midi", "midi_port": td17.saved()}
        a.start_rehearsal("Jam", 0, SR, [gtr66, slash, under])
        a.start_take()
        play67(a, fake)
        temp = Path(a._recorder_temp_dir)
        a.shutdown()
        b = api67(Fake66([lkm67, td17]), root)
        take = b.recover_draft(str(temp))["take"]
        ok("tracks A/B and A_B come back as themselves, from the files A_B and A_B (2)",
           sorted((n["name"], Path(n["file"]).name) for n in take["notes"])
           == [("A/B", "A_B.mid"), ("A_B", "A_B (2).mid")] and take["notes_missing"] == [])
        b.shutdown()

    @scenario67("a move that fails")
    def _():
        print("  a move that fails")
        fake = Fake66([td17])
        root = Path(tempfile.mkdtemp())
        a = api67(fake, root)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        folder = Path(a._session["folder"])
        a.start_take()
        play67(a, fake)
        stop = a.stop_take()
        temp = Path(stop["temp_dir"])

        def keep():
            try:
                a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                            notes=stop["notes"])
                return None
            except PermissionError as e:
                return e

        with refused_move67("Drums.mid"):
            raised = keep()
        ok("Keep whose .mid will not move says so", raised is not None)
        ok("and puts the WAVs it had moved back in the draft beside the .mid",
           names67(temp) == ["Drums.mid", "Drums.wav", "Gtr.wav"])
        ok("leaving no take folder and no take",
           dirs67(folder) == ["_drafts"] and a.get_rehearsal(str(folder))["takes"] == [])
        found = a.list_drafts()
        ok("the draft is still listed, with its audio and its notes",
           [(d["dir"], d["tracks"], d["notes"]) for d in found] == [(str(temp), ["Drums", "Gtr"], ["Drums"])])

        with refused_move67("Drums.wav"):
            raised = keep()
        ok("a WAV that will not move puts back the one moved before it",
           raised is not None and names67(temp) == ["Drums.mid", "Drums.wav", "Gtr.wav"] and dirs67(folder) == ["_drafts"])

        kept = a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                           notes=stop["notes"])
        there = Path(kept["take"]["tracks"][0]["file"]).parent
        ok("Keep asked again keeps it all",
           kept["ok"] and names67(there) == ["Drums.mid", "Drums.wav", "Gtr.wav"]
           and [n["name"] for n in kept["take"]["notes"]] == ["Drums"] and not temp.exists())

        # The same in Recover, after a crash.
        a.start_take()
        play67(a, fake)
        temp = Path(a._recorder_temp_dir)
        a.shutdown()
        b = api67(Fake66([td17]), root)
        with refused_move67("Drums.mid"):
            try:
                b.recover_draft(str(temp))
                raised = None
            except PermissionError as e:
                raised = e
        ok("Recover whose .mid will not move says so, and puts the audio back in the draft, take.json still there",
           raised is not None and names67(temp) == ["Drums.mid", "Drums.wav", "Gtr.wav", "take.json"])
        ok("leaving no new take folder and no new take",
           dirs67(folder) == sorted(["_drafts", there.name]) and len(b.get_rehearsal(str(folder))["takes"]) == 1)
        ok("and the draft is still listed",
           [(d["dir"], d["tracks"], d["notes"]) for d in b.list_drafts()] == [(str(temp), ["Drums", "Gtr"], ["Drums"])])
        res = b.recover_draft(str(temp))
        again = Path(res["take"]["tracks"][0]["file"]).parent
        ok("Recover asked again recovers it all",
           res["ok"] and names67(again) == ["Drums.mid", "Drums.wav", "Gtr.wav"]
           and [n["name"] for n in res["take"]["notes"]] == ["Drums"] and not temp.exists())
        b.shutdown()

    @scenario67("Keep finds the notes")
    def _():
        print("  Keep finds the notes")
        fake = Fake66([td17, lkm67])
        a = api67(fake)
        pad = {"name": "Synth/Pad", "channel": None, "mode": "midi", "midi_port": lkm67.saved()}
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66, pad])

        # Every .mid in the draft is kept, named as the tracks are.
        a.start_take()
        play67(a, fake)
        stop = a.stop_take()
        kept = a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"])
        take = kept["take"]
        there = Path(take["tracks"][0]["file"]).parent
        ok("Keep without notes keeps every .mid of the draft, the one of Synth/Pad under the track's name",
           kept["ok"] and names67(there) == ["Drums.mid", "Drums.wav", "Gtr.wav", "Synth_Pad.mid"]
           and [(n["name"], Path(n["file"]).name) for n in take["notes"]]
           == [("Drums", "Drums.mid"), ("Synth/Pad", "Synth_Pad.mid")]
           and take["notes_missing"] == [])

        # A .mid the list passed in leaves out goes along too.
        a.start_take()
        play67(a, fake)
        stop = a.stop_take()
        kept = a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                           notes=[n for n in stop["notes"] if n["name"] == "Drums"])
        take = kept["take"]
        there = Path(take["tracks"][0]["file"]).parent
        ok("a .mid the notes passed in leave out is kept and listed beside them",
           kept["ok"] and names67(there) == ["Drums.mid", "Drums.wav", "Gtr.wav", "Synth_Pad.mid"]
           and [n["name"] for n in take["notes"]] == ["Drums", "Synth/Pad"] and take["notes_missing"] == []
           and not Path(stop["temp_dir"]).exists())
        a.shutdown()

    @scenario67("a Start while Stop finishes")
    def _():
        print("  a Start while Stop finishes")
        fake = Fake66([td17])
        a = api67(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        a.start_take()
        play67(a, fake)
        first = Path(a._recorder_temp_dir)
        asked = {}

        def ask():
            return a.start_take(), a.start_monitor(0, SR, [gtr66, drums66])

        real_stop = a._recorder.stop

        def slow_stop(progress=None):
            done = real_stop(progress=progress)
            asked["audio"] = ask()
            return done

        a._recorder.stop = slow_stop
        real_end = a._midi.end_take

        def slow_end(duration_sec, *meter):
            asked["notes"] = ask()
            return real_end(duration_sec, *meter)

        a._midi.end_take = slow_end
        try:
            stop = a.stop_take()
        finally:
            a._midi.end_take = real_end
        refused = {"ok": False, "error": "Still saving the last take"}
        ok("Start and the check are refused while Stop finishes the audio", asked.get("audio") == (refused, refused))
        ok("and while it finishes the notes", asked.get("notes") == (refused, refused))
        ok("so the take keeps its own notes",
           [Path(n["file"]).parent for n in stop["notes"]] == [first] and names67(first) == ["Drums.mid", "Drums.wav", "Gtr.wav"])
        res = a.start_take()
        ok("once Stop is done, the next take starts with the next number", res == {"ok": True, "take_number": 2})
        play67(a, fake)
        stop = a.stop_take()
        ok("and has notes of its own", [n["name"] for n in stop["notes"]] == ["Drums"])

        # A Stop that fails does not leave Start refused.
        a.start_take()
        play67(a, fake)
        real_stop = a._recorder.stop

        def failing_stop(progress=None):
            real_stop(progress=progress)
            raise OSError("the disk is full")

        a._recorder.stop = failing_stop
        try:
            a.stop_take()
        except OSError:
            pass
        res = a.start_take()
        ok("a Stop that failed leaves the next Start free", res["ok"] is True)
        a.stop_take()
        a.shutdown()

    @scenario67("take.json held")
    def _():
        print("  take.json held")
        fake = Fake66([td17])
        a = api67(fake)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        a.start_take()
        play67(a, fake)
        temp = Path(a._recorder_temp_dir)
        before = len(said67)
        real_unlink = Path.unlink

        def held(self, *args, **kw):
            if self.name == "take.json":
                raise PermissionError(13, "The process cannot access the file because it is "
                                          "being used by another process")
            return real_unlink(self, *args, **kw)

        Path.unlink = held
        try:
            stop = a.stop_take()
        finally:
            Path.unlink = real_unlink
        ok("a take.json that cannot be removed does not fail Stop: the audio and the .mid are there",
           stop["ok"] and [t["name"] for t in stop["tracks"]] == ["Gtr", "Drums"]
           and [n["name"] for n in stop["notes"]] == ["Drums"]
           and names67(temp) == ["Drums.mid", "Drums.wav", "Gtr.wav", "take.json"])
        ok("and it is said at ERROR, once", len(errors67(before)) == 1)
        kept = a.keep_take(stop["take_number"], stop["temp_dir"], "", stop["duration_sec"], stop["tracks"],
                           notes=stop["notes"])
        there = Path(kept["take"]["tracks"][0]["file"]).parent
        ok("the take is kept as usual, and take.json goes with the drafts folder",
           kept["ok"] and names67(there) == ["Drums.mid", "Drums.wav", "Gtr.wav"] and not temp.exists())
        a.shutdown()

    @scenario67("notes alone")
    def _():
        print("  a draft of notes alone")
        fake = Fake66([td17])
        root = Path(tempfile.mkdtemp())
        a = api67(fake, root)
        a.start_rehearsal("Jam", 0, SR, [gtr66, drums66])
        a.start_take()
        play67(a, fake)
        temp = Path(a._recorder_temp_dir)
        a.shutdown()
        for raw in temp.glob("*.raw"):
            raw.unlink()  # the audio lost, the notes kept
        b = api67(Fake66([td17]), root)
        listed = [(d["tracks"], d["notes"]) for d in b.list_drafts()]
        res = b.recover_draft(str(temp))
        ok("a draft whose audio is lost is listed by its notes, and Recover refuses it as having no audio",
           listed == [([], ["Drums"])] and res == {"ok": False, "error": "Draft has no audio", "ended": []})
        ok("it is still listed afterwards, its notes now a .mid",
           [(d["tracks"], d["notes"]) for d in b.list_drafts()] == [([], ["Drums"])] and "Drums.mid" in names67(temp))
        b.shutdown()

    logging67.getLogger("rehearsal_recorder").removeHandler(catcher67)
    apimod66.open_midi_system = real_open66

    print("\n[68] A take's notes follow it")
    # A take's .mid files sit beside its .wav files and go wherever the take goes: its
    # folder renamed (by hand, by merging its song, or by the pass that puts names right),
    # deleted, or cropped. A take of nothing but notes has no .wav to find its folder by.
    from rehearsal_recorder.api import _carries as carries68
    from rehearsal_recorder.api import _take_dir_name as dir_name68
    from rehearsal_recorder.midi.smf import read_events as read_events68
    from rehearsal_recorder.midi.smf import write_mid as write_mid68

    tmp68 = Path(tempfile.mkdtemp())
    apimod68, a68 = fresh_api(tmp68)
    a68.start_rehearsal("Notes", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    folder68 = Path(a68._session["folder"])

    def kit68(path):
        """A kit's .mid: the hi-hat's controller, then a hit and its release each second, from 0.5 s."""
        events = [e for second in range(4)
                  for e in ((second + 0.5, b"\x99\x24\x64"), (second + 0.6, b"\x89\x24\x00"))]
        write_mid68(path, track_name=path.stem, port_name="TD-17", start=[b"\xB9\x04\x5A"], events=events)
        return {"name": path.stem, "file": str(path)}

    def make68(number, name, audio=("Gtr",), notes=("Drums",), where=None, seconds=4.0):
        """A kept take in the folder keep_take would make for it (or `where`): a .wav for each of
        `audio` and a .mid for each of `notes`, added to the library."""
        named = a68._lib.resolve_name(folder68, name, number)
        take_dir = folder68 / (where or dir_name68(number, named["name"]))
        take_dir.mkdir(parents=True, exist_ok=True)
        tracks = []
        for stem in audio:
            write_wav(take_dir / f"{stem}.wav", 1000, seconds=seconds)
            tracks.append({"name": stem, "file": str(take_dir / f"{stem}.wav")})
        mids = [kit68(take_dir / f"{stem}.mid") for stem in notes]
        return a68._lib.add_take(folder68, {
            "take_number": number, "name": name, "duration_sec": seconds, "markers": [],
            "tracks": tracks, "notes": mids})

    def kit_ticks68(path):
        return [(round(sec * 1920), data) for sec, data in read_events68(path)[1]]

    def files68(take_dir):
        return sorted(p.name for p in take_dir.iterdir())

    whole68 = kit_ticks68(make68(90, "Spare")["notes"][0]["file"])
    ok("a take as the library lists it has its .mid under notes, apart from the tracks",
       len(whole68) == 9 and a68._lib.take(folder68, 90)["notes"][0]["name"] == "Drums"
       and [t["name"] for t in a68._lib.take(folder68, 90)["tracks"]] == ["Gtr"])
    a68.delete_take(str(folder68), 90)

    # Renaming a take: the folder moves, and the .mid is listed at its new path; a .midraw
    # the disk would not turn into a .mid goes along with the folder.
    first68 = make68(1, "Polyn")
    first_dir68 = Path(first68["notes"][0]["file"]).parent
    (first_dir68 / "Keys.midraw").write_bytes(b"t 1\n")
    res = a68.rename_take(str(folder68), 1, "Vesna")
    moved_dir68 = folder68 / "01 - Vesna 1"
    ok("renaming a take moves its folder, and the take still lists Drums.mid, at the new path",
       res["ok"] and moved_dir68.is_dir() and not first_dir68.exists()
       and [(n["name"], n["file"]) for n in res["take"]["notes"]] == [("Drums", str(moved_dir68 / "Drums.mid"))]
       and [t["file"] for t in res["take"]["tracks"]] == [str(moved_dir68 / "Gtr.wav")])
    ok("the files are there, and as the library has them", all(
        Path(f["file"]).exists() for f in res["take"]["notes"] + res["take"]["tracks"])
       and a68._lib.take(folder68, 1)["notes"] == res["take"]["notes"])
    ok("an unconverted .midraw goes along with the folder",
       files68(moved_dir68) == ["Drums.mid", "Gtr.wav", "Keys.midraw"])
    ok("and the notes are as they were", kit_ticks68(moved_dir68 / "Drums.mid") == whole68)

    # A take of nothing but notes has no .wav to find its folder by.
    solo68 = make68(2, "Solo", audio=())
    solo_dir68 = Path(solo68["notes"][0]["file"]).parent
    ok("a take of nothing but notes lists no tracks", solo68["tracks"] == [] and len(solo68["notes"]) == 1)
    res = a68.rename_take(str(folder68), 2, "Pesnya")
    pesnya_dir68 = folder68 / "02 - Pesnya 1"
    ok("a take of nothing but notes is renamed too: its folder moves and its .mid is listed at the new path",
       res["ok"] and pesnya_dir68.is_dir() and not solo_dir68.exists() and res["take"]["tracks"] == []
       and [n["file"] for n in res["take"]["notes"]] == [str(pesnya_dir68 / "Drums.mid")]
       and (pesnya_dir68 / "Drums.mid").exists())
    res = a68.rename_take(str(folder68), 2, "Pesnya")
    ok("renamed to the name it has, nothing moves and the notes stay", res["ok"] and pesnya_dir68.is_dir()
       and res["take"]["notes"][0]["file"] == str(pesnya_dir68 / "Drums.mid"))

    # A record that cannot follow: the folder goes back, and the notes with it.
    real_update68 = a68._lib.update_take

    def refuse_update68(*args, **kwargs):
        raise RuntimeError("the database is locked")

    a68._lib.update_take = refuse_update68
    try:
        try:
            a68.rename_take(str(folder68), 2, "Niche")
            raised68 = False
        except RuntimeError:
            raised68 = True
    finally:
        a68._lib.update_take = real_update68
    ok("a record that cannot follow puts the folder back, and the take still opens its notes",
       raised68 and pesnya_dir68.is_dir() and not (folder68 / "02 - Niche 1").exists()
       and Path(a68._lib.take(folder68, 2)["notes"][0]["file"]).exists())

    # Merging songs: the pass that renames the folders carries the notes.
    make68(3, "Polyn")
    make68(4, "Polyn", audio=())
    make68(5, "Pałyn")

    def song68(title):
        return next(s for s in a68.list_songs()["songs"] if s["title"] == title)

    merged68 = a68.merge_songs(song68("Polyn")["id"], song68("Pałyn")["id"])
    a68._names_pass.run_queued()
    taken68 = {n: a68._lib.take(folder68, n) for n in (3, 4, 5)}
    ok("merging a song into another renames its takes' folders and each take still lists its notes there",
       merged68["ok"] and all(
           carries68(Path(t["notes"][0]["file"]).parent.name, dir_name68(n, t["name"]))
           and Path(t["notes"][0]["file"]).exists() and t["name"].startswith("Pałyn")
           for n, t in taken68.items()))
    ok("the one with audio has both, in one folder; the one of notes alone has its .mid and no audio",
       Path(taken68[3]["tracks"][0]["file"]).parent == Path(taken68[3]["notes"][0]["file"]).parent
       and taken68[4]["tracks"] == [] and Path(taken68[4]["notes"][0]["file"]).parent.name.startswith("04 - Pałyn"))
    ok("and a pass after it finds nothing left to rename", a68._names_pass.run() == 0)

    # The pass that puts names right: a folder that does not carry its take's name.
    make68(6, "Tango", where="06 - old name")
    make68(7, "Tango", audio=(), where="07 - another old name")
    ok("a take whose folder does not carry its name is out of line, notes alone or with audio",
       {n for _, n, _ in a68._names_out_of_line()} == {6, 7})
    put68 = a68._put_name_right(str(folder68), 6)
    ok("the pass puts it right and the take still lists its .mid beside its .wav",
       put68 == {"renamed": True, "error": None}
       and (folder68 / "06 - Tango 1" / "Drums.mid").exists()
       and a68._lib.take(folder68, 6)["notes"][0]["file"] == str(folder68 / "06 - Tango 1" / "Drums.mid")
       and a68._lib.take(folder68, 6)["tracks"][0]["file"] == str(folder68 / "06 - Tango 1" / "Gtr.wav"))
    put68 = a68._put_name_right(str(folder68), 7)
    ok("so does a take of nothing but notes",
       put68 == {"renamed": True, "error": None} and not (folder68 / "07 - another old name").exists()
       and a68._lib.take(folder68, 7)["notes"][0]["file"] == str(folder68 / "07 - Tango 2" / "Drums.mid")
       and (folder68 / "07 - Tango 2" / "Drums.mid").exists())
    ok("and none is left out of line", a68._names_out_of_line() == [])

    # Deleting: the folder is found through the files the take has, whichever kind.
    make68(8, "Gone wav")
    gone_dir68 = folder68 / "08 - Gone wav 1"
    (gone_dir68 / "Gtr.wav").unlink()
    (gone_dir68 / "Keys.midraw").write_bytes(b"t 1\n")
    res = a68.delete_take(str(folder68), 8)
    ok("(a guard, as it passed before: the take still names its .wav files) a take whose .wav files "
       "were deleted by hand goes with its folder, the .midraw in it, to wait for its Undo",
       res["ok"] and not gone_dir68.exists() and a68._lib.take(folder68, 8) is None
       and (a68.recordings_dir / "_deleting" / str(res.get("undo")) / "0" / gone_dir68.name
            / "Keys.midraw").is_file())
    make68(9, "Only notes", audio=())
    only_dir68 = folder68 / "09 - Only notes 1"
    res = a68.delete_take(str(folder68), 9)
    ok("a take of nothing but notes has its folder found through its notes, and trashed",
       res["ok"] and not only_dir68.exists() and a68._lib.take(folder68, 9) is None)
    make68(10, "Plain", notes=())
    plain_dir68 = folder68 / "10 - Plain 1"
    res = a68.delete_take(str(folder68), 10)
    ok("a take with no notes is deleted as it always was",
       res["ok"] and not plain_dir68.exists() and a68._lib.take(folder68, 10) is None)

    # Cropping: the .mid is cropped with the .wav, and the original goes aside with it. Drums
    # is a Both track here: a .wav and a .mid of one name.
    made68 = make68(11, "Cut", audio=("Gtr", "Drums"))
    cut_dir68 = Path(made68["notes"][0]["file"]).parent

    def leave68(take_dir):
        """What a notes file the disk would not turn into a .mid leaves in a take's folder (R40): the .midraw,
        and the clock and the record that a later try needs to make it."""
        for name in ("Keys.midraw", "take.clock", "take.json"):
            (take_dir / name).write_bytes(b"t 1\n")

    left68 = ["Keys.midraw", "take.clock", "take.json"]
    leave68(cut_dir68)

    def held68(answer, take_dir):
        """The folder of originals a crop's answer has waiting for its Undo."""
        return (a68.recordings_dir / "_deleting" / str(answer.get("undo")) / "0"
                / f"{take_dir.name} (before crop)")

    res = a68.crop_take(str(folder68), 11, 1.0, 3.0)
    ok("cropping a take crops its notes with its audio: the take is two seconds, notes and all",
       res["ok"] and abs(res["take"]["duration_sec"] - 2.0) < 0.01
       and wav_frames(cut_dir68 / "Gtr.wav") == 2 * SR and wav_frames(cut_dir68 / "Drums.wav") == 2 * SR
       and res["take"]["notes"] == made68["notes"])
    ok("the .mid has what was set before the start at tick 0, and the hits of 1.5 s and 2.5 s moved to 0.5 s and 1.5 s",
       kit_ticks68(cut_dir68 / "Drums.mid") == [
           (0, b"\xB9\x04\x5A"), (960, b"\x99\x24\x64"), (1152, b"\x89\x24\x00"),
           (2880, b"\x99\x24\x64"), (3072, b"\x89\x24\x00")])
    aside68 = held68(res, cut_dir68)
    ok("the originals, .mid and .wav, wait for the crop's Undo in the (before crop) folder together, as they were",
       aside68.is_dir() and [n for n in files68(aside68) if n not in left68] == ["Drums.mid", "Drums.wav", "Gtr.wav"]
       and kit_ticks68(aside68 / "Drums.mid") == whole68 and wav_frames(aside68 / "Gtr.wav") == 4 * SR
       and wav_frames(aside68 / "Drums.wav") == 4 * SR)
    ok("the unconverted .midraw, with its clock and its record, is aside with the originals it was timed from",
       aside68.is_dir() and files68(aside68) == ["Drums.mid", "Drums.wav", "Gtr.wav", *left68]
       and all((aside68 / name).read_bytes() == b"t 1\n" for name in left68))
    ok("and the cropped take keeps none of them, nor a .writing- file",
       files68(cut_dir68) == ["Drums.mid", "Drums.wav", "Gtr.wav"])

    # Its notice ends before anything below stands in for the file system.
    a68.end_trash(res.get("undo"))

    # A crop that stops half way leaves the take exactly as it was, every kind of file.
    leave68(cut_dir68)
    before68 = {p.name: p.read_bytes() for p in cut_dir68.iterdir()}
    beside68 = sorted(p.name for p in cut_dir68.parent.iterdir())
    real_move68, moves68 = apimod68.shutil.move, {"n": 0}

    def flaky_move68(src, dst):
        moves68["n"] += 1
        if moves68["n"] == 5:        # the clock, with the .wav files, the .mid and the .midraw aside
            raise PermissionError("the file is open in another process")
        return real_move68(src, dst)

    apimod68.shutil.move = flaky_move68
    try:
        half68 = a68.crop_take(str(folder68), 11, 0.5, 1.5)
    finally:
        apimod68.shutil.move = real_move68
    ok("a move that fails with the .wav files, the .mid and the .midraw aside puts every one of them back",
       not half68["ok"] and {p.name: p.read_bytes() for p in cut_dir68.iterdir()} == before68
       and sorted(p.name for p in cut_dir68.parent.iterdir()) == beside68)

    real_replace68 = apimod68.os.replace

    def flaky_replace68(src, dst):
        if Path(src).name == ".writing-Drums.mid":      # the last file to take its name
            raise PermissionError("the file is open in another process")
        return real_replace68(src, dst)

    apimod68.os.replace = flaky_replace68
    try:
        late68 = a68.crop_take(str(folder68), 11, 0.5, 1.5)
    finally:
        apimod68.os.replace = real_replace68
    ok("and one that fails when the new .mid takes its name puts every original and leftover back, and leaves "
       "no .writing- file",
       not late68["ok"] and {p.name: p.read_bytes() for p in cut_dir68.iterdir()} == before68
       and sorted(p.name for p in cut_dir68.parent.iterdir()) == beside68)

    (cut_dir68 / "Drums.mid").write_bytes(b"not a midi file")
    torn68 = a68.crop_take(str(folder68), 11, 0.5, 1.5)
    ok("a .mid that cannot be read costs the crop and nothing else: the .wav is as long as it was",
       not torn68["ok"] and wav_frames(cut_dir68 / "Gtr.wav") == 2 * SR
       and (cut_dir68 / "Drums.mid").read_bytes() == b"not a midi file"
       and files68(cut_dir68) == ["Drums.mid", "Drums.wav", "Gtr.wav", *left68]
       and sorted(p.name for p in cut_dir68.parent.iterdir()) == beside68)

    # A take of notes alone is cropped by its length, and the .mid is a file like any. A record with no
    # .midraw beside it is not a leftover of the kind that goes aside: it stays.
    make68(12, "Notes cut", audio=())
    notes_dir68 = folder68 / "12 - Notes cut 1"
    (notes_dir68 / "take.json").write_bytes(b"{}")
    res = a68.crop_take(str(folder68), 12, 1.0, 3.0)
    ok("a take of nothing but notes is cropped: two seconds long, its .mid cut",
       res["ok"] and abs(res["take"]["duration_sec"] - 2.0) < 0.01
       and kit_ticks68(notes_dir68 / "Drums.mid")[1:3] == [(960, b"\x99\x24\x64"), (1152, b"\x89\x24\x00")]
       and files68(notes_dir68) == ["Drums.mid", "take.json"])
    ok("a region shorter than a second is refused for notes too", not a68.crop_take(str(folder68), 12, 0.1, 0.4)["ok"])
    make68(13, "Wav gone")
    wav_gone_dir68 = folder68 / "13 - Wav gone 1"
    (wav_gone_dir68 / "Gtr.wav").unlink()
    res = a68.crop_take(str(folder68), 13, 1.0, 3.0)
    ok("a take whose .wav went is cropped by what is left of it: the notes",
       res["ok"] and files68(wav_gone_dir68) == ["Drums.mid"]
       and kit_ticks68(wav_gone_dir68 / "Drums.mid")[1:3] == [(960, b"\x99\x24\x64"), (1152, b"\x89\x24\x00")])

    # A draft on the review screen has its notes beside its audio, not yet in the library.
    draft68 = folder68 / "_drafts" / "take 14"
    write_wav(draft68 / "Gtr.wav", 1000, seconds=4.0)
    note68 = kit68(draft68 / "Drums.mid")
    pending68 = [{"name": "Gtr", "file": str(draft68 / "Gtr.wav")}]
    res = a68.crop_draft(str(draft68), pending68, 1.0, 3.0, notes=[note68])
    ok("a draft is cropped with its notes: they are answered like the tracks, at the same paths",
       res["ok"] and res["tracks"] == pending68 and res["notes"] == [note68]
       and abs(res["duration_sec"] - 2.0) < 0.01 and wav_frames(draft68 / "Gtr.wav") == 2 * SR)
    ok("the .mid is cut, with what was set before the start at tick 0",
       kit_ticks68(draft68 / "Drums.mid")[:3] == [(0, b"\xB9\x04\x5A"), (960, b"\x99\x24\x64"), (1152, b"\x89\x24\x00")]
       and files68(draft68) == ["Drums.mid", "Gtr.wav"])
    write_wav(draft68 / "Gtr.wav", 1000, seconds=4.0)
    res = a68.crop_draft(str(draft68), pending68, 1.0, 3.0)
    ok("a draft cropped with no notes given answers none, as before", res["ok"] and res["notes"] == []
       and res["tracks"] == pending68)
    draft_notes68 = folder68 / "_drafts" / "take 15"
    draft_notes68.mkdir(parents=True)
    note_only68 = kit68(draft_notes68 / "Drums.mid")
    ghost68 = {"name": "Keys", "file": str(draft_notes68 / "Keys.mid")}
    res = a68.crop_draft(str(draft_notes68), [], 1.0, 3.0, notes=[note_only68, ghost68])
    ok("a draft of nothing but notes is cropped, a note file that is not there is left out, and the length is the region's",
       res["ok"] and res["tracks"] == [] and res["notes"] == [note_only68]
       and abs(res["duration_sec"] - 2.0) < 0.01 and kit_ticks68(draft_notes68 / "Drums.mid")[1][0] == 960)
    gone_draft68 = folder68 / "_drafts" / "take 18"
    gone_draft68.mkdir(parents=True)
    ok("a draft with no files left at all is refused as it was",
       a68.crop_draft(str(gone_draft68), [], 1.0, 3.0, notes=[{"name": "Keys", "file": str(gone_draft68 / "Keys.mid")}])
       == {"ok": False, "error": "The take has no files left on disk"})
    left_draft68 = folder68 / "_drafts" / "take 16"
    write_wav(left_draft68 / "Gtr.wav", 1000, seconds=4.0)
    left_note68 = kit68(left_draft68 / "Drums.mid")
    leave68(left_draft68)
    res = a68.crop_draft(str(left_draft68), [{"name": "Gtr", "file": str(left_draft68 / "Gtr.wav")}],
                         1.0, 3.0, notes=[left_note68])
    ok("a draft's unconverted leftovers wait with its originals, and the cropped draft keeps none",
       res["ok"] and files68(left_draft68) == ["Drums.mid", "Gtr.wav"]
       and held68(res, left_draft68).is_dir()
       and files68(held68(res, left_draft68)) == ["Drums.mid", "Gtr.wav", *left68])

    # A .mid in the draft that the screen did not list (an older screen) is the draft's all the same: Keep keeps
    # it, so Crop cuts it, and the take does not keep notes that start before its audio does.
    unlisted_draft68 = folder68 / "_drafts" / "take 17"
    write_wav(unlisted_draft68 / "Gtr.wav", 1000, seconds=4.0)
    listed68 = kit68(unlisted_draft68 / "Drums.mid")
    kit68(unlisted_draft68 / "Keys.mid")
    unlisted_gtr68 = [{"name": "Gtr", "file": str(unlisted_draft68 / "Gtr.wav")}]
    res = a68.crop_draft(str(unlisted_draft68), unlisted_gtr68, 1.0, 3.0, notes=[listed68])
    ok("a .mid crop_draft was not given is cut with the audio all the same, and only the given ones are answered",
       res["ok"] and res["notes"] == [listed68] and len(kit_ticks68(unlisted_draft68 / "Drums.mid")) == 5
       and kit_ticks68(unlisted_draft68 / "Keys.mid") == kit_ticks68(unlisted_draft68 / "Drums.mid"))
    kept68 = a68.keep_take(17, str(unlisted_draft68), "Unlisted", res["duration_sec"], unlisted_gtr68,
                           notes=[listed68])
    ok("and Keep, which keeps it too, keeps it cut",
       kept68["ok"] and [n["name"] for n in kept68["take"]["notes"]] == ["Drums", "Keys"]
       and all(len(kit_ticks68(n["file"])) == 5 for n in kept68["take"]["notes"]))

    print("\n[69] Notes go to the cloud with the tracks")
    # A take's notes are .mid files beside its WAVs. The original tracks and Both copy each one as it is, under its
    # own name, never through encode (which would name it <stem>.wav); the mix has no notes in it, and mixdown is only
    # ever given the WAVs. A copy's record names the notes, so a take that has some reads as changed when its copy
    # was made without them, and a take that has none reads exactly as it always did.
    from rehearsal_recorder import cloud as cloudmod69
    from rehearsal_recorder.midi.smf import write_mid as write_mid69

    def hits69(path, notes):
        """A .mid of these notes struck 0.25 s apart on channel 10, each let go 0.1 s later."""
        events = [e for k, note in enumerate(notes)
                  for e in ((k * 0.25, bytes((0x99, note, 100))), (k * 0.25 + 0.1, bytes((0x89, note, 0))))]
        write_mid69(path, track_name=path.stem, port_name="Port", start=[], events=events)
        return str(path)

    root69 = Path(tempfile.mkdtemp())
    apimod69, a69 = fresh_api(root69)
    a69.set_cloud_dir(str(root69 / "Cloud"))
    folder69 = a69.recordings_dir / "Jam - 2026-10-09 20-00"
    a69._lib.create_rehearsal(folder69, "Jam", "2026-10-09T20:00:00", SR, 16, [
        {"name": "Drums", "channel": 1, "mode": "both", "midi_port": {"name": "TD-17"}},
        {"name": "Keys", "mode": "midi", "midi_port": {"name": "Launchkey"}},
        {"name": "Bass", "channel": 2}])
    target69 = apimod69._cloud_subfolder(a69._cloud_dir, folder69)

    def keep69(number, audio, notes):
        """A take the library keeps: these audio tracks (name: level) and these notes (name: pitches)."""
        where = folder69 / f"take {number}"
        for name, level in audio.items():
            write_wav(where / f"{name}.wav", level, seconds=2.0)
        a69._lib.add_take(folder69, {
            "take_number": number, "name": f"Take {number}", "duration_sec": 2.0, "markers": [],
            "tracks": [{"name": n, "file": str(where / f"{n}.wav")} for n in audio],
            "notes": [{"name": n, "file": hits69(where / f"{n}.mid", pitches)} for n, pitches in notes.items()]})

    asked69 = {"encode": [], "mixdown": [], "copy": []}

    def copy69(number, what, **kw):
        """_copy_to_cloud, noting what encode, mixdown and copy2 were given."""
        real = apimod69.encode, apimod69.mixdown, apimod69.shutil.copy2
        for key in asked69:
            asked69[key].clear()

        def encode69(src, *args, **kwargs):
            asked69["encode"].append(Path(src).name)
            return real[0](src, *args, **kwargs)

        def mixdown69(tracks, *args, **kwargs):
            asked69["mixdown"] += [Path(t["file"]).name for t in tracks]
            return real[1](tracks, *args, **kwargs)

        def copy2_69(src, dst, *args, **kwargs):
            asked69["copy"].append((Path(src).name, Path(dst).name))
            return real[2](src, dst, *args, **kwargs)

        apimod69.encode, apimod69.mixdown, apimod69.shutil.copy2 = encode69, mixdown69, copy2_69
        try:
            return a69._copy_to_cloud(str(folder69), number, what, **kw)
        finally:
            apimod69.encode, apimod69.mixdown, apimod69.shutil.copy2 = real

    def mids69(number):
        return {n["name"]: Path(n["file"]) for n in a69._lib.take(folder69, number)["notes"]}

    def same69(copy, source):
        """Whether `copy` is there and is byte for byte `source`."""
        return copy.is_file() and copy.read_bytes() == source.read_bytes()

    keep69(1, {"Drums": 1000, "Bass": 2000}, {"Drums": [36, 38, 42], "Keys": [60, 64]})
    keep69(2, {"Bass": 800}, {})
    a69.set_cloud_format("flac")

    print("  The original tracks")
    res = copy69(1, "tracks")
    dest69 = Path(res["cloud"]["tracks"])
    ext69 = ".flac" if res["cloud"]["tracks_format"] == "flac" else ".wav"
    ok("the take has two .mid files of its own, which differ", sorted(mids69(1)) == ["Drums", "Keys"]
       and mids69(1)["Drums"].read_bytes() != mids69(1)["Keys"].read_bytes())
    ok("each .mid is in the copy's folder under its own name, byte for byte the take's",
       res["ok"] and all(same69(dest69 / f"{n}.mid", p) for n, p in mids69(1).items()))
    ok("and nothing was made of them as audio: Keys has no sound, Drums has its one",
       sorted(f.name for f in dest69.iterdir()) == sorted([f"Bass{ext69}", f"Drums{ext69}", "Drums.mid", "Keys.mid"]))
    ok("encode was given the two audio tracks and never a .mid",
       len(asked69["encode"]) == 2 and not any(n.endswith(".mid") for n in asked69["encode"]))
    ok("each .mid was copied under a writing name and moved onto its own",
       [c for c in asked69["copy"] if c[0].endswith(".mid")]
       == [("Drums.mid", apimod69.WRITING_PREFIX + "Drums.mid"), ("Keys.mid", apimod69.WRITING_PREFIX + "Keys.mid")])
    ok("with nothing half-written left", not list(target69.rglob(apimod69.WRITING_PREFIX + "*")))
    ok("the copy's record names the notes", res["cloud"]["source"].get("notes") == ["Drums", "Keys"])

    seen69 = []
    res = copy69(1, "tracks", progress=lambda fraction, step: seen69.append((fraction, step)))
    ok("the progress stages are the audio's alone: a track each, none for the notes",
       res["ok"] and sorted({s for _, s in seen69}) == ["Track 1 of 2", "Track 2 of 2"]
       and seen69[-1][0] == 1.0 and [f for f, _ in seen69] == sorted(f for f, _ in seen69))

    print("  Both")
    res = copy69(1, "both")
    ok("the .mid files are in the tracks' folder, once each in the whole copy, byte for byte the take's",
       res["ok"] and sorted(p.name for p in target69.rglob("*.mid")) == ["Drums.mid", "Keys.mid"]
       and all(same69(Path(res["cloud"]["tracks"]) / f"{n}.mid", p) for n, p in mids69(1).items()))
    ok("the mix is one audio file with no .mid beside it",
       Path(res["cloud"]["mix"]).suffix in (".flac", ".wav")
       and [p.name for p in target69.iterdir() if p.is_file()] == [Path(res["cloud"]["mix"]).name])
    ok("mixdown was given the two WAVs and nothing else",
       sorted(asked69["mixdown"]) == ["Bass.wav", "Drums.wav"])
    ok("encode was never given a .mid",
       len(asked69["encode"]) == 3 and not any(n.endswith(".mid") for n in asked69["encode"]))
    ok("and its record names the notes", res["cloud"]["source"].get("notes") == ["Drums", "Keys"])

    print("  The mix")
    res = copy69(1, "mix")
    ok("the mix has no .mid in it or beside it, and the old copy's notes went with its folder",
       res["ok"] and "tracks" not in res["cloud"] and not list(target69.rglob("*.mid"))
       and not [c for c in asked69["copy"] if c[0].endswith(".mid")])
    ok("mixdown was given the two WAVs and nothing else",
       sorted(asked69["mixdown"]) == ["Bass.wav", "Drums.wav"])
    ok("and the mix's record leaves the notes out, as the mix does", "notes" not in res["cloud"]["source"])

    print("  What the record says")
    where69 = a69._cloud_target(folder69)
    volumes69 = a69.get_settings()["volumes"]
    res = copy69(2, "tracks")
    take2 = a69._lib.take(folder69, 2)
    old69 = {"what": "tracks", "name": take2["name"], "format": "flac", "dir": str(where69),
             "volumes": {"Bass": 1.0}, "duration_sec": 2.0}
    ok("a take with no notes: source_of is exactly what it was, with no notes in it",
       cloudmod69.source_of(take2, "tracks", volumes69, "flac", where69) == old69 and res["cloud"]["source"] == old69)
    ok("and its copy counts as current", cloudmod69.is_current(take2, "tracks", volumes69, "flac", where69))
    sent69 = []
    real_copy69 = a69._copy_to_cloud
    a69._copy_to_cloud = lambda *args, **kwargs: (sent69.append(args), real_copy69(*args, **kwargs))[1]
    try:
        a69.set_auto_publish(True, "tracks")
        a69._enqueue_publish(folder69, 2)
        while a69._cloud_queue.run_next():
            pass
        a69.set_auto_publish(False, "mix")
    finally:
        a69._copy_to_cloud = real_copy69
    ok("so a copy made before notes existed is not sent again", sent69 == [])

    res = copy69(1, "tracks")
    take1 = a69._lib.take(folder69, 1)
    ok("a take that has notes is current with a copy made from them",
       cloudmod69.is_current(take1, "tracks", volumes69, "flac", where69))
    older = {**take1, "cloud": {**take1["cloud"], "source": {
        k: v for k, v in take1["cloud"]["source"].items() if k != "notes"}}}
    ok("and not with a copy made without them", not cloudmod69.is_current(older, "tracks", volumes69, "flac", where69))
    ok("both records name the notes: Both carries the .mid files like the tracks do",
       cloudmod69.source_of(take1, "both", volumes69, "flac", where69).get("notes") == ["Drums", "Keys"])
    # A mix holds no notes, so what a take has of them cannot make a mix copy stale: one made before the take had
    # notes, or by a build that did not record them, is not mixed and sent again for nothing.
    mix_record69 = {"what": "mix", "name": take1["name"], "format": "flac", "dir": str(where69),
                    "volumes": {"Drums": 1.0, "Bass": 1.0}, "duration_sec": take1["duration_sec"]}
    ok("source_of for a mix of a take that has notes has no notes key",
       cloudmod69.source_of(take1, "mix", volumes69, "flac", where69) == mix_record69)
    mixed69 = {**take1, "cloud": {"mix": take1["cloud"]["tracks"], "source": mix_record69}}
    ok("so a mix copy whose record has none is current for a take with notes",
       cloudmod69.is_current(mixed69, "mix", volumes69, "flac", where69))

    print("  A crop")
    cropped69 = a69.crop_take(str(folder69), 1, 0.5, 1.5)
    while a69._cloud_queue.run_next():
        pass
    take1 = a69._lib.take(folder69, 1)
    dest69 = Path(take1["cloud"].get("tracks") or "")
    ok("a crop sends the take again, in the shape it had, with its notes in the copy as they are in the take now",
       cropped69["ok"] and dest69.is_dir() and not take1["cloud"].get("mix")
       and all(same69(dest69 / f"{n}.mid", p) for n, p in mids69(1).items())
       and sorted(mids69(1)) == ["Drums", "Keys"])
    ok("and that copy is current for the cropped take",
       cloudmod69.is_current(take1, "tracks", volumes69, "flac", where69) and take1["duration_sec"] < 2.0
       and take1["cloud"]["source"].get("notes") == ["Drums", "Keys"])

    print("  A .mid that is not there")
    keep69(3, {"Drums": 900}, {"Drums": [36, 38], "Keys": [62]})
    mids69(3)["Keys"].unlink()
    res = copy69(3, "tracks")
    ok("a .mid missing on disk is skipped, and the copy still goes with the rest",
       res["ok"] and sorted(f.name for f in Path(res["cloud"]["tracks"]).iterdir()) == [f"Drums{ext69}", "Drums.mid"]
       and same69(Path(res["cloud"]["tracks"]) / "Drums.mid", mids69(3)["Drums"]))
    ok("with nothing half-written left", not list(target69.rglob(apimod69.WRITING_PREFIX + "*")))

    print("  A .mid the disk refuses")
    keep69(4, {"Drums": 700}, {"Drums": [36, 38]})
    for which69 in ("copy2", "os.replace"):
        real69 = apimod69.shutil.copy2, apimod69.os.replace

        def refuse69(real, which=which69):
            def refusing(src, dst, *args, **kwargs):
                if str(src).endswith(".mid"):
                    raise OSError(28, f"No space left on device ({which})")
                return real(src, dst, *args, **kwargs)
            return refusing

        if which69 == "copy2":
            apimod69.shutil.copy2 = refuse69(real69[0])
        else:
            apimod69.os.replace = refuse69(real69[1])
        try:
            try:
                res = a69._copy_to_cloud(str(folder69), 4, "tracks")
            except OSError as e:
                res = {"ok": "raised", "error": str(e)}
        finally:
            apimod69.shutil.copy2, apimod69.os.replace = real69
        ok(f"{which69} refusing a .mid: the copy fails with the error text, and does not raise",
           res["ok"] is False and res["error"].startswith("Could not copy the tracks: ")
           and f"No space left on device ({which69})" in res["error"])
        ok(f"{which69} refusing a .mid: no half-written file is left, and no .mid under its real name",
           not list(target69.rglob(apimod69.WRITING_PREFIX + "*"))
           and not [p for p in target69.rglob("*.mid") if p.parent.name.startswith("04 - ")])
        ok(f"{which69} refusing a .mid: nothing is recorded for the take",
           not (a69._lib.take(folder69, 4).get("cloud") or {}).get("tracks"))
    res = a69._copy_to_cloud(str(folder69), 4, "tracks")
    ok("and the next try, with the disk back, copies the take whole",
       res["ok"] and (Path(res["cloud"]["tracks"]) / "Drums.mid").is_file())
    a69.unshare_take(str(folder69), 4)

    print("  A rename")
    renamed69 = a69.rename_take(str(folder69), 3, "Chorus")
    take3 = a69._lib.take(folder69, 3)
    dest3 = Path(take3["cloud"].get("tracks") or "")
    ok("a renamed take's copy is renamed where it is, the .mid inside it, and it is still current",
       renamed69["ok"] and take3["name"] != "Take 3" and dest3.name == "03 - " + take3["name"]
       and (dest3 / "Drums.mid").is_file()
       and cloudmod69.is_current(take3, "tracks", volumes69, "flac", where69))

    print("  Taking a copy back")
    removed69 = a69.unshare_take(str(folder69), 1)
    ok("removing a take's copy takes its notes with it, and the other takes' copies stay",
       removed69["ok"] and not dest69.exists()
       and sorted(p.parent.name for p in target69.rglob("*.mid")) == [Path(a69._lib.take(folder69, 3)["cloud"]["tracks"]).name])

    print("\n[70] take_notes")
    # The player draws a take's notes from its .mid files. Whether a lane is a drum
    # grid is the icon the take keeps for that file, as take_media's lanes are.
    from rehearsal_recorder.midi.notes import DRUM_ROWS as DRUM_ROWS70
    from rehearsal_recorder.midi.smf import write_mid as write_mid70

    def hits70(path, channel, notes):
        """A .mid of these notes struck 0.25 s apart on `channel` (0-based), each let go 0.1 s later."""
        events = [e for k, note in enumerate(notes)
                  for e in ((k * 0.25, bytes((0x90 | channel, note, 100))),
                            (k * 0.25 + 0.1, bytes((0x80 | channel, note, 0))))]
        write_mid70(path, track_name=path.stem, port_name="Port", start=[], events=events)
        return str(path)

    folder70 = Path(tempfile.mkdtemp())
    apimod70, a70 = fresh_api(folder70)
    a70._config["tracks"] = [
        {"name": "Drums", "mode": "both", "icon": "drums", "midi_port": {"name": "TD-17"}},
        {"name": "Keys", "mode": "midi", "icon": "keys", "midi_port": {"name": "Launchkey"}},
        {"name": "Bass"}]
    drums70 = hits70(folder70 / "Drums.mid", 0, [36, 38, 42, 99])   # on channel 1: only the icon says a kit
    keys70 = hits70(folder70 / "Keys.mid", 0, [61, 74])
    pad70 = hits70(folder70 / "Pad.mid", 9, [36, 38])               # not in the band, but on channel 10
    answered = a70.take_notes([{"name": "Drums", "file": drums70, "icon": "drums"},
                               {"name": "Keys", "file": keys70, "icon": "keys"},
                               {"name": "Pad", "file": pad70}])
    ok("a .mid the take gave the drums icon reads as drums, the rows in the order they are drawn",
       answered[0]["name"] == "Drums" and answered[0]["drums"] is True
       and answered[0]["rows"] == DRUM_ROWS70 + ["Other"]
       and [n[2] for n in answered[0]["notes"]] == [5, 4, 2, 6])
    ok("every note comes with its start, length and velocity in seconds and 1 to 127",
       [n[:2] for n in answered[0]["notes"]] == [[0.0, 0.1], [0.25, 0.1], [0.5, 0.1], [0.75, 0.1]]
       and {n[3] for n in answered[0]["notes"]} == {100})
    ok("a track whose icon is not the drums' is a piano roll: whole octaves around its notes",
       answered[1]["name"] == "Keys" and answered[1]["drums"] is False
       and (answered[1]["low"], answered[1]["high"]) == (60, 83)
       and [n[2] for n in answered[1]["notes"]] == [61, 74])
    ok("a file with no icon is judged by itself alone: notes on channel 10 are drums",
       answered[2]["name"] == "Pad" and answered[2]["drums"] is True and answered[2]["rows"] == DRUM_ROWS70)
    ok("each file is answered, in the order it was asked", [a["name"] for a in answered] == ["Drums", "Keys", "Pad"])
    ok("what the player is sent can go over the bridge as JSON", json.loads(json.dumps(answered)) == answered)

    # A track that records notes only has no audio lane, and so no take_media answer to take its icon from: the
    # plate of its notes lane takes it from here. One whose port never appeared has no file in the take to keep
    # an icon, and is given the band's, by its name.
    ok("each answer carries the icon its file was given, as take_media's does",
       answered[0].get("icon") == "drums" and answered[1].get("icon") == "keys")
    ok("a file with no icon gets none",
       "icon" not in answered[2])
    iconned70 = a70.take_notes([{"name": "Keys", "file": str(folder70 / "Gone.mid"), "icon": "keys"},
                                {"name": "Drums", "file": None}, {"name": "Keys"}, {"name": "Bass", "file": None}])
    ok("an answer that is an error carries the icon too: a file not found its own, a file of None or none at all the band's",
       iconned70[:3] == [{"name": "Keys", "icon": "keys", "error": "Notes file not found"},
                         {"name": "Drums", "icon": "drums", "error": "Notes file not found"},
                         {"name": "Keys", "icon": "keys", "error": "Notes file not found"}])
    ok("and a band member with no icon gets none, as take_media gives none",
       iconned70[3] == {"name": "Bass", "error": "Notes file not found"})
    ok("a name that is not text gets no icon, and does not fail the call",
       a70.take_notes([{"name": ["Keys"], "file": None}, {"name": "Keys", "file": None}])[1].get("icon") == "keys")

    gone70 = str(folder70 / "Gone.mid")
    (folder70 / "Torn.mid").write_bytes(b"MThd\x00\x00\x00\x06\x00")
    (folder70 / "Empty.mid").write_bytes(b"")
    import contextlib
    import io
    import logging as logging70

    said70 = []  # what take_notes says in the log for a file it cannot read
    catcher70 = logging70.Handler(level=logging70.INFO)
    catcher70.emit = said70.append
    logging70.getLogger(apimod70.__name__).addHandler(catcher70)
    try:
        mixed = a70.take_notes([{"name": "Bass", "file": gone70}, {"name": "Drums", "file": drums70, "icon": "drums"},
                                {"name": "Keys", "file": str(folder70 / "Torn.mid"), "icon": "keys"},
                                {"name": "Pad", "file": str(folder70 / "Empty.mid")},
                                {"name": "Folder", "file": str(folder70)},
                                {"name": "Keys", "file": keys70}])
        ok("a missing file is reported as not found, and the others still answer",
           mixed[0] == {"name": "Bass", "error": "Notes file not found"}
           and mixed[1]["drums"] is True and len(mixed[1]["notes"]) == 4
           and mixed[5]["drums"] is False and len(mixed[5]["notes"]) == 2)
        ok("a file that is no .mid, or is cut short, or empty, or a folder, is reported as not readable, and the rest answer",
           [m.get("error") for m in mixed[2:5]] == ["Notes file not readable"] * 3
           and [m["name"] for m in mixed[2:5]] == ["Keys", "Pad", "Folder"] and len(mixed) == 6)
        ok("a file that is not readable carries its track's icon as well",
           mixed[2] == {"name": "Keys", "icon": "keys", "error": "Notes file not readable"})
        ok("and it says in the log, as a warning, which files, once each, and not the one that was only missing",
           [r.getMessage().split(":")[0] for r in said70]
           == ["notes of Torn.mid", "notes of Empty.mid", f"notes of {folder70.name}"]
           and {r.levelno for r in said70} == {logging70.WARNING})
        ok("no files, no answers", a70.take_notes([]) == [])

        # One file that makes the system itself refuse cannot fail the others: a name too long for the file system
        # raises OSError (ENAMETOOLONG) from the existence check on Linux and macOS, and is simply not there on Windows.
        long70 = str(folder70 / ("x" * 300 + ".mid"))
        refused = a70.take_notes([{"name": "Keys", "file": keys70}, {"name": "Long", "file": long70},
                                  {"name": "Drums", "file": drums70, "icon": "drums"}])
        ok("a name too long for the file system is answered with an error, and the other files still answer",
           [r["name"] for r in refused] == ["Keys", "Long", "Drums"]
           and refused[1].get("error") in ("Notes file not found", "Notes file not readable")
           and "error" not in refused[0] and "error" not in refused[2] and refused[2]["drums"] is True)

        # A console in a Windows code page cannot show every name, and a file whose name it cannot show is the very one
        # that was not readable: saying so must not be what fails the call.
        odd70 = folder70 / "Pa\u0142yn.mid"
        odd70.write_bytes(b"not a midi file")
        console70 = io.TextIOWrapper(io.BytesIO(), encoding="cp1252", errors="strict")
        with contextlib.redirect_stdout(console70), contextlib.redirect_stderr(console70):
            odd = a70.take_notes([{"name": "Pa\u0142yn", "file": str(odd70)}, {"name": "Keys", "file": keys70}])
        ok("an unreadable file whose name the console cannot show is answered, and the call goes on",
           odd[0] == {"name": "Pa\u0142yn", "error": "Notes file not readable"} and odd[1]["drums"] is False)

        # A malformed item is that item's answer, and no more: no path, a path of None, no name, not even a dict.
        said70.clear()
        malformed = a70.take_notes([{"name": "Bass"}, {"name": "Gone", "file": None}, {"file": keys70}, None,
                                    {"name": "Keys", "file": keys70}])
        ok("an item with no file, or none for a file, is not found, with its name when it has one, and the rest answer",
           malformed[0] == {"name": "Bass", "error": "Notes file not found"}
           and malformed[1] == {"name": "Gone", "error": "Notes file not found"}
           and malformed[4]["name"] == "Keys" and malformed[4]["drums"] is False and len(malformed) == 5)
        ok("an item with no name is answered without one, judged by its file alone, and one that is no item is not found",
           malformed[2]["drums"] is False and "name" not in malformed[2] and len(malformed[2]["notes"]) == 2
           and malformed[3] == {"error": "Notes file not found"})
        ok("none of that is a file that could not be read, so none of it is in the log", said70 == [])
    finally:
        logging70.getLogger(apimod70.__name__).removeHandler(catcher70)

    (folder70 / "Pad.mid").unlink()
    ok("a file that goes between two calls is not found the second time",
       a70.take_notes([{"name": "Pad", "file": pad70}]) == [{"name": "Pad", "error": "Notes file not found"}])
    a70._config["tracks"] = [{"name": "Pad", "icon": "drums"}]
    ok("the band's icon does not make a file a drum grid: only the take's does",
       a70.take_notes([{"name": "Pad", "file": drums70}])[0]["drums"] is False
       and a70.take_notes([{"name": "Pad", "file": drums70, "icon": "drums"}])[0]["drums"] is True)
    a70._config["tracks"] = None
    ok("a band that is not set yet leaves every file to its channel",
       a70.take_notes([{"name": "Drums", "file": drums70}])[0]["drums"] is False)

    print("\n[71] Undo instead of asking")
    # Deleting a take or a rehearsal, clearing false starts and discarding a
    # take no longer ask first (B1 of docs/superpowers/specs/2026-10-08-
    # design-system-design.md): the item moves into <recordings>/_deleting/
    # <token>/ at once, and the interface offers Undo. It reaches the Trash
    # only when that notice ends (end_trash), or at quit, at the next start,
    # before the recordings folder changes, or once it has waited too long.
    # Undo moves it back and puts its rows back. The Trash here is a stand-in
    # that keeps what it is sent, under the name it was sent with, and counts
    # it: nothing reaches the real one.
    import os as os71

    tmp71 = Path(tempfile.mkdtemp())
    apimod71, u = fresh_api(tmp71)
    rec71 = u.recordings_dir
    drive71 = tmp71 / "Drive"
    bin71 = tmp71 / "Bin"
    sent71 = []

    def trash71(path, fallback_root=None):
        path = Path(path)
        if not path.exists():
            return {"ok": False, "error": "It is not there any more"}
        bin71.mkdir(exist_ok=True)
        path.rename(bin71 / f"{len(sent71)} {path.name}")
        sent71.append(path)
        return {"ok": True, "trashed": True, "location": None}

    def binned71(name):
        """What the Trash was sent under this name, in the order it came."""
        if not bin71.exists():
            return []
        return sorted((p for p in bin71.iterdir() if p.name.split(" ", 1)[1] == name),
                      key=lambda p: int(p.name.split(" ", 1)[0]))

    def entries71(where=None):
        """The tokens waiting in a recordings folder's holding folder."""
        holding = (where or rec71) / "_deleting"
        return sorted(p.name for p in holding.iterdir()) if holding.is_dir() else []

    def bytes71(folder):
        """Every file under a folder, by its path there, with what is in it."""
        return {p.relative_to(folder).as_posix(): p.read_bytes()
                for p in sorted(Path(folder).rglob("*")) if p.is_file()}

    def add71(api, folder, number, title, notes_dir=None):
        """A take as keep_take leaves one: a folder named after it with a WAV and
        a .mid (or the .mid in `notes_dir`), a mark, and its rows."""
        named = api._lib.resolve_name(folder, title, number)
        take_dir = folder / f"{number:02d} - {named['name']}"
        write_wav(take_dir / "Gtr.wav", 700 + number, seconds=1.0)
        mid_dir = notes_dir or take_dir
        mid_dir.mkdir(parents=True, exist_ok=True)
        (mid_dir / "Gtr.mid").write_bytes(b"MThd, the notes of take %d" % number)
        return api._lib.add_take(folder, {
            "take_number": number, "name": title, "duration_sec": 1.0,
            "tracks": [{"name": "Gtr", "file": str(take_dir / "Gtr.wav")}],
            "notes": [{"name": "Gtr", "file": str(mid_dir / "Gtr.mid")}],
            "markers": [{"at": 0.5, "note": "here"}]})

    def past71(api, name, created_at, titles):
        """A finished rehearsal, played by a set, with a take for each title."""
        stamp = f"{created_at[:10]} {created_at[11:16].replace(':', '-')}"
        folder = api.recordings_dir / f"{name} - {stamp}"
        api._lib.create_rehearsal(folder, name, created_at, SR, 16,
                                  [{"name": "Gtr", "channel": 1}],
                                  set_copy={"name": "Usual", "songs": ["Polyn", "Vesna"]})
        for number, title in enumerate(titles, 1):
            add71(api, folder, number, title)
        return folder

    def numbers71(folder):
        return [t["take_number"] for t in u.get_rehearsal(str(folder))["takes"]]

    import rehearsal_recorder.platform_support as ps71

    def gone71():
        """What an Undo too late answers: that it has gone, in the words of
        the system (spec P2), which CI runs on all three of; with
        send2trash installed each has its own bin."""
        where = "the Recycle Bin" if ps71.WINDOWS else "the Trash"
        return {"ok": False, "gone": True, "error": f"It has already gone to {where}."}

    # What an Undo answers once what went is back where it was, by an Undo
    # or by an end: not that it has gone to the Trash.
    BACK71 = {"ok": False, "back": True, "error": "It is back where it was."}

    def listed71():
        return {r["folder"] for r in u.list_rehearsals()}

    real_trash71 = apimod71.move_to_trash
    apimod71.move_to_trash = trash71
    u.set_cloud_dir(str(drive71))
    u.set_auto_publish(False, "mix")
    tue71 = past71(u, "Tuesday", "2026-09-29T19:00:00",
                   ["Polyn", "Vesna", "Polyn", "Ogon", "Ogon"])
    u.set_take_star(str(tue71), 1, True)
    u._copy_to_cloud(str(tue71), 1, "mix")

    dir2 = Path(u._lib.take(tue71, 2)["tracks"][0]["file"]).parent
    gone2 = u.delete_take(str(tue71), 2)
    token2 = gone2.get("undo") or ""
    held2 = rec71 / "_deleting" / token2
    ok("a. deleting a take answers an Undo token, and says nothing of a Trash yet",
       gone2.get("ok") is True and re.fullmatch(r"[0-9a-f]{8}", token2) is not None
       and gone2.get("takes_left") == 4 and "trashed" not in gone2 and "location" not in gone2)
    ok("its folder waits under _deleting/<token>/, by its own name, with a record of it",
       not dir2.exists() and (held2 / "0" / dir2.name / "Gtr.wav").is_file()
       and (held2 / "record.json").is_file())
    ok("the rehearsal no longer lists it", numbers71(tue71) == [1, 3, 4, 5])
    ok("and nothing went to the Trash", sent71 == [])

    before1 = u._lib.take(tue71, 1)
    dir1 = Path(before1["tracks"][0]["file"]).parent
    files1 = bytes71(dir1)
    mix1 = Path((before1.get("cloud") or {}).get("mix", "nowhere"))
    back1 = u.undo_trash(u.delete_take(str(tue71), 1).get("undo"))
    after1 = u._lib.take(tue71, 1) or {}
    ok("b. Undo brings a deleted take back, and says which",
       back1 == {"ok": True, "kind": "take", "folder": str(tue71), "take_numbers": [1]})
    ok("at the same paths, with the same bytes",
       after1.get("tracks") == before1["tracks"] and bytes71(dir1) == files1)
    ok("with its name, star, marks and notes files",
       (after1.get("name"), after1.get("starred")) == ("Polyn 1", True)
       and after1.get("markers") == before1["markers"] and before1["markers"][0]["note"] == "here"
       and after1.get("notes") == before1["notes"] and Path(before1["notes"][0]["file"]).is_file())
    ok("and its cloud copy, which never left the cloud folder",
       after1.get("cloud") == before1["cloud"] and mix1.is_file())
    ok("the same take as before; its entry gone and nothing sent to the Trash",
       after1 == before1 and entries71() == [token2] and sent71 == [])

    gone1 = u.delete_take(str(tue71), 1)
    ok("c. while its Undo waits, the take's copy stays in the cloud folder", mix1.is_file())
    ended1 = u.end_trash(gone1.get("undo"))
    ok("when its notice ends its folder goes to the Trash once, by its own name, whole",
       ended1 == {"ok": True} and [p.name for p in sent71].count(dir1.name) == 1
       and len(binned71(dir1.name)) == 1 and bytes71(binned71(dir1.name)[0]) == files1)
    ok("its entry is gone", entries71() == [token2])
    ok("and only now is its copy taken out of the cloud", not mix1.exists() and mix1 in sent71)

    ok("n. Undo of a take that has gone to the Trash says so",
       u.undo_trash(gone1.get("undo")) == gone71())
    ok("as does Undo of a token there never was, or one that is no token at all",
       u.undo_trash("0123abcd") == gone71()
       and u.undo_trash("../" + token2) == gone71()
       and u.undo_trash(None) == gone71())
    ok("and its notice ending again has nothing left to do",
       u.end_trash(gone1.get("undo")) == {"ok": True} and entries71() == [token2])

    print("  the same item twice")
    # Deleted, put back and deleted again: one entry, nothing in the Trash.
    dir4 = Path(u._lib.take(tue71, 4)["tracks"][0]["file"]).parent
    u.undo_trash(u.delete_take(str(tue71), 4).get("undo"))
    again4 = u.delete_take(str(tue71), 4).get("undo")
    ok("a take deleted, put back and deleted again waits in one entry, none of it in the Trash",
       entries71() == sorted([token2, again4]) and binned71(dir4.name) == [])
    u.undo_trash(again4)
    # A number given again (recover_draft takes one past the highest): the
    # older take's entry ends before the newer one's is made.
    dir5 = Path(u._lib.take(tue71, 5)["tracks"][0]["file"]).parent
    old5 = u.delete_take(str(tue71), 5).get("undo")
    add71(u, tue71, 5, "Ogon")
    new5 = u.delete_take(str(tue71), 5).get("undo")
    ok("a take of a number whose earlier take waits: that entry goes to the Trash first",
       old5 not in entries71() and new5 in entries71() and len(binned71(dir5.name)) == 1)
    back5 = u.undo_trash(new5)
    ok("and Undo brings back the later one",
       back5.get("ok") is True and u._lib.take(tue71, 5)["name"] == "Ogon 3")

    three = u.delete_takes(str(tue71), [3, 4, 5, 9])
    record3 = json.loads((rec71 / "_deleting" / str(three.get("undo")) / "record.json")
                         .read_text(encoding="utf-8")) if three.get("undo") else {}
    ok("d. clearing three takes answers one Undo for all of them",
       three.get("ok") is True and three.get("deleted") == [3, 4, 5]
       and three.get("failed") == [{"take_number": 9, "error": "Take not found"}]
       and isinstance(three.get("undo"), str) and numbers71(tue71) == [])
    ok("one entry, a folder for each, its record naming every take",
       len(record3.get("items", [])) == 3
       and [i.get("take_number") for i in record3.get("record", {}).get("item", [])] == [3, 4, 5])
    ok("Undo brings all three back",
       u.undo_trash(three.get("undo")) == {"ok": True, "kind": "takes", "folder": str(tue71),
                                           "take_numbers": [3, 4, 5]}
       and numbers71(tue71) == [3, 4, 5])

    print("  a folder that will not move")
    # A take whose files are in two folders, the second held open by another
    # program, which Windows refuses to move.
    add71(u, tue71, 7, "Split", notes_dir=tue71 / "07 - Split notes")
    stuck71 = tue71 / "07 - Split notes"
    first7 = tue71 / "07 - Split 1"
    files7 = (bytes71(first7), bytes71(stuck71))

    class Refusing71:
        """os, except that a folder another program holds will not move."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            if Path(src) == stuck71:
                raise PermissionError(13, "The file is being used by another process", str(src))
            return os71.rename(src, dst)

    import rehearsal_recorder.holding as holding71

    waiting7 = entries71()
    holding71.os = Refusing71()
    refused7 = u.delete_take(str(tue71), 7)
    holding71.os = os71
    ok("g. a take whose second folder will not move is not deleted, and says why",
       refused7.get("ok") is False and "being used" in str(refused7.get("error")))
    ok("its row is still there", u._lib.take(tue71, 7) is not None)
    ok("and both its folders are where they were, whole",
       (bytes71(first7), bytes71(stuck71)) == files7)
    ok("with no entry left behind and nothing sent to the Trash",
       entries71() == waiting7 and binned71(first7.name) == [])
    holding71.os = Refusing71()
    some7 = u.delete_takes(str(tue71), [3, 7])
    holding71.os = os71
    ok("clearing it with another: the other goes, and the one that would not move is said",
       some7.get("deleted") == [3] and [f["take_number"] for f in some7.get("failed", [])] == [7]
       and u._lib.take(tue71, 7) is not None and (bytes71(first7), bytes71(stuck71)) == files7)
    u.undo_trash(some7.get("undo"))

    print("  the last take of a past rehearsal")
    mon71 = past71(u, "Monday", "2026-09-28T19:00:00", ["Vesna"])
    last = u.delete_take(str(mon71), 1)
    ok("h. its rehearsal is still listed while the take's Undo waits, though listing cleans up",
       str(mon71) in listed71() and mon71.is_dir())
    ok("and Undo brings the take back into it",
       u.undo_trash(last.get("undo")).get("ok") is True and numbers71(mon71) == [1])
    u.end_trash(u.delete_take(str(mon71), 1).get("undo"))
    ok("once its notice ends, the emptied rehearsal is cleaned up as before",
       str(mon71) not in listed71() and not mon71.exists())

    print("  a take of a rehearsal whose drive is not plugged in")
    away71 = past71(u, "Away", "2026-09-27T19:00:00", ["Vesna", "Ogon"])
    os71.rename(away71, tmp71 / "unplugged")

    def rows71(folder):
        return [t["take_number"] for t in u._lib.rehearsal(folder)["takes"]]

    off71 = u.delete_take(str(away71), 2)
    ok("its take is deleted all the same, with an Undo and nothing to hold",
       off71.get("ok") is True and rows71(away71) == [1]
       and (holding71.read(rec71, off71.get("undo")) or {}).get("items") == [])
    ok("and Undo brings its rows back without the folder being there",
       u.undo_trash(off71.get("undo")) == {"ok": True, "kind": "take", "folder": str(away71),
                                          "take_numbers": [2]}
       and rows71(away71) == [1, 2] and off71.get("undo") not in entries71())
    os71.rename(tmp71 / "unplugged", away71)

    print("  renamed while it waits")
    wed71 = past71(u, "Wednesday", "2026-09-30T19:00:00", ["Zima", "Zima"])
    u._copy_to_cloud(str(wed71), 1, "mix")
    u._copy_to_cloud(str(wed71), 2, "mix")
    zima = u.delete_take(str(wed71), 2)
    thu71 = Path(u.rename_rehearsal(str(wed71), "Thursday")["folder"])
    u.rename_song(u._lib.song_id("Zima"), "Zyma")
    back2 = u.undo_trash(zima.get("undo"))
    took2 = u._lib.take(thu71, 2) or {"tracks": [{"file": "nowhere"}]}
    ok("i. Undo puts the take into its rehearsal's new folder",
       back2 == {"ok": True, "kind": "take", "folder": str(thu71), "take_numbers": [2]}
       and Path(took2["tracks"][0]["file"]).is_file()
       and Path(took2["tracks"][0]["file"]).parent.parent == thu71 and not wed71.exists())
    ok("under its song's new title, with its go", took2.get("name") == "Zyma 2")
    ok("its cloud copy where the rename moved it, the record following it there",
       Path((took2.get("cloud") or {}).get("mix", "nowhere")).is_file()
       and Path(took2["cloud"]["mix"]).parent == drive71 / thu71.name)
    # A rename moves the rehearsal's whole folder in the cloud when no copy
    # of it is on its way, the copy waiting with its take in it: the record
    # follows it there.
    oct71 = past71(u, "October", "2026-10-08T19:00:00", ["Vesna", "Vesna"])
    u._copy_to_cloud(str(oct71), 1, "mix")
    u._copy_to_cloud(str(oct71), 2, "mix")
    stays_oct = Path(u._lib.take(oct71, 1)["cloud"]["mix"]).name
    mix_oct = Path(u._lib.take(oct71, 2)["cloud"]["mix"])
    waiting_oct = u.delete_take(str(oct71), 2).get("undo")
    sub_oct = drive71 / Path(u.rename_rehearsal(str(oct71), "October best")["folder"]).name
    ok("(the rename moved the rehearsal's folder in the cloud, the waiting copy in it)",
       (sub_oct / mix_oct.name).is_file() and not mix_oct.parent.exists())
    u.end_trash(waiting_oct)
    ok("a copy waiting with its take is taken out of the cloud where a rename moved it",
       sorted(p.name for p in sub_oct.iterdir()) == [stays_oct]
       and len(binned71(mix_oct.name)) == 1)

    print("  a whole rehearsal")
    fri71 = past71(u, "Friday", "2026-10-02T19:00:00", ["Polyn", "Vesna", "Ogon"])
    u._copy_to_cloud(str(fri71), 2, "mix")
    mix_fri = Path(u._lib.take(fri71, 2)["cloud"]["mix"])
    dir3f = Path(u._lib.take(fri71, 3)["tracks"][0]["file"]).parent
    first_gone = u.delete_take(str(fri71), 3).get("undo")
    whole = u._lib.rehearsal(fri71)
    files_fri = bytes71(fri71)
    gone_fri = u.delete_rehearsal(str(fri71))
    ok("e. deleting a rehearsal answers an Undo, and its folder waits whole",
       gone_fri.get("ok") is True and set(gone_fri) == {"ok", "undo", "ended"} and not fri71.exists()
       and bytes71(rec71 / "_deleting" / str(gone_fri.get("undo")) / "0" / fri71.name) == files_fri)
    ok("a take of it waiting already went to the Trash before it",
       first_gone not in entries71() and len(binned71(dir3f.name)) == 1)
    ok("History no longer lists it, and its cloud copies stay while its Undo waits",
       str(fri71) not in listed71() and mix_fri.is_file())
    ok("Undo lists it again, with its tracks, set and takes",
       u.undo_trash(gone_fri.get("undo")) == {"ok": True, "kind": "rehearsal",
                                               "folder": str(fri71)}
       and u._lib.rehearsal(fri71) == whole and str(fri71) in listed71()
       and whole["set"]["name"] == "Usual" and numbers71(fri71) == [1, 2])
    ok("every file back where it was", bytes71(fri71) == files_fri)
    gone_fri = u.delete_rehearsal(str(fri71))
    ok("ended instead, the whole folder goes to the Trash",
       u.end_trash(gone_fri.get("undo")) == {"ok": True} and not fri71.exists()
       and len(binned71(fri71.name)) == 1 and bytes71(binned71(fri71.name)[0]) == files_fri)
    ok("and its cloud copies with it", not mix_fri.exists() and mix_fri in sent71)

    print("  discarding")
    u.start_rehearsal("Live", None, SR, [{"name": "Gtr", "channel": 1}], 16)
    live71 = Path(u._session["folder"])
    draft71 = live71 / "_drafts" / "take 1"
    write_wav(draft71 / "Gtr.wav", 900, seconds=1.0)
    (draft71 / "Gtr.mid").write_bytes(b"MThd, the notes of the draft")
    files_draft = bytes71(draft71)
    u._session["take_counter"] = 1
    dropped = u.discard_take(str(draft71))
    ok("f. discarding a take answers an Undo, and its draft waits",
       dropped.get("ok") is True and set(dropped) == {"ok", "undo", "ended"} and not draft71.exists())
    ok("Undo puts the folder back at _drafts/take 1, every file in it",
       u.undo_trash(dropped.get("undo")) == {"ok": True, "kind": "draft",
                                              "temp_dir": str(draft71), "folder": str(live71)}
       and bytes71(draft71) == files_draft)
    # Renamed while the discard waits: Undo follows the rehearsal.
    dropped = u.discard_take(str(draft71))
    live71 = Path(u.rename_rehearsal(str(live71), "Live renamed")["folder"])
    draft71 = live71 / "_drafts" / "take 1"
    ok("and into its rehearsal's new folder when it was renamed meanwhile",
       u.undo_trash(dropped.get("undo")).get("temp_dir") == str(draft71)
       and bytes71(draft71) == files_draft)
    u.finish_rehearsal()
    ok("a draft left at Finish is a draft on the Drafts screen",
       [d["dir"] for d in u.list_drafts()] == [str(draft71)])
    dropped = u.discard_draft(str(draft71))
    ok("discarding it there takes it off the list, and its Undo puts it back on",
       dropped.get("ok") is True and u.list_drafts() == []
       and u.undo_trash(dropped.get("undo")).get("ok") is True
       and [d["dir"] for d in u.list_drafts()] == [str(draft71)])
    dropped = u.discard_draft(str(draft71))

    print("  waiting too long")
    sun71 = past71(u, "Sunday", "2026-10-04T19:00:00", ["Polyn", "Vesna"])
    dir1s = Path(u._lib.take(sun71, 1)["tracks"][0]["file"]).parent
    stale = u.delete_take(str(sun71), 1).get("undo")
    stale_record = rec71 / "_deleting" / str(stale) / "record.json"
    written = json.loads(stale_record.read_text(encoding="utf-8"))
    written["time"] -= 121
    stale_record.write_text(json.dumps(written), encoding="utf-8")
    young = entries71()
    young.remove(stale)
    fresh = u.delete_take(str(sun71), 2).get("undo")
    ok("m. an entry that waited longer than two minutes goes to the Trash at the next removal",
       stale not in entries71() and len(binned71(dir1s.name)) == 1)
    ok("and the younger ones keep waiting", all(t in entries71() for t in young + [fresh]))

    print("  never a rehearsal, never a draft")
    sized71 = past71(u, "Sized", "2026-10-05T19:00:00", ["Polyn", "Vesna"])

    def size71():
        return next(r["disk_bytes"] for r in u.list_rehearsals() if r["folder"] == str(sized71))

    whole_bytes = size71()
    dir2o = Path(u._lib.take(sized71, 2)["tracks"][0]["file"]).parent
    take_bytes = sum(len(b) for b in bytes71(dir2o).values())
    waiting_o = u.delete_take(str(sized71), 2).get("undo")
    ok("o. a take waiting for its Undo is charged to no rehearsal",
       take_bytes > 0 and size71() == whole_bytes - take_bytes)
    ok("and _deleting is not listed as a rehearsal",
       "_deleting" not in {Path(f).name for f in listed71()})
    lost71 = rec71 / "Lost - 2026-09-01 20-00"
    u._lib.create_rehearsal(lost71, "Lost", "2026-09-01T20:00:00", SR, 16,
                            [{"name": "Gtr", "channel": 1}])
    refused_o = {"ok": False, "error": "That folder is where deleted things go"}
    ok("locating a missing rehearsal onto _deleting is refused",
       u.locate_rehearsal(str(lost71), str(rec71 / "_deleting")) == refused_o)
    ok("and onto anything waiting in it",
       u.locate_rehearsal(str(lost71), str(rec71 / "_deleting" / str(waiting_o) / "0"
                                           / dir2o.name)) == refused_o)
    ok("a discarded draft waiting in it is no draft on the Drafts screen",
       dropped.get("undo") in entries71() and u.list_drafts() == [])
    u.forget_rehearsal(str(lost71))

    print("  every end")
    waiting_l = entries71()
    other71 = tmp71 / "Other recordings"
    switched = u.set_recordings_dir(str(other71))
    ok("l. changing the recordings folder sends everything waiting to the Trash first",
       switched.get("ok") is True and waiting_l != [] and entries71(rec71) == []
       and len(binned71(dir2o.name)) == 1 and len(binned71("take 1")) == 1)
    u.set_recordings_dir(str(rec71))

    mar71 = past71(u, "March", "2026-10-06T19:00:00", ["Polyn"])
    dir_j = Path(u._lib.take(mar71, 1)["tracks"][0]["file"]).parent
    u.delete_take(str(mar71), 1)
    u.shutdown()
    ok("j. quitting with a take waiting sends it to the Trash",
       len(binned71(dir_j.name)) == 1 and not dir_j.exists())
    ok("and leaves _deleting empty", entries71() == [])

    # The app died with an entry waiting: the next start sends it on, and the
    # cloud copy its record names leaves with it.
    _, w = fresh_api(tmp71)
    apr71 = past71(w, "April", "2026-10-07T19:00:00", ["Polyn"])
    w._copy_to_cloud(str(apr71), 1, "mix")
    mix_k = Path(w._lib.take(apr71, 1)["cloud"]["mix"])
    dir_k = Path(w._lib.take(apr71, 1)["tracks"][0]["file"]).parent
    left_k = w.delete_take(str(apr71), 1).get("undo")
    ok("k. (an entry is left waiting, its copy still in the cloud)",
       entries71() == [left_k] and mix_k.is_file())
    _, k = fresh_api(tmp71)
    ok("at the next start an entry left waiting goes to the Trash",
       entries71() == [] and len(binned71(dir_k.name)) == 1)
    ok("and the cloud copy its record names is taken out", not mix_k.exists() and mix_k in sent71)
    k.shutdown()
    w._library.close()
    apimod71.move_to_trash = real_trash71

    print("\n[72] An unfinished removal goes back, not to the Trash")
    # A removal is two steps, the files into _deleting and the rows out of
    # the library, and an Undo the same two the other way. Whatever stops in
    # between (the app dying, a move that fails and cannot be taken back, a
    # library that refuses) must leave neither files in the Trash under rows
    # that are still there, nor files back with no rows. The entry's record
    # says how far it got, and its end follows it: the Trash once the rows
    # are gone, back where it came from while they are not.
    tmp72 = Path(tempfile.mkdtemp())
    apimod72, x72 = fresh_api(tmp72)
    rec72 = x72.recordings_dir
    drive72 = tmp72 / "Drive"
    apimod72.move_to_trash = trash71
    x72.set_cloud_dir(str(drive72))
    x72.set_auto_publish(False, "mix")
    opened72 = [x72]

    class Crash72(BaseException):
        """The app dying here: nothing after it runs, no except catches it."""

    def crash72(*args, **kwargs):
        raise Crash72()

    def restart72():
        """The app started again over the same folder, the one before it
        never having quit."""
        _, api = fresh_api(tmp72)
        opened72.append(api)
        return api

    def rows72(api, folder):
        r = api._lib.rehearsal(folder)
        return [] if r is None else [t["take_number"] for t in r["takes"]]

    def record72(token):
        return (holding71.read(rec72, token) or {}).get("record") or {}

    def dir72(api, folder, n):
        return Path(api._lib.take(folder, n)["tracks"][0]["file"]).parent

    sat72 = past71(x72, "Saturday", "2026-10-03T19:00:00", ["Polyn", "Vesna", "Ogon"])
    x72._copy_to_cloud(str(sat72), 1, "mix")
    dir1 = dir72(x72, sat72, 1)
    files1 = bytes71(dir1)
    mix1 = Path(x72._lib.take(sat72, 1)["cloud"]["mix"])

    print("  the app dies between moving the files and dropping the rows")
    mark72 = len(sent71)
    x72._lib.delete_takes = crash72
    try:
        x72.delete_take(str(sat72), 1)
    except Crash72:
        pass
    del x72._lib.delete_takes
    ok("a. (the take's folder is in _deleting, its rows still in the library)",
       len(entries71(rec72)) == 1 and not dir1.exists() and rows72(x72, sat72) == [1, 2, 3])
    y72 = restart72()
    ok("the next start puts it back where it was, every file, and sends nothing to the Trash",
       bytes71(dir1) == files1 and entries71(rec72) == [] and sent71[mark72:] == [])
    ok("the take is as it was, its copy still in the cloud",
       y72._lib.take(sat72, 1) is not None and mix1.is_file())

    print("  the app dies between dropping the rows and the record saying so")
    dir2 = dir72(y72, sat72, 2)
    real_update72 = holding71.update
    holding71.update = crash72
    try:
        y72.delete_take(str(sat72), 2)
    except Crash72:
        pass
    holding71.update = real_update72
    waiting72 = entries71(rec72)
    ok("(its rows are gone, and its record still says they were kept)",
       rows72(y72, sat72) == [1, 3] and len(waiting72) == 1
       and record72(waiting72[0]).get("rows") == "kept")
    z72 = restart72()
    ok("the next start finds its rows gone, and sends it to the Trash after all",
       entries71(rec72) == [] and not dir2.exists()
       and [p.name for p in sent71[mark72:]] == [dir2.name])

    print("  the app dies during an Undo")
    dir3 = dir72(z72, sat72, 3)
    files3 = bytes71(dir3)
    gone3 = z72.delete_take(str(sat72), 3).get("undo")
    mark72 = len(sent71)
    z72._lib.restore_takes = crash72
    z72._lib.restore_take = crash72
    try:
        z72.undo_trash(gone3)
    except Crash72:
        pass
    del z72._lib.restore_takes, z72._lib.restore_take
    ok("(its files are back, its rows not yet, and its entry says an Undo was under way)",
       bytes71(dir3) == files3 and rows72(z72, sat72) == [1] and gone3 in entries71(rec72)
       and record72(gone3).get("rows") == "restoring")
    q72 = restart72()
    ok("b. the next start finishes the Undo: the take is back, files and rows, nothing in the Trash",
       bytes71(dir3) == files3 and rows72(q72, sat72) == [1, 3] and entries71(rec72) == []
       and sent71[mark72:] == [])

    print("  a move that fails, and what had moved will not go back")
    add71(q72, sat72, 7, "Split", notes_dir=sat72 / "07 - Split notes")
    first72 = dir72(q72, sat72, 7)
    notes72 = sat72 / "07 - Split notes"
    files7 = (bytes71(first72), bytes71(notes72))

    class Jammed72:
        """os, except that the notes folder will not move, and the take's
        folder, once moved, will not move back."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            if Path(src) == notes72 or Path(dst) == first72:
                raise PermissionError(13, "The file is being used by another process", str(src))
            return os71.rename(src, dst)

    holding71.os = Jammed72()
    jammed72 = q72.delete_take(str(sat72), 7)
    holding71.os = os71
    waiting72 = entries71(rec72)
    ok("c. a take whose move fails and whose moved folder will not go back is not deleted, "
       "and says where its folder is",
       jammed72.get("ok") is False and first72.name in str(jammed72.get("error"))
       and q72._lib.take(sat72, 7) is not None)
    ok("(its folder waits in _deleting, its record saying its rows were never dropped)",
       len(waiting72) == 1 and record72(waiting72[0]).get("rows") == "kept")
    ended72 = q72.end_trash(waiting72[0])
    ok("its end puts the folder back, whole, and sends nothing to the Trash",
       ended72 == {"ok": True} and (bytes71(first72), bytes71(notes72)) == files7
       and entries71(rec72) == [] and sent71[mark72:] == [])

    print("  the library refuses, and the files will not go back")

    def locked72(*args, **kwargs):
        raise RuntimeError("database is locked")

    class Stays72:
        """os, except that nothing moves back to where it came from."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            if Path(dst) in (first72, notes72, sun72):
                raise PermissionError(13, "The file is being used by another process", str(dst))
            return os71.rename(src, dst)

    sun72 = past71(q72, "Sunday", "2026-10-04T19:00:00", ["Polyn"])
    files_sun = bytes71(sun72)
    q72._lib.delete_takes = locked72
    try:
        q72.delete_take(str(sat72), 7)
        raised72 = None
    except RuntimeError as e:
        raised72 = str(e)
    del q72._lib.delete_takes
    ok("a library that refuses to drop a take's rows has its files put straight back, "
       "no entry left",
       raised72 == "database is locked" and (bytes71(first72), bytes71(notes72)) == files7
       and entries71(rec72) == [] and q72._lib.take(sat72, 7) is not None)
    q72._lib.forget_rehearsal = locked72
    try:
        q72.delete_rehearsal(str(sun72))
        raised72 = None
    except RuntimeError as e:
        raised72 = str(e)
    del q72._lib.forget_rehearsal
    ok("and so has a rehearsal's folder",
       raised72 == "database is locked" and bytes71(sun72) == files_sun
       and entries71(rec72) == [] and q72._lib.rehearsal(sun72) is not None)
    q72._lib.delete_takes = locked72
    holding71.os = Stays72()
    try:
        q72.delete_take(str(sat72), 7)
        raised72 = None
    except RuntimeError as e:
        raised72 = str(e)
    holding71.os = os71
    del q72._lib.delete_takes
    waiting72 = entries71(rec72)
    ok("d. a library that refuses to drop a take's rows is said, its rows left as they were",
       raised72 == "database is locked" and q72._lib.take(sat72, 7) is not None)
    ended72 = q72.end_trash(waiting72[0]) if len(waiting72) == 1 else None
    ok("and when its files will not go back to them then, its end puts them back, "
       "sending nothing to the Trash",
       ended72 == {"ok": True} and (bytes71(first72), bytes71(notes72)) == files7
       and entries71(rec72) == [] and sent71[mark72:] == [])
    q72._lib.forget_rehearsal = locked72
    holding71.os = Stays72()
    try:
        q72.delete_rehearsal(str(sun72))
        raised72 = None
    except RuntimeError as e:
        raised72 = str(e)
    holding71.os = os71
    del q72._lib.forget_rehearsal
    waiting72 = entries71(rec72)
    ended72 = q72.end_trash(waiting72[0]) if len(waiting72) == 1 else None
    ok("so with a whole rehearsal: its end puts its folder back, whole",
       raised72 == "database is locked" and ended72 == {"ok": True}
       and bytes71(sun72) == files_sun and str(sun72) in {r["folder"] for r in q72.list_rehearsals()}
       and entries71(rec72) == [] and sent71[mark72:] == [])

    print("  a delete tried again after a move failed and could not be taken back")
    mark72 = len(sent71)
    holding71.os = Jammed72()
    q72.delete_take(str(sat72), 7)
    holding71.os = os71
    again72 = q72.delete_take(str(sat72), 7)
    ended72 = q72.end_trash(again72.get("undo"))
    ok("the retry takes the whole take: once its notice ends, nothing of it is left "
       "outside the Trash, and every file of it reached the Trash",
       again72.get("ok") is True and ended72 == {"ok": True}
       and not first72.exists() and not notes72.exists() and entries71(rec72) == []
       and [p.name for p in sent71[mark72:]] == [first72.name, notes72.name]
       and (bytes71(binned71(first72.name)[-1]), bytes71(binned71(notes72.name)[-1])) == files7)

    print("  a cloud copy a later take has now")
    mon72 = past71(q72, "Monday", "2026-09-28T19:00:00", ["Polyn"])
    add71(q72, mon72, 2, "")
    q72._copy_to_cloud(str(mon72), 2, "mix")
    copy72 = Path(q72._lib.take(mon72, 2)["cloud"]["mix"])
    old72 = q72.delete_take(str(mon72), 2).get("undo")
    # recover_draft numbers the next take one past the highest: 2 again,
    # named "Take 2" again, so its copy lands on the same path.
    add71(q72, mon72, 2, "")
    q72._copy_to_cloud(str(mon72), 2, "mix")
    ok("(the later take's copy is where the deleted one's was)",
       q72._lib.take(mon72, 2)["name"] == "Take 2"
       and q72._lib.take(mon72, 2)["cloud"]["mix"] == str(copy72) and copy72.is_file())
    q72.end_trash(old72)
    ok("e. the deleted take's end leaves the copy the later take has there",
       copy72.is_file() and copy72 not in sent71[mark72:]
       and q72._lib.take(mon72, 2)["cloud"].get("mix") == str(copy72))
    later72 = q72.delete_take(str(mon72), 2).get("undo")
    q72._lib.set_cloud_copy(mon72, 1, {"mix": str(copy72), "mix_format": "wav"}, drive72)
    back72 = q72.undo_trash(later72)
    ok("and Undo of a take whose copy another take names now brings it back without that copy",
       back72.get("ok") is True and q72._lib.take(mon72, 2)["cloud"] == {}
       and q72._lib.take(mon72, 1)["cloud"].get("mix") == str(copy72) and copy72.is_file())
    q72._lib.set_cloud_copy(mon72, 1, None, None)

    add71(q72, mon72, 3, "")
    q72._copy_to_cloud(str(mon72), 3, "mix")
    copy3 = Path(q72._lib.take(mon72, 3)["cloud"]["mix"])
    waiting3 = q72.delete_take(str(mon72), 3).get("undo")
    landed72 = []

    def landing72(path, fallback_root=None):
        """The Trash, while the copy worker (which runs outside the files
        lock) finishes a copy of take 1 onto that very path."""
        if not landed72:
            landed72.append(path)
            q72._lib.set_cloud_copy(mon72, 1, {"mix": str(copy3), "mix_format": "wav"}, drive72)
        return trash71(path, fallback_root)

    apimod72.move_to_trash = landing72
    q72.end_trash(waiting3)
    apimod72.move_to_trash = trash71
    ok("a copy that lands in that place while the entry's files go to the Trash stays",
       copy3.is_file() and q72._lib.take(mon72, 1)["cloud"].get("mix") == str(copy3))
    add71(q72, mon72, 4, "")
    q72._copy_to_cloud(str(mon72), 4, "mix")
    copy4 = Path(q72._lib.take(mon72, 4)["cloud"]["mix"])
    waiting4 = q72.delete_take(str(mon72), 4).get("undo")
    q72._lib.set_cloud_copy(mon72, 1, {"mix": str(copy4.parent / copy4.name.upper()),
                                       "mix_format": "wav"}, drive72)
    q72.end_trash(waiting4)
    ok("and one another take names spelled in another case is taken for the same place, "
       "as a Mac's or Windows' folder takes it, and stays",
       copy4.is_file())
    q72._lib.set_cloud_copy(mon72, 1, None, None)

    print("  the recordings folder changes with an entry whose rows are kept")
    tue72 = past71(q72, "Tuesday", "2026-09-29T19:00:00", ["Polyn"])
    dir_t = dir72(q72, tue72, 1)
    files_t = bytes71(dir_t)
    mark72 = len(sent71)
    q72._lib.delete_takes = crash72
    try:
        q72.delete_take(str(tue72), 1)
    except Crash72:
        pass
    del q72._lib.delete_takes
    switched72 = q72.set_recordings_dir(str(tmp72 / "Elsewhere"))
    ok("f. changing the folder puts it back, asking the library it belongs to, not the new one",
       switched72.get("ok") is True and bytes71(dir_t) == files_t
       and entries71(rec72) == [] and sent71[mark72:] == [])
    q72.set_recordings_dir(str(rec72))

    print("  saving a draft ends only its crop")
    q72.start_rehearsal("Live", 0, SR, [{"name": "Gtr", "channel": 1}])
    live72 = Path(q72._session["folder"])
    draft72 = live72 / "_drafts" / "take 1"
    write_wav(draft72 / "Gtr.wav", 300, seconds=1.0)
    discarded72 = q72.discard_take(str(draft72)).get("undo")
    # Recorded again under the same name, and cropped: the uncut file waits.
    write_wav(draft72 / "Gtr.wav", 400, seconds=1.0)
    write_wav(draft72 / "Gtr.uncut.wav", 400, seconds=2.0)
    crop72 = holding71.hold(rec72, {"kind": "crop", "reason": "crop", "rows": "none",
                                    "item": q72._draft_identity(draft72)},
                            [draft72 / "Gtr.uncut.wav"])
    mark72 = len(sent71)
    q72.keep_take(1, str(draft72), "Polyn", 1.0,
                  [{"name": "Gtr", "file": str(draft72 / "Gtr.wav")}])
    ok("g. saving a draft sends its crop's uncut files on, and leaves another draft's discard waiting",
       crop72 not in entries71(rec72) and discarded72 in entries71(rec72))
    ok("a crop's entry, with no rows to wait for, goes to the Trash",
       [p.name for p in sent71[mark72:]] == ["Gtr.uncut.wav"])
    q72.end_trash(discarded72)
    q72.finish_rehearsal()

    print("  a rehearsal brought back is copied again, as a take is")
    q72.set_auto_publish(True, "mix")
    wed72 = past71(q72, "Wednesday", "2026-09-30T19:00:00", ["Polyn"])
    q72.undo_trash(q72.delete_rehearsal(str(wed72)).get("undo"))
    ok("h. Undo of a rehearsal asks for its takes to be copied, when sending is on",
       q72._cloud_queue.states(str(wed72)) == {1: "queued"})
    q72.set_auto_publish(False, "mix")

    print("  an Undo that is refused leaves everything as it is")
    thu72 = past71(q72, "Thursday", "2026-10-01T19:00:00", ["Polyn", "Vesna"])
    dir_h = dir72(q72, thu72, 1)
    waiting_h = q72.delete_take(str(thu72), 1).get("undo")
    dir_h.mkdir()
    (dir_h / "Theirs.wav").write_bytes(b"someone else's")
    refused72 = q72.undo_trash(waiting_h)
    ok("i. an Undo whose place is taken on disk says so, and leaves the entry and what is there",
       refused72 == {"ok": False, "error": f"Something else is in its place now: {dir_h}"}
       and waiting_h in entries71(rec72) and record72(waiting_h).get("rows") == "dropped"
       and sorted(os71.listdir(dir_h)) == ["Theirs.wav"]
       and (dir_h / "Theirs.wav").read_bytes() == b"someone else's")
    (dir_h / "Theirs.wav").unlink()
    dir_h.rmdir()
    add71(q72, thu72, 1, "Ogon")
    dir_o = dir72(q72, thu72, 1)
    files_o = bytes71(dir_o)
    refused72 = q72.undo_trash(waiting_h)
    ok("one whose number another take has now says so, and leaves both as they are",
       refused72 == {"ok": False, "error": "Take 1 is taken by another take now."}
       and waiting_h in entries71(rec72) and bytes71(dir_o) == files_o
       and q72._lib.take(thu72, 1)["name"].startswith("Ogon"))
    waiting_v = q72.delete_take(str(thu72), 2).get("undo")
    q72.forget_rehearsal(str(thu72))
    refused72 = q72.undo_trash(waiting_v)
    ok("one whose rehearsal is gone says so, and leaves the entry and the folder",
       refused72 == {"ok": False, "error": "Its rehearsal is gone."}
       and waiting_v in entries71(rec72) and bytes71(dir_o) == files_o)
    q72.end_trash(waiting_h)
    q72.end_trash(waiting_v)

    print("  a Trash that refuses part of an entry")
    fri72 = past71(q72, "Friday", "2026-10-02T19:00:00", [])
    add71(q72, fri72, 1, "Split", notes_dir=fri72 / "01 - Split notes")
    dir_f = dir72(q72, fri72, 1)
    split72 = q72.delete_take(str(fri72), 1).get("undo")
    mark72 = len(sent71)

    def full72(path, fallback_root=None):
        if Path(path).name == "01 - Split notes":
            return {"ok": False, "error": "The Trash is full"}
        return trash71(path, fallback_root)

    apimod72.move_to_trash = full72
    first_end72 = q72.end_trash(split72)
    apimod72.move_to_trash = trash71
    ok("j. a Trash that refuses part of an entry leaves the entry, with what it did not take",
       first_end72 == {"ok": False, "error": "The Trash is full"} and split72 in entries71(rec72)
       and (rec72 / "_deleting" / split72 / "1" / "01 - Split notes").is_dir())
    second_end72 = q72.end_trash(split72)
    ok("and the next end sends only what is left: each folder reaches the Trash once",
       second_end72 == {"ok": True} and split72 not in entries71(rec72)
       and [p.name for p in sent71[mark72:]] == [dir_f.name, "01 - Split notes"])

    print("  an Undo broken off part way, its rehearsal renamed before it is finished")
    nov72 = past71(q72, "November", "2026-10-09T19:00:00", [])
    add71(q72, nov72, 1, "Split", notes_dir=nov72 / "01 - Split notes")
    first_n = dir72(q72, nov72, 1)
    notes_n = nov72 / "01 - Split notes"
    files_n = (bytes71(first_n), bytes71(notes_n))
    broken72 = q72.delete_take(str(nov72), 1).get("undo")
    entry_n = rec72 / "_deleting" / broken72

    class Partway72:
        """os, except that the notes folder will not come out of the entry,
        and the take's folder, once out, will not go back in."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            if Path(src) == entry_n / "1" / notes_n.name or Path(dst) == entry_n / "0" / first_n.name:
                raise PermissionError(13, "The file is being used by another process", str(src))
            return os71.rename(src, dst)

    holding71.os = Partway72()
    partway72 = q72.undo_trash(broken72)
    holding71.os = os71
    ok("(an Undo that stops part way says so, its entry saying an Undo is under way)",
       partway72.get("ok") is False and record72(broken72).get("rows") == "restoring"
       and bytes71(first_n) == files_n[0])
    dec72 = Path(q72.rename_rehearsal(str(nov72), "December")["folder"])
    q72.end_trash(broken72)
    took_n = q72._lib.take(dec72, 1) or {}
    ok("its end finishes it into the rehearsal's new folder, not the old one",
       not nov72.exists() and bytes71(dec72 / first_n.name) == files_n[0]
       and bytes71(dec72 / notes_n.name) == files_n[1] and broken72 not in entries71(rec72)
       and [Path(f["file"]).parent.parent for f in took_n.get("tracks", [])] == [dec72])

    print("  putting back part way")
    hand72 = rec72 / "Hand"
    for name in ("a", "b"):
        (hand72 / name).mkdir(parents=True)
        (hand72 / name / "f.wav").write_bytes(name.encode())
    hand_token = holding71.hold(rec72, {"kind": "test", "rows": "none"},
                                [hand72 / "a", hand72 / "b"])
    entry72 = rec72 / "_deleting" / hand_token

    class Halfway72:
        """os, except that b will not come out, and a, once out, will not go back in."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            if Path(src).name == "b" or Path(dst) == entry72 / "0" / "a":
                raise PermissionError(13, "The file is being used by another process", str(src))
            return os71.rename(src, dst)

    holding71.os = Halfway72()
    try:
        holding71.put_back(rec72, hand_token, [hand72 / "a", hand72 / "b"])
        said72 = ""
    except OSError as e:
        said72 = str(e)
    holding71.os = os71
    ok("k. a put-back that fails part way says where what would not go back in is",
       str(hand72 / "a") in said72 and (hand72 / "a" / "f.wav").read_bytes() == b"a"
       and (entry72 / "1" / "b" / "f.wav").is_file() and (entry72 / "record.json").is_file())
    holding71.put_back(rec72, hand_token, [hand72 / "a", hand72 / "b"])
    holding71.drop(rec72, hand_token)

    print("  a record that cannot be written")
    sat_dir = dir72(q72, sat72, 1)
    files_s = bytes71(sat_dir)
    waiting_s = entries71(rec72)
    real_write72 = holding71._write

    def no_room72(entry, data):
        raise OSError(28, "No space left on device")

    holding71._write = no_room72
    failed72 = q72.delete_take(str(sat72), 1)
    holding71._write = real_write72
    ok("l. a removal whose record cannot be written leaves no entry behind, and the take as it was",
       failed72.get("ok") is False and "No space" in str(failed72.get("error"))
       and entries71(rec72) == waiting_s and bytes71(sat_dir) == files_s
       and q72._lib.take(sat72, 1) is not None)

    gone72 = q72.delete_take(str(sat72), 1).get("undo")
    real_put_back72 = holding71.put_back

    def vanished72(*args, **kwargs):
        raise holding71.Gone()

    holding71.put_back = vanished72
    vanished_answer = q72.undo_trash(gone72)
    holding71.put_back = real_put_back72
    ok("m. an entry gone from under an Undo says, plainly, that it has gone to the Trash",
       vanished_answer == gone71())
    q72.undo_trash(gone72)

    print("  a record that cannot be read")
    dir_g = dir72(q72, sat72, 1)
    files_g = bytes71(dir_g)
    garbled72 = q72.delete_take(str(sat72), 1).get("undo")
    (rec72 / "_deleting" / garbled72 / "record.json").write_text("{not json", encoding="utf-8")
    mark72 = len(sent71)

    class Caught72(logging.Handler):
        """What the app logs at ERROR: what a windowed build keeps."""

        def __init__(self):
            super().__init__(logging.ERROR)
            self.said = []

        def emit(self, record):
            self.said.append(record.getMessage())

    caught72 = Caught72()
    logging.getLogger("rehearsal_recorder").addHandler(caught72)
    ended72 = q72.end_trash(garbled72)
    logging.getLogger("rehearsal_recorder").removeHandler(caught72)
    ok("n. an entry whose record cannot be read is kept, files and all, never sent to the Trash",
       ended72.get("ok") is False and garbled72 in entries71(rec72)
       and bytes71(rec72 / "_deleting" / garbled72 / "0" / dir_g.name) == files_g
       and sent71[mark72:] == [])
    ok("and the log a windowed build keeps says so, naming it",
       any(garbled72 in said for said in caught72.said))
    q72.shutdown()
    s72 = restart72()
    problems72 = s72.startup_problems()
    ok("o. at the next start it is still kept, and said once among the start problems, "
       "naming its folder",
       garbled72 in entries71(rec72) and sent71[mark72:] == []
       and [p["name"] for p in problems72] == ["RemovalKept"]
       and str(rec72 / "_deleting" / garbled72) in problems72[0]["message"]
       and s72.startup_problems() == [])

    print("  the recordings folder changes with an entry that stays")
    moved72 = s72.set_recordings_dir(str(tmp72 / "Elsewhere"))
    ok("p. changing the folder names, in its answer, an entry that stays in the old one",
       moved72.get("ok") is True
       and moved72.get("kept") == [str(rec72 / "_deleting" / garbled72)]
       and garbled72 in entries71(rec72))
    back72 = s72.set_recordings_dir(str(rec72))
    ok("and names none when none stays", back72.get("ok") is True and back72.get("kept") == [])

    print("  a draft discarded twice")
    dec72 = past71(s72, "December", "2026-10-10T19:00:00", ["Polyn", "Vesna"])
    twice72 = dec72 / "_drafts" / "take 8"
    write_wav(twice72 / "Gtr.wav", 800, seconds=1.0)
    files_d = bytes71(twice72)
    mark72 = len(sent71)
    first_d = s72.discard_draft(str(twice72))
    second_d = s72.discard_draft(str(twice72))
    ok("q. a second discard of a draft already gone says so, and the first one's entry waits on",
       first_d.get("ok") is True
       and second_d == {"ok": False, "error": "It is not there any more"}
       and first_d.get("undo") in entries71(rec72) and sent71[mark72:] == [])
    undone_d = s72.undo_trash(first_d.get("undo"))
    ok("and its Undo brings the draft back",
       undone_d.get("ok") is True and bytes71(twice72) == files_d)

    print("  a record of takes that names none")
    bare72 = rec72 / "Loose" / "f"
    bare72.mkdir(parents=True)
    (bare72 / "f.wav").write_bytes(b"bare")
    bare_token = holding71.hold(rec72, {"kind": "take", "reason": "delete", "rows": "kept",
                                        "takes": []}, [bare72])
    mark72 = len(sent71)
    ended_b = s72.end_trash(bare_token)
    ok("r. an entry whose record names no rows to ask about goes back, not to the Trash",
       ended_b.get("ok") is True and (bare72 / "f.wav").is_file()
       and (bare72 / "f.wav").read_bytes() == b"bare"
       and bare_token not in entries71(rec72) and sent71[mark72:] == [])
    ok("and an Undo of it then says it is back where it was, not that it has gone",
       s72.undo_trash(bare_token) == BACK71)

    print("  what stays, said at start")
    # A second record that cannot be read; a discard the Trash will refuse;
    # and an Undo the app died in, whose rows will not come back (a take has
    # its number now), so it ends with its files back and its entry gone.
    garbled2 = s72.delete_take(str(dec72), 2).get("undo")
    (rec72 / "_deleting" / garbled2 / "record.json").write_text("{not json", encoding="utf-8")
    refused_d = dec72 / "_drafts" / "take 5"
    write_wav(refused_d / "Gtr.wav", 500, seconds=1.0)
    refused_tok = s72.discard_draft(str(refused_d)).get("undo")
    dir_u = dir72(s72, dec72, 1)
    files_u = bytes71(dir_u)
    gone_u = s72.delete_take(str(dec72), 1).get("undo")
    s72._lib.restore_takes = crash72
    s72._lib.restore_take = crash72
    try:
        s72.undo_trash(gone_u)
    except Crash72:
        pass
    del s72._lib.restore_takes, s72._lib.restore_take
    add71(s72, dec72, 1, "Ogon")
    ok("(the Undo's files are back, its entry says it was under way, and take 1 is another take)",
       bytes71(dir_u) == files_u and record72(gone_u).get("rows") == "restoring"
       and dir72(s72, dec72, 1) != dir_u)

    def refusing72(path, fallback_root=None):
        return {"ok": False, "error": "The Trash said no"}

    apimod72.move_to_trash = refusing72
    caught72 = Caught72()
    logging.getLogger("rehearsal_recorder").addHandler(caught72)
    t72 = restart72()
    logging.getLogger("rehearsal_recorder").removeHandler(caught72)
    apimod72.move_to_trash = trash71
    problems_t = t72.startup_problems()
    said_t = problems_t[0]["message"] if problems_t else ""
    kept_t = [str(rec72 / "_deleting" / t) for t in (garbled72, garbled2, refused_tok)]
    ok("s. every entry that stays is said in one start problem, naming each folder",
       [p["name"] for p in problems_t] == ["RemovalKept"]
       and all(k in said_t for k in kept_t) and said_t.startswith("3 things"))
    ok("t. an entry an end gave up on, and that is gone, is never said to stay: "
       "not to the person, not in the log",
       gone_u not in entries71(rec72) and gone_u not in said_t
       and not any(gone_u in line and "stays" in line for line in caught72.said)
       and bytes71(dir_u) == files_u)
    ok("u. one whose record cannot be read is said plainly: where it came from cannot be "
       "told, and what is needed can be moved out of it; only the other is tried again",
       said_t.count("cannot tell where it came from") == 2
       and said_t.count("can be moved out of that folder") == 2
       and said_t.count("tried again next time") == 1
       and "(The Trash said no): it will be tried again next time" in said_t)
    t72.end_trash(refused_tok)
    t72.shutdown()
    for api72 in opened72[:3] + [s72]:
        api72._library.close()

    print("  what stays only because the library cannot be opened")
    tmp73 = Path(tempfile.mkdtemp())
    rec73 = newer_folder(tmp73 / "Rec")
    held73 = rec73 / "Sunday - 2026-10-04 19-00" / "01 - Polyn"
    write_wav(held73 / "Gtr.wav", 730, seconds=1.0)
    files73 = bytes71(held73)
    ref73 = {"id": 1, "created_at": "2026-10-04T19:00:00", "folder": "Sunday - 2026-10-04 19-00"}
    token73 = holding71.hold(rec73, {
        "kind": "take", "reason": "delete", "rows": "kept",
        "item": {"kind": "take", "rehearsal_id": 1, "take_number": 1},
        "rehearsal": ref73,
        "takes": [{"take": {"id": 1, "take_number": 1}, "rehearsal": ref73,
                   "files": [{"file": str(held73 / "Gtr.wav")}]}],
        "shared": []}, [held73])
    _, u73 = fresh_api(tmp73)
    ok("v. an entry that stays only for want of the library adds nothing to the library's "
       "own start problem, which is not buried",
       u73.startup_problems() == [{"name": "LibraryUnavailable", "message": NEWER_DATABASE}]
       and entries71(rec73) == [token73]
       and bytes71(rec73 / "_deleting" / token73 / "0" / held73.name) == files73)
    loose73 = rec73 / "Loose"
    loose73.mkdir()
    (loose73 / "f.wav").write_bytes(b"loose")
    garbled73 = holding71.hold(rec73, {"kind": "draft", "reason": "discard", "rows": "none"},
                               [loose73])
    (rec73 / "_deleting" / garbled73 / "record.json").write_text("{not json", encoding="utf-8")
    _, v73 = fresh_api(tmp73)
    problems73 = v73.startup_problems()
    ok("and one that stays for another reason is said first, so the library's comes last, "
       "on top, and names only itself",
       [p["name"] for p in problems73] == ["RemovalKept", "LibraryUnavailable"]
       and str(rec73 / "_deleting" / garbled73) in problems73[0]["message"]
       and token73 not in problems73[0]["message"]
       and sorted(entries71(rec73)) == sorted([token73, garbled73]))
    apimod72.move_to_trash = real_trash71

    print("\n[73] A crop can be undone")
    # A crop no longer sends the take as it was to the Trash at once: its
    # "(before crop)" folder waits in _deleting/<token>/ as a removal does,
    # and the notice offers Undo. Undo exchanges the files, so that the take
    # has one whole version in its places at every step: the cropped files go
    # on to the Trash, the uncut ones take their places, and the take's marks,
    # length and cloud copy come back as they were. The Trash is [71]'s
    # stand-in.
    tmp_c = Path(tempfile.mkdtemp())
    apimod_c, cr = fresh_api(tmp_c)
    rec_c = cr.recordings_dir
    drive_c = tmp_c / "Drive"
    apimod_c.move_to_trash = trash71
    cr.set_cloud_dir(str(drive_c))
    cr.set_auto_publish(False, "mix")
    opened_c = [cr]
    band_c = [{"name": "Gtr", "channel": 1}, {"name": "Bass", "channel": 2},
              {"name": "Drums", "mode": "midi", "midi_port": {"name": "TD-17"}}]
    folder_c = rec_c / "Crops - 2026-10-11 19-00"
    cr._lib.create_rehearsal(folder_c, "Crops", "2026-10-11T19:00:00", SR, 16, band_c)
    left_c = ("Keys.midraw", "take.clock", "take.json")

    def take_c(api, folder, number, title, leftovers=False):
        """A kept take of four seconds, as keep_take leaves one: Gtr.wav and
        Bass.wav, the kit's Drums.mid, three marks (0.5 s, 1.5 s, 3.8 s), and
        with `leftovers` a notes file the disk would not make a .mid of, with
        its clock and its record."""
        named = api._lib.resolve_name(folder, title, number)
        take_dir = folder / f"{number:02d} - {named['name']}"
        write_wav(take_dir / "Gtr.wav", 600 + number, seconds=4.0)
        write_wav(take_dir / "Bass.wav", 900 + number, seconds=4.0)
        drums = kit68(take_dir / "Drums.mid")
        if leftovers:
            for name in left_c:
                (take_dir / name).write_bytes(b"%s of take %d" % (name.encode(), number))
        api._lib.add_take(folder, {
            "take_number": number, "name": title, "duration_sec": 4.0,
            "tracks": [{"name": "Gtr", "file": str(take_dir / "Gtr.wav")},
                       {"name": "Bass", "file": str(take_dir / "Bass.wav")}],
            "notes": [drums],
            "markers": [{"at": 0.5, "note": "count-in", "label_id": 1},
                        {"at": 1.5, "note": "here", "label_id": 2},
                        {"at": 3.8, "note": "stopped", "label_id": 3}]})
        return take_dir

    def held_c(token, take_dir):
        """Where a crop's entry holds the take as it was."""
        return rec_c / "_deleting" / str(token) / "0" / f"{take_dir.name} (before crop)"

    def marks_c(api, folder, n):
        return [(m["at"], m["label_id"], m["note"]) for m in api._lib.take(folder, n)["markers"]]

    def length_c(api, folder, n):
        return api._lib.take(folder, n)["duration_sec"]

    def record_c(token):
        return (holding71.read(rec_c, token) or {}).get("record") or {}

    def sent_c(mark):
        """The names of what reached the Trash since `mark`."""
        return [p.name for p in sent71[mark:]]

    def last_c(name):
        """What the Trash was last sent under this name, file by file."""
        found = binned71(name)
        return bytes71(found[-1]) if found else None

    def drain_c(api):
        while api._cloud_queue.run_next():
            pass

    marks_before = [(0.5, 1, "count-in"), (1.5, 2, "here"), (3.8, 3, "stopped")]
    ref_c = cr._lib.rehearsal_ref(folder_c)

    print("  a crop waits for its Undo")
    dir1 = take_c(cr, folder_c, 1, "Polyn", leftovers=True)
    uncut1 = bytes71(dir1)
    mark_c = len(sent71)
    cut1 = cr.crop_take(str(folder_c), 1, 1.0, 3.0)
    token1 = cut1.get("undo") or ""
    cropped1 = bytes71(dir1)
    ok("a. a crop answers an Undo token, and says nothing of a Trash",
       cut1.get("ok") is True and re.fullmatch(r"[0-9a-f]{8}", token1) is not None
       and "trashed" not in cut1 and "location" not in cut1)
    ok("the take as it was waits under _deleting/<token>/ as one folder, every file of it "
       "with its bytes, the notes file not yet made, its clock and record among them",
       held_c(token1, dir1).is_dir() and bytes71(held_c(token1, dir1)) == uncut1)
    ok("not beside the take, and not in the Trash",
       not any(p.name.endswith("(before crop)") for p in folder_c.iterdir())
       and sent_c(mark_c) == [])
    ok("its record says it is a crop of take 1, with none of the library's rows going with it",
       record_c(token1).get("kind") == "crop" and record_c(token1).get("reason") == "crop"
       and record_c(token1).get("rows") == "none"
       and record_c(token1).get("item") == {"kind": "take", "rehearsal_id": ref_c["id"],
                                            "take_number": 1})
    ok("(the take is cropped: two seconds, the marks outside the region gone, no leftovers)",
       sorted(cropped1) == ["Bass.wav", "Drums.mid", "Gtr.wav"]
       and wav_frames(dir1 / "Gtr.wav") == 2 * SR and length_c(cr, folder_c, 1) == 2.0
       and marks_c(cr, folder_c, 1) == [(0.5, 2, "here")] and cut1.get("markers_dropped") == 2)

    print("  Undo")
    cr.add_take_marker(str(folder_c), 1, 2.0, "after", 2)
    cr.player_open(cr._lib.take(folder_c, 1)["tracks"])
    back1 = cr.undo_trash(token1)
    ok("b. Undo of a crop says what came back",
       back1 == {"ok": True, "kind": "crop", "folder": str(folder_c), "take_numbers": [1]})
    ok("every original is back in its place with its bytes, the notes file, clock and record too",
       bytes71(dir1) == uncut1)
    ok("the cropped files went to the Trash, once, as one folder named for the take",
       sent_c(mark_c) == [f"{dir1.name} (cropped)"] and last_c(f"{dir1.name} (cropped)") == cropped1)
    ok("the marks are those before the crop, the ones outside the region too, and one placed "
       "since at 2.0 s is at 2.0 s + the start",
       marks_c(cr, folder_c, 1) == [(0.5, 1, "count-in"), (1.5, 2, "here"), (3.0, 2, "after"),
                                    (3.8, 3, "stopped")])
    ok("the take is as long as it was", length_c(cr, folder_c, 1) == 4.0)
    ok("its entry is gone", token1 not in entries71(rec_c))
    ok("the player let go of the cropped take before its files moved",
       cr.player_state().get("open") is not True)
    ok("and an Undo done once is done: another says the take is back where it was",
       cr.undo_trash(token1) == BACK71)

    print("  a take in the cloud")
    dir2 = take_c(cr, folder_c, 2, "Vesna")
    cr._copy_to_cloud(str(folder_c), 2, "mix")
    cut2 = cr.crop_take(str(folder_c), 2, 1.0, 3.0)
    drain_c(cr)
    copy2 = Path((cr._lib.take(folder_c, 2)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    ok("(the cropped take is in the cloud folder now, two seconds of it)",
       copy2.is_file() and wav_frames(copy2) == 2 * SR)
    mark_c = len(sent71)
    cr.undo_trash(cut2.get("undo"))
    ok("c. Undo takes the cropped copy out of the cloud folder",
       not copy2.exists() and copy2 in sent71[mark_c:])
    ok("and asks for the whole take to be copied there again, in the shape it had",
       cr._cloud_queue.states(str(folder_c)).get(2) == "queued"
       and cr._lib.take(folder_c, 2)["cloud"] == {})
    drain_c(cr)
    again2 = Path((cr._lib.take(folder_c, 2)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    ok("which is then the take as it was, four seconds of it",
       again2.is_file() and wav_frames(again2) == 4 * SR)
    # A cropped copy another take names now (one that came after it under
    # the same name): that one stays.
    cut2 = cr.crop_take(str(folder_c), 2, 1.0, 3.0)
    drain_c(cr)
    copy2 = Path((cr._lib.take(folder_c, 2)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    cr._lib.set_cloud_copy(folder_c, 1, {"mix": str(copy2), "mix_format": "wav"}, drive_c)
    cr.undo_trash(cut2.get("undo"))
    ok("and leaves a copy another take names now",
       copy2.is_file() and cr._lib.take(folder_c, 1)["cloud"].get("mix") == str(copy2))
    cr._lib.set_cloud_copy(folder_c, 1, None, None)
    drain_c(cr)

    print("  its notice ends")
    dir3 = take_c(cr, folder_c, 3, "Ogon", leftovers=True)
    uncut3 = bytes71(dir3)
    cut3 = cr.crop_take(str(folder_c), 3, 1.0, 3.0)
    cropped3 = bytes71(dir3)
    mark_c = len(sent71)
    ended3 = cr.end_trash(cut3.get("undo"))
    ok("d. when a crop's notice ends, the take as it was goes to the Trash once, as one folder, "
       "with its bytes",
       ended3 == {"ok": True} and sent_c(mark_c) == [f"{dir3.name} (before crop)"]
       and last_c(f"{dir3.name} (before crop)") == uncut3)
    ok("its entry is gone, and the take stays cropped",
       cut3.get("undo") not in entries71(rec_c) and bytes71(dir3) == cropped3
       and length_c(cr, folder_c, 3) == 2.0)

    print("  cropped twice")
    dir4 = take_c(cr, folder_c, 4, "Zima")
    uncut4 = bytes71(dir4)
    first4 = cr.crop_take(str(folder_c), 4, 1.0, 3.0)
    once4, marks_once4 = bytes71(dir4), marks_c(cr, folder_c, 4)
    mark_c = len(sent71)
    second4 = cr.crop_take(str(folder_c), 4, 0.25, 1.75)
    ok("f. a take cropped again: the first crop's entry goes to the Trash first, the take as "
       "it was in it",
       second4.get("ok") is True and first4.get("undo") not in entries71(rec_c)
       and sent_c(mark_c) == [f"{dir4.name} (before crop)"]
       and last_c(f"{dir4.name} (before crop)") == uncut4)
    ok("and the second crop's entry holds the take as the first one left it",
       bytes71(held_c(second4.get("undo"), dir4)) == once4)
    back4 = cr.undo_trash(second4.get("undo"))
    ok("its Undo brings back the take cropped once: its files, its marks and its length",
       back4.get("ok") is True and bytes71(dir4) == once4
       and marks_c(cr, folder_c, 4) == marks_once4 and length_c(cr, folder_c, 4) == 2.0)

    print("  cropped, then deleted")
    dir5 = take_c(cr, folder_c, 5, "Leto")
    uncut5 = bytes71(dir5)
    cut5 = cr.crop_take(str(folder_c), 5, 1.0, 3.0)
    cropped5 = bytes71(dir5)
    mark_c = len(sent71)
    gone5 = cr.delete_take(str(folder_c), 5)
    ok("g. deleting a cropped take sends its crop's entry to the Trash first, the take as it "
       "was in it",
       gone5.get("ok") is True and cut5.get("undo") not in entries71(rec_c)
       and sent_c(mark_c) == [f"{dir5.name} (before crop)"]
       and last_c(f"{dir5.name} (before crop)") == uncut5)
    back5 = cr.undo_trash(gone5.get("undo"))
    ok("and Undo of the delete brings back the take cropped",
       back5.get("ok") is True and bytes71(dir5) == cropped5 and length_c(cr, folder_c, 5) == 2.0)

    print("  refused, and failing part way")
    dir6 = take_c(cr, folder_c, 6, "Osen", leftovers=True)
    uncut6 = bytes71(dir6)
    token6 = cr.crop_take(str(folder_c), 6, 1.0, 3.0).get("undo")
    cropped6 = bytes71(dir6)
    marks_cut6 = marks_c(cr, folder_c, 6)
    (dir6 / "take.json").write_bytes(b"someone else's")
    refused6 = cr.undo_trash(token6)
    ok("i. an Undo whose uncut file's place is taken says so, and moves nothing",
       refused6 == {"ok": False, "error": f"Something else is in its place now: {dir6 / 'take.json'}"}
       and bytes71(dir6) == {**cropped6, "take.json": b"someone else's"}
       and bytes71(held_c(token6, dir6)) == uncut6 and record_c(token6).get("rows") == "none"
       and length_c(cr, folder_c, 6) == 2.0)
    (dir6 / "take.json").unlink()

    class Halting_c:
        """os, except that the uncut Gtr.wav will not go to its place: the
        third file, with Bass.wav and Drums.mid exchanged already."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            if Path(dst) == dir6 / "Gtr.wav" and "(before crop)" in str(src):
                raise PermissionError(13, "The file is being used by another process", str(src))
            return os71.rename(src, dst)

    cr.player_open(cr._lib.take(folder_c, 6)["tracks"])
    holding71.os = Halting_c()
    stopped6 = cr.undo_trash(token6)
    holding71.os = os71
    ok("j. an Undo that fails part way says so, and leaves the take cropped and whole",
       stopped6.get("ok") is False and "being used" in str(stopped6.get("error"))
       and bytes71(dir6) == cropped6 and length_c(cr, folder_c, 6) == 2.0
       and marks_c(cr, folder_c, 6) == marks_cut6)
    ok("its entry waiting as it was, with no folder of cropped files left in it",
       bytes71(held_c(token6, dir6)) == uncut6 and record_c(token6).get("rows") == "none"
       and sorted(os71.listdir(rec_c / "_deleting" / str(token6))) == ["0", "record.json"])
    ok("and the take it was playing open again", cr.player_state().get("open") is True)
    cr.player_close()
    ok("an Undo tried again goes through",
       cr.undo_trash(token6).get("ok") is True and bytes71(dir6) == uncut6
       and marks_c(cr, folder_c, 6) == marks_before)

    print("  the library refuses")
    dir7 = take_c(cr, folder_c, 7, "Pesnya")
    uncut7 = bytes71(dir7)
    token7 = cr.crop_take(str(folder_c), 7, 1.0, 3.0).get("undo")
    cropped7 = bytes71(dir7)

    def locked_c(*args, **kwargs):
        raise RuntimeError("database is locked")

    cr._lib.uncrop_take = locked_c
    locked7 = cr.undo_trash(token7)
    del cr._lib.uncrop_take
    ok("n. an Undo whose marks and length the library will not take back says so, and the "
       "cropped take is put back in its places, its entry waiting as it was",
       locked7 == {"ok": False, "error": "Could not put it back: database is locked"}
       and bytes71(dir7) == cropped7
       and bytes71(held_c(token7, dir7)) == uncut7 and record_c(token7).get("rows") == "none"
       and length_c(cr, folder_c, 7) == 2.0)
    ok("and it can be undone once the library will",
       cr.undo_trash(token7).get("ok") is True and bytes71(dir7) == uncut7)

    print("  the Trash refuses the cropped files")
    dir8 = take_c(cr, folder_c, 8, "Dozhd")
    uncut8 = bytes71(dir8)
    token8 = cr.crop_take(str(folder_c), 8, 1.0, 3.0).get("undo")
    cropped8 = bytes71(dir8)

    def refusing_c(path, fallback_root=None):
        return {"ok": False, "error": "The Trash said no"}

    apimod_c.move_to_trash = refusing_c
    back8 = cr.undo_trash(token8)
    apimod_c.move_to_trash = trash71
    ok("p. an Undo goes through when the Trash refuses the cropped files, which wait in its "
       "entry for the next end",
       back8.get("ok") is True and bytes71(dir8) == uncut8 and length_c(cr, folder_c, 8) == 4.0
       and token8 in entries71(rec_c) and record_c(token8).get("undone") is True)
    ok("and Undo again says the take is back where it was",
       cr.undo_trash(token8) == BACK71)
    mark_c = len(sent71)
    ok("its end sends on only the cropped files",
       cr.end_trash(token8) == {"ok": True} and sent_c(mark_c) == [f"{dir8.name} (cropped)"]
       and last_c(f"{dir8.name} (cropped)") == cropped8 and token8 not in entries71(rec_c)
       and bytes71(dir8) == uncut8)

    print("  the uncut take cannot be held")
    dir9 = take_c(cr, folder_c, 9, "Mart")
    uncut9 = bytes71(dir9)
    waiting_c = entries71(rec_c)
    mark_c = len(sent71)
    real_write_c = holding71._write

    def no_room_c(entry, data):
        raise OSError(28, "No space left on device")

    holding71._write = no_room_c
    cut9 = cr.crop_take(str(folder_c), 9, 1.0, 3.0)
    holding71._write = real_write_c
    beside9 = folder_c / f"{dir9.name} (before crop)"
    ok("m. a crop whose uncut take cannot wait for an Undo is done all the same, with no Undo, "
       "and says why and where that take is",
       cut9.get("ok") is True and cut9.get("undo") is None
       and "No space" in str(cut9.get("error")) and str(beside9) in str(cut9.get("error"))
       and wav_frames(dir9 / "Gtr.wav") == 2 * SR)
    ok("which is beside the take, every file with its bytes, and nothing went to the Trash",
       bytes71(beside9) == uncut9 and sent_c(mark_c) == [] and entries71(rec_c) == waiting_c)

    print("  renamed while it waits")
    may_c = rec_c / "May - 2026-05-01 19-00"
    cr._lib.create_rehearsal(may_c, "May", "2026-05-01T19:00:00", SR, 16, band_c)
    dir_m = take_c(cr, may_c, 1, "Polyn", leftovers=True)
    uncut_m = bytes71(dir_m)
    token_m = cr.crop_take(str(may_c), 1, 1.0, 3.0).get("undo")
    renamed_m = cr.rename_take(str(may_c), 1, "Vesna")
    june_c = Path(cr.rename_rehearsal(str(may_c), "June")["folder"])
    now_m = Path(cr._lib.take(june_c, 1)["tracks"][0]["file"]).parent
    ok("(the take and its rehearsal were renamed while the crop waits)",
       renamed_m.get("ok") is True and now_m.parent == june_c and now_m.name != dir_m.name
       and not may_c.exists())
    mark_c = len(sent71)
    back_m = cr.undo_trash(token_m)
    ok("l. Undo puts the take as it was into the take's folder as it is now, in the rehearsal's",
       back_m == {"ok": True, "kind": "crop", "folder": str(june_c), "take_numbers": [1]}
       and bytes71(now_m) == uncut_m and not may_c.exists() and not dir_m.exists())
    ok("and the cropped files reach the Trash named for the take as it is now",
       sent_c(mark_c) == [f"{now_m.name} (cropped)"])

    print("  a draft")
    cr.start_rehearsal("Live", None, SR, band_c[:2], 16)
    live_c = Path(cr._session["folder"])

    def draft_c(n):
        """A draft on the review screen: two WAVs and the kit's .mid."""
        where = live_c / "_drafts" / f"take {n}"
        write_wav(where / "Gtr.wav", 300 + n, seconds=4.0)
        write_wav(where / "Bass.wav", 400 + n, seconds=4.0)
        note = kit68(where / "Drums.mid")
        return where, [{"name": "Gtr", "file": str(where / "Gtr.wav")},
                       {"name": "Bass", "file": str(where / "Bass.wav")}], note

    d1, tracks_d1, note_d1 = draft_c(1)
    uncut_d1 = bytes71(d1)
    cut_d1 = cr.crop_draft(str(d1), tracks_d1, 1.0, 3.0, notes=[note_d1])
    cropped_d1 = bytes71(d1)
    ok("(a draft's crop answers an Undo, the draft as it was waiting for it)",
       cut_d1.get("ok") is True and isinstance(cut_d1.get("undo"), str)
       and "trashed" not in cut_d1 and "location" not in cut_d1
       and bytes71(held_c(cut_d1.get("undo"), d1)) == uncut_d1
       and wav_frames(d1 / "Gtr.wav") == 2 * SR)
    mark_c = len(sent71)
    back_d1 = cr.undo_trash(cut_d1.get("undo"))
    ok("e. Undo of a draft's crop puts its WAVs and its .mid back, and says where",
       back_d1 == {"ok": True, "kind": "crop", "temp_dir": str(d1)} and bytes71(d1) == uncut_d1)
    ok("the cropped ones went to the Trash as one folder",
       sent_c(mark_c) == ["take 1 (cropped)"] and last_c("take 1 (cropped)") == cropped_d1)

    cut_d1 = cr.crop_draft(str(d1), tracks_d1, 1.0, 3.0, notes=[note_d1])
    live_c = Path(cr.rename_rehearsal(str(live_c), "Live renamed")["folder"])
    d1 = live_c / "_drafts" / "take 1"
    ok("and into its rehearsal's new folder when that was renamed meanwhile",
       cr.undo_trash(cut_d1.get("undo")) == {"ok": True, "kind": "crop", "temp_dir": str(d1)}
       and bytes71(d1) == uncut_d1)

    d2, tracks_d2, note_d2 = draft_c(2)
    uncut_d2 = bytes71(d2)
    cut_d2 = cr.crop_draft(str(d2), tracks_d2, 1.0, 3.0, notes=[note_d2])
    mark_c = len(sent71)
    cr._session["take_counter"] = 2
    kept_d2 = cr.keep_take(2, str(d2), "Kept", cut_d2.get("duration_sec"), tracks_d2,
                           notes=[note_d2])
    ok("h. saving a cropped draft sends its crop's entry to the Trash first, the draft as it was in it",
       kept_d2.get("ok") is True and cut_d2.get("undo") not in entries71(rec_c)
       and sent_c(mark_c) == ["take 2 (before crop)"] and last_c("take 2 (before crop)") == uncut_d2)

    d3, tracks_d3, note_d3 = draft_c(3)
    uncut_d3 = bytes71(d3)
    cut_d3 = cr.crop_draft(str(d3), tracks_d3, 1.0, 3.0, notes=[note_d3])
    cropped_d3 = bytes71(d3)
    mark_c = len(sent71)
    dropped_d3 = cr.discard_take(str(d3))
    ok("and so does discarding it: the crop's entry first, the draft as it was in it",
       dropped_d3.get("ok") is True and cut_d3.get("undo") not in entries71(rec_c)
       and sent_c(mark_c) == ["take 3 (before crop)"] and last_c("take 3 (before crop)") == uncut_d3)
    ok("and Undo of the discard brings back the draft cropped",
       cr.undo_trash(dropped_d3.get("undo")).get("ok") is True and bytes71(d3) == cropped_d3)

    # A draft discarded, and another one recorded under its name since: a
    # crop of the new one ends only an earlier crop of it, not that discard.
    d5, tracks_d5, note_d5 = draft_c(5)
    dropped_d5 = cr.discard_take(str(d5))
    d5, tracks_d5, note_d5 = draft_c(5)
    cut_d5 = cr.crop_draft(str(d5), tracks_d5, 1.0, 3.0, notes=[note_d5])
    ok("v. cropping a draft leaves the Undo of another draft discarded under its name waiting",
       dropped_d5.get("ok") is True and cut_d5.get("ok") is True
       and dropped_d5.get("undo") in entries71(rec_c) and cut_d5.get("undo") in entries71(rec_c))
    # A draft the app cannot tell an item for (_draft_identity None: a
    # folder it cannot place in the recordings folder), with others waiting.
    d6, tracks_d6, note_d6 = draft_c(6)
    uncut_d6 = bytes71(d6)
    cr._draft_identity = lambda *args, **kwargs: None
    cut_d6 = cr.crop_draft(str(d6), tracks_d6, 1.0, 3.0, notes=[note_d6])
    del cr._draft_identity
    ok("a draft the app cannot tell an item for is cropped all the same, and its crop undone",
       cut_d6.get("ok") is True
       and cr.undo_trash(cut_d6.get("undo")) == {"ok": True, "kind": "crop", "temp_dir": str(d6)}
       and bytes71(d6) == uncut_d6)
    # A discard of the draft arriving while it is being cropped, as from
    # another thread: before the crop's first os.replace, its files aside.
    d7, tracks_d7, note_d7 = draft_c(7)
    during_d7 = {}

    class Discarding_c:
        """os, except that the crop's first os.replace is preceded by a
        discard of the draft."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def replace(self, src, dst):
            if "answer" not in during_d7:
                during_d7["answer"] = cr.discard_take(str(d7))
                during_d7["keep"] = cr.keep_take(7, str(d7), "Kept", 4.0, tracks_d7,
                                                 notes=[note_d7])
                during_d7["recover"] = cr.recover_draft(str(d7))
            return os71.replace(src, dst)

    apimod_c.os = Discarding_c()
    cut_d7 = cr.crop_draft(str(d7), tracks_d7, 1.0, 3.0, notes=[note_d7])
    apimod_c.os = os71
    ok("a draft being cropped is not discarded meanwhile: that waits until the crop is done",
       during_d7.get("answer") == {"ok": False, "error": "Wait until the crop is done."}
       and cut_d7.get("ok") is True and wav_frames(d7 / "Gtr.wav") == 2 * SR)
    ok("nor saved, nor rescued as a take",
       during_d7.get("keep") == {"ok": False, "error": "Wait until the crop is done."}
       and during_d7.get("recover") == {"ok": False, "error": "Wait until the crop is done."})
    cr.end_trash(cut_d7.get("undo"))
    cr.end_trash(cut_d5.get("undo"))
    cr.end_trash(dropped_d5.get("undo"))

    d4, tracks_d4, note_d4 = draft_c(4)
    uncut_d4 = bytes71(d4)
    cut_d4 = cr.crop_draft(str(d4), tracks_d4, 1.0, 3.0, notes=[note_d4])
    cr.finish_rehearsal()
    mark_c = len(sent71)
    recovered_d4 = cr.recover_draft(str(d4))
    ok("and so does rescuing it from the Drafts screen",
       recovered_d4.get("ok") is True and cut_d4.get("undo") not in entries71(rec_c)
       and "take 4 (before crop)" in sent_c(mark_c)
       and last_c("take 4 (before crop)") == uncut_d4)

    print("  the app dies during an Undo")
    dir10 = take_c(cr, folder_c, 10, "Iyul", leftovers=True)
    uncut10 = bytes71(dir10)
    token10 = cr.crop_take(str(folder_c), 10, 1.0, 3.0).get("undo")
    cropped10 = bytes71(dir10)
    cr.add_take_marker(str(folder_c), 10, 2.0, "after", 2)
    cr._lib.uncrop_take = crash72
    try:
        cr.undo_trash(token10)
    except Crash72:
        pass
    del cr._lib.uncrop_take
    ok("(the uncut files are in their places, the take's marks and length not yet, and its "
       "entry says an Undo is under way)",
       bytes71(dir10) == uncut10 and length_c(cr, folder_c, 10) == 2.0
       and record_c(token10).get("rows") == "restoring")
    mark_c = len(sent71)
    cr_k = fresh_api(tmp_c)[1]
    opened_c.append(cr_k)
    ok("k. the next start finishes it: the take as it was, its marks and its length, and the "
       "cropped files in the Trash",
       bytes71(dir10) == uncut10 and length_c(cr_k, folder_c, 10) == 4.0
       and marks_c(cr_k, folder_c, 10) == [*marks_before[:2], (3.0, 2, "after"), marks_before[2]]
       and sent_c(mark_c) == [f"{dir10.name} (cropped)"]
       and last_c(f"{dir10.name} (cropped)") == cropped10 and token10 not in entries71(rec_c))

    dir11 = take_c(cr_k, folder_c, 11, "Avgust")
    uncut11 = bytes71(dir11)
    token11 = cr_k.crop_take(str(folder_c), 11, 1.0, 3.0).get("undo")
    cr_k.add_take_marker(str(folder_c), 11, 2.0, "after", 2)
    real_update_c = holding71.update

    def done_dies_c(recordings, token, record):
        if record.get("undone"):
            raise Crash72()
        return real_update_c(recordings, token, record)

    holding71.update = done_dies_c
    try:
        cr_k.undo_trash(token11)
    except Crash72:
        pass
    holding71.update = real_update_c
    ok("(the marks and the length are back, and the record still says an Undo is under way)",
       length_c(cr_k, folder_c, 11) == 4.0 and record_c(token11).get("rows") == "restoring")
    cr_k2 = fresh_api(tmp_c)[1]
    opened_c.append(cr_k2)
    ok("finished at the next start, the marks are put back once, not shifted again",
       marks_c(cr_k2, folder_c, 11) == [*marks_before[:2], (3.0, 2, "after"), marks_before[2]]
       and length_c(cr_k2, folder_c, 11) == 4.0 and bytes71(dir11) == uncut11
       and token11 not in entries71(rec_c))

    dir12 = take_c(cr_k2, folder_c, 12, "Sentyabr", leftovers=True)
    uncut12 = bytes71(dir12)
    token12 = cr_k2.crop_take(str(folder_c), 12, 1.0, 3.0).get("undo")
    cropped12 = bytes71(dir12)
    renames_c = {"n": 0}

    class Dying_c:
        """os, except that the app dies at the fourth rename of the exchange:
        Bass.wav exchanged, the cropped Drums.mid out of its place, the uncut
        one not yet in it."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            renames_c["n"] += 1
            if renames_c["n"] == 4:
                raise Crash72()
            return os71.rename(src, dst)

    holding71.os = Dying_c()
    try:
        cr_k2.undo_trash(token12)
    except Crash72:
        pass
    holding71.os = os71
    ok("(the app died with the take half exchanged, one of its places empty)",
       not (dir12 / "Drums.mid").exists() and (dir12 / "Bass.wav").read_bytes() == uncut12["Bass.wav"]
       and (dir12 / "Gtr.wav").read_bytes() == cropped12["Gtr.wav"]
       and record_c(token12).get("rows") == "restoring")
    mark_c = len(sent71)
    cr_k3 = fresh_api(tmp_c)[1]
    opened_c.append(cr_k3)
    ok("the next start finishes the exchange: every uncut file in its place, every cropped one in "
       "the Trash",
       bytes71(dir12) == uncut12 and length_c(cr_k3, folder_c, 12) == 4.0
       and sent_c(mark_c) == [f"{dir12.name} (cropped)"]
       and last_c(f"{dir12.name} (cropped)") == cropped12 and token12 not in entries71(rec_c))

    dir14 = take_c(cr_k3, folder_c, 14, "Noyabr")
    uncut14 = bytes71(dir14)
    token14 = cr_k3.crop_take(str(folder_c), 14, 1.0, 3.0).get("undo")
    cropped14 = bytes71(dir14)
    real_drop_c = holding71.drop_empty
    holding71.drop_empty = crash72
    try:
        cr_k3.undo_trash(token14)
    except Crash72:
        pass
    holding71.drop_empty = real_drop_c
    ok("(the app died once the Undo was recorded as done, the folder the uncut files waited in "
       "still there, empty)",
       bytes71(dir14) == uncut14 and record_c(token14).get("undone") is True
       and held_c(token14, dir14).is_dir() and not any(held_c(token14, dir14).iterdir()))
    ok("q. an Undo done, whatever is left of its entry, is done: another says the take is back "
       "where it was, and the marks stay as they came back",
       cr_k3.undo_trash(token14) == BACK71
       and marks_c(cr_k3, folder_c, 14) == marks_before and length_c(cr_k3, folder_c, 14) == 4.0
       and bytes71(dir14) == uncut14)
    mark_c = len(sent71)
    ok("and its end sends on only the cropped files, not the empty folder",
       cr_k3.end_trash(token14) == {"ok": True} and sent_c(mark_c) == [f"{dir14.name} (cropped)"]
       and last_c(f"{dir14.name} (cropped)") == cropped14 and token14 not in entries71(rec_c)
       and bytes71(dir14) == uncut14)

    print("  two files of one name")
    # A take whose tracks are in two folders, one file name in both: put
    # aside into one folder, the second would land on the first.
    dir15 = folder_c / "15 - Dekabr"
    other15 = folder_c / "15 - Dekabr, the rest" / "Gtr.wav"
    write_wav(dir15 / "Gtr.wav", 615, seconds=4.0)
    write_wav(other15, 915, seconds=4.0)
    cr_k3._lib.add_take(folder_c, {
        "take_number": 15, "name": "Dekabr", "duration_sec": 4.0,
        "tracks": [{"name": "Gtr", "file": str(dir15 / "Gtr.wav")},
                   {"name": "Bass", "file": str(other15)}],
        "notes": [], "markers": []})
    both15 = (bytes71(dir15), bytes71(other15.parent))
    mark_c = len(sent71)
    cut15 = cr_k3.crop_take(str(folder_c), 15, 1.0, 3.0)
    ok("r. a crop of a take two of whose files have one name, in two folders, is refused, and "
       "both stay as they were",
       cut15.get("ok") is False
       and "two of the take's files are called Gtr.wav" in str(cut15.get("error"))
       and (bytes71(dir15), bytes71(other15.parent)) == both15
       and length_c(cr_k3, folder_c, 15) == 4.0 and sent_c(mark_c) == []
       and not (folder_c / f"{dir15.name} (before crop)").exists())

    print("  its marks changed meanwhile")
    take_c(cr_k3, folder_c, 16, "Yanvar")
    token16 = cr_k3.crop_take(str(folder_c), 16, 1.0, 3.0).get("undo")
    cr_k3.update_take_marker(str(folder_c), 16, 0.5, note="there")
    ok("s. a mark the crop kept, its note changed since, comes back at its time before the crop "
       "with its new note",
       cr_k3.undo_trash(token16).get("ok") is True
       and marks_c(cr_k3, folder_c, 16) == [(0.5, 1, "count-in"), (1.5, 2, "there"),
                                            (3.8, 3, "stopped")])
    take_c(cr_k3, folder_c, 17, "Fevral")
    token17 = cr_k3.crop_take(str(folder_c), 17, 1.0, 3.0).get("undo")
    cr_k3.remove_take_marker(str(folder_c), 17, 0.5)
    ok("and one deleted since stays deleted",
       cr_k3.undo_trash(token17).get("ok") is True
       and marks_c(cr_k3, folder_c, 17) == [(0.5, 1, "count-in"), (3.8, 3, "stopped")])

    print("  a place taken while the app is down")
    dir18 = take_c(cr_k3, folder_c, 18, "Aprel", leftovers=True)
    uncut18 = bytes71(dir18)
    token18 = cr_k3.crop_take(str(folder_c), 18, 1.0, 3.0).get("undo")
    cropped18 = bytes71(dir18)
    renames_c["n"] = 0
    holding71.os = Dying_c()
    try:
        cr_k3.undo_trash(token18)
    except Crash72:
        pass
    holding71.os = os71
    (dir18 / "take.json").write_bytes(b"someone else's")
    mark_c = len(sent71)
    cr_t = fresh_api(tmp_c)[1]
    opened_c.append(cr_t)
    ok("t. an Undo the app died in, one of whose places something else took meanwhile, is taken "
       "back at the next start: the take cropped and whole, and that something as it was",
       bytes71(dir18) == {**cropped18, "take.json": b"someone else's"}
       and length_c(cr_t, folder_c, 18) == 2.0 and marks_c(cr_t, folder_c, 18) == [(0.5, 2, "here")])
    ok("and its notice being over, the take as it was goes to the Trash, every file of it",
       sent_c(mark_c) == [f"{dir18.name} (before crop)"]
       and last_c(f"{dir18.name} (before crop)") == uncut18 and token18 not in entries71(rec_c))

    print("  its rehearsal's folder not there at the next start")
    dir19 = take_c(cr_t, folder_c, 19, "Maiskaya", leftovers=True)
    uncut19 = bytes71(dir19)
    token19 = cr_t.crop_take(str(folder_c), 19, 1.0, 3.0).get("undo")
    cropped19 = bytes71(dir19)
    renames_c["n"] = 0
    holding71.os = Dying_c()
    try:
        cr_t.undo_trash(token19)
    except Crash72:
        pass
    holding71.os = os71
    entry19 = rec_c / "_deleting" / str(token19)
    held19 = bytes71(entry19)
    os71.rename(folder_c, tmp_c / "unplugged")
    mark_c = len(sent71)
    cr_u = fresh_api(tmp_c)[1]
    opened_c.append(cr_u)
    problems_u = cr_u.startup_problems()
    ok("u. an Undo the app died in, its rehearsal's folder not on disk at the next start, waits "
       "as it is, and nothing goes to the Trash",
       record_c(token19).get("rows") == "restoring" and bytes71(entry19) == held19
       and sent_c(mark_c) == [])
    ok("said once among the start problems, naming its folder",
       [p["name"] for p in problems_u] == ["RemovalKept"]
       and str(entry19) in problems_u[0]["message"])
    os71.rename(tmp_c / "unplugged", folder_c)
    cr_u2 = fresh_api(tmp_c)[1]
    opened_c.append(cr_u2)
    ok("and once the folder is back, the next start finishes the Undo",
       bytes71(dir19) == uncut19 and length_c(cr_u2, folder_c, 19) == 4.0
       and marks_c(cr_u2, folder_c, 19) == marks_before
       and sent_c(mark_c) == [f"{dir19.name} (cropped)"]
       and last_c(f"{dir19.name} (cropped)") == cropped19 and token19 not in entries71(rec_c))

    print("  its take gone from the library")
    dir20 = take_c(cr_u2, folder_c, 20, "Iyun")
    uncut20 = bytes71(dir20)
    token20 = cr_u2.crop_take(str(folder_c), 20, 1.0, 3.0).get("undo")
    cropped20 = bytes71(dir20)
    cr_u2._lib.delete_take(folder_c, 20)
    ok("w. Undo of a crop whose take the library no longer has says so, and moves nothing",
       cr_u2.undo_trash(token20) == {"ok": False, "error": "Its take is gone."}
       and bytes71(dir20) == cropped20 and bytes71(held_c(token20, dir20)) == uncut20
       and record_c(token20).get("rows") == "none")
    cr_u2.end_trash(token20)

    print("  the library failing before anything moves")
    dir21 = take_c(cr_u2, folder_c, 21, "Rassvet")
    uncut21 = bytes71(dir21)
    token21 = cr_u2.crop_take(str(folder_c), 21, 1.0, 3.0).get("undo")
    cropped21 = bytes71(dir21)
    cr_u2._lib.take_record = locked_c
    read21 = cr_u2.undo_trash(token21)
    del cr_u2._lib.take_record
    ok("an Undo whose take the library cannot read says so, and moves nothing",
       read21 == {"ok": False, "error": "Could not put it back: database is locked"}
       and bytes71(dir21) == cropped21 and bytes71(held_c(token21, dir21)) == uncut21
       and record_c(token21).get("rows") == "none")
    cr_u2.end_trash(token21)

    print("  a second crop that fails")
    dir22 = take_c(cr_u2, folder_c, 22, "Zakat")
    uncut22 = bytes71(dir22)
    first22 = cr_u2.crop_take(str(folder_c), 22, 1.0, 3.0)
    cropped22 = bytes71(dir22)
    real_crop_wav_c = apimod_c.crop_wav

    def unreadable_c(src, dst, start_sec, end_sec, progress=None, **kwargs):
        return {"ok": False, "error": "The file cannot be read"}

    apimod_c.crop_wav = unreadable_c
    second22 = cr_u2.crop_take(str(folder_c), 22, 0.25, 1.75)
    apimod_c.crop_wav = real_crop_wav_c
    ok("a second crop that fails leaves the first one's Undo waiting",
       second22.get("ok") is False and bytes71(dir22) == cropped22
       and first22.get("undo") in entries71(rec_c))
    ok("and that Undo brings back the take as it was",
       cr_u2.undo_trash(first22.get("undo")).get("ok") is True and bytes71(dir22) == uncut22
       and length_c(cr_u2, folder_c, 22) == 4.0)

    print("  an Undo that cannot be taken back")
    dir23 = take_c(cr_u2, folder_c, 23, "Polden")
    uncut23 = bytes71(dir23)
    token23 = cr_u2.crop_take(str(folder_c), 23, 1.0, 3.0).get("undo")
    cropped23 = bytes71(dir23)
    jammed_c = {"place": dir23 / "Gtr.wav"}

    class Jammed_c:
        """os, except that nothing goes into one place: neither the uncut
        Gtr.wav nor, when that is taken back, the cropped one."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            if Path(dst) == jammed_c["place"]:
                raise PermissionError(13, "The file is being used by another process", str(src))
            return os71.rename(src, dst)

    holding71.os = Jammed_c()
    stuck23 = cr_u2.undo_trash(token23)
    holding71.os = os71
    ok("an Undo that fails part way and cannot be taken back says it will be finished",
       stuck23 == {"ok": False, "finishing": True,
                   "error": "It is being put back; it will be finished when the notice goes."}
       and record_c(token23).get("rows") == "restoring")
    mark_c = len(sent71)
    ok("and the end of its notice finishes it: the take as it was, the cropped files in the Trash",
       cr_u2.end_trash(token23) == {"ok": True} and bytes71(dir23) == uncut23
       and length_c(cr_u2, folder_c, 23) == 4.0 and marks_c(cr_u2, folder_c, 23) == marks_before
       and sent_c(mark_c) == [f"{dir23.name} (cropped)"]
       and last_c(f"{dir23.name} (cropped)") == cropped23 and token23 not in entries71(rec_c))
    dir24 = take_c(cr_u2, folder_c, 24, "Polnoch")
    uncut24 = bytes71(dir24)
    token24 = cr_u2.crop_take(str(folder_c), 24, 1.0, 3.0).get("undo")
    jammed_c["place"] = dir24 / "Gtr.wav"
    holding71.os = Jammed_c()
    cr_u2.undo_trash(token24)
    holding71.os = os71
    again24 = cr_u2.crop_take(str(folder_c), 24, 1.0, 3.0)
    ok("a crop of a take whose Undo was left part way finishes that Undo first, and crops the "
       "take as it was",
       again24.get("ok") is True and token24 not in entries71(rec_c)
       and bytes71(held_c(again24.get("undo"), dir24)) == uncut24
       and wav_frames(dir24 / "Gtr.wav") == 2 * SR and length_c(cr_u2, folder_c, 24) == 2.0)
    cr_u2.end_trash(again24.get("undo"))

    print("  the app dies before an Undo's cloud step")
    take_c(cr_u2, folder_c, 25, "Tuman")
    cr_u2._copy_to_cloud(str(folder_c), 25, "mix")
    token25 = cr_u2.crop_take(str(folder_c), 25, 1.0, 3.0).get("undo")
    drain_c(cr_u2)
    copy25 = Path((cr_u2._lib.take(folder_c, 25)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    holding71.drop_empty = crash72
    try:
        cr_u2.undo_trash(token25)
    except Crash72:
        pass
    holding71.drop_empty = real_drop_c
    ok("(the app died with the Undo recorded as done, the cropped copy still in the cloud folder)",
       record_c(token25).get("undone") is True and copy25.is_file()
       and wav_frames(copy25) == 2 * SR)
    cr_v = fresh_api(tmp_c)[1]
    opened_c.append(cr_v)
    ok("the next start takes the cropped copy out of the cloud folder, and asks for the take as "
       "it was to be copied there",
       not copy25.exists() and copy25 in sent71
       and cr_v._cloud_queue.states(str(folder_c)).get(25) == "queued"
       and token25 not in entries71(rec_c))
    drain_c(cr_v)
    again25 = Path((cr_v._lib.take(folder_c, 25)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    ok("which is then the take as it was", again25.is_file() and wav_frames(again25) == 4 * SR)

    dir26 = take_c(cr_v, folder_c, 26, "Veter")
    uncut26 = bytes71(dir26)
    cr_v._copy_to_cloud(str(folder_c), 26, "mix")
    token26 = cr_v.crop_take(str(folder_c), 26, 1.0, 3.0).get("undo")
    drain_c(cr_v)
    copy26 = Path((cr_v._lib.take(folder_c, 26)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    cr_v._lib.cloud_paths = locked_c
    back26 = cr_v.undo_trash(token26)
    del cr_v._lib.cloud_paths
    ok("an Undo whose cloud step the library refuses is done all the same",
       back26.get("ok") is True and bytes71(dir26) == uncut26
       and length_c(cr_v, folder_c, 26) == 4.0)
    ok("and its entry waits with that step, which its end does",
       token26 in entries71(rec_c) and isinstance(record_c(token26).get("cloud"), dict)
       and cr_v.end_trash(token26) == {"ok": True} and not copy26.exists()
       and cr_v._cloud_queue.states(str(folder_c)).get(26) == "queued"
       and token26 not in entries71(rec_c))
    drain_c(cr_v)

    print("  its cloud copy changed while the crop waited")
    take_c(cr_v, folder_c, 27, "Grom")
    cr_v._copy_to_cloud(str(folder_c), 27, "mix")
    token27 = cr_v.crop_take(str(folder_c), 27, 1.0, 3.0).get("undo")
    drain_c(cr_v)
    cr_v.unshare_take(str(folder_c), 27)
    cr_v.undo_trash(token27)
    ok("a take taken out of the cloud folder since its crop is not sent there again by its Undo",
       length_c(cr_v, folder_c, 27) == 4.0 and cr_v._lib.take(folder_c, 27)["cloud"] == {}
       and cr_v._cloud_queue.states(str(folder_c)).get(27) is None)
    take_c(cr_v, folder_c, 28, "Sneg")
    token28 = cr_v.crop_take(str(folder_c), 28, 1.0, 3.0).get("undo")
    cr_v.share_take(str(folder_c), 28, "mix")
    drain_c(cr_v)
    copy28 = Path((cr_v._lib.take(folder_c, 28)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    ok("(the cropped take was sent to the cloud folder while its crop waited)",
       copy28.is_file() and wav_frames(copy28) == 2 * SR)
    cr_v.undo_trash(token28)
    ok("and one sent there since has its cropped copy taken out, and is sent there again",
       not copy28.exists() and copy28 in sent71
       and cr_v._cloud_queue.states(str(folder_c)).get(28) == "queued")
    drain_c(cr_v)
    again28 = Path((cr_v._lib.take(folder_c, 28)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    ok("the take as it was, as a mix", again28.is_file() and wav_frames(again28) == 4 * SR)

    print("  an Undo that cannot say it is under way")
    dir29 = take_c(cr_v, folder_c, 29, "Led")
    token29 = cr_v.crop_take(str(folder_c), 29, 1.0, 3.0).get("undo")
    cropped29 = bytes71(dir29)
    cr_v.player_open(cr_v._lib.take(folder_c, 29)["tracks"])

    def restoring_full_c(recordings, token, record):
        if record.get("rows") == "restoring":
            raise OSError(28, "No space left on device")
        return real_update_c(recordings, token, record)

    holding71.update = restoring_full_c
    full29 = cr_v.undo_trash(token29)
    holding71.update = real_update_c
    ok("an Undo that cannot record that it is under way says so, moves nothing, and opens "
       "again the take it was playing",
       full29.get("ok") is False and "No space" in str(full29.get("error"))
       and bytes71(dir29) == cropped29 and record_c(token29).get("rows") == "none"
       and cr_v.player_state().get("open") is True)
    cr_v.player_close()
    cr_v.end_trash(token29)

    print("  a crop and a copy another take names")
    take_c(cr_v, folder_c, 30, "Iney")
    cr_v._copy_to_cloud(str(folder_c), 30, "mix")
    copy30 = Path((cr_v._lib.take(folder_c, 30)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    cr_v._lib.set_cloud_copy(folder_c, 29, {"mix": str(copy30), "mix_format": "wav"}, drive_c)
    token30 = cr_v.crop_take(str(folder_c), 30, 1.0, 3.0).get("undo")
    ok("a crop leaves its take's cloud copy when another take names it now",
       copy30.is_file() and wav_frames(copy30) == 4 * SR
       and cr_v._lib.take(folder_c, 29)["cloud"].get("mix") == str(copy30))
    cr_v._lib.set_cloud_copy(folder_c, 29, None, None)
    drain_c(cr_v)
    cr_v.end_trash(token30)

    print("  an Undo while the take is cropped again")
    dir31 = take_c(cr_v, folder_c, 31, "Kapel")
    uncut31 = bytes71(dir31)
    first31 = cr_v.crop_take(str(folder_c), 31, 1.0, 3.0)
    cropped31 = bytes71(dir31)
    during31 = {}

    class Racing_c:
        """os, except that before the second crop's first os.replace (its
        originals aside, its new files written) the first crop is undone and
        the take deleted, as from other threads; then that replace fails, and
        the second crop with it."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def replace(self, src, dst):
            if "undo" not in during31:
                during31["undo"] = cr_v.undo_trash(first31.get("undo"))
                during31["delete"] = cr_v.delete_take(str(folder_c), 31)
                during31["takes"] = cr_v.delete_takes(str(folder_c), [31])
                during31["rehearsal"] = cr_v.delete_rehearsal(str(folder_c))
                during31["rename"] = cr_v.rename_take(str(folder_c), 31, "Kapel renamed")
                during31["rehearsal_rename"] = cr_v.rename_rehearsal(str(folder_c), "Crops renamed")
                during31["held"] = bytes71(held_c(first31.get("undo"), dir31))
                during31["aside"] = bytes71(folder_c / f"{dir31.name} (before crop)")
                during31["writing"] = sorted(
                    n for n in bytes71(dir31) if n.startswith(apimod_c.WRITING_PREFIX))
                raise OSError(5, "Input/output error", str(dst))
            return os71.replace(src, dst)

    apimod_c.os = Racing_c()
    second31 = cr_v.crop_take(str(folder_c), 31, 0.25, 1.75)
    apimod_c.os = os71
    wait_c = {"ok": False, "error": "Wait until the crop is done."}
    ok("an Undo of a take's crop while the take is being cropped again waits until that crop "
       "is done, and so does deleting the take",
       during31.get("undo") == wait_c and during31.get("delete") == wait_c)
    ok("on its own, with others, or with its rehearsal",
       during31.get("takes") == {"ok": True, "deleted": [], "undo": None, "ended": [], "failed": [
           {"take_number": 31, "error": "Wait until the crop is done."}]}
       and during31.get("rehearsal") == wait_c)
    ok("and renaming the take or its rehearsal",
       during31.get("rename") == wait_c and during31.get("rehearsal_rename") == wait_c)
    ok("every version of the take on disk meanwhile: as it was, in the first crop's entry; "
       "cropped once, beside the take; cropped twice, being written",
       during31.get("held") == uncut31 and during31.get("aside") == cropped31
       and during31.get("writing") == sorted(apimod_c.WRITING_PREFIX + n
                                             for n in ("Bass.wav", "Drums.mid", "Gtr.wav")))
    ok("the second crop failing, the take is as the first one left it, and that crop's Undo "
       "still waits",
       second31.get("ok") is False and bytes71(dir31) == cropped31
       and first31.get("undo") in entries71(rec_c))
    ok("and brings back the take as it was",
       cr_v.undo_trash(first31.get("undo")).get("ok") is True and bytes71(dir31) == uncut31
       and length_c(cr_v, folder_c, 31) == 4.0)

    print("  an end that cannot finish an Undo")

    def aside_c(token, take_dir):
        """Where a crop's entry holds the cropped files during its Undo."""
        return rec_c / "_deleting" / str(token) / "1" / f"{take_dir.name} (cropped)"

    def versions_c(take_dir, token):
        """Every file of a take's two versions, wherever each is: in its
        place, or in its crop's entry."""
        entry = rec_c / "_deleting" / str(token)
        return sorted([*bytes71(take_dir).values(),
                       *(b for name, b in bytes71(entry).items()
                         if not name.endswith("record.json"))])

    def stuck_c(api, number, title):
        """A take cropped, and its crop's Undo left part way, as the 23rd
        was: Gtr.wav's place would take neither version."""
        take_dir = take_c(api, folder_c, number, title)
        uncut = bytes71(take_dir)
        token = api.crop_take(str(folder_c), number, 1.0, 3.0).get("undo")
        cropped = bytes71(take_dir)
        jammed_c["place"] = take_dir / "Gtr.wav"
        holding71.os = Jammed_c()
        api.undo_trash(token)
        holding71.os = os71
        return take_dir, uncut, cropped, token

    dir32, uncut32, cropped32, token32 = stuck_c(cr_v, 32, "Rosa")
    cr_v._lib.uncrop_take = locked_c
    mark_c = len(sent71)
    ended32 = cr_v.end_trash(token32)
    del cr_v._lib.uncrop_take
    ok("an end whose library refuses an Undo left part way keeps it under way, both versions "
       "of the take on disk, and nothing in the Trash",
       ended32 == {"ok": False, "error": "database is locked"}
       and record_c(token32).get("rows") == "restoring"
       and bytes71(dir32) == uncut32 and bytes71(aside_c(token32, dir32)) == cropped32
       and sent_c(mark_c) == [])
    ok("and the next end finishes it",
       cr_v.end_trash(token32) == {"ok": True} and bytes71(dir32) == uncut32
       and length_c(cr_v, folder_c, 32) == 4.0 and marks_c(cr_v, folder_c, 32) == marks_before
       and sent_c(mark_c) == [f"{dir32.name} (cropped)"] and token32 not in entries71(rec_c))

    dir33, uncut33, cropped33, token33 = stuck_c(cr_v, 33, "Lilia")

    def unavailable_c(*args, **kwargs):
        raise apimod_c.LibraryUnavailable("The library is not open")

    cr_v._lib.uncrop_take = unavailable_c
    mark_c = len(sent71)
    ended33 = cr_v.end_trash(token33)
    del cr_v._lib.uncrop_take
    ok("and so does one whose library is not open",
       ended33 == {"ok": False, "error": "The library is not open"}
       and record_c(token33).get("rows") == "restoring"
       and bytes71(dir33) == uncut33 and bytes71(aside_c(token33, dir33)) == cropped33
       and sent_c(mark_c) == [])
    cr_x = fresh_api(tmp_c)[1]
    opened_c.append(cr_x)
    ok("which the next start finishes",
       bytes71(dir33) == uncut33 and length_c(cr_x, folder_c, 33) == 4.0
       and sent_c(mark_c) == [f"{dir33.name} (cropped)"] and token33 not in entries71(rec_c))

    dir34, uncut34, cropped34, token34 = stuck_c(cr_x, 34, "Fialka")
    forward_c = {"place": dir34 / "Gtr.wav"}

    class Forward_c:
        """os, except that the uncut Gtr.wav will not go into its place
        (Windows holding it, say); the cropped one would go back."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def rename(self, src, dst):
            if Path(dst) == forward_c["place"] and "(before crop)" in str(src):
                raise PermissionError(13, "The file is being used by another process", str(src))
            return os71.rename(src, dst)

    holding71.os = Forward_c()
    mark_c = len(sent71)
    ended34 = cr_x.end_trash(token34)
    holding71.os = os71
    ok("an end whose exchange fails on the way keeps the Undo under way, what moved staying "
       "moved, every file of both versions on disk, and nothing in the Trash",
       ended34.get("ok") is False and "being used" in str(ended34.get("error"))
       and record_c(token34).get("rows") == "restoring" and sent_c(mark_c) == []
       and versions_c(dir34, token34) == sorted([*uncut34.values(), *cropped34.values()])
       and (dir34 / "Bass.wav").read_bytes() == uncut34["Bass.wav"])
    ok("and the next end finishes it",
       cr_x.end_trash(token34) == {"ok": True} and bytes71(dir34) == uncut34
       and length_c(cr_x, folder_c, 34) == 4.0
       and sent_c(mark_c) == [f"{dir34.name} (cropped)"] and token34 not in entries71(rec_c))

    print("  an end the library fails")
    take_c(cr_x, folder_c, 35, "Romashka")
    cr_x._copy_to_cloud(str(folder_c), 35, "mix")
    token35 = cr_x.crop_take(str(folder_c), 35, 1.0, 3.0).get("undo")
    drain_c(cr_x)
    copy35 = Path((cr_x._lib.take(folder_c, 35)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    cr_x._lib.cloud_paths = locked_c
    cr_x.undo_trash(token35)
    try:
        ended35 = cr_x.end_trash(token35)
    except RuntimeError as e:
        ended35 = {"raised": str(e)}
    del cr_x._lib.cloud_paths
    ok("an end the library fails part way says so, and its entry waits for the next end",
       ended35 == {"ok": False, "error": "database is locked"} and token35 in entries71(rec_c))
    ok("which does it: the cropped copy out of the cloud folder, the take as it was asked for",
       copy35.is_file() and cr_x.end_trash(token35) == {"ok": True}
       and token35 not in entries71(rec_c) and not copy35.exists()
       and cr_x._cloud_queue.states(str(folder_c)).get(35) == "queued")
    drain_c(cr_x)

    print("  a crop whose library fails before it starts")
    dir36 = take_c(cr_x, folder_c, 36, "Vasilek")
    uncut36 = bytes71(dir36)
    waiting36 = entries71(rec_c)
    cr_x._lib.cloud_paths = locked_c
    try:
        cut36 = cr_x.crop_take(str(folder_c), 36, 1.0, 3.0)
    except RuntimeError as e:
        cut36 = {"raised": str(e)}
    del cr_x._lib.cloud_paths
    ok("a crop whose library fails before it starts says so, and changes nothing: the take's "
       "files, marks and length as they were, and nothing held",
       cut36 == {"ok": False, "error": "Could not crop: database is locked", "ended": []}
       and bytes71(dir36) == uncut36 and length_c(cr_x, folder_c, 36) == 4.0
       and marks_c(cr_x, folder_c, 36) == marks_before and entries71(rec_c) == waiting36
       and not (folder_c / f"{dir36.name} (before crop)").exists())

    print("  a copy another take came to name during the crop")
    take_c(cr_x, folder_c, 37, "Klever")
    cr_x._copy_to_cloud(str(folder_c), 37, "mix")
    copy37 = Path((cr_x._lib.take(folder_c, 37)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    named37 = {}

    class Recording_c:
        """os, except that at the crop's first os.replace the copy worker
        records another take's copy in this take's place in the cloud
        folder, as from its own thread."""

        def __getattr__(self, name):
            return getattr(os71, name)

        def replace(self, src, dst):
            if not named37:
                named37["done"] = cr_x._lib.set_cloud_copy(
                    folder_c, 36, {"mix": str(copy37), "mix_format": "wav"}, drive_c)
            return os71.replace(src, dst)

    apimod_c.os = Recording_c()
    token37 = cr_x.crop_take(str(folder_c), 37, 1.0, 3.0).get("undo")
    apimod_c.os = os71
    ok("a crop leaves its take's cloud copy when another take came to name it during the crop",
       named37.get("done") is True and isinstance(token37, str)
       and copy37.is_file() and wav_frames(copy37) == 4 * SR
       and cr_x._lib.take(folder_c, 36)["cloud"].get("mix") == str(copy37))
    cr_x._lib.set_cloud_copy(folder_c, 36, None, None)
    drain_c(cr_x)
    cr_x.end_trash(token37)

    take_c(cr_x, folder_c, 38, "Myata")
    cr_x._copy_to_cloud(str(folder_c), 38, "mix")
    copy38 = Path((cr_x._lib.take(folder_c, 38)["cloud"] or {}).get("mix") or tmp_c / "nowhere")
    real_paths_c = cr_x._lib.cloud_paths
    asked38 = []

    def once_c(but=None):
        """cloud_paths, answering before the crop and failing after it."""
        asked38.append(but)
        if len(asked38) > 1:
            raise RuntimeError("database is locked")
        return real_paths_c(but=but)

    cr_x._lib.cloud_paths = once_c
    cut38 = cr_x.crop_take(str(folder_c), 38, 1.0, 3.0)
    del cr_x._lib.cloud_paths
    ok("and when which copies other takes name cannot be read after the crop, the crop is done "
       "and the old copy is left in the cloud folder",
       cut38.get("ok") is True and length_c(cr_x, folder_c, 38) == 2.0
       and copy38.is_file() and wav_frames(copy38) == 4 * SR)
    drain_c(cr_x)
    cr_x.end_trash(cut38.get("undo"))

    print("  its rehearsal gone")
    dir13 = take_c(cr_x, folder_c, 13, "Oktyabr")
    token13 = cr_x.crop_take(str(folder_c), 13, 1.0, 3.0).get("undo")
    cropped13 = bytes71(dir13)
    cr_x.forget_rehearsal(str(folder_c))
    ok("o. Undo of a crop whose rehearsal is gone says so, and moves nothing",
       cr_x.undo_trash(token13) == {"ok": False, "error": "Its rehearsal is gone."}
       and bytes71(dir13) == cropped13 and token13 in entries71(rec_c))
    cr_x.end_trash(token13)

    cr_x.shutdown()
    for api_c in opened_c[:-1]:
        api_c._library.close()
    apimod_c.move_to_trash = real_trash71

    print("\n[74] Python says which removals it ended")
    # A removal's Undo is offered by a notice. Python ends a waiting entry of
    # its own accord when the same item is removed again (_end_before): a
    # second crop of a take ends the first's, deleting the take ends its
    # crop's, deleting a rehearsal ends everything of it, saving a draft ends
    # its crop's. A notice still offering Undo for one of those would only
    # be told it has gone, so every call that ends one answers which:
    # "ended", the tokens. The interface lets their notices go. Python knows
    # an item by its rehearsal's id, which a rename does not change, so the
    # interface has no matching of its own to do.
    tmp74 = Path(tempfile.mkdtemp())
    apimod74, e74 = fresh_api(tmp74)
    rec74 = e74.recordings_dir
    apimod74.move_to_trash = trash71
    folder74 = rec74 / "Ends - 2026-10-11 20-00"
    e74._lib.create_rehearsal(folder74, "Ends", "2026-10-11T20:00:00", SR, 16, band_c)

    take_c(e74, folder74, 1, "Polyn")
    first74 = e74.crop_take(str(folder74), 1, 0.5, 3.5)
    second74 = e74.crop_take(str(folder74), 1, 0.5, 2.5)
    ok("a. a first crop ends nothing, and says so",
       first74.get("ok") is True and first74.get("ended") == [])
    ok("a second crop of the take answers the first crop's token as ended",
       second74.get("ok") is True and second74.get("ended") == [first74.get("undo")]
       and first74.get("undo") not in entries71(rec74))
    gone74 = e74.delete_take(str(folder74), 1)
    ok("b. deleting the take after its crop answers the crop's token as ended",
       gone74.get("ok") is True and gone74.get("ended") == [second74.get("undo")])

    take_c(e74, folder74, 2, "Vesna")
    take_c(e74, folder74, 3, "Ogon")
    crop74 = e74.crop_take(str(folder74), 2, 0.5, 3.5)
    cleared74 = e74.delete_takes(str(folder74), [2, 3])
    ok("and so does clearing it with others",
       cleared74.get("ok") is True and cleared74.get("ended") == [crop74.get("undo")])

    wed74 = past71(e74, "Wednesday", "2026-09-30T19:00:00", ["Polyn", "Vesna"])
    take74 = e74.delete_take(str(wed74), 2)
    draft74 = wed74 / "_drafts" / "take 3"
    write_wav(draft74 / "Gtr.wav", 74, seconds=1.0)
    dropped74 = e74.discard_draft(str(draft74))
    whole74 = e74.delete_rehearsal(str(wed74))
    ok("c. deleting a rehearsal answers the tokens of its take's and its draft's entries",
       whole74.get("ok") is True
       and sorted(whole74.get("ended") or []) == sorted([take74.get("undo"), dropped74.get("undo")]))
    e74.end_trash(whole74.get("undo"))

    e74.start_rehearsal("Live", None, SR, band_c[:2], 16)
    live74 = Path(e74._session["folder"])

    def draft74_(n):
        """A draft on the review screen, four seconds of two WAVs."""
        where = live74 / "_drafts" / f"take {n}"
        write_wav(where / "Gtr.wav", 740 + n, seconds=4.0)
        write_wav(where / "Bass.wav", 750 + n, seconds=4.0)
        return where, [{"name": "Gtr", "file": str(where / "Gtr.wav")},
                       {"name": "Bass", "file": str(where / "Bass.wav")}]

    d74, tracks74 = draft74_(1)
    cut74 = e74.crop_draft(str(d74), tracks74, 1.0, 3.0)
    again74 = e74.crop_draft(str(d74), tracks74, 0.5, 1.5)
    ok("a draft cropped twice answers the first crop's token as ended",
       again74.get("ok") is True and again74.get("ended") == [cut74.get("undo")])
    e74._session["take_counter"] = 1
    kept74 = e74.keep_take(1, str(d74), "Kept", again74.get("duration_sec"), tracks74)
    ok("d. saving a cropped draft answers its crop's token as ended",
       kept74.get("ok") is True and kept74.get("ended") == [again74.get("undo")])

    d74, tracks74 = draft74_(2)
    cut74 = e74.crop_draft(str(d74), tracks74, 1.0, 3.0)
    thrown74 = e74.discard_take(str(d74))
    ok("e. and so does discarding one",
       thrown74.get("ok") is True and thrown74.get("ended") == [cut74.get("undo")])

    d74, tracks74 = draft74_(3)
    cut74 = e74.crop_draft(str(d74), tracks74, 1.0, 3.0)
    e74.finish_rehearsal()
    saved74 = e74.recover_draft(str(d74))
    ok("and rescuing one from the Drafts screen",
       saved74.get("ok") is True and saved74.get("ended") == [cut74.get("undo")])

    waiting74 = entries71(rec74)
    moved74 = e74.set_recordings_dir(str(tmp74 / "Elsewhere"))
    ok("f. switching the recordings folder answers every token it ended there",
       moved74.get("ok") is True and thrown74.get("undo") in waiting74
       and sorted(moved74.get("ended") or []) == waiting74)

    e74.shutdown()
    apimod74.move_to_trash = real_trash71

    print("\n[75] Undo names the system's bin")
    # Spec P2: what the app says of the Trash is in the system's own words,
    # "the Recycle Bin" on Windows, and "the _deleted folder" where there is
    # no Trash to reach (platform_support.trash_kind). Python's own sentences
    # say it too: an Undo too late, which also answers "gone" so that the
    # interface can word it itself, the start problem for removals kept, and
    # a Trash that refused without saying why. An Undo of what is back where
    # it was, by an Undo or by an end, says that instead: it is not gone.
    tmp75 = Path(tempfile.mkdtemp())
    apimod75, g75 = fresh_api(tmp75)
    rec75 = g75.recordings_dir
    apimod75.move_to_trash = trash71
    sat75 = past71(g75, "Saturday", "2026-10-03T19:00:00", ["Polyn", "Vesna", "Ogon"])
    late75 = g75.delete_take(str(sat75), 1).get("undo")
    g75.end_trash(late75)
    held75 = rec75 / "Loose" / "f"
    held75.mkdir(parents=True)
    (held75 / "f.wav").write_bytes(b"loose")
    refused75 = holding71.hold(rec75, {"kind": "draft", "reason": "discard", "rows": "none"},
                               [held75])
    kept75 = [{"folder": "/rec/_deleting/0123abcd", "error": "busy", "library": False}]
    was75 = ps71._send2trash, ps71._system_trash_dir, ps71.WINDOWS

    def said75():
        """(the Undo too late, the start problem, a refusal that says nothing)
        as Python words them now."""
        return (g75.undo_trash(late75), apimod75._removals_kept(kept75),
                holding71.send_on(rec75, refused75, lambda path, root: {"ok": False}))

    try:
        ps71._send2trash, ps71._system_trash_dir = (lambda: None), (lambda: None)
        late, start, refused = said75()
        ok("a. with no Trash on the machine an Undo too late says it moved to the _deleted "
           "folder, and answers that it is gone",
           late == {"ok": False, "gone": True,
                    "error": "It has already moved to the _deleted folder."})
        ok("and so do the start problem and a refusal that gives no reason",
           "could not be put back or moved to the _deleted folder, so it is kept" in start
           and refused == {"ok": False, "error": "Could not move it to the _deleted folder"}
           and (rec75 / "_deleting" / refused75 / "0" / "f" / "f.wav").is_file())
        ps71._send2trash = lambda: (lambda path: None)
        ps71.WINDOWS = True
        late, start, refused = said75()
        ok("b. on Windows they say the Recycle Bin",
           late == {"ok": False, "gone": True, "error": "It has already gone to the Recycle Bin."}
           and "could not be put back or moved to the Recycle Bin, so it is kept" in start
           and refused == {"ok": False, "error": "Could not move it to the Recycle Bin"})
        ps71.WINDOWS = False
        late, start, refused = said75()
        ok("c. and on a Mac or Linux, the Trash",
           late == {"ok": False, "gone": True, "error": "It has already gone to the Trash."}
           and "could not be put back or moved to the Trash, so it is kept" in start
           and refused == {"ok": False, "error": "Could not move it to the Trash"})
    finally:
        ps71._send2trash, ps71._system_trash_dir, ps71.WINDOWS = was75

    undone75 = g75.delete_take(str(sat75), 2).get("undo")
    first75 = g75.undo_trash(undone75)
    ok("d. an Undo done, asked again, says the take is back where it was",
       first75.get("ok") is True and g75.undo_trash(undone75) == BACK71
       and g75._lib.take(sat75, 2) is not None)
    back75 = rec75 / "Loose" / "g"
    back75.mkdir(parents=True)
    (back75 / "g.wav").write_bytes(b"back")
    put75 = holding71.hold(rec75, {"kind": "rehearsal", "reason": "delete", "rows": "kept",
                                   "rehearsal": None}, [back75])
    ended75 = g75.end_trash(put75)
    ok("e. so does one an end put back, its rows never dropped",
       ended75 == {"ok": True} and (back75 / "g.wav").read_bytes() == b"back"
       and put75 not in entries71(rec75) and g75.undo_trash(put75) == BACK71)
    ok("and one that went on is still gone, a token there never was too",
       g75.undo_trash(late75) == gone71() and g75.undo_trash("89abcdef") == gone71())
    g75.end_trash(refused75)
    g75.shutdown()
    apimod75.move_to_trash = real_trash71

    print("\n[76] The folder in use chosen again; a crop whose marks cannot follow")
    # Choosing the recordings folder that is in use already is no switch:
    # the Undos waiting in it stay, and nothing is opened anew. And a crop
    # whose take's record cannot follow it, the library refusing once the
    # files are cut, answers where the uncut take is: it is beside the take,
    # whole, and nothing on screen would name it otherwise.
    tmp76 = Path(tempfile.mkdtemp())
    apimod76, h76 = fresh_api(tmp76)
    rec76 = h76.recordings_dir
    apimod76.move_to_trash = trash71
    sun76 = past71(h76, "Sunday", "2026-10-04T19:00:00", ["Polyn", "Vesna"])
    wait76 = h76.delete_take(str(sun76), 1).get("undo")
    library76 = h76._library
    mark76 = len(sent71)
    same76 = h76.set_recordings_dir(str(rec76))
    ok("a. choosing the folder in use again ends none of its Undos, and opens nothing anew",
       same76 == {"ok": True, "recordings_dir": str(rec76), "kept": [], "ended": [],
                  "same": True}
       and entries71(rec76) == [wait76] and h76._library is library76 and sent71[mark76:] == [])
    other76 = h76.set_recordings_dir(str(sun76 / ".."))
    ok("nor does the same folder spelled another way",
       other76.get("ok") is True and other76.get("same") is True
       and other76.get("ended") == [] and other76.get("kept") == []
       and entries71(rec76) == [wait76] and h76._library is library76)
    ok("and its Undo still brings the take back", h76.undo_trash(wait76).get("ok") is True)

    folder76 = rec76 / "Cut - 2026-10-12 19-00"
    h76._lib.create_rehearsal(folder76, "Cut", "2026-10-12T19:00:00", SR, 16, band_c)
    dir76 = take_c(h76, folder76, 1, "Polyn")
    uncut76 = bytes71(dir76)

    def locked76(*args, **kwargs):
        raise RuntimeError("the database is locked")

    h76._library.edit_markers = locked76
    try:
        cut76 = h76.crop_take(str(folder76), 1, 1.0, 3.0)
    except RuntimeError as e:
        cut76 = {"raised": str(e)}
    finally:
        del h76._library.edit_markers
    beside76 = folder76 / f"{dir76.name} (before crop)"
    ok("b. a crop whose marks cannot follow answers, naming the folder the uncut take is in",
       cut76 == {"ok": False, "ended": [],
                 "error": "The crop is done but its marks could not follow; "
                          f"the uncut take is in \u201c{beside76}\u201d."})
    ok("where it is whole, beside the cropped take; nothing of it deleted or sent on",
       bytes71(beside76) == uncut76
       and wav_frames(dir76 / "Gtr.wav") == 2 * SR and sent71[mark76:] == []
       and h76._lib.take(folder76, 1) is not None)
    ok("and the crop is over: the take can be cropped again",
       h76._cropping == [])
    h76.shutdown()
    apimod76.move_to_trash = real_trash71

    print("\n[77] A copy never lands where another take's copy is")
    # A copy is filed under its rehearsal's folder name as "NN - name"
    # (_copy_to_cloud). Within one rehearsal two takes never share that:
    # their numbers differ, and Undo refuses a number taken meanwhile. Across
    # rehearsals a song's go is never given twice, so two takes of songs are
    # never named alike either. Two takes nobody named are, though ("Take 1"
    # in each), and two rehearsals can be filed under one folder name: Locate
    # points a missing one at any folder in the recordings folder, one in a
    # subfolder named like another rehearsal's included. Their takes 1 were
    # then written onto one file, and an Undo that dropped a restored copy
    # because the other take named it sent it again onto that same file. Now
    # a copy takes the next free name, " (2)" as a take's folder does, and
    # the other take's copy is left as it was. Copies only.
    tmp77 = Path(tempfile.mkdtemp())
    apimod77, h77 = fresh_api(tmp77)
    rec77 = h77.recordings_dir
    drive77 = tmp77 / "Drive"
    apimod77.move_to_trash = trash71
    h77.set_cloud_dir(str(drive77))
    h77.set_auto_publish(True, "mix")
    mon77 = past71(h77, "Monday", "2026-09-28T19:00:00", ["", "", ""])
    gig77 = past71(h77, "Gig", "2026-09-30T19:00:00", ["", "Ogon", ""])
    # The gig's takes sound unlike Monday's, so a copy shows whose it is.
    for n77 in (1, 2, 3):
        write_wav(Path(h77._lib.take(gig77, n77)["tracks"][0]["file"]), 3000 + n77,
                  seconds=1.0)
    (rec77 / "Old").mkdir()
    moved77 = rec77 / "Old" / mon77.name
    gig77.rename(moved77)
    located77 = h77.locate_rehearsal(str(gig77), str(moved77))
    gig77 = moved77
    there77 = drive77 / mon77.name
    ok("(the gig, found again in a folder named like Monday's, is filed under the same "
       "cloud folder name, and its take 1 is named as Monday's is)",
       located77.get("ok") is True and gig77.name == mon77.name
       and h77._lib.take(gig77, 1)["name"] == h77._lib.take(mon77, 1)["name"] == "Take 1")

    def run77():
        while h77._cloud_queue.run_next():
            pass

    def copy77(folder, n):
        mix = ((h77._lib.take(folder, n) or {}).get("cloud") or {}).get("mix")
        return Path(mix) if mix else None

    def sound77(path):
        return path.read_bytes() if path is not None and path.is_file() else None

    print("  Undo of a take whose copy the other take names now")
    h77._copy_to_cloud(str(gig77), 1, "mix")
    held77 = h77.delete_take(str(gig77), 1).get("undo")
    # Monday's take 1 is sent while the gig's waits for its Undo: nothing
    # live names that path, so it lands there, on the waiting copy.
    h77._copy_to_cloud(str(mon77), 1, "mix")
    mon_copy77 = copy77(mon77, 1)
    mon_sound77 = sound77(mon_copy77)
    back77 = h77.undo_trash(held77)
    dropped77 = h77._lib.take(gig77, 1)["cloud"] == {}
    run77()
    gig_copy77 = copy77(gig77, 1)
    ok("a. Undo brings the take back without the copy the other take names now",
       mon_copy77 == there77 / "01 - Take 1.wav" and back77.get("ok") is True and dropped77)
    ok("and sends it again beside it, leaving the other take's copy as it was",
       sound77(mon_copy77) == mon_sound77 and copy77(mon77, 1) == mon_copy77
       and gig_copy77 == there77 / "01 - Take 1 (2).wav"
       and sound77(gig_copy77) not in (None, mon_sound77))
    h77._copy_to_cloud(str(gig77), 1, "mix")
    ok("sent again, a copy at ' (2)' stays there, and the other take's is left",
       copy77(gig77, 1) == gig_copy77 and sound77(gig_copy77) is not None
       and sound77(mon_copy77) == mon_sound77)
    ok("and the pass that puts names right takes ' (2)' for its name, as on disk",
       "cloud" not in h77._out_of_line(h77._lib.take(gig77, 1)))

    print("  sent with no Undo, and renamed")
    h77._copy_to_cloud(str(mon77), 3, "mix")
    h77._copy_to_cloud(str(gig77), 3, "mix")
    ok("b. two takes 3 nobody named, filed under one folder name, each keep their own copy",
       copy77(mon77, 3) == there77 / "03 - Take 3.wav"
       and copy77(gig77, 3) == there77 / "03 - Take 3 (2).wav"
       and sound77(copy77(mon77, 3)) not in (None, sound77(copy77(gig77, 3))))
    h77._copy_to_cloud(str(mon77), 2, "mix")
    h77._copy_to_cloud(str(gig77), 2, "mix")
    mon_two77 = copy77(mon77, 2)
    mon_two_sound77 = sound77(mon_two77)
    h77.rename_take(str(gig77), 2, "Take 2")
    run77()
    gig_two77 = copy77(gig77, 2)
    ok("c. a take renamed to the other's name: its copy goes beside the other's, not onto it",
       copy77(gig77, 2) is not None and h77._lib.take(gig77, 2)["name"] == "Take 2"
       and mon_two77 == there77 / "02 - Take 2.wav" and sound77(mon_two77) == mon_two_sound77
       and gig_two77 == there77 / "02 - Take 2 (2).wav"
       and sound77(gig_two77) not in (None, mon_two_sound77))

    print("  a copy two takes name already")
    # As one left from before this was fixed: both rows name Monday's copy.
    h77._lib.set_cloud_copy(gig77, 3, {"mix": str(copy77(mon77, 3)), "mix_format": "wav"},
                            drive77)
    mon_three77, mon_three_sound77 = copy77(mon77, 3), sound77(copy77(mon77, 3))
    h77._copy_to_cloud(str(gig77), 3, "mix")
    ok("d. sending one of them again takes nothing of the other's out of the cloud folder",
       sound77(mon_three77) == mon_three_sound77 and copy77(mon77, 3) == mon_three77
       and copy77(gig77, 3) == there77 / "03 - Take 3 (2).wav")
    # Both rows naming Monday's copy again, the gig's own copy gone.
    copy77(gig77, 3).unlink()
    h77._lib.set_cloud_copy(gig77, 3, {"mix": str(mon_three77), "mix_format": "wav"}, drive77)
    h77.rename_take(str(gig77), 3, "Intro")
    run77()
    ok("renaming one of them leaves the other's where its row says; it is made again",
       sound77(mon_three77) == mon_three_sound77 and copy77(mon77, 3) == mon_three77
       and h77._lib.take(gig77, 3)["name"] == "Intro 1"
       and copy77(gig77, 3) == there77 / "03 - Intro 1.wav"
       and sound77(copy77(gig77, 3)) not in (None, mon_three_sound77))
    copy77(gig77, 3).unlink()
    h77._lib.set_cloud_copy(gig77, 3, {"mix": str(mon_three77), "mix_format": "wav"}, drive77)
    mark77 = len(sent71)
    unshared77 = h77.unshare_take(str(gig77), 3)
    ok("and Remove from the cloud on one of them sends nothing of the other's to the Trash",
       unshared77.get("ok") is True and sound77(mon_three77) == mon_three_sound77
       and mon_three77 not in sent71[mark77:] and h77._lib.take(gig77, 3)["cloud"] == {})
    h77._copy_to_cloud(str(gig77), 3, "mix")
    ok("and the takes' own files are where they were",
       all(Path(t["file"]).is_file() for f in (mon77, gig77) for n in (1, 2, 3)
           for t in h77._lib.take(f, n)["tracks"]))

    print("  the rehearsal that shares the cloud folder renamed")
    # Its cloud folder is Monday's too: moving the folder whole would carry
    # Monday's copies off with it, to where Monday's rows do not look.
    mons77 = {n: (copy77(mon77, n), sound77(copy77(mon77, n))) for n in (1, 2, 3)}
    renamed77 = h77.rename_rehearsal(str(gig77), "Gig again")
    gig77 = Path(renamed77.get("folder") or gig77)
    run77()
    again77 = drive77 / gig77.name
    ok("e. renaming the gig leaves Monday's copies where Monday's rows say, as they were",
       renamed77.get("ok") is True
       and all(copy77(mon77, n) == path and sound77(path) == sound
               for n, (path, sound) in mons77.items()))
    ok("and the gig's copies go to its new cloud folder, by their own names there",
       [copy77(gig77, n) for n in (1, 2, 3)]
       == [again77 / "01 - Take 1.wav", again77 / "02 - Take 2.wav", again77 / "03 - Intro 1.wav"]
       and all(sound77(copy77(gig77, n)) not in (None, mons77[n][1]) for n in (1, 2, 3))
       and sorted(p.name for p in (drive77 / mon77.name).iterdir())
       == ["01 - Take 1.wav", "02 - Take 2.wav", "03 - Take 3.wav"])
    h77.shutdown()
    apimod77.move_to_trash = real_trash71

    print("\n[78] The single keys, kept as the theme is")
    # Settings › Keys has two switches: Space and Esc, and the player's keys
    # (the arrows, Home, M, R and ?). Both are on until one is turned off, and
    # stay as they were left after a restart. Only false turns keys off: a
    # config edited by hand never takes them away by accident.
    tmp78 = Path(tempfile.mkdtemp())
    _, s78 = fresh_api(tmp78)

    def keys78(api):
        settings = api.get_settings()
        return settings["space_keys"], settings["player_keys"]

    ok("Space and Esc, and the player's keys, are on in a fresh config",
       keys78(s78) == (True, True))
    ok("turning Space and Esc off is kept",
       s78.save_keys("space", False) == {"ok": True})
    _, again78 = fresh_api(tmp78)
    ok("and they are still off after a restart, the player's keys still on",
       keys78(again78) == (False, True))
    saved78 = (tmp78 / "config.json").read_text()
    ok("a kind that is not Space or the player's keys is refused, and changes nothing",
       again78.save_keys("arrows", False) == {"ok": False, "error": "Unknown keys"}
       and keys78(again78) == (False, True)
       and (tmp78 / "config.json").read_text() == saved78)
    cfg78 = json.loads(saved78)
    cfg78["space_keys"] = "no"
    (tmp78 / "config.json").write_text(json.dumps(cfg78))
    _, odd78 = fresh_api(tmp78)
    ok("and anything but false written by hand reads as on",
       keys78(odd78) == (True, True))

    print("\n[79] Files that keep their tempo")
    # A click take's WAVs start at its first click, and carry its tempo in an
    # acid chunk through a crop and into the mix (metronome spec, Part 9). The
    # chunk's own bytes are in test_click.py; here, the three writers.
    from rehearsal_recorder.audio.capture import raw_to_wav as r2w79
    from rehearsal_recorder.audio.crop import crop_wav as cw79
    from rehearsal_recorder.audio.mixdown import mixdown as md79
    from rehearsal_recorder.audio.wavfile import Acid, read_acid

    def beats79(path):
        """The beats an acid chunk says its file holds."""
        raw = Path(path).read_bytes()
        at = raw.index(b"acid")
        return struct.unpack("<I", raw[at + 20:at + 24])[0]

    tmp79 = Path(tempfile.mkdtemp())
    numbered79 = (np.arange(2 * SR) % 30000).astype("<i2")  # each frame says which it is
    (tmp79 / "Gtr.raw").write_bytes(numbered79.tobytes())
    r2w79(tmp79 / "Gtr.raw", tmp79 / "Gtr.wav", SR, 16, head_frames=480, frames=48000)
    with wave.open(str(tmp79 / "Gtr.wav"), "rb") as w:
        kept79 = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    ok("raw_to_wav from frame 480 for 48000 frames writes exactly those",
       np.array_equal(kept79, numbered79[480:48480]))
    r2w79(tmp79 / "Gtr.raw", tmp79 / "Tail.wav", SR, 16, head_frames=90000, frames=48000)
    with wave.open(str(tmp79 / "Tail.wav"), "rb") as w:
        tail79 = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    ok("and asked for more than the raw file holds, what it holds",
       np.array_equal(tail79, numbered79[90000:]))
    ok("with no tempo given it writes none", read_acid(tmp79 / "Gtr.wav") is None)

    # Two seconds at 128 in 4/4: 4 quarters and a quarter, which counts as 4.
    r2w79(tmp79 / "Gtr.raw", tmp79 / "Click.wav", SR, 16, acid=Acid(128.0, 4, 4))
    ok("given one, the take's WAV carries it, its beats counted from its length",
       read_acid(tmp79 / "Click.wav") == Acid(128.0, 4, 4) and beats79(tmp79 / "Click.wav") == 4)
    quarter79 = 60 / 128  # 0.46875 s, 22500 frames
    cut79 = cw79(tmp79 / "Click.wav", tmp79 / "Click-cut.wav", quarter79, 3 * quarter79)
    ok("a crop of it keeps the chunk, with beats for what is left: 2",
       cut79["ok"] and cut79["frames"] == 45000
       and read_acid(tmp79 / "Click-cut.wav") == Acid(128.0, 4, 4) and beats79(tmp79 / "Click-cut.wav") == 2)
    with wave.open(str(tmp79 / "Click-cut.wav"), "rb") as w:
        middle79 = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
    ok("  and the audio cut as before", np.array_equal(middle79[300:-300], numbered79[22800:67200]))
    cw79(tmp79 / "Click.wav", tmp79 / "Click-bare.wav", quarter79, 3 * quarter79, acid=None)
    ok("asked to, a crop leaves it out", read_acid(tmp79 / "Click-bare.wav") is None)
    write_wav(tmp79 / "Plain.wav", 1000, seconds=2.0)
    cw79(tmp79 / "Plain.wav", tmp79 / "Plain-cut.wav", 0.5, 1.5)
    ok("a crop of a file with none adds none", read_acid(tmp79 / "Plain-cut.wav") is None)

    tracks79 = [{"name": "Gtr", "file": str(tmp79 / "Click.wav")}, {"name": "Bass", "file": str(tmp79 / "Plain.wav")}]
    mixed79 = md79(tracks79, tmp79 / "Mix.wav", acid=Acid(128.0, 4, 4))
    ok("the mix carries the chunk it is given",
       mixed79["ok"] and read_acid(tmp79 / "Mix.wav") == Acid(128.0, 4, 4) and beats79(tmp79 / "Mix.wav") == 4)
    md79(tracks79, tmp79 / "Mix-plain.wav")
    ok("and none when it is given none", read_acid(tmp79 / "Mix-plain.wav") is None)
    with wave.open(str(tmp79 / "Mix.wav"), "rb") as a79, wave.open(str(tmp79 / "Mix-plain.wav"), "rb") as b79:
        ok("  the audio the same either way", a79.readframes(a79.getnframes()) == b79.readframes(b79.getnframes()))

    print("\n[80] Recording to the click")
    # A click on the recording card rides the take's own stream, which has
    # outputs as well as inputs (metronome spec, Part 3). The take's files start
    # at its first click and end on a quarter, and a take the app did not live
    # to finish is cut at the same frame. The arithmetic of the click itself is
    # in test_click.py; here, the recorder and the drafts around it.
    import threading as threading80

    from rehearsal_recorder.audio.capture import AudioRecorder as Rec80
    from rehearsal_recorder.audio.click import Voices as Voices80
    from rehearsal_recorder.audio.click import click_frame as cf80
    from rehearsal_recorder.audio.drafts import describe as describe80
    from rehearsal_recorder.audio.drafts import finalize as finalize80
    from rehearsal_recorder.audio.take_click import TakeClick as TakeClick80
    from rehearsal_recorder.audio.wavfile import Acid as Acid80
    from rehearsal_recorder.audio.wavfile import read_acid as read_acid80
    from rehearsal_recorder.midi.capture import finish_draft as finish80
    from rehearsal_recorder.midi.clock import save_line as save_line80
    from rehearsal_recorder.midi.smf import read_events as read_events80

    tmp80 = Path(tempfile.mkdtemp())
    two80 = [{"name": "Gtr", "channel": 1}, {"name": "Voc", "channel": 2}]
    voices80 = Voices80("click", SR, 0.7)

    def numbered80(i):
        """Block i of 1024, each sample saying which frame it is (mod 30000)."""
        n = (np.arange(i * 1024, (i + 1) * 1024) % 30000).astype(np.int16)
        return np.stack([n, n], axis=1)

    def info80(i):
        """The driver's word on block i: captured 5 ms ago, heard in 5 ms."""
        now = 50.0 + i * 1024 / SR
        return types.SimpleNamespace(currentTime=now, inputBufferAdcTime=now - 0.005,
                                     outputBufferDacTime=now + 0.005)

    def block80(rec, i):
        if rec.click is not None and rec.click.duplex:
            out = np.zeros((1024, 2), np.float32)
            rec._duplex_callback(numbered80(i), out, 1024, info80(i), None)
            return out
        rec._callback(numbered80(i), 1024, info80(i), None)
        return None

    def stop80(rec, blocks_done):
        """Stop, with the card going on from block `blocks_done` on a thread of
        its own, as PortAudio's does, from when Stop has said where the take
        ends; stopping the stream waits for it, as PortAudio's stop does."""
        halt = threading80.Event()

        def card():
            i = blocks_done
            while not halt.is_set():
                if rec.click.end_frame is None:
                    time.sleep(0.001)
                    continue
                block80(rec, i)
                i += 1
                time.sleep(0.0002)

        feeder = threading80.Thread(target=card, daemon=True)
        stream = rec._stream
        stopping = stream.stop

        def stop():
            halt.set()
            feeder.join()
            stopping()

        stream.stop = stop
        feeder.start()
        return rec.stop()

    def record80(folder):
        return json.loads((folder / "take.json").read_text(encoding="utf-8"))

    def wav80(path):
        with wave.open(str(path), "rb") as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")

    def written80(folder, deadline=2.0):
        """take.json once it has the first click, as the take's tick writes it."""
        until = time.monotonic() + deadline
        while time.monotonic() < until:
            try:
                found = record80(folder)["click"]
                if found["first_click_frame"] is not None:
                    return found
            except (OSError, ValueError, KeyError):
                pass
            time.sleep(0.01)
        return None

    tc80 = TakeClick80(120, "4/4", 1, voices80, (0, 1))
    duplex80 = tmp80 / "duplex"
    rec80 = Rec80(0, SR, two80, duplex80, click=tc80)
    rec80.start()
    kw80 = rec80._stream.kw
    ok("the click on the recording card: one stream with its inputs and its outputs",
       kw80["device"] == (0, 0) and kw80["channels"] == (2, 2) and kw80["dtype"] == ("int16", "float32")
       and kw80["callback"] == rec80._duplex_callback)
    ok("take.json has the click from the start, its first click not chosen yet",
       record80(duplex80)["click"] == {"tempo": 120, "signature": "4/4", "on": True, "wav_tempo": True,
                                       "first_click_frame": None, "end_frame": None})
    heard80 = np.concatenate([block80(rec80, i) for i in range(100)])
    first80 = tc80.first_click_frame
    ok("the first block chose the first click: 0.1 s on, and a 10 ms round trip after that", first80 == 4800 + 480)
    ok("  the click written into the outputs a round trip early",
       not heard80[:4800].any() and np.array_equal(heard80[4800:4800 + len(voices80.of(2)), 0], voices80.of(2)))
    # The take's tick comes every 50 ms until take.json has it, not every second.
    ok("  and take.json written again once it was chosen, within moments",
       (written80(duplex80, deadline=0.5) or {}).get("first_click_frame") == first80)
    ok("a click take's problem is still only the recording's", rec80.problem() is None)
    result80 = stop80(rec80, 100)
    # Stopped at frame 102400: the next quarter from the first click is its fifth,
    # 2.5 s on.
    end80 = first80 + cf80(5, 120, SR)
    ok("Stop recorded on to the next quarter", tc80.end_frame == end80 and abs(result80["duration_sec"] - 2.5) < 1e-9)
    gtr80 = wav80(duplex80 / "Gtr.wav")
    ok("each WAV starts at the first click and ends there",
       len(gtr80) == end80 - first80 and gtr80[0] == first80 % 30000 and gtr80[-1] == (end80 - 1) % 30000
       and np.array_equal(wav80(duplex80 / "Voc.wav"), gtr80))
    ok("  and carries the take's tempo: 120 in 4/4, five quarters", read_acid80(duplex80 / "Gtr.wav") == Acid80(120.0, 4, 4))
    ok("take.json is kept for the take's grid, with where the files end",
       record80(duplex80)["click"]["first_click_frame"] == first80 and record80(duplex80)["click"]["end_frame"] == end80)
    ok("the click take's raw files are gone", not list(duplex80.glob("*.raw")))

    plain80 = tmp80 / "no tempo in the wav"
    rec80b = Rec80(0, SR, two80, plain80, click=TakeClick80(120, "4/4", 1, voices80, (0, 1), wav_tempo=False))
    rec80b.start()
    for i in range(30):
        block80(rec80b, i)
    stop80(rec80b, 30)
    ok("with the setting off the WAVs carry no tempo, and still start at the first click",
       read_acid80(plain80 / "Gtr.wav") is None and wav80(plain80 / "Gtr.wav")[0] == first80 % 30000)

    # The app dies mid-take: the raw files, take.json, and the notes as the rig
    # left them. Recovered, the take is cut where the live one would have been.
    crash80 = tmp80 / "rehearsal" / "_drafts" / "take 1"
    rec80c = Rec80(0, SR, two80, crash80, click=TakeClick80(120, "4/4", 1, voices80, (0, 1)))
    rec80c.start()
    for i in range(60):
        block80(rec80c, i)
    ok("a take that dies has its first click in take.json already", (written80(crash80) or {}).get("first_click_frame") == first80)
    rec80c.abandon()
    t80, ms80 = 9_000_000_000, 1_000_000
    first_ns80 = t80 + first80 * 1_000_000_000 // SR
    (crash80 / "Keys.midraw").write_bytes("".join([
        f"t {t80}\n",
        f"n {first_ns80 - 50 * ms80} 903c40\n",   # struck in the moment before the first click
        f"n {first_ns80 + 500 * ms80} 904040\n",  # half a second after it
        f"n {first_ns80 + 750 * ms80} 804000\n",
    ]).encode("ascii"))
    (crash80 / "take.clock").write_bytes("".join(
        save_line80(m) for m in [(t80, 0), (t80 + 1_000_000_000, SR)]).encode("ascii"))
    ok("the draft's length is counted from its first click", abs(describe80(crash80, SR)["duration_sec"] - (61440 - first80) / SR) < 1e-9)
    done80 = finalize80(crash80, SR, 16)
    gtr80c = wav80(crash80 / "Gtr.wav")
    ok("recovered, each WAV is cut at the same first click",
       len(gtr80c) == 61440 - first80 and gtr80c[0] == first80 % 30000
       and abs(done80["duration_sec"] - (61440 - first80) / SR) < 1e-9)
    ok("  and carries its tempo", read_acid80(crash80 / "Gtr.wav") == Acid80(120.0, 4, 4))
    names80, events80 = read_events80(crash80 / "Keys.mid")
    ok("its .mid starts at the first click too: the key half a second after it is at 0.5 s",
       [(round(sec * 1920), data) for sec, data in events80] == [(960, b"\x90\x40\x40"), (1440, b"\x80\x40\x00")])

    # Review Focus 5: Stop in the count-in.
    early80 = tmp80 / "stopped in the count-in"
    rec80d = Rec80(0, SR, two80, early80, click=TakeClick80(120, "4/4", 1, voices80, (0, 1)))
    rec80d.start()
    for i in range(20):  # 20480 frames: between the count-in's first click and its second
        block80(rec80d, i)
    result80d = stop80(rec80d, 20)
    gtr80d = wav80(early80 / "Gtr.wav")
    ok("Stop in the count-in ends on the next quarter: the count-in's second click",
       len(gtr80d) == cf80(1, 120, SR) and abs(result80d["duration_sec"] - 0.5) < 1e-9)
    ok("  its WAVs start at the first click", gtr80d[0] == first80 % 30000)
    first_ns80d = t80 + first80 * 1_000_000_000 // SR
    (early80 / "Keys.midraw").write_bytes("".join([
        f"t {t80}\n", f"n {first_ns80d + 250 * ms80} 903c40\n", f"n {first_ns80d + 400 * ms80} 803c00\n"]).encode("ascii"))
    (early80 / "take.clock").write_bytes("".join(
        save_line80(m) for m in [(t80, 0), (t80 + 1_000_000_000, SR)]).encode("ascii"))
    finish80(early80, result80d["duration_sec"])
    _, events80 = read_events80(early80 / "Keys.mid")
    ok("  and its .mid: a key a quarter second after the first click is at 0.25 s",
       [(round(sec * 1920), data) for sec, data in events80] == [(480, b"\x90\x3c\x40"), (768, b"\x80\x3c\x00")])

    # The card gone just after Record: Stop has fewer frames than lead up to
    # the first click, so the take has no grid and keeps all it recorded,
    # with no tempo in its WAVs, rather than WAVs with a tempo and no audio.
    lost80 = tmp80 / "card lost"
    tc80f = TakeClick80(120, "4/4", 1, voices80, (0, 1))
    rec80f = Rec80(0, SR, two80, lost80, click=tc80f)
    rec80f.start()
    block80(rec80f, 0)
    result80f = rec80f.stop()
    ok("the card gone before the first click came: no grid, all 1024 frames kept, no tempo in the WAVs",
       tc80f.first_click_frame is None and len(wav80(lost80 / "Gtr.wav")) == 1024
       and read_acid80(lost80 / "Gtr.wav") is None and abs(result80f["duration_sec"] - 1024 / SR) < 1e-9
       and record80(lost80)["click"]["first_click_frame"] is None)

    # The card will not open its outputs with its inputs: Record still
    # records, from the inputs alone, a click take on its grid, the beat still
    # lit on the screen (spec Part 4).
    from rehearsal_recorder.metronome import Metronome as Metronome80

    class Refusing80:
        def __init__(self, **kw):
            raise RuntimeError("Invalid number of channels")

    duplex_kind80 = _sd.Stream
    _sd.Stream = Refusing80
    refused80 = tmp80 / "outputs refused"
    tc80e = TakeClick80(120, "4/4", 1, voices80, (0, 1))
    rec80e = Rec80(0, SR, two80, refused80, click=tc80e)
    try:
        rec80e.start()
    finally:
        _sd.Stream = duplex_kind80
    ok("a card whose outputs will not open with its inputs: the take records from its inputs alone",
       rec80e._stream.kw["callback"] == rec80e._callback and rec80e._stream.kw["channels"] == 2
       and not tc80e.duplex and tc80e.problem() == "Its outputs would not open with its inputs.")
    m80 = Metronome80({}, lambda: None, lambda: None, lambda key: None, None)
    m80.begin_take(120, "4/4", tc80e)
    for i in range(10):
        block80(rec80e, i)
    state80 = m80.state()
    ok("  its first click chosen at once, the screen told when each falls, and which card is mute",
       tc80e.first_click_frame == 9600 and len(state80["upcoming"]) >= 2 and state80["output_missing"] == "Interface")
    stop80(rec80e, 10)
    m80.end_take()
    gtr80e = wav80(refused80 / "Gtr.wav")
    ok("  a click take all the same: its WAVs start at its first click and carry its tempo",
       len(gtr80e) == cf80(1, 120, SR) and gtr80e[0] == 9600 and read_acid80(refused80 / "Gtr.wav") == Acid80(120.0, 4, 4)
       and record80(refused80)["click"]["first_click_frame"] == 9600 and record80(refused80)["click"]["tempo"] == 120)

    print("\n[81] The click elsewhere")
    # The click on the desk while the interface records: the take's stream has
    # inputs only, and the click a stream of its own, placed by both streams'
    # clocks. Played here in made-up time, the streams taking turns as a
    # machine's would.
    from rehearsal_recorder.audio.click_output import ClickOutput as ClickOutput81
    from rehearsal_recorder.metronome import Metronome as Metronome81
    # The stub's streams, counted: main has a _FakeStream of its own, from [3].
    Streams81 = _sd.OutputStream

    out81 = ClickOutput81(3, (3, 4))
    tc81 = TakeClick80(120, "4/4", 1, voices80, out81.route, output=out81)
    elsewhere81 = tmp80 / "elsewhere"
    rec81 = Rec80(0, SR, two80, elsewhere81, click=tc81)
    opened81 = Streams81.opened
    rec81.start()
    ok("the take's stream has inputs only", rec81._stream.kw["channels"] == 2 and rec81._stream.kw["device"] == 0
       and rec81._stream.kw["callback"] == rec81._callback)
    ok("and the click a second stream, on the desk's outputs 3-4, at the desk's rate",
       Streams81.opened == opened81 + 2 and out81._stream.kw["device"] == 3
       and out81._stream.kw["channels"] == 4 and out81.samplerate == 48000 and not tc81.duplex)
    real_ns81 = time.perf_counter_ns
    T81 = 2_000_000_000_000
    now81 = [T81]
    time.perf_counter_ns = lambda: int(now81[0])
    desk81 = []
    try:
        i81 = j81 = 0
        # The interface's blocks arrive 3 ms after their last frame; the desk's
        # callbacks run 15 ms before what they write is heard, its first frame
        # heard 60 ms after the take began. Halfway, the desk goes, and its
        # callbacks with it.
        while i81 < 140:
            due_in = T81 + (i81 + 1) * 1024 / SR * 1e9 + 3e6
            due_out = T81 + 60e6 + j81 * 1024 / SR * 1e9 - 15e6
            if due_in <= due_out or out81.problem() is not None:
                now81[0] = due_in
                rec81._callback(numbered80(i81), 1024, types.SimpleNamespace(
                    currentTime=due_in / 1e9, inputBufferAdcTime=(T81 + i81 * 1024 / SR * 1e9) / 1e9), None)
                i81 += 1
                if i81 == 70:
                    out81._finished()  # the headphone amp unplugged mid-take
            else:
                now81[0] = due_out
                block = np.zeros((1024, 4), np.float32)
                out81._callback(block, 1024, types.SimpleNamespace(
                    currentTime=due_out / 1e9, outputBufferDacTime=(due_out + 15e6) / 1e9), None)
                desk81.append(block)
                j81 += 1
    finally:
        time.perf_counter_ns = real_ns81
    first81 = tc81.first_click_frame
    # The desk's first block ran at 45 ms, so the interface's block after it
    # (block 1, in at 45.7 ms) chose the first click 0.2 s on.
    ok("the first click chosen 0.2 s after the input block that followed the desk's first",
       first81 == 1024 + 9600)
    desk81 = np.concatenate(desk81)
    # Each click's sound rises from silence: its first sample is 0.
    heard81 = [int(f) - 1 for f in np.flatnonzero(desk81[:, 2]) if not desk81[max(0, f - 200):f, 2].any()]
    want81 = [(first81 + cf80(k, 120, SR)) * 1e9 / SR - 60e6 for k in range(len(heard81))]
    ok("the clicks on the desk's outputs 3-4 only, each heard on its frame of the take within 1 ms",
       not desk81[:, :2].any() and np.array_equal(desk81[:, 2], desk81[:, 3]) and len(heard81) >= 2
       and all(abs(h * 1e9 / SR - w) < 1e6 for h, w in zip(heard81, want81)))
    ok("the desk gone mid-take: the click says so, the recording does not",
       out81.problem() is not None and rec81.problem() is None and rec81.error is None)
    ok("  and the recording went on", rec81._frames_written == 140 * 1024)
    result81 = stop80(rec81, 140)
    # Stopped at frame 143360, 132736 after the first click: the next quarter is the sixth.
    ok("Stop works: the take ends on a quarter after its first click",
       tc81.end_frame == first81 + cf80(6, 120, SR) and abs(result81["duration_sec"] - 3.0) < 1e-9)
    ok("  and it is a click take: its WAVs start at the first click and carry the tempo",
       wav80(elsewhere81 / "Gtr.wav")[0] == first81 % 30000 and read_acid80(elsewhere81 / "Gtr.wav") == Acid80(120.0, 4, 4)
       and record80(elsewhere81)["click"]["first_click_frame"] == first81)
    ok("the click's own stream is closed with the take", out81._stream is None)

    # Which way the metronome sends a take's click.
    cfg81 = {"click_device": {"name": "Interface", "host_api": "CoreAudio"}, "click_device_index": 0,
             "click_channels": [1, 2]}
    m81 = Metronome81(cfg81, lambda: None, lambda: None, lambda key: {"click_device": cfg81["click_device_index"]}.get(key), None)
    m81.set(128, "4/4")
    on_card81 = m81.take_click(0, SR)
    ok("the click device is the recording card: one stream", on_card81.duplex and on_card81.route == (0, 1)
       and on_card81.record()["tempo"] == 128 and on_card81.count_in_clicks == 4)
    cfg81.update(click_device={"name": "Desk", "host_api": "CoreAudio"}, click_device_index=3, click_channels=[3, 4])
    on_desk81 = m81.take_click(0, SR)
    ok("another device: a stream of its own, on its outputs",
       not on_desk81.duplex and on_desk81.output.device_index == 3 and on_desk81.output.channels == (3, 4))
    m81.set_on(False)
    ok("the switch off: no click for the take", m81.take_click(0, SR) is None)

    print("  Two ASIO cards")
    # PortAudio opens one ASIO stream at a time: with the interface recording
    # on ASIO, a click on another ASIO card has no stream of its own, and the
    # take records all the same (spec Part 4).
    from rehearsal_recorder.audio.click_output import SilentOutput as SilentOutput81

    class OneAsio81(Streams81):
        """A stream as PortAudio's ASIO opens it: one on a card in `asio` is
        refused while another such stream is open, on that card or another."""

        asio = set()
        open_now = []

        @staticmethod
        def card(kw):
            device = kw.get("device")
            return device[0] if isinstance(device, tuple) else device

        def __init__(self, **kw):
            if self.card(kw) in OneAsio81.asio and any(s.card(s.kw) in OneAsio81.asio for s in OneAsio81.open_now):
                raise RuntimeError("Error opening stream: Unanticipated host error [PaErrorCode -9999]")
            super().__init__(**kw)
            OneAsio81.open_now.append(self)

        def close(self):
            super().close()
            if self in OneAsio81.open_now:
                OneAsio81.open_now.remove(self)

    kinds81 = (_sd.InputStream, _sd.OutputStream, _sd.Stream)
    _sd.InputStream = _sd.OutputStream = _sd.Stream = OneAsio81
    OneAsio81.asio = {0, 3}
    try:
        tc81b = TakeClick80(120, "4/4", 1, voices80, (0, 1), output=ClickOutput81(3, (1, 2)))
        rec81b = Rec80(0, SR, two80, tmp80 / "two asio cards", click=tc81b)
        try:
            rec81b.start()
            started81 = True
        except Exception as e:
            print(f"  (Record failed: {e})")
            started81 = False
        ok("the click's own output on a second ASIO card: the take's stream opens first, and records",
           started81 and rec81b._stream is not None and rec81b._stream.kw["device"] == 0
           and tc81b.problem() is not None)
        if started81:
            for i in range(4):
                block80(rec81b, i)
            rec81b.stop()
    finally:
        _sd.InputStream, _sd.OutputStream, _sd.Stream = kinds81
        OneAsio81.open_now.clear()

    another81 = "Another ASIO card can't play while one records."
    hostapis81 = _sd.query_hostapis
    _sd.query_hostapis = lambda: [{"name": "ASIO"}]  # every card on ASIO
    try:
        desk81 = Metronome81({"click_device": {"name": "Desk", "host_api": "ASIO"}, "click_device_index": 3,
                              "click_channels": [1, 2]}, lambda: None, lambda: None, {"click_device": 3}.get, None)
        desk81.set(128, "4/4")
        on_desk81b = desk81.take_click(0, SR)
        follows81 = Metronome81({}, lambda: None, lambda: None, {"output_device": 3}.get, None)
        follows81.set(128, "4/4")
        on_player81 = follows81.take_click(0, SR)
        card81 = Metronome81({"click_device": {"name": "Interface", "host_api": "ASIO"}, "click_device_index": 0,
                              "click_channels": [1, 2]}, lambda: None, lambda: None, {"click_device": 0}.get, None)
        card81.set(128, "4/4")
        on_card81b = card81.take_click(0, SR)
    finally:
        _sd.query_hostapis = hostapis81
    ok("the click saved on another ASIO card: no stream of its own for the take, and it says why",
       not on_desk81b.duplex and isinstance(on_desk81b.output, SilentOutput81)
       and on_desk81b.output.name == "Desk" and on_desk81b.problem() == another81)
    ok("  the same with none saved and the player on that card",
       isinstance(on_player81.output, SilentOutput81) and on_player81.problem() == another81)
    ok("  on the recording card itself it rides the take's stream, as before", on_card81b.duplex)

    print("\n[82] The click and the player")
    # Between takes the click shares the player's stream when the player holds
    # its device, and has one of its own when not. When a take plays back, its
    # click is made again from its tempo (Part 8).
    from rehearsal_recorder.audio.click_source import ClickSource as ClickSource82
    from rehearsal_recorder.audio.click_output import ClickOutput as ClickOutput82

    tmp82 = Path(tempfile.mkdtemp())
    write_wav(tmp82 / "Quiet.wav", 0, seconds=20.0)
    p82 = TakePlayer([{"name": "Quiet", "file": str(tmp82 / "Quiet.wav")}])
    opened82 = Streams81.opened
    p82.open_output(3, (1, 2), extra_channels=(3, 4))
    ok("the player on the desk's outputs 1-2, the click on its 3-4: one stream of four",
       Streams81.opened == opened82 + 1 and p82._stream.kw["channels"] == 4 and p82._stream.kw["device"] == 3)
    cfg82 = {"click_device": {"name": "Desk", "host_api": "CoreAudio"}, "click_device_index": 3, "click_channels": [3, 4]}
    holder82 = {"player": p82}
    lookup82 = {"click_device": 3, "output_device": 3}
    m82 = Metronome81(cfg82, lambda: None, lambda: holder82["player"], lookup82.get, None)
    m82.set(120, "4/4")
    ok("the click's outputs widen the player's stream on its device, and no other",
       m82.extra_channels(3) == (3, 4) and m82.extra_channels(0) == ())
    ok("the player holds the click's device: the click's sink is the player", m82.click_sink() == ("player", p82))
    ok("play mixes into it and nothing else opens",
       m82.play()["ok"] and isinstance(p82._free_click, ClickSource82) and Streams81.opened == opened82 + 1)
    out82 = np.zeros((4096, 4), np.int16)
    for b in range(4):
        p82._callback(out82[b * 1024:(b + 1) * 1024], 1024, None, None)
    ok("the click on 3 and 4, outside the take's own outputs, at the metronome's volume",
       out82[:, 2].any() and np.array_equal(out82[:, 2], out82[:, 3]) and not out82[:, :2].any()
       and abs(int(np.abs(out82[:, 2]).max()) - round(0.7 * 32767)) <= 2)
    ok("  out of the player's meters", p82.state()["master_level"] == 0.0)
    m82.stop()
    ok("Stop takes it out of the player's stream", p82._free_click is None)
    holder82["player"] = None
    kind82, sink82 = m82.click_sink()
    ok("with the player closed the click has a stream of its own",
       kind82 == "own" and isinstance(sink82, ClickOutput82) and sink82.device_index == 3 and sink82.channels == (3, 4))
    m82.play()
    ok("  which play opens", Streams81.opened == opened82 + 2 and Streams81.last.kw["device"] == 3
       and Streams81.last.kw["channels"] == 4 and Streams81.last.kw["dtype"] == "float32")
    m82.stop()
    ok("  and Stop closes", m82.state()["phase"] == "idle")

    print("  The take's own click")
    p82.set_take_click(120, "4/4", voices80)
    p82.set_click_on(True)
    ok("the player says its click is on", p82.state()["click"] is True)
    p82.seek(10.0)
    p82.play()
    tick82 = voices80.of(2).astype(np.float64) * 32767
    tock82 = voices80.of(0).astype(np.float64) * 32767

    def expected82(length, places):
        """The click as it should come out: each voice at its place."""
        out = np.zeros(length)
        for at, voice in places:
            out[at:at + len(voice)] += voice[:max(0, length - at)]
        return out

    # Each block copied: _render hands back the same buffer every time.
    heard82 = np.concatenate([p82._render(512).copy() for _ in range(100)])[:, 0].astype(np.float64)
    # 10.0 s is click 20 exactly, the first of a bar; 21 is half a second on,
    # and 22 a second.
    ok("after a seek to 10.0 s, the click is at the take's own frames: 20 at 10.0 s, 21 at 10.5 s, 22 at 11.0 s",
       np.allclose(heard82, expected82(51200, [(0, tick82), (24000, tock82), (48000, tock82)]), atol=1.0))
    ok("  and out of the meters", p82.state()["levels"]["Quiet"] == [0.0] and p82.state()["master_level"] == 0.0)
    p82.set_loop(10.25, 11.0)
    looped82 = np.concatenate([p82._render(512).copy() for _ in range(200)])[:, 0].astype(np.float64)
    # The loop is 492000 to 528000; click 21 at 504000 is 12000 into each pass.
    ok("inside a loop it follows the take's frames round and round",
       np.allclose(looped82, expected82(102400, [(12000, tock82), (48000, tock82), (84000, tock82)]), atol=1.0))
    p82.set_loop(None, None)
    p82.set_master(0.5)
    settle(p82)
    p82.seek(10.0)
    half82 = np.concatenate([p82._render(512).copy() for _ in range(10)])[:, 0].astype(np.float64)
    ok("under the master: half as loud at 0.5", np.allclose(half82, expected82(5120, [(0, tick82 * 0.5)]), atol=1.0))
    p82.set_master_muted(True)
    settle(p82)
    p82.seek(10.0)
    ok("  and silent while muted", not np.concatenate([p82._render(512).copy() for _ in range(10)]).any())
    p82.set_master_muted(False)
    p82.set_click_on(False)
    settle(p82)
    p82.seek(10.0)
    ok("switched off, there is none", not np.concatenate([p82._render(512).copy() for _ in range(10)]).any()
       and p82.state()["click"] is False)
    p82.set_take_click(None, None, None)
    p82.set_click_on(True)
    settle(p82)
    p82.seek(10.0)
    ok("a take that was not recorded to the click has none", not np.concatenate([p82._render(512).copy() for _ in range(10)]).any())
    p82.close()

    print("  The settings, and where the click goes")
    before82 = dict(cfg82)
    ok("a volume of 2 and a count-in of 3 bars are refused, and nothing saved",
       not m82.set_setting("click_volume", 2)["ok"] and not m82.set_setting("count_in_bars", 3)["ok"] and cfg82 == before82)
    gone82 = {"click_device": {"name": "X18", "host_api": "CoreAudio"}, "click_device_index": 7}
    opened82 = Streams81.opened
    m82b = Metronome81(gone82, lambda: None, lambda: None, lambda key: None, None)
    ok("a click device saved and not plugged in: its name is the problem",
       m82b.output_problem() == "X18" and m82b.state()["output_missing"] == "X18")
    m82b.set(120, "4/4")
    ok("  play opens nothing, and the beat still flashes",
       m82b.play()["ok"] and Streams81.opened == opened82 and m82b.state()["phase"] == "preview"
       and len(m82b.state()["upcoming"]) >= 2)
    m82b.stop()
    ok("  and the take still clicks on its grid, to no output",
       m82b.take_click(0, SR) is not None and m82b.take_click(0, SR).problem() is not None
       and not m82b.take_click(0, SR).duplex)
    p82c = TakePlayer([{"name": "Quiet", "file": str(tmp82 / "Quiet.wav")}])
    p82c.open_output(3, (5, 6))
    none82 = {"output_channels": [5, 6]}
    m82c = Metronome81(none82, lambda: None, lambda: p82c, {"output_device": 3}.get, None)
    m82c.set(120, "4/4")
    ok("no click device saved: the click goes where the player plays", m82c.click_sink() == ("player", p82c)
       and m82c.settings()["click_device_index"] is None and m82c.settings()["click_channels"] is None)
    m82c.play()
    ok("  on the player's own outputs", p82c._free_click is not None and p82c._free_click.route == (4, 5))
    m82c.stop()
    p82c.close()
    kind82c, sink82c = m82c.click_sink()
    ok("  and with the player closed, a stream of its own there",
       kind82c == "own" and sink82c.device_index == 3 and sink82c.channels == (5, 6))

    print("  Look again while the click starts")
    # A rescan holds STREAM_LOCK while PortAudio is stopped and started again,
    # and PortAudio stopped with a stream open frees it under the app, which
    # crashes on its next call. So the rescan lets the click between takes go
    # inside that lock, and a play on another thread opens its stream either
    # before (and the rescan closes it) or after. Neither may wait for the
    # other for ever: play holds the click's own lock while it waits for
    # STREAM_LOCK.
    import threading as threading82
    from rehearsal_recorder.audio import devices as devices82

    m82d = Metronome81({"click_device": {"name": "Desk", "host_api": "CoreAudio"}, "click_device_index": 3,
                        "click_channels": [3, 4]}, lambda: None, lambda: None, {"click_device": 3}.get, None)
    m82d.set(120, "4/4")
    order82 = []
    opening82, go82 = threading82.Event(), threading82.Event()

    class Held82(Streams81):
        """A stream that takes its time to open, until told to go on."""

        def __init__(self, **kw):
            opening82.set()
            go82.wait(5)
            super().__init__(**kw)
            self.open_now = True
            order82.append("opened")

        @property
        def latency(self):
            # Asked once it is open, before the click is kept: a rescan let in
            # here would find nothing to close.
            time.sleep(0.1)
            return 0.01

        def close(self):
            super().close()
            self.open_now = False

    held82 = []

    def terminate82():
        # What PortAudio would free: every click stream still open.
        order82.append(("stopped", sum(1 for s in held82 if s.open_now)))
        _sd._initialized -= 1

    def initialize82():
        _sd._initialized += 1

    def look_again82(first=None):
        """Api.rescan_devices' part: the click let go, then PortAudio stopped
        and started, all in one hold of STREAM_LOCK."""
        with devices82.STREAM_LOCK:
            if first is not None:
                first()
            m82d.let_go_for_rescan()
            devices82.rescan()

    def kept82(**kw):
        stream = Held82(**kw)
        held82.append(stream)
        return stream

    saved82 = (_sd.OutputStream, getattr(_sd, "_terminate", None), getattr(_sd, "_initialize", None),
               getattr(_sd, "_initialized", None))
    _sd.OutputStream, _sd._terminate, _sd._initialize, _sd._initialized = kept82, terminate82, initialize82, 1
    try:
        played82 = []
        player82 = threading82.Thread(target=lambda: played82.append(m82d.play()), daemon=True)
        player82.start()
        opening82.wait(5)
        rescan82 = threading82.Thread(target=look_again82, daemon=True)
        rescan82.start()
        time.sleep(0.05)  # the rescan waiting for the lock play holds as it opens
        go82.set()
        player82.join(5)
        rescan82.join(5)
        ok("play opening as Look again starts: both finish",
           not player82.is_alive() and not rescan82.is_alive() and played82 == [{"ok": True}])
        ok("  the click's stream opened first and closed before PortAudio stopped",
           order82 == ["opened", ("stopped", 0)] and len(held82) == 1 and not held82[0].open_now)
        ok("  and the click is stopped, nothing playing", m82d.state()["phase"] == "idle" and m82d._free is None)

        del order82[:]
        waiting82 = threading82.Event()

        def play_waits82():
            """Play started while the rescan holds STREAM_LOCK, and let in
            once it has the click's own lock and waits for that one."""
            waiting82.set()
            deadline = time.monotonic() + 5
            while not m82d._sinks.locked() and time.monotonic() < deadline:
                time.sleep(0.001)

        player82 = threading82.Thread(target=lambda: (waiting82.wait(5), played82.append(m82d.play())), daemon=True)
        player82.start()
        rescan82 = threading82.Thread(target=look_again82, args=(play_waits82,), daemon=True)
        rescan82.start()
        rescan82.join(5)
        player82.join(5)
        ok("play waiting on Look again: both finish, neither waiting for the other",
           not player82.is_alive() and not rescan82.is_alive() and played82 == [{"ok": True}] * 2)
        ok("  PortAudio stopped with no click stream open, and the click's opened after",
           order82 == [("stopped", 0), "opened"] and len(held82) == 2 and held82[1].open_now)
        ok("  and it plays", m82d.state()["phase"] == "preview")
        if not rescan82.is_alive():
            m82d.stop()
            ok("  until Stop closes it", not held82[1].open_now)
    finally:
        _sd.OutputStream = saved82[0]
        for name82, value82 in zip(("_terminate", "_initialize", "_initialized"), saved82[1:]):
            if value82 is None:
                if hasattr(_sd, name82):
                    delattr(_sd, name82)
            else:
                setattr(_sd, name82, value82)

    print("  Play first, then the player opens on its device")
    # Play with the player closed has a stream of its own where the player
    # plays. A take opened there must not open a second stream on that card:
    # ASIO refuses one, and the player would go to the system's output. The
    # click lets go of its stream first and goes on in the player's, from its
    # next click.
    a82 = fresh_api(Path(tempfile.mkdtemp()))[1]
    kinds82 = (_sd.OutputStream, _sd.InputStream, _sd.Stream)
    _sd.OutputStream = _sd.InputStream = _sd.Stream = OneAsio81
    OneAsio81.asio = {3}
    try:
        a82.set_output_device(3)
        a82.metronome_set(120, "4/4")
        played82 = a82.metronome_play()
        own82 = a82._metronome._free
        for b in range(30):  # 30720 frames at 120: clicks 0 and 1 played, click 2 next
            own82.sink._callback(np.zeros((1024, 2), np.float32), 1024, None, None)
        opened82b = a82.player_open([{"name": "Quiet", "file": str(tmp82 / "Quiet.wav")}])
        moved82 = a82._metronome._free
        ok("play first, the take opened after on the click's card: the player opens there, no warning",
           played82["ok"] and own82.kind == "own" and opened82b["ok"] and "warning" not in opened82b
           and a82._player.holds(3))
        ok("  and the click goes on in the player's stream from the bar's third click",
           moved82 is not None and moved82.kind == "player" and a82._player.free_click is moved82.source
           and moved82.source.next_in_bar == 2 and own82.sink._stream is None)
        a82.player_close()
        ok("  closed, the click has its own stream again", a82._metronome._free is not None
           and a82._metronome._free.kind == "own" and a82._metronome._free.sink._stream is not None)
        a82.metronome_stop()
        # The click's own output saved on the desk, the player on the
        # interface; then the player is moved onto the desk.
        a82.set_click_device(3)
        a82.set_output_device(0)
        a82.player_open([{"name": "Quiet", "file": str(tmp82 / "Quiet.wav")}])
        a82.metronome_play()
        own82 = a82._metronome._free
        moved82b = a82.set_output_device(3)
        ok("the player moved onto the card the click plays on: it opens there, and takes the click",
           own82.kind == "own" and own82.sink.device_index == 3 and moved82b["ok"] and "warning" not in moved82b
           and a82._player.holds(3) and a82._metronome._free.kind == "player")
    finally:
        _sd.OutputStream, _sd.InputStream, _sd.Stream = kinds82
        OneAsio81.open_now.clear()
        a82.shutdown()

    print("\n[83] The metronome through the Api")
    # Record takes its tempo, signature and click from the metronome's row,
    # whoever presses it (spec Parts 2 to 4), and the take keeps them. The
    # screen hears the count-in from metronome_state. Each part runs as [66]'s
    # do: one that breaks says so, and the rest still run.
    import contextlib as contextlib83
    import threading as threading83

    import rehearsal_recorder.api as apimod83
    import rehearsal_recorder.audio.capture as capture83
    from rehearsal_recorder.audio.wavfile import read_acid as read_acid83
    from rehearsal_recorder.mediaserver import POLLABLE as POLLABLE83

    Recorder83 = capture83.AudioRecorder
    real_start83 = Recorder83.start
    another83 = "Another ASIO card can't play while one records."
    # Stop runs on to the next quarter while the card sends blocks. None come
    # here after the last one a check feeds, so Stop does not wait long for them.
    quiet83 = capture83.RUN_ON_QUIET_SEC
    capture83.RUN_ON_QUIET_SEC = 0.02

    def api83():
        a = fresh_api(Path(tempfile.mkdtemp()))[1]
        a.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
        return a

    def feed83(a, blocks):
        """`blocks` blocks of 1024 from the card, the driver saying nothing of when."""
        rec = a._recorder
        for _ in range(blocks):
            indata = np.zeros((1024, 1), np.int16)
            if rec.click is not None and rec.click.duplex:
                rec._duplex_callback(indata, np.zeros((1024, rec.click.width), np.float32), 1024, None, None)
            else:
                rec._callback(indata, 1024, None, None)

    def take83(a, keep=None, blocks=4):
        """Record, a few blocks, Stop, and keep the take as `keep`, or throw it away."""
        a.start_take()
        feed83(a, blocks)
        stopped = a.stop_take()
        if keep is None:
            a.discard_take(stopped["temp_dir"])
            return stopped, None
        return stopped, a.keep_take(stopped["take_number"], stopped["temp_dir"], keep,
                                    stopped["duration_sec"], stopped["tracks"])

    def state83(a, *keys):
        found = a.metronome_state()
        return tuple(found[k] for k in keys)

    a83 = api83()

    @scenario66("the settings and the polling")
    def _():
        settings = a83.get_settings()
        ok("the settings carry the metronome's, with no device of its own to begin with",
           settings["click_device_index"] is None and settings["click_channels"] is None
           and settings["click_sound"] == "click" and settings["count_in_bars"] == 1
           and settings["metronome_on"] is True and settings["tempo_in_wav"] is True
           and a83.metronome_state()["output_missing"] is None)
        ok("metronome_state and the taps are served for polling",
           "metronome_state" in POLLABLE83 and "metronome_taps" in POLLABLE83)
        ok("the click on the recording card's outputs 1-2", a83.set_click_device(0)["ok"]
           and a83.get_settings()["click_device_index"] == 0 and a83.get_settings()["click_channels"] == [1, 2])

    @scenario66("a song's first click take")
    def _():
        a83.set_next_take_name("Ahon")
        stopped, kept = take83(a83, keep="Ahon")
        ok("a take with no tempo has no click, and keeps no tempo",
           stopped["tempo"] is None and stopped["click"] is False
           and kept["take"]["tempo"] is None and kept["take"]["click"] is False)
        ok("the next take is the same song's, which has no tempo",
           state83(a83, "case", "tempo") == ("song_without", None) and a83.metronome_state()["song"]["title"] == "Ahon")
        ok("128 typed in the row is held", a83.metronome_set(128, "4/4")["ok"] and state83(a83, "tempo", "held") == (128, True))
        opened = _sd.Stream.opened
        started = a83.start_take()
        rec = a83._recorder
        ok("the click on the recording card: one stream with its inputs and its outputs",
           started["ok"] and _sd.Stream.opened == opened + 1 and rec.click is not None and rec.click.duplex
           and rec._stream.kw["device"] == (0, 0))
        ok("the moment Record returns, the screen hears a count-in whose first click is not chosen yet",
           state83(a83, "phase", "count", "since_count_in_ms", "tempo") == ("count", 0, None, 128))
        ok("take.json has the click at 128 in 4/4",
           json.loads((Path(a83._recorder_temp_dir) / "take.json").read_text("utf-8"))["click"]["tempo"] == 128)

        # The card's blocks in made-up time, each arriving as its last frame is
        # captured. With nothing said by the driver the round trip is the
        # stream's two latencies, 0.1 s, and the first click is chosen 0.1 s
        # on and that much later: frame 9600, written at frame 4800, heard
        # 50 ms after its block is in. So click k is heard 0.15 s + k x 60/128
        # in, and the count-in's end, click 4, at 2.025 s.
        real_ns = time.perf_counter_ns
        start_ns = 3_000_000_000_000
        now, fed = [start_ns], [0]

        def at(sec):
            while fed[0] * 1024 / SR <= sec:
                now[0] = start_ns + fed[0] * 1024 * 1_000_000_000 // SR
                feed83(a83, 1)
                fed[0] += 1
            now[0] = start_ns + round(sec * 1e9)
            return a83.metronome_state()

        time.perf_counter_ns = lambda: int(now[0])
        try:
            heard = [(s["phase"], s["count"]) for s in map(at, (0.1, 0.16, 0.63, 1.1, 1.57, 2.0))]
            first = rec.click.first_click_frame
            ended = at(2.0252)
            later = at(2.525)
        finally:
            time.perf_counter_ns = real_ns
        ok("the first click chosen from the first block: frame 9600", first == 9600)
        ok("the count-in as it is heard: 1, 2, 3 and 4, each from its click",
           heard == [("count", 0), ("count", 1), ("count", 2), ("count", 3), ("count", 4), ("count", 4)])
        ok("then the take, from the count-in's end",
           ended["phase"] == "take" and ended["count"] == 0 and abs(ended["since_count_in_ms"] - 0.2) < 0.5)
        ok("  counting on from there", later["phase"] == "take" and abs(later["since_count_in_ms"] - 500) < 0.5)
        ok("the switch off mid-take silences the click", a83.metronome_set_on(False)["ok"]
           and rec.click.record()["on"] is False)
        stopped = a83.stop_take()
        a83.metronome_set_on(True)
        ok("  and the take is a click take all the same: Stop says 128, 4/4, clicked",
           (stopped["tempo"], stopped["signature"], stopped["click"]) == (128, "4/4", True))
        a83.discard_take(stopped["temp_dir"])
        ok("a click take thrown away, a false start, gives its song no tempo",
           a83._lib.tempo_for("Ahon")["song"]["tempo"] is None)
        ok("  and the row still holds 128", state83(a83, "tempo", "held") == (128, True))
        # Twelve blocks, past the first click at frame 9600: a take whose card
        # goes quiet before it is no click take ([80]).
        stopped, kept = take83(a83, keep="Ahon", blocks=12)
        song = a83._lib.tempo_for("Ahon")["song"]
        ok("the first click take kept gives the song its tempo: 128 in 4/4",
           (kept["take"]["tempo"], kept["take"]["signature"], kept["take"]["click"]) == (128, "4/4", True)
           and (song["tempo"], song["signature"]) == (128, "4/4"))
        ok("  and the row is the song's own now, nothing held", state83(a83, "tempo", "held") == (128, False))

    @scenario66("the switch off")
    def _():
        a83.metronome_set_on(False)
        opened = _sd.Stream.opened
        a83.start_take()
        ok("Record opens the card's inputs alone, with no click",
           _sd.Stream.opened == opened + 1 and a83._recorder.click is None and a83._recorder._stream.kw["device"] == 0)
        ok("  and the screen shows a take with no count-in, so its clock runs from Record",
           state83(a83, "phase", "since_count_in_ms") == ("take", None))
        feed83(a83, 4)
        stopped = a83.stop_take()
        kept = a83.keep_take(stopped["take_number"], stopped["temp_dir"], "Ahon",
                             stopped["duration_sec"], stopped["tracks"])
        ok("the take keeps its tempo, and is no click take",
           (stopped["tempo"], stopped["click"]) == (128, False)
           and (kept["take"]["tempo"], kept["take"]["signature"], kept["take"]["click"]) == (128, "4/4", False))
        a83.metronome_set_on(True)

    @scenario66("a change held in the row")
    def _():
        a83.set_next_take_name("Palyn")
        ok("a name no song has yet: the row is empty", state83(a83, "tempo", "held") == (None, False))
        take83(a83, keep="Palyn")
        saved = a83.set_song_tempo(a83._lib.song_id("Palyn"), 120, "4/4")
        ok("a tempo given on the song's page: the row shows it",
           saved["ok"] and state83(a83, "tempo", "held") == (120, False))
        a83.metronome_set(132, "4/4")
        a83.set_next_take_name("Palyn 3")
        ok("a change held in the row survives a keystroke in the same song's name",
           state83(a83, "tempo", "held") == (132, True))
        a83.set_next_take_name("Ahon")
        ok("  and goes when the name leads to another song", state83(a83, "tempo", "held") == (128, False)
           and a83.metronome_state()["song"]["title"] == "Ahon")
        a83.set_next_take_name("Palyn")
        ok("  for good: back on the first song, the row is its own", state83(a83, "tempo", "held") == (120, False))

    @scenario66("the click elsewhere")
    def _():
        ok("the click on the desk's outputs", a83.set_click_device(3)["ok"]
           and a83.get_settings()["click_device_index"] == 3 and a83.get_settings()["click_channels"] == [1, 2])
        opened = _sd.Stream.opened
        a83.start_take()
        rec = a83._recorder
        ok("Record: the take's inputs, and a stream of the click's own on the desk",
           _sd.Stream.opened == opened + 2 and rec._stream.kw["device"] == 0
           and not rec.click.duplex and rec.click.output.device_index == 3)
        # The desk's stream never sends a block here, so the first click is
        # never chosen: Stop keeps the take whole, a take with no click at the
        # row's 120, as one stopped before a slow output starts.
        feed83(a83, 4)
        stopped = a83.stop_take()
        gtr = Path(stopped["tracks"][0]["file"])
        with wave.open(str(gtr), "rb") as w:
            frames = w.getnframes()
        ok("Stop before the first click keeps all the audio before it, with no tempo in its WAV",
           frames == 4 * 1024 and stopped["duration_sec"] == 4 * 1024 / SR and read_acid83(gtr) is None)
        a83._meters.clear()
        ok("  and it is no click take, but keeps its tempo, now and after a restart",
           (stopped["tempo"], stopped["signature"], stopped["click"]) == (120, "4/4", False)
           and a83._meter_of_draft(stopped["temp_dir"]) == {"tempo": 120, "signature": "4/4", "click": False})
        a83.discard_take(stopped["temp_dir"])
        # A Stop that breaks says the same in memory as its take.json does.
        a83.start_take()
        rec = a83._recorder
        feed83(a83, 4)

        def broken_stop(*args, **kwargs):
            rec.abandon()
            raise OSError("Cannot finalise")

        rec.stop = broken_stop
        try:
            a83.stop_take()
        except OSError:
            pass
        draft = rec.out_dir
        ok("a Stop that broke before the first click: no click take, as its take.json says",
           rec.click.first_click_frame is None
           and a83._meter_of_draft(draft) == {"tempo": 120, "signature": "4/4", "click": False})
        a83._meters.clear()
        ok("  and the same once the app has started again",
           a83._meter_of_draft(draft) == {"tempo": 120, "signature": "4/4", "click": False})
        a83.discard_take(str(draft))
        ok("no click device: the click goes back to where the player plays", a83.set_click_device(None)["ok"]
           and a83.get_settings()["click_device_index"] is None and a83.get_settings()["click_channels"] is None)

    @scenario66("the click between takes and Record")
    def _():
        found = []

        def watched(rec):
            found.append(a83._metronome._free)
            real_start83(rec)

        ok("play between takes", a83.metronome_play()["ok"] and a83.metronome_state()["phase"] == "preview")
        Recorder83.start = watched
        try:
            started = a83.control_command("start")
        finally:
            Recorder83.start = real_start83
        ok("Record from the screen stops it before the recorder opens the card", started["ok"] and found == [None])
        ok("Stop for the click between takes leaves the take's click alone",
           a83.metronome_stop()["ok"] and a83._recorder.click is not None and a83.metronome_state()["phase"] == "count")
        feed83(a83, 4)
        a83.discard_take(a83.stop_take()["temp_dir"])

    @contextlib83.contextmanager
    def portaudio_stops83():
        """Look again, with PortAudio's stop and start counted rather than
        done: what it yields lists each stop, which would end every stream."""
        stops = []
        saved = {n: getattr(_sd, n, None) for n in ("_initialized", "_terminate", "_initialize")}
        _sd._initialized = 1
        _sd._terminate = lambda: stops.append("stopped")
        _sd._initialize = lambda: None
        try:
            yield stops
        finally:
            for n, value in saved.items():
                if value is None:
                    if hasattr(_sd, n):
                        delattr(_sd, n)
                else:
                    setattr(_sd, n, value)

    def look_again83(answers):
        """Look again from another thread, as the screen asks it, while this one waits."""
        other = threading83.Thread(target=lambda: answers.append(a83.rescan_devices()), daemon=True)
        other.start()
        other.join(5)

    @scenario66("Look again while Record opens the card")
    def _():
        answers = []

        def rescanning(rec):
            real_start83(rec)
            look_again83(answers)

        with portaudio_stops83() as stops:
            Recorder83.start = rescanning
            try:
                started = a83.start_take()
            finally:
                Recorder83.start = real_start83
            ok("between the take's streams opening and Record returning, Look again is refused",
               started["ok"] and len(answers) == 1 and answers[0]["ok"] is False and stops == [])
            feed83(a83, 4)
            a83.discard_take(a83.stop_take()["temp_dir"])
            ok("  and once the take is over it looks again", a83.rescan_devices()["ok"] and stops == ["stopped"])

    @scenario66("Look again while Stop runs on")
    def _():
        answers = []
        real_stop = Recorder83.stop

        def rescanning(rec, *args, **kwargs):
            look_again83(answers)
            return real_stop(rec, *args, **kwargs)

        with portaudio_stops83() as stops:
            a83.start_take()
            feed83(a83, 4)
            Recorder83.stop = rescanning
            try:
                stopped = a83.stop_take()
            finally:
                Recorder83.stop = real_stop
            ok("while Stop runs on to the next quarter, the take's streams still open, Look again is refused",
               stopped["ok"] and len(answers) == 1 and answers[0]
               == {"ok": False, "error": "Not while a take is being saved. Look again once it is saved."}
               and stops == [])
            a83.discard_take(stopped["temp_dir"])
            ok("  and once the take is saved it looks again", a83.rescan_devices()["ok"] and stops == ["stopped"])

    @scenario66("where the click cannot go")
    def _():
        ok("every output can take the click when no card is on ASIO",
           all(d["click_unavailable"] is None for d in a83.list_output_devices()))
        hostapis = _sd.query_hostapis
        _sd.query_hostapis = lambda: [{"name": "ASIO"}]
        try:
            listed = {d["index"]: d["click_unavailable"] for d in a83.list_output_devices()}
            refused = a83.set_click_device(3)
        finally:
            _sd.query_hostapis = hostapis
        ok("the recording card on ASIO: another ASIO card cannot take the click",
           listed == {0: None, 2: another83, 3: another83})
        ok("  and is refused as its device, in those words", refused == {"ok": False, "error": another83})
        ok("  the click's device left as it was", a83.get_settings()["click_device_index"] is None)

    @scenario66("the click and the player")
    def _():
        takes = a83._session_takes()
        clicked = next(t for t in takes if t["click"])
        plain = next(t for t in takes if t["tempo"] is None)
        ok("the player's click switched on", a83.player_set_click(True)["ok"])
        a83.player_open(clicked["tracks"])
        ok("on as set, for the take opened, at its own tempo",
           a83._player.state()["click"] is True and a83._player._take_click[:2] == (128, "4/4"))
        a83.player_close()
        a83.player_open(plain["tracks"])
        ok("  and still on for the next take opened, which has no click of its own",
           a83._player.state()["click"] is True and a83._player._take_click is None)
        a83.player_close()
        a83.metronome_set(120, "4/4")
        a83.metronome_play()
        ok("play between takes with the player closed: a stream of its own", a83._metronome._free.kind == "own")
        a83.player_open(clicked["tracks"])
        ok("the player opened on the click's output takes it into its own stream",
           a83._metronome._free.kind == "player" and a83._player.free_click is a83._metronome._free.source)
        a83.player_close()
        ok("  and closed, gives it back a stream of its own",
           a83._metronome._free is not None and a83._metronome._free.kind == "own")
        a83.metronome_stop()
        fresh = fresh_api(Path(tempfile.mkdtemp()))[1]
        fresh.player_open(clicked["tracks"])
        ok("in an app just started the player's click is off", fresh._player.state()["click"] is False)
        fresh.shutdown()

    @scenario66("Play on a song's page")
    def _():
        # The next take is Palyn's, at 120; 132 is typed in the row and held.
        a83.metronome_set(132, "4/4")
        played = a83.metronome_play(96, "3/4")
        state = a83.metronome_state()
        ok("a song's page plays its own tempo through the Api, and the screen shows it",
           played["ok"] and (state["phase"], state["tempo"], state["signature"], state["per_bar"])
           == ("preview", 96, "3/4", 3) and state["held"] is True)
        a83.metronome_stop()
        ok("  and once it stops, the row's held change is still there",
           state83(a83, "phase", "tempo", "signature", "held") == ("idle", 132, "4/4", True))
        ok("a tempo out of its range, or a signature not one of the four, is refused as the row's is",
           a83.metronome_play(20, "4/4") == {"ok": False, "error": "A tempo in 4/4 is a whole number from 30 to 300"}
           and a83.metronome_play(96, "5/4")["ok"] is False and a83.metronome_state()["phase"] == "idle")
        ok("with no tempo it plays the row's, as before",
           a83.metronome_play()["ok"] and state83(a83, "phase", "tempo") == ("preview", 132))
        a83.metronome_stop()
        a83.start_take()
        ok("during a take it is refused", a83.metronome_play(96, "3/4") == {"ok": False, "error": "The take has its own click"})
        feed83(a83, 4)
        a83.discard_take(a83.stop_take()["temp_dir"])
        a83.metronome_set(120, "4/4")

    @scenario66("a click device not plugged in")
    def _():
        a83._config["click_device"] = {"name": "X18", "host_api": "CoreAudio"}
        a83._config["click_device_index"] = 7
        a83._metronome.devices_changed()
        ok("its index in the settings is none, and its name is in the state",
           a83.get_settings()["click_device_index"] is None and a83.metronome_state()["output_missing"] == "X18")
        ok("  the settings name it as the unplugged device, which no output that will not open is",
           a83.get_settings().get("click_device_missing") == "X18")
        a83._config["click_device"] = {"host_api": "CoreAudio"}
        a83._metronome.devices_changed()
        ok("  one saved with no name: an empty name, and the screen says it without one",
           a83.metronome_state()["output_missing"] == "")
        a83.set_click_device(None)
        ok("  and none once the click goes back to the player's output", a83.metronome_state()["output_missing"] is None)

    @scenario66("drafts rescued after a restart")
    def _():
        # Two takes stopped and never kept, one to the click and one with the
        # switch off, both at the row's 120. The app then starts again: what
        # Stop said is gone, and each take.json is what is left.
        a83.set_click_device(0)
        a83.start_take()
        feed83(a83, 16)
        clicked = a83.stop_take()
        a83.metronome_set_on(False)
        a83.start_take()
        feed83(a83, 16)
        plain = a83.stop_take()
        a83.metronome_set_on(True)
        a83._meters.clear()
        ok("the take with the switch off, its take.json read back: its tempo, and no click",
           a83._meter_of_draft(plain["temp_dir"]) == {"tempo": 120, "signature": "4/4", "click": False})
        rescued = [a83.recover_draft(t["temp_dir"]) for t in (clicked, plain)]
        meters = [(r["take"]["tempo"], r["take"]["signature"], r["take"]["click"]) if r["ok"] else r
                  for r in rescued]
        ok("rescued, the click take keeps its tempo and its click", meters[0] == (120, "4/4", True))
        ok("  and the other its tempo, with no click", meters[1] == (120, "4/4", False))
        a83.set_click_device(None)

    a83.shutdown()
    capture83.RUN_ON_QUIET_SEC = quiet83

    print("\n[84] The grid after a crop")
    # A click take's crop starts on the bar line at or before the region and
    # ends on the next quarter, or at the take's end, so its files still start
    # on a bar and hold whole quarters (spec Part 9). Its .mid is cut the same,
    # and it stays a click take. The cloud's mix carries its tempo; WAV copies
    # are its files.
    from rehearsal_recorder.audio.take_click import acid_of as acid_of84
    from rehearsal_recorder.audio.wavfile import Acid as Acid84
    from rehearsal_recorder.audio.wavfile import WavWriter as WavWriter84
    from rehearsal_recorder.audio.wavfile import read_acid as read_acid84
    from rehearsal_recorder.midi.smf import meter_of as meter_of84
    from rehearsal_recorder.midi.smf import read_events as read_events84
    from rehearsal_recorder.midi.smf import write_mid as write_mid84

    a84 = api83()
    home84 = a84._session["folder"]
    key84 = (b"\x90\x3c\x40", b"\x80\x3c\x00")

    def draft84(number, tempo, wav_tempo=True, signature="4/4"):
        """A take as Stop leaves it: 12 s of Gtr.wav from its first click, each
        sample saying which frame it is, a .mid with a key at 4.25 s, and
        take.json with the click (none for a take with no tempo)."""
        d = home84 / "_drafts" / f"take {number}"
        d.mkdir(parents=True)
        acid = acid_of84(tempo, signature) if tempo and wav_tempo else None
        with WavWriter84(d / "Gtr.wav", SR, 1, 2, acid=acid) as w:
            w.write((np.arange(12 * SR) % 30000).astype("<i2").tobytes())
        tempo_us, meta = meter_of84(tempo, signature) if tempo else (500000, None)
        write_mid84(d / "Keys.mid", track_name="Keys", port_name="", start=[],
                    events=[(4.25, key84[0]), (4.5, key84[1])], tempo_us=tempo_us, time_signature=meta)
        record = {"samplerate": SR, "bit_depth": 16, "tracks": [{"file": "Gtr", "name": "Gtr", "channels": 1}],
                  "notes": []}
        if tempo:
            record["click"] = {"tempo": tempo, "signature": signature, "on": True, "wav_tempo": wav_tempo,
                               "first_click_frame": 9600, "end_frame": 9600 + 12 * SR}
        (d / "take.json").write_text(json.dumps(record), encoding="utf-8")
        a84._session["take_counter"] = number
        return d, [{"name": "Gtr", "file": str(d / "Gtr.wav")}], [{"name": "Keys", "file": str(d / "Keys.mid")}]

    def kept84(number, name, tempo, wav_tempo=True, markers=None, signature="4/4"):
        d, tracks, notes = draft84(number, tempo, wav_tempo, signature)
        return a84.keep_take(number, str(d), name, 12.0, tracks, markers=markers, notes=notes)["take"]

    def frames84(path):
        with wave.open(str(path), "rb") as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")

    def keys84(path):
        """The .mid's key, as (ticks at 1920 to the second, bytes), and its meter."""
        names, events = read_events84(path)
        return [(round(sec * 1920), data) for sec, data in events], names.get("time_signature")

    @scenario66("a saved click take")
    def _():
        take = kept84(1, "Palyn", 120, markers=[{"at": 2.5}, {"at": 3.0}])
        ok("a stopped take with the click in its take.json is kept as a click take at 120",
           (take["tempo"], take["signature"], take["click"]) == (120, "4/4", True))
        cut = a84.crop_take(str(home84), 1, 3.3, 10.2)
        gtr = frames84(cut["take"]["tracks"][0]["file"])
        # The cut's edges fade over 5 ms, so its frames are read past that.
        ok("3.3 to 10.2 s at 120 in 4/4 is cut 2.0 to 10.5 s, and says so",
           cut["ok"] and (cut["start_sec"], cut["end_sec"]) == (2.0, 10.5)
           and len(gtr) == round(8.5 * SR) and gtr[480] == (2 * SR + 480) % 30000)
        ok("  still a click take at 120, 8.5 s long",
           (cut["take"]["tempo"], cut["take"]["click"], cut["take"]["duration_sec"]) == (120, True, 8.5))
        ok("  its WAV carries the tempo still, its beats counted again",
           read_acid84(cut["take"]["tracks"][0]["file"]) == Acid84(120.0, 4, 4))
        ok("  its .mid cut at the same 2.0 s, the key now at 2.25 s, its meter kept",
           keys84(cut["take"]["notes"][0]["file"]) == ([(4320, key84[0]), (4800, key84[1])], (4, 2, 24, 8)))
        ok("  and its marks moved by the cut as made: 2.5 and 3.0 s are at 0.5 and 1.0 s",
           [m["at"] for m in cut["take"]["markers"]] == [0.5, 1.0] and cut["markers_dropped"] == 0)

    @scenario66("click takes without a tempo in their WAVs, and takes with no tempo")
    def _():
        kept84(2, "Ahon", 120, wav_tempo=False)
        cut = a84.crop_take(str(home84), 2, 3.3, 10.2)
        ok("a click take whose WAVs carry no tempo is cut on its grid, and they carry none after",
           (cut["start_sec"], cut["end_sec"]) == (2.0, 10.5) and read_acid84(cut["take"]["tracks"][0]["file"]) is None)
        kept84(3, "Vesna", None)
        cut = a84.crop_take(str(home84), 3, 3.3, 10.2)
        gtr = frames84(cut["take"]["tracks"][0]["file"])
        ok("a take with no tempo is cut where it was asked", cut["ok"] and (cut["start_sec"], cut["end_sec"]) == (3.3, 10.2)
           and len(gtr) == round(6.9 * SR) and gtr[480] == (round(3.3 * SR) + 480) % 30000)

    @scenario66("a draft")
    def _():
        d, tracks, notes = draft84(4, 120)
        cut = a84.crop_draft(str(d), tracks, 3.3, 10.2, notes=notes)
        ok("a stopped click take not yet kept is cut on its grid the same",
           cut["ok"] and (cut["start_sec"], cut["end_sec"], cut["duration_sec"]) == (2.0, 10.5, 8.5)
           and len(frames84(d / "Gtr.wav")) == round(8.5 * SR) and read_acid84(d / "Gtr.wav") == Acid84(120.0, 4, 4))
        ok("  its .mid too", keys84(d / "Keys.mid")[0] == [(4320, key84[0]), (4800, key84[1])])
        take = a84.keep_take(4, str(d), "Palyn", cut["duration_sec"], tracks, notes=notes)["take"]
        ok("  and kept, it is a click take at 120", (take["tempo"], take["click"]) == (120, True))

    @scenario66("a take in 6/8")
    def _():
        take = kept84(5, "Dym", 240, signature="6/8")
        cut = a84.crop_take(str(home84), 5, 4.6, 10.6)
        gtr = frames84(cut["take"]["tracks"][0]["file"])
        # At 240 in 6/8 a bar is six eighths, 1.5 s, and a quarter two, 0.5 s.
        # Read as 4/4, the same region would be cut 4.0 to 10.75 s.
        ok("a take kept in 6/8 at 240 is cut on its own grid: 4.6 to 10.6 s is 4.5 to 11.0 s",
           (take["tempo"], take["signature"], take["click"]) == (240, "6/8", True)
           and cut["ok"] and (cut["start_sec"], cut["end_sec"]) == (4.5, 11.0)
           and len(gtr) == round(6.5 * SR) and gtr[480] == (round(4.5 * SR) + 480) % 30000)
        ok("  its WAV still saying 120 quarters a minute in 6/8",
           read_acid84(cut["take"]["tracks"][0]["file"]) == Acid84(120.0, 6, 8))

    @scenario66("a region to the take's end, and a draft whose take.json went aside")
    def _():
        d, tracks, notes = draft84(6, 225, signature="6/8")
        # At 225 in 6/8 a bar is 1.6 s and a quarter 0.53 s: the take's 12 s
        # end half way through a quarter, so a region to 11.9 s ends at 12.0 s.
        cut = a84.crop_draft(str(d), tracks, 4.6, 11.9, notes=notes)
        ok("a region ending in the take's last part of a quarter ends at the take's end: 3.2 to 12.0 s",
           cut["ok"] and (cut["start_sec"], cut["end_sec"], cut["duration_sec"]) == (3.2, 12.0, 8.8)
           and len(frames84(d / "Gtr.wav")) == round(8.8 * SR))
        # A crop puts take.json aside with a notes file not yet made, and the
        # app started again forgets what Stop said: the WAV's tempo is left.
        (d / "take.json").unlink()
        a84._meters.clear()
        ok("a draft with no take.json is a click take by its WAV's tempo: 225 in 6/8",
           a84._meter_of_draft(d) == {"tempo": 225, "signature": "6/8", "click": True})
        take = a84.keep_take(6, str(d), "Dym", cut["duration_sec"], tracks, notes=notes)["take"]
        ok("  and kept as one", (take["tempo"], take["signature"], take["click"]) == (225, "6/8", True))

    @scenario66("the cloud")
    def _():
        a84._config["cloud_dir"] = str(Path(tempfile.mkdtemp()) / "cloud")
        a84._config["cloud_format"] = "wav"
        copied = a84._copy_to_cloud(home84, 1, "both")
        take = a84._lib.take(home84, 1)
        ok("the cloud's mix of a click take carries its tempo",
           copied["ok"] and read_acid84(copied["cloud"]["mix"]) == Acid84(120.0, 4, 4))
        ok("  and its WAV copies are the take's files, byte for byte",
           (Path(copied["cloud"]["tracks"]) / "Gtr.wav").read_bytes() == Path(take["tracks"][0]["file"]).read_bytes())
        copied = a84._copy_to_cloud(home84, 3, "mix")
        ok("the mix of a take with no tempo carries none", copied["ok"] and read_acid84(copied["cloud"]["mix"]) is None)

    @scenario66("renaming and merging")
    def _():
        renamed = a84.rename_take(str(home84), 1, "Zorka")
        ok("a click take renamed to a new song gives it its tempo, and keeps its own",
           renamed["ok"] and (a84._lib.tempo_for("Zorka")["song"]["tempo"], a84._lib.take(home84, 1)["tempo"]) == (120, 120))
        merged = a84.merge_songs(a84._lib.song_id("Zorka"), a84._lib.song_id("Vesna"))
        ok("merged into a song with no tempo, that song takes it",
           merged["ok"] and a84._lib.tempo_for("Vesna")["song"]["tempo"] == 120)
        a84.set_song_tempo(a84._lib.song_id("Ahon"), 96, "4/4")
        merged = a84.merge_songs(a84._lib.song_id("Vesna"), a84._lib.song_id("Ahon"))
        ok("  and a song with a tempo keeps its own", merged["ok"] and a84._lib.tempo_for("Ahon")["song"]["tempo"] == 96)

    @scenario66("a WAV's rate")
    def _():
        path = Path(tempfile.mkdtemp()) / "rate.wav"
        with WavWriter84(path, 48000.0, 1, 2) as w:
            w.write(b"\x00\x00" * 10)
        with wave.open(str(path), "rb") as r:
            ok("a WAV written at a rate given as 48000.0 says 48000", r.getframerate() == 48000)

    a84.shutdown()

    print("\n[85] Counting and tapping through the Api")
    # A song's tempo counted from one of its takes (spec Part 10) and set on its
    # page; Tap's pad hits (Part 11), outside a rehearsal from the band's own
    # ports, opened as the signal check opens them and given back after the pause.
    from fake_midi import FakePortSystem as Fake85
    from rehearsal_recorder.audio.click import Voices as Voices85
    from rehearsal_recorder.audio.click import click_frame as cf85
    from rehearsal_recorder.audio.click import mix_clicks as mix_clicks85
    from rehearsal_recorder.midi.ports import PortInfo as Port85

    a85 = api83()
    home85 = a85._session["folder"]

    def kept85(number, name, tempo):
        """A take of 12 s of the woodblock at `tempo` in 4/4, or of silence for none."""
        d = home85 / "_drafts" / f"take {number}"
        d.mkdir(parents=True)
        out = np.zeros((12 * SR, 1), np.float32)
        if tempo:
            starts = [(cf85(k, tempo, SR), 2 if k % 4 == 0 else 0) for k in range(tempo // 5)]
            mix_clicks85(out, 0, [s for s in starts if s[0] < len(out)], Voices85("wood", SR, 0.7), (0,))
        write = (out[:, 0] * 32767).astype("<i2")
        with wave.open(str(d / "Gtr.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(write.tobytes())
        a85._session["take_counter"] = number
        return a85.keep_take(number, str(d), name, 12.0, [{"name": "Gtr", "file": str(d / "Gtr.wav")}])["take"]

    @scenario66("counting a take")
    def _():
        kept85(1, "Palyn", 120)
        ok("count_tempo counts a take's tempo: 120", a85.count_tempo(str(home85), 1, "4/4") == {"ok": True, "tempo": 120})
        ok("a signature that is none of the four is refused", a85.count_tempo(str(home85), 1, "5/4")["ok"] is False)
        ok("and a take that is not there", a85.count_tempo(str(home85), 9, "4/4")["ok"] is False)
        kept85(2, "Ahon", None)
        quiet = a85.count_tempo(str(home85), 2, "4/4")
        ok("a take of silence has none to give, and says so", quiet["ok"] is False and quiet["error"])
        Path(a85._lib.take(home85, 1)["tracks"][0]["file"]).unlink()
        missing = a85.count_tempo(str(home85), 1, "4/4")
        ok("a take whose file is gone says which", missing["ok"] is False and "Gtr.wav" in missing["error"])

    @scenario66("a song's tempo")
    def _():
        song = a85._lib.song_id("Palyn")
        ok("a tempo out of its range is refused, in the library's words",
           a85.set_song_tempo(song, 400, "4/4") == {"ok": False, "error": "A tempo in 4/4 is a whole number from 30 to 300"})
        ok("  and a signature that is none of the four",
           a85.set_song_tempo(song, 120, "5/4") == {"ok": False, "error": "The time signature is one of 4/4, 3/4, 2/4 and 6/8"})
        ok("  and a song that is not there", a85.set_song_tempo(99999, 120, "4/4")["ok"] is False)
        a85.set_next_take_name("Palyn")
        saved = a85.set_song_tempo(song, 198, "6/8")
        ok("a tempo saved is the song's, and the row's while the next take is the song",
           saved["ok"] and (saved["tempo"], saved["signature"]) == (198, "6/8")
           and state83(a85, "tempo", "signature", "held") == (198, "6/8", False))
        here = a85.song_choices()["here"]
        ok("  and the songs offered for a take's name carry it",
           [(c["song"], c["tempo"], c["signature"]) for c in here] == [("Palyn", 198, "6/8"), ("Ahon", None, None)])
        ok("none takes it away", a85.set_song_tempo(song, None, None)["ok"]
           and a85._lib.tempo_for("Palyn")["song"]["tempo"] is None and a85.metronome_state()["tempo"] is None)

    a85.shutdown()

    @scenario66("tapping outside a rehearsal")
    def _():
        td17 = Port85("TD-17", "TD-17", "Roland")
        fake = Fake85([td17])
        real_open = apimod83.open_midi_system
        timing = (getattr(apimod83, "TAP_QUIET_SEC", None), getattr(apimod83, "TAP_POLL_SEC", None))
        apimod83.open_midi_system = lambda: (fake, None)
        # A pause of 0.2 s, not 2, for the ports to be given back.
        apimod83.TAP_QUIET_SEC, apimod83.TAP_POLL_SEC = 0.2, 0.01
        try:
            a = fresh_api(Path(tempfile.mkdtemp()))[1]
            band = [{"name": "Gtr", "channel": 1}, {"name": "Drums", "channel": 2, "mode": "both",
                                                     "midi_port": td17.saved()}]
            a.save_default_tracks({"device_index": 0, "tracks": band})
            ok("no port is open outside a rehearsal", not fake.open_ports)
            real_use = a._midi.use

            def half_open(tracks, check=False):
                real_use(tracks, check)
                raise OSError("the system refused")

            a._midi.use = half_open
            try:
                refused = a.metronome_tap_listen()
            finally:
                a._midi.use = real_use
            ok("ports that will not open: Tap is told why, and none is left open",
               refused == {"ok": False, "error": "The band's MIDI ports could not be opened: the system refused"}
               and not fake.open_ports and not a._midi.listening())
            ok("Tap on a song's page opens the band's ports",
               a.metronome_tap_listen()["ok"] and sorted(p.info.name for p in fake.open_ports) == ["TD-17"])
            fake.send("TD-17", time.perf_counter_ns(), bytes([0x99, 38, 100]))
            a._midi.drain()
            taps = a.metronome_taps()["ms_ago"]
            ok("a pad's hit is a tap, said as how long ago", len(taps) == 1 and 0 <= taps[0] < 1000)
            ok("  and handed over once", a.metronome_taps() == {"ms_ago": []})
            deadline = time.monotonic() + 3
            while fake.open_ports and time.monotonic() < deadline:
                time.sleep(0.01)
            ok("after the pause the ports are given back", not fake.open_ports and not a._midi.listening())
            a.start_rehearsal("Evening", 0, SR, band, 16)
            a.metronome_tap_listen()
            time.sleep(0.4)
            ok("in a rehearsal they are the rehearsal's, and stay open after the pause",
               sorted(p.info.name for p in fake.open_ports) == ["TD-17"])
            a.shutdown()
        finally:
            apimod83.open_midi_system = real_open
            for name, value in zip(("TAP_QUIET_SEC", "TAP_POLL_SEC"), timing):
                if value is None:
                    if hasattr(apimod83, name):
                        delattr(apimod83, name)
                else:
                    setattr(apimod83, name, value)

    print("\n[86] A take's Backing track in the mix and crop")
    # The Backing track is one of the take's WAVs to the mix and to a crop
    # (backing-track spec, Part 4): by its fader, the player's mute not being
    # applied to the mix, and cut with the others.
    from rehearsal_recorder.audio.backing_file import open_ready as open_ready86
    from rehearsal_recorder.audio.backing_file import write_take_track as wtt86
    from rehearsal_recorder.audio.crop import crop_wav as cw86
    from rehearsal_recorder.audio.mixdown import mixdown as md86
    from rehearsal_recorder.audio.wavfile import WavWriter as WavWriter86

    tmp86 = Path(tempfile.mkdtemp())
    t86 = np.arange(2 * SR) / SR
    file86 = np.stack([0.1 * np.sin(2 * np.pi * 220 * t86), 0.1 * np.sin(2 * np.pi * 330 * t86)], axis=1)
    with WavWriter86(tmp86 / "ready.wav", SR, 2, 4) as w:
        w.write(file86.astype("<f4").tobytes())
    wtt86(open_ready86(tmp86 / "ready.wav"), 0, 2 * SR, tmp86 / "Backing.wav", SR, 3)
    write_wav(tmp86 / "Gtr.wav", 1000, depth=24)

    def frames86(path):
        with wave.open(str(path), "rb") as w:
            raw = np.frombuffer(w.readframes(w.getnframes()), dtype=np.uint8)
            width, channels = w.getsampwidth(), w.getnchannels()
        if width == 2:
            return raw.view("<i2").reshape(-1, channels).astype(np.int64)
        whole = raw.reshape(-1, 3).astype(np.int64)
        values = whole[:, 0] | (whole[:, 1] << 8) | (whole[:, 2] << 16)
        return np.where(values >= 1 << 23, values - (1 << 24), values).reshape(-1, channels)

    tracks86 = [{"name": "Gtr", "file": str(tmp86 / "Gtr.wav")}, {"name": "Backing", "file": str(tmp86 / "Backing.wav")}]
    half86 = md86(tracks86, tmp86 / "Half.wav", volumes={"Backing": 0.5})
    want86 = 1000 + 0.5 * frames86(tmp86 / "Backing.wav") / 256
    ok("the mix has the Backing track by its fader, its sides kept",
       half86["ok"] and half86["gain"] == 1.0 and np.abs(frames86(tmp86 / "Half.wav") - want86).max() <= 1)
    md86(tracks86, tmp86 / "Down.wav", volumes={"Backing": 0.0})
    md86(tracks86[:1], tmp86 / "Alone.wav")
    ok("  a muted one is in it all the same, and its fader down takes it out",
       (tmp86 / "Down.wav").read_bytes() == (tmp86 / "Alone.wav").read_bytes())
    for name86 in ("Gtr", "Backing"):
        cw86(tmp86 / f"{name86}.wav", tmp86 / f"{name86} cut.wav", 0.5, 1.5)
    cut86 = frames86(tmp86 / "Backing cut.wav")
    ok("a crop cuts it with the band's tracks, to the same frames",
       len(cut86) == len(frames86(tmp86 / "Gtr cut.wav")) == SR
       and np.array_equal(cut86[600:-600], frames86(tmp86 / "Backing.wav")[SR // 2 + 600:SR * 3 // 2 - 600]))

    print("\n[87] Getting a new copy ready")
    # What fails is said on the line; the log's copy of it is not this suite's.
    logging.getLogger("rehearsal_recorder.updates").addHandler(logging.NullHandler())
    # Update downloads the new version beside the app, unpacks it there and
    # runs its self-test, so that Restart now has only a swap left to do. The
    # Windows build's layout, whatever this machine is, from [50]'s zip.
    import errno
    import subprocess
    from rehearsal_recorder.platform_support import script_command

    ran87 = []

    def runner87(code=0, hang=False):
        def run(argv, **kw):
            ran87.append((list(argv), kw))
            if hang:
                raise subprocess.TimeoutExpired(argv, kw.get("timeout"))
            return subprocess.CompletedProcess(argv, code, b"", b"")
        return run

    spawned87 = []
    trashed87 = []

    def place87(name="Reha"):
        where = Path(tempfile.mkdtemp()) / "Apps" / name
        where.mkdir(parents=True)
        (where / "Reha.exe").write_bytes(b"MZ old")
        return where

    def staging87(where):
        return where.parent / f"{where.name}-update"

    def state87(where):
        return where.parent.parent / "update.json"

    def updater87(where, body=archive, run=None, busy=lambda: False, current="0.8.0",
                  fetch=lambda: found, trash_ok=True, check=True, tag=None, opener=None):
        downloads87 = where.parent.parent / "Downloads"
        downloads87.mkdir(exist_ok=True)
        c = U.UpdateChecker(
            current, enabled=lambda: True, busy=busy, fetch=fetch,
            opener=opener or serving(body), downloads=lambda: downloads87, reveal=shown.append,
            place=lambda: where, state=state87(where),
            run=run or runner87(),
            spawn=lambda argv, env, cwd=None: spawned87.append((argv, env, cwd)),
            trash=lambda p: trashed87.append(p) or trash_ok, system="win32", pid=4242,
            tag=tag)
        if check:
            c.check_now()
        return c

    def settled87(c):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            install = c.status()["install"]
            if install and install["state"] not in ("downloading", "preparing"):
                break
            time.sleep(0.05)
        return c.status()["install"]

    def ready87(where, version="0.9.0"):
        # A copy got ready by an earlier run, as prepare_now leaves it.
        copy = staging87(where) / "Reha"
        copy.mkdir(parents=True)
        (copy / "Reha.exe").write_bytes(b"MZ new")
        (staging87(where) / U.STAGING_MARK).write_text("made by the app", encoding="utf-8")
        (staging87(where) / "ready.json").write_text(
            json.dumps({"version": version, "copy": "Reha"}), encoding="utf-8")

    asked87 = []
    looping = U.UpdateChecker("0.8.0", enabled=lambda: True, busy=lambda: False,
                              fetch=lambda: asked87.append(True))
    looping.start()
    deadline87 = time.monotonic() + 5
    while time.monotonic() < deadline87 and not asked87:
        time.sleep(0.05)
    looping.stop()
    ok("the daily check runs on its own thread and asks", asked87 == [True])

    probes87 = []
    probe_before = U.can_write_beside
    U.can_write_beside = lambda where: probes87.append(where) or True
    try:
        updater87(place87(), fetch=lambda: None)
        updater87(place87(), fetch=lambda: {"version": "0.8.0", "tag": "0.8.0", "asset": None})
        quiet87 = len(probes87)
        updater87(place87())
    finally:
        U.can_write_beside = probe_before
    # A file made beside an app on the Desktop or in Documents can make macOS
    # ask for that folder, and no dialog may come at launch.
    ok("with nothing newer out, it does not try writing beside itself",
       quiet87 == 0 and len(probes87) == 1)

    place = place87()
    staging = staging87(place)
    c87 = updater87(place)
    ok("a copy that may write beside itself says it can replace itself",
       c87.status()["replace"] is True)
    ok("before anybody asks, nothing is being got ready",
       c87.status()["install"] is None and c87.status()["updated"] is None)
    ok("Update starts getting it ready", c87.start_update()["ok"] is True)
    ok("said to be ready once checked",
       settled87(c87) == {"state": "ready", "version": "0.9.0"})
    ok("downloaded, unpacked and checked beside the app, not in Downloads",
       (staging / "ready.json").is_file() and (staging / "Reha" / "Reha.exe").is_file()
       and not any((place.parent.parent / "Downloads").iterdir()))
    ok("the zip is gone once unpacked",
       not list(staging.glob("*.zip")) and not list(staging.glob("*.part")))
    argv87, kw87 = ran87[-1]
    ok("the new copy's own self-test was run",
       argv87 == [str(staging / "Reha" / "Reha.exe"), "--selftest"])
    ok("given two minutes at most", kw87.get("timeout") == 120 == U.SELFTEST_TIMEOUT_SEC)
    # Started from the built app, the new copy would take PyInstaller's
    # settings for its own and count as part of this one.
    ok("as an app of its own, not as part of this one",
       kw87.get("env", {}).get("PYINSTALLER_RESET_ENVIRONMENT") == "1")
    ok("Update again while it is ready starts nothing",
       c87.start_update()["ok"] is True and len(ran87) == 1)

    slow_before = U.can_write_beside
    U.can_write_beside = lambda where: time.sleep(0.3) or True
    try:
        twice87 = updater87(place87())
        prepared87 = []
        prepare87 = twice87.prepare_now
        twice87.prepare_now = lambda: prepared87.append(True) or prepare87()
        before87 = len(ran87)
        presses87 = [threading.Thread(target=twice87.start_update) for _ in range(2)]
        for press87 in presses87:
            press87.start()
        for press87 in presses87:
            press87.join()
    finally:
        U.can_write_beside = slow_before
    settled87(twice87)
    ok("two presses at once get one copy ready, once",
       prepared87 == [True] and len(ran87) == before87 + 1)

    def failed87(c):
        c.prepare_now()
        install = c.status()["install"]
        return install["error"] if install and install["state"] == "failed" else install

    p87 = place87()
    ok("a self-test that fails says why",
       failed87(updater87(p87, run=runner87(1))) == "The new copy did not start here")
    ok("and leaves nothing beside the app", not staging87(p87).exists())
    ok("one that hangs is given up",
       failed87(updater87(place87(), run=runner87(hang=True)))
       == "The new copy took too long to start")

    no_app = _io.BytesIO()
    with zipfile.ZipFile(no_app, "w") as z:
        z.writestr("readme.txt", b"not the app")
    no_app = no_app.getvalue()
    found_no_app = {"version": "0.9.0", "tag": "0.9.0",
                    "asset": {"name": "RehearsalRecorder-windows.zip", "size": len(no_app),
                              "sha256": hashlib.sha256(no_app).hexdigest()}}
    p87 = place87()
    ok("a zip that will not unpack says so",
       failed87(updater87(p87, body=no_app, fetch=lambda: found_no_app))
       == "The download could not be unpacked")
    ok("and leaves nothing either", not staging87(p87).exists())

    def no_room(*args, **kwargs):
        raise OSError(errno.ENOSPC, "No space left on device")

    unpack_before = U.unpack_app
    U.unpack_app = no_room
    try:
        said87 = failed87(updater87(place87()))
    finally:
        U.unpack_app = unpack_before
    ok("a full disk says so", said87 == "There is no room for it on the disk")
    ok("a download that does not match says so, as Download does",
       "does not match" in failed87(updater87(place87(), body=archive[:-4] + b"oops")))

    def offline87(request, timeout, context):
        raise OSError("no route to host")

    ok("with no internet it says so in words",
       failed87(updater87(place87(), opener=offline87))
       == "The download stopped. Check the internet and try again")

    p87 = place87()
    staging87(p87).mkdir()
    (staging87(p87) / U.STAGING_MARK).write_text("made by the app", encoding="utf-8")
    rmtree_before = U.shutil.rmtree
    U.shutil.rmtree = lambda *args, **kwargs: None
    try:
        held87 = failed87(updater87(p87))
    finally:
        U.shutil.rmtree = rmtree_before
    ok("files of a last try still held say so in words",
       held87 == "Files from the last try are still in use. Try again in a minute")

    theirs = place87()
    staging87(theirs).mkdir()
    (staging87(theirs) / "my zips.txt").write_text("mine", encoding="utf-8")
    updater87(theirs, check=False).after_start()
    ok("a folder of that name the app did not make is left alone at the start",
       (staging87(theirs) / "my zips.txt").is_file())
    ok("and Update says it is in the way rather than removing it",
       failed87(updater87(theirs)) == "A folder named Reha-update is in the way beside the app"
       and (staging87(theirs) / "my zips.txt").is_file())

    ok("refused while a take records",
       updater87(place87(), busy=lambda: True).start_update()
       == {"ok": False, "error": "Not while a take is recording"})
    stuck = updater87(Path(tempfile.mkdtemp()) / "missing" / "Reha")
    ok("a copy that cannot write beside itself says so",
       stuck.status()["replace"] is False)
    ok("and Update is refused there",
       stuck.start_update() == {"ok": False, "error": "This copy can't replace itself where it is"})
    ok("with nothing newer, nothing to update to",
       updater87(place87(), fetch=lambda: None).start_update()["error"]
       == "There is no newer version to download")

    # A take started while it downloads: the download is held until the take
    # has started, then let through.
    take87 = {"on": False}
    gate87 = threading.Event()

    def gated87(request, timeout, context):
        gate87.wait(10)
        return _Answer(archive)

    waiting = updater87(place87(), busy=lambda: take87["on"], opener=gated87)
    waiting.start_update()
    take87["on"] = True
    before87 = len(ran87)
    gate87.set()
    deadline87 = time.monotonic() + 5
    while time.monotonic() < deadline87 and waiting.status()["install"]["state"] == "downloading":
        time.sleep(0.05)
    time.sleep(0.5)
    ok("a take started while it downloads holds the self-test back",
       len(ran87) == before87 and waiting.status()["install"]["state"] == "preparing")
    take87["on"] = False
    ok("until the take stops", settled87(waiting)["state"] == "ready")

    p87 = place87()
    staging87(p87).mkdir()
    (staging87(p87) / U.STAGING_MARK).write_text("made by the app", encoding="utf-8")
    (staging87(p87) / "RehearsalRecorder-0.9.0-windows.zip.part").write_bytes(b"half")
    updater87(p87, check=False).after_start()
    ok("a half-made copy left by a closed app is removed at the next start",
       not staging87(p87).exists())

    p87 = place87()
    ready87(p87, "0.8.5")
    waited87 = updater87(p87, check=False)
    waited87.after_start()
    ok("a ready copy left waiting is offered again at the next start",
       waited87.status()["install"] == {"state": "ready", "version": "0.8.5"})
    waited87.check_now()
    ok("until a newer release is out: then it is removed",
       not staging87(p87).exists() and waited87.status()["install"] is None
       and waited87.status()["latest"] == {"version": "0.9.0"})
    p87 = place87()
    ready87(p87, "0.8.0")
    same87 = updater87(p87, check=False)
    same87.after_start()
    ok("a ready copy no newer than this one is removed",
       not staging87(p87).exists() and same87.status()["install"] is None)

    tagged_release = {"tag_name": "0.9.0rc2", "prerelease": True,
                      "assets": release["assets"]}
    tag_asked = []

    def tag_github(request, timeout, context):
        tag_asked.append(request.full_url)
        return _Answer(json.dumps(tagged_release).encode())

    tagged_fetch = lambda: U.fetch_latest(tag_github, system="win32", tag="0.9.0rc2")  # noqa: E731
    tagged = updater87(place87(), current="0.9.0rc1", fetch=tagged_fetch, tag="0.9.0rc2")
    ok("REHA_UPDATE_TAG asks for that release by its tag",
       tag_asked[-1].endswith("/repos/voronizer/rehearsal-recorder/releases/tags/0.9.0rc2"))
    ok("and offers it, pre-release or not, whatever its number",
       tagged.status()["latest"] == {"version": "0.9.0rc2"})
    ok("but not to the copy that is that release already",
       updater87(place87(), current="0.9.0rc2", fetch=tagged_fetch,
                 tag="0.9.0rc2").status()["latest"] is None)
    p87 = place87()
    ready87(p87, "0.9.0rc2")
    tag_ready = updater87(p87, current="0.9.0rc1", fetch=tagged_fetch, tag="0.9.0rc2",
                          check=False)
    tag_ready.after_start()
    ok("a pre-release got ready under REHA_UPDATE_TAG waits for the next start too",
       tag_ready.status()["install"] == {"state": "ready", "version": "0.9.0rc2"})
    ok("a tag that is not one is never asked for",
       U.fetch_latest(tag_github, system="win32", tag="../latest") is None
       and len(tag_asked) == 2)

    print("\n[88] Restart now and the first start")
    # c87's copy is ready beside `place`.
    ok("Restart now starts the swap script", c87.restart() == {"ok": True})
    argv88, env88, cwd88 = spawned87[0]
    ok("with the system's own shell, from beside the app",
       argv88 == script_command(staging / "reha-swap.cmd", "win32")
       and (staging / "reha-swap.cmd").is_file())
    ok("and the paths in its environment",
       env88["REHA_PLACE"] == str(place) and env88["REHA_PID"] == "4242"
       and env88["REHA_NEW"] == str(staging / "Reha")
       and env88["REHA_RESULT"] == str(staging / "result"))
    ok("the script works from the folder that holds the app, not from inside it",
       cwd88 == place.parent)
    ok("the old copy will be named after its version, beside the new one",
       Path(env88["REHA_OLD"]) == place.parent / "Reha 0.8.0")
    ok("the app the script opens is an app of its own",
       env88.get("PYINSTALLER_RESET_ENVIRONMENT") == "1" and "REHA_OPEN" not in env88)
    ok("what is happening is written down for the next start",
       json.loads(state87(place).read_text(encoding="utf-8"))
       == {"from": "0.8.0", "to": "0.9.0", "old": str(place.parent / "Reha 0.8.0")})
    ok("a second press starts no second script",
       c87.restart() == {"ok": False, "error": "Already restarting"} and len(spawned87) == 1)
    ok("nothing ready, nothing to restart into",
       updater87(place87()).restart()["ok"] is False and len(spawned87) == 1)
    gone88 = place87()
    ready87(gone88)
    gone_c = updater87(gone88, check=False)
    gone_c.after_start()
    import shutil as shutil88
    shutil88.rmtree(staging87(gone88) / "Reha")
    spawned_before = len(spawned87)
    ok("a ready copy that has gone is not restarted into",
       gone_c.restart() == {"ok": False, "error": "The new copy is not there any more"}
       and len(spawned87) == spawned_before)
    ok("and Update is offered again", gone_c.status()["install"] is None)
    ok("and not while a take records",
       updater87(place87(), busy=lambda: True).restart()
       == {"ok": False, "error": "Not while a take is recording"})

    cyr = place87("Музыка Reha")
    ready87(cyr)
    cyr_c = updater87(cyr, check=False)
    cyr_c.after_start()
    cyr_c.restart()
    ok("a name with spaces and Cyrillic keeps its own name",
       Path(spawned87[-1][1]["REHA_OLD"]).name == "Музыка Reha 0.8.0"
       and spawned87[-1][1]["REHA_PLACE"] == str(cyr))
    p88 = place87()
    (p88.parent / "Reha 0.8.0").mkdir()
    ready87(p88)
    taken88 = updater87(p88, check=False)
    taken88.after_start()
    taken88.restart()
    ok("an old copy's name already taken gets a number",
       Path(spawned87[-1][1]["REHA_OLD"]).name == "Reha 0.8.0 (2)")

    def swapped88(outcome="placed"):
        # What the script leaves: the old copy beside, the new one in place.
        where = place87()
        ready87(where)
        before = updater87(where, check=False)
        before.after_start()
        before.restart()
        old = Path(spawned87[-1][1]["REHA_OLD"])
        if outcome == "placed":
            where.rename(old)
            (staging87(where) / "Reha").rename(where)
        if outcome:
            (staging87(where) / "result").write_text(outcome + "\n", encoding="ascii")
        return where, old

    where88, old88 = swapped88()
    new88 = updater87(where88, current="0.9.0", check=False)
    after88 = new88.after_start()
    ok("the new copy reads that it was put in place",
       after88["updated"] is True and new88.status()["updated"] == "0.9.0")
    ok("and puts the old copy in the Trash", trashed87[-1] == old88)
    ok("and clears up after itself",
       not state87(where88).exists() and not staging87(where88).exists())
    ok("the Windows copy does not ask for the microphone", after88["microphone"] is False)

    trashed87.clear()
    again88 = new88.after_start()
    ok("asked again in the same run, it says the same and does nothing twice",
       again88 == after88 and trashed87 == [])

    where88, old88 = swapped88()
    refused88 = updater87(where88, current="0.9.0", check=False, trash_ok=False)
    refused88.after_start()
    ok("a Trash that refuses keeps the old copy for the next start",
       json.loads(state87(where88).read_text(encoding="utf-8")) == {"old": str(old88)}
       and refused88.status()["updated"] == "0.9.0")
    trashed87.clear()
    updater87(where88, current="0.9.0", check=False).after_start()
    ok("which tries again", trashed87 == [old88] and not state87(where88).exists())

    where88, _ = swapped88("not-moved")
    failed88 = updater87(where88, check=False)
    came88 = failed88.after_start()
    ok("a swap that failed says why, and keeps the ready copy",
       came88["failed"] is True
       and failed88.status()["install"] == {"state": "place_failed", "version": "0.9.0",
                                            "error": "A file in the app's folder was in use"}
       and (staging87(where88) / "Reha" / "Reha.exe").is_file()
       and not state87(where88).exists())
    ok("and Try again restarts again", failed88.restart() == {"ok": True})
    where88, _ = swapped88("not-closed")
    late88 = updater87(where88, check=False)
    late88.after_start()
    ok("one where the app did not close says that",
       late88.status()["install"]["error"] == "The app did not close in time")
    where88, _ = swapped88(None)
    silent88 = updater87(where88, check=False)
    came88 = silent88.after_start()
    ok("a swap that never said what happened is taken as failed, with words",
       came88["failed"] is True
       and silent88.status()["install"] == {"state": "place_failed", "version": "0.9.0",
                                            "error": "Putting it in place did not start"})

    import rehearsal_recorder.api as apimod88
    from rehearsal_recorder.audio.devices import saved_device as saved88
    _, a88 = fresh_api(Path(tempfile.mkdtemp()))
    p88 = place87()
    ready87(p88)
    a88._updates = updater87(p88, check=False)
    a88._updates.after_start()
    destroyed88 = []
    a88._window = types.SimpleNamespace(destroy=lambda: destroyed88.append(True))
    ok("the Api's Restart now says it started", a88.restart_to_update() == {"ok": True})
    deadline88 = time.monotonic() + 3
    while time.monotonic() < deadline88 and not destroyed88:
        time.sleep(0.05)
    ok("and closes the window once the script is started", destroyed88 == [True])
    ok("its Update is the checker's",
       a88.update_now() == {"ok": False, "error": "There is no newer version to download"})

    opened88 = []

    class Mic88:
        def __init__(self, device=None, channels=None, **kw):
            opened88.append(device)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    # An interface picked in Settings › Audio; off Windows a bare index counts.
    a88._config["device_index"] = 2
    # The copies here are Windows-shaped whatever this machine is, so the
    # system's answer to whether it asks again (platform_support, tested
    # there) stands in for a Mac's and for Windows'.
    stream_before = apimod88.sd.InputStream
    asks_before = U.asks_for_microphone_again
    apimod88.sd.InputStream = Mic88
    sys.frozen = True
    try:
        for system88 in ("darwin", "win32"):
            where88, _ = swapped88()
            a88._updates = updater87(where88, current="0.9.0", check=False)
            U.asks_for_microphone_again = lambda system, mac=system88 == "darwin": mac
            a88._updates.start = lambda: None
            started88 = a88.start_update_checks()
            deadline88 = time.monotonic() + 3
            while system88 == "darwin" and time.monotonic() < deadline88 and not opened88:
                time.sleep(0.05)
            if system88 == "darwin":
                ok("on a Mac the new copy opens the input for a moment",
                   started88 is True and opened88 == [saved88(a88._config, "device", True)])
            else:
                time.sleep(0.7)
                ok("and on Windows it does not", started88 is True and len(opened88) == 1)
    finally:
        del sys.frozen
        apimod88.sd.InputStream = stream_before
        U.asks_for_microphone_again = asks_before
    # The interface asks for the status as soon as it is drawn, which can be
    # before the window's loaded event has reached Python.
    where88, _ = swapped88()
    a88._updates = updater87(where88, current="0.9.0", check=False)
    sys.frozen = True
    try:
        first88 = a88.update_status()
    finally:
        del sys.frozen
    ok("the first status the interface asks for already says Updated to",
       first88["updated"] == "0.9.0")
    where88, _ = swapped88()
    a88._updates = updater87(where88, current="0.9.0", check=False)
    ok("run from source, the status reads nothing",
       a88.update_status()["updated"] is None and state87(where88).exists())
    ok("run from source, nothing of this happens",
       a88.start_update_checks() is False and state87(where88).exists())

    print("\n[89] Lineups")
    from rehearsal_recorder import layouts as L89
    from rehearsal_recorder.audio.devices import device_identity as identity89
    card89 = identity89(0)
    today89 = {"tracks": [{"name": "Guitar"}, {"name": "Bass"}],
               "layouts": [{"device": card89, "inputs": {"Guitar": 1, "Bass": 2}}]}
    once89 = L89.migrate(json.loads(json.dumps(today89)))
    ok("today's band becomes the first lineup, Band",
       once89["lineups"] == [{"name": "Band", "tracks": today89["tracks"],
                              "layouts": today89["layouts"]}]
       and once89["lineup"] == "Band")
    ok("and last time stays as it was",
       once89["tracks"] == today89["tracks"] and once89["layouts"] == today89["layouts"])
    twice89 = L89.migrate(json.loads(json.dumps(once89)))
    ok("migrating twice changes nothing", twice89 == once89)
    once89["lineups"][0]["tracks"].append({"name": "Keys"})
    ok("the lineup is a copy, not last time itself", len(once89["tracks"]) == 2)
    fresh89 = L89.migrate({})
    ok("a fresh install gets Band with no tracks",
       fresh89["lineups"] == [{"name": "Band", "tracks": [], "layouts": []}]
       and fresh89["lineup"] == "Band")
    ok("which is laid out as the first-run pair",
       [t["name"] for t in L89.laid_out(fresh89["lineups"], card89, 8)[0]["tracks"]]
       == ["Guitar 1", "Vocals"])
    ok("a lineups key that is not a list is none",
       L89.migrate({"lineups": "Trio"})["lineups"] == [])
    hand89 = L89.migrate({"lineups": [
        {"tracks": []}, {"name": "  ", "tracks": [], "layouts": []},
        {"name": "Trio", "tracks": "Bass", "layouts": []},
        {"name": "Duo", "tracks": [{"name": "Bass"}, "Keys", {"channel": 3}], "layouts": [7]},
        {"name": "duo", "tracks": [], "layouts": []},
    ], "lineup": "Gone"})
    ok("a hand-edited lineup with no name or no list of tracks is dropped, and a second of one name",
       [l["name"] for l in hand89["lineups"]] == ["Duo"])
    ok("a track with no name and a layout that is not a map are dropped",
       hand89["lineups"][0]["tracks"] == [{"name": "Bass"}]
       and hand89["lineups"][0]["layouts"] == [])
    ok("a picked lineup that is not there is none", hand89["lineup"] is None)
    ok("deleting every lineup is kept", L89.migrate({"lineups": []})["lineups"] == [])
    ok("a missing lineup key reads as none",
       L89.migrate({"lineups": [{"name": "Trio", "tracks": [], "layouts": []}]})["lineup"] is None)
    try:
        L89.lineup_name([{"name": "Trio"}], " trio ")
        ok("a name another lineup has is refused", False)
    except L89.LineupRefused as e:
        ok("a name another lineup has is refused", str(e) == "There is already a lineup called Trio")
    try:
        L89.lineup_name([], "   ")
        ok("an empty name is refused", False)
    except L89.LineupRefused as e:
        ok("an empty name is refused", str(e) == "A lineup needs a name")
    ok("a name is trimmed and cut at 40", L89.lineup_name([], "  " + "x" * 50) == "x" * 40)
    ok("a lineup may keep its own name in another case",
       L89.lineup_name([{"name": "Trio"}], "TRIO", renaming="Trio") == "TRIO")

    tmp89 = tmp / "s89"
    tmp89.mkdir()
    apimod89, a89 = fresh_api(tmp89)
    a89._config.update(L89.migrate(json.loads(json.dumps(today89))))
    a89._config["device_index"] = 0
    a89._config["device"] = card89
    first89 = a89.load_default_tracks()
    ok("the setup screen gets the lineups laid out on the card, and the picked one",
       first89["lineups"] == [{"name": "Band", "tracks": first89["tracks"]}]
       and first89["lineup"] == "Band"
       and [(t["name"], t["channel"]) for t in first89["tracks"]] == [("Guitar", 1), ("Bass", 2)])
    trio89 = [{"name": "Bass", "channel": 2}, {"name": "Guitar", "channel": 3, "icon": "guitar"},
              {"name": "Vocals", "channel": 4}]
    added89 = a89.add_lineup("Trio", 0, trio89)
    ok("Save as new adds a lineup and picks it",
       added89["ok"] is True and [l["name"] for l in added89["lineups"]] == ["Band", "Trio"]
       and added89["lineup"] == "Trio")
    ok("with the tracks on screen, laid out",
       [(t["name"], t["channel"], t.get("icon")) for t in added89["lineups"][1]["tracks"]]
       == [("Bass", 2, None), ("Guitar", 3, "guitar"), ("Vocals", 4, None)])
    ok("and they are last time too",
       [t["name"] for t in a89.load_default_tracks()["tracks"]] == ["Bass", "Guitar", "Vocals"]
       and a89._config["lineup"] == "Trio")
    ok("and it is written down",
       json.loads((tmp89 / "config.json").read_text(encoding="utf-8"))["lineup"] == "Trio")
    ok("a name another lineup has is refused, whatever its case",
       a89.add_lineup("trio", 0, trio89) == {"ok": False, "error": "There is already a lineup called Trio"})
    ok("and an empty one",
       a89.add_lineup("  ", 0, trio89) == {"ok": False, "error": "A lineup needs a name"})
    long89 = a89.add_lineup("y" * 50, 0, trio89)
    ok("a long name is kept cut at 40", long89["lineup"] == "y" * 40)
    a89.delete_lineup("y" * 40)

    other89 = {"name": "Other desk", "host_api": "CoreAudio"}
    a89._config["layouts"].append({"device": other89, "inputs": {"Vocals": 7}})
    a89.add_lineup("With keys", 0, trio89 + [{"name": "Keys", "channel": 5}])
    keys89 = next(l for l in a89._config["lineups"] if l["name"] == "With keys")
    on_other89 = L89.laid_out([keys89], other89, 8)[0]["tracks"]
    ok("a new lineup keeps last time's inputs on other cards",
       next(t for t in on_other89 if t["name"] == "Vocals")["channel"] == 7)
    a89.delete_lineup("With keys")

    no_drums89 = [{"name": "Guitar", "channel": 1}]
    updated89 = a89.update_lineup("Band", 0, no_drums89)
    ok("Update writes over the picked lineup",
       updated89["ok"] is True and updated89["lineup"] == "Band"
       and [t["name"] for t in updated89["lineups"][0]["tracks"]] == ["Guitar"])
    ok("and leaves the others as they were",
       [t["name"] for t in updated89["lineups"][1]["tracks"]] == ["Bass", "Guitar", "Vocals"])
    ok("and makes it last time",
       [t["name"] for t in a89.load_default_tracks()["tracks"]] == ["Guitar"])
    ok("a lineup nobody has is not updated",
       a89.update_lineup("Nobody", 0, no_drums89) == {"ok": False, "error": "No lineup is called Nobody"})
    nocard89 = a89.update_lineup("Band", None, [{"name": "Drums", "channel": 1}])
    ok("Update with no interface in hand still keeps the lineup", nocard89["ok"] is True)
    a89._config["device_index"] = None
    a89._config["device"] = None
    ok("and with no card it is laid out from it",
       [t["name"] for t in a89.load_default_tracks()["lineups"][0]["tracks"]] == ["Drums"])
    a89._config["device_index"] = 0
    a89._config["device"] = card89

    renamed89 = a89.rename_lineup("Trio", "trio")
    ok("a lineup can be renamed to its own name in another case",
       renamed89["ok"] is True and [l["name"] for l in renamed89["lineups"]] == ["Band", "trio"])
    ok("but not to another lineup's",
       a89.rename_lineup("trio", "band") == {"ok": False, "error": "There is already a lineup called Band"})
    ok("nor one nobody has",
       a89.rename_lineup("Nobody", "X") == {"ok": False, "error": "No lineup is called Nobody"})
    a89.update_lineup("trio", 0, trio89)
    ok("renaming the picked lineup renames the pick",
       a89.rename_lineup("trio", "Trio")["lineup"] == "Trio" and a89._config["lineup"] == "Trio")
    ok("renaming another leaves the pick",
       a89.rename_lineup("Band", "Full band")["lineup"] == "Trio")
    gone89 = a89.delete_lineup("Trio")
    ok("deleting the picked lineup picks none",
       gone89["ok"] is True and gone89["lineup"] is None
       and [l["name"] for l in gone89["lineups"]] == ["Full band"])
    ok("and leaves last time as it was",
       [t["name"] for t in a89.load_default_tracks()["tracks"]] == ["Bass", "Guitar", "Vocals"])
    ok("a lineup nobody has is not deleted",
       a89.delete_lineup("Nobody") == {"ok": False, "error": "No lineup is called Nobody"})
    last89 = a89.delete_lineup("Full band")
    ok("the last lineup can be deleted", last89["ok"] is True and last89["lineups"] == [])
    ok("and stays deleted when the settings are read again",
       a89._read_config()["lineups"] == [])

    a89.add_lineup("Full band", 0, [{"name": "Guitar", "channel": 1}, {"name": "Drums", "channel": 2}])
    a89.add_lineup("Trio", 0, trio89)
    before89 = json.loads(json.dumps(a89._config["lineups"]))
    started89 = a89.start_rehearsal("Lineup", 0, SR, [{"name": "Guitar", "channel": 1}], lineup="Full band")
    ok("Start writes into no lineup",
       started89["ok"] is True and a89._config["lineups"] == before89)
    ok("and keeps the tracks and the pick as last time",
       [t["name"] for t in a89._config["tracks"]] == ["Guitar"] and a89._config["lineup"] == "Full band")
    a89.finish_rehearsal()
    a89.start_rehearsal("Nobody's", 0, SR, [{"name": "Guitar", "channel": 1}], lineup="Nobody")
    ok("a pick nobody has is kept as none", a89._config["lineup"] is None)
    a89.finish_rehearsal()
    from_pads89 = a89._transport.execute("start_rehearsal", {
        "name": "Pads", "device_index": 0, "samplerate": SR,
        "tracks": [{"name": "Bass", "channel": 2}], "lineup": "Trio"}, wait=True)
    ok("the controller's Start with a setup takes the lineup",
       from_pads89["ok"] is True and a89._config["lineup"] == "Trio")
    a89.finish_rehearsal()
    a89._config["samplerate"] = SR
    from_last89 = a89._transport.execute("start_rehearsal", {}, wait=True)
    ok("and without a setup keeps last time's",
       from_last89["ok"] is True and a89._config["lineup"] == "Trio")
    a89.finish_rehearsal()

    # Start is what the screen opens with next time, after the app is closed.
    a89.start_rehearsal("Written", 0, SR, [{"name": "Guitar", "channel": 1}], lineup="Full band")
    disk89 = json.loads((tmp89 / "config.json").read_text(encoding="utf-8"))
    ok("Start writes last time and the pick down",
       disk89["lineup"] == "Full band" and [t["name"] for t in disk89["tracks"]] == ["Guitar"])
    a89.finish_rehearsal()
    odd89 = a89.start_rehearsal("Odd", 0, SR, [{"name": "Guitar", "channel": 1}], lineup=["Trio"])
    ok("a pick that is not a name is kept as none",
       odd89["ok"] is True and a89._config["lineup"] is None)
    a89.finish_rehearsal()

    # A hand edit that is not a name, or a layout that is not one, costs that
    # much and no more: the rest of the settings stay.
    kept89 = L89.migrate({"recordings_dir": "/Music/Takes", "lineup": ["Trio"],
                          "lineups": [{"name": "Trio", "tracks": [], "layouts": []}]})
    ok("a picked lineup that is not a name is none, and nothing else goes",
       kept89["lineup"] is None and kept89["recordings_dir"] == "/Music/Takes"
       and [l["name"] for l in kept89["lineups"]] == ["Trio"])
    odd_maps89 = L89.migrate({"lineups": [{"name": "Trio", "tracks": [{"name": "Bass"}], "layouts": [
        {"device": card89, "inputs": [1, 2]},
        {"device": "Desk", "inputs": {"Bass": 1}},
        {"device": card89, "inputs": {"Bass": "2", "Keys": 3, "Vox": True}},
    ]}]})
    ok("a layout whose inputs or card is not a map is dropped, and an input that is not a number",
       odd_maps89["lineups"][0]["layouts"] == [{"device": card89, "inputs": {"Keys": 3}}])
    ok("so it can be laid out",
       L89.laid_out(odd_maps89["lineups"], card89, 8)[0]["tracks"][0]["channel"] == 1)

    # The lineups come back laid out on the card the screen uses, which on a
    # first run is not yet the saved one.
    a89._config["device_index"] = None
    a89._config["device"] = None
    on_screen89 = a89.update_lineup("Trio", 0, trio89)
    ok("Update answers the lineups laid out on the card it was given",
       [t["channel"] for t in on_screen89["lineups"][1]["tracks"]] == [2, 3, 4])
    ok("and so does Rename",
       [t["channel"] for t in a89.rename_lineup("Trio", "Trio", 0)["lineups"][1]["tracks"]] == [2, 3, 4])
    a89.add_lineup("Duo", 0, trio89[:2])
    ok("and Delete",
       [t["channel"] for t in a89.delete_lineup("Duo", 0)["lineups"][1]["tracks"]] == [2, 3, 4])

    # A lineup bigger than the card: last time and the lineup are laid out
    # alike, so the screen does not open "changed".
    tmp89b = tmp / "s89b"
    tmp89b.mkdir()
    _, b89 = fresh_api(tmp89b)
    small89 = identity89(1)
    b89._config.update(L89.migrate({
        "tracks": [{"name": "Guitar"}, {"name": "Bass"}, {"name": "Keys"}],
        "layouts": [{"device": small89, "inputs": {"Guitar": 1, "Bass": 2, "Keys": 3}}]}))
    b89._config["device_index"] = 1
    b89._config["device"] = small89
    small_open89 = b89.load_default_tracks()
    ok("on a card with fewer inputs, last time is the lineup laid out",
       small_open89["tracks"] == small_open89["lineups"][0]["tracks"]
       and [t["channel"] for t in small_open89["tracks"]] == [1, None, None])

    print("\n[90] Icons from the take")
    # A take keeps each track's icon (lineups spec, Part 3): the player's lanes, the drum
    # grid, the counted tempo and the drift line read it from the take, never from the band,
    # so switching lineups or changing an icon redraws no old take.
    from rehearsal_recorder.midi.smf import write_mid as write_mid90
    tmp90 = tmp / "s90"
    tmp90.mkdir()
    apimod90, a90 = fresh_api(tmp90)
    a90.start_rehearsal("Icons", 0, SR, [{"name": "Drums", "channel": 1, "icon": "drums"},
                                         {"name": "Bass", "channel": 2}])
    folder90 = Path(a90._session["folder"])
    d90 = folder90 / "_drafts" / "take 1"
    write_wav(d90 / "Drums.wav", 100, seconds=1.0)
    write_wav(d90 / "Bass.wav", 100, seconds=1.0)
    a90._session["take_counter"] = 1
    a90.save_default_tracks({"device_index": 0, "tracks": [
        {"name": "Drums", "channel": 1, "icon": "percussion"}, {"name": "Bass", "channel": 2, "icon": "bass"}]})
    kept90 = a90.keep_take(1, str(d90), "", 1.0, [{"name": "Drums", "file": str(d90 / "Drums.wav")},
                                                  {"name": "Bass", "file": str(d90 / "Bass.wav")}])["take"]
    ok("a take keeps the icons its rehearsal started with, whatever the band says by Keep",
       [t.get("icon") for t in kept90["tracks"]] == ["drums", None])
    ok("and the library has them too",
       [t.get("icon") for t in a90._lib.take(folder90, 1)["tracks"]] == ["drums", None])
    drums90, bass90 = kept90["tracks"][0]["file"], kept90["tracks"][1]["file"]
    media90 = a90.take_media([{"name": "Drums", "file": drums90, "icon": "drums"},
                              {"name": "Bass", "file": bass90}])
    ok("the player gets the take's icon, not the band's", media90[0].get("icon") == "drums")
    ok("and none for a track the take keeps none for, whatever the band gives that name",
       "icon" not in media90[1])

    kit90 = folder90 / "Kit.mid"
    write_mid90(kit90, track_name="Kit", port_name="Port", start=[],
                events=[(0.0, bytes((0x90, 36, 100))), (0.1, bytes((0x80, 36, 0)))])
    a90._config["tracks"] = [{"name": "Kit", "icon": "drums"}]
    ok("a .mid the take gave the drums icon is a drum grid, and says so",
       a90.take_notes([{"name": "Kit", "file": str(kit90), "icon": "drums"}])[0]["drums"] is True
       and a90.take_notes([{"name": "Kit", "file": str(kit90), "icon": "drums"}])[0].get("icon") == "drums")
    ok("and the same file without it is not, whatever the band says",
       a90.take_notes([{"name": "Kit", "file": str(kit90)}])[0]["drums"] is False)

    a90._config["tracks"] = [{"name": "Drums"}, {"name": "Bass"}]
    asked90 = []
    count90 = apimod90.tempomod.count
    apimod90.tempomod.count = lambda **kw: asked90.append(kw) or 120
    try:
        a90.count_tempo(str(folder90), 1, "4/4")
    finally:
        apimod90.tempomod.count = count90
    ok("a tempo is counted from the drums the take gave the icon, though the band gives none",
       asked90 and asked90[0]["drums_wav"] == drums90)
    minus90 = str(folder90 / "Minus.wav")
    write_wav(Path(minus90), 100, seconds=1.0)
    heard90 = []
    drift90 = apimod90.driftmod.count_apart
    apimod90.driftmod.count_apart = lambda **kw: heard90.append(kw) or {"ok": False, "why": "no-beat"}
    try:
        a90.take_drift([{"name": "Drums", "file": drums90, "icon": "drums"}, {"name": "Bass", "file": bass90},
                        {"name": "Minus", "file": minus90, "icon": "backing"}], [], {})
    finally:
        apimod90.driftmod.count_apart = drift90
    ok("the drift line listens to the take's drums, and leaves out a track it gave the backing icon",
       heard90 and heard90[0]["drums"] == [drums90] and minus90 not in heard90[0]["mix"])

    print("  a take under review")
    a90.start_take()
    a90._recorder._callback(np.full((SR, 2), 900, dtype=np.int16), SR, None, None)
    record90 = json.loads((Path(a90._recorder.out_dir) / "take.json").read_text(encoding="utf-8"))
    ok("take.json says each track's icon, and none for a track with none",
       [(t["name"], t["icon"]) for t in record90["tracks"] if "icon" in t]
       == [("Drums", "drums"), ("Bass", None)])
    stopped90 = a90.stop_take()
    ok("the review screen gets each track with the icon its rehearsal started with",
       {t["name"]: t.get("icon") for t in stopped90["tracks"]} == {"Drums": "drums", "Bass": None})
    a90.discard_take(stopped90["temp_dir"])

    print("  a draft rescued after a crash")
    a90._config["tracks"] = [{"name": "Drums", "icon": "percussion"}, {"name": "Bass", "icon": "bass"}]

    def draft90(number, icons):
        d = folder90 / "_drafts" / f"take {number}"
        d.mkdir(parents=True)
        for name in ("Drums", "Bass"):
            (d / f"{name}.raw").write_bytes(struct.pack("<h", 700) * 4800)
        (d / "take.json").write_text(json.dumps({"samplerate": SR, "bit_depth": 16, "notes": [], "tracks": [
            {"file": name, "name": name, "channels": 1, **({"icon": icons[name]} if name in icons else {})}
            for name in ("Drums", "Bass")]}), encoding="utf-8")
        return a90.recover_draft(str(d))["take"]

    ok("keeps the icons its take.json recorded, and none for a track recorded with none",
       {t["name"]: t.get("icon") for t in draft90(7, {"Drums": "drums", "Bass": None})["tracks"]}
       == {"Drums": "drums", "Bass": None})
    ok("one recorded before take.json kept icons gets last time's band icons by name",
       {t["name"]: t.get("icon") for t in draft90(8, {})["tracks"]}
       == {"Drums": "percussion", "Bass": "bass"})
    a90.finish_rehearsal()

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
