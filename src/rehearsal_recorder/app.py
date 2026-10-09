"""
Application entry point.

The interface is the built React app in ui/dist. The window does not open a
file but a local address, http://127.0.0.1:<port>/, served by api.py (see
mediaserver.py): over file:// the webview loads neither the bundle's ES
modules nor the audio files.
"""

import faulthandler
import logging
import signal
import sys
from datetime import datetime

from rehearsal_recorder.platform_support import CRASH_LOG


def _arm_crash_log():
    """
    If the process dies hard, leave behind which Python code every thread was
    running at that moment.

    A native crash report names the thread that happened to be allocating when
    the allocator noticed damage, which is rarely the thread that caused it.
    This adds the missing half: a Python traceback per thread, appended to
    ~/.rehearsal-recorder/crash.log.

    Best effort, and deliberately forgiving: this is a diagnostic, and a
    diagnostic that stops the app from starting is worse than no diagnostic.

    The signals differ by system. faulthandler.register and SIGTRAP are Unix
    only — an earlier version reached for signal.SIGTRAP unconditionally and
    would have died on Windows before the window ever opened, which is the
    kind of thing that only shows up when someone actually runs it there.
    """
    try:
        CRASH_LOG.parent.mkdir(parents=True, exist_ok=True)
        log = open(CRASH_LOG, "a", buffering=1, encoding="utf-8")
        log.write(
            f"\n===== started {datetime.now().isoformat(timespec='seconds')} "
            f"on {sys.platform} =====\n"
        )
        faulthandler.enable(file=log, all_threads=True)

        # An exception in a call from the interface is logged by pywebview —
        # to stderr, which a windowed build does not have, so it went
        # nowhere: Save take and renaming both failed on Windows without a
        # trace kept. It is written here too, and the interface points to
        # this file when it says a call failed. One handler, however many
        # times this runs.
        # The app's own errors that it survives — a recordings database it
        # cannot open, an old session.json it cannot read — go the same way.
        handler = logging.StreamHandler(log)
        handler.setLevel(logging.ERROR)
        handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
        handler._ours = True
        for name in ("pywebview", "rehearsal_recorder"):
            logger = logging.getLogger(name)
            for old in [h for h in logger.handlers if getattr(h, "_ours", False)]:
                logger.removeHandler(old)
            logger.addHandler(handler)

        register = getattr(faulthandler, "register", None)  # Unix only
        if register is not None:
            for name in ("SIGTRAP", "SIGUSR1"):
                sig = getattr(signal, name, None)
                if sig is None:
                    continue
                try:
                    register(sig, file=log, all_threads=True, chain=True)
                except (ValueError, OSError, RuntimeError):
                    pass
        return log
    except Exception as e:  # noqa: BLE001 - never let logging stop the app
        print(f"[crash log] not armed: {e}", file=sys.stderr)
        return None


