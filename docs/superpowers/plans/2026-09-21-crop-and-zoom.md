# Cropping a Take and Zooming the Timeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the A–B region trim a take down to itself, and let the wheel zoom the timeline so that region can be placed accurately.

**Architecture:** Two features against the same component. Cropping is a new
`audio/crop.py` that only ever writes, wrapped by `crop_take` / `crop_draft` in
`api.py`, which move the originals to the Trash as one folder and fix up the
metadata. Zoom is a view window `[from, to]` living in `useMultitrackPlayer`
beside `region`; `Timeline` already funnels every time-to-pixel decision through
`pct()` and `secondsAt()`, so the window goes into those two functions and the
ruler, markers, region band and playhead follow.

**Tech Stack:** Python 3 (numpy, `wave`, no new dependencies), React 19 +
TypeScript + Tailwind, Playwright for the interface suite.

**Spec:** `docs/superpowers/specs/2026-09-21-crop-and-zoom-design.md`

## Global Constraints

- `MIN_CROP_SEC = 1.0` — a region shorter than this is refused, in the
  interface and in Python independently.
- `DEFAULT_FADE_SEC = 0.005` — a 5 ms ramp at each edge that is really a cut,
  and none at an edge that coincides with the file's own start or end.
- A marker is kept when `start <= at <= end`, and is then shifted by `−start`.
- The originals of a crop leave as **one** folder, `<take dir> (before crop)`,
  made unique with `_unique_path`, sent to the Trash with
  `move_to_trash(path, self._recordings_dir)`.
- Cropping closes the player first. Tracks are played through `numpy.memmap`
  and Windows will not rename a mapped file; macOS will, which is how this
  reaches a Windows rehearsal unnoticed.
- Cropping clears the take's cloud record (`_remove_shared`, then
  `take["cloud"] = {}`). The fingerprint in `cloud.source_of` has no length in
  it, so a cropped take would otherwise match it forever.
- `MIN_VIEW_SEC = 2` — the shortest visible window.
- `PEAKS_SETTLE_MS = 150` — how long after the last wheel event the sharper
  peaks are fetched.
- `WHOLE_TAKE_SLACK_SEC = 0.05` — a region within this of covering the whole
  take has nothing to crop, so the button is disabled.
- `wav_peaks` keeps returning the **file's own** frame count as its second
  value, never the window's. `take_media` derives `duration_sec` from it, and
  the player's duration must not change when the view does.
- There is no pytest in this project. Suites are plain scripts using a local
  `ok(label, cond)`; run everything with `python3 tests/run_all.py` from the
  repository root. Use `python3` directly — there is no venv to activate.
- `tests/test_interface.py` drives the **built** interface, so
  `cd ui && npm run build` before running it.
- Any new mock handler in `tests/test_interface.py` that hands back state the
  interface keeps must return `JSON.parse(JSON.stringify(...))`. The real
  bridge serialises through JSON; a mock that hands back a live object hides
  exactly the class of bug that deep copy exists to expose.

---

### Task 1: Cutting a wav down to a range

**Files:**
- Create: `src/rehearsal_recorder/audio/crop.py`
- Test: `tests/test_engine.py` (new section `[18]`, appended before the
  `print("\n" + "=" * 60)` line that closes `main()`)

