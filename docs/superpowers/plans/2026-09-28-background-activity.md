# Background Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show, on any screen, what long work is running (cloud copies, crop, stop, recover), how far along it is, and how it ended; move manual cloud copies into the background.

**Architecture:** A journal in Python (`rehearsal_recorder/activity.py`) that every long operation registers with and reports a weighted fraction to; the interface polls it over http (`activity`, added to `POLLABLE`) through one store (`ui/src/lib/activity.ts`) that feeds a header button with a popover list, corner notices for cloud results, and in-place progress lines. Manual `share_take` only queues; the copying itself moves to `Api._copy_to_cloud`, run by the existing `PublishQueue`.

**Tech Stack:** Python 3.10+ (numpy, soundfile, wave, sounddevice stub in tests), React 19 + TypeScript + Radix (`radix-ui` Popover), Playwright interface tests.

**Spec:** `docs/superpowers/specs/2026-09-28-background-activity-design.md`

## Global Constraints

- Tests are plain scripts: `python tests/test_engine.py`, `tests/test_platform.py`, `tests/test_store.py`, `tests/test_interface.py` (needs `ui/dist`: `cd ui && npm run build`). Each prints `ok`/`FAIL` lines and exits non-zero on failure. Run with the scratch venv: `$V/bin/python` where `V=/private/tmp/claude-501/-Users-aliaksandrvaranishcha-Downloads-rehearsal-recorder/5ce90ee9-4414-4696-b65b-dc88e72e361d/scratchpad/venv`.
- Journal keeps the last **20** finished entries, only for this run of the app.
- Poll cadence: **0.4 s** while anything waits or runs or the list is open, **2 s** otherwise.
- `done` notices go after 4 s (existing `DONE_MS`); `error` notices stay. Cloud notice key: `cloud:<folder>:<take_number>`.
- `raw_to_wav` copies in **4 MB** pieces and must write byte-identical `.wav` files to today's.
- Only cloud copies run in the background. Crop, stop and recover keep blocking their bridge call.
- Retry only for failed cloud copies. No cancel.
- Code style: prose comments explaining why, like the surrounding code; the interface's user-facing strings in English.
- Commit after each task; end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

## Review Focus

1. A take deleted or renamed while its cloud copy waits in the queue: the job must fail into the journal with the take's own error ("Take not found"), not crash the worker — test in Task 4.
2. The same take queued automatically and then manually before either runs: one job, doing what the manual request asked — test in Task 4.
3. A take that is re-queued while its copy is running (a rename mid-copy): the entry for the rerun must appear as waiting and the running one must still finish — test in Task 4.
4. `raw_to_wav` on an empty raw file, and on one whose length is not a whole number of frames: same bytes as before — test in Task 2.
5. The header button when the only finished entries have been cleared: it disappears, and a later copy brings it back — test in Task 5.

---

### Task 1: The journal

**Files:**
- Create: `src/rehearsal_recorder/activity.py`
- Modify: `src/rehearsal_recorder/api.py` (Api.__init__, new methods `activity`, `activity_seen`, `clear_activity`)
- Modify: `src/rehearsal_recorder/mediaserver.py` (`POLLABLE` gains `"activity"`)
- Test: `tests/test_engine.py` (new section `[40] The journal of long work`)

**Interfaces:**
- Produces: `activity.Journal()` with `begin(kind, title, folder=None, take_number=None, waiting=False) -> Entry`, `snapshot() -> list[dict]`, `mark_seen()`, `clear()`, `find(entry_id) -> Entry | None`. `Entry` methods: `start(step=None)`, `progress(fraction, step=None)`, `done(detail=None)`, `fail(error, retry=None)`, `discard()`; attribute `id`. Entry dict keys: `id, kind, title, folder, take_number, state, fraction, step, error, detail, retry, seen`.
- Produces: `activity.Stages(parts, report)` where `parts` is `[(step_name, weight), ...]` and `report(fraction, step)`; `stages.part(i) -> fn(fraction)`.
- Produces: `Api._journal` (a `Journal`), `Api.activity() -> {"entries": [...], "recording": bool}`, `Api.activity_seen() -> {"ok": True}`, `Api.clear_activity() -> {"ok": True}`.

- [ ] **Step 1: Write the failing tests** — append before the final summary in `tests/test_engine.py`:

