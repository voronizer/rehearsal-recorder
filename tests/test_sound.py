"""
The sound process (audio/sound): a real second process, spawned as the app
spawns it, with the fake card of tests/fake_rtmixer.py running by itself in
it. What is checked: a stand-in's calls and answers, the same stand-in for
the same object, a recorder's levels and its clock's marks reaching the
main process, its log lines too, and what happens when either process dies.

Run: python tests/test_sound.py
"""

import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
import wave
from pathlib import Path

import numpy as np

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT / "src"))
sys.path.insert(0, str(PROJECT / "tests"))

from rehearsal_recorder.audio import sound  # noqa: E402
from rehearsal_recorder.audio.click import Voices  # noqa: E402
from rehearsal_recorder.audio.sound import SoundUnavailable  # noqa: E402
from rehearsal_recorder.midi.clock import AudioClock  # noqa: E402

PREPARE = "fake_rtmixer:install_host"
SR = 48000
problems = []


def ok(label, cond):
    # Labels in cp1252 only: CI prints them on Windows.
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def tone_wav(path, seconds=3.0):
    t = np.arange(int(seconds * SR)) / SR
    data = (0.3 * np.sin(2 * np.pi * 220 * t) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    return str(path)


def until(test, timeout):
    give_up = time.monotonic() + timeout
    while time.monotonic() < give_up:
        if test():
            return True
        time.sleep(0.02)
    return test()


def running(pid):
    """Whether process `pid` still runs (a zombie does not)."""
    if sys.platform == "win32":
        import ctypes

        kernel = ctypes.windll.kernel32
        handle = kernel.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        kernel.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel.CloseHandle(handle)
        return code.value == 259  # STILL_ACTIVE
    status = Path(f"/proc/{pid}/status")
    if status.exists():
        try:
            state = next(line for line in status.read_text().splitlines() if line.startswith("State:"))
        except (OSError, StopIteration):
            return False
        return " Z " not in state + " "
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # macOS: a zombie answers kill(0) too; ps says Z.
    out = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout
    return bool(out.strip()) and not out.strip().startswith("Z")


class Heard(logging.Handler):
    def __init__(self):
        super().__init__(logging.DEBUG)
        self.records = []

    def emit(self, record):
        self.records.append(record)


def call_and_answer(link, folder):
    print("\n[1] A stand-in's calls go to the sound process and come back")
    started = link.wait_started(30)
    ok("the sound process starts, with the fake card", started and link.pid() not in (None, os.getpid()))
    ok("  and the main process has its device list", (link.devices or {}).get("devices", [{}])[0].get("name") == "Fake card")
    from rehearsal_recorder.audio.devices import sd

    ok("  read through devices.sd there, with no PortAudio here",
       sd.query_devices(0)["name"] == "Fake card" and "sounddevice" not in sys.modules)
    tracks = [{"name": "Gtr", "file": tone_wav(folder / "Gtr.wav")}]
    player = sound.new("TakePlayer", tracks)
    ok("a player made there answers with a stand-in of its kind", player.kind == "TakePlayer")
    player.open_output(0)
    player.play()
    moved = until(lambda: player.state()["position"] > 0.2, 3)
    state = player.state()
    ok("it plays: state() says so and its playhead moves", moved and state["playing"] is True)
    ok("  an attribute is read there", player.total_frames == 3 * SR)
    try:
        player.set_loop("soon", "later")
        raised = None
    except Exception as e:  # noqa: BLE001
        raised = e
    ok("a call that raises there raises the same here", isinstance(raised, TypeError))
    try:
        player.no_such_thing
        missing = False
    except AttributeError:
        missing = True
    ok("  and an attribute it has not is an AttributeError", missing)
    click = sound.new("ClickSource", 120, "4/4", Voices("click", SR, 0.7), (0, 1))
    player.play_free_click(click)
    ok("a stand-in sent there arrives as its object, and comes back as the same stand-in",
       player.free_click is click)
    player.close()


def levels_marks_and_log(link, folder):
    print("\n[2] A recorder there: its levels, its clock's marks and its log reach here")
    heard = Heard()
    logging.getLogger("rehearsal_recorder").addHandler(heard)
    logging.getLogger("rehearsal_recorder").setLevel(logging.INFO)
    clock = AudioClock(SR)
    out = folder / "take 1"
    out.mkdir()
    rec = sound.new("AudioRecorder", 0, SR, [{"name": "Gtr", "channel": 1, "stereo": False}], str(out), 16,
                    clock=clock)
    rec.start()
    time.sleep(0.5)
    levels = rec.get_levels()
    ok("the level since the last ask: the card's tone, a quarter of full scale",
       abs(levels.get("Gtr", [0])[0] - 0.25) < 0.03)
    marked = until(clock.marked, 3)
    ok("the take's clock here is marked from there", marked and clock.ns_at(SR) is not None)
    ok("  with the stream's latency and the take's start", clock.started_ns is not None)
    done = rec.stop()
    ok("Stop answers with the take's record", isinstance(done, dict))
    said = until(lambda: any(r.getMessage().startswith("take: ") and r.processName == "sound"
                             for r in heard.records), 3)
    ok("the take's log line, said there, is written here", said)
    logging.getLogger("rehearsal_recorder").removeHandler(heard)


def host_dies_take_kept(link, folder):
    print("\n[3] The sound process killed mid-take: the take's files stay, it starts again once")
    told = []
    link.on_event(lambda name, payload: told.append(name))
    out = folder / "take 2"
    out.mkdir()
    rec = sound.new("AudioRecorder", 0, SR, [{"name": "Gtr", "channel": 1, "stereo": False}], str(out), 16)
    rec.start()
    time.sleep(1.2)
    old = link.pid()
    link._process.kill()
    ok("the main process hears it stopped", until(lambda: "sound_stopped" in told, 5))
    raws = list(out.glob("*.raw"))
    ok("the take's raw file is on disk, with what was recorded",
       len(raws) == 1 and raws[0].stat().st_size > SR // 2)
    try:
        rec.is_active()
        refused = False
    except SoundUnavailable:
        refused = True
    ok("  the old recorder's stand-in says sound is unavailable", refused)
    ok("it is started again", until(lambda: told.count("sound_started") >= 1 and link.pid() != old, 30))
    player = sound.new("TakePlayer", [{"name": "Gtr", "file": str(folder / "Gtr.wav")}])
    ok("  and plays again", player.state()["position"] == 0.0)
    player.close()
    link._process.kill()
    ok("killed again within a minute: left down", until(lambda: "sound_down" in told, 5) and not link.alive)
    try:
        sound.new("TakePlayer", [{"name": "Gtr", "file": str(folder / "Gtr.wav")}])
        down = False
    except SoundUnavailable:
        down = True
    ok("  and asked anything, it says sound is unavailable", down)


HELPER = """
import sys, time
sys.path[:0] = [{src!r}, {tests!r}]
from rehearsal_recorder.audio import sound
link = sound.start(prepare={prepare!r})
link.wait_started(30)
print(link.pid(), flush=True)
time.sleep(60)
"""


def parent_dies_host_exits():
    print("\n[4] The main process killed: the sound process ends too")
    code = HELPER.format(src=str(PROJECT / "src"), tests=str(PROJECT / "tests"), prepare=PREPARE)
    parent = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
    line = parent.stdout.readline().strip()
    pid = int(line) if line.isdigit() else None
    ok("a main process of its own starts one", pid is not None and running(pid))
    parent.kill()
    parent.wait(5)
    ok("it is gone within 2 s of the main process", pid is not None and until(lambda: not running(pid), 2))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        link = sound.start(prepare=PREPARE)
        try:
            call_and_answer(link, folder)
            levels_marks_and_log(link, folder)
            host_dies_take_kept(link, folder)
        finally:
            sound.stop()
        parent_dies_host_exits()
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print("  - " + p)
        return 1
    print("\nAll sound process checks passed.")
    return 0


if __name__ == "__main__":
    threading.current_thread().name = "test_sound"
    sys.exit(main())