**Interfaces:**
- Consumes: `unpack24`, `pack24` from `rehearsal_recorder.audio.format`.
- Produces: `crop_wav(src, dst, start_sec, end_sec, fade_sec=DEFAULT_FADE_SEC)`
  returning `{"ok": True, "frames": int, "samplerate": int}` or
  `{"ok": False, "error": str}`; module constants `BLOCK_FRAMES`,
  `DEFAULT_FADE_SEC`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_engine.py`, immediately before the closing
`print("\n" + "=" * 60)` in `main()`:

```python
    print("\n[18] Cutting a wav down to a range")
    # The one operation under a crop: write the part worth keeping. Moving the
    # original out of the way is the caller's job — in this app, the Trash.
    from rehearsal_recorder.audio.crop import crop_wav

    def wav_frames(path):
        with wave.open(str(path)) as w:
            return w.getnframes()

    def wav_samples(path):
        """Every sample of a mono wav, at its own scale."""
        with wave.open(str(path)) as w:
            frames, width = w.getnframes(), w.getsampwidth()
            raw = w.readframes(frames)
        if width == 2:
            return list(struct.unpack("<%dh" % frames, raw))
        return [int.from_bytes(raw[i * 3:i * 3 + 3], "little", signed=True)
                for i in range(frames)]

    tmp6 = Path(tempfile.mkdtemp())
    write_wav(tmp6 / "long.wav", 1000, seconds=2.0)

    cut = crop_wav(tmp6 / "long.wav", tmp6 / "cut.wav", 0.5, 1.5)
    ok("a crop says how much it kept", cut["ok"] and cut["frames"] == SR)
    with wave.open(str(tmp6 / "cut.wav")) as w:
        ok("and writes exactly that",
           w.getnframes() == SR and w.getframerate() == SR
           and w.getsampwidth() == 2 and w.getnchannels() == 1)

    middle = wav_samples(tmp6 / "cut.wav")
    ok("the audio between the cuts is untouched", middle[SR // 2] == 1000)
    # A cut lands on whatever sample was there, and a non-zero sample at the
    # edge of a file is a click.
    ok("but each cut edge is ramped rather than stepped",
       middle[0] == 0 and abs(middle[-1]) < 50)

    head = crop_wav(tmp6 / "long.wav", tmp6 / "head.wav", 0.0, 1.0)
    ok("a region that starts at the beginning keeps the original attack",
       head["ok"] and wav_samples(tmp6 / "head.wav")[0] == 1000)

    write_wav(tmp6 / "deep.wav", 1000, seconds=1.0, depth=24)
    deep = crop_wav(tmp6 / "deep.wav", tmp6 / "deepcut.wav", 0.25, 0.75)
    with wave.open(str(tmp6 / "deepcut.wav")) as w:
        ok("24-bit comes out 24-bit",
           deep["ok"] and w.getsampwidth() == 3 and w.getnframes() == SR // 2)
    ok("and its samples come through whole",
       wav_samples(tmp6 / "deepcut.wav")[SR // 4] == 1000 * 256)

    past = crop_wav(tmp6 / "long.wav", tmp6 / "nothing.wav", 5.0, 6.0)
    ok("a range past the end of the file is refused", not past["ok"])
    ok("and leaves nothing behind when it is",
       not (tmp6 / "nothing.wav").exists())
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 tests/test_engine.py`
Expected: `ModuleNotFoundError: No module named 'rehearsal_recorder.audio.crop'`

- [ ] **Step 3: Write the module**

Create `src/rehearsal_recorder/audio/crop.py`:

```python
"""
Cutting a take down to the part that is music.

A take is often nine minutes of which three are playing: somebody walking back
to the kit, a false start, the silence after everyone stopped. This writes the
part worth keeping, and only ever writes — moving the original out of the way
is the caller's job, and in this app that means the Trash.

Frames are copied a block at a time, so a twenty-minute source costs the same
memory as a short one: the same care taken in mixdown and encode.
"""

import wave
from pathlib import Path

import numpy as np

from rehearsal_recorder.audio.format import pack24, unpack24

# Frames per block. Big enough that the per-call overhead disappears, small
# enough that memory does not grow with the length of a take.
BLOCK_FRAMES = 1 << 16

# A cut lands on whatever sample happened to be there, and a non-zero sample
# at the edge of a file is a click. A few milliseconds of ramp removes it
# without being audible as a fade.
DEFAULT_FADE_SEC = 0.005


def _faded(raw, ramp, sampwidth, channels):
    """One block of frames with `ramp` — one value per frame — applied."""
    per_sample = np.repeat(ramp, channels)
    if sampwidth == 2:
        arr = np.frombuffer(raw, dtype="<i2").astype(np.float32)
        return np.clip(
            np.rint(arr * per_sample), -32768, 32767
        ).astype("<i2").tobytes()

    # 24-bit: unpack to signed ints, scale, and pack the top three bytes back.
    # pack24 wants the sample left-justified in an int32, which is what the
    # shift below restores after unpack24 gave us the plain value.
    packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
    whole = np.zeros(packed.shape[0], dtype=np.int32)
    unpack24(np.ascontiguousarray(packed), whole)
    scaled = np.clip(
        np.rint(whole.astype(np.float32) * per_sample),
        -(1 << 23), (1 << 23) - 1,
    ).astype(np.int32)
    out = np.zeros((scaled.size, 3), dtype=np.uint8)
    pack24(scaled << 8, out)
    return out.tobytes()


def crop_wav(src, dst, start_sec, end_sec, fade_sec=DEFAULT_FADE_SEC):
    """
    Writes frames [start, end) of src into dst, keeping the sample rate, bit
    depth and channel count it found.

    A ramp is applied at each edge that is really a cut: a region starting at
    the beginning of the file keeps the original attack, and one ending at its
    end keeps the original decay.

    Returns {"ok", "frames", "samplerate"}, or {"ok": False, "error"}.
    """
    src = Path(src)
    dst = Path(dst)
    try:
        with wave.open(str(src), "rb") as fin:
            frames = fin.getnframes()
            rate = fin.getframerate()
            channels = fin.getnchannels()
            sampwidth = fin.getsampwidth()

            if sampwidth not in (2, 3):
                return {"ok": False, "error":
                        f"{src.name}: expected 16- or 24-bit, "
                        f"got {sampwidth * 8}"}
            if rate <= 0:
                return {"ok": False, "error": f"{src.name}: no sample rate"}

            start = max(0, min(frames, int(round(float(start_sec) * rate))))
            end = max(start, min(frames, int(round(float(end_sec) * rate))))
            total = end - start
            if total == 0:
                return {"ok": False,
                        "error": f"{src.name}: nothing in that range"}

            # Only where the file is really being cut.
            fade = max(0, int(round(float(fade_sec) * rate)))
            head = min(fade, total // 2) if start > 0 else 0
            tail = min(fade, total - head) if end < frames else 0
            middle = total - head - tail

            fin.setpos(start)
            dst.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(dst), "wb") as fout:
                fout.setnchannels(channels)
                fout.setsampwidth(sampwidth)
                fout.setframerate(rate)

                if head:
                    ramp = np.linspace(0.0, 1.0, head, endpoint=False,
                                       dtype=np.float32)
                    fout.writeframes(
                        _faded(fin.readframes(head), ramp, sampwidth, channels)
                    )

                left = middle
                while left > 0:
                    want = min(BLOCK_FRAMES, left)
                    block = fin.readframes(want)
                    if not block:
                        break
                    fout.writeframes(block)
                    left -= want

                if tail:
                    ramp = np.linspace(1.0, 0.0, tail, endpoint=False,
                                       dtype=np.float32)
                    fout.writeframes(
                        _faded(fin.readframes(tail), ramp, sampwidth, channels)
                    )
    except (OSError, ValueError, wave.Error) as e:
        dst.unlink(missing_ok=True)
        return {"ok": False, "error": f"{src.name}: {e}"}

    return {"ok": True, "frames": total, "samplerate": rate}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `python3 tests/test_engine.py`
Expected: section `[18]` prints only `ok` lines, and the script ends with
`Python side: all checks passed.`

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/audio/crop.py tests/test_engine.py
git commit -m "Cut a wav down to a range, ramped at the edges that are cuts"
```

---

### Task 2: crop_take and crop_draft

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (imports near line 45; a
  `MIN_CROP_SEC` constant beside `LOW_SPACE_MINUTES`; three methods added
  after `remove_take_marker`/`_update_markers`, before the `player_open`
  block)
- Test: `tests/test_engine.py` (new section `[19]`, after `[18]`)

**Interfaces:**
- Consumes: `crop_wav` from Task 1; existing `_writing_path`, `_unique_path`,
  `_inside_recordings`, `_read_meta`, `_write_meta`, `_meta_lock`,
  `_markers_of`, `_remove_shared`, `_enqueue_publish`,
  `_retry_failed_publishes`, `player_close`, `move_to_trash`.
- Produces:
  `crop_take(folder, take_number, start_sec, end_sec)` →
  `{"ok": True, "take": dict, "trashed": bool, "location": str|None, "markers_dropped": int}`;
  `crop_draft(temp_dir, tracks, start_sec, end_sec)` →
  `{"ok": True, "tracks": list, "duration_sec": float, "trashed": bool, "location": str|None}`;
  both `{"ok": False, "error": str}` on refusal.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_engine.py` after section `[18]`:

```python
    print("\n[19] Cropping a take to the region")
    tmp7 = Path(tempfile.mkdtemp())
    apimod7, c = fresh_api(tmp7)
    c.start_rehearsal("Cutting", None, SR,
                      [{"name": "Gtr", "channel": 1},
                       {"name": "Bass", "channel": 2}], 16)
    draft = Path(c._session["folder"]) / "_drafts" / "take 1"
    write_wav(draft / "Gtr.wav", 1000, seconds=4.0)
    write_wav(draft / "Bass.wav", 2000, seconds=4.0)
    saved = c.keep_take(
        1, str(draft), "Polyn", 4.0,
        [{"name": "Gtr", "file": str(draft / "Gtr.wav")},
         {"name": "Bass", "file": str(draft / "Bass.wav")}],
        [{"at": 0.5, "note": "count-in", "kind": "note"},
         {"at": 2.0, "note": "here", "kind": "good"},
         {"at": 3.8, "note": "stopped", "kind": "bad"}],
    )
    folder = str(c._session["folder"])
    take_dir = Path(saved["take"]["tracks"][0]["file"]).parent

    # The player holds every track through a memmap, and Windows will not
    # rename a mapped file — so cropping has to let go of them first.
    c.player_open(saved["take"]["tracks"])
    ok("a take can be open in the player", c.player_state().get("open") is True)

    res = c.crop_take(folder, 1, 1.0, 3.0)
    ok("cropping says what it kept",
       res["ok"] and abs(res["take"]["duration_sec"] - 2.0) < 0.01)
    ok("and let go of the files before rewriting them",
       c.player_state().get("open") is not True)
    ok("every track is the region now",
       all(wav_frames(t["file"]) == 2 * SR for t in res["take"]["tracks"]))
    ok("the markers move with the audio they pointed at",
       [m["at"] for m in res["take"]["markers"]] == [1.0])
    ok("and the ones outside it are counted, not silently dropped",
       res["markers_dropped"] == 2)
    ok("the originals leave as one folder, not eight loose files",
       res["trashed"] is True
       or Path(res["location"] or "").name.endswith("(before crop)"))
    ok("and the take folder is left with only its tracks",
       sorted(p.name for p in take_dir.iterdir()) == ["Bass.wav", "Gtr.wav"])

    # The cloud fingerprint records the name, format, folder and balance —
    # never the length. A cropped take would go on matching it, and the
    # uncropped copy would stay in the cloud folder as the copy of record.
    c.set_cloud_dir(str(tmp7 / "Cloud"))
    c.share_take(folder, 1, "mix")
    ok("a shared take knows where its copy is",
       bool((c.session_state()["takes"][0].get("cloud") or {}).get("mix")))
    c.crop_take(folder, 1, 0.25, 1.75)
    ok("cropping forgets a copy that is now of a different take",
       not (c.session_state()["takes"][0].get("cloud") or {}).get("mix"))

    ok("a region shorter than a second is refused",
       not c.crop_take(folder, 1, 0.1, 0.4)["ok"])
    ok("and a folder outside the recordings directory is refused",
       not c.crop_take(str(tmp7 / "elsewhere"), 1, 0.0, 2.0)["ok"])

    # Nothing is replaced until every new file exists, so a track that cannot
    # be read costs the crop and nothing else.
    (take_dir / "Bass.wav").write_bytes(b"not a wav at all")
    broken = c.crop_take(folder, 1, 0.25, 1.5)
    ok("one unreadable track stops the whole crop", not broken["ok"])
    ok("and leaves no half-written files behind",
       not any(p.name.startswith(".writing-") for p in take_dir.iterdir()))
    ok("with the other track still where it was",
       wav_frames(take_dir / "Gtr.wav") > 0)

    # A take on the review screen is a proper wav already; it just has no
    # entry in session.json yet.
    draft2 = Path(c._session["folder"]) / "_drafts" / "take 2"
    write_wav(draft2 / "Gtr.wav", 1000, seconds=4.0)
    pending = [{"name": "Gtr", "file": str(draft2 / "Gtr.wav")}]
    early = c.crop_draft(str(draft2), pending, 1.0, 3.0)
    ok("a take can be cropped before it is ever saved",
       early["ok"] and abs(early["duration_sec"] - 2.0) < 0.01)
    ok("in place, so saving it afterwards needs no new paths",
       wav_frames(draft2 / "Gtr.wav") == 2 * SR
       and early["tracks"][0]["file"] == str(draft2 / "Gtr.wav"))
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 tests/test_engine.py`
Expected: `AttributeError: 'Api' object has no attribute 'crop_take'`

- [ ] **Step 3: Add the constant and the import**

In `src/rehearsal_recorder/api.py`, beside the other audio imports (the block
that already imports `mixdown`):

```python
from rehearsal_recorder.audio.crop import crop_wav
```

And beside `LOW_SPACE_MINUTES`:

```python
# A region shorter than this is a slip of the mouse, not an intention.
MIN_CROP_SEC = 1.0
```

- [ ] **Step 4: Write the three methods**

Add to the `Api` class, after `_update_markers` and before the
`# ---------- playback ----------` block that holds `player_open`:

```python
    # ---------- cropping ----------

    @staticmethod
    def _crop_span(duration_sec, start_sec, end_sec):
        """The region to keep, or why it cannot be kept."""
        try:
            start = max(0.0, float(start_sec))
            end = float(end_sec)
        except (TypeError, ValueError):
            return {"error": "That is not a region"}
        if duration_sec:
            end = min(float(duration_sec), end)
        if end - start < MIN_CROP_SEC:
            return {"error":
                    f"A take has to keep at least {MIN_CROP_SEC:g} second"}
        return {"start": start, "end": end}

    def _crop_tracks(self, tracks, start_sec, end_sec):
        """
        Rewrites every track shorter and puts the originals in the Trash as
        one folder named after the take — what turns up there is then a
        recognisable thing rather than eight loose files called Gtr.wav.

        The order matters, because the app can be killed in the middle of it.
        Every new file is written under WRITING_PREFIX first, so nothing is
        replaced until all of them exist; then the originals move aside
        together; then the new files take their names; then the folder of
        originals goes. Die between those last two and the take folder holds
        obviously-unfinished files with the originals in a folder beside it —
        repairable by hand, which is the most a step that moves files can
        promise.
        """
        take_dir = Path(tracks[0]["file"]).parent
        written = []
        for t in tracks:
            source = Path(t["file"])
            target = _writing_path(source)
            res = crop_wav(source, target, start_sec, end_sec)
            if not res["ok"]:
                target.unlink(missing_ok=True)
                for w in written:
                    w.unlink(missing_ok=True)
                return {"ok": False, "error": res["error"]}
            written.append(target)

        aside = _unique_path(take_dir.with_name(f"{take_dir.name} (before crop)"))
        try:
            aside.mkdir(parents=True)
            for t in tracks:
                source = Path(t["file"])
                shutil.move(str(source), str(aside / source.name))
            for t, target in zip(tracks, written):
                os.replace(target, Path(t["file"]))
        except OSError as e:
            return {"ok": False, "error": f"Could not replace the tracks: {e}"}

        gone = move_to_trash(aside, self._recordings_dir)
        return {
            "ok": True,
            "duration_sec": end_sec - start_sec,
            "trashed": bool(gone.get("trashed")),
            "location": gone.get("location"),
        }

    def crop_take(self, folder, take_number, start_sec, end_sec):
        """
        Keeps only [start, end) of a saved take. The take keeps its number,
        its name and its folder: from the outside it is the same take, shorter.
        """
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        # _meta_lock then _player_lock, and never the other way round — this
        # is the only place that takes both.
        with self._meta_lock:
            meta = self._read_meta(folder)
            if meta is None:
                return {"ok": False, "error": "Rehearsal not found"}
            take = next(
                (t for t in meta.get("takes", [])
                 if t.get("take_number") == take_number),
                None,
            )
            if take is None:
                return {"ok": False, "error": "Take not found"}

            tracks = [t for t in take.get("tracks", [])
                      if Path(t.get("file", "")).exists()]
            if not tracks:
                return {"ok": False, "error": "The take has no files left on disk"}

            span = self._crop_span(take.get("duration_sec", 0), start_sec, end_sec)
            if "error" in span:
                return {"ok": False, "error": span["error"]}

            # Tracks are played through a memmap, and Windows will not let a
            # mapped file be renamed or removed. macOS will, which is exactly
            # how this would have reached a Windows rehearsal unnoticed.
            self.player_close()

            done = self._crop_tracks(tracks, span["start"], span["end"])
            if not done["ok"]:
                return done

            kept, dropped = [], 0
            for m in self._markers_of(take):
                if span["start"] <= m["at"] <= span["end"]:
                    kept.append({**m, "at": round(m["at"] - span["start"], 2)})
                else:
                    dropped += 1
            take["markers"] = kept
            take["duration_sec"] = done["duration_sec"]

            # The fingerprint in cloud.source_of records what was asked for,
            # the name, the format, the folder and the balance — there is no
            # length in it. A cropped take would go on matching it, and
            # auto-publish would skip it for good, leaving the uncropped
            # version in the cloud folder as the copy of record.
            self._remove_shared(take)
            take["cloud"] = {}
            take.pop("cloud_error", None)

            self._write_meta(folder, meta)
            if self._session is not None and Path(self._session["folder"]) == folder:
                self._session["takes"] = meta.get("takes", [])

        self._enqueue_publish(folder, take_number)
        self._retry_failed_publishes()
        return {
            "ok": True,
            "take": take,
            "trashed": done["trashed"],
            "location": done["location"],
            "markers_dropped": dropped,
        }

    def crop_draft(self, temp_dir, tracks, start_sec, end_sec):
        """
        The same cut, one folder over. A take that has been stopped is proper
        .wav already — capture wraps the raw PCM on stop — it just has no
        entry in session.json yet, so there is nothing here to fix up. The
        files keep their paths, so the caller saves the take as it would have.
        """
        temp_dir = Path(temp_dir)
        if not self._inside_recordings(temp_dir):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        live = [t for t in (tracks or []) if Path(t.get("file", "")).exists()]
        if not live:
            return {"ok": False, "error": "The take has no files left on disk"}

        span = self._crop_span(0, start_sec, end_sec)
        if "error" in span:
            return {"ok": False, "error": span["error"]}

        self.player_close()
        done = self._crop_tracks(live, span["start"], span["end"])
        if not done["ok"]:
            return done
        return {
            "ok": True,
            "tracks": live,
            "duration_sec": done["duration_sec"],
            "trashed": done["trashed"],
            "location": done["location"],
        }
```

- [ ] **Step 5: Run it and watch it pass**

Run: `python3 tests/test_engine.py`
Expected: sections `[18]` and `[19]` all `ok`, script ends with
`Python side: all checks passed.`

- [ ] **Step 6: Commit**

```bash
git add src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "Crop a take to its region, with the originals going to the Trash"
```

---

### Task 3: Cropping from the player

**Files:**
- Modify: `ui/src/lib/api.ts` (add two methods to the `PyApi` interface, beside
  `discard_take`)
- Modify: `ui/src/components/TakePlayer.tsx` (Crop button in `Transport`, the
  confirmation in `TakePlayer`)
- Modify: `ui/src/screens/Rehearsal.tsx`, `ui/src/screens/HistoryScreen.tsx`,
  `ui/src/screens/Review.tsx`, `ui/src/App.tsx`
- Test: `tests/test_interface.py` (mock handlers; a block in section `[6]`;
  new section `[9e]`)

**Interfaces:**
- Consumes: `crop_take` / `crop_draft` from Task 2.
- Produces: `TakePlayer` prop `onCrop?: (startSec: number, endSec: number) => void`;
  `Review` prop `onCropped: (take: PendingTake) => void`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_interface.py`, add to the mock object, immediately after the
`discard_take:` line:

```js
  crop_take: track('crop_take', async (folder, n, a, b) => {
    const take = (session ? session.takes : []).find(t => t.take_number === n);
    if (!take) return {ok:false, error:'Take not found'};
    let dropped = 0;
    take.markers = (take.markers || [])
      .filter(m => { const keep = m.at >= a && m.at <= b; if (!keep) dropped++; return keep; })
      .map(m => ({...m, at: Math.round((m.at - a) * 100) / 100}));
    take.duration_sec = b - a;
    // A rewritten file is a different file as far as the player is
    // concerned, and the mock looks lengths up by path, so give it one.
    take.tracks = take.tracks.map(t => ({...t, file: t.file + '#' + Math.round(a * 100)}));
    for (const t of take.tracks) fileDurations[t.file] = take.duration_sec;
    P = null;   // Python lets go of the files before rewriting them
    // Deep copy, same as rename_take — a live handle would let the interface
    // alias the mock's own state, which the real bridge never allows.
    return JSON.parse(JSON.stringify(
      {ok:true, take, trashed:true, location:null, markers_dropped:dropped}));
  }),
  crop_draft: track('crop_draft', async (dir, tracks, a, b) => {
    const cut = (tracks || []).map(t => ({...t, file: t.file + '#' + Math.round(a * 100)}));
    for (const t of cut) fileDurations[t.file] = b - a;
    P = null;
    return JSON.parse(JSON.stringify(
      {ok:true, tracks:cut, duration_sec: b - a, trashed:true, location:null}));
  }),
```

Add a module-level helper next to `TAKE_SECONDS`, so both crop checks can draw
a region without copying the gesture:

```python
def drag_region(page, from_ratio, to_ratio):
    """Draw a region across the timeline, the way a person does."""
    box = page.get_by_role("group", name="Take timeline").bounding_box()
    y = box["y"] + box["height"] / 2
    page.mouse.move(box["x"] + box["width"] * from_ratio, y)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] * to_ratio, y, steps=10)
    page.mouse.up()
    page.wait_for_timeout(250)
```

In section `[6]`, insert this **before** the `page.fill("#take-name", "Polyn")`
that precedes the blur-and-Space that saves take 1 — that is, while the first
recorded take is still on the review screen:

```python
        # The dead air at the start of a take is visible on the waveform the
        # moment you stop recording, which makes this the screen where
        # trimming is most obviously wanted. Take 1 is cropped here and is
        # not opened again by any later section; takes 2 onward keep their
        # full length, which the region checks in [9] depend on.
        page.wait_for_selector("button[aria-label='Crop to the region']", state="hidden")
        ok("with no region there is nothing to crop to",
           page.locator("button[aria-label='Crop to the region']").count() == 0)
        drag_region(page, 0.25, 0.75)
        page.click("button[aria-label='Crop to the region']")
        page.wait_for_selector("text=Keep only")
        page.get_by_role("button", name="Crop", exact=True).click()
        page.wait_for_timeout(600)
        cut = calls("crop_draft")
        ok("a take can be trimmed before it is ever saved",
           len(cut) == 1
           and abs(cut[0]["args"][2] - TAKE_SECONDS * 0.25) < 0.4
           and abs(cut[0]["args"][3] - TAKE_SECONDS * 0.75) < 0.4)
        ok("and the take on screen is that region now",
           page.locator("span", has_text="/ 0:03").count() >= 1)
```

Add a new section immediately after the `page.screenshot(path=str(SHOTS /
"54-player.png"))` line that ends section `[9]`, before `print("\n[10] ...")`.
Tasks 5 and 6 later insert their sections into the gap this leaves above it,
so this one is numbered `[9e]` even though nothing sits between yet:

```python
        print("\n[9e] Cropping a take to the region")
        # The region drove one thing until now. Trimming the take to it is the
        # other, and it is what makes a nine-minute take that holds three
        # minutes of music into a three-minute take.
        # A region that is the whole take has nothing to remove, so the button
        # is there but will not do anything.
        drag_region(page, 0.0, 1.0)
        ok("a region covering the whole take offers no crop",
           page.get_by_role("button", name="Crop to the region").is_disabled())

        drag_region(page, 0.25, 0.75)
        crop = page.get_by_role("button", name="Crop to the region")
        ok("a region offers to trim the take to itself", crop.count() == 1)
        crop.click()
        page.wait_for_selector("text=Keep only")
        asked = page.locator("[role=dialog]").inner_text()
        ok("the question names the part being kept", "Keep only 0:01" in asked)
        ok("and says where what it removes is going",
           "Trash" in asked or "_deleted" in asked)
        page.get_by_role("button", name="Crop", exact=True).click()
        page.wait_for_timeout(700)
        cropped = calls("crop_take")
        ok("cropping reached Python with the region",
           len(cropped) == 1
           and abs(cropped[0]["args"][2] - TAKE_SECONDS * 0.25) < 0.4
           and abs(cropped[0]["args"][3] - TAKE_SECONDS * 0.75) < 0.4)
        ok("the take is the region now — three seconds, not six",
           page.locator("span", has_text="/ 0:03").count() >= 1)
        ok("and the region is cleared, because the take is that region",
           page.locator("button", has_text="A 0:").count() == 0)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npm run build && cd .. && python3 tests/test_interface.py`
Expected: FAIL at `page.click("button[aria-label='Crop to the region']")` —
the button does not exist.

- [ ] **Step 3: Add the two bridge methods**

In `ui/src/lib/api.ts`, in the `PyApi` interface right after
`discard_take(tempDir: string): Promise<Ok>`:

```ts
  /** Keep only [startSec, endSec) of a saved take; the rest goes to the Trash. */
  crop_take(
    folder: string,
    takeNumber: number,
    startSec: number,
    endSec: number
  ): Promise<Ok<{ take?: Take; markers_dropped?: number }>>
  /** The same, for a take that is still on the review screen. */
  crop_draft(
    tempDir: string,
    tracks: TrackFile[],
    startSec: number,
    endSec: number
  ): Promise<Ok<{ tracks?: TrackFile[]; duration_sec?: number }>>
```

- [ ] **Step 4: Put the button and the question on the player**

In `ui/src/components/TakePlayer.tsx`:

Add `Scissors` to the `lucide-react` import, add `useState` to the `react`
import (the file currently imports no hooks — add `import { useState } from
"react"` as the first line), and add these imports:

```ts
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { canBePutBack, goesTo } from "@/lib/deletion"
```

Add beside `SKIP_SECONDS`:

```ts
/** A region shorter than this is a slip of the mouse, not an intention. */
const MIN_CROP_SEC = 1
/** A region this close to covering the whole take has nothing to remove. */
const WHOLE_TAKE_SLACK_SEC = 0.05
```

Add `onCrop` to `TakePlayer`'s props and type:

```ts
  /** Trim the take down to the region. Absent where that is not offered. */
  onCrop?: (startSec: number, endSec: number) => void
```

Inside `TakePlayer`, above the `return`:

```tsx
  const [cropping, setCropping] = useState(false)
  // The same rule the timeline draws by: one end set reaches to the take's
  // own start or end.
  const { region, duration } = player
  const band =
    region.a !== null || region.b !== null
      ? { a: region.a ?? 0, b: region.b ?? duration }
      : null
  const lost = band ? duration - (band.b - band.a) : 0
  const lostMarkers = band
    ? markers.filter((m) => m.at < band.a || m.at > band.b).length
    : 0
```

Pass the button's own enablement down to `Transport` by giving it two more
props — add to its parameter list and type. The name differs from
`TakePlayer`'s `onCrop` on purpose: that one carries the region, this one only
opens the question.

```ts
  onCropClick?: () => void
  canCrop?: boolean
```

and render it in `Transport` immediately after the clear-region button, inside
the same `{(player.region.a !== null || player.region.b !== null) && (...)}`
guard — change that guard to a fragment holding both:

```tsx
        {(player.region.a !== null || player.region.b !== null) && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={player.clearRegion}
              aria-label="Clear A and B"
              title="Clear the region — repeat will loop the whole take"
            >
              <X />
            </Button>
            {onCropClick && (
              <Button
                variant="outline"
                size="sm"
                onClick={onCropClick}
                disabled={player.loading || !canCrop}
                aria-label="Crop to the region"
                title={
                  canCrop
                    ? "Keep only this part of the take"
                    : "Mark a shorter part of the take to keep"
                }
              >
                <Scissors />
                Crop
              </Button>
            )}
          </>
        )}
```

Pass them from `TakePlayer` where it renders `<Transport ... />`:

```tsx
        onCropClick={onCrop ? () => setCropping(true) : undefined}
        canCrop={
          band !== null &&
          band.b - band.a >= MIN_CROP_SEC &&
          lost > WHOLE_TAKE_SLACK_SEC
        }
```

And add the dialog as the last child of `TakePlayer`'s outer `<div>`:

```tsx
      <ConfirmDialog
        open={cropping}
        onOpenChange={setCropping}
        title={
          band
            ? `Keep only ${formatMMSS(band.a)} – ${formatMMSS(band.b)}?`
            : "Keep only this part?"
        }
        description={`The rest of the take — ${formatMMSS(lost)} — ${goesTo()}${
          lostMarkers > 0
            ? `, and ${lostMarkers} ${
                lostMarkers === 1 ? "marker" : "markers"
              } outside it go with it`
            : ""
        }. ${canBePutBack()}`}
        confirmLabel="Crop"
        cancelLabel="Keep it all"
        onConfirm={() => band && onCrop?.(band.a, band.b)}
      />
```

- [ ] **Step 5: Wire the three screens**

`ui/src/screens/Rehearsal.tsx` — add beside `renameTake`:

```tsx
  // Python let go of the files before rewriting them, so the take has to be
  // opened again; the fresh `tracks` array is what tells the player that.
  const cropTake = async (take: Take, from: number, to: number) => {
    const res = await api().crop_take(session.folder, take.take_number, from, to)
    if (!res.ok) {
      setError(res.error ?? "Could not crop the take")
      return
    }
    if (res.take) reselect(res.take)
    onChanged()
  }
```

and add to the `<TakePlayer ... />`:

```tsx
            onCrop={(from, to) => void cropTake(selected, from, to)}
```

`ui/src/screens/HistoryScreen.tsx` — add beside its `renameTake`:

```tsx
  const cropTake = async (take: Take, from: number, to: number) => {
    if (!opened) return
    const res = await api().crop_take(opened.folder, take.take_number, from, to)
    if (!res.ok) {
      setError(res.error ?? "Could not crop the take")
      return
    }
    if (res.take) reselect(res.take)
    await reopen(opened.folder)
  }
```

and to its `<TakePlayer ... />`:

```tsx
              onCrop={(from, to) => void cropTake(selected, from, to)}
```

`ui/src/screens/Review.tsx` — add `onCropped` to the props and type:

```ts
  onCropped: (take: PendingTake) => void
```

add beside `discard`:

```tsx
  // The markers here are held in memory — the take has no folder on disk yet —
  // so they move with the audio by hand rather than coming back from Python.
  const cropDraft = async (from: number, to: number) => {
    if (busy) return
    setBusy(true)
    setError(null)
    player.pause()
    const res = await api().crop_draft(take.temp_dir, take.tracks, from, to)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? "Could not crop the take")
      return
    }
    setMarkers((prev) =>
      prev
        .filter((m) => m.at >= from && m.at <= to)
        .map((m) => ({ ...m, at: Math.round((m.at - from) * 100) / 100 }))
    )
    onCropped({
      ...take,
      tracks: res.tracks ?? take.tracks,
      duration_sec: res.duration_sec ?? take.duration_sec,
    })
  }
