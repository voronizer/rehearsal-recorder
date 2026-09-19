# Cloud Auto-Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every take saved during a rehearsal reaches the cloud folder on its own, in the background, without anybody opening a dialog.

**Architecture:** A new `cloud.py` holds a fingerprint of what a cloud copy was made from and a single-worker queue. `api.py` enqueues on the events that make a copy stale and runs one step per job, calling the existing `share_take` to do the copying. The worker thread starts only in the real app (`attach_window`), so the tests drive it one step at a time.

**Tech Stack:** Python 3.12 (stdlib `threading`), React 19 + TypeScript 7, the project's own assertion harness in `tests/` (no pytest).

**Spec:** `docs/superpowers/specs/2026-09-19-cloud-auto-publish-design.md`

## Global Constraints

- Nothing talks to a cloud service. Files are copied into a watched folder, exactly as `share_take` does today.
- `share_take` is the only thing that copies. It is extended, never reimplemented.
- Recording wins: no job runs while `self._recorder is not None`.
- `auto_publish` defaults to `False`; `auto_publish_what` defaults to `"mix"`.
- Valid values for what to publish are exactly `"mix"`, `"tracks"`, `"both"` — the same set `share_take` already validates.
- A balance change re-queues only the takes of the rehearsal in progress. A rename re-queues that one take in any rehearsal.
- A failure never touches the originals under the recordings folder.
- Tests are run with `python3 tests/run_all.py`; the interface suite needs `cd ui && npm run build` first.

---

### Task 1: The fingerprint

A cloud copy records what it was made from, so a later pass can tell whether it is still current.

