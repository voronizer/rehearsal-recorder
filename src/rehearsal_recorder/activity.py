"""
What long work is running, how far along it is, and how it ended.

Cloud copies run in the background and crop, stop and recover run where they
were started, but all of them take real time on a long take and none of them
used to say how much. Each registers here; the interface polls `snapshot()`
and shows it in the header of every screen, so leaving a screen loses
neither the progress nor the result. See the design in
docs/superpowers/specs/2026-09-28-background-activity-design.md.

Only for this run of the app: a cloud copy that failed is kept with its take
as well, and that is what outlives a restart.
"""

import threading

KEEP_FINISHED = 20


class Entry:
    def __init__(self, journal, entry_id, kind, title, folder, take_number,
                 waiting):
        self._journal = journal
        self.id = entry_id
        self._data = {
            "id": entry_id,
            "kind": kind,
            "title": title,
            "folder": None if folder is None else str(folder),
            "take_number": take_number,
            "state": "waiting" if waiting else "running",
            "fraction": 0.0,
            "step": None,
            "error": None,
            "detail": None,
            "retry": None,
            "seen": False,
        }

    def snapshot(self):
        with self._journal._lock:
            return dict(self._data)

    def start(self, step=None):
        with self._journal._lock:
            self._data["state"] = "running"
            self._data["step"] = step

    def progress(self, fraction, step=None):
        # Called from the working thread many times a second: two values,
        # and never backwards — a stage that restarts its count must not make
        # the bar jump back.
        with self._journal._lock:
            f = max(0.0, min(1.0, float(fraction)))
            self._data["fraction"] = max(self._data["fraction"], f)
            if step is not None:
                self._data["step"] = step

    def done(self, detail=None):
        self._journal._finish(self, state="done", detail=detail)

    def fail(self, error, retry=None):
        self._journal._finish(self, state="failed", error=error, retry=retry)

    def discard(self):
        self._journal._drop(self)


class Journal:
    def __init__(self):
        self._lock = threading.Lock()
        self._next = 1
        self._open = []      # waiting or running, oldest first
        self._finished = []  # newest first

    def begin(self, kind, title, folder=None, take_number=None, waiting=False):
        with self._lock:
            entry = Entry(self, self._next, kind, title, folder, take_number,
                          waiting)
            self._next += 1
            self._open.append(entry)
        return entry

    def find(self, entry_id):
        with self._lock:
            for e in self._open + self._finished:
                if e.id == entry_id:
                    return e
        return None

    def snapshot(self):
        with self._lock:
            running = [e for e in self._open if e._data["state"] == "running"]
            waiting = [e for e in self._open if e._data["state"] == "waiting"]
            return [dict(e._data) for e in running + waiting + self._finished]

    def mark_seen(self):
        with self._lock:
            for e in self._finished:
                e._data["seen"] = True

    def clear(self):
        with self._lock:
            self._finished = []

    def _finish(self, entry, state, detail=None, error=None, retry=None):
        with self._lock:
            # Once: a failure reported on the way out of an exception must
            # not list an entry that had already finished a second time.
            if entry._data["state"] in ("done", "failed"):
                return
            entry._data.update(state=state, detail=detail, error=error,
                               retry=retry, step=None)
            if state == "done":
                entry._data["fraction"] = 1.0
            if entry in self._open:
                self._open.remove(entry)
            self._finished.insert(0, entry)
            del self._finished[KEEP_FINISHED:]

    def _drop(self, entry):
        with self._lock:
            if entry in self._open:
                self._open.remove(entry)


class Stages:
    """
    One fraction made of several parts, weighted by how much each has to get
    through: a copy of the mix and eight tracks at 64% has done 64% of the
    work, not "the fifth of nine". `part(i)` is the progress function to hand
    to the i-th part; `report(fraction, step)` receives the whole.
    """

    def __init__(self, parts, report):
        self._names = [name for name, _ in parts]
        weights = [max(0.0, float(w)) for _, w in parts]
        total = sum(weights)
        self._report = report
        if total <= 0:
            weights = [1.0] * len(weights)
            total = float(len(weights) or 1)
        self._starts = []
        acc = 0.0
        for w in weights:
            self._starts.append(acc / total)
            acc += w
        self._shares = [w / total for w in weights]

    def part(self, i):
        start, share, name = self._starts[i], self._shares[i], self._names[i]

        def progress(fraction):
            f = max(0.0, min(1.0, float(fraction)))
            # A part of no weight still reports finishing it, so the whole
            # reaches 1.0 at the end.
            whole = start + share * f
            if i == len(self._shares) - 1 and f >= 1.0:
                whole = 1.0
            self._report(whole, name)

        return progress