```

and to its `<TakePlayer ... />`:

```tsx
          onCrop={(from, to) => void cropDraft(from, to)}
```

`ui/src/App.tsx` — add to the `<Review ... />`:

```tsx
      onCropped={(take) => setScreen({ name: "review", take })}
```

- [ ] **Step 6: Run the suites and watch them pass**

Run: `cd ui && npm run build && cd .. && python3 tests/run_all.py`
Expected: every suite passes, including sections `[6]` and `[9e]`.

If a section **after** `[6]` fails on a take's length, the crop in `[6]` landed
on a take a later section depends on. Move that block to a take no later
section opens — do not loosen the later assertion, which is there on purpose.

- [ ] **Step 7: Commit**

```bash
git add ui/src tests/test_interface.py
git commit -m "Offer to crop a take to its region, on all three player screens"
```

---

### Task 4: Waveform peaks over a range

**Files:**
- Modify: `src/rehearsal_recorder/audio/waveform.py` (`wav_peaks`)
- Modify: `src/rehearsal_recorder/api.py` (`take_media`)
- Test: `tests/test_engine.py` (new section `[20]`, after `[19]`)

**Interfaces:**
- Produces: `wav_peaks(path, buckets=DEFAULT_BUCKETS, start_sec=None,
  end_sec=None)` → `(peaks, frames, samplerate)` where `frames` is still the
  **file's own** frame count; `take_media(tracks, buckets=DEFAULT_BUCKETS,
  start_sec=None, end_sec=None)`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_engine.py` after section `[19]`:

