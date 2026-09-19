"""
Deciding whether what is in the cloud folder is still what the settings and
the take say it should be.

A copy is made from four things: which of the mix and the tracks was asked
for, the take's name (the files are named after it), the format, and the
balance the mix was rendered with. Recording those next to the copy is what
lets a later pass skip a take that is already right, instead of mixing it
again every time something nudges the queue.
"""

import sys
import threading


def source_of(take, what, volumes, fmt):
    """What a copy of this take would be made from right now."""
    names = [t.get("name") for t in take.get("tracks", []) if t.get("name")]
    return {
        "what": what,
        "name": take.get("name", ""),
        "format": fmt,
        # Only this take's tracks: moving an unrelated fader must not make
        # every take in the folder look stale.
        "volumes": {n: float(volumes.get(n, 1.0)) for n in names},
    }


def is_current(take, what, volumes, fmt):
    """True when the cloud folder already holds this take in this shape."""
    shared = take.get("cloud") or {}
    if not shared:
        return False
    return shared.get("source") == source_of(take, what, volumes, fmt)


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
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._thread = None
        self._stopping = False

    def enqueue(self, folder, take_number):
        job = (str(folder), int(take_number))
        with self._lock:
            if job not in self._jobs and job != self._active:
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
                self._active = None
        return True

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._stopping = True
        self._wake.set()

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
