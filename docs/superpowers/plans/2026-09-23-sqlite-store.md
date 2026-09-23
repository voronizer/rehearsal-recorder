# Rehearsals in SQLite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move rehearsals and takes out of per-folder `session.json` files into one SQLite database per recordings folder, with the schema owned by Alembic migrations, and nothing lost on the way.

**Architecture:** A new package `rehearsal_recorder.store`: `models.py` (SQLAlchemy 2.0 ORM), `db.py` (opens `<recordings>/library.sqlite`, pragmas, upgrade-with-backup, refusal of a newer database), `library.py` (every read/write api.py needs, one transaction each, returning today's dict shapes with absolute paths), `importer.py` (old `session.json` → rows, then deleted). `api.py` swaps `_read_meta`/`_write_meta`/`_meta_lock` for `self._lib` calls; the interface gains only the "Not found on disk" state and a startup-problems hook.

**Tech Stack:** Python 3.12 (floor 3.10), SQLAlchemy 2.0.54, Alembic 1.20.0, stdlib sqlite3; React + TypeScript; plain-script test suites run by `tests/run_all.py`; Playwright for the interface suite.

**Spec:** `docs/superpowers/specs/2026-09-23-sqlite-store-design.md`

## Global Constraints

- Database file: `<recordings_dir>/library.sqlite`; backup before a migration: `library.sqlite.bak-<revision>`.
- Stored paths are never absolute: `rehearsal.folder` relative to the recordings folder, `take_file.file` relative to the rehearsal folder, `cloud_copy.mix`/`tracks` relative to the cloud folder. Always with forward slashes.
- The API keeps returning the same shapes as today, with absolute paths. The only additions: `missing` on rehearsals, `cloud_skip`/`cloud_send` always present as booleans on takes.
- `config.json` stays JSON, now written atomically (`config.json.writing` → `os.replace`).
- The newer-database message, exactly: "This recordings folder was opened by a newer version of Rehearsal Recorder — update the app to use it."
- Missing-folder copy, exactly: badge "Not found on disk"; actions "Remove from history" and "Locate folder…".
- No hand-rolled migration runner: Alembic only, `render_as_batch=True`.
- Windows: a file the player has memory-mapped cannot be moved or renamed — call `self._release_player_in(dir)` before moving take/rehearsal folders (as the code already does), and `Library.close()` before anything moves `library.sqlite`.
- Tests are plain scripts with `ok(label, cond)`; nothing that asserts nothing. Every existing check keeps asserting the behaviour it asserted.
- Code comments and docs in the project's voice: English, explain *why*, no ticket numbers.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CNyT4ZtaUgzVBrZn13LEB4
  ```
  (a subagent on another model names its own model in the first line).

## Environment

- Branch `sqlite-store` (already checked out; the spec commits are on it).
- Python venv (already has requirements + playwright + sqlalchemy + alembic):
  `V=/c/Users/voronische/AppData/Local/Temp/claude/C--Users-voronische-Documents-GitHub-voronizer-rehearsal-recorder/f811f0cd-b619-493c-b010-f7baaff62ac4/scratchpad/venv/Scripts`
- Run everything: `PYTHONIOENCODING=utf-8 $V/python tests/run_all.py`
- One suite: `PYTHONIOENCODING=utf-8 $V/python tests/test_store.py`
- Interface build (before `test_interface.py`): `cd ui && npm run build`
- Git Bash heredocs collapse `\\`; write files with the Write tool, not `cat <<EOF`.

---

### Task 1: The store package

Everything in this task was prototyped and its test suite passes as written below; this is transcription plus wiring into the repo.

**Files:**
- Modify: `requirements.txt`, `pyproject.toml`, `.gitignore`, `tests/run_all.py`
- Create: `alembic.ini`
- Create: `src/rehearsal_recorder/store/__init__.py`, `models.py`, `db.py`, `library.py`, `importer.py`
- Create: `src/rehearsal_recorder/store/migrations/env.py`, `script.py.mako`, `versions/0001_initial.py`
- Test: `tests/test_store.py`

**Interfaces — Produces** (Task 2 relies on these exact names):
- `rehearsal_recorder.store.db`: `LibraryUnavailable(Exception)`, `NEWER_DATABASE: str`, `DB_NAME = "library.sqlite"`, `MIGRATIONS: Path`, `database_path(recordings_dir)`, `make_engine(path)`, `current_revision(engine)`, `open_engine(recordings_dir, migrations=MIGRATIONS)`.
- `rehearsal_recorder.store.library`: `MARKER_KINDS`, `as_marker(value) -> dict`, `class Library(recordings_dir, cloud_dir=lambda: None, migrations=MIGRATIONS)` with `close()`, `key(folder)`, `rehearsals()`, `rehearsal(folder)`, `has(folder)`, `create_rehearsal(folder, name, created_at, samplerate, bit_depth, tracks)`, `import_rehearsal(...)`, `move_rehearsal(folder, new_folder, name=None) -> bool`, `forget_rehearsal(folder) -> bool`, `take(folder, n)`, `add_take(folder, take) -> dict|None`, `update_take(folder, n, *, name=None, duration_sec=None, tracks=None, markers=None) -> dict|None`, `edit_markers(folder, n, fn) -> list|None`, `delete_take(folder, n) -> int|None`, `set_cloud_copy(folder, n, shared, cloud_dir) -> bool` (shared=None clears the copy; always clears `cloud_error`), `set_cloud_error(folder, n, message) -> bool`.
- `rehearsal_recorder.store.importer`: `SESSION_FILE`, `read_text(path)`, `import_folder(library, folder, cloud_dir)`, `import_all(library, cloud_dir, report=None) -> {"imported", "failed"}`.
- Rehearsal dict: `{"folder", "name", "created_at", "samplerate", "bit_depth", "tracks": [{"name","channel"}], "takes": [take…], "missing": bool}`.
- Take dict: `{"take_number", "name", "duration_sec", "tracks": [{"name","file"}], "markers": [{"at","kind","note"}], "cloud": {…} or {}, "cloud_skip": bool, "cloud_send": bool, "cloud_error"?: str}`.

- [ ] **Step 1: Dependencies and packaging metadata**

Append to `requirements.txt`:

```
# The rehearsal history: one SQLite database per recordings folder, its
# schema kept by Alembic migrations — see store/db.py.
sqlalchemy
alembic
```

In `pyproject.toml`, after the `[tool.setuptools.packages.find]` block, add (the migrations folder is not a Python package, so an install would otherwise leave it out):

```toml
# The migrations are read from disk by Alembic, not imported as a package,
# so they have to be named to be installed at all.
[tool.setuptools.package-data]
"rehearsal_recorder.store" = [
    "migrations/*.py",
    "migrations/*.mako",
    "migrations/versions/*.py",
]
```

Append to `.gitignore`:

```
# The scratch database `alembic revision --autogenerate` compares against.
.alembic-scratch.sqlite*
```

Create `alembic.ini` at the repository root (only for writing new migrations — the app never reads it):

```ini
# Only for writing a new migration from the command line — see
# docs/development.md. The app runs its migrations itself (store/db.py) and
# never reads this file.
[alembic]
script_location = %(here)s/src/rehearsal_recorder/store/migrations
prepend_sys_path = %(here)s/src
sqlalchemy.url = sqlite:///%(here)s/.alembic-scratch.sqlite
```

- [ ] **Step 2: Write the test suite first**

Create `tests/test_store.py` exactly as in Appendix A, and add it to `tests/run_all.py`: `SUITES = ("test_engine.py", "test_platform.py", "test_store.py", "test_interface.py")`, plus a line for it in that file's docstring in the same style as the others (`test_store.py      the history database — schema, migrations, and the move of old session.json files into it`).

- [ ] **Step 3: Run it to see it fail**

Run: `PYTHONIOENCODING=utf-8 $V/python tests/test_store.py`
Expected: `ModuleNotFoundError: No module named 'rehearsal_recorder.store'`

- [ ] **Step 4: Write the package**

Create each file exactly as in the appendices:
- `src/rehearsal_recorder/store/__init__.py` — Appendix B
- `src/rehearsal_recorder/store/models.py` — Appendix C
- `src/rehearsal_recorder/store/db.py` — Appendix D
- `src/rehearsal_recorder/store/migrations/env.py` — Appendix E
- `src/rehearsal_recorder/store/migrations/script.py.mako` — Appendix F
- `src/rehearsal_recorder/store/migrations/versions/0001_initial.py` — Appendix G
- `src/rehearsal_recorder/store/library.py` — Appendix H
- `src/rehearsal_recorder/store/importer.py` — Appendix I

- [ ] **Step 5: Run it to see it pass**

Run: `PYTHONIOENCODING=utf-8 $V/python tests/test_store.py`
Expected: every line `ok`, last line `All store checks passed.` (Two `[import] … Broken: JSONDecodeError` lines on stderr are expected — that is the broken file being reported.)

- [ ] **Step 6: Check the migration is what autogenerate would write**

```bash
cd <repo> && rm -f .alembic-scratch.sqlite* \
  && $V/alembic -c alembic.ini upgrade head \
  && $V/alembic -c alembic.ini check; rm -f .alembic-scratch.sqlite*
```
Expected: `No new upgrade operations detected.`

- [ ] **Step 7: The other suites still pass**

Run: `PYTHONIOENCODING=utf-8 $V/python tests/test_engine.py && PYTHONIOENCODING=utf-8 $V/python tests/test_platform.py`
Expected: both pass — nothing uses the store yet.

- [ ] **Step 8: Commit**

```bash
git add requirements.txt pyproject.toml .gitignore alembic.ini tests/run_all.py tests/test_store.py src/rehearsal_recorder/store
git commit -m "Keep the history in SQLite: the store, its first migration, the importer" -m "<attribution lines>"
```

---

### Task 2: api.py on the library

The big one: every place that reads or writes `session.json` goes through `self._lib`. Behaviour seen from the interface does not change, apart from the additions named in Global Constraints.

**Files:**
- Modify: `src/rehearsal_recorder/api.py`, `src/rehearsal_recorder/cloud.py` (docstring/comment of `source_of` only)
- Test: `tests/test_engine.py`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces (Tasks 3–4 rely on these): `Api.forget_rehearsal(folder)`, `Api.locate_rehearsal(folder, new_folder)`, `Api.choose_rehearsal_folder(folder)`, `Api.startup_problems() -> [{"name": str, "message": str}]` (returned once, then cleared), `list_rehearsals()` items gain `"missing": bool`, `get_rehearsal()` of a missing one returns `{"ok": False, "missing": True, "error": "The rehearsal's folder is not on disk"}`.

**How the pieces map.** Read the whole of `api.py` first. Then:

1. **Opening.** In `__init__`, after `self._recordings_dir.mkdir(...)` and before `cleanup_empty_rehearsals()`, call `self._open_library()`. Remove `self._meta_lock` entirely (every `with self._meta_lock:` block is replaced by the library call(s) that do the same job in one transaction; the comment in `crop_take` about lock order goes, `_player_lock` stays).

   ```python
   def _open_library(self, recordings_dir=None):
       """
       The recordings folder's database, opened and brought up to date, with
       any old session.json files moved into it. When it cannot be used — a
       newer app's database, a migration that failed — the reason is kept and
       everything that needs the history says so, rather than the app not
       starting: Settings still work, and another folder can be chosen.
       Returns the error message, or None.
       """
       folder = Path(recordings_dir or self._recordings_dir)
       try:
           library = Library(folder, cloud_dir=lambda: self._cloud_dir)
       except LibraryUnavailable as e:
           logging.getLogger(__name__).error("recordings database: %s", e, exc_info=True)
           return str(e)
       if getattr(self, "_library", None) is not None:
           self._library.close()
       self._library, self._library_error = library, None
       import_all(library, self._cloud_dir, report=self._report_import_failure)
       return None
   ```
   `__init__` sets `self._library = None`, `self._library_error = None`, `self._problems = []` before calling it, and on a returned error sets `self._library_error = error` and appends `{"name": "LibraryUnavailable", "message": error}` to `self._problems`.
   `_report_import_failure(folder, e)` appends `{"name": type(e).__name__, "message": f"Could not read the history of “{folder.name}”: {e}. The file was left as it is and will be tried again next time."}`.
   `startup_problems()` returns `self._problems` and empties it.
   The property every caller uses:
   ```python
   @property
   def _lib(self):
       if self._library is None:
           raise LibraryUnavailable(self._library_error or "The recordings database is not open")
       return self._library
   ```
   The `logging.getLogger(__name__).error(...)` goes to crash.log through the handler `app._arm_crash_log` installs — check that function and, if it only attaches to the `pywebview` logger, also attach the same handler to `logging.getLogger("rehearsal_recorder")` there (same dedupe marker `_ours`). Add a check in `tests/test_engine.py` that a LibraryUnavailable at open is logged at ERROR on the `rehearsal_recorder.api` logger (use a `logging.Handler` subclass that collects records).

2. **`set_recordings_dir`**: after `mkdir`, call `error = self._open_library(folder)`; on error return `{"ok": False, "error": error}` and change nothing else (the old folder and its library stay in use). Only on success update `self._recordings_dir`, config and media root. Add `shutdown()` → also `self._library.close()` if open.

3. **Config**: `_read_config` uses `read_text` imported from `rehearsal_recorder.store.importer` (delete `_read_text` from api.py). `_write_config` writes `CONFIG_PATH.with_name("config.json.writing")` then `os.replace` onto `CONFIG_PATH`. Keep `_write_text`.

4. **The rehearsal in progress.** `self._session` loses its `"takes"` key. Add
   ```python
   def _session_takes(self):
       """The takes of the rehearsal in progress, from the database — the one
       copy there is."""
       if self._session is None:
           return []
       r = self._lib.rehearsal(self._session["folder"])
       return r["takes"] if r else []
   ```
   and use it in `session_state` (`"takes"` and `"songs"`), `suggest_take_name`, `finish_rehearsal` (`take_count`), `_enqueue_session_takes`, `_retry_failed_publishes`. Delete every `self._session["takes"] = …` resync line — there is nothing to resync any more. `start_rehearsal` calls `self._lib.create_rehearsal(folder, name, created_at, samplerate, bit_depth, tracks)` where it called `_save_session_meta()`; delete `_save_session_meta`, `_write_meta`, `_read_meta`.

5. **Empty rehearsals.** Replace module-level `_is_empty_rehearsal(folder)` with a method `_is_empty(rehearsal)` → `not rehearsal["takes"] and not has_audio(Path(rehearsal["folder"]))`. `finish_rehearsal`: read `self._lib.rehearsal(folder)` before clearing the session; if empty, `rmtree` and `self._lib.forget_rehearsal(folder)`. `cleanup_empty_rehearsals`: iterate `self._lib.rehearsals()`, skip the session's folder and `missing` ones, remove + forget the empty ones. When `self._library is None` it returns `{"ok": True, "removed": 0}` instead of raising (it runs from `__init__`).

6. **Takes.**
   - `keep_take`: after moving the files, build `take_info` as now (with `cloud_skip`/`cloud_send` booleans) and `kept = self._lib.add_take(s["folder"], take_info)`; enqueue with `take=kept`; return `{"ok": True, "take": kept}`.
   - `recover_draft`: `r = self._lib.rehearsal(folder)` (None → "Rehearsal not found"); samplerate/depth from it; `take_number = max(t["take_number"] for t in r["takes"], default=0) + 1`; `kept = self._lib.add_take(folder, take_info)`; bump `self._session["take_counter"]` as now when it is the live rehearsal.
   - `list_drafts`: iterate `self._lib.rehearsals()`, skip `missing`.
   - `rename_take`: `take = self._lib.take(folder, n)`; work out `old_dir`/`new_dir` exactly as now; after a successful `old_dir.rename(new_dir)` build the new `tracks` list; then `updated = self._lib.update_take(folder, n, name=display_name, tracks=new_tracks_or_None)` inside `try/except`: on exception rename the folder back and re-raise (keeps the existing "folder must not stay renamed under a record pointing at the old one" rule). Return `{"ok": True, "take": updated}`. Distinguish "Rehearsal not found" (`not self._lib.has(folder)`) from "Take not found".
   - `rename_rehearsal`: `r = self._lib.rehearsal(folder)`; compute `new_folder` from `r["created_at"]` as now; rename on disk; then `self._lib.move_rehearsal(original, new_folder, display_name)` in `try/except` that renames back and re-raises. No path rewriting loop any more. When the folder did not change, still `move_rehearsal(original, original, display_name)` to store the name. Update `self._session["folder"]`/`["name"]` as now. Return `"takes": self._lib.rehearsal(folder)["takes"]`.
   - Markers: `MARKER_KINDS = library.MARKER_KINDS`; `_as_marker = staticmethod(as_marker)`; `_markers_of` stays for callers that normalise a take dict. `_update_markers(folder, n, fn)`: outside-recordings check as now; `not self._lib.has(folder)` → "Rehearsal not found"; `markers = self._lib.edit_markers(folder, n, fn)`; None → "Take not found"; return `{"ok": True, "markers": markers}`.
   - `crop_take`: `take = self._lib.take(folder, n)` in place of the meta read; after a successful `_crop_tracks`, compute `kept`/`dropped` as now, then `self._remove_shared(take)`, `self._lib.update_take(folder, n, duration_sec=done["duration_sec"], markers=kept)`, `self._lib.set_cloud_copy(folder, n, None, None)`; return `"take": self._lib.take(folder, n)`.
   - `delete_take`: `target = self._lib.take(folder, n)`; trash its folders as now; `left = self._lib.delete_take(folder, n)`; return `{**result, "takes_left": left}`.
   - `delete_rehearsal`: as now, and when `move_to_trash` returned `ok`, `self._lib.forget_rehearsal(folder)`.
   - `list_rehearsals`: `cleanup_empty_rehearsals()`, then one item per `self._lib.rehearsals()` (already newest first) with the same keys as today plus `"missing"`; `disk_bytes` is `0` for a missing one (do not walk a folder that is not there).
   - `get_rehearsal`: from `self._lib.rehearsal(folder)`; None → `{"ok": False, "error": "Rehearsal not found"}`; missing → the shape in Produces; otherwise as today (`takes`, `songs`), markers already normalised.

7. **The cloud.**
   - `_cloud_target(folder)` now returns the *subfolder name* `_safe_name(Path(folder).name)` (or None with no cloud folder) — that is what goes into `source["dir"]`. `_cloud_subfolder(cloud, folder)` stays for where files are written.
   - `share_take`: `take = self._lib.take(folder, n)` for the read; write into `target_dir = _cloud_subfolder(cloud, folder)` as now; `shared["source"] = cloudmod.source_of(take, what, volumes, fmt, _safe_name(folder.name))`; persist with `if not self._lib.set_cloud_copy(folder, n, shared, cloud): return {"ok": False, "error": "Take not found"}`; then set `take["cloud"] = shared`, drop `cloud_error` from the dict, return as now.
   - `unshare_take`: `take = self._lib.take(...)`; `result = self._remove_shared(take)`; `self._lib.set_cloud_copy(folder, n, None, None)`.
   - `_record_cloud_error` → `self._lib.set_cloud_error(folder, n, message)`.
   - `_publish_step`, `_take_in` → `self._lib.take(folder, n)`. `_publish_step` passes `self._cloud_target(folder)` to `is_current` unchanged (it is the subfolder now).
   - `cloud.py`: only the comment on the `"dir"` entry of `source_of` changes — it is now the rehearsal's subfolder inside the cloud folder, so pointing the setting at the same folder moved elsewhere does not make every take look stale. The parameter keeps its name `target`; say in the docstring it is the subfolder name.

8. **Missing rehearsals (backend of Task 3).**
   ```python
   def forget_rehearsal(self, folder):
       """Takes a rehearsal out of History. Only the record: whatever is on
       disk is not touched — this is for a folder that is gone."""
   def locate_rehearsal(self, folder, new_folder):
       """Points a rehearsal whose folder went missing at where it is now."""
   def choose_rehearsal_folder(self, folder):
       """The folder dialog for locate_rehearsal, opened in the recordings
       folder."""
   ```
   `forget_rehearsal`: outside-recordings check; refuse the rehearsal in progress; `self._lib.forget_rehearsal(folder)` → `{"ok": True}` or `{"ok": False, "error": "Rehearsal not found"}`.
   `locate_rehearsal`: `new_folder` must be inside the recordings folder (`"Pick a folder inside the recordings folder"`), must be a directory, must not already be another rehearsal's (`self._lib.has(new_folder)` → `"That folder is already another rehearsal"`); then `self._lib.move_rehearsal(folder, new_folder)` → `{"ok": True, "folder": str(new_folder)}`.
   `choose_rehearsal_folder`: like `choose_recordings_dir` (window check, lazy `import webview`, `FOLDER_DIALOG` at `self._recordings_dir`, cancelled shape) then `locate_rehearsal(folder, picked[0])`.

9. **Module docstring and comments**: the module docstring and every comment that says `session.json` now say what is true (the library / the database). `_songs_of` is unchanged.

**Tests (`tests/test_engine.py`).** `fresh_api` already gives each test its own recordings folder, so the library is opened there. Go through every place that reads/writes `session.json` or calls `_read_meta`/`_write_meta` (grep for them — about 20) and move each check onto the library or the importer so it keeps asserting the same behaviour:
- checks that read the stored take list → `a._lib.rehearsal(folder)`;
- checks that *write* a `session.json` to stage an old or crashed rehearsal (drafts, legacy 16-bit, the cp1252 "Café" file) → write it, then `import_all(a._lib, a._cloud_dir)` (or create the Api after writing it, so `__init__` imports it) — the point of those checks is that such a rehearsal still works, which is now through the importer;
- checks that patch a stored take (e.g. removing `bit_depth` to fake an old take) → stage it as an old `session.json` and import, or update the row through `a._lib`;
- the "no `session.json.*` debris after a rename" check → "no `library.sqlite` changes left half-done": assert the renamed take is in `a._lib` and there is no `session.json` in the folder.
Add new checks (a section `[NN] The history lives in the database`):
- a started rehearsal is in `a._lib` and no `session.json` is written anywhere under the recordings folder after start → take → keep → rename take → rename rehearsal → markers → crop → share → delete take;
- `session_state()["takes"]` reflects a take kept, and a cloud error recorded from the publishing step, without any resync;
- a rehearsal folder deleted by hand → `list_rehearsals()` item `missing: True`, `disk_bytes == 0`; `get_rehearsal` → `missing: True`; `forget_rehearsal` removes it; `locate_rehearsal` onto a folder outside the recordings folder, onto a file, and onto another rehearsal's folder are each refused with the exact messages above; onto a real folder succeeds and `get_rehearsal` opens again;
- `set_recordings_dir` to a folder holding a newer database (stamp `alembic_version` to `'9999'` via `rehearsal_recorder.store.db.make_engine`) → `{"ok": False, "error": NEWER_DATABASE}` and `a.recordings_dir` unchanged;
- an Api opened on such a folder → `startup_problems()` returns one `LibraryUnavailable` with that message, a second call returns `[]`, `list_rehearsals()` raises `LibraryUnavailable`, and `get_settings()` still works;
- a broken `session.json` at startup → one `startup_problems()` entry naming the folder, file left in place;
- `config.json` is written through `config.json.writing` (after `save_appearance`, no `config.json.writing` is left and `config.json` parses).

- [ ] **Step 1:** Read `api.py`, `cloud.py`, `tests/test_engine.py` in full.
- [ ] **Step 2:** Write the new checks listed above in `tests/test_engine.py`; run `PYTHONIOENCODING=utf-8 $V/python tests/test_engine.py` and see them fail (AttributeError on `_lib`/`forget_rehearsal` etc.).
- [ ] **Step 3:** Rewrite `api.py` per the map, point by point.
- [ ] **Step 4:** Move the existing `session.json` checks as described.
- [ ] **Step 5:** `grep -n "session.json\|_read_meta\|_write_meta\|_meta_lock\|_save_session_meta" src/rehearsal_recorder/*.py` → only the importer-related mentions remain in comments that say "old session.json".
- [ ] **Step 6:** Run `PYTHONIOENCODING=utf-8 $V/python tests/run_all.py` (build the UI first) — all four suites pass.
- [ ] **Step 7:** Smoke on the real data, without touching it: copy `~/RehearsalRecordings` to a temp folder, point a fresh `Api` at it (patch `RECORDINGS_ROOT`/`CONFIG_PATH` like `fresh_api`), check `list_rehearsals()` returns the same rehearsals with the same take counts as the `session.json` files said, and that each file is gone from the copy. Report the numbers.
- [ ] **Step 8:** Commit: "Read and write the history through the database, not session.json".

---

### Task 3: "Not found on disk" and startup problems in the interface

**Files:**
- Modify: `ui/src/lib/api.ts`, `ui/src/screens/HistoryScreen.tsx`, the rehearsal row component it uses (`RehearsalRow`, find it with grep), `ui/src/main.tsx` or `ui/src/App.tsx`
- Test: `tests/test_interface.py`

**Interfaces — Consumes** (from Task 2): `forget_rehearsal(folder)`, `choose_rehearsal_folder(folder)`, `startup_problems()`, `RehearsalSummary.missing`, `get_rehearsal` missing shape.

- [ ] **Step 1: Types.** In `api.ts`: `RehearsalSummary.missing?: boolean` (doc comment: the folder is not on disk — deleted, renamed outside the app, or on a drive that is not plugged in); `RehearsalDetail.missing?: boolean`; in `PyApi`: `forget_rehearsal(folder: string): Promise<Ok>`, `choose_rehearsal_folder(folder: string): Promise<Ok<{ folder?: string; cancelled?: boolean }>>`, `startup_problems(): Promise<{ name: string; message: string }[]>`; add `"startup_problems"` to `ANSWERS_WITH_A_VALUE`.
- [ ] **Step 2: Startup problems.** Once, when the bridge is up (where `App` first talks to it after `waitForApi`), call `api().startup_problems()` and pass each to `reportBridgeError("startup", Object.assign(new Error(p.message), { name: p.name }))`. The ErrorBar shows the latest; that is enough (there is normally one).
- [ ] **Step 3: The row.** A missing rehearsal renders in the list with the badge "Not found on disk" (muted/destructive-outline, small, beside the subtitle), is not clickable (no `onClick`, `aria-disabled`), and instead of rename/delete offers two buttons: "Locate folder…" (calls `choose_rehearsal_folder(r.folder)`, then `refresh()`; a cancelled result does nothing; an error goes to `setError`) and "Remove from history" (opens a `ConfirmDialog`: title `Remove “<name>” from history?`, description `Only the entry goes — there is nothing on disk to delete. If the folder turns up again, it will not come back by itself.`, then `forget_rehearsal` → `refresh()`). Keep it as plain as the existing row; no new colours beyond the theme tokens.
- [ ] **Step 4: Tests.** In `tests/test_interface.py`: the mock's `list_rehearsals` gains one rehearsal with `missing: true` (keep every existing one unchanged so earlier checks keep their meaning); mock `forget_rehearsal`, `choose_rehearsal_folder`, `startup_problems` (returning `[]` by default; one test sets a problem via a `__STARTUP_PROBLEM__` substitution like the existing `__FAIL__` one) with call recording through `track()`. Checks: the badge text is shown on that row only; clicking the row does not open it (no `get_rehearsal` call recorded); "Locate folder…" calls `choose_rehearsal_folder` with that folder; "Remove from history" asks first and then calls `forget_rehearsal` with that folder; a startup problem appears in the "Something went wrong" bar with its message.
- [ ] **Step 5:** `cd ui && npx tsc -b && npm run build`, then `PYTHONIOENCODING=utf-8 $V/python tests/test_interface.py` — all pass. Take a screenshot of History with the missing row (the suite's screenshot helper) and look at it.
- [ ] **Step 6:** Commit: "Show a rehearsal whose folder is gone, and what went wrong opening the history".

---

### Task 4: Packaging, self-test, docs

**Files:**
- Modify: `packaging/rehearsal-recorder.spec`, `src/rehearsal_recorder/app.py`, `docs/using-it.md`, `docs/design-notes.md`, `docs/development.md`, `CHANGELOG.md`

- [ ] **Step 1: Bundle.** In the spec: `datas += [(str(ROOT / "src" / "rehearsal_recorder" / "store" / "migrations"), "rehearsal_recorder/store/migrations")]` with a comment (Alembic reads them from disk by path, so they are data, not imports); `hiddenimports` gains `*collect_submodules("alembic")`, `"sqlalchemy.dialects.sqlite"` and `"mako"` (import `collect_submodules` from `PyInstaller.utils.hooks` next to `collect_data_files`), with a comment why (migration modules import `alembic.op` and `sqlalchemy` only when they run, which the analysis cannot see).
- [ ] **Step 2: Self-test.** In `app.selftest`, a `database()` check: in a `tempfile.TemporaryDirectory()`, `Library(tmp)`, compare `current_revision` with the head of `ScriptDirectory.from_config(alembic_config())`, `close()`, return `f"migrations up to {head}"`. Register it as `check("history database", database)` after "numpy". Run `PYTHONPATH=src $V/python -m rehearsal_recorder --selftest` and see it ok.
- [ ] **Step 3: using-it.md.** "Where the files are": `library.sqlite` at the top of the recordings folder instead of `session.json` in each rehearsal ("the history — every rehearsal, take, marker and cloud copy; History is built from it"); a short paragraph: rehearsals from an older version are moved in the first time the folder is opened and their `session.json` removed; a rehearsal whose folder is gone shows "Not found on disk" with "Locate folder…" and "Remove from history"; a folder a newer version has opened cannot be used by an older one. Search the file for every other `session.json` mention and fix it.
- [ ] **Step 4: design-notes.md.** A section on the history database: why it sits in the recordings folder (moves with it; one file, not one per rehearsal, so History is one query), why paths are relative and to what, why settings stayed JSON, why songs are not stored, why import runs on every open. Replace the "Old rehearsals without `session.json`" bullet under "Deliberately not done" with "Folders with no entry in the database" (a folder copied in without a `session.json` does not appear; nothing scans for loose audio).
- [ ] **Step 5: development.md.** A "Changing the history's schema" section: edit `store/models.py`; `rm -f .alembic-scratch.sqlite* && alembic -c alembic.ini upgrade head && alembic -c alembic.ini revision --autogenerate -m "<what>"`; read the generated file — batch mode for ALTERs, a `server_default` for any new NOT NULL column (existing rows need a value), data moves written by hand; add a check in `tests/test_store.py` that loads data in the previous revision's shape and checks it after upgrade (see `migrations_with` there); `alembic -c alembic.ini check` must say "No new upgrade operations detected". Also add `store/` to the source tree listing in that file.
- [ ] **Step 6: CHANGELOG.md.** Under Unreleased: the history moved to `library.sqlite` in the recordings folder; old rehearsals move in by themselves; "Not found on disk"; the cloud folder can be moved without every take being sent again; settings are written atomically.
- [ ] **Step 7:** `PYTHONIOENCODING=utf-8 $V/python tests/run_all.py` — all pass. Commit: "Bundle the migrations, check them in the self-test, and say where the history lives".

---

## Appendices — the Task 1 files, verbatim

Each was run as written: `tests/test_store.py` passes against them.

### Appendix A: `tests/test_store.py`

````python
"""
The database the history lives in: its schema, its migrations, and the move
of every old session.json into it.

No sound card and no browser — only files in a temporary folder. The
migrations are exercised for real, on SQLite, the way the app runs them at
start; a chain of test-only migrations stands in for the ones later versions
will add, so the backup and the rollback are checked before there is a
second real migration to need them.
"""

import json
import shutil
import sys
import tempfile
import types
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))

# Nothing here plays sound, but the package imports the audio layer.
_sd = types.ModuleType("sounddevice")
_sd.query_devices = lambda *a, **k: []
_sd.query_hostapis = lambda: []
_sd.OutputStream = _sd.InputStream = None
sys.modules.setdefault("sounddevice", _sd)

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.runtime.migration import MigrationContext  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

from rehearsal_recorder.store import db  # noqa: E402
from rehearsal_recorder.store.importer import import_all  # noqa: E402
from rehearsal_recorder.store.library import Library  # noqa: E402
from rehearsal_recorder.store.models import Base  # noqa: E402

problems = []


def ok(label, cond):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def migrations_with(tmp, name, body):
    """The app's migrations plus one more, in a folder of their own."""
    folder = tmp / "migrations"
    if folder.exists():
        shutil.rmtree(folder)
    shutil.copytree(db.MIGRATIONS, folder, ignore=shutil.ignore_patterns("__pycache__"))
    (folder / "versions" / name).write_text(body, encoding="utf-8")
    return folder


SECOND = '''
revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    with op.batch_alter_table("rehearsal") as batch:
        batch.add_column(sa.Column("venue", sa.String(), nullable=True))
{extra}

def downgrade():
    pass
'''


def main():
    tmp = Path(tempfile.mkdtemp())

    print("\n[1] A new database is the models, exactly")
    rec = tmp / "Rec"
    rec.mkdir()
    engine = db.open_engine(rec)
    with engine.connect() as c:
        drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
        ok("the migrations build what models.py describes (no drift)", drift == [])
        ok("foreign keys are on",
           c.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1)
        ok("the journal is WAL",
           c.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal")
    ok("it is at the newest migration", db.current_revision(engine) == "0001")
    ok("it lives in the recordings folder", (rec / "library.sqlite").exists())
    ok("a new database is not backed up", not list(rec.glob("*.bak-*")))
    engine.dispose()

    print("\n[2] A database from a newer app is left alone")
    newer = tmp / "Newer"
    newer.mkdir()
    db.open_engine(newer).dispose()
    engine = db.make_engine(db.database_path(newer))
    with engine.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num = '9999'"))
    engine.dispose()
    before = db.database_path(newer).read_bytes()
    try:
        db.open_engine(newer).dispose()
        refused = None
    except db.LibraryUnavailable as e:
        refused = str(e)
    ok("it is refused", refused == db.NEWER_DATABASE)
    ok("and not a byte of it changed", db.database_path(newer).read_bytes() == before)

    print("\n[3] Migrating: a backup first, and all or nothing")
    old = tmp / "Old"
    old.mkdir()
    lib = Library(old)
    (old / "Jam").mkdir()
    lib.create_rehearsal(old / "Jam", "Jam", "2026-01-01T10:00:00", 48000, 24, [])
    lib.close()

    broken = migrations_with(tmp, "0002_broken.py", SECOND.format(
        extra='    op.execute("DELETE FROM rehearsal")\n'
              '    raise RuntimeError("the migration broke")\n'))
    try:
        db.open_engine(old, broken).dispose()
        failed = None
    except db.LibraryUnavailable as e:
        failed = str(e)
    ok("a failing migration makes the folder unavailable, saying why",
       failed is not None and "the migration broke" in failed)
    ok("the database was copied aside before it was touched",
       (old / "library.sqlite.bak-0001").exists())
    engine = db.make_engine(db.database_path(old))
    ok("it is still at the revision it was", db.current_revision(engine) == "0001")
    with engine.connect() as c:
        columns = [col["name"] for col in inspect(c).get_columns("rehearsal")]
        rows = c.execute(text("SELECT folder FROM rehearsal")).scalars().all()
    engine.dispose()
    ok("the half-done ALTER was rolled back", "venue" not in columns)
    ok("and so was the half-done DELETE", rows == ["Jam"])

    working = migrations_with(tmp, "0002_venue.py", SECOND.format(extra=""))
    engine = db.open_engine(old, working)
    ok("a working migration moves it on", db.current_revision(engine) == "0002")
    with engine.connect() as c:
        rows = c.execute(text("SELECT folder, venue FROM rehearsal")).all()
    engine.dispose()
    ok("with the data it had", [tuple(r) for r in rows] == [("Jam", None)])

    print("\n[4] The library: what goes in comes out, as the interface expects")
    rec = tmp / "Lib"
    rec.mkdir()
    cloud = tmp / "Cloud"
    cloud_setting = {"dir": cloud}
    lib = Library(rec, cloud_dir=lambda: cloud_setting["dir"])
    jam = rec / "Полынь - 2026-09-23 10-00"
    jam.mkdir()
    lib.create_rehearsal(jam, "Полынь", "2026-09-23T10:00:00", 48000, 24,
                         [{"name": "Gtr", "channel": 1}, {"name": "Vox", "channel": 2}])
    take = lib.add_take(jam, {
        "take_number": 1, "name": "Полынь", "duration_sec": 3.5,
        "tracks": [{"name": "Gtr", "file": str(jam / "01 - Полынь" / "Gtr.wav")}],
        "markers": [{"at": 1.234, "kind": "nonsense", "note": " hi "}, 0.5],
        "cloud_skip": True,
    })
    ok("a take comes back with absolute paths",
       take["tracks"] == [{"name": "Gtr", "file": str(jam / "01 - Полынь" / "Gtr.wav")}])
    ok("markers come back normalised and in order",
       take["markers"] == [{"at": 0.5, "kind": "note", "note": ""},
                           {"at": 1.23, "kind": "note", "note": "hi"}])
    ok("its own cloud answer is kept", take["cloud_skip"] is True and take["cloud_send"] is False)
    ok("nothing is in the cloud yet", take["cloud"] == {} and "cloud_error" not in take)
    try:
        lib.add_take(jam, {"take_number": 1, "name": "again", "tracks": []})
        duplicated = True
    except Exception:
        duplicated = False
    ok("a take number is used once per rehearsal", not duplicated)
    ok("a take of a rehearsal not in the library is refused",
       lib.add_take(rec / "Nowhere", {"take_number": 1, "name": "x"}) is None)

    sub = cloud / jam.name
    shared = {"mix": str(sub / "01 - Полынь.flac"), "mix_format": "flac",
              "gain": 0.7, "source": {"dir": jam.name, "what": "mix"}}
    lib.set_cloud_error(jam, 1, "the folder was gone")
    ok("a failure is kept with the take", lib.take(jam, 1)["cloud_error"] == "the folder was gone")
    lib.set_cloud_copy(jam, 1, shared, cloud)
    got = lib.take(jam, 1)
    ok("a copy comes back as it was recorded", got["cloud"] == shared)
    ok("and it settles the failure", "cloud_error" not in got)
    lib.set_cloud_copy(jam, 1, {**shared, "mix": str(sub / "01 - Полынь.mp3"),
                                "mix_format": "mp3"}, cloud)
    ok("a new copy replaces the old one",
       lib.take(jam, 1)["cloud"]["mix"] == str(sub / "01 - Полынь.mp3"))

    moved_cloud = tmp / "Cloud moved"
    cloud_setting["dir"] = moved_cloud
    ok("the cloud folder moving moves the copy with it",
       lib.take(jam, 1)["cloud"]["mix"] == str(moved_cloud / jam.name / "01 - Полынь.mp3"))
    cloud_setting["dir"] = None
    ok("with no cloud folder there is no copy to speak of", lib.take(jam, 1)["cloud"] == {})
    cloud_setting["dir"] = cloud
    ok("and it is back when the folder is", bool(lib.take(jam, 1)["cloud"]))

    kept = lib.edit_markers(jam, 1, lambda ms: ms + [{"at": 2.0, "kind": "good", "note": ""}])
    ok("markers are edited in one step", [m["at"] for m in kept] == [0.5, 1.23, 2.0])
    renamed = lib.update_take(jam, 1, name="Polyn", tracks=[
        {"name": "Gtr", "file": str(jam / "01 - Polyn" / "Gtr.wav")}])
    ok("a rename changes the name and the files",
       renamed["name"] == "Polyn"
       and renamed["tracks"][0]["file"] == str(jam / "01 - Polyn" / "Gtr.wav"))
    ok("and leaves the rest", renamed["duration_sec"] == 3.5 and len(renamed["markers"]) == 3)

    again = rec / "Polyn - 2026-09-23 10-00"
    jam.rename(again)
    lib.move_rehearsal(jam, again, "Polyn")
    moved = lib.rehearsal(again)
    ok("renaming a rehearsal is one change: its files follow",
       moved["name"] == "Polyn"
       and moved["takes"][0]["tracks"][0]["file"] == str(again / "01 - Polyn" / "Gtr.wav"))
    ok("the old folder is not a rehearsal any more", lib.rehearsal(jam) is None)
    ok("its track setup is kept, in order",
       moved["tracks"] == [{"name": "Gtr", "channel": 1}, {"name": "Vox", "channel": 2}])

    print("\n[5] A folder that went missing")
    ok("a folder on disk is not missing", lib.rehearsals()[0]["missing"] is False)
    shutil.rmtree(again)
    listed = lib.rehearsals()
    ok("a folder deleted by hand stays listed, marked",
       len(listed) == 1 and listed[0]["missing"] is True)
    ok("forgetting it drops it", lib.forget_rehearsal(again) and lib.rehearsals() == [])

    print("\n[6] Deleting cascades")
    gone = rec / "Gone"
    gone.mkdir()
    lib.create_rehearsal(gone, "Gone", "2026-09-24T10:00:00", 48000, 24, [])
    for n in (1, 2):
        lib.add_take(gone, {"take_number": n, "name": f"Take {n}", "markers": [1.0],
                            "tracks": [{"name": "Gtr", "file": str(gone / f"0{n}" / "Gtr.wav")}]})
    lib.set_cloud_copy(gone, 1, {"mix": str(cloud / "Gone" / "a.wav"), "source": {}}, cloud)
    ok("deleting a take says how many are left", lib.delete_take(gone, 1) == 1)
    lib.forget_rehearsal(gone)
    engine = db.make_engine(db.database_path(rec))
    with engine.connect() as c:
        left = {t: c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                for t in ("take", "take_file", "marker", "cloud_copy", "track")}
    engine.dispose()
    ok("a forgotten rehearsal leaves nothing behind", set(left.values()) == {0})
    lib.close()

    print("\n[7] Old session.json files move in")
    rec = tmp / "Import"
    rec.mkdir()
    cloud = tmp / "Import cloud"
    cafe = rec / "Café - 2020-01-01 10-00"
    (cafe / "01 - Café").mkdir(parents=True)
    # Written the way an old version on Windows wrote it: cp1252, absolute
    # paths from before the folder was moved, a bare-number marker, and no
    # bit depth (16-bit was all there was).
    (cafe / "session.json").write_bytes(json.dumps({
        "name": "Café",
        "created_at": "2020-01-01T10:00:00",
        "samplerate": 44100,
        "tracks": [{"name": "Gtr", "channel": 1}],
        "takes": [
            {"take_number": 1, "name": "Café", "duration_sec": 2,
             "tracks": [{"name": "Gtr",
                         "file": str(Path("D:/elsewhere/Café/01 - Café/Gtr.wav"))}],
             "markers": [3.14159],
             "cloud": {"mix": str(cloud / cafe.name / "01 - Café.wav"),
                       "mix_format": "wav", "gain": 1.0,
                       "source": {"dir": str(cloud / cafe.name), "what": "mix"}},
             "cloud_error": "it was offline", "cloud_send": True},
            {"take_number": 2, "name": "Take 2", "duration_sec": 1,
             "tracks": [{"name": "Gtr", "file": str(cafe / "02 - Take 2" / "Gtr.wav")}],
             "cloud": {"mix": str(Path("D:/somewhere else/a.wav"))}},
        ],
    }, ensure_ascii=False).encode("cp1252"))
    broken = rec / "Broken"
    broken.mkdir()
    (broken / "session.json").write_text("{not json", encoding="utf-8")

    lib = Library(rec, cloud_dir=lambda: cloud)
    reported = []
    result = import_all(lib, cloud, report=lambda folder, e: reported.append(folder.name))
    ok("the readable one is imported, the broken one is not",
       result == {"imported": 1, "failed": 1})
    ok("the broken one is reported", reported == ["Broken"])
    ok("and left where it was, for next time", (broken / "session.json").exists())
    ok("the imported one's session.json is gone", not (cafe / "session.json").exists())

    r = lib.rehearsal(cafe)
    first, second = r["takes"]
    ok("cp1252 text is read as cp1252", r["name"] == "Café" and first["name"] == "Café")
    ok("no bit depth meant 16", r["bit_depth"] == 16 and r["samplerate"] == 44100)
    ok("a path from before the folder moved is found again",
       first["tracks"][0]["file"] == str(cafe / "01 - Café" / "Gtr.wav"))
    ok("a path inside the folder is kept",
       second["tracks"][0]["file"] == str(cafe / "02 - Take 2" / "Gtr.wav"))
    ok("a bare-number marker becomes a marker",
       first["markers"] == [{"at": 3.14, "kind": "note", "note": ""}])
    ok("the cloud copy comes along, relative to the cloud folder",
       first["cloud"]["mix"] == str(cloud / cafe.name / "01 - Café.wav"))
    ok("its destination is the rehearsal's subfolder now",
       first["cloud"]["source"]["dir"] == cafe.name)
    ok("the take's own answers and errors come along",
       first["cloud_send"] is True and first["cloud_error"] == "it was offline")
    ok("a copy outside the cloud folder is dropped: the take counts as not sent",
       second["cloud"] == {})

    (cafe / "session.json").write_text("{}", encoding="utf-8")
    again = import_all(lib, cloud)
    ok("opening again imports nothing twice",
       again["imported"] == 0 and len(lib.rehearsals()) == 1)
    ok("a session.json left by a crash after the import is just removed",
       not (cafe / "session.json").exists())
    lib.close()

    no_cloud = tmp / "No cloud"
    (no_cloud / "Jam").mkdir(parents=True)
    (no_cloud / "Jam" / "session.json").write_text(json.dumps({
        "name": "Jam", "created_at": "2020-01-01T10:00:00", "samplerate": 48000,
        "bit_depth": 24, "tracks": [],
        "takes": [{"take_number": 1, "name": "Take 1", "tracks": [],
                   "cloud": {"mix": str(tmp / "x" / "a.wav"), "source": {}}}],
    }), encoding="utf-8")
    lib = Library(no_cloud)
    import_all(lib, None)
    lib.close()
    lib = Library(no_cloud, cloud_dir=lambda: tmp / "x")
    ok("with no cloud folder set, an old copy is not kept",
       lib.rehearsal(no_cloud / "Jam")["takes"][0]["cloud"] == {})
    lib.close()

    print()
    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print("All store checks passed.")


if __name__ == "__main__":
    main()
````

### Appendix B: `src/rehearsal_recorder/store/__init__.py`

````python
"""
The rehearsal history: one SQLite database per recordings folder.

models.py says what is kept, migrations/ how the file on disk got that way,
db.py opens it, library.py is what the rest of the app calls, and importer.py
moves in the session.json files older versions wrote.
"""
````

### Appendix C: `src/rehearsal_recorder/store/models.py`

````python
"""
What the app remembers about rehearsals, as tables.

The schema is owned by the migrations in migrations/versions: these classes
say what the code expects, and tests/test_store.py fails when the two drift
apart. Changing a column here means writing the migration for it — see
docs/development.md.

Paths are never stored absolute. A rehearsal's folder is relative to the
recordings folder, a take's files to the rehearsal folder, and a cloud copy
to the cloud folder, so moving any of the three moves what points into it.
"""

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Rehearsal(Base):
    __tablename__ = "rehearsal"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Relative to the recordings folder, with forward slashes.
    folder: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    # ISO, "2026-09-18T19:00:00" — sorts as text, as it always has.
    created_at: Mapped[str] = mapped_column(String)
    samplerate: Mapped[int] = mapped_column(Integer)
    bit_depth: Mapped[int] = mapped_column(Integer)

    tracks: Mapped[list["Track"]] = relationship(
        back_populates="rehearsal", cascade="all, delete-orphan",
        passive_deletes=True, order_by="Track.position",
    )
    takes: Mapped[list["Take"]] = relationship(
        back_populates="rehearsal", cascade="all, delete-orphan",
        passive_deletes=True, order_by="Take.take_number",
    )


class Track(Base):
    """One input as the rehearsal was set up: its name and which channel."""

    __tablename__ = "track"

    id: Mapped[int] = mapped_column(primary_key=True)
    rehearsal_id: Mapped[int] = mapped_column(
        ForeignKey("rehearsal.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    channel: Mapped[int] = mapped_column(Integer)

    rehearsal: Mapped[Rehearsal] = relationship(back_populates="tracks")


class Take(Base):
    __tablename__ = "take"
    __table_args__ = (UniqueConstraint("rehearsal_id", "take_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rehearsal_id: Mapped[int] = mapped_column(
        ForeignKey("rehearsal.id", ondelete="CASCADE"), index=True
    )
    take_number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    duration_sec: Mapped[float] = mapped_column(Float, default=0.0)
    # This take's own answer on the review screen — see Api.keep_take.
    cloud_skip: Mapped[bool] = mapped_column(Boolean, default=False)
    cloud_send: Mapped[bool] = mapped_column(Boolean, default=False)
    # Why the last copy to the cloud folder failed, until one succeeds.
    cloud_error: Mapped[str | None] = mapped_column(String, nullable=True)

    rehearsal: Mapped[Rehearsal] = relationship(back_populates="takes")
    files: Mapped[list["TakeFile"]] = relationship(
        back_populates="take", cascade="all, delete-orphan",
        passive_deletes=True, order_by="TakeFile.position",
    )
    markers: Mapped[list["Marker"]] = relationship(
        back_populates="take", cascade="all, delete-orphan",
        passive_deletes=True, order_by="Marker.at",
    )
    cloud_copy: Mapped["CloudCopy | None"] = relationship(
        back_populates="take", cascade="all, delete-orphan",
        passive_deletes=True, uselist=False,
    )


class TakeFile(Base):
    """One track of a take on disk."""

    __tablename__ = "take_file"

    id: Mapped[int] = mapped_column(primary_key=True)
    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    # Relative to the rehearsal folder: "01 - Verse riff/Guitar 1.wav".
    file: Mapped[str] = mapped_column(String)

    take: Mapped[Take] = relationship(back_populates="files")


class Marker(Base):
    __tablename__ = "marker"

    id: Mapped[int] = mapped_column(primary_key=True)
    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), index=True
    )
    # Seconds into the take, rounded to 0.01 — see library.as_marker.
    at: Mapped[float] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String, default="note")
    note: Mapped[str] = mapped_column(String, default="")

    take: Mapped[Take] = relationship(back_populates="markers")


class CloudCopy(Base):
    """What of a take is in the cloud folder. No row: nothing is."""

    __tablename__ = "cloud_copy"

    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), primary_key=True
    )
    # Both relative to the cloud folder.
    mix: Mapped[str | None] = mapped_column(String, nullable=True)
    mix_format: Mapped[str | None] = mapped_column(String, nullable=True)
    gain: Mapped[float | None] = mapped_column(Float, nullable=True)
    tracks: Mapped[str | None] = mapped_column(String, nullable=True)
    tracks_format: Mapped[str | None] = mapped_column(String, nullable=True)
    # What the copy was made from — cloud.source_of.
    source: Mapped[dict] = mapped_column(JSON, default=dict)

    take: Mapped[Take] = relationship(back_populates="cloud_copy")
````

### Appendix D: `src/rehearsal_recorder/store/db.py`

````python
"""
Opening a recordings folder's database, and bringing its schema up to date.

The database sits in the recordings folder itself, as library.sqlite, so the
history travels with the recordings. Every connection turns on foreign keys
(SQLite leaves them off, and without them a deleted take would leave its
markers behind), WAL (the publishing thread writes while the interface
reads), and a busy timeout (two writers meeting wait instead of failing).

The schema is Alembic's: `open_engine` upgrades to the newest migration this
app ships, after copying the file aside, and refuses a database a newer app
has already moved past — it cannot know what that one means by its tables.
"""

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL

DB_NAME = "library.sqlite"
MIGRATIONS = Path(__file__).resolve().parent / "migrations"

NEWER_DATABASE = (
    "This recordings folder was opened by a newer version of Rehearsal "
    "Recorder — update the app to use it."
)


class LibraryUnavailable(Exception):
    """The recordings folder's database cannot be used. The message is said
    to the person as it is."""


def database_path(recordings_dir):
    return Path(recordings_dir) / DB_NAME


def alembic_config(connection=None, migrations=MIGRATIONS):
    """Alembic's settings, built in code: the app has no alembic.ini of its
    own, and the migrations are found next to this file wherever the package
    was installed or bundled. `migrations` is another folder only in tests."""
    cfg = Config()
    cfg.set_main_option("script_location", str(migrations))
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def make_engine(path):
    engine = create_engine(URL.create("sqlite", database=str(path)))

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):
        # The driver's own transaction handling is switched off and SQLAlchemy
        # emits BEGIN itself (the "begin" hook below). Left to the driver, a
        # CREATE or ALTER runs outside any transaction, and a migration that
        # fails half way would leave half a schema behind.
        dbapi_connection.isolation_level = None
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    @event.listens_for(engine, "begin")
    def _on_begin(connection):
        connection.exec_driver_sql("BEGIN")

    return engine


def current_revision(engine):
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def _backup(path, revision):
    """A copy of the database as it was before migrating, through SQLite's own
    backup so whatever is still in the WAL is in the copy too."""
    target = path.with_name(f"{path.name}.bak-{revision}")
    source = sqlite3.connect(str(path))
    try:
        copy = sqlite3.connect(str(target))
        try:
            source.backup(copy)
        finally:
            copy.close()
    finally:
        source.close()
    return target


def open_engine(recordings_dir, migrations=MIGRATIONS):
    """
    The recordings folder's database, created if there is none and upgraded
    to the newest schema. Raises LibraryUnavailable when it cannot be used;
    the file is then exactly as it was found.
    """
    path = database_path(recordings_dir)
    engine = make_engine(path)
    try:
        script = ScriptDirectory.from_config(alembic_config(migrations=migrations))
        head = script.get_current_head()
        current = current_revision(engine)
        if current is not None:
            try:
                script.get_revision(current)
            except CommandError:
                raise LibraryUnavailable(NEWER_DATABASE) from None
        if current != head:
            if current is not None:
                _backup(path, current)
            with engine.begin() as connection:
                command.upgrade(alembic_config(connection, migrations), "head")
    except LibraryUnavailable:
        engine.dispose()
        raise
    except Exception as e:
        engine.dispose()
        raise LibraryUnavailable(
            f"Could not open the recordings database ({path}): {e}"
        ) from e
    return engine
````

### Appendix E: `src/rehearsal_recorder/store/migrations/env.py`

````python
"""
Alembic's entry point for this app's migrations.

The app runs them itself (store/db.py) and hands over its open connection in
`config.attributes["connection"]`. The alembic command line, which is only
for writing a new migration, has no such connection and opens the database
named in alembic.ini at the repository root instead.
"""

from alembic import context
from sqlalchemy import create_engine

from rehearsal_recorder.store.models import Base

config = context.config


def _run(connection):
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        # SQLite can hardly ALTER a table; batch mode rebuilds it instead.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


connection = config.attributes.get("connection")
if connection is not None:
    _run(connection)
else:
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    with engine.begin() as connection:
        _run(connection)
````

### Appendix F: `src/rehearsal_recorder/store/migrations/script.py.mako`

````mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: Union[str, Sequence[str], None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    """Upgrade schema."""
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    """Downgrade schema."""
    ${downgrades if downgrades else "pass"}
````

### Appendix G: `src/rehearsal_recorder/store/migrations/versions/0001_initial.py`

````python
"""initial

Revision ID: 0001
Revises: 
Create Date: 2026-09-23 16:07:08.272447

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table('rehearsal',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('folder', sa.String(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('created_at', sa.String(), nullable=False),
    sa.Column('samplerate', sa.Integer(), nullable=False),
    sa.Column('bit_depth', sa.Integer(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('folder')
    )
    op.create_table('take',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('rehearsal_id', sa.Integer(), nullable=False),
    sa.Column('take_number', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('duration_sec', sa.Float(), nullable=False),
    sa.Column('cloud_skip', sa.Boolean(), nullable=False),
    sa.Column('cloud_send', sa.Boolean(), nullable=False),
    sa.Column('cloud_error', sa.String(), nullable=True),
    sa.ForeignKeyConstraint(['rehearsal_id'], ['rehearsal.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('rehearsal_id', 'take_number')
    )
    with op.batch_alter_table('take', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_take_rehearsal_id'), ['rehearsal_id'], unique=False)

    op.create_table('track',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('rehearsal_id', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('channel', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['rehearsal_id'], ['rehearsal.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('track', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_track_rehearsal_id'), ['rehearsal_id'], unique=False)

    op.create_table('cloud_copy',
    sa.Column('take_id', sa.Integer(), nullable=False),
    sa.Column('mix', sa.String(), nullable=True),
    sa.Column('mix_format', sa.String(), nullable=True),
    sa.Column('gain', sa.Float(), nullable=True),
    sa.Column('tracks', sa.String(), nullable=True),
    sa.Column('tracks_format', sa.String(), nullable=True),
    sa.Column('source', sa.JSON(), nullable=False),
    sa.ForeignKeyConstraint(['take_id'], ['take.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('take_id')
    )
    op.create_table('marker',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('take_id', sa.Integer(), nullable=False),
    sa.Column('at', sa.Float(), nullable=False),
    sa.Column('kind', sa.String(), nullable=False),
    sa.Column('note', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['take_id'], ['take.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('marker', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_marker_take_id'), ['take_id'], unique=False)

    op.create_table('take_file',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('take_id', sa.Integer(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(), nullable=False),
    sa.Column('file', sa.String(), nullable=False),
    sa.ForeignKeyConstraint(['take_id'], ['take.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('take_file', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_take_file_take_id'), ['take_id'], unique=False)

    # ### end Alembic commands ###


def downgrade() -> None:
    """Downgrade schema."""
    # ### commands auto generated by Alembic - please adjust! ###
    with op.batch_alter_table('take_file', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_take_file_take_id'))

    op.drop_table('take_file')
    with op.batch_alter_table('marker', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_marker_take_id'))

    op.drop_table('marker')
    op.drop_table('cloud_copy')
    with op.batch_alter_table('track', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_track_rehearsal_id'))

    op.drop_table('track')
    with op.batch_alter_table('take', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_take_rehearsal_id'))

    op.drop_table('take')
    op.drop_table('rehearsal')
    # ### end Alembic commands ###
````

### Appendix H: `src/rehearsal_recorder/store/library.py`

````python
"""
Everything api.py reads or writes about rehearsals and takes.

Each method is one transaction, so a change is all there or not at all, and
two threads never see each other's half-made edit. What comes back is plain
dicts in the shapes the interface has always been sent — absolute paths
included — so nothing past this module knows the data moved into a database.

Folders are passed in and handed back as absolute paths. Inside, a rehearsal
is its folder relative to the recordings folder, a take's files are relative
to the rehearsal folder, and a cloud copy is relative to the cloud folder;
see models.py for why.
"""

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import selectinload, sessionmaker

from rehearsal_recorder.store.db import MIGRATIONS, open_engine
from rehearsal_recorder.store.models import CloudCopy, Marker, Rehearsal, Take, TakeFile, Track

MARKER_KINDS = ("note", "good", "issue", "redo")


def as_marker(value):
    """
    A marker as it is kept: a spot rounded to 0.01 s, one of MARKER_KINDS,
    and a note of at most 200 characters. The earliest versions stored a bare
    number, which still comes in through old session.json files.
    """
    if isinstance(value, dict):
        at = round(float(value.get("at", 0.0)), 2)
        kind = value.get("kind", "note")
        note = str(value.get("note", "")).strip()[:200]
    else:
        at = round(float(value), 2)
        kind, note = "note", ""
    if kind not in MARKER_KINDS:
        kind = "note"
    return {"at": at, "kind": kind, "note": note}


def _relative(path, root):
    """`path` relative to `root`, with forward slashes; ValueError when it is
    not inside."""
    return Path(path).resolve().relative_to(Path(root).resolve()).as_posix()


_WITH_TAKES = (
    selectinload(Rehearsal.tracks),
    selectinload(Rehearsal.takes).selectinload(Take.files),
    selectinload(Rehearsal.takes).selectinload(Take.markers),
    selectinload(Rehearsal.takes).selectinload(Take.cloud_copy),
)


class Library:
    def __init__(self, recordings_dir, cloud_dir=lambda: None, migrations=MIGRATIONS):
        """
        cloud_dir: a function returning the cloud folder from the settings, or
        None. Asked on every read, because the setting changes while the app
        runs.
        """
        self.recordings_dir = Path(recordings_dir)
        self._cloud_dir = cloud_dir
        self._engine = open_engine(self.recordings_dir, migrations)
        self._session = sessionmaker(self._engine, expire_on_commit=False)

    def close(self):
        """Lets go of the file, which Windows needs before it can be moved."""
        self._engine.dispose()

    # ---------- paths ----------

    def key(self, folder):
        """How a rehearsal folder is stored. ValueError outside the
        recordings folder."""
        return _relative(folder, self.recordings_dir)

    def _folder(self, key):
        return self.recordings_dir / Path(key)

    def _find(self, db, folder, *options):
        try:
            key = self.key(folder)
        except ValueError:
            return None
        return db.scalars(
            select(Rehearsal).where(Rehearsal.folder == key).options(*options)
        ).one_or_none()

    def _find_take(self, db, folder, take_number, *options):
        rehearsal = self._find(db, folder)
        if rehearsal is None:
            return None
        return db.scalars(
            select(Take)
            .where(Take.rehearsal_id == rehearsal.id, Take.take_number == take_number)
            .options(*options)
        ).one_or_none()

    # ---------- shapes ----------

    def _cloud_dict(self, copy):
        cloud = self._cloud_dir()
        if copy is None or cloud is None:
            return {}
        out = {}
        if copy.mix:
            out["mix"] = str(Path(cloud) / copy.mix)
            if copy.mix_format is not None:
                out["mix_format"] = copy.mix_format
            if copy.gain is not None:
                out["gain"] = copy.gain
        if copy.tracks:
            out["tracks"] = str(Path(cloud) / copy.tracks)
            if copy.tracks_format is not None:
                out["tracks_format"] = copy.tracks_format
        out["source"] = dict(copy.source or {})
        return out

    def _take_dict(self, folder, take):
        out = {
            "take_number": take.take_number,
            "name": take.name,
            "duration_sec": take.duration_sec,
            "tracks": [
                {"name": f.name, "file": str(folder / Path(f.file))} for f in take.files
            ],
            "markers": [
                {"at": m.at, "kind": m.kind, "note": m.note} for m in take.markers
            ],
            "cloud": self._cloud_dict(take.cloud_copy),
            "cloud_skip": take.cloud_skip,
            "cloud_send": take.cloud_send,
        }
        if take.cloud_error:
            out["cloud_error"] = take.cloud_error
        return out

    def _rehearsal_dict(self, rehearsal):
        folder = self._folder(rehearsal.folder)
        return {
            "folder": str(folder),
            "name": rehearsal.name,
            "created_at": rehearsal.created_at,
            "samplerate": rehearsal.samplerate,
            "bit_depth": rehearsal.bit_depth,
            "tracks": [{"name": t.name, "channel": t.channel} for t in rehearsal.tracks],
            "takes": [self._take_dict(folder, t) for t in rehearsal.takes],
            "missing": not folder.is_dir(),
        }

    @staticmethod
    def _files(folder, tracks):
        """[{"name", "file": absolute}] → rows relative to the rehearsal."""
        return [
            TakeFile(position=i, name=t["name"], file=_relative(t["file"], folder))
            for i, t in enumerate(tracks)
        ]

    # ---------- rehearsals ----------

    def rehearsals(self):
        """Every rehearsal, newest first, each with its takes."""
        with self._session() as db:
            rows = db.scalars(
                select(Rehearsal).options(*_WITH_TAKES).order_by(Rehearsal.created_at.desc())
            ).all()
            return [self._rehearsal_dict(r) for r in rows]

    def rehearsal(self, folder):
        with self._session() as db:
            row = self._find(db, folder, *_WITH_TAKES)
            return None if row is None else self._rehearsal_dict(row)

    def has(self, folder):
        with self._session() as db:
            return self._find(db, folder) is not None

    def create_rehearsal(self, folder, name, created_at, samplerate, bit_depth, tracks):
        with self._session.begin() as db:
            db.add(Rehearsal(
                folder=self.key(folder),
                name=name,
                created_at=created_at,
                samplerate=int(samplerate),
                bit_depth=int(bit_depth),
                tracks=[
                    Track(position=i, name=t["name"], channel=int(t["channel"]))
                    for i, t in enumerate(tracks)
                ],
            ))

    def import_rehearsal(self, folder, *, name, created_at, samplerate, bit_depth,
                         tracks, takes, cloud, cloud_errors, cloud_dir):
        """
        A whole rehearsal at once, for the importer: all of it goes in or none
        of it does. takes as for add_take; cloud: {take_number: shared} as for
        set_cloud_copy, relative to cloud_dir; cloud_errors: {take_number:
        message}.
        """
        folder = Path(folder)
        with self._session.begin() as db:
            db.add(Rehearsal(
                folder=self.key(folder),
                name=name,
                created_at=created_at,
                samplerate=int(samplerate),
                bit_depth=int(bit_depth),
                tracks=[
                    Track(position=i, name=t["name"], channel=int(t["channel"]))
                    for i, t in enumerate(tracks)
                ],
                takes=[
                    Take(
                        take_number=int(t["take_number"]),
                        name=t["name"],
                        duration_sec=float(t.get("duration_sec") or 0.0),
                        cloud_skip=bool(t.get("cloud_skip")),
                        cloud_send=bool(t.get("cloud_send")),
                        cloud_error=cloud_errors.get(int(t["take_number"])),
                        files=self._files(folder, t.get("tracks", [])),
                        markers=[Marker(**as_marker(m)) for m in t.get("markers", [])],
                        cloud_copy=self._cloud_row(cloud.get(int(t["take_number"])), cloud_dir),
                    )
                    for t in takes
                ],
            ))

    def move_rehearsal(self, folder, new_folder, name=None):
        """The folder was renamed on disk (or found again elsewhere): point the
        rehearsal at it. Its takes' files are relative to it, so they follow."""
        with self._session.begin() as db:
            row = self._find(db, folder)
            if row is None:
                return False
            row.folder = self.key(new_folder)
            if name is not None:
                row.name = name
            return True

    def forget_rehearsal(self, folder):
        """Drops the rehearsal and everything under it from the database. The
        folder on disk is not touched."""
        with self._session.begin() as db:
            row = self._find(db, folder)
            if row is None:
                return False
            db.delete(row)
            return True

    # ---------- takes ----------

    def take(self, folder, take_number):
        with self._session() as db:
            row = self._find_take(
                db, folder, take_number,
                selectinload(Take.files), selectinload(Take.markers),
                selectinload(Take.cloud_copy),
            )
            return None if row is None else self._take_dict(Path(folder), row)

    def add_take(self, folder, take):
        """
        take: {"take_number", "name", "duration_sec", "tracks": [{"name",
        "file": absolute}], "markers"?, "cloud_skip"?, "cloud_send"?}.
        Returns the take as it is now kept, or None without the rehearsal.
        """
        folder = Path(folder)
        with self._session.begin() as db:
            rehearsal = self._find(db, folder)
            if rehearsal is None:
                return None
            row = Take(
                rehearsal_id=rehearsal.id,
                take_number=int(take["take_number"]),
                name=take["name"],
                duration_sec=float(take.get("duration_sec") or 0.0),
                cloud_skip=bool(take.get("cloud_skip")),
                cloud_send=bool(take.get("cloud_send")),
                files=self._files(folder, take.get("tracks", [])),
                markers=[Marker(**as_marker(m)) for m in take.get("markers", [])],
            )
            db.add(row)
            db.flush()
            db.refresh(row)
            return self._take_dict(folder, row)

    def update_take(self, folder, take_number, *, name=None, duration_sec=None,
                    tracks=None, markers=None):
        """Changes what is given and leaves the rest. tracks: the take's files
        at their new absolute paths. Returns the take, or None."""
        folder = Path(folder)
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number)
            if row is None:
                return None
            if name is not None:
                row.name = name
            if duration_sec is not None:
                row.duration_sec = float(duration_sec)
            if tracks is not None:
                row.files = self._files(folder, tracks)
            if markers is not None:
                row.markers = [Marker(**as_marker(m)) for m in markers]
            db.flush()
            db.refresh(row)
            return self._take_dict(folder, row)

    def edit_markers(self, folder, take_number, fn):
        """fn(markers) -> markers, read and written in one transaction.
        Returns the markers as kept, or None without the take."""
        folder = Path(folder)
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number, selectinload(Take.markers))
            if row is None:
                return None
            current = [{"at": m.at, "kind": m.kind, "note": m.note} for m in row.markers]
            kept = sorted((as_marker(m) for m in fn(current)), key=lambda m: m["at"])
            row.markers = [Marker(**m) for m in kept]
            return kept

    def delete_take(self, folder, take_number):
        """Returns how many takes the rehearsal has left, or None."""
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number)
            if row is None:
                return None
            rehearsal_id = row.rehearsal_id
            db.delete(row)
            db.flush()
            return len(db.scalars(select(Take.id).where(Take.rehearsal_id == rehearsal_id)).all())

    # ---------- the cloud ----------

    def set_cloud_copy(self, folder, take_number, shared, cloud_dir):
        """
        What of a take is now in the cloud folder, from share_take — its paths
        absolute, inside `cloud_dir`, the folder they were written into. A copy
        that succeeded settles whatever went wrong last time, so the error is
        cleared. shared=None: nothing of it is there any more.

        Only the take's cloud fields are written, so a rename that landed while
        the copy was being made is kept.
        """
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number, selectinload(Take.cloud_copy))
            if row is None:
                return False
            row.cloud_error = None
            row.cloud_copy = self._cloud_row(shared, cloud_dir)
            return True

    @staticmethod
    def _cloud_row(shared, cloud_dir):
        if not shared:
            return None
        return CloudCopy(
            mix=_relative(shared["mix"], cloud_dir) if shared.get("mix") else None,
            mix_format=shared.get("mix_format"),
            gain=shared.get("gain"),
            tracks=_relative(shared["tracks"], cloud_dir) if shared.get("tracks") else None,
            tracks_format=shared.get("tracks_format"),
            source=dict(shared.get("source") or {}),
        )

    def set_cloud_error(self, folder, take_number, message):
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number)
            if row is None:
                return False
            row.cloud_error = message
            return True
````

### Appendix I: `src/rehearsal_recorder/store/importer.py`

````python
"""
Bringing session.json files into the database.

Up to this version every rehearsal folder described itself in a session.json.
Each one is read once, put into the database in one transaction and then
deleted. It runs every time a recordings folder is opened, not just the
first, so a rehearsal copied in from a machine still on an older version is
picked up as well.

This is the only place that still has to guess at old shapes: fields added
over the years are filled in here with what they meant before they existed,
and everything past it reads complete rows.
"""

import json
import sys
from pathlib import Path

from rehearsal_recorder.audio.format import LEGACY_DEPTH
from rehearsal_recorder.store.library import as_marker

SESSION_FILE = "session.json"


def read_text(path):
    """
    A JSON file of ours, as text. Written as UTF-8 now; an older version wrote
    whatever the system's code page was, which on Windows is cp1252 — so a
    file that is not UTF-8 is read that way rather than taken for damaged.
    Read as damaged, a rehearsal with a "Café" in it would simply vanish from
    History.
    """
    raw = Path(path).read_bytes()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("cp1252", errors="replace")


def _inside(path, root):
    try:
        return Path(path).resolve().relative_to(Path(root).resolve())
    except ValueError:
        return None


def _track_file(folder, stored):
    """
    Where a take's track is now. Paths were stored absolute, so a folder
    renamed or moved by hand left them pointing at where it used to be; the
    take's own folder and the file's name are still right, so it is found
    again from those.
    """
    stored = Path(stored)
    if _inside(stored, folder) is not None:
        return str(stored)
    return str(Path(folder) / stored.parent.name / stored.name)


def _cloud(record, cloud_dir):
    """An old take["cloud"], or None when it cannot be kept: no cloud folder
    is set, or the copy is not inside the one that is."""
    if not record or cloud_dir is None:
        return None
    for key in ("mix", "tracks"):
        if record.get(key) and _inside(record[key], cloud_dir) is None:
            return None
    if not (record.get("mix") or record.get("tracks")):
        return None
    source = dict(record.get("source") or {})
    if source.get("dir"):
        # The absolute destination became the rehearsal's subfolder.
        source["dir"] = Path(source["dir"]).name
    return {**record, "source": source}


def _take(folder, take):
    return {
        "take_number": int(take.get("take_number", 0)),
        "name": take.get("name") or f"Take {take.get('take_number', 0)}",
        "duration_sec": float(take.get("duration_sec") or 0.0),
        "tracks": [
            {"name": t.get("name", ""), "file": _track_file(folder, t["file"])}
            for t in take.get("tracks", [])
            if t.get("file")
        ],
        "markers": [as_marker(m) for m in take.get("markers", [])],
        "cloud_skip": bool(take.get("cloud_skip")),
        "cloud_send": bool(take.get("cloud_send")),
    }


def import_folder(library, folder, cloud_dir):
    """
    One rehearsal folder's session.json into the database. Returns "imported",
    "cleaned" (it was already in, the app died before deleting the file),
    "absent", or raises for a file that cannot be read — which is left where
    it is.
    """
    folder = Path(folder)
    path = folder / SESSION_FILE
    if not path.exists():
        return "absent"
    if library.has(folder):
        _remove(folder)
        return "cleaned"

    meta = json.loads(read_text(path))
    takes = [t for t in meta.get("takes", []) if isinstance(t, dict)]
    library.import_rehearsal(
        folder,
        name=meta.get("name") or folder.name,
        created_at=meta.get("created_at", ""),
        samplerate=int(meta.get("samplerate") or 48000),
        bit_depth=int(meta.get("bit_depth") or LEGACY_DEPTH),
        tracks=[
            {"name": t.get("name", ""), "channel": int(t.get("channel", 1))}
            for t in meta.get("tracks", [])
        ],
        takes=[_take(folder, t) for t in takes],
        cloud={
            int(t.get("take_number", 0)): c
            for t in takes
            if (c := _cloud(t.get("cloud"), cloud_dir)) is not None
        },
        cloud_errors={
            int(t.get("take_number", 0)): t["cloud_error"]
            for t in takes
            if t.get("cloud_error")
        },
        cloud_dir=cloud_dir,
    )
    _remove(folder)
    return "imported"


def _remove(folder):
    for name in (SESSION_FILE, SESSION_FILE + ".writing"):
        (Path(folder) / name).unlink(missing_ok=True)


def import_all(library, cloud_dir, report=None):
    """
    Every session.json directly under the recordings folder. A file that
    cannot be read is left in place for next time and passed to
    report(folder, error); the rest still go in.
    """
    root = library.recordings_dir
    if not root.is_dir():
        return {"imported": 0, "failed": 0}
    imported = failed = 0
    for folder in sorted(root.iterdir()):
        if not folder.is_dir():
            continue
        try:
            if import_folder(library, folder, cloud_dir) == "imported":
                imported += 1
        except Exception as e:
            failed += 1
            print(f"[import] {folder}: {type(e).__name__}: {e}", file=sys.stderr)
            if report is not None:
                report(folder, e)
    return {"imported": imported, "failed": failed}
````