```python
    print("\n[20] The waveform can be asked for one part of a take")
    # Zoomed in, the same 900 bars have to describe two seconds instead of
    # nine minutes, or zooming only stretches the same smear.
    tmp8 = Path(tempfile.mkdtemp())
    with wave.open(str(tmp8 / "half.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(struct.pack("<h", 0) * SR)       # a second of silence
        w.writeframes(struct.pack("<h", 8000) * SR)    # then a second of tone

    whole, frames_whole, _ = wav_peaks(tmp8 / "half.wav", buckets=8)
    ok("the whole file is half silence and half tone",
       whole[0] == 0 and whole[7] > 0.2)

    loud, frames_loud, _ = wav_peaks(tmp8 / "half.wav", buckets=8,
                                     start_sec=1.0, end_sec=2.0)
    ok("asked for the second half, every bar is the tone",
       all(p > 0.2 for p in loud))
    quiet, _, _ = wav_peaks(tmp8 / "half.wav", buckets=8,
                            start_sec=0.0, end_sec=1.0)
    ok("and asked for the first, none of them is", all(p == 0 for p in quiet))
    # take_media turns this into the player's duration, which must not change
    # when the view does.
    ok("the file still reports its own length, not the window's",
       frames_loud == frames_whole == 2 * SR)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `python3 tests/test_engine.py`
Expected: `TypeError: wav_peaks() got an unexpected keyword argument 'start_sec'`

- [ ] **Step 3: Give wav_peaks a range**

In `src/rehearsal_recorder/audio/waveform.py`, replace the signature and the
opening of `wav_peaks` down to the `per_bucket = ...` line:

```python
def wav_peaks(path, buckets=DEFAULT_BUCKETS, start_sec=None, end_sec=None):
    """
    Returns (peaks, frames, samplerate) where peaks is a list of `buckets`
    values in 0..1: the maximum absolute level over that slice.

    start_sec/end_sec narrow the picture to one part of the take, so the same
    number of bars describes two seconds instead of nine minutes — which is
    what makes zooming show detail rather than a stretched smear. `frames`
    stays the file's own length either way: it is what the player's duration
    is read from, and that must not move when the view does.
    """
    with wave.open(str(path), "rb") as wf:
        frames = wf.getnframes()
        samplerate = wf.getframerate()
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()

        if frames == 0 or samplerate == 0 or sampwidth not in (2, 3):
            return [0.0] * buckets, frames, samplerate

        start = (0 if start_sec is None
                 else max(0, min(frames, int(start_sec * samplerate))))
        end = (frames if end_sec is None
               else max(start, min(frames, int(end_sec * samplerate))))
        window = end - start
        if window == 0:
            return [0.0] * buckets, frames, samplerate
        wf.setpos(start)

        # Peaks are always reported in 0..1, so each depth is divided by its
        # own full scale and the picture looks the same either way.
        scale = 32768.0 if sampwidth == 2 else float(1 << 23)

        per_bucket = max(1, window // buckets)
```

The rest of the function — the `bucket = 0` loop and the return — is unchanged.

- [ ] **Step 4: Pass the range through take_media**

In `src/rehearsal_recorder/api.py`, change `take_media`'s signature and the one
call inside it:

```python
    def take_media(self, tracks, buckets=DEFAULT_BUCKETS,
                   start_sec=None, end_sec=None):
        """Everything the player needs about a take in one call: each track's
        address, its length in samples and its waveform.

        start_sec/end_sec narrow the waveform to the part on screen. The
        bridge turns a missing argument into None, so the bucket count falls
        back here rather than being duplicated in the interface."""
        buckets = buckets or DEFAULT_BUCKETS
```

and inside the loop:

```python
                peaks, frames, samplerate = wav_peaks(
                    path, buckets, start_sec, end_sec
                )
```

- [ ] **Step 5: Run it and watch it pass**

Run: `python3 tests/test_engine.py`
Expected: section `[20]` all `ok`, and `[1]`–`[19]` still pass — section `[3]`
already calls `wav_peaks(deep / "B.wav", buckets=8)` positionally and must keep
working unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/rehearsal_recorder/audio/waveform.py src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "Let the waveform be asked for one part of a take"
```

---

### Task 5: A timeline the wheel can zoom

**Files:**
- Modify: `ui/src/lib/timeline.ts` (`tickTimes` takes a range; `MIN_VIEW_SEC`)
- Modify: `ui/src/hooks/useMultitrackPlayer.ts` (the view window)
- Modify: `ui/src/components/Waveform.tsx` (peaks window vs view window)
- Modify: `ui/src/components/Timeline.tsx` (the window, the wheel, following,
  "Whole take")
- Test: `tests/test_interface.py` (new section `[9c]`)

**Interfaces:**
- Consumes: nothing from Tasks 1–4.
- Produces, on the object `useMultitrackPlayer` returns:
  `view: { from: number; to: number } | null` (null is the whole take),
  `setView(from: number, to: number): void`, `resetView(): void`.
  `Waveform` props become `{ peaks, peaksFrom, peaksTo, viewFrom, viewTo,
  position, dimmed, className }`. `tickTimes(from, to, width)`.
  `MIN_VIEW_SEC` is exported from `@/lib/timeline`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_interface.py`, immediately after the
`page.screenshot(path=str(SHOTS / "54-player.png"))` line that ends section
`[9]` — that is, **above** the existing `[9e]`, not below it. Zoom has to be
exercised on the take at its full six seconds: `[9e]` crops it to three, and
`MIN_VIEW_SEC = 2` would leave a three-second take almost nothing to zoom
into.

```python
        print("\n[9c] Zooming the timeline")
        # Fifteen seconds of a nine-minute take is twenty pixels wide: the
        # gesture built last release is at its worst exactly where it is
        # needed most.
        box = page.get_by_role("group", name="Take timeline").bounding_box()
        mid_y = box["y"] + box["height"] / 2
        clock = page.get_by_role("group", name="Timeline clock")
        whole_take_clock = clock.inner_text()

        def seek_at(ratio):
            """Where a click at this fraction of the width lands, in seconds."""
            page.mouse.move(box["x"] + box["width"] * ratio, mid_y)
            page.mouse.down()
            page.mouse.up()
            page.wait_for_timeout(250)
            return calls("player_seek")[-1]["args"][0]

        def wheel_at(ratio, dx, dy):
            page.mouse.move(box["x"] + box["width"] * ratio, mid_y)
            page.mouse.wheel(dx, dy)
            page.wait_for_timeout(400)

        before = seek_at(0.3)
        wheel_at(0.3, 0, -500)
        ok("the wheel zooms in", clock.inner_text() != whole_take_clock)
        ok("and the timeline says what part of the take is on screen",
           page.locator("text=Whole take").count() == 1)
        # Anchored, not centred: the second under the pointer stays under the
        # pointer, which is the difference between aiming and hunting.
        ok("the second under the pointer stays under it",
           abs(seek_at(0.3) - before) < 0.2)

        mid_before = seek_at(0.6)
        wheel_at(0.6, 200, 0)
        ok("scrolling sideways moves along the take", seek_at(0.6) > mid_before)

        page.click("text=Whole take")
        page.wait_for_timeout(400)
        ok("and Whole take gives the whole take back",
           page.locator("text=Whole take").count() == 0
           and clock.inner_text() == whole_take_clock)

        # A marker off the side of the window is not drawn at all: without
        # that it would be pinned to the edge, pointing at the wrong second.
        ok("markers are on the timeline to start with",
           page.locator("[data-marker-at]").count() > 0)
        wheel_at(0.98, 0, -900)   # the last seconds of the take
        drawn = page.locator("[data-marker-at]").evaluate_all(
            "els => els.map(e => Number(e.dataset.markerAt))")
        ok("and only the ones inside the window are drawn",
           all(at >= TAKE_SECONDS / 2 for at in drawn))
        page.screenshot(path=str(SHOTS / "56-zoom.png"))

        page.click("button[aria-label^='Take 1 Polyn']")
        page.wait_for_timeout(700)
        ok("and picking another take starts from the whole of it",
           page.locator("text=Whole take").count() == 0)
        page.click("button[aria-label^='Take 2 Polyn (best)']")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npm run build && cd .. && python3 tests/test_interface.py`
Expected: FAIL at `ok("the wheel zooms in", ...)` — the clock does not change,
and `Whole take` is nowhere.

- [ ] **Step 3: Give tickTimes a range**

In `ui/src/lib/timeline.ts`, add the constant and replace `tickTimes`:

```ts
/** The shortest window the timeline will zoom to. Below this the picture is
 *  detail nobody is looking for, and the gesture becomes twitchy. */
export const MIN_VIEW_SEC = 2

/** Tick positions in seconds across the visible window, never reaching its
 *  very end — a label at the right edge would be cut in half by it. Ticks stay
 *  on round numbers however far along the take the window has been moved. */
export function tickTimes(from: number, to: number, width: number): number[] {
  const step = tickStep(to - from, width)
  const out: number[] = []
  for (let t = Math.ceil(from / step) * step; t < to; t += step) out.push(t)
  return out
}
```

- [ ] **Step 4: Put the window in the player hook**

In `ui/src/hooks/useMultitrackPlayer.ts`:

Add to the imports:

```ts
import { MIN_VIEW_SEC } from "@/lib/timeline"
```

Add beside the `region` state:

```ts
  // What part of the take the timeline is showing. null is all of it — the
  // same state as never having zoomed, so there is only one way to be
  // zoomed out.
  const [view, setViewState] = useState<{ from: number; to: number } | null>(
    null
  )
```

Reset it in the take-opening effect, beside `setRegionState({ a: null, b: null })`:

```ts
    setViewState(null)
```

Add these two callbacks beside `seek` (after it, so `duration` is in scope):

```ts
  const setView = useCallback(
    (from: number, to: number) => {
      if (duration <= 0) return
      const span = Math.min(duration, Math.max(MIN_VIEW_SEC, to - from))
      if (span >= duration) {
        setViewState(null)
        return
      }
      const start = Math.max(0, Math.min(duration - span, from))
      setViewState({ from: start, to: start + span })
    },
    [duration]
  )

  const resetView = useCallback(() => setViewState(null), [])
```

Add to the returned object, beside `region` and `looping`:

```ts
    view,
    setView,
    resetView,
```

- [ ] **Step 5: Teach the waveform which window its peaks describe**

Replace the props and the drawing block in `ui/src/components/Waveform.tsx`.
The doc comment becomes:

```tsx
/**
 * One track's waveform, and nothing else. The peaks arrive ready-made from
 * Python (one value per bar), so drawing costs nothing and the browser never
 * has to decode audio just to show a picture.
 *
 * The peaks cover [peaksFrom, peaksTo] and the lane shows [viewFrom, viewTo].
 * Usually those are the same stretch; while a zoom is settling they are not,
 * and the picture is then the right bars of the old peaks stretched over the
 * new window — blurred, briefly, rather than wrong.
 *
 * The played part is highlighted; the loop region, the markers and the
 * playhead belong to the whole take rather than to one track, so Timeline
 * draws them once across every lane instead of each waveform drawing its own.
 */
export function Waveform({
  peaks,
  peaksFrom,
  peaksTo,
  viewFrom,
  viewTo,
  position,
  dimmed,
  className,
}: {
  peaks: number[]
  /** The stretch of the take `peaks` covers. */
  peaksFrom: number
  peaksTo: number
  /** The stretch of the take this lane is showing. */
  viewFrom: number
  viewTo: number
  position: number
  dimmed?: boolean
  /** Height comes from the caller's class — Timeline gives each lane
   *  `h-full` so it fills the row height the grid assigns it. */
  className?: string
}) {
```

Replace everything in `draw()` from `const mid = height / 2` to the end of the
`for` loop with:

```ts
      const mid = height / 2
      const n = peaks.length
      const peakSpan = peaksTo - peaksFrom
      const viewSpan = viewTo - viewFrom
      if (n === 0 || peakSpan <= 0 || viewSpan <= 0) return

      // Which of the bars we have cover the part being shown.
      const perBar = peakSpan / n
      const first = Math.max(0, Math.floor((viewFrom - peaksFrom) / perBar))
      const last = Math.min(n, Math.ceil((viewTo - peaksFrom) / perBar))
      const shown = last - first
      if (shown <= 0) return

      const barWidth = width / shown
      const playedX = ((position - viewFrom) / viewSpan) * width

      for (let i = first; i < last; i++) {
        const x = (i - first) * barWidth
        // A minimum height so silence reads as a line rather than a gap
        const h = Math.max(1, peaks[i] * (height - 4))
        ctx.fillStyle = x + barWidth <= playedX ? playedColor : restColor
        ctx.fillRect(x, mid - h / 2, Math.max(0.5, barWidth - 0.5), h)
      }
```

and change the effect's dependency array to:

```ts
  }, [peaks, peaksFrom, peaksTo, viewFrom, viewTo, position])