**Files:**
- Create: `src/rehearsal_recorder/cloud.py`
- Modify: `src/rehearsal_recorder/api.py` (`share_take`, around lines 1269–1350)
- Test: `tests/test_engine.py` (new section after `[11b]`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `cloud.source_of(take: dict, what: str, volumes: dict, fmt: str) -> dict` and `cloud.is_current(take: dict, what: str, volumes: dict, fmt: str) -> bool`. `share_take` writes the result of `source_of` into `take["cloud"]["source"]` and removes `take["cloud_error"]`.

- [ ] **Step 1: Write the failing test**

Add at the end of `tests/test_engine.py`'s `main()`, after the `[11b]` section:

```python
    print("\n[11c] A cloud copy remembers what it was made from")
    from rehearsal_recorder import cloud as cloudmod

    a.set_cloud_format("wav")
    detail = a.get_rehearsal(str(new_folder))
    take = detail["takes"][0]
    a.share_take(str(new_folder), take["take_number"], "mix")
    take = a.get_rehearsal(str(new_folder))["takes"][0]
    volumes = a.get_settings()["volumes"]
    ok("the copy records what it was made from",
       take["cloud"]["source"]["what"] == "mix"
       and take["cloud"]["source"]["name"] == take["name"])
    ok("and it counts as current",
       cloudmod.is_current(take, "mix", volumes, "wav"))
    ok("asking for more than was copied is not current",
       not cloudmod.is_current(take, "both", volumes, "wav"))

    renamed = dict(take, name="Something else")
    ok("a renamed take is not current",
       not cloudmod.is_current(renamed, "mix", volumes, "wav"))
    ok("a take that was never copied is not current",
       not cloudmod.is_current({"name": "x", "tracks": []}, "mix", volumes, "wav"))
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `python3 tests/test_engine.py`
Expected: `ModuleNotFoundError: No module named 'rehearsal_recorder.cloud'`.

- [ ] **Step 3: Write `cloud.py`**

```python
"""
Deciding whether what is in the cloud folder is still what the settings and
the take say it should be.

A copy is made from four things: which of the mix and the tracks was asked
for, the take's name (the files are named after it), the format, and the
balance the mix was rendered with. Recording those next to the copy is what
lets a later pass skip a take that is already right, instead of mixing it
again every time something nudges the queue.
"""


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
```

- [ ] **Step 4: Record the fingerprint in `share_take`**

In `src/rehearsal_recorder/api.py`, add to the imports near the other package imports:

```python
from . import cloud as cloudmod
```

Then in `share_take`, replace these two lines:

```python
        take["cloud"] = shared
        self._write_meta(folder, meta)
```

with:

```python
        shared["source"] = cloudmod.source_of(take, what, self._config.get("volumes", {}), fmt)
        take["cloud"] = shared
        # A copy that succeeded settles whatever went wrong last time.
        take.pop("cloud_error", None)
        self._write_meta(folder, meta)
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `python3 tests/test_engine.py`
Expected: the five new checks print `ok`, and the existing `[11]` and `[11b]` checks still pass.

- [ ] **Step 6: Commit**

```bash
git add src/rehearsal_recorder/cloud.py src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "Record what a cloud copy was made from"
```

---

### Task 2: The queue

One worker, one job at a time, stopped while a take is recording.

**Files:**
- Modify: `src/rehearsal_recorder/cloud.py`
- Test: `tests/test_engine.py` (extend section `[11c]`)

**Interfaces:**
- Consumes: nothing from Task 1 except the module it lives in.
- Produces: `cloud.PublishQueue(step, paused)` where `step(folder: str, take_number: int) -> None` and `paused() -> bool`. Methods: `enqueue(folder, take_number) -> None`, `run_next() -> bool`, `states(folder) -> dict[int, str]` returning `"queued"` or `"working"`, `start() -> None`, `stop() -> None`.

- [ ] **Step 1: Write the failing test**

Append to the `[11c]` section in `tests/test_engine.py`:

```python
    print("\n[11d] The publishing queue")
    done, recording = [], {"now": False}
    q = cloudmod.PublishQueue(
        step=lambda folder, n: done.append((folder, n)),
        paused=lambda: recording["now"],
    )
    q.enqueue("/rec/One", 1)
    q.enqueue("/rec/One", 2)
    q.enqueue("/rec/One", 1)
    ok("the same take is not queued twice",
       q.states("/rec/One") == {1: "queued", 2: "queued"})
    ok("another rehearsal's queue is its own", q.states("/rec/Two") == {})

    recording["now"] = True
    ok("nothing runs while a take is being recorded", q.run_next() is False)
    ok("and the job is still waiting", q.states("/rec/One") == {1: "queued", 2: "queued"})

    recording["now"] = False
    ok("a job runs once recording stops", q.run_next() is True)
    ok("in the order they arrived", done == [("/rec/One", 1)])
    ok("the second one follows", q.run_next() is True and done[-1] == ("/rec/One", 2))
    ok("and then there is nothing to do", q.run_next() is False)
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `python3 tests/test_engine.py`
Expected: `AttributeError: module 'rehearsal_recorder.cloud' has no attribute 'PublishQueue'`.

- [ ] **Step 3: Write the queue**

Add to the top of `src/rehearsal_recorder/cloud.py`:

```python
import sys
import threading
```

and at the end of the file:

```python
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
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `python3 tests/test_engine.py`
Expected: all nine `[11d]` checks print `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/cloud.py tests/test_engine.py
git commit -m "Add the queue that publishes takes one at a time"
```

---

### Task 3: The settings

Two keys, off by default, and a setter the interface can call.

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`get_settings` at lines 182–210; new method next to `set_cloud_format` at line 1257)
- Test: `tests/test_engine.py` (new section `[11e]`)

