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

    print("\n[10] The thread that opens cards joins a COM apartment on Windows")
    # An ASIO driver is a COM object: a thread that has not joined an
    # apartment cannot load one, and PortAudio says only "Failed to load
    # ASIO driver".
    joins = []

    class Ole32:
        def __init__(self, answer):
            self.answer = answer

        def CoInitializeEx(self, reserved, mode):
            joins.append((reserved, mode))
            return self.answer

    ok("on Windows it joins a single-threaded apartment",
       ps.enter_com_apartment("win32", Ole32(0)) is None
       and joins == [(None, 2)])

    joins.clear()
    ok("elsewhere there is nothing to join",
       ps.enter_com_apartment("darwin", Ole32(0)) is None and joins == [])

    ok("a thread that had already joined is fine as it is",
       ps.enter_com_apartment("win32", Ole32(1)) is None)  # S_FALSE

    refused = ps.enter_com_apartment("win32", Ole32(-2147417850))
    ok("a refusal is said, with its code, rather than raised",
       isinstance(refused, str) and "0x80010106" in refused)

    ok("and so is a Windows where COM cannot be reached at all",
       isinstance(ps.enter_com_apartment("win32", object()), str))

    print("\n[reveal] Show picks a file out in its folder")
    # Under the hood's Show buttons: the folder opens with the file already
    # selected, which is what makes "send me the crash log" one step.
    ran = []
    ps.reveal_in_file_manager(r"C:\Users\a\.rehearsal-recorder\crash.log",
                              system="win32", run=ran.append)
    ok("on Windows, Explorer with the file selected",
       ran[-1:] == ['explorer /select,"C:\\Users\\a\\.rehearsal-recorder\\crash.log"'])
    ps.reveal_in_file_manager("/Users/a/.rehearsal-recorder/crash.log",
                              system="darwin", run=ran.append)
    ok("on a Mac, Finder with it revealed",
       ran[-1:] == [["open", "-R", "/Users/a/.rehearsal-recorder/crash.log"]])
    ps.reveal_in_file_manager("/home/a/.rehearsal-recorder/crash.log",
                              system="linux", run=ran.append)
    ok("elsewhere, the folder it is in",
       ran[-1:] == [["xdg-open", "/home/a/.rehearsal-recorder"]])

    def refuses(command):
        raise OSError("no file manager")

    ok("a file manager that will not start is said, not raised",
       ps.reveal_in_file_manager("/x", system="linux", run=refuses)["ok"] is False)

    print("\n[icon] The app has its own icon on both systems")
    # Without one, PyInstaller gives the app its own default, and the taskbar
    # shows a Python logo for an app about recording a band. The icon is
    # drawn once, in packaging/icon.svg; packaging/make_icons.py turns it into
    # what each system reads, and the build names those files.
    import struct as _struct
    packaging = PROJECT / "packaging"
    spec = (packaging / "rehearsal-recorder.spec").read_text(encoding="utf-8")
    ok("the build gives the Windows app its icon",
       'icon.ico' in spec and "icon=" in spec.split("exe = EXE(")[1].split(")\n")[0])
    ok("and the Mac app its own",
       'icon.icns' in spec and "icon=" in spec.split("app = BUNDLE(")[1])

    ico = (packaging / "icon.ico").read_bytes() if (packaging / "icon.ico").exists() else b""
    sizes = []
    if ico[:4] == b"\x00\x00\x01\x00":
        count = _struct.unpack_from("<H", ico, 4)[0]
        # A width byte of 0 is 256: the format has one byte for it.
        sizes = [ico[6 + 16 * i] or 256 for i in range(count)]
    ok("the Windows icon is an .ico holding every size the taskbar and "
       "Explorer ask for", {16, 24, 32, 48, 256} <= set(sizes))

    icns = (packaging / "icon.icns").read_bytes() if (packaging / "icon.icns").exists() else b""
    kinds, at = [], 8
    if icns[:4] == b"icns" and _struct.unpack_from(">I", icns, 4)[0] == len(icns):
        while at + 8 <= len(icns):
            kind, length = icns[at:at + 4], _struct.unpack_from(">I", icns, at + 4)[0]
            if length < 8:
                break
            kinds.append(kind)
            at += length
    ok("the Mac icon is an .icns from 16 px up to the 1024 of a Retina Dock",
       {b"icp4", b"ic07", b"ic08", b"ic10"} <= set(kinds) and at == len(icns))

    # Run from source on Windows, the window would otherwise show python.exe's
    # icon, since that is the program running; a built app shows its own
    # .exe's icon without being told, and the drawing is not in the bundle.
    source_icon = ps.window_icon("win32", frozen=False)
    ok("from source on Windows the window is given the app's icon",
       source_icon is not None and Path(source_icon) == packaging / "icon.ico"
       and Path(source_icon).exists())
    ok("a built app keeps the icon of its own .exe",
       ps.window_icon("win32", frozen=True) is None)
    # On macOS the program is Python too, and the Dock showed its rocket;
    # pywebview sets the Dock's icon from the file it is given.
    source_icon = ps.window_icon("darwin", frozen=False)
    ok("from source on macOS the Dock is given the app's icon",
       source_icon is not None and Path(source_icon) == packaging / "icon.icns"
       and Path(source_icon).exists())
    ok("a built Mac app keeps the icon of its own .app",
       ps.window_icon("darwin", frozen=True) is None)
    ok("and elsewhere nothing is passed that the toolkit would not use",
       ps.window_icon("linux", frozen=False) is None)

    # At 16 px the full drawing's waveform is thinner than a pixel and the
    # icon in a title bar was a red smudge, so the small sizes have a drawing
    # of their own: no tile, and three bars that sit on whole pixels.
    sys.path.insert(0, str(packaging))
    import make_icons
    ok("up to 32 px the icon is drawn from the small drawing",
       all(make_icons.drawing_for(s) == packaging / "icon-small.svg"
           for s in (16, 20, 24, 32)))
    ok("and above that from the full one",
       all(make_icons.drawing_for(s) == packaging / "icon.svg"
           for s in (40, 48, 64, 256, 1024)))

    # The window's icon is not what the taskbar shows: it groups windows by
    # the program they belong to, and run from source that is python.exe.
    # Saying the app is an app of its own is what makes the taskbar use the
    # window's icon instead of Python's.
    class Shell32:
        def __init__(self):
            self.said = []

        def SetCurrentProcessExplicitAppUserModelID(self, app_id):
            self.said.append(app_id)
            return 0

    shell = Shell32()
    ps.claim_taskbar_identity("win32", frozen=False, shell32=shell)
    ok("from source on Windows the app tells the taskbar it is not Python",
       shell.said == [ps.APP_ID] and "Rehearsal" in ps.APP_ID)
    built = Shell32()
    ps.claim_taskbar_identity("win32", frozen=True, shell32=built)
    ok("a built app is its own .exe already, and a pinned one keeps working",
       built.said == [])

    # On macOS the program is Python.app, and the Dock, the menu bar and
    # About said Python, with its version and copyright: they read them from
    # its Info.plist, which can be changed in memory before Cocoa starts.
    python_info = {
        "CFBundleName": "Python",
        "CFBundleShortVersionString": "3.12.2",
        "CFBundleVersion": "3.12.2",
        "NSHumanReadableCopyright": "(c) 2001-2023 Python Software Foundation.",
    }
    info = dict(python_info)
    ps.claim_taskbar_identity("darwin", frozen=False, info=info, version="1.2.3")
    ok("from source on macOS the Dock and the menu bar are given the app's name",
       info["CFBundleName"] == ps.APP_NAME == "РЭХА")
    ok("and About its version and copyright, with no Python build in brackets",
       info["CFBundleShortVersionString"] == "1.2.3"
       and info["NSHumanReadableCopyright"] == ps.COPYRIGHT
       and "Python" not in ps.COPYRIGHT
       and "CFBundleVersion" not in info)
    built_info = dict(python_info)
    ps.claim_taskbar_identity("darwin", frozen=True, info=built_info, version="1.2.3")
    ok("a built .app keeps what its own Info.plist says",
       built_info == python_info)
    ok("and elsewhere there is no such thing to say",
       ps.claim_taskbar_identity("linux", frozen=False, shell32=Shell32(), info={}) is None)

    index = (PROJECT / "ui" / "index.html").read_text(encoding="utf-8")
    favicon = PROJECT / "ui" / "public" / "favicon.svg"
    ok("the interface carries the small drawing, since a tab shows it at 16 px",
       'rel="icon"' in index and favicon.exists()
       and favicon.read_bytes() == (packaging / "icon-small.svg").read_bytes())
    logo = PROJECT / "ui" / "public" / "logo.svg"
    ok("and the full one, for where the window shows it large",
       logo.exists() and logo.read_bytes() == (packaging / "icon.svg").read_bytes())

    # Said in Latin letters: Windows writes this into the build's log in its
    # code page, and cp1252 has no Cyrillic.
    print("\n[name] The app's own name where it says it, Reha on disk")
    # A Cyrillic file name is one more thing to go wrong unpacking a zip or
    # in a build script, so the file is Latin. The zips keep their old
    # names, which is what every copy already out there asks GitHub for.
    import re
    from rehearsal_recorder import updates
    release = (PROJECT / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    built = re.search(r'^NAME = "([^"]+)"', spec, re.M)
    ok("the built app is the file Reha", built is not None and built.group(1) == "Reha")
    ok("and the release builds and self-tests it there",
       "dist/Reha.app/Contents/MacOS/Reha" in release and "dist/Reha/Reha.exe" in release)
    ok("while the zips keep the names older copies ask for",
       set(updates.ASSETS.values())
       == {"RehearsalRecorder-macos.zip", "RehearsalRecorder-windows.zip"}
       and "RehearsalRecorder-${{ matrix.label }}.zip" in release)
    ok("and the Mac asks for the microphone by the app's name",
       'f"{APP_NAME} records your band' in spec.split('"NSMicrophoneUsageDescription"')[1])

    print("\n[version] The built app's file says which version it is")
    # The .app said 0.0.0 and the .exe nothing, since the build was never
    # told the number. The .exe keeps it as four numbers beside the strings.
    import windows_version
    ok("a release is its own four numbers",
       windows_version.numbers("0.7.13") == (0, 7, 13, 0))
    ok("a build between releases counts as the release it leads to",
       windows_version.numbers("0.7.14.dev11+g3613015.d20260930") == (0, 7, 14, 0))
    ok("and a clone never installed is 0.0.0.0",
       windows_version.numbers("unknown") == (0, 0, 0, 0))
    ok("the build hands the .exe its version",
       "windows_version.version_resource(" in spec and "version=__version__" in spec)

    # PyInstaller reads its version classes with pefile, which it brings only
    # on Windows, so the structure itself is checked where the build runs.
    try:
        from PyInstaller.utils.win32 import versioninfo
    except ImportError:
        versioninfo = None
        print("  --   the .exe's version structure: PyInstaller cannot build one here")
    if versioninfo is not None:
        resource = windows_version.version_resource(
            "0.7.13", ps.APP_NAME, ps.COPYRIGHT, "Reha.exe")
        read = versioninfo.VSVersionInfo()
        read.fromRaw(resource.toRaw())
        strings = {s.name: s.val for s in read.kids[0].kids[0].kids}
        ok("the .exe's version reads back with its name, number and copyright",
           strings["ProductVersion"] == strings["FileVersion"] == "0.7.13"
           and strings["FileDescription"] == ps.APP_NAME
           and strings["LegalCopyright"] == ps.COPYRIGHT
           and read.kids[0].kids[0].name == "040904b0"
           and read.ffi.fileVersionMS == 7 and read.ffi.fileVersionLS == 13 << 16)

    # The self-test compares what the file says with what the app knows.
    ok("from source there is no file of the app's own to read",
       ps.version_on_the_file("darwin", frozen=False) is None
       and ps.version_on_the_file("win32", frozen=False) is None)
    contents = tmp / "Reha.app" / "Contents"
    (contents / "MacOS").mkdir(parents=True)
    import plistlib
    with open(contents / "Info.plist", "wb") as f:
        plistlib.dump({"CFBundleShortVersionString": "0.7.13"}, f)
    ok("a built .app's is read from its Info.plist",
       ps.version_on_the_file(
           "darwin", executable=contents / "MacOS" / "Reha", frozen=True
       ) == "0.7.13")
    ok("and on Linux there is none",
       ps.version_on_the_file("linux", frozen=True) is None)
    if sys.platform == "win32":
        # Python's own .exe carries a version, under a language table of its
        # own choosing, so reading it proves the reader finds the table.
        found = ps.windows_product_version(Path(sys.executable))
        ok("an .exe's version is read the way Explorer finds it",
           found.startswith(f"{sys.version_info.major}.{sys.version_info.minor}"))
        bare = tmp / "bare.exe"
        bare.write_bytes(b"MZ")
        try:
            ps.windows_product_version(bare)
            said = None
        except RuntimeError as e:
            said = str(e)
        ok("and a file without one is said to have none",
           said == "bare.exe carries no version")

    print("\n[selftest] The self-test writes UTF-8 into a pipe")
    # How the build reads it. Windows wrote a pipe in its code page, and the
    # build's log showed cp1252's "—" as "�"; the code page stands in here.
    import os
    import subprocess
    run = subprocess.run(
        [sys.executable, "-m", "rehearsal_recorder", "--selftest"],
        capture_output=True, timeout=120,
        env={**os.environ, "PYTHONIOENCODING": "cp1252",
             "PYTHONPATH": str(PROJECT / "src")},
    )
    try:
        said = run.stdout.decode("utf-8")
    except UnicodeDecodeError:
        said = None
    ok("what it says reads as UTF-8, whatever the code page",
       said is not None and " — " in said)
    ok("the app's name included, which is Cyrillic",
       said is not None and said.startswith("РЭХА "))

    print("\n[downloads] A new version goes where a browser would put it")
    # Windows lets the Downloads folder be moved anywhere, so it is asked of
    # the system rather than assumed to be in the home folder.
    found = ps.downloads_folder()
    ok("the Downloads folder is a whole path", isinstance(found, Path) and found.is_absolute())
    if sys.platform == "win32":
        ok("on Windows it is the one the system names, and it is there", found.is_dir())
    ok("on a Mac it is Downloads in the home folder",
       ps.downloads_folder(system="darwin") == Path.home() / "Downloads")

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