```

- [ ] **Step 6: Put the window, the wheel and the follow into Timeline**

In `ui/src/components/Timeline.tsx`:

Add to the imports:

```ts
import { MIN_VIEW_SEC, tickTimes } from "@/lib/timeline"
```

(replacing the existing `tickTimes` import) and add the constant beside
`ROW_GAP_PX`:

```ts
/** How fast the wheel zooms. One notch of a mouse wheel is about 100 units,
 *  so this makes a notch a fifth of the window. */
const ZOOM_PER_PIXEL = 0.002
```

Replace the destructuring and the two mapping functions:

```ts
  const { media, duration, position, region } = player
  const from = player.view?.from ?? 0
  const to = player.view?.to ?? duration
  const span = Math.max(0.001, to - from)
  // While the user is panning by hand during playback, the window does not
  // chase the playhead — it resumes when the playhead comes back into view.
  const followingRef = useRef(true)
```

```ts
  const secondsAt = (clientX: number) => {
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || duration <= 0) return 0
    const ratio = (clientX - box.left) / box.width
    return Math.min(duration, Math.max(0, from + ratio * span))
  }

  const pct = (seconds: number) =>
    duration > 0 ? ((seconds - from) / span) * 100 : 0
```

Add these two effects after the existing `ResizeObserver` effect:

```ts
  // The wheel belongs to the gesture surface, which covers the waveforms and
  // nothing else — so a wheel over the track names beside them still scrolls
  // the lane stack, which is the only way to reach the eighth track. It has
  // to be a non-passive listener: React's onWheel cannot preventDefault, and
  // without that the scroll container takes the gesture.
  const { setView } = player
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (duration <= 0) return
      const box = el.getBoundingClientRect()
      if (box.width === 0) return
      e.preventDefault()
      followingRef.current = false

      // Sideways on a trackpad, shift+wheel on a mouse: along the take.
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const by = ((e.shiftKey ? e.deltaY : e.deltaX) / box.width) * span
        setView(from + by, to + by)
        return
      }

      // Anchored zoom: the second under the pointer stays under the pointer.
      // A trackpad pinch arrives here too — the browser sends it as a wheel
      // event with ctrlKey set — and lands in this branch, which is what
      // stops it zooming the whole page instead.
      const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
      const anchor = from + ratio * span
      const next = Math.min(
        duration,
        Math.max(MIN_VIEW_SEC, span * Math.exp(e.deltaY * ZOOM_PER_PIXEL))
      )
      setView(anchor - ratio * next, anchor + (1 - ratio) * next)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [setView, duration, from, to, span])

  // Zoomed in, playback leaves the window within seconds. The window pages
  // forward rather than sliding, which is calmer to watch.
  useEffect(() => {
    if (!player.playing || !player.view) {
      followingRef.current = true
      return
    }
    if (position >= from && position <= to) {
      followingRef.current = true
      return
    }
    if (!followingRef.current) return
    setView(position - span / 8, position + (span * 7) / 8)
  }, [setView, player.playing, player.view, position, from, to, span])