def selftest():
    """
    Does this build actually have everything it needs?

    A packaged app fails in a specific way: it starts, and then the first time
    it touches the sound card or opens a file dialog it turns out a native
    library was never bundled. That is a terrible thing to find out at a
    rehearsal, and it cannot be caught by testing the source — only the built
    thing can answer it.

    So the built thing is asked, without needing a screen:

        ./Reha --selftest

    which is exactly what the build runs after packaging, on each system.
    """
    from rehearsal_recorder import __version__
    from rehearsal_recorder.platform_support import APP_NAME, app_root, trash_kind

    # In UTF-8 wherever it goes. Into a pipe, which is how the build reads it,
    # Windows wrote the code page: cp1252 has "—" as a byte the build's log
    # read as "�", and has no Cyrillic at all, so a path under a Russian user
    # name stopped the self-test at its first line. A console is written in
    # UTF-16 either way.
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    problems = []

    def check(label, fn):
        try:
            detail = fn()
        except Exception as e:
            print(f"  FAIL {label}: {type(e).__name__}: {e}")
            problems.append(label)
            return
        print(f"  ok   {label}" + (f" — {detail}" if detail else ""))

    print(f"{APP_NAME} {__version__} self-test on {sys.platform}")
    print(f"  bundle root: {app_root()}")
    print(f"  frozen: {getattr(sys, 'frozen', False)}")

    def audio():
        import sounddevice as sd

        devices = sd.query_devices()
        ins = [d for d in devices if d["max_input_channels"] > 0]
        return f"PortAudio up, {len(devices)} devices, {len(ins)} with inputs"

    def rescan_works():
        # A real rescan, with nothing open: it proves the private sounddevice
        # calls it rests on are still there in the version that was bundled.
        import sounddevice as sd

        from rehearsal_recorder.audio.devices import rescan

        before = len(sd.query_devices())
        trouble = rescan()
        if trouble:
            raise RuntimeError(trouble)
        after = len(sd.query_devices())
        if after != before:
            raise RuntimeError(f"{before} devices before, {after} after")
        return f"{after} devices found again"

    def asio():
        import sounddevice as sd

        names = [h["name"] for h in sd.query_hostapis()]
        if "ASIO" not in names:
            raise RuntimeError(
                "PortAudio without ASIO — multichannel interfaces will be "
                f"offered with too few inputs (found: {', '.join(names)})"
            )
        return "present"

    def midi_up():
        # Starts the MIDI system and lists its ports; no instrument needed. A
        # build that lost the library fails here, in CI, not at a rehearsal.
        from rehearsal_recorder.midi.ports import open_system

        system, why = open_system()
        if system is None:
            # The app is built for these two, so there MIDI must work. On any
            # other system (a developer's Linux) it is allowed not to.
            if sys.platform in ("darwin", "win32"):
                raise RuntimeError(why)
            return why
        try:
            return f"{system.name} up, {len(system.inputs())} inputs"
        finally:
            system.close()

    def midi_files():
        # Writes a two-note .mid under a name Latin-1 cannot hold and reads it
        # back: a build that lost mido, or whose text handling differs, fails
        # here, in CI, not when a take ends. The label and message stay in
        # ASCII (a Windows console is cp1252); the name lives in the file.
        import tempfile
        from pathlib import Path

        import mido

        from rehearsal_recorder.midi import smf

        notes = [(0.0, b"\x99\x24\x64"), (0.25, b"\x89\x24\x00")]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "check.mid"
            skipped = smf.write_mid(path, track_name="Pałyn", port_name="TD-17", start=[], events=notes)
            meta, back = smf.read_events(path)
        if skipped or meta != {"track_name": "Pałyn", "device_name": "TD-17"} or back != notes:
            raise RuntimeError(f"wrote {len(notes)} notes, got back {len(back)}: {meta}")
        return f"mido {mido.version_info}, a .mid written and read back"

    def encoder():
        from rehearsal_recorder.audio.encode import available

        name = available()
        if name is None:
            raise RuntimeError("soundfile missing — cloud copies cannot compress")
        import soundfile

        return f"{name}, libsndfile {soundfile.__libsndfile_version__}"

    def interface():
        index = app_root() / "ui" / "dist" / "index.html"
        if not index.exists():
            raise RuntimeError(f"ui/dist not bundled (looked in {index})")
        return f"{index.stat().st_size} bytes of index.html"

    def numpy_works():
        import numpy as np

        return f"numpy {np.__version__}"

    def database():
        import tempfile

        from alembic.script import ScriptDirectory

        from rehearsal_recorder.store import db
        from rehearsal_recorder.store.library import Library

        with tempfile.TemporaryDirectory() as tmp:
            library = Library(tmp)
            head = ScriptDirectory.from_config(db.alembic_config()).get_current_head()
            current = db.current_revision(library._engine)
            library.close()
            # No head at all is the bundle without a single migration in it:
            # the database would then be "at head" by being empty.
            if head is None:
                raise RuntimeError("no migrations found — the bundle is missing them")
            if current != head:
                raise RuntimeError(
                    f"migrated to {current!r}, not head {head!r} — "
                    "the bundle is missing a migration"
                )
            return f"migrations up to {head}"

    def version_on_file():
        from rehearsal_recorder.platform_support import version_on_the_file

        shown = version_on_the_file()
        if shown is None:
            return "nothing to read here"
        if shown != __version__:
            raise RuntimeError(f"the file says {shown!r}, the app {__version__!r}")
        return shown

    def window_toolkit():
        import webview

        return f"pywebview {getattr(webview, '__version__', '?')}"

    check("audio engine", audio)
    check("looking for interfaces again", rescan_works)
    # Checks the ASIO DLL reached the bundle. It needs no ASIO driver on the
    # machine: the host API is listed, with no devices, even without one.
    if sys.platform == "win32":
        check("ASIO", asio)
    check("MIDI", midi_up)
    check("MIDI files", midi_files)
    check("sample formats", encoder)
    check("numpy", numpy_works)
    check("history database", database)
    check("window toolkit", window_toolkit)
    check("built interface", interface)
    check("version on the file", version_on_file)
    check("deleting", lambda: f"goes to the {trash_kind()}")

    if problems:
        print(f"\nIncomplete build: {', '.join(problems)}")
        return 1
    print("\nThis build has everything it needs.")
    return 0