```python
    print("\n[40] The journal of long work")
    from rehearsal_recorder import activity as actmod

    j = actmod.Journal()
    e = j.begin("cloud", "“Polyn” → cloud", "/rec/One", 2, waiting=True)
    snap = j.snapshot()
    ok("a queued job is listed as waiting",
       snap[0]["state"] == "waiting" and snap[0]["take_number"] == 2
       and snap[0]["fraction"] == 0.0)
    e.start("Mixing")
    e.progress(0.25)
    e.progress(0.1)  # never backwards
    ok("a running job says how far along it is",
       j.snapshot()[0]["state"] == "running"
       and j.snapshot()[0]["fraction"] == 0.25
       and j.snapshot()[0]["step"] == "Mixing")
    e.done("MP3 of the mix")
    got = j.snapshot()[0]
    ok("a finished one says what it came to, unseen",
       got["state"] == "done" and got["fraction"] == 1.0
       and got["detail"] == "MP3 of the mix" and got["seen"] is False)
    bad = j.begin("cloud", "“Take 3” → cloud", "/rec/One", 3)
    bad.start()
    bad.fail("The cloud folder is gone", retry="both")
    ok("a failure keeps why and what to retry",
       j.find(bad.id).snapshot()["error"] == "The cloud folder is gone"
       and j.find(bad.id).snapshot()["retry"] == "both")
    running = j.begin("crop", "Cropping “Polyn”", "/rec/One", 1)
    running.start()
    order = [x["id"] for x in j.snapshot()]
    ok("what is running comes first, then the finished, newest first",
       order == [running.id, bad.id, e.id])
    j.mark_seen()
    ok("looking marks the finished ones seen, not the running",
       all(x["seen"] for x in j.snapshot() if x["state"] in ("done", "failed")))
    gone = j.begin("cloud", "nothing to do", "/rec/One", 4, waiting=True)
    gone.discard()
    ok("a job with nothing to do leaves no trace",
       all(x["id"] != gone.id for x in j.snapshot()))
    for i in range(30):
        f = j.begin("cloud", f"t{i}", "/rec/Two", i)
        f.done()
    ok("only the last twenty finished are kept",
       sum(1 for x in j.snapshot() if x["state"] != "running") == 20
       and j.snapshot()[1]["title"] == "t29")
    j.clear()
    ok("clearing drops the finished and keeps the running",
       [x["id"] for x in j.snapshot()] == [running.id])

    seen_parts = []
    stages = actmod.Stages([("Mixing", 2), ("Encoding the mix", 1),
                            ("Encoding the tracks", 0)],
                           lambda f, s: seen_parts.append((round(f, 3), s)))
    stages.part(0)(0.5)
    stages.part(0)(1.0)
    stages.part(1)(0.5)
    stages.part(2)(1.0)
    ok("stages add up by weight",
       seen_parts == [(0.333, "Mixing"), (0.667, "Mixing"),
                      (0.833, "Encoding the mix"), (1.0, "Encoding the tracks")])

    _, a40 = fresh_api(Path(tempfile.mkdtemp()))
    first = a40._journal.begin("crop", "Cropping", "/rec/X", 1)
    first.start()
    ok("the interface can ask for it",
       a40.activity()["entries"][0]["kind"] == "crop"
       and a40.activity()["recording"] is False)
    first.done()
    a40.activity_seen()
    ok("and mark it seen", a40.activity()["entries"][0]["seen"] is True)
    a40.clear_activity()
    ok("and clear it", a40.activity()["entries"] == [])
    from rehearsal_recorder import mediaserver
    ok("it is polled over http", "activity" in mediaserver.POLLABLE)
```

- [ ] **Step 2: Run to see it fail** — `$V/bin/python tests/test_engine.py` → ImportError on `rehearsal_recorder.activity`.

- [ ] **Step 3: Write `src/rehearsal_recorder/activity.py`**

```python
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
            if f > self._data["fraction"]:
                self._data["fraction"] = f
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
```

- [ ] **Step 4: Wire it into the Api** — in `Api.__init__` (after `self._player_lock = ...`): `self._journal = activity.Journal()` (import `from rehearsal_recorder import activity`). Add near `session_state`:

```python
    # ---------- long work ----------

    def activity(self):
        """What long work is running and how it ended — polled over http by
        the header of every screen. While a take records, the cloud copies
        waiting behind it say so."""
        recording = self._recorder is not None
        entries = self._journal.snapshot()
        if recording:
            for e in entries:
                if e["kind"] == "cloud" and e["state"] == "waiting":
                    e["step"] = "After the take"
        return {"entries": entries, "recording": recording}

    def activity_seen(self):
        self._journal.mark_seen()
        return {"ok": True}

    def clear_activity(self):
        self._journal.clear()
        return {"ok": True}
```

and add `"activity",` to `POLLABLE` in `mediaserver.py`.

- [ ] **Step 5: Run** `$V/bin/python tests/test_engine.py` → all `[40]` lines `ok`, whole suite passes.

- [ ] **Step 6: Commit** — `git add src/rehearsal_recorder/activity.py src/rehearsal_recorder/api.py src/rehearsal_recorder/mediaserver.py tests/test_engine.py && git commit` ("Keep a journal of long work, for the interface to poll").

---

### Task 2: Progress from the loops, and `raw_to_wav` in pieces

**Files:**
- Modify: `src/rehearsal_recorder/audio/capture.py` (`raw_to_wav`)
- Modify: `src/rehearsal_recorder/audio/mixdown.py` (`mixdown`)
- Modify: `src/rehearsal_recorder/audio/encode.py` (`encode`)
- Modify: `src/rehearsal_recorder/audio/crop.py` (`crop_wav`)
- Test: `tests/test_engine.py` (new section `[41] Long loops say how far along they are`)

**Interfaces:**
- Produces: `raw_to_wav(raw_path, wav_path, samplerate, bit_depth=16, channels=1, progress=None)`, `mixdown(tracks, out_path, volumes=None, progress=None)`, `encode(src, fmt, dst=None, progress=None)`, `crop_wav(src, dst, start_sec, end_sec, fade_sec=DEFAULT_FADE_SEC, progress=None)`. `progress(fraction)` is called with rising values ending at 1.0 on success.

- [ ] **Step 1: Write the failing tests**

