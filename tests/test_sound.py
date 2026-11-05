"""
The sound process (audio/sound): a real second process, spawned as the app
spawns it, with the fake card of tests/fake_rtmixer.py running by itself in
it. What is checked: a stand-in's calls and answers, the same stand-in for
the same object, a recorder's levels and its clock's marks reaching the
main process, its log lines too, a rescan there reaching the device list
here, and what happens when either process dies.

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
        # "State:\tZ (zombie)": a process that has ended, not yet reaped.
        return state.split()[1:2] != ["Z"]
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
    asked = time.monotonic()
    marked = until(clock.marked, 8)
    took = time.monotonic() - asked + 0.5
    detail = f"in {took:.1f} s of the take"
    if not marked:
        # What the recorder there has of its marks, for a run that fails.
        try:
            m = rec._marks
            detail += (f"; there: {len(m._reads)} reads since a mark, from frame "
                       f"{m._reads[0][1] if m._reads else None} to {m._reads[-1][1] if m._reads else None}, "
                       f"span {m._span}, said {m._said}; fault {rec.clock_fault}; "
                       f"frames {rec._frames_written}")
        except Exception as e:  # noqa: BLE001
            detail += f"; could not ask there: {e!r}"
        said = [r.getMessage() for r in heard.records if "clock" in r.getMessage()]
        detail += f"; log: {said}"
    ok(f"the take's clock here is marked from there ({detail})", marked and clock.ns_at(SR) is not None)
    ok("  with the stream's latency and the take's start", clock.started_ns is not None)
    done = rec.stop()
    ok("Stop answers with the take's record", isinstance(done, dict))
    said = until(lambda: any(r.getMessage().startswith("take: ") and r.processName == "sound"
                             for r in heard.records), 3)
    ok("the take's log line, said there, is written here", said)
    logging.getLogger("rehearsal_recorder").removeHandler(heard)


def rescan_reaches_view(link, folder):
    print("\n[2b] A card plugged in: Look again there, and its new list here")
    from rehearsal_recorder.audio import devices
    from rehearsal_recorder.audio.devices import sd

    before = [d["name"] for d in sd.query_devices()]
    (folder / "plugged").write_text("yes")
    trouble = devices.rescan()
    after = [d["name"] for d in sd.query_devices()]
    ok("before, the one card there was", before == ["Fake card"])
    ok("the rescan there went well", trouble is None)
    ok("  and the list here has the card plugged in since", after == ["Fake card", "Plugged card"])
    ok("  one device of it asked here is the new one", sd.query_devices(1)["name"] == "Plugged card")


def mapped_files_by_reference(link, folder):
    print("\n[2c] A file mapped in memory goes over as where it is, not all it holds")
    import io
    import types

    from rehearsal_recorder.audio import backing_file
    from rehearsal_recorder.audio.backing_source import BackingSource
    from rehearsal_recorder.audio.sound import host as hostmod
    from rehearsal_recorder.audio.sound import link as linkmod

    ready = backing_file.make_ready(tone_wav(folder / "Backing copy.wav", 60.0), SR)
    opened = backing_file.open_ready(ready)
    sent = io.BytesIO()
    linkmod._Pickler(sent, link).dump(opened)
    ok("main to sound: a minute of a ready file goes as a few bytes, not 11 MB", len(sent.getvalue()) < 10_000)
    back = io.BytesIO()
    hostmod._Pickler(back, types.SimpleNamespace(made_types=set())).dump(opened)
    ok("  and sound to main the same", len(back.getvalue()) < 10_000)
    source = sound.new(BackingSource, opened, (0, 1), 0.8)
    ok("a backing source made there from it has the file", source.channels == 1 and source.file_rate == SR)
    data = source._data
    ok("  and its file read here is the file mapped here again",
       isinstance(data, np.memmap) and data.filename == opened[0].filename
       and data.shape == opened[0].shape and float(data[SR // 3, 0]) == float(opened[0][SR // 3, 0]))
    part = opened[0][:10]
    alone = io.BytesIO()
    linkmod._Pickler(alone, link).dump(part)
    ok("a piece of a mapped file goes by value, as it holds no file of its own",
       np.array_equal(pickle_load(alone.getvalue(), link), part))


def events_never_wait_for_the_pipe():
    print("\n[2d] What the sound process says never waits for the pipe")
    from rehearsal_recorder.audio.sound import host as hostmod

    held = threading.Event()
    went = []

    class _Stuck:
        def send_bytes(self, data):
            held.wait(5)
            went.append(data)

    there = hostmod.Host(_Stuck())
    started = time.monotonic()
    for i in range(3):
        there.event("log", {"line": i})
    took = time.monotonic() - started
    held.set()
    ok("three lines with the main process not reading return at once", took < 0.1)
    ok("  and go, in order, once it reads again",
       until(lambda: len(went) == 3, 2) and [pickle_load_plain(d)[2]["line"] for d in went] == [0, 1, 2])


def pickle_load_plain(data):
    import pickle

    return pickle.loads(data)


def pickle_load(data, link):
    import io

    from rehearsal_recorder.audio.sound import link as linkmod

    return linkmod._Unpickler(io.BytesIO(data), link, link.gen).load()


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
rec = sound.new("AudioRecorder", 0, 48000, [{{"name": "Gtr", "channel": 1, "stereo": False}}], {out!r}, 16)
rec.start()
time.sleep(1.0)
print(link.pid(), flush=True)
time.sleep(60)
"""


