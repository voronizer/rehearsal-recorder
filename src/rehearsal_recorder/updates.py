"""
Whether a newer version is out, and fetching it when asked.

Until now the only way to learn of a release was to go and look on GitHub.
The app asks instead: once when it starts, after the window is up, and once
a day after that for as long as it stays open. It asks for one thing — the
latest release — and sends nothing but its own name; switched off in
Settings, it asks nothing at all.

The app is opened in order to record, often with a band waiting, so none of
this may be in the way. The asking happens on a thread of its own, the
answer is only ever said in Settings' Under the hood, with a dot on the way
there, never in a dialog, and nothing is asked while a take records. A room with no internet
is normal: a check that fails says nothing, and the next one is tomorrow.

Update gets the new version ready beside this copy: its zip downloaded into
a hidden folder next to the app, checked to be the release's own and whole,
unpacked, and its self-test run. Restart now closes the app, and a small
script swaps the new copy in and opens it; the old copy waits beside it until
the new one has started, then goes to the Trash. Signing was thought to be
needed first (issue #6), but the "from the internet" mark is put on by the
program that downloads, such as a browser, and the app's own download does
not carry it. Where the app cannot write beside itself, Download is still
there: the zip into Downloads, the folder opened, the rest left to the person.
See docs/superpowers/specs/2026-10-25-self-update-design.md.
"""

import errno
import functools
import hashlib
import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import threading
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from rehearsal_recorder.platform_support import (
    app_place,
    asks_for_microphone_again,
    can_write_beside,
    clear_download_marks,
    downloads_folder,
    hide_folder,
    reveal_in_file_manager,
    run_detached,
    script_command,
    selftest_command,
    send_to_trash,
    staging_folder,
    swap_script,
    unpack_app,
)

LATEST_URL = "https://api.github.com/repos/voronizer/rehearsal-recorder/releases/latest"
#: One release by its tag, for trying an update with pre-releases before two
#: real releases exist (REHA_UPDATE_TAG, docs/development.md).
TAG_URL = "https://api.github.com/repos/voronizer/rehearsal-recorder/releases/tags/{tag}"
#: The page a person is sent to; fixed here, not taken from the answer.
LATEST_PAGE = "https://github.com/voronizer/rehearsal-recorder/releases/latest"
#: Where a release's zip is, by its tag and name. The answer has an address
#: for it too; this one is used instead, so nothing the network says decides
#: where the app downloads from.
DOWNLOAD_URL = "https://github.com/voronizer/rehearsal-recorder/releases/download/{tag}/{name}"
#: The build each system downloads, as the release workflow names them.
ASSETS = {"win32": "RehearsalRecorder-windows.zip", "darwin": "RehearsalRecorder-macos.zip"}
TIMEOUT_SEC = 5
#: Between two pieces of a download, not for the whole of it.
DOWNLOAD_TIMEOUT_SEC = 30
CHUNK_BYTES = 256 * 1024
CHECK_EVERY_SEC = 24 * 60 * 60
#: How soon to try again when a take was recording at the time.
AFTER_TAKE_SEC = 5 * 60
USER_AGENT = "rehearsal-recorder"
#: How long the new copy's self-test may take. It starts a second Python with
#: all the app's libraries, which a slow machine with an antivirus scanning
#: every new file can take a while over.
SELFTEST_TIMEOUT_SEC = 120
#: In the folder the new copy is got ready in: which version is ready, and
#: what the swap script said happened.
READY_NOTE = "ready.json"
SWAP_RESULT = "result"


def release_number(version):
    """
    The release a version names, as numbers: "0.8.1" and "v0.8.1" are
    (0, 8, 1). What setuptools-scm adds between releases is left off —
    "0.8.1.dev32+g7663602" is a build on its way to 0.8.1, and reads (0, 8, 1).
    None for anything that does not start with a number.
    """
    found = re.match(r"v?(\d+(?:\.\d+)*)", str(version or "").strip())
    if not found:
        return None
    return tuple(int(n) for n in found.group(1).split("."))


def newer(current, latest):
    """Whether `latest` is a later release than the one `current` belongs
    to. Never true when either cannot be read: telling someone they are out
    of date on a guess is worse than saying nothing."""
    have, out = release_number(current), release_number(latest)
    if have is None or out is None:
        return False
    # 0.8 and 0.8.0 are one release.
    width = max(len(have), len(out))
    have += (0,) * (width - len(have))
    out += (0,) * (width - len(out))
    return out > have