```python
    print("\n[41] Long loops say how far along they are")
    from rehearsal_recorder.audio.capture import raw_to_wav as r2w
    from rehearsal_recorder.audio.crop import crop_wav as cw
    from rehearsal_recorder.audio.encode import encode as enc
    from rehearsal_recorder.audio.mixdown import mixdown as md

    def reference_wav(raw, wav, rate, depth, channels):
        # The old raw_to_wav, kept here to compare against byte for byte.
        width = (2 if depth == 16 else 3) * channels
        data = Path(raw).read_bytes()
        usable = len(data) - (len(data) % width)
        with wave.open(str(wav), "wb") as w:
            w.setnchannels(channels)
            w.setsampwidth(2 if depth == 16 else 3)
            w.setframerate(rate)
            w.writeframes(data[:usable])

    loops = Path(tempfile.mkdtemp())
    rng = np.random.default_rng(7)
    for depth, channels, size in ((16, 1, 10_000_003), (24, 2, 12_345_677),
                                  (16, 2, 0), (24, 1, 5)):
        raw = loops / f"r{depth}{channels}{size}.raw"
        raw.write_bytes(rng.integers(0, 256, size, dtype=np.uint8).tobytes())
        mine, theirs = loops / "mine.wav", loops / "theirs.wav"
        steps = []
        r2w(raw, mine, SR, depth, channels=channels, progress=steps.append)
        reference_wav(raw, theirs, SR, depth, channels)
        ok(f"a {depth}-bit, {channels}-channel raw of {size} bytes is wrapped "
           "exactly as before", mine.read_bytes() == theirs.read_bytes())
        ok("and says how far along it is, up to the end",
           steps and steps[-1] == 1.0 and steps == sorted(steps))

    write_wav(loops / "A.wav", 1000, seconds=3.0)
    write_wav(loops / "B.wav", 2000, seconds=2.0)
    steps = []
    md([{"name": "A", "file": str(loops / "A.wav")},
        {"name": "B", "file": str(loops / "B.wav")}],
       loops / "mix.wav", progress=steps.append)
    ok("a mixdown says how far along it is",
       len(steps) > 2 and steps[-1] == 1.0 and steps == sorted(steps)
       and any(0.4 < s < 0.6 for s in steps))

    steps = []
    enc(loops / "mix.wav", "flac", progress=steps.append)
    ok("so does an encode", steps and steps[-1] == 1.0 and steps == sorted(steps))

    steps = []
    cw(loops / "A.wav", loops / "A-cut.wav", 0.5, 2.5, progress=steps.append)
    ok("and a crop", steps and steps[-1] == 1.0 and steps == sorted(steps))
```

- [ ] **Step 2: Run to see it fail** — TypeError: unexpected keyword `progress`.

- [ ] **Step 3: `raw_to_wav` in pieces** — replace the body in `capture.py`:

```python
# How much of a raw file is copied at a time: small enough that an hour of
# 24-bit audio is not read into memory whole, large enough that the copy is
# not slowed down by the number of pieces.
COPY_BYTES = 4 * 1024 * 1024


def raw_to_wav(raw_path, wav_path, samplerate, bit_depth=16, channels=1,
               progress=None):
    """
    Wrap a raw PCM file into a .wav with a proper header.

    The raw file already holds the final bytes, in their final order, so this
    only adds the header — which is why a take interrupted by a crash can
    still be rescued, stereo or not. Copied a piece at a time: it used to be
    read whole, some 500 MB for an hour of one 24-bit track.
    """
    width = bytes_per_sample(bit_depth) * channels
    size = os.path.getsize(raw_path)
    # A take cut off mid-frame would otherwise produce a wav whose length does
    # not divide evenly, which some players refuse outright. A stereo file cut
    # between its two channels is the same problem, one sample further in.
    usable = size - (size % width)
    with open(raw_path, "rb") as rf, wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(bytes_per_sample(bit_depth))
        wf.setframerate(samplerate)
        left = usable
        while left > 0:
            # Whole frames only: wave counts frames from what it is given.
            want = min(left, COPY_BYTES - (COPY_BYTES % width))
            piece = rf.read(want)
            if not piece:
                break
            wf.writeframes(piece)
            left -= len(piece)
            if progress is not None:
                progress((usable - left) / usable)
    if progress is not None:
        progress(1.0)
```

(Keep whatever `raw_to_wav` returns today — check the rest of its body and preserve it.)

- [ ] **Step 4: Progress in `mixdown`, `encode`, `crop_wav`**

`mixdown`: add `progress=None`; in the first pass after each chunk `if progress: progress(0.5 * (start + CHUNK) / total)` clamped with `min(..., 0.5)`; in the second pass `progress(0.5 + 0.5 * min(start + CHUNK, total) / total)`.

`encode`: add `progress=None`; before the loop `total = max(1, fin.frames)`, `done = 0`; in the loop after `fout.write(block)`: `done += len(block); if progress: progress(min(1.0, done / total))`. On every return path that succeeds (including `fmt == "wav"` and the fallbacks), call `progress(1.0)` if given.

`crop_wav`: add `progress=None`; after each `fout.writeframes(...)` (head, each middle block, tail) report `written / total`, and `progress(1.0)` before the successful return.

- [ ] **Step 5: Run** the suite → `[41]` all `ok`, nothing else broken.

- [ ] **Step 6: Commit** ("Say how far along the long loops are, and copy raw files in pieces").

---

### Task 3: Crop, stop and recover register and report

**Files:**
- Modify: `src/rehearsal_recorder/audio/capture.py` (`AudioRecorder.stop(progress=None)`)
- Modify: `src/rehearsal_recorder/audio/drafts.py` (`finalize(..., progress=None)`)
- Modify: `src/rehearsal_recorder/api.py` (`_crop_tracks(..., progress=None)`, `crop_take`, `crop_draft`, `stop_take`, `recover_draft`)
- Test: `tests/test_engine.py` (`[42] Crop, stop and recover say how far along they are`)

**Interfaces:**
- Consumes: `Journal.begin/Entry.*` (Task 1); `progress=` on `raw_to_wav`, `crop_wav` (Task 2); `activity.Stages`.
- Produces: journal entries — `kind="stop"` (folder = the take's drafts folder, `take_number` = the take's number, title `Saving “<name>”`), `kind="recover"` (folder = the draft folder, `take_number=None`, title `Recovering “<draft name>”`), `kind="crop"` (folder = rehearsal folder with `take_number`, or the draft folder with `take_number=None`, title `Cropping “<name>”`).

- [ ] **Step 1: Write the failing tests** — use a recorder with the fake stream, a real draft and a real take, and a journal spy:

```python
    print("\n[42] Crop, stop and recover say how far along they are")
    _, a42 = fresh_api(Path(tempfile.mkdtemp()))
    seen42 = []
    real_begin = a42._journal.begin

    def spying_begin(kind, title, *args, **kwargs):
        entry = real_begin(kind, title, *args, **kwargs)
        real_progress = entry.progress

        def spy(fraction, step=None):
            seen42.append((kind, fraction))
            real_progress(fraction, step)

        entry.progress = spy
        return entry

    a42._journal.begin = spying_begin
    a42.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1},
                                          {"name": "Bass", "channel": 2}], 16)
    a42.start_take()
    a42._recorder._callback(np.full((256, 2), 900, dtype=np.int16), 256, None, None)
    stopped = a42.stop_take()
    kinds = {e["kind"]: e for e in a42.activity()["entries"]}
    ok("stopping a take is in the journal, finished",
       kinds.get("stop", {}).get("state") == "done"
       and "Saving" in kinds["stop"]["title"])
    ok("and said how far along it was",
       [f for k, f in seen42 if k == "stop"][-1:] == [1.0])

    seen42.clear()
    cut = a42.crop_draft(stopped["temp_dir"], stopped["tracks"], 0.001, 0.004)
    ok("cropping a take under review is in the journal",
       cut["ok"] and any(e["kind"] == "crop" and e["state"] == "done"
                         for e in a42.activity()["entries"])
       and [f for k, f in seen42 if k == "crop"][-1:] == [1.0])

    # A draft left behind by a crash, recovered.
    folder42 = Path(a42._session["folder"])
    draft = folder42 / "_drafts" / "take 9"
    draft.mkdir(parents=True)
    (draft / "Gtr.raw").write_bytes(struct.pack("<h", 700) * 4800)
    seen42.clear()
    a42.recover_draft(str(draft))
    ok("recovering a draft is in the journal",
       any(e["kind"] == "recover" and e["state"] == "done"
           for e in a42.activity()["entries"])
       and [f for k, f in seen42 if k == "recover"][-1:] == [1.0])

    # A crop that fails is in the journal as failed, with the reason.
    bad = a42.crop_take(str(folder42), 99, 0.0, 1.0)
    ok("a crop that is refused before it starts leaves no entry",
       not bad["ok"] and sum(1 for e in a42.activity()["entries"]
                             if e["kind"] == "crop") == 1)
```

- [ ] **Step 2: Run to see it fail** — no `stop` entry.

- [ ] **Step 3: Implement**

`AudioRecorder.stop(self, progress=None)`: after `_let_go()`, build `sizes = [raw_path.stat().st_size if raw_path.exists() else 0 for each track]` and `stages = Stages([(f"Track {i+1} of {n}", size) ...], lambda f, s: progress(f, s))` when `progress` is given; pass `progress=stages.part(i)` to each `raw_to_wav`. `progress` here takes `(fraction, step)`, so it is an `Entry.progress`.

`drafts.finalize(take_dir, samplerate, bit_depth=16, progress=None)`: the same over its raw files.

`Api._crop_tracks(self, tracks, start_sec, end_sec, progress=None)`: stages over tracks weighted by `wave` frames (use `drafts._wav_frames`), passing `progress=stages.part(i)` to `crop_wav`.

Each public operation opens its entry only once its own checks have passed, and closes it on every path:

```python
        entry = self._journal.begin("crop", f"Cropping “{take.get('name') or f'Take {take_number}'}”",
                                    folder, take_number)
        try:
            done = self._crop_tracks(tracks, span["start"], span["end"],
                                     progress=entry.progress)
        except Exception as e:
            entry.fail(str(e))
            raise
        if done["ok"]:
            entry.done()
        else:
            entry.fail(done["error"])
```

`crop_draft` the same with `folder=temp_dir, take_number=None` and the title from the first track's parent name; `stop_take` with `kind="stop"`, title `Saving “{suggested name}”`, folder `temp_dir`, around `recorder.stop(progress=entry.progress)`; `recover_draft` with `kind="recover"`, title `Recovering “{draft_dir.name}”`, folder `draft_dir`, around `finalize(..., progress=entry.progress)`.

- [ ] **Step 4: Run** the suite → `[42]` all `ok`.

- [ ] **Step 5: Commit** ("Crop, stop and recover say how far along they are").

---

### Task 4: Cloud copies in the background

**Files:**
- Modify: `src/rehearsal_recorder/cloud.py` (`PublishQueue`: jobs carry `what`)
- Modify: `src/rehearsal_recorder/api.py` (`share_take` → queues; body moves to `_copy_to_cloud(folder, take_number, what, progress=None)`; `_publish_step(folder, take_number, what=None)`; `_enqueue_publish`; new `retry_cloud(entry_id)`)
- Test: `tests/test_engine.py` (existing `share_take(` calls that check the copy → `_copy_to_cloud(`; `[11d]` step lambdas gain `what=None`; new `[43] Cloud copies run in the background`)

**Interfaces:**
- Consumes: Journal (Task 1); `progress=` on `mixdown`/`encode` (Task 2); `Stages`.
- Produces: `PublishQueue.enqueue(folder, take_number, what=None)`; the queue calls `step(folder, take_number, what)`; `what=None` is an automatic job. `Api.share_take(folder, take_number, what) -> {"ok": True, "queued": True, "take": take}` or the same errors as today; `Api._copy_to_cloud(...)` returns what `share_take` returned before; `Api.retry_cloud(entry_id) -> {"ok": True, "queued": True}` or `{"ok": False, "error": ...}`. Cloud entries: `kind="cloud"`, title `“<take name>” → cloud`, `detail` e.g. `"MP3 of the mix"`, `retry` = the `what` of a failed copy.

- [ ] **Step 1: Write the failing tests**

