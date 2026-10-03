"""
Putting names right, in the background.

A take's folder on disk and its copies in the cloud folder are named after
the take, and the name follows from its song and its go (store/names.py).
When the name changes without the files — migration 0002 numbering old goes
across the library, "Polyn" becoming "Polyn 1", "Recovered take 5" becoming
"Take 5" — this renames whatever no longer carries it.

One take at a time, each done and recorded before the next, so a pass
stopped half way (the app closed) is picked up by the next one, which skips
what already matches. It does not start on a take while files are in use —
a take recording, a copy being made, a take being saved, cropped or
recovered — but waits for that to finish.

Api finds the takes and renames them. This is the loop around that: the
waiting, the one entry in the background-work list, and the thread. See
docs/superpowers/specs/2026-10-02-songs-in-the-store-design.md, F1–F5.
"""

import sys
import threading

TITLE = "Putting names right"


def _failures(failed):
    """Which takes were left, and why: the first few, then how many more."""
    count = len(failed)
    lead = "Could not rename 1 take" if count == 1 else f"Could not rename {count} takes"
    more = f"; and {count - 3} more" if count > 3 else ""
    return f"{lead}, tried again next time: " + "; ".join(failed[:3]) + more


class NamesPass:
    def __init__(self, find, fix, busy, journal, wait=0.5):
        """
        find() -> [(folder, take_number, name)]: the takes whose files do not
        carry their name. fix(folder, take_number) -> {"renamed": bool,
        "error": str or None}. busy() -> whether files are in use, and the
        next take should wait.
        """
        self._find, self._fix, self._busy = find, fix, busy
        self._journal = journal
        self._wait = wait
        self._asked = threading.Event()
        self._stop = threading.Event()
        self._thread = None

    def run(self):
        """One pass over the library; how many takes it renamed. Shows
        nothing at all when every name already matches."""
        todo = self._find()
        if not todo:
            return 0
        entry = self._journal.begin("names", TITLE)
        renamed, failed = 0, []
        try:
            for i, (folder, take_number, name) in enumerate(todo):
                while self._busy() and not self._stop.is_set():
                    self._stop.wait(self._wait)
                if self._stop.is_set():
                    entry.discard()
                    entry = None
                    return renamed
                entry.progress(i / len(todo), f"“{name}”")
                try:
                    result = self._fix(folder, take_number)
                except Exception as e:
                    # One take's trouble is that take's: the rest go on.
                    result = {"renamed": False, "error": str(e) or type(e).__name__}
                if result.get("error"):
                    failed.append(f"“{name}”: {result['error']}")
                elif result.get("renamed"):
                    renamed += 1
            if failed:
                entry.fail(_failures(failed))
            elif renamed:
                entry.done("1 take renamed" if renamed == 1 else f"{renamed} takes renamed")
            else:
                # Everything it found was left for later (open in the player):
                # nothing happened worth a line.
                entry.discard()
            entry = None
        finally:
            if entry is not None:  # something outside a take went wrong
                entry.fail("Putting names right stopped unexpectedly")
        return renamed

    def request(self):
        """Another pass, once the one running (if any) is over: a recordings
        folder has just been opened."""
        self._asked.set()

    def start(self):
        """The thread, and a first pass. Only the real app starts it; the
        suites call run() themselves."""
        if self._thread is not None:
            return
        self._asked.set()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self, timeout=2.0):
        """Between takes: a rename under way finishes first."""
        self._stop.set()
        self._asked.set()
        if self._thread is not None:
            self._thread.join(timeout)

    def _loop(self):
        while not self._stop.is_set():
            self._asked.wait()
            self._asked.clear()
            if self._stop.is_set():
                return
            try:
                self.run()
            except Exception as e:  # the next open tries again
                print(f"{TITLE} failed: {e}", file=sys.stderr)