**Interfaces:**
- Consumes: nothing.
- Produces: `get_settings()` gains `"auto_publish": bool` and `"auto_publish_what": str`. `Api.set_auto_publish(enabled, what=None) -> {"ok": bool, "auto_publish": bool, "auto_publish_what": str}`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_engine.py`:

```python
    print("\n[11e] Publishing on its own is a setting")
    ok("off until it is asked for", a.get_settings()["auto_publish"] is False)
    ok("and the mix is what it would send",
       a.get_settings()["auto_publish_what"] == "mix")

    res = a.set_auto_publish(True, "both")
    ok("it can be turned on", res["ok"] and res["auto_publish"] is True)
    ok("with what to send", a.get_settings()["auto_publish_what"] == "both")
    ok("nonsense is refused", a.set_auto_publish(True, "everything")["ok"] is False)
    ok("and the refusal changed nothing",
       a.get_settings()["auto_publish_what"] == "both")
    a.set_auto_publish(False)
    ok("turning it off leaves the choice alone",
       a.get_settings()["auto_publish"] is False
       and a.get_settings()["auto_publish_what"] == "both")
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `python3 tests/test_engine.py`
Expected: `KeyError: 'auto_publish'`.

- [ ] **Step 3: Add the keys and the setter**

In `get_settings`, after the `"cloud_formats": CLOUD_FORMATS_INFO,` line, add:

```python
            "auto_publish": bool(self._config.get("auto_publish", False)),
            "auto_publish_what": self._config.get("auto_publish_what") or "mix",
```

After `set_cloud_format`, add:

```python
    def set_auto_publish(self, enabled, what=None):
        """
        Whether a saved take goes to the cloud folder on its own, and what of
        it. Turning it on picks up the takes of the rehearsal in progress —
        the ones recorded before the switch was flipped.
        """
        if what is not None and what not in ("mix", "tracks", "both"):
            return {"ok": False, "error": "Unknown share type"}
        self._config["auto_publish"] = bool(enabled)
        if what is not None:
            self._config["auto_publish_what"] = what
        self._write_config()
        return {
            "ok": True,
            "auto_publish": self._config["auto_publish"],
            "auto_publish_what": self._config.get("auto_publish_what") or "mix",
        }
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `python3 tests/test_engine.py`
Expected: all seven `[11e]` checks print `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "Add the setting for publishing takes automatically"
```

---

### Task 4: Saving a take publishes it

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`__init__` line 123, `attach_window` line 151, `keep_take` line 676, `session_state` line 537, `set_auto_publish` from Task 3)
- Test: `tests/test_engine.py` (new section `[11f]`)

**Interfaces:**
- Consumes: `cloud.PublishQueue` (Task 2), `cloud.is_current` (Task 1), the settings keys (Task 3).
- Produces: `Api._cloud_queue` (a `PublishQueue`), `Api._enqueue_publish(folder, take_number) -> None`, `Api._publish_step(folder, take_number) -> None`, `Api._record_cloud_error(folder, take_number, message) -> None`. `session_state()` gains `"cloud_queue": {take_number: "queued" | "working"}`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_engine.py`:

```python
    print("\n[11f] A saved take goes on its own")
    solo = tmp / "Solo"
    write_wav(solo / "one.wav", 1200)
    a.set_cloud_dir(str(tmp / "Drive" / "Auto"))
    a.set_cloud_format("wav")
    a.set_auto_publish(True, "mix")
    a.start_rehearsal("Evening", None, SR, [{"name": "A", "channel": 1}], 16)
    kept = a.keep_take(1, str(solo), "Polyn", 2.0,
                       [{"name": "A", "file": str(solo / "one.wav")}], [])
    ok("the take was saved", kept["ok"])
    ok("and is waiting to be published",
       a.session_state()["cloud_queue"] == {1: "queued"})

    a._cloud_queue.run_next()
    folder = Path(a.session_state()["folder"])
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("the mix is in the cloud folder", Path(take["cloud"]["mix"]).exists())
    ok("the queue is empty afterwards", a.session_state()["cloud_queue"] == {})
    ok("and nothing failed", "cloud_error" not in take)

    # A second pass must not mix it all over again.
    a._enqueue_publish(folder, 1)
    before = Path(take["cloud"]["mix"]).stat().st_mtime_ns
    a._cloud_queue.run_next()
    after = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"]).stat().st_mtime_ns
    ok("an unchanged take is not copied twice", before == after)

    a.set_auto_publish(False)
    a._enqueue_publish(folder, 1)
    ok("with the setting off nothing is queued",
       a.session_state()["cloud_queue"] == {})
    a.set_auto_publish(True, "mix")
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `python3 tests/test_engine.py`
Expected: `KeyError: 'cloud_queue'` from `session_state()`.

- [ ] **Step 3: Wire the queue into the API**

In `__init__`, after `self._recorder = None`, add:

```python
        self._cloud_queue = cloudmod.PublishQueue(
            step=self._publish_step, paused=lambda: self._recorder is not None
        )