def _tls():
    """
    The system's certificates, and certifi's as well when it is there.

    Python on Windows reads the system's store, which is also where a
    company that inspects its traffic puts its own certificate. Python
    inside the macOS build reads none at all, and every HTTPS request would
    fail as unverified — certifi's are what it has there. Both, so neither
    machine loses what the other needs.
    """
    context = ssl.create_default_context()
    try:
        import certifi

        context.load_verify_locations(certifi.where())
    except Exception:  # noqa: BLE001 — without it, the system's alone
        pass
    return context


def _asset(release, system):
    """This system's zip in a release: its name, size and SHA-256, or None
    for a system with no build of its own or a release without one."""
    name = ASSETS.get(system)
    for asset in release.get("assets") or []:
        if not isinstance(asset, dict) or asset.get("name") != name:
            continue
        size = asset.get("size")
        digest = str(asset.get("digest") or "")
        sha256 = digest[len("sha256:"):].lower() if digest.startswith("sha256:") else None
        if sha256 is not None and not re.fullmatch(r"[0-9a-f]{64}", sha256):
            sha256 = None
        return {"name": name, "size": size if isinstance(size, int) else None,
                "sha256": sha256}
    return None


def fetch_latest(opener=urllib.request.urlopen, system=sys.platform, tag=None):
    """
    The latest release on GitHub — {"version": "0.8.1", "tag": "0.8.1",
    "asset": this system's zip or None} — or None when the answer has no
    release in it. Raises when there was no answer at all; the checker
    makes nothing of that.

    GitHub's "latest" is never a pre-release or a draft, so someone on a
    stable version is not offered one. Checked again here all the same.
    With `tag`, that one release instead, a pre-release too.
    """
    if tag is not None and not (release_number(tag) and re.fullmatch(r"[\w.+-]+", tag)):
        return None
    url = TAG_URL.format(tag=urllib.parse.quote(tag)) if tag else LATEST_URL
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
    )
    with opener(request, timeout=TIMEOUT_SEC, context=_tls()) as answer:
        release = json.load(answer)
    found = release.get("tag_name") if isinstance(release, dict) else None
    if not isinstance(found, str) or release.get("draft"):
        return None
    if release.get("prerelease") and found != tag:
        return None
    tag = found
    if release_number(tag) is None or not re.fullmatch(r"[\w.+-]+", tag):
        return None
    return {"version": tag[1:] if tag.startswith("v") else tag, "tag": tag,
            "asset": _asset(release, system)}


def download_url(release):
    """Where this system's zip of a release is fetched from."""
    return DOWNLOAD_URL.format(tag=release["tag"], name=release["asset"]["name"])


def saved_name(release):
    """What the zip is called in Downloads: with its version in the name, so
    it is not taken for one a browser saved earlier."""
    system = release["asset"]["name"].removeprefix("RehearsalRecorder-").removesuffix(".zip")
    return f"RehearsalRecorder-{release['version']}-{system}.zip"


def verify(path, asset):
    """None when the file at `path` is the release's zip and whole; what is
    wrong with it otherwise, in words for the person."""
    size = path.stat().st_size
    if asset.get("size") is not None and size < asset["size"]:
        return "The download was cut short"
    if asset.get("size") is not None and size != asset["size"]:
        return "The download does not match the release"
    if asset.get("sha256"):
        digest = hashlib.sha256()
        with open(path, "rb") as f:
            for piece in iter(lambda: f.read(CHUNK_BYTES), b""):
                digest.update(piece)
        if digest.hexdigest() != asset["sha256"]:
            return "The download does not match the release"
    try:
        with zipfile.ZipFile(path) as z:
            broken = z.testzip()
    except zipfile.BadZipFile:
        return "The download is not a whole zip"
    if broken is not None:
        return f"The download is damaged: {broken}"
    return None


class DownloadProblem(Exception):
    """A download that arrived but is not the release's zip, or not whole."""


NO_ROOM = "There is no room for it on the disk"


class PrepareProblem(Exception):
    """A new copy that could not be got ready, in words for the person."""