```python
    print("\n[43] Cloud copies run in the background")
    root43 = Path(tempfile.mkdtemp())
    _, a43 = fresh_api(root43)
    a43.set_cloud_dir(str(root43 / "Cloud"))
    a43.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    a43.start_take()
    a43._recorder._callback(np.full((4800, 1), 900, dtype=np.int16), 4800, None, None)
    s43 = a43.stop_take()
    a43.keep_take(s43["take_number"], s43["temp_dir"], "Polyn",
                  s43["duration_sec"], s43["tracks"])
    folder43 = a43._session["folder"]
    n43 = s43["take_number"]
    while a43._cloud_queue.run_next():
        pass
    a43.clear_activity()

    queued = a43.share_take(str(folder43), n43, "both")
    ok("sharing by hand answers at once, queued",
       queued["ok"] and queued.get("queued") is True
       and a43._cloud_queue.states(str(folder43)) == {n43: "queued"})
    entry43 = a43.activity()["entries"][0]
    ok("and is in the journal, waiting",
       entry43["kind"] == "cloud" and entry43["state"] == "waiting"
       and "Polyn" in entry43["title"])
    fractions = []
    real_step = a43._copy_to_cloud

    def watching(*args, **kwargs):
        inner = kwargs.get("progress")
        kwargs["progress"] = lambda f, s=None: (fractions.append(f), inner(f, s))
        return real_step(*args, **kwargs)

    a43._copy_to_cloud = watching
    a43._cloud_queue.run_next()
    a43._copy_to_cloud = real_step
    finished = a43.activity()["entries"][0]
    ok("it runs, rising to the end",
       fractions and fractions[-1] == 1.0 and fractions == sorted(fractions))
    ok("and says what it came to",
       finished["state"] == "done" and finished["detail"])
    ok("the take has its copies", a43._lib.take(folder43, n43)["cloud"].get("mix"))

    # Queued automatically, then by hand, before either ran: one job, doing
    # what the hand asked for.
    a43._cloud_queue.enqueue(str(folder43), n43)
    a43.share_take(str(folder43), n43, "tracks")
    ok("a manual request replaces a waiting automatic one",
       a43._cloud_queue._jobs == [[str(folder43), n43, "tracks"]]
       and sum(1 for e in a43.activity()["entries"]
               if e["state"] == "waiting") == 1)
    while a43._cloud_queue.run_next():
        pass

    # A failure: the cloud folder cannot be written. Journal and take both
    # say so; retry queues it again as a manual job.
    a43.clear_activity()
    real_copy = a43._copy_to_cloud
    a43._copy_to_cloud = lambda *a, **k: {"ok": False, "error": "The cloud folder is gone"}
    a43.share_take(str(folder43), n43, "mix")
    a43._cloud_queue.run_next()
    failed = a43.activity()["entries"][0]
    ok("a copy that fails is in the journal with why, and can be retried",
       failed["state"] == "failed" and failed["error"] == "The cloud folder is gone"
       and failed["retry"] == "mix")
    ok("and the take says so too",
       a43._lib.take(folder43, n43).get("cloud_error") == "The cloud folder is gone")
    a43._copy_to_cloud = real_copy
    again = a43.retry_cloud(failed["id"])
    ok("retry queues it again", again["ok"] and
       a43._cloud_queue._jobs == [[str(folder43), n43, "mix"]])
    a43._cloud_queue.run_next()
    ok("and a retry that works clears the failure",
       a43.activity()["entries"][0]["state"] == "done"
       and not a43._lib.take(folder43, n43).get("cloud_error"))
    ok("retrying something that is not a failed copy is refused",
       a43.retry_cloud(10_000)["ok"] is False)

    # An automatic job with nothing to do leaves no trace.
    a43.clear_activity()
    a43.set_auto_publish(True, "mix")
    a43._enqueue_publish(folder43, n43)
    a43._cloud_queue.run_next()
    ok("an automatic copy that was already current leaves no entry",
       a43.activity()["entries"] == [])

    # A take deleted while its copy waits: failed, not a dead worker.
    a43.share_take(str(folder43), n43, "mix")
    real_take = a43._lib.take
    a43._lib.take = lambda *a, **k: None
    a43._cloud_queue.run_next()
    a43._lib.take = real_take
    ok("a take gone while it waited fails with its own reason",
       a43.activity()["entries"][0]["state"] == "failed"
       and "not found" in a43.activity()["entries"][0]["error"].lower())

    # Re-queued while running: the rerun waits and the running one finishes.
    rerun_seen = []

    def requeue_mid_copy(*args, **kwargs):
        a43.share_take(str(folder43), n43, "mix")
        rerun_seen.append([e["state"] for e in a43.activity()["entries"]])
        return real_copy(*args, **kwargs)

    a43.clear_activity()
    a43._copy_to_cloud = requeue_mid_copy
    a43.share_take(str(folder43), n43, "mix")
    a43._cloud_queue.run_next()
    a43._copy_to_cloud = real_copy
    ok("a take re-queued mid-copy waits while the first copy finishes",
       rerun_seen and rerun_seen[0] == ["running", "waiting"]
       and [e["state"] for e in a43.activity()["entries"]] == ["waiting", "done"])
    while a43._cloud_queue.run_next():
        pass
```

- [ ] **Step 2: Run to see it fail** — `share_take` still copies synchronously; no `queued`.

- [ ] **Step 3: Queue jobs carry `what`** (`cloud.py`):

```python
    def enqueue(self, folder, take_number, what=None):
        """what: None for an automatic job, "mix"/"tracks"/"both" for one
        asked for by hand. A manual request for a take already waiting
        replaces what it would have done — it is the more specific."""
        folder, take_number = str(folder), int(take_number)
        with self._lock:
            for job in self._jobs:
                if job[0] == folder and job[1] == take_number:
                    if what is not None:
                        job[2] = what
                    break
            else:
                if self._active is not None and self._active[:2] == [folder, take_number]:
                    self._rerun_active = True
                    if what is not None:
                        self._rerun_what = what
                else:
                    self._jobs.append([folder, take_number, what])
        self._wake.set()
```