# Where the local server listens while developing. Normally the port is
# whatever is free, but Vite has to be told in advance where to forward /api
# and /media, and a config file cannot guess a random number.
DEV_SERVER_PORT = 17817
DEV_UI_URL = "http://localhost:5173"


def main():
    if "--selftest" in sys.argv:
        return selftest()

    # --audio-probe listens to the saved card the way the app opens it, and
    # when no sound comes, asks again several times over and reads the
    # diagnosis off which attempts brought sound. Needed because a refused
    # ASIO stream reports -9999 and nothing else, and a card that opens and
    # sends nothing reports nothing at all. An index after the flag asks
    # about that device instead of the saved one.
    if "--audio-probe" in sys.argv:
        from rehearsal_recorder.audio.probe import run as audio_probe

        rest = sys.argv[sys.argv.index("--audio-probe") + 1:]
        chosen = int(rest[0]) if rest and rest[0].isdigit() else None
        return audio_probe(chosen)

    # --dev opens Vite's dev server instead of the built bundle, so changes
    # to the interface appear without rebuilding. Python still does all the
    # audio; Vite forwards the calls back to it. See docs/development.md.
    dev = "--dev" in sys.argv

    import webview

    from rehearsal_recorder.api import Api
    from rehearsal_recorder.platform_support import APP_NAME, claim_taskbar_identity, window_icon

    # Before the window exists: the taskbar decides whose icon to show when
    # the window first appears, and the Dock takes the app's name when Cocoa
    # starts.
    claim_taskbar_identity()

    keep_open = _arm_crash_log()  # noqa: F841 — the file must outlive main()
    api = Api(server_port=DEV_SERVER_PORT if dev else 0)

    if dev:
        url = DEV_UI_URL
        print(f"Development mode.\n"
              f"  interface: {url} (start it with: cd ui && npm run dev)\n"
              f"  python:    {api.ui_url}\n")
    else:
        url = api.ui_url
        if not api.ui_available:
            print(
                "The interface is not built: ui/dist/index.html is missing.\n"
                "Build it:\n"
                "    cd ui && npm install && npm run build\n"
                "or run with --dev to use Vite's dev server instead.\n",
                file=sys.stderr,
            )
            return 1

    window = webview.create_window(
        APP_NAME + (" (dev)" if dev else ""),
        url,
        js_api=api,
        width=1180,
        height=820,
        min_size=(960, 680),
    )
    # Needed for the native folder picker in Settings.
    api.attach_window(window)
    # Once the interface is up, not before: nothing about it may hold up a
    # band waiting to record. See updates.py.
    window.events.loaded += api.start_update_checks
    try:
        # Returns when the window is closed.
        webview.start(icon=window_icon())
    finally:
        api.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
