"""
Application entry point.

The interface is the built React app in ui/dist. The window does not open a
file but a local address, http://127.0.0.1:<port>/, served by api.py (see
mediaserver.py): over file:// the webview loads neither the bundle's ES
modules nor the audio files.
"""

import faulthandler
import html
import logging
import signal
import sys
import threading
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
            if name == "rehearsal_recorder":
                handler.setLevel(logging.INFO)
                logger.setLevel(logging.INFO)

        # A Windows build has no console. Exceptions before pywebview has
        # opened its window would otherwise disappear with stderr.
        def log_uncaught(exc_type, exc, tb):
            logging.getLogger("rehearsal_recorder").critical(
                "Uncaught exception", exc_info=(exc_type, exc, tb)
            )

        sys.excepthook = log_uncaught

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

        system, why = open_system(quiet=True)
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

        from rehearsal_recorder.midi import smf

        notes = [(0.0, b"\x99\x24\x64"), (0.25, b"\x89\x24\x00")]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "check.mid"
            skipped = smf.write_mid(path, track_name="Pałyn", port_name="TD-17", start=[], events=notes)
            meta, back = smf.read_events(path)
        if skipped or meta != {"track_name": "Pałyn", "device_name": "TD-17"} or back != notes:
            raise RuntimeError(f"wrote {len(notes)} notes, got back {len(back)}: {meta}")
        return f"mido {smf.library_version()}, a .mid written and read back"

    def click_and_wav_tempo():
        # Renders a bar of each of the metronome's sounds, made by the app, and
        # writes a WAV carrying a click take's tempo, read back both ways: a
        # build that lost what either needs fails here, in CI, not at Record.
        import tempfile
        import wave
        from pathlib import Path

        import numpy as np

        from rehearsal_recorder.audio.click import SOUNDS, Voices, accent, click_frame, mix_clicks
        from rehearsal_recorder.audio.wavfile import Acid, WavWriter, read_acid

        rate, length = 48000, click_frame(4, 120, 48000)
        bars = np.zeros((length * len(SOUNDS), 1), np.float32)
        for i, sound in enumerate(SOUNDS):
            starts = [(i * length + click_frame(k, 120, rate), accent("4/4", k)) for k in range(4)]
            mix_clicks(bars, 0, starts, Voices(sound, rate, 0.7), (0,))
            if not bars[i * length:(i + 1) * length].any():
                raise RuntimeError(f"the {sound} sound came out silent")
        pcm = (bars[:, 0] * 32767).astype("<i2")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "click.wav"
            with WavWriter(path, rate, 1, 2, acid=Acid(120.0, 4, 4)) as w:
                w.write(pcm.tobytes())
            acid = read_acid(path)
            with wave.open(str(path), "rb") as r:
                back = np.frombuffer(r.readframes(r.getnframes()), dtype="<i2")
        if acid != Acid(120.0, 4, 4) or not np.array_equal(back, pcm):
            raise RuntimeError(f"wrote 120 bpm in 4/4, read back {acid}")
        return f"a bar of each of {len(SOUNDS)} sounds, a wav at 120 bpm in 4/4 read back"

    def encoder():
        from rehearsal_recorder.audio.encode import available

        name = available()
        if name is None:
            raise RuntimeError("soundfile missing — cloud copies cannot compress")
        import soundfile

        return f"{name}, libsndfile {soundfile.__libsndfile_version__}"

    def backing_track():
        # Makes a second of a backing track ready to play, through libsndfile
        # and soxr as when the band adds one: soxr is compiled, and imported
        # only then, so a build that lost it fails here, not at a rehearsal.
        import tempfile
        from pathlib import Path

        import numpy as np
        import soundfile
        import soxr

        from rehearsal_recorder.audio.backing_file import make_ready, open_ready

        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / "Pałyn backing.flac"
            tone = 0.5 * np.sin(2 * np.pi * 1000 * np.arange(44100) / 44100)
            soundfile.write(copy, tone, 44100)
            data, frames, rate, _, _ = open_ready(make_ready(copy, 48000))
            peak = float(np.abs(data).max())
            del data
        if rate != 48000 or abs(frames - 48000) > 2 or abs(peak - 0.5) > 0.01:
            raise RuntimeError(f"a second at 44.1 kHz came out {frames} frames at {rate} Hz, peak {peak:.3f}")
        return f"soxr {soxr.__version__}, a second at 44.1 kHz made ready at 48 kHz"

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
        from importlib.metadata import version

        import webview  # noqa: F401 - that it imports is the check

        # pywebview 6 has no __version__, so it is read from the package's
        # metadata, which the spec bundles for this line.
        return f"pywebview {version('pywebview')}"

    check("audio engine", audio)
    check("looking for interfaces again", rescan_works)
    # Checks the ASIO DLL reached the bundle. It needs no ASIO driver on the
    # machine: the host API is listed, with no devices, even without one.
    if sys.platform == "win32":
        check("ASIO", asio)
    check("MIDI", midi_up)
    check("MIDI files", midi_files)
    check("click and WAV tempo", click_and_wav_tempo)
    check("sample formats", encoder)
    check("backing track", backing_track)
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

    # Arm this before importing pywebview or constructing Api. In the
    # windowed Windows build either can fail before stderr is useful.
    keep_open = _arm_crash_log()  # noqa: F841 — the file must outlive main()
    logging.getLogger("rehearsal_recorder").info(
        "Starting app (dev=%s, frozen=%s)", dev, bool(getattr(sys, "frozen", False))
    )

    import webview

    from rehearsal_recorder.platform_support import APP_NAME, CRASH_LOG, claim_taskbar_identity, window_icon

    # Before the window exists: the taskbar decides whose icon to show when
    # the window first appears, and the Dock takes the app's name when Cocoa
    # starts.
    claim_taskbar_identity()

    if sys.platform == "win32":
        # The first MIDI backend can take several seconds to answer on Windows.
        # Show the same loading screen as the UI so startup never looks like a
        # dead process or a second, unrelated splash.
        startup_html = """<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
background:#fff;color:#17191d;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}
main{display:flex;flex-direction:column;align-items:center;gap:20px;text-align:center}
.logo{width:64px;height:64px}.status{display:flex;align-items:center;gap:12px;color:#71717a}
.spinner{width:20px;height:20px;border:2px solid #d9dce3;border-top-color:#465ee8;
border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style></head><body><main>
<svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" aria-hidden="true">
<rect x="24" y="24" width="208" height="208" rx="48" fill="#1b1b21"/>
<circle cx="128" cy="128" r="78" fill="#e5484d"/>
<rect x="69" y="115" width="10" height="26" rx="5" fill="#fff"/>
<rect x="87" y="100" width="10" height="56" rx="5" fill="#fff"/>
<rect x="105" y="82" width="10" height="92" rx="5" fill="#fff"/>
<rect x="123" y="96" width="10" height="64" rx="5" fill="#fff"/>
<rect x="141" y="78" width="10" height="100" rx="5" fill="#fff"/>
<rect x="159" y="104" width="10" height="48" rx="5" fill="#fff"/>
<rect x="177" y="117" width="10" height="22" rx="5" fill="#fff"/>
</svg>
<div class="status"><span class="spinner"></span><span>Connecting to the audio engine…</span></div>
</main></body></html>"""
        startup_done = threading.Event()
        startup_started = threading.Event()
        app_state = {"api": None}

        window = webview.create_window(
            APP_NAME + (" (dev)" if dev else ""),
            html=startup_html,
            width=1180,
            height=820,
            min_size=(960, 680),
        )
        # Don't let a stray close click strand the startup worker without a
        # GUI loop. Once startup finishes, closing the error page is allowed.
        window.events.closing += lambda: startup_done.is_set()

        def start_windows_app():
            startup_started.set()
            api = None
            try:
                if not window.events.shown.wait(15):
                    raise RuntimeError("The startup window did not appear")
                if not window.events.loaded.wait(15):
                    raise RuntimeError("The startup screen did not load")

                logging.getLogger("rehearsal_recorder").info("Creating application API")
                from rehearsal_recorder.api import Api
                from rehearsal_recorder.midi.diagnostics import configure_trace

                try:
                    configure_trace()
                except Exception:
                    logging.getLogger("rehearsal_recorder").exception(
                        "Controller tracing could not be enabled"
                    )

                api = Api(server_port=DEV_SERVER_PORT if dev else 0)
                app_state["api"] = api
                logging.getLogger("rehearsal_recorder").info("Application API ready")

                if dev:
                    url = DEV_UI_URL
                    print(
                        f"Development mode.\n"
                        f"  interface: {url} (start it with: cd ui && npm run dev)\n"
                        f"  python:    {api.ui_url}\n"
                    )
                else:
                    url = api.ui_url
                    if not api.ui_available:
                        raise RuntimeError(
                            "The interface is not built: ui/dist/index.html is missing. "
                            "Run `cd ui && npm ci && npm run build`."
                        )

                api.attach_window(window)
                # pywebview exposes the API again on each navigation. Install
                # it before replacing the startup page with the real UI.
                window._js_api = api
                logging.getLogger("rehearsal_recorder").info(
                    "Loading application UI in startup window: %s", url
                )
                window.load_url(url)
                window.events.loaded.wait(15)
                api.start_update_checks()
            except Exception as exc:
                logging.getLogger("rehearsal_recorder").exception(
                    "Application startup failed"
                )
                details = html.escape(f"{type(exc).__name__}: {exc}")
                log_path = html.escape(str(CRASH_LOG))
                window.load_html(
                    "<!doctype html><html><head><meta charset=\"utf-8\"><style>"
                    "body{font:15px system-ui,'Segoe UI',sans-serif;color:#20232a;"
                    "padding:26px;line-height:1.5}h1{font-size:20px}code{word-break:break-all}"
                    "</style></head><body><h1>Could not start Reha</h1>"
                    f"<p>{details}</p><p>Startup log: <code>{log_path}</code></p>"
                    "</body></html>"
                )
            finally:
                startup_done.set()

        try:
            # pywebview runs this callback on a worker while the splash window
            # and its message loop stay responsive.
            webview.start(func=start_windows_app, icon=window_icon())
        finally:
            if startup_started.is_set():
                startup_done.wait()
            api = app_state["api"]
            if api is not None:
                logging.getLogger("rehearsal_recorder").info(
                    "Window closed; shutting down"
                )
                api.shutdown()
        return 0

    from rehearsal_recorder.api import Api

    from rehearsal_recorder.midi.diagnostics import configure_trace
    try:
        configure_trace()
    except Exception:
        logging.getLogger("rehearsal_recorder").exception(
            "Controller tracing could not be enabled"
        )

    logging.getLogger("rehearsal_recorder").info("Creating application API")
    api = Api(server_port=DEV_SERVER_PORT if dev else 0)
    logging.getLogger("rehearsal_recorder").info("Application API ready")

    if dev:
        url = DEV_UI_URL
        print(
            f"Development mode.\n"
            f"  interface: {url} (start it with: cd ui && npm run dev)\n"
            f"  python:    {api.ui_url}\n"
        )
    else:
        url = api.ui_url
        if not api.ui_available:
            print(
                "The interface is not built: ui/dist/index.html is missing.\n"
                "Build it:\n"
                "    cd ui && npm ci && npm run build\n"
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
    logging.getLogger("rehearsal_recorder").info(
        "Window created; starting pywebview with URL %s", url
    )
    api.attach_window(window)
    window.events.loaded += api.start_update_checks
    try:
        webview.start(icon=window_icon())
    finally:
        logging.getLogger("rehearsal_recorder").info("Window closed; shutting down")
        api.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