`states` reads `job[0], job[1]`; `run_next` pops a job list and calls `self._step(*self._active)`; a rerun re-appends `[folder, n, self._rerun_what or active_what]` and resets `_rerun_what = None`. `_active` becomes a list; compare with `[folder, n]` slices. Update the three `PublishQueue(step=lambda folder, n: ...)` lambdas in `tests/test_engine.py` (`[11d]`, and the `idle` one near line 1628) to `lambda folder, n, what=None: ...`.

- [ ] **Step 4: Split `share_take`** (`api.py`): rename the current `share_take` to `_copy_to_cloud(self, folder, take_number, what="mix", progress=None)` and thread `progress` (a `(fraction, step)` function) through: build `Stages` weighted in frames — `("Mixing", 2 * longest)` and `("Encoding the mix", longest)` when the mix is asked for and the format is not WAV (WAV encode weight 0), and `(f"Track {i} of {n}", frames_i)` for each track when tracks are asked for — and pass `progress=stages.part(k)` to `mixdown`, `encode` and to each track's `encode` (report the track part as done after its copy when the format is WAV). Every existing test call that checks the copy (`tests/test_engine.py` lines ~921, 935, 959, 1000, 1026, 1375, 1407, 1576, 1601, 1904, 2100) calls `_copy_to_cloud(` instead.

The new `share_take`:

```python
    def share_take(self, folder, take_number, what="mix"):
        """
        Puts one take on the queue to be copied into the cloud folder, and
        answers at once: what: "mix", "tracks" or "both". The copying is
        _copy_to_cloud, on the publishing thread, reported in the journal —
        see activity.py. What can be refused now is refused now.
        """
        if what not in ("mix", "tracks", "both"):
            return {"ok": False, "error": "Unknown share type"}
        if self._cloud_dir is None:
            return {"ok": False, "error": "No cloud folder chosen", "needs_dir": True}
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        take = self._lib.take(folder, take_number)
        if take is None:
            if not self._lib.has(folder):
                return {"ok": False, "error": "Rehearsal not found"}
            return {"ok": False, "error": "Take not found"}
        if not any(Path(t.get("file", "")).exists() for t in take["tracks"]):
            return {"ok": False, "error": "The take has no files left on disk"}
        self._queue_copy(folder, take_number, what, take)
        return {"ok": True, "queued": True, "take": take}

    def _queue_copy(self, folder, take_number, what, take=None):
        """The queue and the journal together: one waiting entry per take,
        however many times it is asked for."""
        key = (str(folder), int(take_number))
        with self._cloud_lock:
            if key not in self._cloud_entries:
                take = take or self._take_in(folder, take_number) or {}
                name = take.get("name") or f"Take {take_number}"
                self._cloud_entries[key] = self._journal.begin(
                    "cloud", f"“{name}” → cloud", folder, int(take_number),
                    waiting=True)
        self._cloud_queue.enqueue(str(folder), take_number, what)
```

(`self._cloud_entries = {}` and `self._cloud_lock = threading.Lock()` in `__init__`; `_enqueue_publish` ends with `self._queue_copy(folder, take_number, None, take)` instead of calling the queue directly.)

`_publish_step(self, folder, take_number, what=None)`:

```python
        key = (str(folder), int(take_number))
        with self._cloud_lock:
            entry = self._cloud_entries.pop(key, None)
        take = self._lib.take(folder, take_number)
        if entry is None:
            name = (take or {}).get("name") or f"Take {take_number}"
            entry = self._journal.begin("cloud", f"“{name}” → cloud", folder,
                                        int(take_number))
        if what is None:
            # Automatic: everything it asks today, and nothing to show for a
            # take that turns out to need nothing.
            if take is None or take.get("cloud_skip") or (
                    not self._config.get("auto_publish") and not take.get("cloud_send")):
                entry.discard()
                return
            what = self._config.get("auto_publish_what") or "mix"
            fmt = normalize_format(self._config.get("cloud_format"))
            if cloudmod.is_current(take, what, self._config.get("volumes", {}),
                                   fmt, self._cloud_target(folder)):
                entry.discard()
                return
        entry.start("Starting")
        try:
            res = self._copy_to_cloud(str(folder), take_number, what,
                                      progress=entry.progress)
        except Exception as e:
            res = {"ok": False, "error": str(e)}
        if res.get("ok"):
            entry.done(_copy_detail(what, res))
        else:
            error = res.get("error") or "Could not copy the take"
            if take is not None:
                self._record_cloud_error(folder, take_number, error)
            entry.fail(error, retry=what)
```

with a module-level helper:

```python
def _copy_detail(what, res):
    """What a finished copy came to, in words: "MP3 of the mix"."""
    shared = res.get("cloud") or {}
    fmt = (shared.get("mix_format") or shared.get("tracks_format") or "wav").upper()
    which = {"mix": "the mix", "tracks": "every track",
             "both": "the mix and every track"}[what]
    note = f" — {res['note']}" if res.get("note") else ""
    return f"{fmt} of {which}{note}"
```

`retry_cloud(self, entry_id)`:

```python
    def retry_cloud(self, entry_id):
        entry = self._journal.find(int(entry_id))
        data = entry.snapshot() if entry else None
        if not data or data["kind"] != "cloud" or data["state"] != "failed":
            return {"ok": False, "error": "Nothing to retry"}
        return self.share_take(data["folder"], data["take_number"],
                               data["retry"] or "mix")
```

- [ ] **Step 5: Run** the suite → `[43]` all `ok`, the moved `_copy_to_cloud` tests still `ok`.

- [ ] **Step 6: Commit** ("Copy to the cloud in the background, and journal every copy").

---

### Task 5: The header button, the list and the notices