```

In `attach_window`, after `self._window = window`, add:

```python
        # Only the real app runs the worker. The suites drive run_next
        # themselves, so nothing races them.
        self._cloud_queue.start()
```

Add these three methods next to `share_take`:

```python
    def _enqueue_publish(self, folder, take_number):
        """Ask for a take to be copied, if copying is switched on at all."""
        if not self._config.get("auto_publish"):
            return
        self._cloud_queue.enqueue(str(folder), take_number)

    def _retry_failed_publishes(self):
        """
        The realistic failure is a sync folder that is briefly not there. The
        next saved take sweeps up whatever the rehearsal could not send while
        it was gone, so the backlog clears itself with no retry loop.
        """
        if self._session is None:
            return
        for t in self._session.get("takes", []):
            if t.get("cloud_error"):
                self._enqueue_publish(self._session["folder"], t["take_number"])

    def _publish_step(self, folder, take_number):
        """
        One take, on the publishing thread. Skips a take that is already in
        the cloud folder in the shape the settings ask for, so a burst of
        requests costs one mixdown, not several.
        """
        if not self._config.get("auto_publish"):
            return
        what = self._config.get("auto_publish_what") or "mix"
        meta = self._read_meta(Path(folder))
        if meta is None:
            return
        take = next(
            (t for t in meta.get("takes", []) if t.get("take_number") == take_number),
            None,
        )
        if take is None:
            return
        fmt = normalize_format(self._config.get("cloud_format"))
        if cloudmod.is_current(take, what, self._config.get("volumes", {}), fmt):
            return
        res = self.share_take(str(folder), take_number, what)
        if not res.get("ok"):
            self._record_cloud_error(
                folder, take_number, res.get("error") or "Could not copy the take"
            )

    def _record_cloud_error(self, folder, take_number, message):
        """Why a take is not in the cloud folder, kept with the take."""
        folder = Path(folder)
        meta = self._read_meta(folder)
        if meta is None:
            return
        take = next(
            (t for t in meta.get("takes", []) if t.get("take_number") == take_number),
            None,
        )
        if take is None:
            return
        take["cloud_error"] = message
        self._write_meta(folder, meta)
        if self._session is not None and Path(self._session["folder"]) == folder:
            self._session["takes"] = meta.get("takes", [])
```

In `keep_take`, replace the final two lines:

```python
        self._save_session_meta()
        return {"ok": True, "take": take_info}
```

with:

```python
        self._save_session_meta()
        self._enqueue_publish(s["folder"], take_number)
        self._retry_failed_publishes()
        return {"ok": True, "take": take_info}
```

In `session_state`, add to the returned dict after `"recording": ...`:

```python
            "cloud_queue": self._cloud_queue.states(s["folder"]),
```

In `set_auto_publish`, before the `return`, add:

```python
        if self._config["auto_publish"] and self._session is not None:
            for t in self._session.get("takes", []):
                self._enqueue_publish(self._session["folder"], t["take_number"])
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `python3 tests/test_engine.py`
Expected: all eight `[11f]` checks print `ok`, and `[11]` through `[11e]` still pass.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "Publish a take to the cloud folder when it is saved"
```

---

### Task 5: Renaming and the balance

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`rename_take` line 876, `save_mix` line 245)
- Test: `tests/test_engine.py` (new section `[11g]`)

**Interfaces:**
- Consumes: `Api._enqueue_publish` (Task 4).
- Produces: nothing new. `rename_take` enqueues the renamed take; `save_mix` enqueues every take of the rehearsal in progress.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_engine.py`:

```python
    print("\n[11g] A rename and a new balance send it again")
    folder = Path(a.session_state()["folder"])
    old_mix = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"])
    a.rename_take(str(folder), 1, "Polyn again")
    ok("renaming queues the take again",
       a.session_state()["cloud_queue"] == {1: "queued"})
    a._cloud_queue.run_next()
    new_mix = Path(a.get_rehearsal(str(folder))["takes"][0]["cloud"]["mix"])
    ok("the copy is named after the new name", "Polyn again" in new_mix.name)
    ok("and the copy under the old name is gone", not old_mix.exists())

    a.save_mix({"A": 0.5})
    ok("a new balance queues the rehearsal's takes",
       a.session_state()["cloud_queue"] == {1: "queued"})
    a._cloud_queue.run_next()
    ok("and the take is current again",
       cloudmod.is_current(a.get_rehearsal(str(folder))["takes"][0], "mix",
                           a.get_settings()["volumes"], "wav"))
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `python3 tests/test_engine.py`
Expected: FAIL on "renaming queues the take again" — the queue is empty.

- [ ] **Step 3: Enqueue from both**

In `rename_take`, immediately before its final `return`, add:

```python
        # The copies in the cloud folder are named after the take.
        self._enqueue_publish(folder, take_number)
```

In `save_mix`, replace `return {"ok": True}` with:

```python
        # The balance lives in the config, not on the take, so "it changed" is
        # true of every take ever recorded. Only the rehearsal in progress is
        # the one this balance was set for; older ones keep what they sent.
        if self._session is not None:
            for t in self._session.get("takes", []):
                self._enqueue_publish(self._session["folder"], t["take_number"])
        return {"ok": True}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `python3 tests/test_engine.py`
Expected: all five `[11g]` checks print `ok`.

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "Send a take again when its name or the balance changes"
```

---

### Task 6: A failure is kept with the take

**Files:**
- Test: `tests/test_engine.py` (new section `[11h]`)
- Modify: nothing — this task proves Task 4's error path and its recovery.

**Interfaces:**
- Consumes: `Api._publish_step`, `Api._record_cloud_error` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_engine.py`:

```python
    print("\n[11h] When the cloud folder is not there")
    folder = Path(a.session_state()["folder"])
    a._config.pop("cloud_dir", None)
    a.rename_take(str(folder), 1, "Polyn third")
    a._cloud_queue.run_next()
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("the take says why it is not in the cloud",
       "cloud folder" in (take.get("cloud_error") or "").lower())
    ok("and the recording itself is untouched",
       Path(take["tracks"][0]["file"]).exists())

    # Saving the next take is what sweeps up what the folder's absence broke.
    a.set_cloud_dir(str(tmp / "Drive" / "Auto"))
    write_wav(solo / "two.wav", 900)
    a.keep_take(2, str(solo), "Later", 2.0,
                [{"name": "A", "file": str(solo / "two.wav")}], [])
    ok("the failed take is queued again alongside the new one",
       a.session_state()["cloud_queue"].get(1) == "queued")
    a._cloud_queue.run_next()
    a._cloud_queue.run_next()
    take = a.get_rehearsal(str(folder))["takes"][0]
    ok("a later run puts it there after all", Path(take["cloud"]["mix"]).exists())
    ok("and the complaint is gone", "cloud_error" not in take)
```

- [ ] **Step 2: Run the test and watch it fail or pass**

Run: `python3 tests/test_engine.py`
Expected: all five checks pass, because Task 4 built both halves, including `_retry_failed_publishes`. If any fails, the fault is in `_publish_step`, `_record_cloud_error` or `_retry_failed_publishes` from Task 4 — fix it there, not by weakening the test.

- [ ] **Step 3: Commit**