def _words_for(e):
    """What went wrong getting a new copy ready, for the line in Settings."""
    if isinstance(e, OSError) and e.errno == errno.ENOSPC:
        return NO_ROOM
    # ditto says it in words, and only says it.
    if isinstance(e, subprocess.CalledProcessError) and b"No space left" in (e.stderr or b""):
        return NO_ROOM
    return str(e) or type(e).__name__


def _own_app_env():
    """
    The environment for starting a copy of the built app from this one, as
    an app of its own. PyInstaller's bootloader leaves settings in the
    environment that a frozen child would take for its parent's, and this is
    its documented way to start afresh (pyinstaller.org, Advanced Topics).
    """
    return {**os.environ, "PYINSTALLER_RESET_ENVIRONMENT": "1"}


def _old_name(place, version):
    """
    What the old copy is called while it waits beside the new one: the
    place's own name with its version, "Reha 0.14.0.app" or "Reha 0.14.0",
    and a number after it if that is taken. Not unique_path: it would read
    "Reha 0.14.0" as a file "Reha 0.14" of type ".0".
    """
    place = Path(place)
    app = place.suffix == ".app"
    base, tail = (place.stem, place.suffix) if app else (place.name, "")
    n = 1
    while True:
        old = place.with_name(f"{base} {version}" + (f" ({n})" if n > 1 else "") + tail)
        if not old.exists():
            return old
        n += 1