**Files:**
- Create: `ui/src/lib/activity.ts`
- Create: `ui/src/components/ActivityButton.tsx`
- Modify: `ui/src/components/Shell.tsx` (render `<ActivityButton />` before `headerAction`)
- Modify: `ui/src/lib/api.ts` (`ActivityEntry`, `Activity` types; `activity`, `activity_seen`, `clear_activity`, `retry_cloud` on `PyApi`; `activity` in `Pollable` and `ANSWERS_WITH_A_VALUE`)
- Modify: `ui/src/screens/HistoryScreen.tsx` (reload the opened rehearsal when one of its cloud entries finishes)
- Test: `tests/test_interface.py` (mock `activity`, `activity_seen`, `clear_activity`, `retry_cloud`; new `[12o] Background work, from any screen`)

**Interfaces:**
- Consumes: `activity()` → `{entries, recording}` (Task 1), `retry_cloud(id)` (Task 4).
- Produces: `useActivity(): {entries: ActivityEntry[], recording: boolean}`, `setListOpen(open: boolean)`, `useRunning(kind, match?: (e) => boolean): ActivityEntry | null` from `lib/activity.ts`.

- [ ] **Step 1: Mock and failing interface test** — in the MOCK add a scriptable list:

```js
  activity: async () => ({entries: JSON.parse(JSON.stringify(window.__ACTIVITY__ || [])),
                          recording: false}),
  activity_seen: track('activity_seen', async () => {
    for (const e of (window.__ACTIVITY__ || [])) if (e.state === 'done' || e.state === 'failed') e.seen = true;
    return {ok:true}; }),
  clear_activity: track('clear_activity', async () => {
    window.__ACTIVITY__ = (window.__ACTIVITY__ || []).filter(e => e.state === 'running' || e.state === 'waiting');
    return {ok:true}; }),
  retry_cloud: track('retry_cloud', async (id) => ({ok:true, queued:true})),
```

Test section `[12o]` (new page, `window.__ACTIVITY__ = []`): no `button[aria-label^='Background work']`; set one running cloud entry `{id:1, kind:'cloud', title:'“Polyn” → cloud', folder:'/rec/X', take_number:1, state:'running', fraction:0.64, step:'Encoding the mix', error:null, detail:null, retry:null, seen:false}` → button appears with name containing "1 running"; click → list shows "Encoding the mix" and "64%"; set it `done` with `detail:'MP3 of the mix'` → a `[data-notice='done']` with "is in the cloud folder" appears and the list shows it under Done; add a failed one with `retry:'mix'` → `[data-notice='error']` with "Could not copy"; its Retry calls `retry_cloud` with its id; opening the list calls `activity_seen`; Clear calls `clear_activity` and, once nothing is left, the button goes; a later running entry brings it back.

- [ ] **Step 2: Build and run to see it fail** — `cd ui && npm run build`, `$V/bin/python tests/test_interface.py` → no button.

- [ ] **Step 3: `lib/activity.ts`**

```ts
import { useSyncExternalStore } from "react"
import { api, poll, type Activity, type ActivityEntry } from "@/lib/api"
import { notify } from "@/lib/notices"

/**
 * What long work is running and how it ended, for every screen at once: one
 * poll for the whole app, read with useActivity(). See activity.py.
 *
 * Fast while anything waits or runs or the list is open, slow otherwise —
 * slow enough to cost nothing, fast enough to notice a copy that started by
 * itself after a take was saved.
 */
export const BUSY_MS = 400
export const IDLE_MS = 2000

let current: Activity = { entries: [], recording: false }
let listOpen = false
let started = false
const known = new Map<number, ActivityEntry["state"]>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function busy() {
  return listOpen || current.entries.some((e) => e.state === "running" || e.state === "waiting")
}

/** A cloud copy that finished says so in the corner; the operations that run
 *  in place say it on their own screen. */
function announce(next: ActivityEntry[]) {
  for (const e of next) {
    const before = known.get(e.id)
    known.set(e.id, e.state)
    if (e.kind !== "cloud" || before === undefined || before === e.state) continue
    const key = `cloud:${e.folder}:${e.take_number}`
    const name = e.title.replace(/ → cloud$/, "")
    if (e.state === "done") {
      notify({ key, kind: "done", text: `${name} is in the cloud folder${e.detail ? ` — ${e.detail}` : ""}` })
    } else if (e.state === "failed") {
      notify({ key, kind: "error", text: `Could not copy ${name} to the cloud: ${e.error ?? "it failed"}` })
    }
  }
}

async function tick() {
  try {
    const next = await poll("activity")
    announce(next.entries)
    current = next
    emit()
  } catch {
    /* the bridge blinked — ask again next time */
  }
  window.setTimeout(tick, busy() ? BUSY_MS : IDLE_MS)
}

function ensureStarted() {
  if (started) return
  started = true
  void tick()
}

export function useActivity(): Activity {
  return useSyncExternalStore(
    (onChange) => {
      ensureStarted()
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => current
  )
}

export function setListOpen(open: boolean) {
  listOpen = open
  if (open) void api().activity_seen()
}

/** The running entry of this kind that `match` picks out, for a screen that
 *  shows its own operation's progress in place. */
export function useRunning(
  kind: ActivityEntry["kind"],
  match: (e: ActivityEntry) => boolean = () => true
): ActivityEntry | null {
  const { entries } = useActivity()
  return entries.find((e) => e.kind === kind && e.state === "running" && match(e)) ?? null
}
```

The first poll only records states (`known` is empty, so nothing is announced for what finished before the interface loaded).