```bash
git add tests/test_engine.py
git commit -m "Cover what happens when the cloud folder is gone"
```

---

### Task 7: The setting on screen

**Files:**
- Modify: `ui/src/lib/api.ts` (the `Settings` type, the `Take` type near line 33, the api surface near `set_cloud_format` at line 284)
- Modify: `ui/src/screens/Settings.tsx` (the cloud folder block around lines 498–540)
- Test: `tests/test_interface.py` (the `get_settings` mock at line 264, a new check in the settings section)

**Interfaces:**
- Consumes: `set_auto_publish` and the two settings keys (Task 3).
- Produces: nothing later tasks depend on except the `Take.cloud_error` field used in Task 8.

- [ ] **Step 1: Write the failing test**

In `tests/test_interface.py`, add to the `get_settings` mock object, after the `cloud_format: cloudFormat,` line:

```javascript
    auto_publish: autoPublish.on, auto_publish_what: autoPublish.what,
```

Above `window.__MAKE_API__`, next to the other mock state, add:

```javascript
let autoPublish = {on:false, what:'mix'};
```

and to the api object, next to `set_cloud_format`:

```javascript
  set_auto_publish: track('set_auto_publish', async (on, what) => {
    autoPublish = {on, what: what || autoPublish.what};
    return {ok:true, auto_publish:autoPublish.on, auto_publish_what:autoPublish.what};
  }),
```

Then in the settings section of the suite, after the existing cloud format checks around line 694, add:

```python
        page.click("text=Send saved takes automatically")
        page.wait_for_timeout(300)
        switched = calls("set_auto_publish")
        ok("the automatic switch reaches Python",
           bool(switched) and switched[-1]["args"][0] is True)
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd ui && npm run build && cd .. && python3 tests/test_interface.py`
Expected: FAIL on "the automatic switch reaches Python" — there is no such control, so the click throws or records nothing.

- [ ] **Step 3: Add the types and the call**

In `ui/src/lib/api.ts`, add to the `Take` type after the `cloud?: CloudShare` line:

```typescript
  /** Why this take is not in the cloud folder, if something went wrong. */
  cloud_error?: string
```

Add to the `Settings` type, next to `cloud_format`:

```typescript
  auto_publish: boolean
  auto_publish_what: ShareWhat
```

Add to the api surface, after `set_cloud_format`:

```typescript
  set_auto_publish(
    enabled: boolean,
    what?: ShareWhat
  ): Promise<Ok<{ auto_publish?: boolean; auto_publish_what?: ShareWhat }>>
```

- [ ] **Step 4: Add the control**

In `ui/src/screens/Settings.tsx`, directly after the block that renders the cloud folder row (the one ending with the `clear_cloud_dir` button), add:

```tsx
          <div className="mt-4 flex items-start gap-3">
            <input
              id="auto-publish"
              type="checkbox"
              className="mt-1 size-4"
              checked={settings?.auto_publish ?? false}
              disabled={!settings?.cloud_dir}
              onChange={async (e) => {
                const on = e.target.checked
                await api().set_auto_publish(on, settings?.auto_publish_what)
                setSettings(await api().get_settings())
              }}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="auto-publish">Send saved takes automatically</Label>
              <p className="text-xs text-muted-foreground">
                Every take you keep is copied to the cloud folder on its own,
                between takes rather than while one is recording.
              </p>
            </div>
          </div>
```

