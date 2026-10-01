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

Asked to, it fetches the new version's zip for this system into Downloads,
makes sure it is the release's own and whole, and opens the folder with it
picked out. Unpacking it and opening the new copy is left to the person;
replacing this one itself waits for the builds to be signed — see issue #6.
"""

import hashlib
import json
import os
import re
import ssl
import sys
import threading
import urllib.request
import zipfile
from pathlib import Path

from rehearsal_recorder.platform_support import downloads_folder, reveal_in_file_manager

LATEST_URL = "https://api.github.com/repos/voronizer/rehearsal-recorder/releases/latest"
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


def fetch_latest(opener=urllib.request.urlopen, system=sys.platform):
    """
    The latest release on GitHub — {"version": "0.8.1", "tag": "0.8.1",
    "asset": this system's zip or None} — or None when the answer has no
    release in it. Raises when there was no answer at all; the checker
    makes nothing of that.

    GitHub's "latest" is never a pre-release or a draft, so someone on a
    stable version is not offered one. Checked again here all the same.
    """
    request = urllib.request.Request(
        LATEST_URL,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"},
    )
    with opener(request, timeout=TIMEOUT_SEC, context=_tls()) as answer:
        release = json.load(answer)
    tag = release.get("tag_name") if isinstance(release, dict) else None
    if not isinstance(tag, str) or release.get("prerelease") or release.get("draft"):
        return None
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


class UpdateChecker:
    """
    Asks now and then, remembers the answer for the interface, and fetches
    the new version when asked to.

    enabled() is the switch in Settings; busy() is whether a take is
    recording. Both are asked at the moment of checking, so switching off
    takes effect at once and a take that starts later is not interrupted.
    """

    def __init__(self, current, enabled, busy, fetch=fetch_latest,
                 opener=urllib.request.urlopen, downloads=downloads_folder,
                 reveal=reveal_in_file_manager):
        self._current = current
        self._enabled = enabled
        self._busy = busy
        self._fetch = fetch
        self._opener = opener
        self._downloads = downloads
        self._reveal = reveal
        self._latest = None
        # Whether GitHub has answered since the app started: until then, no
        # newer version found says nothing about whether there is one.
        self._checked = False
        self._download = None
        self._downloaded = None
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
        """
        on = bool(self._enabled())
        with self._lock:
            latest = {"version": self._latest["version"]} if (on and self._latest) else None
            download = dict(self._download) if self._download else None
            checked = on and self._checked
        return {"on": on, "latest": latest, "download": download, "checked": checked}

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
        with self._lock:
            self._checked = True
        if found is None:
            return True
        with self._lock:
            self._latest = found if newer(self._current, found["version"]) else None
            # A download of a version that is no longer the newest is old news.
            if self._download and (
                self._latest is None or self._download["version"] != self._latest["version"]
            ):
                self._download = None
        return True

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
                    self._fetch_into(release, part)
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

    def _fetch_into(self, release, part):
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
                    self._set_download(release, "running", fraction=min(got / total, 0.99))

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
