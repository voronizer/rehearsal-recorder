"""
The three operating systems, checked without three machines.

Only one of them is here, so the parts that differ are exercised by driving
platform_support.py into each shape deliberately: no send2trash, no system
trash folder, Windows-style naming rules. That does not prove the app runs on
Windows — nothing short of Windows proves that — but it does prove the code
takes the right branch instead of reaching for something that is not there.
"""

import shutil
import sys
import tempfile
import types
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))

_sd = types.ModuleType("sounddevice")
_sd.query_devices = lambda *a, **k: []
_sd.query_hostapis = lambda: []
_sd.OutputStream = _sd.InputStream = None
sys.modules["sounddevice"] = _sd

import rehearsal_recorder.platform_support as ps  # noqa: E402

problems = []


def ok(label, cond):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def main():
    print("\n[1] Deleting never destroys, on any system")
    tmp = Path(tempfile.mkdtemp())
    recordings = tmp / "Rec"
    (recordings / "Jam").mkdir(parents=True)
    (recordings / "Jam" / "take.wav").write_bytes(b"audio")

    # Windows without send2trash: no system trash is reachable at all.
    original_send, original_dir = ps._send2trash, ps._system_trash_dir
    ps._send2trash = lambda: None
    ps._system_trash_dir = lambda: None
    try:
        ok("with no recycle bin it reports the fallback",
           ps.trash_kind() == "folder")
        res = ps.move_to_trash(recordings / "Jam", recordings)
        ok("the folder is gone from where it was",
           res["ok"] and not (recordings / "Jam").exists())
        ok("but it is not destroyed",
           (recordings / ps.FALLBACK_TRASH / "Jam" / "take.wav").exists())
        ok("and it does not claim to be in the Trash", res["trashed"] is False)
        ok("it says where it went", ps.FALLBACK_TRASH in (res["location"] or ""))

        # A second delete of the same name must not overwrite the first.
        (recordings / "Jam").mkdir()
        (recordings / "Jam" / "other.wav").write_bytes(b"more")
        ps.move_to_trash(recordings / "Jam", recordings)
        kept = sorted(p.name for p in (recordings / ps.FALLBACK_TRASH).iterdir())
        ok("a second delete sits beside the first, not on top",
           kept == ["Jam", "Jam (2)"])
    finally:
        ps._send2trash, ps._system_trash_dir = original_send, original_dir

    print("\n[2] A real trash folder is used when there is one")
    fake_trash = tmp / "FakeTrash"
    fake_trash.mkdir()
    ps._send2trash = lambda: None
    ps._system_trash_dir = lambda: fake_trash
    try:
        ok("it reports the system bin", ps.trash_kind() == "system")
        doomed = recordings / "Later"
        doomed.mkdir()
        res = ps.move_to_trash(doomed, recordings)
        ok("and moves there", (fake_trash / "Later").exists())
        ok("saying so honestly", res["trashed"] is True)
    finally:
        ps._send2trash, ps._system_trash_dir = original_send, original_dir

    print("\n[3] send2trash is preferred when installed")
    called = []
    ps._send2trash = lambda: called.append(True) or (lambda p: Path(p).unlink())
    try:
        victim = recordings / "one.wav"
        victim.write_bytes(b"x")
        res = ps.move_to_trash(victim, recordings)
        ok("it was used", bool(called))
        ok("and the result says the real Trash", res["trashed"] is True)
    finally:
        ps._send2trash = original_send

    print("\n[4] Names Windows would refuse")
    ok("a reserved device name is escaped", ps.safe_filename("CON") == "CON_")
    ok("case does not get round it", ps.safe_filename("aux") == "aux_")
    ok("but a longer name is fine", ps.safe_filename("Console") == "Console")
    ok("forbidden characters go, without a pile of underscores",
       ps.safe_filename('So:ng<1>|"take"') == "So_ng_1_take")
    ok("a trailing dot is dropped", ps.safe_filename("Intro...") == "Intro")
    ok("a trailing space too", ps.safe_filename("Verse  ") == "Verse")
    ok("a slash cannot make a subfolder", "/" not in ps.safe_filename("AC/DC"))
    ok("a name of nothing but punctuation falls back",
       ps.safe_filename("///") == "untitled")
    ok("rather than becoming a folder called ___",
       "_" not in ps.safe_filename("///"))
    ok("ordinary names are left alone",
       ps.safe_filename("Polyn 2 (best)") == "Polyn 2 (best)")

    print("\n[5] The path-length warning is Windows-only")
    was_windows = ps.WINDOWS
    try:
        ps.WINDOWS = False
        ok("nothing is said on macOS or Linux",
           ps.describe_path_limit("/" + "a" * 250) is None)
        ps.WINDOWS = True
        ok("a long path is called out on Windows",
           "260" in (ps.describe_path_limit("C:/" + "a" * 250) or ""))
        ok("a short one is not",
           ps.describe_path_limit("C:/Music") is None)
    finally:
        ps.WINDOWS = was_windows

    print("\n[6] The app tells the interface what deleting will do")
    import rehearsal_recorder.api as apimod

    apimod.RECORDINGS_ROOT = tmp / "Rec2"
    apimod.CONFIG_PATH = tmp / "config.json"
    a = apimod.Api.__new__(apimod.Api)
    apimod.Api.__init__(a)
    settings = a.get_settings()
    ok("it says which kind of trash this machine has",
       settings["trash_kind"] in ("system", "folder"))
    ok("and what the fallback folder is called",
       settings["fallback_trash"] == ps.FALLBACK_TRASH)
    ok("and whether anything can compress a cloud copy",
       "encoder" in settings and "encoder_hint" in settings)
    ok("the hint is there exactly when the encoder is not",
       bool(settings["encoder_hint"]) != bool(settings["encoder"]))

    print("\n[7] Compressing no longer depends on the system")
    from rehearsal_recorder.audio import encode

    # This used to be three different sentences, because it was three
    # different external programs. Now it is one pip package everywhere, and
    # the wording does not need to know what it is running on.
    was = sys.platform
    hints = set()
    for platform in ("win32", "darwin", "linux"):
        sys.platform = platform
        hints.add(encode.missing_encoder_hint())
    sys.platform = was
    ok("the same answer on every system", len(hints) == 1)
    ok("and it names what to install", "soundfile" in hints.pop())
    ok("the formats no longer depend on an external tool",
       [f["id"] for f in encode.CLOUD_FORMATS_INFO] == ["wav", "flac", "mp3"])

    print("\n[8] ASIO is switched on where it exists")
    from rehearsal_recorder import enable_asio

    env = {}
    enable_asio("win32", env)
    ok("on Windows the ASIO build of PortAudio is asked for",
       env.get("SD_ENABLE_ASIO") == "1")

    env = {}
    enable_asio("darwin", env)
    ok("elsewhere nothing is set — there is no ASIO there",
       "SD_ENABLE_ASIO" not in env)

    env = {"SD_ENABLE_ASIO": "0"}
    enable_asio("win32", env)
    ok("a value someone set by hand is left alone",
       env["SD_ENABLE_ASIO"] == "0")

    print("\n[9] A failed call from the interface is written down")
    # pywebview logs the traceback of any exception an interface call raises,
    # to stderr — which a windowed build does not have. Save take and rename
    # both failed that way on Windows with nothing kept anywhere.
    import faulthandler
    import logging

    import rehearsal_recorder.app as appmod

    original_log = appmod.CRASH_LOG
    appmod.CRASH_LOG = tmp / "crash.log"
    handlers_before = list(logging.getLogger("pywebview").handlers)
    try:
        kept_open = appmod._arm_crash_log()
        logging.getLogger("pywebview").error(
            "Traceback (most recent call last):\nUnicodeEncodeError: 'charmap'")
        text = appmod.CRASH_LOG.read_text(encoding="utf-8")
        ok("the traceback lands in crash.log", "UnicodeEncodeError" in text)
        appmod._arm_crash_log()
        logging.getLogger("pywebview").error("once")
        ok("arming twice does not write everything twice",
           appmod.CRASH_LOG.read_text(encoding="utf-8").count("once") == 1)
    finally:
        faulthandler.disable()
        logger = logging.getLogger("pywebview")
        for h in list(logger.handlers):
            if h not in handlers_before:
                logger.removeHandler(h)
                h.close()
        if kept_open:
            kept_open.close()
        appmod.CRASH_LOG = original_log

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for x in problems:
            print(" -", x)
        return 1
    print("Platform differences: every branch behaves.")
    shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