class UpdateChecker:
    """
    Asks now and then, remembers the answer for the interface, gets the new
    version ready when asked to, and starts the swap at Restart now.

    enabled() is the switch in Settings; busy() is whether a take is
    recording. Both are asked at the moment of checking, so switching off
    takes effect at once and a take that starts later is not interrupted.

    place() is the app's place, or None run from source; state is the file
    that tells the next start what Restart now did. run, spawn and trash are
    the self-test's runner, the swap script's starter and the Trash, so the
    suites can stand in for them. tag is REHA_UPDATE_TAG: that release is
    offered whatever its number.
    """

    def __init__(self, current, enabled, busy, fetch=fetch_latest,
                 opener=urllib.request.urlopen, downloads=downloads_folder,
                 reveal=reveal_in_file_manager, place=app_place,
                 state=Path.home() / ".rehearsal-recorder" / "update.json",
                 run=subprocess.run, spawn=run_detached, trash=send_to_trash,
                 system=sys.platform, pid=None, tag=None):
        self._current = current
        self._enabled = enabled
        self._busy = busy
        if tag and fetch is fetch_latest:
            fetch = functools.partial(fetch_latest, tag=tag)
        self._fetch = fetch
        self._opener = opener
        self._downloads = downloads
        self._reveal = reveal
        self._place = place
        self._state = Path(state)
        self._run = run
        self._spawn = spawn
        self._trash = trash
        self._system = system
        self._pid = os.getpid() if pid is None else pid
        self._tag = tag
        self._latest = None
        # Whether GitHub has answered since the app started: until then, no
        # newer version found says nothing about whether there is one.
        self._checked = False
        self._download = None
        self._downloaded = None
        # Whether this copy may write beside itself, at the last check.
        self._replace = False
        # Update's progress: None, or {"state", "version", ...} as status says.
        self._install = None
        # The version this run was put in place as, by Restart now.
        self._updated = None
        self._restarting = False
        # What after_start found, once a run.
        self._came = None
        self._start_lock = threading.Lock()
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = None

    def status(self):
        """
        {"on": bool, "latest": {"version": ...} or None, "download": ...,
        "checked": bool}. latest is None when there is nothing newer, or when
        checking is switched off; checked is whether GitHub has answered, so
        that "this is the latest" is only said when it is known. download is
        None until somebody asks for it, then
        {"state": "running" | "done" | "failed", "version", "fraction"}, with
        the file's name once done and what went wrong if it failed.

        replace is whether this copy can replace itself where it is. install
        is None until Update, then {"state": "downloading" | "preparing" |
        "ready" | "failed" | "place_failed", "version"}, with "fraction"
        while it downloads and "error" when it failed. updated is the version
        this run was put in place as by Restart now, once, for the notice.
        """
        on = bool(self._enabled())
        with self._lock:
            latest = {"version": self._latest["version"]} if (on and self._latest) else None
            download = dict(self._download) if self._download else None
            checked = on and self._checked
            install = dict(self._install) if self._install else None
            replace, updated = self._replace, self._updated
        return {"on": on, "latest": latest, "download": download, "checked": checked,
                "replace": replace, "install": install, "updated": updated}

    def check_now(self):
        """
        Asks once. True when it asked, whatever came of it; False when it
        did not, because checking is off or a take is recording.

        No answer leaves what was known before: a room with no internet says
        nothing about whether a release came out.
        """
        if not self._enabled() or self._busy():
            return False
        try:
            found = self._fetch()
        except Exception:  # noqa: BLE001 — no network, no answer: nothing to say
            return True
        place = self._place()
        replace = place is not None and can_write_beside(place)
        with self._lock:
            self._checked = True
            self._replace = replace
        if found is None:
            return True
        offered = newer(self._current, found["version"]) or (
            bool(self._tag) and found["version"] != self._current)
        stale = False
        with self._lock:
            self._latest = found if offered else None
            # A download of a version that is no longer the newest is old news.
            if self._download and (
                self._latest is None or self._download["version"] != self._latest["version"]
            ):
                self._download = None
            # So is a copy got ready of one, once a newer release is out.
            install = self._install
            if (self._latest and install and install["state"] in ("ready", "failed", "place_failed")
                    and install["version"] != self._latest["version"]):
                self._install = None
                stale = install["state"] != "failed"
        if stale and place is not None:
            shutil.rmtree(staging_folder(place, self._system), ignore_errors=True)
        return True

    # ---------- Update and Restart now ----------

    def start_update(self):
        """
        The Update button: gets the newer version ready beside this copy, on
        a thread of its own. Refused while a take records, with nothing
        newer, and where this copy cannot replace itself; while one is under
        way, or ready, it starts nothing.
        """
        if self._busy():
            return {"ok": False, "error": "Not while a take is recording"}
        with self._lock:
            release = self._latest
            install = self._install
        if release is None or not release.get("asset"):
            return {"ok": False, "error": "There is no newer version to download"}
        if install and (install["state"] in ("downloading", "preparing")
                        or (install["state"] == "ready"
                            and install["version"] == release["version"])):
            return {"ok": True}
        place = self._place()
        if place is None or not can_write_beside(place):
            with self._lock:
                self._replace = False
            return {"ok": False, "error": "This copy can't replace itself where it is"}
        self._set_install(release, "downloading", fraction=0.0)
        threading.Thread(target=self.prepare_now, name="update-prepare", daemon=True).start()
        return {"ok": True}

    def prepare_now(self):
        """
        Gets the newer version ready in a hidden folder beside the app: the
        zip downloaded there and checked, as Download checks it; unpacked and
        the zip deleted; any "from the internet" mark cleared; and the new
        copy's self-test run, between takes. A note of the version is written
        last, so a folder without one is a copy the app closed in the middle
        of, and the next start removes it. Anything that fails removes the
        folder and says why; this copy is never touched.
        """
        with self._lock:
            release = self._latest
        place = self._place()
        if release is None or not release.get("asset") or place is None:
            return
        staging = staging_folder(place, self._system)
        self._set_install(release, "downloading", fraction=0.0)
        try:
            shutil.rmtree(staging, ignore_errors=True)
            staging.mkdir(parents=True)
            hide_folder(staging, self._system)
            archive = staging / saved_name(release)
            part = archive.with_name(archive.name + ".part")
            self._fetch_into(release, part, lambda fraction: self._set_install(
                release, "downloading", fraction=fraction))
            problem = verify(part, release["asset"])
            if problem:
                raise DownloadProblem(problem)
            os.replace(part, archive)
            self._set_install(release, "preparing")
            try:
                copy = unpack_app(archive, staging, self._system, run=self._run)
            except (zipfile.BadZipFile, subprocess.CalledProcessError, FileNotFoundError) as e:
                if _words_for(e) == NO_ROOM:
                    raise
                raise PrepareProblem("The download could not be unpacked") from e
            archive.unlink()
            clear_download_marks(copy, self._system, run=self._run)
            # A second copy of the app's Python and libraries, which a take
            # does not need beside it.
            while self._busy():
                if self._stop.wait(1):
                    return
            try:
                done = self._run(selftest_command(copy, self._system),
                                 timeout=SELFTEST_TIMEOUT_SEC, capture_output=True,
                                 env=_own_app_env())
            except subprocess.TimeoutExpired as e:
                raise PrepareProblem("The new copy took too long to start") from e
            except OSError as e:
                if e.errno == errno.ENOSPC:
                    raise
                raise PrepareProblem("The new copy did not start here") from e
            if done.returncode != 0:
                raise PrepareProblem("The new copy did not start here")
            (staging / READY_NOTE).write_text(
                json.dumps({"version": release["version"], "copy": copy.name}),
                encoding="utf-8")
        except Exception as e:  # noqa: BLE001 — said on the line, with Try again
            shutil.rmtree(staging, ignore_errors=True)
            self._set_install(release, "failed", error=_words_for(e))
            return
        self._set_install(release, "ready")

    def restart(self):
        """
        Restart now: starts the script that swaps the ready copy in once the
        app has quit, and writes down for the next start what it is doing.
        The interface closes the window after this says it started. Refused
        with nothing ready, while a take records, and a second time.
        """
        if self._busy():
            return {"ok": False, "error": "Not while a take is recording"}
        with self._lock:
            install = self._install
            if self._restarting:
                return {"ok": False, "error": "Already restarting"}
            if not install or install["state"] not in ("ready", "place_failed"):
                return {"ok": False, "error": "Nothing is ready to restart into"}
            self._restarting = True
        try:
            place = self._place()
            staging = staging_folder(place, self._system)
            note = json.loads((staging / READY_NOTE).read_text(encoding="utf-8"))
            new = staging / note["copy"]
            old = _old_name(place, self._current)
            self._state.parent.mkdir(parents=True, exist_ok=True)
            self._state.write_text(json.dumps(
                {"from": self._current, "to": install["version"], "old": str(old)}),
                encoding="utf-8")
            name, text = swap_script(self._system)
            script = staging / name
            script.write_text(text, encoding="ascii", newline="")
            result = staging / SWAP_RESULT
            result.unlink(missing_ok=True)
            env = _own_app_env()
            env.pop("REHA_OPEN", None)
            env.update(REHA_PID=str(self._pid), REHA_PLACE=str(place), REHA_OLD=str(old),
                       REHA_NEW=str(new), REHA_RESULT=str(result))
            self._spawn(script_command(script, self._system), env)
        except Exception as e:  # noqa: BLE001 — said on the line; this copy runs on
            with self._lock:
                self._restarting = False
            return {"ok": False, "error": str(e) or type(e).__name__}
        return {"ok": True}

    def after_start(self):
        """
        Once the window is up: what the last Restart now did, from the state
        file and the script's result. Put in place, this run says "Updated
        to" and the old copy goes to the Trash; if the Trash refuses, the
        next start tries again. Not put in place, the old copy was opened
        again and the line says why, with the ready copy kept. A copy left
        ready by an earlier run is offered again, unless it is no newer than
        this one; a half-made one is removed.

        Returns {"updated", "failed", "microphone"}: microphone is whether to
        open the input for a moment, so that macOS asks for it now and not
        at the first take. Once a run: asked again, it says what it said.
        """
        with self._start_lock:
            if self._came is None:
                self._came = self._read_last_restart()
            return dict(self._came)

    def _read_last_restart(self):
        came = {"updated": False, "failed": False, "microphone": False}
        place = self._place()
        if place is None:
            return came
        staging = staging_folder(place, self._system)
        try:
            note = json.loads(self._state.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            note = None
        if isinstance(note, dict):
            if note.get("old") and "to" not in note:
                # A Trash that refused at an earlier start.
                self._let_go_of(note["old"])
            else:
                try:
                    said = (staging / SWAP_RESULT).read_text(encoding="ascii").strip()
                except OSError:
                    said = None
                if said == "placed" and note.get("to") == self._current:
                    with self._lock:
                        self._updated = self._current
                    came["updated"] = True
                    came["microphone"] = asks_for_microphone_again(self._system)
                    self._let_go_of(note.get("old"))
                    shutil.rmtree(staging, ignore_errors=True)
                    return came
                if said in ("not-moved", "not-closed"):
                    self._state.unlink(missing_ok=True)
                    (staging / SWAP_RESULT).unlink(missing_ok=True)
                    with self._lock:
                        self._install = {
                            "state": "place_failed", "version": note.get("to"),
                            "error": ("A file in the app's folder was in use" if said == "not-moved"
                                      else "The app did not close in time")}
                    came["failed"] = True
                    return came
                self._state.unlink(missing_ok=True)
        if staging.exists():
            try:
                ready = json.loads((staging / READY_NOTE).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                ready = None
            if (isinstance(ready, dict) and newer(self._current, ready.get("version"))
                    and (staging / str(ready.get("copy"))).is_dir()):
                with self._lock:
                    self._install = {"state": "ready", "version": ready["version"]}
            else:
                shutil.rmtree(staging, ignore_errors=True)
        return came

    def _let_go_of(self, old):
        """The old copy to the Trash; kept in the state file for the next
        start if the Trash refuses it."""
        if old and Path(old).exists() and not self._trash(Path(old)):
            self._state.write_text(json.dumps({"old": old}), encoding="utf-8")
        else:
            self._state.unlink(missing_ok=True)

    def _set_install(self, release, state, **said):
        with self._lock:
            self._install = {"state": state, "version": release["version"], **said}

    # ---------- fetching it ----------

    def start_download(self):
        """The Download button: fetches the newer version on a thread of its
        own. Refused while a take records, and when there is nothing to
        fetch."""
        if self._busy():
            return {"ok": False, "error": "Not while a take is recording"}
        with self._lock:
            release = self._latest
            running = bool(self._download) and self._download["state"] == "running"
            if release is None or not release.get("asset"):
                return {"ok": False, "error": "There is no newer version to download"}
            if not running:
                self._download = {"state": "running", "version": release["version"],
                                  "fraction": 0.0}
        if not running:
            threading.Thread(target=self.download_now, name="update-download",
                             daemon=True).start()
        return {"ok": True}

    def download_now(self):
        """
        Fetches the newer version's zip into Downloads and opens the folder
        with it picked out. Waits for the whole of it, so start_download runs
        this on a thread.

        It arrives as a .part file, and becomes the zip only once its size,
        its SHA-256 and every file inside it check out: what is in Downloads
        under that name is the release's, whole. A zip already there that
        checks out is not fetched again.
        """
        with self._lock:
            release = self._latest
        if release is None or not release.get("asset"):
            return
        self._set_download(release, "running", fraction=0.0)
        try:
            folder = Path(self._downloads())
            final = folder / saved_name(release)
            if not (final.is_file() and verify(final, release["asset"]) is None):
                folder.mkdir(parents=True, exist_ok=True)
                part = final.with_name(final.name + ".part")
                try:
                    self._fetch_into(release, part, lambda fraction: self._set_download(
                        release, "running", fraction=fraction))
                    problem = verify(part, release["asset"])
                    if problem:
                        raise DownloadProblem(problem)
                    os.replace(part, final)
                finally:
                    part.unlink(missing_ok=True)
        except Exception as e:  # noqa: BLE001 — said on the line, with a way to try again
            self._set_download(release, "failed", error=str(e) or type(e).__name__)
            return
        self._downloaded = final
        self._set_download(release, "done", fraction=1.0, file=final.name)
        self._reveal(final)

    def show_download(self):
        """Show in folder: the downloaded zip, picked out again."""
        path = self._downloaded
        if path is None or not path.exists():
            return {"ok": False, "error": "The download is not there any more"}
        return self._reveal(path) or {"ok": True}

    def _fetch_into(self, release, part, progress):
        request = urllib.request.Request(download_url(release),
                                         headers={"User-Agent": USER_AGENT})
        total = release["asset"].get("size") or 0
        got = 0
        with self._opener(request, timeout=DOWNLOAD_TIMEOUT_SEC, context=_tls()) as answer, \
                open(part, "wb") as out:
            while True:
                piece = answer.read(CHUNK_BYTES)
                if not piece:
                    break
                out.write(piece)
                got += len(piece)
                if total:
                    # Short of the whole until it has been checked.
                    progress(min(got / total, 0.99))

    def _set_download(self, release, state, **said):
        with self._lock:
            self._download = {"state": state, "version": release["version"], **said}

    # ---------- the background check ----------

    def start(self):
        """The background check: now, then once a day. Once only."""
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="update-check", daemon=True)
        self._thread.start()

    def wake(self):
        """Check soon: checking has just been switched on."""
        self._wake.set()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def _run(self):
        while not self._stop.is_set():
            if self.check_now():
                wait = CHECK_EVERY_SEC
            elif not self._enabled():
                # Until it is switched on again, which wakes this.
                wait = CHECK_EVERY_SEC
            else:
                wait = AFTER_TAKE_SEC
            self._wake.wait(wait)
            self._wake.clear()
