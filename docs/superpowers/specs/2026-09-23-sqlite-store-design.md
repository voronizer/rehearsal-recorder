# Rehearsals in SQLite, with migrations

Everything the app knows about a rehearsal lives in a `session.json` inside
its folder, and History is built by opening every one of them. There is no
schema version: fields have been added as they were needed, and old files are
read through `.get(…, default)` and guesses in 27 places. Every change is a
read-modify-write of the whole document under `_meta_lock`, with the
publishing thread and the interface both doing it.

This moves rehearsals and takes into one SQLite database per recordings
folder, with the schema owned by Alembic migrations.

## Decisions

- **Where the database is: the root of the recordings folder**,
  `<recordings>/library.sqlite`. Moving the whole recordings folder takes the
  history with it. Every path inside it is relative to that folder.
- **Settings stay `config.json`.** A flat set of keys each with a default; a
  missing key is its default, and losing the file costs picking the devices
  again. The only format change it ever had (device index → name + audio
  system) was handled by `saved_device` without a migration. It also holds
  `recordings_dir`, so it cannot live in the database it points to. The one
  change: it is written atomically (beside the real file, then `os.replace`),
  as `session.json` already was.
- **Alembic + SQLAlchemy 2.0 ORM.** Alembic is the maintained standard
  (1.20.0, 2026-09-11); yoyo-migrations has had no release since 2024-08.
  No hand-rolled migration runner.
- **`session.json` is imported and then deleted.** The database is the only
  source of truth afterwards.
- **A rehearsal whose folder is gone stays in History, marked**, with "Remove
  from history" and "Locate folder…". Nothing disappears silently — the folder
  may be on a drive that is not plugged in.
- **Songs are not stored.** They are still derived from take names by
  `_songs_of`: that is a rule, and a stored copy of it would drift from the
  names.

## Layout

```
~/RehearsalRecordings/
  library.sqlite                  ← new; WAL mode (-wal / -shm beside it)
  library.sqlite.bak-<revision>   ← only after a migration ran
  Tuesday jam - 2026-09-18 19-00/
    _drafts/take 3/…              ← unchanged, still files
    01 - Verse riff/*.wav
```

```
src/rehearsal_recorder/store/
  __init__.py
  models.py        ORM models
  db.py            open(recordings_dir) → engine + sessionmaker; pragmas,
                   upgrade with backup, refusal of a newer database
  library.py       the operations api.py uses, one transaction each,
                   returning dicts shaped like today's API responses
  importer.py      session.json → rows
  migrations/      Alembic: env.py, script.py.mako, versions/0001_initial.py
```

`api.py` stops knowing about `session.json`: `_read_meta`, `_write_meta`,
`_save_session_meta` and `_meta_lock`'s read-modify-write cycles are replaced
by `library` calls. The interface keeps receiving the same shapes, so the UI
changes only for the "missing" state.

## Schema (migration 0001)

| Table | Columns |
|---|---|
| `rehearsal` | `id` PK, `folder` TEXT UNIQUE NOT NULL (relative to the recordings folder), `name`, `created_at` TEXT (ISO, as today), `samplerate` INT, `bit_depth` INT |
| `track` | `id` PK, `rehearsal_id` → rehearsal ON DELETE CASCADE, `position` INT, `name`, `channel` INT — the rehearsal's track setup |
| `take` | `id` PK, `rehearsal_id` → rehearsal CASCADE, `take_number` INT, `name`, `duration_sec` REAL, `cloud_skip` BOOL default false, `cloud_send` BOOL default false, `cloud_error` TEXT NULL; UNIQUE(`rehearsal_id`, `take_number`) |
| `take_file` | `id` PK, `take_id` → take CASCADE, `position` INT, `name`, `file` TEXT (relative to the recordings folder) |
| `marker` | `id` PK, `take_id` → take CASCADE, `at` REAL (rounded to 0.01 as `_as_marker` does), `kind`, `note` |
| `cloud_copy` | `take_id` PK → take CASCADE, `mix` TEXT NULL, `mix_format` TEXT NULL, `gain` REAL NULL, `tracks` TEXT NULL, `tracks_format` TEXT NULL, `source` JSON — today's `take["cloud"]`; no row = not in the cloud |

`mix` and `tracks` in `cloud_copy` stay absolute: they point into the cloud
folder, outside the recordings folder.

Renaming a rehearsal becomes one `UPDATE rehearsal SET folder`, plus the
folder move; renaming a take updates its `take_file.file` rows. Neither
rewrites paths across the whole rehearsal any more.

## Opening a database

On start and whenever the recordings folder changes:

1. Open (create if absent) `library.sqlite`. Every connection sets
   `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000`.
2. Read the Alembic revision.
   - **Unknown to this app** (written by a newer version): do not touch the
     file. History and recording into that folder are unavailable, and the
     app says so: "This recordings folder was opened by a newer version of
     Rehearsal Recorder — update the app to use it." Settings still work, so
     another folder can be chosen.
   - **Below head, on a database with data**: copy it to
     `library.sqlite.bak-<revision>` first (via the SQLite backup API, so the
     WAL is included), then `upgrade head`. Each migration runs in a
     transaction; on failure the database is left as it was, the traceback
     goes to crash.log and the error to the ErrorBar, and the folder is
     unavailable as above.
   - **New/empty**: `upgrade head`, no backup.
