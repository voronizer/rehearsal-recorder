"""
Deciding whether what is in the cloud folder is still what the settings and
the take say it should be.

A copy is made from five things: which of the mix and the tracks was asked
for, the take's name (the files are named after it), the format, the balance
the mix was rendered with, and the folder it was written into. Recording
those next to the copy is what lets a later pass skip a take that is already
right, instead of mixing it again every time something nudges the queue.

The record is a claim about a file on someone else's disk, so it is only
believed while that file is still there. A sync client that logs out and
re-creates its folder empty leaves every take fingerprinted as published with
nothing behind it, and a fingerprint that cannot be disproved would suppress
its own repair.
"""

import sys
import threading
from pathlib import Path


def source_of(take, what, volumes, fmt, target):
    """What a copy of this take would be made from right now, and where it
    would go."""
    names = [t.get("name") for t in take.get("tracks", []) if t.get("name")]
    return {
        "what": what,
        "name": take.get("name", ""),
        "format": fmt,
        # The destination depends on the cloud folder and on the rehearsal's
        # name, neither of which the rest of this record can see. Without it,
        # pointing the app somewhere new leaves every take claiming to be in
        # a folder nothing was ever copied to.
        "dir": str(target) if target is not None else "",
        # Only this take's tracks: moving an unrelated fader must not make
        # every take in the folder look stale.
        "volumes": {n: float(volumes.get(n, 1.0)) for n in names},
    }


def copies_exist(shared):
    """Whether what a record claims to have written is still on disk."""
    for key in ("mix", "tracks"):
        path = shared.get(key)
        if path and not Path(path).exists():
            return False
    return True


def is_current(take, what, volumes, fmt, target):
    """True when the cloud folder already holds this take in this shape."""
    shared = take.get("cloud") or {}
    if not shared:
        return False
    if shared.get("source") != source_of(take, what, volumes, fmt, target):
        return False
    return copies_exist(shared)


class PublishQueue:
    """
    Takes waiting to be copied into the cloud folder.

    One worker and one job at a time, so two takes are never mixed at once,
    and nothing at all while `paused()` is true — the audio callback is not
    something to compete with for a copy that can just as well happen in the
    gap before the next take.

    The loop body is `run_next`, which the tests call directly. The thread is
    only started by the real app, so a test never races it.
    """

    def __init__(self, step, paused):
        self._step = step
        self._paused = paused
        self._jobs = []
        self._active = None
        self._rerun_active = False
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._thread = None
        self._stopping = False

    def enqueue(self, folder, take_number):
        job = (str(folder), int(take_number))
        with self._lock:
            if job not in self._jobs:
                if job == self._active:
                    # A request to re-publish the job currently in flight: arm it
                    # to run again after this one finishes.
                    self._rerun_active = True
                else:
                    self._jobs.append(job)
        self._wake.set()

    def states(self, folder):
        """What this rehearsal's takes are doing, by take number."""
        folder = str(folder)
        with self._lock:
            out = {n: "queued" for f, n in self._jobs if f == folder}
            if self._active is not None and self._active[0] == folder:
                out[self._active[1]] = "working"
        return out

    def run_next(self):
        """One job. False when there was nothing to do, or not now."""
        if self._paused():
            return False
        with self._lock:
            if not self._jobs:
                return False
            self._active = self._jobs.pop(0)
        try:
            self._step(*self._active)
        finally:
            with self._lock:
                if self._rerun_active:
                    self._jobs.append(self._active)
                    self._rerun_active = False
                self._active = None
        return True

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self, timeout=2.0):
        """
        Asks the worker to stop and waits a moment for it.

        Only between jobs: a copy already in flight is left to finish, and if
        it takes longer than the wait the process exits on top of it anyway.
        Which is why the copies are staged under a temporary name — that, not
        this, is what keeps a half-written file out of the band's folder.
        """
        self._stopping = True
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout)

    def _loop(self):
        while not self._stopping:
            try:
                ran = self.run_next()
            except Exception as e:  # a dead worker is worse than a loud one
                print(f"Cloud publishing failed: {e}", file=sys.stderr)
                ran = False
            if not ran:
                self._wake.wait(0.5)
                self._wake.clear()