def never_started_says_so_at_once(folder):
    print("\n[3b] A sound process that dies before it is ready: left down, said at once")
    from rehearsal_recorder.audio.devices import sd
    from rehearsal_recorder.audio.sound.link import DOWN

    told = []
    link = sound.start(prepare="fake_rtmixer:die_at_once")
    link.on_event(lambda name, payload: told.append(name))
    ok("it dies twice and is left down", until(lambda: not link.alive, 15))
    started = time.monotonic()
    waited = link.wait_started(30)
    ok("  waiting for it to start ends at once, saying it did not", waited is False
       and time.monotonic() - started < 1)
    started = time.monotonic()
    try:
        sd.query_devices()
        said = None
    except SoundUnavailable as e:
        said = str(e)
    ok("  the device list says sound is unavailable, at once",
       said == DOWN and time.monotonic() - started < 1)
    sound.stop()


def parent_dies_host_exits(folder):
    print("\n[4] The main process killed mid-take: the sound process ends too, the take's files kept")
    out = folder / "take 3"
    out.mkdir()
    code = HELPER.format(src=str(PROJECT / "src"), tests=str(PROJECT / "tests"), prepare=PREPARE, out=str(out))
    parent = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, text=True)
    line = parent.stdout.readline().strip()
    pid = int(line) if line.isdigit() else None
    ok("a main process of its own starts one", pid is not None and running(pid))
    parent.kill()
    parent.wait(5)
    ok("it is gone within 2 s of the main process", pid is not None and until(lambda: not running(pid), 2))
    raws = list(out.glob("*.raw"))
    ok("  and the take's raw file is on disk with the second recorded",
       len(raws) == 1 and raws[0].stat().st_size > SR)


def main():
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        # The fake card there lists a second card once this file is there
        # and PortAudio starts again (fake_rtmixer.fake_sounddevice).
        os.environ["FAKE_CARD_PLUGGED"] = str(folder / "plugged")
        link = sound.start(prepare=PREPARE)
        try:
            call_and_answer(link, folder)
            levels_marks_and_log(link, folder)
            rescan_reaches_view(link, folder)
            mapped_files_by_reference(link, folder)
            events_never_wait_for_the_pipe()
            host_dies_take_kept(link, folder)
        finally:
            sound.stop()
        never_started_says_so_at_once(folder)
        parent_dies_host_exits(folder)
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