```

Change the tick call:

```ts
  const ticks = tickTimes(from, to, width)
```

Replace the gutter cell of the ruler row (the one that reads "Drag the edges" /
"Drag across to loop") with:

```tsx
        <div
          className="flex items-end justify-between gap-2 pb-1 text-xs text-muted-foreground"
          style={{ gridColumn: 1, gridRow: 1 }}
        >
          {player.view ? (
            <>
              <span className="tnum truncate">
                {formatMMSS(from)} – {formatMMSS(to)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2 text-xs"
                onClick={player.resetView}
              >
                Whole take
              </Button>
            </>
          ) : (
            <span>{band ? "Drag the edges" : "Drag across to loop"}</span>
          )}
        </div>
```

Give the lane's `<Waveform>` the two windows:

```tsx
                <Waveform
                  peaks={m.peaks}
                  peaksFrom={0}
                  peaksTo={duration}
                  viewFrom={from}
                  viewTo={to}
                  position={position}
                  dimmed={dimmed}
                  className={cn("h-full rounded-lg border", dimmed && "opacity-60")}
                />
```

Add `overflow-hidden` to the surface's class, so nothing outside the window
escapes sideways into the track names:

```tsx
          className="relative cursor-crosshair overflow-hidden select-none"
```

Draw only the markers inside the window, and mark them so a test can count
them — change `{markers.map((m) => (` to:

```tsx
          {markers
            .filter((m) => m.at >= from && m.at <= to)
            .map((m) => (
```

and add `data-marker-at={m.at}` to the diamond `<span>` (the one at
`top: RULER_PX - 13`).

Keep the region's span read-out on screen while the window is inside it, by
clamping its left edge:

```tsx
              style={{ left: `${Math.max(0, pct(band.a))}%`, top: RULER_PX + 6, marginLeft: 8 }}
```

- [ ] **Step 7: Run the suites and watch them pass**

Run: `cd ui && npm run build && cd .. && python3 tests/run_all.py`
Expected: every suite passes, including the new section `[9c]`.

- [ ] **Step 8: Commit**

```bash
git add ui/src tests/test_interface.py
git commit -m "Zoom and pan the timeline with the wheel"
```

---

### Task 6: Sharpening the waveform to the window

**Files:**
- Modify: `ui/src/lib/api.ts` (`take_media` takes a range)
- Modify: `ui/src/hooks/useMultitrackPlayer.ts` (`peaksWindow`, the settling refetch)
- Modify: `ui/src/components/Timeline.tsx` (pass `peaksWindow` instead of `0`/`duration`)
- Test: `tests/test_interface.py` (wrap the `take_media` mock; new section `[9d]`)

**Interfaces:**
- Consumes: ranged `take_media` from Task 4; `view`/`setView` from Task 5.
- Produces: `peaksWindow: { from: number; to: number }` on the player object —
  the stretch `media[].peaks` currently describe.

- [ ] **Step 1: Write the failing test**

In `tests/test_interface.py`, wrap the existing `take_media` mock so its calls
are recorded, and let it answer a range:

```js
  take_media: track('take_media', async (tracks, buckets, from, to) => tracks.map(t => {
    const dur = fileDurations[t.file] ?? TAKE;
    return {name:t.name, url:'about:blank', frames:48000*dur, samplerate:48000, duration_sec:dur,
      peaks: Array.from({length:300}, (_, i) => Math.abs(Math.sin(i / 9)) * 0.9)};
  })),
```

Add a new section immediately after `[9c]`, above `[9e]`. It reuses the `box`,
`mid_y` and `calls` already in scope there:

```python
        print("\n[9d] The waveform sharpens to what is on screen")
        # Stretching the same 900 bars over two seconds shows no more than it
        # did over nine minutes, so the peaks are fetched again for the window.
        # Not on every wheel tick, though: that would be a burst of calls into
        # Python for a picture nobody has finished aiming yet.
        ranged_before = len([c for c in calls("take_media")
                             if len(c["args"]) > 2 and c["args"][2] is not None])
        page.mouse.move(box["x"] + box["width"] * 0.5, mid_y)
        for _ in range(6):
            page.mouse.wheel(0, -120)
        page.wait_for_timeout(900)
        ranged = [c for c in calls("take_media")
                  if len(c["args"]) > 2 and c["args"][2] is not None]
        fresh = len(ranged) - ranged_before
        ok("the peaks are fetched again for the part on screen", fresh >= 1)
        ok("once the wheel settles, not once per notch", fresh <= 3)
        ok("and for the window that is actually showing",
           abs(ranged[-1]["args"][2] - ranged[-1]["args"][3]) > 0
           and ranged[-1]["args"][3] > ranged[-1]["args"][2])
        page.click("text=Whole take")
        page.wait_for_timeout(700)
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npm run build && cd .. && python3 tests/test_interface.py`
Expected: FAIL at "the peaks are fetched again for the part on screen" — the
interface never asks for a range.

- [ ] **Step 3: Let the bridge carry a range**

In `ui/src/lib/api.ts`, replace the `take_media` line in `PyApi`:

```ts
  /** A track's address, length and waveform. A range narrows the waveform to
   *  the part on screen; the lengths returned are always the whole file's. */
  take_media(
    tracks: TrackFile[],
    buckets?: number,
    startSec?: number,
    endSec?: number
  ): Promise<TrackMedia[]>
```

- [ ] **Step 4: Fetch the sharper peaks once the gesture settles**

In `ui/src/hooks/useMultitrackPlayer.ts`, add beside `STATE_POLL_MS`:

```ts
/** How long after the last wheel event the sharper peaks are fetched. Every
 *  tick would be a burst of calls into Python for a picture nobody has
 *  finished aiming yet. */
const PEAKS_SETTLE_MS = 150
```

Add beside the `view` state:

```ts
  // The stretch of the take `media[].peaks` currently describe. It trails
  // `view` by a moment, and Waveform is given both so the gap is drawn
  // correctly — blurred, briefly — rather than drawn wrong.
  const [peaksWindow, setPeaksWindow] = useState({ from: 0, to: 0 })
```

Reset it in the take-opening effect, beside `setViewState(null)`:

```ts
    setPeaksWindow({ from: 0, to: 0 })
```

Add this effect after the "Smooth cursor movement" effect:

```ts
  // Zoom redraws at once from the peaks already in hand; the ones that match
  // the window arrive a moment later.
  useEffect(() => {
    if (!tracks || tracks.length === 0 || duration <= 0) return
    const want = view ?? { from: 0, to: duration }
    const have = peaksWindow.to > 0 ? peaksWindow : { from: 0, to: duration }
    if (
      Math.abs(want.from - have.from) < 0.01 &&
      Math.abs(want.to - have.to) < 0.01
    ) {
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const info = await api().take_media(
            tracks,
            undefined,
            want.from,
            want.to
          )
          if (cancelled) return
          setMedia(info)
          setPeaksWindow(want)
        } catch {
          /* the picture stays as it is; the take still plays */
        }
      })()
    }, PEAKS_SETTLE_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [tracks, view, duration, peaksWindow])
```

Add to the returned object, beside `view`:

```ts
    // Never zero-width for a consumer: before the first fetch answers, the
    // peaks in hand are the whole take's.
    peaksWindow: peaksWindow.to > 0 ? peaksWindow : { from: 0, to: duration },
```

- [ ] **Step 5: Draw from the window the peaks actually describe**

In `ui/src/components/Timeline.tsx`, change the two `<Waveform>` props added in
Task 5:

```tsx
                  peaksFrom={player.peaksWindow.from}
                  peaksTo={player.peaksWindow.to}
```

- [ ] **Step 6: Run the suites and watch them pass**

Run: `cd ui && npm run build && cd .. && python3 tests/run_all.py`
Expected: every suite passes, including `[9d]`.

- [ ] **Step 7: Commit**

```bash
git add ui/src tests/test_interface.py
git commit -m "Fetch the waveform for the part of the take on screen"
```

---

### Task 7: Saying so in the documentation

**Files:**
- Modify: `docs/using-it.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Create: `docs/screenshots/zoom.png` (copied from `tests/screenshots/56-zoom.png`)

**Interfaces:**
- Consumes: the behaviour built in Tasks 1–6.
- Produces: nothing other code depends on.

- [ ] **Step 1: Read what is there now**

Read `docs/using-it.md` and find the section that describes the timeline, the
A–B region and the Escape ladder — the new prose goes with it, in the same
voice. Read the top of `CHANGELOG.md`: the most recent released heading is
`## 0.4.0`, so a new `## Unreleased` heading goes above it.

- [ ] **Step 2: Refresh the screenshot**

```bash
cp tests/screenshots/56-zoom.png docs/screenshots/zoom.png
```

This file is written by section `[9c]`, so `python3 tests/run_all.py` must have
been run since Task 5 landed. Open it and check it actually shows a zoomed
timeline with the "Whole take" control — a screenshot of the wrong state is
worse than none.

- [ ] **Step 3: Write the changelog entry**

Add above `## 0.4.0` in `CHANGELOG.md`:

```markdown
## Unreleased

- A take can be trimmed to the region marked on the timeline. Most takes are a
  few minutes of music inside a longer recording — somebody walking back to the
  kit, a false start, the silence after everyone stopped — and until now there
  was no way to say so: the whole thing sat in history, in the size on disk,
  and in the time it took to find the part worth hearing again. Cropping keeps
  the take's number, name and markers, moving the markers with the audio they
  pointed at. The originals go to the Trash as one folder named after the take,
  so they can be put back.
- Cropping is offered on the review screen too, which is where the dead air at
  the start of a take is most obvious — you have just recorded it and can see it
  on the waveform.
- The timeline zooms. The wheel over the tracks zooms around the pointer, so the
  second under it stays under it; two fingers sideways, or Shift and the wheel,
  move along the take; **Whole take** returns. Fifteen seconds of a nine-minute
  take used to be twenty pixels wide, which made the region impossible to place
  accurately. The waveform is redrawn for the part on screen rather than
  stretched, so zooming in shows detail that was not there before.
```

- [ ] **Step 4: Write the guide entry**

In `docs/using-it.md`, in or next to the section about the timeline and the A–B
region, add:

```markdown
### Trimming a take

Mark the part worth keeping — drag across the tracks, or set A and B — and
press **Crop**. The take becomes that part: same number, same name, and the
markers inside it move along with the audio. What is removed is not destroyed;
it goes to the Trash as one folder named after the take, so an over-eager crop
is undone by putting that folder back and dropping its files into the take
folder.

Two things worth knowing. Markers outside the region go with the audio they
pointed at, and the question says how many before you agree. And a take that
has been copied to the cloud folder loses that copy when it is cropped — the
copy is of a different take now — so send it again afterwards.

Cropping works right after recording as well, on the review screen, which is
usually where you can see the twenty seconds of nothing at the start.

### Looking closer

The whole take is on screen by default, which for a nine-minute take is about a
second and a half per centimetre. Roll the wheel over the tracks to zoom in —
the moment under the pointer stays under the pointer — and two fingers sideways
(or Shift and the wheel) to move along the take. The waveform is redrawn for
the part on screen, so zooming in shows detail rather than a stretched picture.
**Whole take**, at the left of the ruler, gives it all back.

The wheel over the track names on the left still scrolls the list of tracks, so
a rehearsal with eight of them is still reachable.

While a take is playing the window follows the playhead. If you move along the
take by hand it stops following until the playhead comes back into view.
```

- [ ] **Step 5: Point the README at the picture**

In `README.md`, in the list of screenshots, add a line for the zoomed timeline
next to the existing player screenshot, in the same style as the lines already
there:

```markdown
![A take zoomed in](docs/screenshots/zoom.png)
```

with a one-sentence caption in the voice of the captions already in the file.

- [ ] **Step 6: Check the docs against what was built**

Re-read the three files. Every control named — **Crop**, **Whole take**, A, B —
must exist with that label in `ui/src/components/TakePlayer.tsx` and
`ui/src/components/Timeline.tsx`. Every promise — markers moving, the originals
going to the Trash as one folder, the cloud copy being forgotten — must be
something Task 2 actually does.

- [ ] **Step 7: Run everything once more and commit**

```bash
cd ui && npm run build && cd ..
python3 tests/run_all.py
git add docs CHANGELOG.md README.md
git commit -m "Say what cropping and zooming do"
```

---

## Notes for whoever executes this

**Run the interface suite against a fresh build.** `tests/test_interface.py`
loads `ui/dist`, not the sources. A change that "does not work" is very often a
change that was never built.

**The order of Tasks 5 and 6 matters.** Task 5 leaves the waveform stretching
whole-take peaks over the zoomed window — that is not an unfinished state, it
is the state the picture is in for 150 ms after every zoom, and Task 6 only
makes it stop being the steady state.

**Do not loosen an existing assertion to make a new one pass.** Two places are
likely to tempt: the `abs(moved[0] - TAKE_SECONDS * 0.25) < 0.05` check in
section `[9]`, and the take lengths in section `[6]`. Both are tight because a
change in either number means something moved that should not have.