3. Import (below).

## Importing `session.json`

Runs on every open, not once, so a folder brought over from an older version
is picked up too. For each direct subfolder of the recordings folder holding
a `session.json`:

- **Folder not in the database**: insert the rehearsal, its tracks, takes,
  take files, markers and cloud fields in one transaction; after commit,
  delete `session.json` (and any `session.json.writing`). Absolute file paths
  are made relative to the recordings folder; a path outside it (the folder
  was moved) is re-rooted as `<folder>/<take folder>/<file name>`. Text is
  read as UTF-8 with the cp1252 fallback `_read_text` has today.
- **Folder already in the database**: the app died between the commit and
  the delete — just delete the file.
- **Unreadable file**: leave the folder and the file alone, log it to
  crash.log, report it once to the ErrorBar. Retried on the next open.

The `.get(…, default)` handling of missing old fields lives only in the
importer (`bit_depth` → `LEGACY_DEPTH`, markers through `_as_marker`,
missing `cloud_*` → defaults). Everything past it reads complete rows.

## Database and disk disagreeing

- **Row whose folder is missing**: `list_rehearsals` returns it with
  `"missing": true`. History shows "Not found on disk" with two actions:
  - **Remove from history** — deletes the row (cascade), after a confirm.
  - **Locate folder…** — a folder dialog; the chosen folder must be inside
    the recordings folder and not already another rehearsal's; its relative
    path replaces `folder`.
  A missing rehearsal cannot be opened or played. New API: `forget_rehearsal(folder)`,
  `locate_rehearsal(folder)`.
- **Folder with no row and no `session.json`**: skipped, as today.
- **Missing take file inside an existing folder**: as today, the player's
  business.

## The active rehearsal

`self._session` keeps what only exists while recording (counter, recorder,
folder), but no longer a copy of the takes: `session_state` reads them from
the database. One copy of the data instead of two, which removes the
"publish rebound `_session["takes"]` to a stale read" class of bug the
comments in `keep_take` and `share_take` defend against.

## Threads

The interface thread and the publishing thread both write. Every `library`
function opens its own session and transaction; WAL lets reads run beside the
one writer, and `busy_timeout` covers two writers meeting. `_meta_lock` goes
away with the read-modify-write cycles it protected.

## Packaging

- `requirements.txt`: `sqlalchemy`, `alembic`.
- `packaging/rehearsal-recorder.spec`: `store/migrations` shipped as data,
  and its version modules and `sqlalchemy.dialects.sqlite` in
  `hiddenimports` — Alembic imports migrations by path.
- `app.py` selftest gains a "Database" check: create `library.sqlite` in a
  temporary folder and upgrade it to head. A bundle missing its migrations
  fails in CI, not at a rehearsal.

## Tests

In the project's style (plain scripts under `tests/`, run by `run_all.py`).

- **`tests/test_store.py`** (new):
  - empty database → upgrade head → `compare_metadata` against the models is
    empty (models and migrations have not drifted);
  - database stamped with a revision the app does not know → refused, file
    bytes unchanged;
  - database below head → `.bak-<revision>` written, data intact after
    upgrade (with one migration, checked on a test-only revision chain);
  - cascade: deleting a rehearsal removes its takes, files, markers, copies.
- **Import:** an old-format `session.json` with absolute paths, Cyrillic
  names and a cp1252 file → rows, file deleted; an unreadable one left in
  place; a second open duplicates nothing; a folder already in the database
  with its `session.json` still there → file deleted, rows untouched; a
  moved folder's paths re-rooted.
- **Disagreement:** folder deleted → `missing: true`; `forget_rehearsal`;
  `locate_rehearsal` (inside the recordings folder only, not another
  rehearsal's folder).
- **`tests/test_engine.py`:** the ~20 checks that read or write
  `session.json` directly move to `library` or to the importer. None are
  dropped: each keeps asserting the same behaviour.
- **`tests/test_interface.py`:** the mock gains `missing`; the mark and the
  two actions are checked.
- **Rule for later:** every new migration comes with a test that loads data
  in the previous revision's shape and checks it after `upgrade`.

## Docs

- `docs/using-it.md`: "Where the files are" shows `library.sqlite` instead of
  `session.json`; a paragraph on the move and on "Not found on disk".
- `docs/design-notes.md`: why the database sits in the recordings folder, why
  settings stayed JSON, why songs are not stored; "Old rehearsals without
  `session.json`" becomes "folders with no row in the database".
- `docs/development.md`: adding a migration — edit `models.py`,
  `alembic revision --autogenerate -m …`, read and fix the generated file
  (batch mode), add its test.
- `CHANGELOG.md`: Unreleased.

## Deliberately not done

- **Settings in SQLite** — see Decisions.
- **Drafts in the database** — `_drafts` stays on files; draft recovery
  exists precisely for when the app died, and reads what is on disk.
- **Downgrade support in the app** — migrations have `downgrade()`, but the
  app only ever upgrades; the `.bak` is the way back.
- **Scanning for folders with no row and no `session.json`** — as today, not
  shown.
