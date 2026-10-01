"""
Whether a newer version is out.

Until now the only way to learn of a release was to go and look on GitHub.
The app asks instead: once when it starts, after the window is up, and once
a day after that for as long as it stays open. It asks for one thing — the
latest release — and sends nothing but its own name; switched off in
Settings, it asks nothing at all.

The app is opened in order to record, often with a band waiting, so none of
this may be in the way. The asking happens on a thread of its own, the
answer is only ever a line in Settings and a dot on the way there, never a
dialog, and nothing is asked while a take records. A room with no internet
is normal: a check that fails says nothing, and the next one is tomorrow.

It only reports. Fetching the new version and replacing this one wait for
the builds to be signed — see issue #6 for why.
"""

import json
import re
import ssl
import threading
import urllib.request

LATEST_URL = "https://api.github.com/repos/voronizer/rehearsal-recorder/releases/latest"
#: The page a person is sent to; fixed here, not taken from the answer.
LATEST_PAGE = "https://github.com/voronizer/rehearsal-recorder/releases/latest"
TIMEOUT_SEC = 5
CHECK_EVERY_SEC = 24 * 60 * 60
#: How soon to try again when a take was recording at the time.
AFTER_TAKE_SEC = 5 * 60


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


def fetch_latest(opener=urllib.request.urlopen):
    """
    {"version": "0.8.1"} for the latest release on GitHub, or None when the
    answer has no release in it. Raises when there was no answer at all;
    the checker makes nothing of that.

    GitHub's "latest" is never a pre-release or a draft, so someone on a
    stable version is not offered one. Checked again here all the same.
    """
    request = urllib.request.Request(
        LATEST_URL,
        headers={"User-Agent": "rehearsal-recorder",
                 "Accept": "application/vnd.github+json"},
    )
    with opener(request, timeout=TIMEOUT_SEC, context=_tls()) as answer:
        release = json.load(answer)
    tag = release.get("tag_name") if isinstance(release, dict) else None
    if not isinstance(tag, str) or release.get("prerelease") or release.get("draft"):
        return None
    if release_number(tag) is None:
        return None
    return {"version": tag[1:] if tag.startswith("v") else tag}


class UpdateChecker:
    """
    Asks now and then, and remembers the answer for the interface.

    enabled() is the switch in Settings; busy() is whether a take is
    recording. Both are asked at the moment of checking, so switching off
    takes effect at once and a take that starts later is not interrupted.
    """

    def __init__(self, current, enabled, busy, fetch=fetch_latest):
        self._current = current
        self._enabled = enabled
        self._busy = busy
        self._fetch = fetch
        self._latest = None
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread = None

    def status(self):
        """{"on": bool, "latest": {"version": ...} or None} — None when
        there is nothing newer, or when checking is switched off."""
        on = bool(self._enabled())
        with self._lock:
            latest = dict(self._latest) if (on and self._latest) else None
        return {"on": on, "latest": latest}

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
        if found is None:
            return True
        with self._lock:
            self._latest = found if newer(self._current, found["version"]) else None
        return True

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