- [ ] **Step 4: `ActivityButton.tsx`** — hidden when `entries.length === 0`; otherwise a ghost icon button in the header whose accessible name is `Background work: N running, M finished`, drawing an SVG ring filled to the mean fraction of running entries with the running count beside it, or a dot (`bg-signal` when no unseen failure, `bg-destructive` when one) when nothing runs and something is unseen. A Radix `Popover` (`import { Popover } from "radix-ui"`) opens the list; `onOpenChange` calls `setListOpen`. Content: a "Working" section (title, step or "Waiting"/"After the take", `Progress` from `components/ui/progress.tsx` with `value={fraction * 100}` and the percentage as text) and a "Done" section (✓ `Check` / ✕ `X` icons, title, detail or error, a **Retry** button on `kind === "cloud" && state === "failed"` calling `api().retry_cloud(e.id)`), then **Clear** calling `api().clear_activity()`. `onEscapeKeyDown` stops propagation so the screen's own Escape is not triggered.

- [ ] **Step 5: `Shell.tsx`** — render `<ActivityButton />` immediately before `{headerAction}`.

- [ ] **Step 6: History refresh** — in `HistoryScreen.tsx`, `const { entries } = useActivity()` and an effect that calls `reopen(opened.folder)` when an entry with `kind === "cloud"` and `folder === opened.folder` has turned `done` or `failed` since the last render (track seen ids in a `useRef<Set<number>>`).

- [ ] **Step 7: Build, run the interface suite** → `[12o]` all `ok`; the rest unchanged.

- [ ] **Step 8: Commit** ("Show background work in the header of every screen").

---

### Task 6: Progress in place, and the share dialog lets go

**Files:**
- Modify: `ui/src/screens/Recording.tsx` ("Saving the take… N%" under Stop while stopping)
- Modify: `ui/src/components/TakePlayer.tsx` (optional `status?: ReactNode` prop, rendered above the output warning)
- Modify: `ui/src/screens/Rehearsal.tsx`, `ui/src/screens/HistoryScreen.tsx`, `ui/src/screens/Review.tsx` (pass `status={<Running kind="crop" .../>}` to their `TakePlayer`)
- Create: `ui/src/components/RunningLine.tsx` (`<RunningLine entry label />`: "Cropping… 40%" with a thin `Progress`)
- Modify: `ui/src/screens/DraftsScreen.tsx` (a bar in the row being recovered)
- Modify: `ui/src/components/ShareDialog.tsx` (closes on `{ok: true, queued: true}` — it already calls `onDone(); onOpenChange(false)`; drop the per-option spinner wording that implies waiting for the copy)
- Test: `tests/test_interface.py` (`[12p] Long work shows its progress where it runs`; update `[10]` to assert the dialog is closed right after choosing)

**Interfaces:**
- Consumes: `useRunning(kind, match)` (Task 5).

- [ ] **Step 1: Failing interface tests** — with `window.__ACTIVITY__` holding a running `stop` entry at 0.45 while the mock's `stop_take` waits on `window.__HOLD_STOP__` (a promise released by the test): the Recording screen shows "Saving the take… 45%"; a running `crop` entry for the open take shows "Cropping… 40%" on the Rehearsal screen; a running `recover` entry with `folder` equal to a draft's `dir` shows a bar in that row on the Drafts screen. In `[10]`, after clicking **Both**, `page.get_by_role("dialog").count() == 0` within 400 ms.

- [ ] **Step 2: Build, run, see them fail.**

- [ ] **Step 3: Implement** — `RunningLine`:

```tsx
import { Progress } from "@/components/ui/progress"
import type { ActivityEntry } from "@/lib/api"

/** An operation's own progress, shown where it was started. */
export function RunningLine({ entry, label }: { entry: ActivityEntry | null; label: string }) {
  if (!entry) return null
  const pct = Math.round(entry.fraction * 100)
  return (
    <div role="status" className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="shrink-0">{label}… {pct}%</span>
      <Progress value={pct} className="h-1" />
    </div>
  )
}
```

Recording: `const saving = useRunning("stop")` and, when `stopping`, `<RunningLine entry={saving} label="Saving the take" />` under the Stop button (replacing nothing else). Rehearsal/History: `useRunning("crop", (e) => e.folder === <folder> && e.take_number === <take>)`. Review: `useRunning("crop", (e) => e.folder === take.temp_dir)`. Drafts: per row, `entries.find(e => e.kind === "recover" && e.state === "running" && e.folder === draft.dir)`.

- [ ] **Step 4: Build, run the interface suite** → `[12p]` and `[10]` `ok`.

- [ ] **Step 5: Commit** ("Show long work's progress where it runs; the share dialog lets go at once").

---

### Task 7: Documentation and the whole suite

**Files:**
- Modify: `CHANGELOG.md` (Unreleased)
- Modify: `docs/using-it.md` (the cloud section: copies run in the background, the header button)
- Modify: `docs/design-notes.md` (a paragraph on the journal)

- [ ] **Step 1: CHANGELOG** — under `## Unreleased`:

```markdown
- Long work says how far along it is and how it ended, on every screen. A
  button in the header shows what is running — a cloud copy, a crop, a take
  being saved or recovered — with a bar each, and what has finished, with
  Retry on a copy that failed. Copying a take to the cloud by hand now runs in
  the background like the automatic copies: the dialog closes at once, and
  the corner says when the copy is there, or why it is not.
- Saving a stopped take no longer reads each track into memory whole.
```

- [ ] **Step 2: using-it.md and design-notes.md** — a short paragraph each, in the documents' own voice, on the button and on `activity.py`.

- [ ] **Step 3: Whole suite** — `$V/bin/python tests/test_engine.py`, `tests/test_platform.py`, `tests/test_store.py`, `cd ui && npm run build`, `tests/test_interface.py`; `PYTHONPATH=src $V/bin/python -m rehearsal_recorder --selftest`; `ruff check` on changed Python files compared with the previous commit; `npx oxlint` on changed UI files.

- [ ] **Step 4: Commit** ("Close the documentation for background work").