`setSettings(await api().get_settings())` is how every other handler in this file reloads — `applyCloudDir` at line 145 and `browseCloud` at line 158 both end that way.

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd ui && npm run build && cd .. && python3 tests/test_interface.py`
Expected: the new check prints `ok`.

- [ ] **Step 6: Commit**

```bash
git add ui/src/lib/api.ts ui/src/screens/Settings.tsx tests/test_interface.py
git commit -m "Offer automatic publishing in Settings"
```

---

### Task 8: What each take is doing

**Files:**
- Modify: `ui/src/lib/api.ts` (the session state type)
- Modify: `ui/src/components/TakeList.tsx` (props near line 55, the cloud button near lines 157–178)
- Modify: `ui/src/screens/Rehearsal.tsx` (where it renders `TakeList` and refreshes the session)
- Test: `tests/test_interface.py` (the rehearsal section)

**Interfaces:**
- Consumes: `session_state().cloud_queue` (Task 4), `Take.cloud_error` (Task 7).
- Produces: `TakeList` gains an optional `cloudStates?: Record<number, "queued" | "working">` prop.

- [ ] **Step 1: Write the failing test**

In `tests/test_interface.py`, make the mock's `session_state` report a queue by adding to the object it returns:

```javascript
       cloud_queue: cloudQueue,
```

and next to the other mock state:

```javascript
let cloudQueue = {};
```

In `keep_take`, after `session.takes.push(take);`, add:

```javascript
    cloudQueue = {...cloudQueue, [n]: 'queued'};
```

Then in the rehearsal section of the suite, after a take has been saved and the screen shows the take list, add:

```python
        ok("a saved take says it is on its way to the cloud",
           page.locator("text=Waiting for the cloud").count() > 0)
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd ui && npm run build && cd .. && python3 tests/test_interface.py`
Expected: FAIL on "a saved take says it is on its way to the cloud".

- [ ] **Step 3: Carry the states into the list**

In `ui/src/lib/api.ts`, add to the session state type, next to `recording`:

```typescript
  /** Takes the app is copying to the cloud folder right now. */
  cloud_queue?: Record<number, "queued" | "working">
```

In `ui/src/components/TakeList.tsx`, add to the props type next to `onShare`:

```typescript
  cloudStates?: Record<number, "queued" | "working">
```

and to the destructured arguments next to `onShare,`:

```typescript
  cloudStates,
```

Next to where `isShared` is computed (line 89), add:

```typescript
        const cloudState = cloudStates?.[take.take_number]
```

Directly above the share button (the `{onShare && (` block), add:

```tsx
              {cloudState && (
                <span className="text-xs text-muted-foreground">
                  {cloudState === "working" ? "Copying to the cloud" : "Waiting for the cloud"}
                </span>
              )}
              {!cloudState && take.cloud_error && (
                <span className="text-xs text-destructive" title={take.cloud_error}>
                  Not in the cloud
                </span>
              )}
```

- [ ] **Step 4: Pass them in and keep them fresh**

In `ui/src/screens/Rehearsal.tsx`, pass the states to `TakeList`:

```tsx
        cloudStates={session.cloud_queue}
```

and add an effect that re-reads the session while anything is in flight, next to the other hooks in that screen:

```tsx
  // While takes are being copied the only thing that changes is on the Python
  // side, so ask — but only until the queue drains.
  const inFlight = Object.keys(session.cloud_queue ?? {}).length > 0
  useEffect(() => {
    if (!inFlight) return
    const id = setInterval(() => onChanged(), 1500)
    return () => clearInterval(id)
  }, [inFlight, onChanged])
```

`onChanged` is the screen's existing prop for "ask Python again" — `App.tsx:205` wires it to `refreshSession`, and the rename and delete handlers in this file already call it. Add `useEffect` to the file's React import if it is not already there.

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd ui && npm run build && cd .. && python3 tests/test_interface.py`
Expected: the new check prints `ok`.

- [ ] **Step 6: Run everything**

Run: `python3 tests/run_all.py`
Expected: `All suites passed.`

- [ ] **Step 7: Commit**

```bash
git add ui/src/lib/api.ts ui/src/components/TakeList.tsx ui/src/screens/Rehearsal.tsx tests/test_interface.py
git commit -m "Show what each take is doing on its way to the cloud"
```

---

## What this plan does not do

Listed in the spec as out of scope, and no task here touches them: talking to a cloud service, choosing what to publish per take, re-publishing finished rehearsals when the balance changes, and removing a cloud copy when a take is deleted.
