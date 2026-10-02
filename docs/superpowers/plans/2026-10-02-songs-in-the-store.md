# Songs in the Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store songs in the history database, make a take a go at a song (or at nothing) with its name derived from that, move every existing take over, and rename old folders and cloud copies to match in the background.

**Architecture:** A `song` table and `take.song_id` / `take.go` replace `take.name` (migration 0002, which alters `take` in place). `store/names.py` holds the one rule that writes a name (`take_name`) and the frozen old rule that reads old names (`legacy_song_and_go`). `Library` turns a typed name into a song and a go inside the transaction that writes the take (`_resolve`), and offers the same answer read-only (`resolve_name`) so `api.py` can name a folder before the take is written. `api.py` groups takes by their `song` field instead of parsing names. `names_pass.py` is a background loop that renames take folders and cloud copies whose names no longer match.

**Tech Stack:** Python 3.10+ (builds use 3.12), SQLite through SQLAlchemy 2 and Alembic, pywebview; React/TypeScript interface tested with Playwright against `ui/e2e/fake-bridge.js`.

**Spec:** `docs/superpowers/specs/2026-10-02-songs-in-the-store-design.md`

## Global Constraints

- No new dependencies: `requirements.txt` and `ui/package.json` stay as they are.
- SQLite 3.35.5 or newer (for `ALTER TABLE … DROP COLUMN`). Migration 0002 checks it and says so. Python 3.12, which the builds use, ships 3.40 or newer.
- **Never batch-alter `take` or `rehearsal`.** Alembic's batch mode rebuilds a table by copying it, running `DROP TABLE` and renaming the copy. With `PRAGMA foreign_keys=ON`, which the app always sets, that `DROP TABLE` deletes every row that points at the table with `ON DELETE CASCADE`. This was checked on 2026-10-02: rebuilding `take` emptied `marker`, `take_file` and `cloud_copy`. Alter in place with `ALTER TABLE … ADD COLUMN` / `DROP COLUMN`.
- The interface keeps sending names as strings. Every shape Python returns keeps its keys. Each take gains `song` (title or `null`) and `go` (int or `null`); they are null together.
- The spec's own words: *"Nothing a person sees changes in it"*, except names that the pass puts right.
- Python tests are scripts, not pytest. Each check is `ok(label, cond)` inside `main()`, grouped under `print("\n[N] …")` headings. Run them with `venv/bin/python tests/test_store.py`, `venv/bin/python tests/test_engine.py`, or all with `venv/bin/python tests/run_all.py`.
- Existing tests pass unchanged, except the ones this plan names. Each named change gives its reason in the commit message. If any other existing test fails, stop and report it; do not edit it.
- Interface checks: `cd ui && npm test`, `cd ui && npm run lint` (20 warnings today, no more), `cd ui && npm run build && npm run test:e2e`.
- Comments follow the repo's voice: they say why, in plain sentences, the way the surrounding code does.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed unless the user asks.
- Do not run the new version against the real recordings folder. Task 6 checks it on a copy.

## Decisions made while planning

These fill gaps the spec leaves open. The user sees them before work starts.

1. **Migration 0002 alters `take` in place,** for the reason in Global Constraints. Downgrading is refused, and `library.sqlite.bak-0001` is the way back.
2. **A case-only rename of a song's only take respells the song.** "Polyn" renamed "POLYN" becomes "POLYN" when no other take in the library is a go at Polyn. When other takes are, it stays "Polyn", since respelling a song with many takes belongs to *renaming a song*, a later step. This keeps today's check in test_engine [9] true.
3. **For the take being renamed, the pills offer that take's own name** (`song_choices(folder, take_number)`): Polyn 2 is offered "Polyn 2", not "Polyn 4". This follows N2, under which renaming to the take's own song keeps its go. test_engine [16c] changes its expectation from "Polyn 4" to "Polyn 2".
4. **Spelling of migrated songs:** the newest rehearsal's first take with that song, which is how `song_choices` spells "other" songs today. **For an imported `session.json`:** a song already in the library keeps its title, and a new one is spelled the way that rehearsal first spells it.
5. **An empty name passed to `keep_take` is still "Take N",** as today. The interface never sends an empty name; ✕ puts the default back. A recovered draft with no name is "Take N" (D5).
6. **The pass treats a folder named "NN - name (2)" as matching.** `_unique_path` adds that suffix when a name is already taken, and renaming such a folder would only land on "(2)" again on every open.
7. **The pass skips a take that is open in the player** and leaves it for the next open, so it never closes the player under someone listening.
8. **The pass waits** while a take records, a copy is being made, or a take is being saved, cropped or recovered. It reads the journal's running entries for the last three.

## Review Focus

1. **Migrating a real library keeps every marker, track file and cloud copy.** A batch rebuild of `take` would delete them through the cascades. → Task 2, test_store [9], row counts before and after.
2. **Cyrillic names that differ only in case are one song** ("ПОЛЫНЬ", "Полынь 2"). SQLite's `lower()` folds ASCII only. → Task 2, test_store [9] and [10].
3. **A typed "Take 9" for take 5 is "Take 5", and a typed go number is ignored,** on disk too. → Task 2 [10] (store) and Task 4 [53] (folders).
4. **A take folder that got " (2)" because its name was taken** is not "put right" on every open. → Task 5 [54].
5. **A take open in the player is not closed by the pass,** and it is renamed once the player lets go. → Task 5 [54].

---

## File structure

| File | Change | What it is responsible for |
|---|---|---|
| `src/rehearsal_recorder/store/names.py` | create | `take_name`, `split_go`, `UNNAMED_TAKE`, and the frozen `legacy_song_and_go` |
| `src/rehearsal_recorder/store/models.py` | modify | `Song`; `Take.song_id`, `Take.go`, `Take.song`; drops `Take.name` |
| `src/rehearsal_recorder/store/migrations/versions/0002_songs.py` | create | the schema change and moving old names into songs (M1–M4) |
| `src/rehearsal_recorder/store/library.py` | modify | `_resolve`, `resolve_name`, songs created and deleted with their takes, `song`/`go`/`name` in what it returns, the importer's old-name rule |
| `src/rehearsal_recorder/api.py` | modify | grouping from `song`/`go` (N5), the next take (N3), folders named after the resolved name (N4, D5), wiring for the pass |
| `src/rehearsal_recorder/cloud.py` | modify | `PublishQueue.busy()` |
| `src/rehearsal_recorder/names_pass.py` | create | the background loop that puts names right (F1–F5) |
| `ui/src/lib/api.ts` | modify | `Take.song`, `Take.go` |
| `ui/e2e/fake-bridge.js` | modify | `song` and `go` on the fake's takes |
| `tests/test_store.py` | modify | [1] and [3] stand on the newest revision; new [8], [9] and [10] |
| `tests/test_engine.py` | modify | [11m] and [16c] adjusted; new [52], [53] and [54] |
| `docs/design-notes.md`, `docs/development.md`, `docs/using-it.md`, `CHANGELOG.md` | modify | docs |

---

### Task 1: The naming rule, in one place

**Files:**
- Create: `src/rehearsal_recorder/store/names.py`
- Test: `tests/test_store.py` (new section [8], before the summary at the end of `main()`)

**Interfaces:**
- Produces:
  - `UNNAMED_TAKE`: compiled `^Take \d+$`.
  - `take_name(title: str | None, go: int | None, take_number: int) -> str`.
  - `split_go(name: str | None) -> tuple[str, int | None]`.
  - `legacy_song_and_go(name: str | None) -> tuple[str | None, int | None]`.

- [ ] **Step 1: Write the failing test**

In `tests/test_store.py`, add to the imports beside the other `rehearsal_recorder` imports:

```python
from rehearsal_recorder.store.names import (  # noqa: E402
    legacy_song_and_go, split_go, take_name,
)
```

Insert this section in `main()` just before the final `print()` / `if problems:` block:

```python
    print("\n[8] What a take is called, and what an old name meant")
    ok("a first go is the song's title", take_name("Polyn", 1, 4) == "Polyn")
    ok("a later go carries its number", take_name("Polyn", 3, 4) == "Polyn 3")
    ok("a title ending in a number keeps it", take_name("Song 2", 2, 1) == "Song 2 2")
    ok("a take with no song is called by its own number",
       take_name(None, None, 7) == "Take 7")
    ok("a trailing number is split off", split_go(" Polyn 3 ") == ("Polyn", 3))
    ok("a name without one has none", split_go("Polyn") == ("Polyn", None))
    ok("a bare number is a name, not a go", split_go("1999") == ("1999", None))
    ok("old names: a trailing number was the go",
       legacy_song_and_go("Polyn 3") == ("Polyn", 3)
       and legacy_song_and_go("Polyn") == ("Polyn", 1))
    ok("old names: Cyrillic is read the same way",
       legacy_song_and_go("Полынь 2") == ("Полынь", 2))
    ok("old names: the app's own names are no song",
       legacy_song_and_go("Take 4") == (None, None)
       and legacy_song_and_go("Recovered take 2") == (None, None)
       and legacy_song_and_go("  ") == (None, None)
       and legacy_song_and_go(None) == (None, None))
    ok("old names: what the rule cannot know stays as it reads",
       legacy_song_and_go("Опус 5") == ("Опус", 5))
```

- [ ] **Step 2: Run it and watch it fail**

Run: `venv/bin/python tests/test_store.py`
Expected: `ModuleNotFoundError: No module named 'rehearsal_recorder.store.names'`

- [ ] **Step 3: Write the module**

Create `src/rehearsal_recorder/store/names.py`:

```python
"""
What a take is called, and what an old name meant.

A take is a go at a song, or at nothing (models.Take). Its name is not
stored; it follows from the two: the song's title for the first go, "title
N" for go N, and "Take N" — N being the take's own number — for a take with
no song. take_name() is that rule, and the only place it is written.

Naming a take goes the other way, from what was typed or clicked to a song
and a go. That needs the songs already in the library, so it is in
library.py (Library._resolve), using split_go from here.

legacy_song_and_go() is how names were read before songs were stored: a
trailing number was the go, the rest was the song. Migration 0002 and the
import of old session.json files read old names with it, so the two cannot
differ. It describes data that already exists, so it must not change when
the rule for new names does.
"""

import re

# A take nobody named, as the app names it.
UNNAMED_TAKE = re.compile(r"^Take \d+$")
# What older versions called a rescued draft nobody named. It read as a song
# called "Recovered take"; it is a take nobody named, like any other.
_RECOVERED_TAKE = re.compile(r"^Recovered take \d+$")
# A trailing number: "Polyn 3" -> "Polyn", "3".
_TRAILING_NUMBER = re.compile(r"^(.*?)\s+(\d+)$")


def take_name(title, go, take_number):
    """'Polyn', 'Polyn 3', or 'Take 7' for a take with no song."""
    if title is None:
        return f"Take {take_number}"
    if not go or go == 1:
        return title
    return f"{title} {go}"


def split_go(name):
    """'Polyn 3' -> ('Polyn', 3); 'Polyn' -> ('Polyn', None). Trimmed."""
    name = (name or "").strip()
    match = _TRAILING_NUMBER.match(name)
    if match and match.group(1).strip():
        return match.group(1).strip(), int(match.group(2))
    return name, None


def legacy_song_and_go(name):
    """
    An old take name read the old way: (song, go), or (None, None) for a
    take nobody named. "Song 2" is the second go at "Song" whether or not a
    song by that title was ever played — the old rule could not tell, and
    reading it any other way would change what old rehearsals say.
    """
    name = (name or "").strip()
    if not name or UNNAMED_TAKE.match(name) or _RECOVERED_TAKE.match(name):
        return None, None
    song, go = split_go(name)
    return song, go or 1
```

- [ ] **Step 4: Run it and watch it pass**

Run: `venv/bin/python tests/test_store.py`
Expected: every line `ok`, ending `All store checks passed.`

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/store/names.py tests/test_store.py
git commit -m "Store: the naming rule in one place, and the old one frozen beside it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Songs in the database

**Files:**
- Modify: `src/rehearsal_recorder/store/models.py`
- Create: `src/rehearsal_recorder/store/migrations/versions/0002_songs.py`
- Modify: `src/rehearsal_recorder/store/library.py`
- Test: `tests/test_store.py` (adjust [1] and [3]; new [9] and [10])
- Test: `tests/test_engine.py` (adjust [11m] and [16c]; both named below)

**Interfaces:**
- Consumes: `take_name`, `split_go`, `UNNAMED_TAKE` and `legacy_song_and_go` from Task 1.
- Produces:
  - Every take dict from `Library` (`rehearsal()`, `rehearsals()`, `take()`, `add_take()`, `update_take()`) has `"name"` (derived), `"song"` (`str | None`) and `"go"` (`int | None`).
  - `Library.resolve_name(folder, name: str | None, take_number: int) -> {"song": str | None, "go": int | None, "name": str}`. It writes nothing.
  - `Library.add_take(folder, take)` reads `take["name"]` as typed and stores the song and go it resolves to.
  - `Library.update_take(folder, take_number, *, name=None, …)` does the same with `name`.
  - `Library.import_rehearsal(…)` reads `takes[i]["name"]` by the old rule.

- [ ] **Step 1: Stand test_store's migration chain on the newest revision**

These checks hard-code revision `0001`, and their test-only `0002` would clash with the real one. This changes the test setup, not app behaviour; it passes before and after this task.

In `tests/test_store.py`, add after the other imports:

```python
from alembic.script import ScriptDirectory  # noqa: E402

# The newest migration the app ships. The test-only migrations below sit on
# top of it, so they keep working as real ones are added.
HEAD = ScriptDirectory.from_config(db.alembic_config()).get_current_head()
```

Replace the `SECOND` template's first lines:

```python
SECOND = '''
revision = "9002"
down_revision = "{down}"
```

(the rest of the template unchanged), and add this helper after `migrations_with`:

```python
def migrations_up_to(tmp, revision):
    """The app's migrations as far as `revision`, in a folder of their own:
    what an app from before the later ones would bring a database to."""
    folder = tmp / f"migrations-to-{revision}"
    if folder.exists():
        shutil.rmtree(folder)
    shutil.copytree(db.MIGRATIONS, folder, ignore=shutil.ignore_patterns("__pycache__"))
    for f in (folder / "versions").glob("*.py"):
        if f.name[:4] > revision:
            f.unlink()
    return folder
```

In section [1]:

```python
    ok("it is at the newest migration", db.current_revision(engine) == HEAD)
```

In section [3], make these changes:

```python
    broken = migrations_with(tmp, "9002_broken.py", SECOND.format(
        down=HEAD,
        extra='    op.execute("DELETE FROM rehearsal")\n'
              '    raise RuntimeError("the migration broke")\n'))
```

```python
    ok("the database was copied aside before it was touched",
       (old / f"library.sqlite.bak-{HEAD}").exists())
    engine = db.make_engine(db.database_path(old))
    ok("it is still at the revision it was", db.current_revision(engine) == HEAD)
```

```python
    working = migrations_with(tmp, "9002_venue.py", SECOND.format(down=HEAD, extra=""))
    engine = db.open_engine(old, working)
    ok("a working migration moves it on", db.current_revision(engine) == "9002")
```

Run: `venv/bin/python tests/test_store.py`
Expected: all `ok`. Nothing in the app has changed yet; `HEAD` is still `0001`.

- [ ] **Step 2: Write the failing tests for the migration and for naming in the store**

Insert after section [8]:

```python
    print("\n[9] Old names become songs (migration 0002)")
    rec9 = tmp / "Songs"
    rec9.mkdir()
    db.open_engine(rec9, migrations_up_to(tmp, "0001")).dispose()
    old_names = {
        # rehearsal: (created_at, take names in order)
        "Old": ("2026-01-10T19:00:00",
                ["polyn", "Take 2", "Recovered take 3", "", "Song 2", "polyn", "Опус 5"]),
        "Mid": ("2026-02-10T19:00:00", ["Polyn", "Polyn 3", "Song", "ПОЛЫНЬ"]),
        "New": ("2026-03-10T19:00:00", ["Полынь 2"]),
    }
    engine = db.make_engine(db.database_path(rec9))
    with engine.begin() as c:
        for folder, (created_at, names) in old_names.items():
            rid = c.execute(text(
                "INSERT INTO rehearsal (folder, name, created_at, samplerate, bit_depth) "
                "VALUES (:f, :f, :c, 48000, 24)"), {"f": folder, "c": created_at}).lastrowid
            for number, old in enumerate(names, start=1):
                tid = c.execute(text(
                    "INSERT INTO take (rehearsal_id, take_number, name, duration_sec, "
                    "cloud_skip, cloud_send) VALUES (:r, :n, :name, 1.0, 0, 0)"),
                    {"r": rid, "n": number, "name": old}).lastrowid
                c.execute(text("INSERT INTO take_file (take_id, position, name, file) "
                               "VALUES (:t, 0, 'Gtr', :f)"),
                          {"t": tid, "f": f"{number:02d} - {old}/Gtr.wav"})
                c.execute(text("INSERT INTO marker (take_id, at, kind, note) "
                               "VALUES (:t, 1.0, 'good', '')"), {"t": tid})
                c.execute(text("INSERT INTO cloud_copy (take_id, mix, source) "
                               "VALUES (:t, :m, '{}')"),
                          {"t": tid, "m": f"{folder}/{number:02d} - {old}.wav"})
    engine.dispose()

    engine = db.open_engine(rec9)
    ok("an old database is moved on to the newest migration",
       db.current_revision(engine) == HEAD)
    ok("after it was copied aside", (rec9 / "library.sqlite.bak-0001").exists())
    with engine.connect() as c:
        drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
        columns = {col["name"] for col in inspect(c).get_columns("take")}
        counts = {t: c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                  for t in ("take", "take_file", "marker", "cloud_copy")}
        titles = sorted(c.execute(text("SELECT title FROM song")).scalars().all())
    engine.dispose()
    ok("and it is then what models.py describes", drift == [])
    ok("a take's name is not stored any more",
       "name" not in columns and {"song_id", "go"} <= columns)
    ok("every take keeps its files, its marks and its cloud copy",
       counts == {"take": 12, "take_file": 12, "marker": 12, "cloud_copy": 12})
    ok("one song per title, whatever the case or the script",
       titles == ["Polyn", "Song", "Опус", "Полынь"])

    lib = Library(rec9)

    def names_of(folder):
        return [(t["name"], t["song"], t["go"]) for t in lib.rehearsal(rec9 / folder)["takes"]]

    ok("the app's own names are no song, a recovered take's and an empty one included",
       names_of("Old")[1:4] == [("Take 2", None, None), ("Take 3", None, None),
                                ("Take 4", None, None)])
    ok("a song is spelled as the newest rehearsal first spells it",
       names_of("Old")[0] == ("Polyn", "Polyn", 1)
       and names_of("Mid")[3] == ("Полынь", "Полынь", 1)
       and names_of("New") == [("Полынь 2", "Полынь", 2)])
    ok("the go comes from the name, gaps and all",
       names_of("Mid")[:2] == [("Polyn", "Polyn", 1), ("Polyn 3", "Polyn", 3)])
    ok("two takes of one name in a rehearsal keep one go",
       names_of("Old")[5] == ("Polyn", "Polyn", 1))
    ok("a trailing number is a go at the song without it",
       names_of("Old")[4] == ("Song 2", "Song", 2))
    ok("even with no such song anywhere: what the rule cannot know stays as it reads",
       names_of("Old")[6] == ("Опус 5", "Опус", 5))
    lib.close()

    try:
        db.open_engine(rec9, migrations_up_to(tmp, "0001")).dispose()
        refused = None
    except db.LibraryUnavailable as e:
        refused = str(e)
    ok("an app from before songs refuses the database, as any older app would",
       refused == db.NEWER_DATABASE)

    print("\n[10] Naming a take: a go at a song, numbered by the app")
    rec10 = tmp / "Naming"
    rec10.mkdir()
    lib = Library(rec10)
    jam = rec10 / "Jam"
    lib.create_rehearsal(jam, "Jam", "2026-10-01T19:00:00", 48000, 24, [])

    def add(number, name, folder=jam):
        t = lib.add_take(folder, {"take_number": number, "name": name, "tracks": []})
        return t["name"], t["song"], t["go"]

    def rename(number, name):
        t = lib.update_take(jam, number, name=name)
        return t["name"], t["song"], t["go"]

    def song_titles():
        e = db.make_engine(db.database_path(rec10))
        with e.connect() as c:
            found = sorted(c.execute(text("SELECT title FROM song")).scalars().all())
        e.dispose()
        return found

    ok("a new title is a new song", add(1, "Polyn") == ("Polyn", "Polyn", 1))
    ok("the same title in another case is the same song, at its next go",
       add(2, "polyn") == ("Polyn 2", "Polyn", 2))
    ok("a typed number is not the go: the app counts",
       add(3, "Polyn 7") == ("Polyn 3", "Polyn", 3))
    ok("Take N is no song, and is called by the take's own number",
       add(4, "Take 9") == ("Take 4", None, None))
    ok("so is an empty name", add(5, "  ") == ("Take 5", None, None))
    ok("a title ending in a number is a song of its own when no shorter one exists",
       add(6, "Song 2") == ("Song 2", "Song 2", 1)
       and add(7, "Song 2") == ("Song 2 2", "Song 2", 2))
    ok("Cyrillic is compared case-blind too",
       add(8, "Полынь") == ("Полынь", "Полынь", 1)
       and add(9, "ПОЛЫНЬ 4") == ("Полынь 2", "Полынь", 2))
    ok("one row per song", song_titles() == ["Polyn", "Song 2", "Полынь"])

    before = song_titles()
    ok("asking what a name would be writes nothing",
       lib.resolve_name(jam, "Vesna", 10) == {"song": "Vesna", "go": 1, "name": "Vesna"}
       and lib.resolve_name(jam, "polyn", 10) == {"song": "Polyn", "go": 4, "name": "Polyn 4"}
       and lib.resolve_name(jam, "", 10) == {"song": None, "go": None, "name": "Take 10"}
       and song_titles() == before)

    other = rec10 / "Other"
    lib.create_rehearsal(other, "Other", "2026-10-02T19:00:00", 48000, 24, [])
    ok("goes are counted within a rehearsal", add(1, "Polyn", other) == ("Polyn", "Polyn", 1))

    ok("renamed to the song it already has, a take keeps its go",
       rename(3, "Polyn") == ("Polyn 3", "Polyn", 3))
    ok("renamed to another song, it is that song's next go here",
       rename(4, "polyn") == ("Polyn 4", "Polyn", 4))
    ok("renamed to a new title, it is a new song", rename(9, "Vesna") == ("Vesna", "Vesna", 1))
    ok("a case-only rename of a song's only take respells the song",
       rename(8, "ПОЛЫНЬ") == ("ПОЛЫНЬ", "ПОЛЫНЬ", 1))
    ok("but not a song that other takes are goes at",
       rename(1, "POLYN") == ("Polyn", "Polyn", 1))
    ok("a song left with no takes is gone",
       rename(9, "Take 9") == ("Take 9", None, None) and "Vesna" not in song_titles())
    lib.delete_take(jam, 2)
    ok("deleting a go does not renumber the rest", lib.take(jam, 3)["name"] == "Polyn 3")
    lib.delete_take(jam, 8)
    ok("deleting a song's last take deletes the song", "ПОЛЫНЬ" not in song_titles())
    lib.forget_rehearsal(jam)
    lib.forget_rehearsal(other)
    ok("forgetting rehearsals forgets the songs only they had", song_titles() == [])

    lib.create_rehearsal(rec10 / "Kept", "Kept", "2026-10-03T19:00:00", 48000, 24, [])
    add(1, "Polyn", rec10 / "Kept")
    old_jam = rec10 / "Old jam - 2020-01-01 10-00"
    old_jam.mkdir()
    (old_jam / "session.json").write_text(json.dumps({
        "name": "Old jam", "created_at": "2020-01-01T10:00:00", "samplerate": 48000,
        "tracks": [], "takes": [
            {"take_number": n, "name": name, "tracks": []}
            for n, name in enumerate(
                ["polyn", "Polyn 3", "Recovered take 3", "zima", "Zima 2", "Опус 5"], start=1)],
    }), encoding="utf-8")
    import_all(lib, None)
    ok("an imported rehearsal is read by the old rule: an existing song keeps its "
       "title, a new one is spelled as the rehearsal first spells it",
       [(t["name"], t["song"], t["go"]) for t in lib.rehearsal(old_jam)["takes"]] == [
           ("Polyn", "Polyn", 1), ("Polyn 3", "Polyn", 3), ("Take 3", None, None),
           ("zima", "zima", 1), ("zima 2", "zima", 2), ("Опус 5", "Опус", 5)])
    lib.close()
```

- [ ] **Step 3: Run it and watch it fail**

Run: `venv/bin/python tests/test_store.py`
Expected: sections [1]–[8] stay `ok`. In [9], `FAIL after it was copied aside` (with no migration 0002 there is nothing to migrate), and then the suite stops with `sqlite3.OperationalError: no such table: song`.

- [ ] **Step 4: Change the models**

In `src/rehearsal_recorder/store/models.py`, add `Song` after `Rehearsal`:

```python
class Song(Base):
    """
    What takes are goes at. A take's name is not stored but follows from its
    song and its go (names.take_name), so a title is spelled one way
    everywhere. Titles are unique case-blind. library.py enforces that, as
    SQLite's lower() folds only ASCII and would let "Полынь" and "полынь"
    both in.
    """

    __tablename__ = "song"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String)
```

In `Take`, delete `name: Mapped[str] = mapped_column(String)` and put this in its place:

```python
    # What the take is a go at, and which go: both None for a take nobody
    # named. The go is counted within the rehearsal and kept, not counted
    # again on every read: deleting "Polyn 2" must not turn "Polyn 3" into
    # another name, and so another folder and another cloud copy.
    song_id: Mapped[int | None] = mapped_column(
        ForeignKey("song.id", ondelete="SET NULL"), index=True, nullable=True
    )
    go: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

Add to `Take`'s relationships, before `files`:

```python
    song: Mapped["Song | None"] = relationship()
```

- [ ] **Step 5: Write migration 0002**

Create `src/rehearsal_recorder/store/migrations/versions/0002_songs.py`:

```python
"""songs: a take is a go at a song

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-02

Songs were worked out from take names on every read. They are stored now,
and a take's name follows from its song and its go. This moves the names
into songs by the rule they were written under (names.legacy_song_and_go),
then drops the column. Only the database changes: folders and cloud copies
whose names come out differently are renamed afterwards, in the background
(names_pass.py), so a failure here leaves every file where it was.

`take` is altered in place, not in batch mode. Batch mode rebuilds a table:
a copy, DROP TABLE and a rename. With foreign keys on, that DROP TABLE
deletes every marker, track file and cloud copy pointing at a take, through
their ON DELETE CASCADE.
"""
import sqlite3
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from rehearsal_recorder.store.names import legacy_song_and_go

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if sqlite3.sqlite_version_info < (3, 35, 5):
        raise RuntimeError(
            f"Updating the history needs SQLite 3.35.5 or newer; this Python "
            f"has {sqlite3.sqlite_version}"
        )
    op.create_table(
        "song",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("ALTER TABLE take ADD COLUMN song_id INTEGER "
               "REFERENCES song (id) ON DELETE SET NULL")
    op.execute("ALTER TABLE take ADD COLUMN go INTEGER")
    op.create_index(op.f("ix_take_song_id"), "take", ["song_id"], unique=False)

    bind = op.get_bind()
    # Newest rehearsal first and its takes in order, so the first spelling
    # met is the one song_choices showed for the song before: the newest
    # rehearsal's first go at it.
    rows = bind.execute(sa.text(
        "SELECT take.id, take.name FROM take "
        "JOIN rehearsal ON rehearsal.id = take.rehearsal_id "
        "ORDER BY rehearsal.created_at DESC, rehearsal.id DESC, take.take_number"
    )).all()
    titles, goes = {}, []
    for take_id, name in rows:
        song, go = legacy_song_and_go(name)
        if song is None:
            continue
        titles.setdefault(song.casefold(), song)
        goes.append({"id": take_id, "key": song.casefold(), "go": go})
    ids = {
        key: bind.execute(sa.text("INSERT INTO song (title) VALUES (:title)"),
                          {"title": title}).lastrowid
        for key, title in titles.items()
    }
    if goes:
        bind.execute(
            sa.text("UPDATE take SET song_id = :song, go = :go WHERE id = :id"),
            [{"id": g["id"], "song": ids[g["key"]], "go": g["go"]} for g in goes],
        )
    op.execute("ALTER TABLE take DROP COLUMN name")


def downgrade() -> None:
    raise NotImplementedError(
        "The history cannot be taken back to before songs were stored. The "
        "copy made before migrating, library.sqlite.bak-0001, is that history."
    )
```

- [ ] **Step 6: Teach the library songs**

In `src/rehearsal_recorder/store/library.py`:

Imports:

```python
from sqlalchemy import delete, select
from sqlalchemy.orm import selectinload, sessionmaker

from rehearsal_recorder.store.db import MIGRATIONS, open_engine
from rehearsal_recorder.store.models import (
    CloudCopy, Marker, Rehearsal, Song, Take, TakeFile, Track,
)
from rehearsal_recorder.store.names import (
    UNNAMED_TAKE, legacy_song_and_go, split_go, take_name,
)
```

`_WITH_TAKES` gains the song:

```python
_WITH_TAKES = (
    selectinload(Rehearsal.tracks),
    selectinload(Rehearsal.takes).selectinload(Take.song),
    selectinload(Rehearsal.takes).selectinload(Take.files),
    selectinload(Rehearsal.takes).selectinload(Take.markers),
    selectinload(Rehearsal.takes).selectinload(Take.cloud_copy),
)
```

In `_take_data`, replace the `"name": take.name,` line with:

```python
            # Not stored: it follows from the song and the go.
            "name": take_name(title, take.go, take.take_number),
            "song": title,
            "go": take.go if title is not None else None,
```

and put `title = take.song.title if take.song is not None else None` as the method's first line.

In `take()`, add `selectinload(Take.song),` to the options passed to `_find_take`.

Add this section before `# ---------- rehearsals ----------`:

```python
    # ---------- songs ----------
    #
    # A take is a go at a song or at nothing, and its name follows from the
    # two (names.take_name). What was typed or clicked becomes a song and a
    # go here, in the transaction that writes the take, by _resolve. Titles
    # are unique case-blind, which SQLite cannot enforce for Cyrillic (its
    # lower() folds only ASCII), so it is enforced here: a title is looked up
    # casefolded before a song is made. A song with no takes left goes with
    # its last one, in the methods that delete or rename takes.

    @staticmethod
    def _songs_by_key(db):
        return {s.title.casefold(): s for s in db.scalars(select(Song))}

    @staticmethod
    def _has_other_takes(db, song_id, take_id):
        return db.scalars(
            select(Take.id).where(Take.song_id == song_id, Take.id != take_id).limit(1)
        ).first() is not None

    def _resolve(self, db, rehearsal_id, name, take_number):
        """
        What take `take_number` of a rehearsal is a go at when it is called
        `name`: (song, title, go). `song` is the Song row when there is one
        already; `title` is None for no song, and a new song's title
        otherwise. In order:

        1. Nothing, or "Take N", is no song.
        2. A song whose title is the whole name, compared casefolded, is
           that song.
        3. A song whose title is the name less a trailing number ("Polyn 3")
           is that song.
        4. Anything else is a new song with exactly that title — so "Opus 5"
           is a go at "Opus" only while a song by that title exists.

        The go is the app's, not a typed number: one past the highest go at
        the song in this rehearsal. A take already a go at the song keeps
        its go ("Polyn 2" renamed to Polyn stays Polyn 2); and when it is
        the song's only take anywhere, a name differing from the title only
        in case respells the song.
        """
        name = (name or "").strip()
        if not name or UNNAMED_TAKE.match(name):
            return None, None, None
        current = None
        if rehearsal_id is not None:
            current = db.scalars(select(Take).where(
                Take.rehearsal_id == rehearsal_id, Take.take_number == take_number
            )).one_or_none()
        songs = self._songs_by_key(db)
        song = songs.get(name.casefold())
        if song is None:
            base, number = split_go(name)
            if number is not None:
                song = songs.get(base.casefold())
        if song is None:
            return None, name, 1
        title = song.title
        if current is not None and current.song_id == song.id:
            if (name != title and name.casefold() == title.casefold()
                    and not self._has_other_takes(db, song.id, current.id)):
                title = name
            return song, title, current.go
        goes = [] if rehearsal_id is None else db.scalars(select(Take.go).where(
            Take.rehearsal_id == rehearsal_id, Take.song_id == song.id,
            Take.take_number != take_number,
        )).all()
        return song, title, max((g or 1 for g in goes), default=0) + 1

    @staticmethod
    def _song_row(db, song, title):
        """The Song a take resolved to (_resolve), made if it is new and
        respelled if _resolve said so; None for no song."""
        if title is None:
            return None
        if song is None:
            song = Song(title=title)
            db.add(song)
        elif song.title != title:
            song.title = title
        return song

    @staticmethod
    def _drop_songless(db, song_ids):
        """Deletes those of `song_ids` that no take is a go at any more."""
        db.flush()
        for song_id in {i for i in song_ids if i is not None}:
            if db.scalars(select(Take.id).where(Take.song_id == song_id).limit(1)).first() is None:
                db.execute(delete(Song).where(Song.id == song_id))

    def resolve_name(self, folder, name, take_number):
        """
        What take `take_number` of the rehearsal in `folder` would be if it
        were called `name`, by the rule add_take and update_take follow
        (_resolve), without writing anything: {"song": title or None, "go":
        int or None, "name"}. Used to name a take's folder before the take is
        written, and the next take before it is recorded.
        """
        take_number = int(take_number)
        with self._session() as db:
            rehearsal = self._find(db, folder)
            _, title, go = self._resolve(
                db, None if rehearsal is None else rehearsal.id, name, take_number)
        return {"song": title, "go": go, "name": take_name(title, go, take_number)}
```

In `add_take`, update the docstring's first line to `take: {"take_number", "name" (as typed — see _resolve), …`. Keep the `if rehearsal is None: return None` check where it is, and build the row after it like this:

```python
            number = int(take["take_number"])
            song, title, go = self._resolve(db, rehearsal.id, take.get("name"), number)
            row = Take(
                rehearsal_id=rehearsal.id,
                take_number=number,
                song=self._song_row(db, song, title),
                go=go,
                duration_sec=float(take.get("duration_sec") or 0.0),
                cloud_skip=bool(take.get("cloud_skip")),
                cloud_send=bool(take.get("cloud_send")),
                files=self._files(folder, take.get("tracks", [])),
                markers=[Marker(**as_marker(m)) for m in take.get("markers", [])],
            )
```

In `update_take`, change the docstring to `"""Changes what is given and leaves the rest. name: what the take is now called, made a song and a go as add_take makes it (_resolve), so the name it ends up with can differ. tracks: the take's files at their new absolute paths. Returns the take, or None."""`. Replace the `if name is not None: row.name = name` block with:

```python
            if name is not None:
                was = row.song_id
                song, title, go = self._resolve(db, row.rehearsal_id, name, take_number)
                row.song = self._song_row(db, song, title)
                row.go = go
                self._drop_songless(db, [was])
```

In `delete_take`, replace its body after the `None` check with:

```python
            rehearsal_id, song_id = row.rehearsal_id, row.song_id
            db.delete(row)
            self._drop_songless(db, [song_id])
            return len(db.scalars(select(Take.id).where(Take.rehearsal_id == rehearsal_id)).all())
```

In `forget_rehearsal`, replace `db.delete(row)` / `return True` with:

```python
            song_ids = db.scalars(select(Take.song_id).where(Take.rehearsal_id == row.id)).all()
            db.delete(row)
            self._drop_songless(db, song_ids)
            return True
```

In `import_rehearsal`, change the docstring's `takes as for add_take` to `takes as for add_take, their names read by the old rule (names.legacy_song_and_go)`. Inside the `with self._session.begin() as db:` block, before `db.add(Rehearsal(`, add:

```python
            songs = self._songs_by_key(db)

            def go_at(name):
                # By the rule migration 0002 read the database's own names
                # with. A song already in the library keeps its title; a new
                # one is spelled as this rehearsal first spells it.
                song, go = legacy_song_and_go(name)
                if song is None:
                    return None, None
                if song.casefold() not in songs:
                    songs[song.casefold()] = Song(title=song)
                return songs[song.casefold()], go

            placed = {int(t["take_number"]): go_at(t.get("name"))
                      for t in sorted(takes, key=lambda t: int(t["take_number"]))}
```

In the `Take(` built for each imported take, replace `name=t["name"],` with:

```python
                        song=placed[int(t["take_number"])][0],
                        go=placed[int(t["take_number"])][1],
```

- [ ] **Step 7: Run the store suite**

Run: `venv/bin/python tests/test_store.py`
Expected: `All store checks passed.` If [9]'s drift check reports a foreign-key or index difference, make `models.py` and `0002_songs.py` agree (same `ondelete`, same index name `ix_take_song_id`). Do not loosen the check.

- [ ] **Step 8: Run the engine suite and change the two checks the spec changes**

Run: `venv/bin/python tests/test_engine.py`
Expected: two failures, both because a take's name now follows its song:

1. [16c] "with every take as the player needs it…": the fifth take, imported as "polyn 3", is now "Polyn 3". In that check, change `"polyn 3"]` to `"Polyn 3"]`, and add a comment on the line above: `# A take's name follows its song, which is spelled one way.`
2. [11m] "a copy that could not be moved is made again under the new name": renaming take 1 from "Ogon" to "Ogon 2" now keeps it Ogon, because the go is the app's (N2). Rename it to another song instead:

```python
    fc.rename_take(str(sf), 1, "Zima")
```

```python
       Path(remade.get("mix", "")).name == "01 - Zima.wav"
```

```python
       not any(p.name.startswith("01 - Zima") for p in band.rglob("*")))
```

Run `venv/bin/python tests/test_engine.py` again.
Expected: `Python side: all checks passed.` If anything else fails, stop and report it with its output (Global Constraints).

- [ ] **Step 9: Run every Python suite**

Run: `venv/bin/python tests/run_all.py`
Expected: every suite passes.

- [ ] **Step 10: Commit**

```bash
git add src/rehearsal_recorder/store tests/test_store.py tests/test_engine.py
git commit -m "Store: songs are kept, and a take is a go at one

Migration 0002 makes a song table, gives every take a song and a go by
the rule its name was written under, and drops take.name: a take's name
now follows from its song and go. It alters take in place, since batch
mode's rebuild would cascade away every marker, file and cloud copy.

Tests changed:
- test_store: the test-only migrations sit on the newest real one, not 0001.
- test_engine [16c]: an imported 'polyn 3' is 'Polyn 3', the song spelled
  one way.
- test_engine [11m]: the rename goes to another song, since renaming Ogon to
  'Ogon 2' keeps it Ogon (the go is the app's).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Python reads songs and goes, not names

**Files:**
- Modify: `src/rehearsal_recorder/api.py`: the helpers above `class Api` (`_songs_of`, `_runs_of`, `_song_of`, `_next_go`, `_last_attempt`), plus `session_state`, `suggest_take_name` and `song_choices`
- Modify: `ui/src/lib/api.ts` (`Take`)
- Modify: `ui/e2e/fake-bridge.js`
- Test: `tests/test_engine.py` (new [52]; [16c] adjusted)

**Interfaces:**
- Consumes: `Library.resolve_name(folder, name, take_number)` and the `song`/`go` keys from Task 2.
- Produces:
  - `Api._next_take(take_number=None, chosen=True) -> {"song", "go", "name"}`.
  - `_next_go(takes, song, take_number=None) -> str`.
  - `_last_attempt(takes, song) -> dict | None`.

- [ ] **Step 1: Write the failing test**

In `tests/test_engine.py`, insert before the closing `print("\n" + "=" * 60)`:

```python
    print("\n[52] Python reads songs and goes, not names")
    _, s52 = fresh_api(Path(tempfile.mkdtemp()))
    s52.start_rehearsal("Evening", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    f52 = Path(s52._session["folder"])

    def keep52(number, name):
        draft = f52 / "_drafts" / f"take {number}"
        write_wav(draft / "Gtr.wav", 100, seconds=0.5)
        s52._session["take_counter"] = number
        return s52.keep_take(number, str(draft), name, 0.5,
                             [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])["take"]

    first52 = keep52(1, "Song 2")
    ok("a take says what it is a go at, and which go",
       (first52["name"], first52["song"], first52["go"]) == ("Song 2", "Song 2", 1))
    ok("the next take is another go at that song, its number after the title",
       s52.suggest_take_name() == "Song 2 2")
    keep52(2, s52.suggest_take_name())
    keep52(3, "Take 3")
    state52 = s52.session_state()
    ok("a title ending in a number is grouped as itself",
       [(s["name"], s["take_numbers"]) for s in state52["songs"]] == [("Song 2", [1, 2])])
    ok("after a take with no song, the next is Take N", state52["next_take_name"] == "Take 4")
    ok("the evening's runs come from the songs",
       [(r["song"], len(r["takes"])) for r in s52.list_rehearsals()[0]["runs"]]
       == [("Song 2", 2), (None, 1)])
    s52.set_next_take_name("song 2")
    ok("a name picked for the next take is the next go at its song",
       s52.session_state()["next_take_name"] == "Song 2 3"
       and s52.session_state()["last_attempt"] == {"song": "Song 2", "duration_sec": 0.5})
```

In [16c], change the check "a go missing in between is not named again":

```python
    ok("a go missing in between is not named again, and a take keeps its own go",
       e.song_choices(last, 2)["here"][0]["name"] == "Polyn 2"
       and e.song_choices(last, 5)["here"][0]["name"] == "Polyn 3")
```

- [ ] **Step 2: Run it and watch it fail**

Run: `venv/bin/python tests/test_engine.py`
Expected: FAIL on "the next take is another go at that song…", because the old rule offers "Song 3". FAIL on "a title ending in a number is grouped as itself", which comes out as `[("Song", …)]`. FAIL on the changed [16c] check, which gets "Polyn 4".

- [ ] **Step 3: Rewrite the grouping helpers**

In `src/rehearsal_recorder/api.py`, add the import after the other `rehearsal_recorder.store` imports:

```python
from rehearsal_recorder.store.names import take_name
```

Delete `_UNNAMED_TAKE`, `_ATTEMPT_NUMBER` and `_song_of`, with their comments. Replace `_songs_of`, `_runs_of`, `_next_go` and `_last_attempt` with:

```python
def _songs_of(takes):
    """
    What was played, as [{"name", "takes", "take_numbers"}] in the order
    things were first played. `take_numbers` is which takes they were, for
    the rehearsal's own overview, so the interface is handed the grouping
    rather than working it out again. A take's song is stored with it (see
    store/names.py), so this only counts.

    Takes nobody named are left out. "Take ×4" beside a take count that
    already says four is noise, and a rehearsal where nothing was named is
    better off saying nothing at all.
    """
    songs, by_title = [], {}
    for take in takes:
        title = take.get("song")
        if title is None:
            continue
        if title in by_title:
            by_title[title]["takes"] += 1
            by_title[title]["take_numbers"].append(take.get("take_number"))
        else:
            song = {"name": title, "takes": 1, "take_numbers": [take.get("take_number")]}
            by_title[title] = song
            songs.append(song)
    return songs


def _runs_of(takes):
    """
    The evening as it was played, for the strip history draws of a
    rehearsal: the takes in order, in runs of goes at the same song, as
    [{"song", "takes": [{"duration_sec", "keep"}]}]. A song played, left and
    come back to is two runs, since that is how the evening went. "song" is
    None for takes nobody named; "keep" is a take somebody marked to keep.
    """
    runs = []
    for take in takes:
        song = take.get("song")
        go = {"duration_sec": take.get("duration_sec") or 0,
              "keep": any(m.get("kind") == "good" for m in take.get("markers") or [])}
        if runs and runs[-1]["song"] == song:
            runs[-1]["takes"].append(go)
        else:
            runs.append({"song": song, "takes": [go]})
    return runs


def _next_go(takes, song, take_number=None):
    """
    What take `take_number` would be called as a go at `song` among a
    rehearsal's `takes`: one past the highest go at it there — "Polyn 3"
    after "Polyn 2", and after a deleted "Polyn 2" too, rather than a second
    one. The take being named is not a go of its own, and a take already a
    go at `song` keeps its go: "Polyn 2" renamed to Polyn stays Polyn 2.
    The count Library._resolve makes, done here on takes already read, so
    a list of songs costs no query per song.
    """
    for t in takes:
        if t.get("take_number") == take_number and t.get("song") == song:
            return t["name"]
    goes = [t.get("go") or 1 for t in takes
            if t.get("song") == song and t.get("take_number") != take_number]
    return take_name(song, max(goes, default=0) + 1, take_number)


def _last_attempt(takes, song):
    """
    How long the latest go at `song` ran, as {"song", "duration_sec"}, or
    None when there was none. The recording screen says it under its clock —
    "Vesna took 2:21 last time" — so the band can see how far into the song
    they are.
    """
    if song is None:
        return None
    goes = [t for t in takes if t.get("song") == song]
    if not goes:
        return None
    return {"song": song, "duration_sec": goes[-1].get("duration_sec")}
```

- [ ] **Step 4: The next take, and the songs offered**

In `session_state`, replace the `next_name = self.suggest_take_name()` line and the two keys that used it:

```python
        coming = self._next_take()
```

```python
            "next_take_name": coming["name"],
```

```python
            "last_attempt": _last_attempt(takes, coming["song"]),
```

Replace `suggest_take_name` with these two methods:

```python
    def _next_take(self, take_number=None, chosen=True):
        """
        What the take being named would be, as {"song", "go", "name"}.

        A new take is usually another go at the same song, so it is the
        previous take's song at its next go: "Polyn 3" after "Polyn 2". After
        a take nobody named, it is "Take N".

        take_number is the take being named. Left out, it means the take that
        comes next, which is what the rehearsal screen shows before
        recording. Right after a take it must be passed, otherwise the very
        first take would be offered as "Take 2".

        A name chosen for the next take on the rehearsal screen comes before
        all of that (see set_next_take_name), resolved as any name is —
        "polyn" is the next go at Polyn — unless `chosen` is False: then this
        is what the take would be without it.
        """
        if self._session is None:
            return {"song": None, "go": None, "name": "Take 1"}
        number = (take_number if take_number is not None
                  else self._session["take_counter"] + 1)
        folder = self._session["folder"]
        picked = self._session.get("next_name")
        if chosen and picked:
            try:
                return self._lib.resolve_name(folder, picked, number)
            except Exception:
                # The library could not say which go it would be. The name
                # picked is still the one to offer, as it was typed.
                return {"song": None, "go": None, "name": picked}
        takes = self._session_takes()
        song = takes[-1].get("song") if takes else None
        return self._lib.resolve_name(folder, song or "", number)

    def suggest_take_name(self, take_number=None, chosen=True):
        """The name of the take being named — see _next_take."""
        return self._next_take(take_number, chosen)["name"]
```

In `song_choices`, delete the `others = …` line, and build `here` like this:

```python
        here = [{"song": s["name"], "name": _next_go(takes, s["name"], take_number),
                 "last_take": max(s["take_numbers"])}
                for s in _songs_of(takes)]
```

Change the sentence in its docstring that begins with "`take_number` is the take being named" to: `` `take_number` is the take being named, which is not counted as a go, and which keeps its own go at its own song: "Polyn 2" renamed to Polyn stays Polyn 2. ``

Check that nothing still uses the deleted helpers:

Run: `grep -n "_song_of\|_UNNAMED_TAKE\|_ATTEMPT_NUMBER" src/rehearsal_recorder/api.py`
Expected: no output.

- [ ] **Step 5: Run the Python suites**

Run: `venv/bin/python tests/run_all.py`
Expected: all pass, including [52], [16], [16a], [16c] and [51].

- [ ] **Step 6: The interface hears of `song` and `go`**

In `ui/src/lib/api.ts`, add to `Take` after `name: string`:

```ts
  /** The song this take is a go at, or null for a take nobody named. Its
   *  name follows from the two. */
  song?: string | null
  /** Which go at the song this was that evening; null with no song. */
  go?: number | null
```

In `ui/e2e/fake-bridge.js`, add after the `songsOf` function:

```js
// What a take is a go at, as Python's library says it. The mock's names
// follow the same rule, so it reads them back off the name.
function songAndGo(name) {
  name = (name || '').trim();
  if (!name || /^Take \d+$/.test(name)) return {song: null, go: null};
  const m = /^(.*?)\s+(\d+)$/.exec(name);
  return m ? {song: m[1], go: Number(m[2])} : {song: name, go: 1};
}
const named = (t) => ({...t, ...songAndGo(t.name)});
```

Then use it wherever the fake makes a take:
- In `pastRehearsal`, make each of the three `return {folder, name:…, created_at:…, takes}` statements return `takes: takes.map(named)` instead of `takes`.
- In `keep_take`, `const take = named({take_number:n, name:name || ('Take ' + n), duration_sec:dur, tracks, markers: markers || []});`.
- In `rename_take`, `if (take) Object.assign(take, {name}, songAndGo(name));`.
- In `recover_draft`, `take: named({take_number:1, name:'Recovered', duration_sec:5, tracks:[], markers:[]})`.

- [ ] **Step 7: Run the interface suites**

Run: `cd ui && npm test && npm run lint && npm run build && npm run test:e2e`
Expected: Vitest passes, lint shows 20 warnings and no errors, and every Playwright test passes.

- [ ] **Step 8: Commit**

```bash
git add src/rehearsal_recorder/api.py ui/src/lib/api.ts ui/e2e/fake-bridge.js tests/test_engine.py
git commit -m "Songs, runs and the next take come from each take's song, not its name

The interface is sent song and go on every take; nothing it shows changes.

Test changed: test_engine [16c] offers take 2 of Polyn its own name,
'Polyn 2', not 'Polyn 4', since renaming a take to its own song keeps
its go.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: A take's folder carries the name it ends up with

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`keep_take`, `recover_draft`, `rename_take`, and a new module-level `_take_dir_name`)
- Test: `tests/test_engine.py` (new [53])

**Interfaces:**
- Consumes: `Library.resolve_name` (Task 2).
- Produces: `_take_dir_name(take_number: int, name: str) -> str`, a module-level function in `api.py` returning `"03 - Polyn 3"`.

- [ ] **Step 1: Write the failing test**

Insert before the closing `print("\n" + "=" * 60)`:

```python
    print("\n[53] A take's folder carries the name it ends up with")
    _, n53 = fresh_api(Path(tempfile.mkdtemp()))
    n53.start_rehearsal("Names", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    f53 = Path(n53._session["folder"])

    def keep53(number, name):
        draft = f53 / "_drafts" / f"take {number}"
        write_wav(draft / "Gtr.wav", 100, seconds=0.5)
        n53._session["take_counter"] = number
        return n53.keep_take(number, str(draft), name, 0.5,
                             [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])["take"]

    def folder_of(take):
        return Path(take["tracks"][0]["file"]).parent.name

    keep53(1, "Polyn")
    typed = keep53(2, "Polyn 7")
    ok("a typed go number gives way to the app's, folder and all",
       typed["name"] == "Polyn 2" and folder_of(typed) == "02 - Polyn 2")
    unnamed = keep53(3, "Take 9")
    ok("a take nobody named is called by its own number, folder and all",
       unnamed["name"] == "Take 3" and folder_of(unnamed) == "03 - Take 3")
    spelled = keep53(4, "polyn")
    ok("a song is spelled one way on disk too",
       spelled["name"] == "Polyn 3" and folder_of(spelled) == "04 - Polyn 3")

    same = n53.rename_take(str(f53), 2, "Polyn")
    ok("renamed to the song it already has, a take keeps its go and its folder",
       same["ok"] and same["take"]["name"] == "Polyn 2"
       and folder_of(same["take"]) == "02 - Polyn 2"
       and not any(p.name.startswith("02 - Polyn 2 (") for p in f53.iterdir()))
    moved = n53.rename_take(str(f53), 3, "polyn")
    ok("renamed to a song, a take is its next go here, folder and all",
       moved["take"]["name"] == "Polyn 4" and folder_of(moved["take"]) == "03 - Polyn 4"
       and Path(moved["take"]["tracks"][0]["file"]).exists())
    ok("a blank name is still refused",
       n53.rename_take(str(f53), 3, "  ") == {"ok": False, "error": "Name cannot be empty"})

    rescued53 = f53 / "_drafts" / "take 9"
    rescued53.mkdir(parents=True)
    (rescued53 / "Gtr.raw").write_bytes(struct.pack("<h", 1234) * SR)
    got53 = n53.recover_draft(str(rescued53))
    ok("a draft rescued with no name is a take nobody named",
       got53["ok"] and got53["take"]["name"] == "Take 5"
       and folder_of(got53["take"]) == "05 - Take 5")
```

- [ ] **Step 2: Run it and watch it fail**

Run: `venv/bin/python tests/test_engine.py`
Expected: FAIL on "a typed go number gives way…": the folder is `02 - Polyn 7`. FAIL on "a take nobody named…" (`03 - Take 9`), on "a song is spelled one way on disk too" (`04 - polyn`), and on "a draft rescued with no name…" (`05 - Recovered take 5`).

- [ ] **Step 3: Name folders after the resolved name**

In `src/rehearsal_recorder/api.py`, add after `_unique_path`:

```python
def _take_dir_name(take_number, name):
    """What a take's folder is called: "03 - Polyn 3"."""
    return f"{int(take_number):02d} - {_safe_name(name)}"
```

In `keep_take`, replace the `display_name = …` and `take_dir = _unique_path(…)` lines with:

```python
        # Named as it will be kept: the song and go the name resolves to, not
        # what was typed — "polyn 7" for the third go is "Polyn 3".
        named = self._lib.resolve_name(s["folder"], custom_name, take_number)
        take_dir = _unique_path(s["folder"] / _take_dir_name(take_number, named["name"]))
```

In its `take_info`, set `"name": (custom_name or "").strip(),`. The library resolves it the same way when it writes the take.

In `recover_draft`, replace the `display_name = …` and `take_dir = _unique_path(…)` lines with:

```python
        # A draft rescued with no name is a take nobody named: "Take 5".
        display_name = (name or "").strip()
        named = self._lib.resolve_name(folder, display_name, take_number)
        take_dir = _unique_path(folder / _take_dir_name(take_number, named["name"]))
```

In `rename_take`, after the `take is None` checks, add:

```python
        # The folder carries the name the take ends up with, which can differ
        # from what was typed: renamed to its own song, a take keeps its go.
        named = self._lib.resolve_name(folder, display_name, take_number)
```

and change the target line to:

```python
            target = folder / _take_dir_name(take_number, named["name"])
```

The call `self._lib.update_take(folder, take_number, name=display_name, tracks=new_tracks)` stays as it is.

- [ ] **Step 4: Run the Python suites**

Run: `venv/bin/python tests/run_all.py`
Expected: all pass, including [8c], [9] (the `POLYN` case-only rename), [13], [53] and [11l].

- [ ] **Step 5: Commit**

```bash
git add src/rehearsal_recorder/api.py tests/test_engine.py
git commit -m "A take's folder carries the name it ends up with

Saving, renaming and recovering name the folder after the song and go the
name resolves to; a rescued draft nobody named is Take N.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Putting names right, in the background

**Files:**
- Create: `src/rehearsal_recorder/names_pass.py`
- Modify: `src/rehearsal_recorder/cloud.py` (`PublishQueue.busy`)
- Modify: `src/rehearsal_recorder/api.py`:
  - `__init__`, `attach_window`, `shutdown` and `set_recordings_dir`;
  - `rename_take` and `delete_take`;
  - new methods `_move_take_dir`, `_out_of_line`, `_names_out_of_line`, `_names_must_wait`, `_put_name_right` and `_playing_from`;
  - a new module-level `_carries`.
- Modify: `ui/src/lib/api.ts` (`ActivityEntry.kind` gains `"names"`)
- Test: `tests/test_engine.py` (new [54])

**Interfaces:**
- Consumes:
  - `_take_dir_name` (Task 4).
  - `Library.update_take(…, tracks=)`.
  - `activity.Journal.begin(kind, title)`, and `Entry.progress/done/fail/discard`.
- Produces:
  - `NamesPass(find, fix, busy, journal, wait=0.5)` with `.run() -> int`, `.request()`, `.start()` and `.stop()`.
  - `PublishQueue.busy() -> bool`.
  - `Api._move_take_dir(folder, take_number, take, name) -> (moved, tracks, error)`.

- [ ] **Step 1: Write the failing test**

Insert before the closing `print("\n" + "=" * 60)`:

```python
    print("\n[54] Putting names right")
    import shutil
    from sqlalchemy import text as sql_text
    from rehearsal_recorder.activity import Journal
    from rehearsal_recorder.names_pass import NamesPass
    from rehearsal_recorder.store import db as dbmod

    # The loop: waits while files are busy, renames take by take, one entry.
    journal54 = Journal()
    fixed54 = []
    waits54 = iter([True, True, False, False])

    def fix54(folder, number):
        fixed54.append(number)
        if number == 1:
            return {"renamed": True, "error": None}
        return {"renamed": False, "error": "it is open elsewhere"}

    loop54 = NamesPass(find=lambda: [("/r", 1, "Polyn"), ("/r", 2, "Vesna")], fix=fix54,
                       busy=lambda: next(waits54, False), journal=journal54, wait=0.001)
    ok("it waits while files are in use, then renames take by take",
       loop54.run() == 1 and fixed54 == [1, 2])
    entry54 = journal54.snapshot()[0]
    ok("one entry for the whole pass, saying which take was left and why",
       entry54["kind"] == "names" and entry54["title"] == "Putting names right"
       and entry54["state"] == "failed" and "“Vesna”: it is open elsewhere" in entry54["error"])
    quiet54 = Journal()
    ok("with nothing to put right it shows nothing",
       NamesPass(find=lambda: [], fix=fix54, busy=lambda: False, journal=quiet54).run() == 0
       and quiet54.snapshot() == [])
    stopped54 = Journal()
    halted54 = NamesPass(find=lambda: [("/r", 3, "Ogon")], fix=fix54, busy=lambda: True,
                         journal=stopped54, wait=0.001)
    halted54.stop()
    ok("stopped while it waits, it renames nothing and leaves nothing behind",
       halted54.run() == 0 and 3 not in fixed54 and stopped54.snapshot() == [])

    # The real thing: a library from before songs, opened by this version.
    tmp54 = Path(tempfile.mkdtemp())
    rec54, cloud54 = tmp54 / "Rec", tmp54 / "Drive"
    jam54 = rec54 / "Jam - 2026-01-10 19-00"
    upto54 = tmp54 / "migrations"
    shutil.copytree(dbmod.MIGRATIONS, upto54, ignore=shutil.ignore_patterns("__pycache__"))
    for f in (upto54 / "versions").glob("*.py"):
        if f.name[:4] > "0001":
            f.unlink()
    rec54.mkdir(parents=True)
    dbmod.open_engine(rec54, upto54).dispose()
    engine54 = dbmod.make_engine(dbmod.database_path(rec54))
    with engine54.begin() as c:
        rid = c.execute(sql_text(
            "INSERT INTO rehearsal (folder, name, created_at, samplerate, bit_depth) "
            "VALUES (:f, 'Jam', '2026-01-10T19:00:00', 48000, 16)"), {"f": jam54.name}).lastrowid
        for n, old in enumerate(["Polyn", "polyn 2", "Recovered take 3", "polyn 4"], start=1):
            take_dir = jam54 / f"{n:02d} - {old}"
            write_wav(take_dir / "Gtr.wav", 100, seconds=0.5)
            tid = c.execute(sql_text(
                "INSERT INTO take (rehearsal_id, take_number, name, duration_sec, cloud_skip, "
                "cloud_send) VALUES (:r, :n, :name, 0.5, 0, 0)"),
                {"r": rid, "n": n, "name": old}).lastrowid
            c.execute(sql_text("INSERT INTO take_file (take_id, position, name, file) "
                               "VALUES (:t, 0, 'Gtr', :f)"), {"t": tid, "f": f"{take_dir.name}/Gtr.wav"})
            if n == 2:
                mix = cloud54 / jam54.name / f"{n:02d} - {old}.wav"
                mix.parent.mkdir(parents=True)
                mix.write_bytes(b"RIFF")
                c.execute(sql_text("INSERT INTO cloud_copy (take_id, mix, mix_format, source) "
                                   "VALUES (:t, :m, 'wav', '{}')"),
                          {"t": tid, "m": f"{jam54.name}/{mix.name}"})
    engine54.dispose()
    (tmp54 / "config.json").write_text(json.dumps(
        {"recordings_dir": str(rec54), "cloud_dir": str(cloud54)}), encoding="utf-8")
    _, p54 = fresh_api(tmp54)

    def dirs54():
        return sorted(p.name for p in jam54.iterdir() if p.is_dir())

    real_move54 = p54._move_take_dir

    def refuse_take_4(folder, number, take, name):
        if number == 4:
            return None, None, "the folder is open in another program"
        return real_move54(folder, number, take, name)

    p54._move_take_dir = refuse_take_4
    try:
        renamed54 = p54._names_pass.run()
    finally:
        p54._move_take_dir = real_move54
    takes54 = {t["take_number"]: t for t in p54.get_rehearsal(str(jam54))["takes"]}
    ok("old names are put right on disk, a case-only rename included",
       renamed54 == 2 and "02 - Polyn 2" in dirs54() and "03 - Take 3" in dirs54()
       and Path(takes54[2]["tracks"][0]["file"]).parent.name == "02 - Polyn 2"
       and Path(takes54[2]["tracks"][0]["file"]).exists())
    ok("and in the cloud folder",
       Path(takes54[2]["cloud"]["mix"]).name == "02 - Polyn 2.wav"
       and sorted(p.name for p in (cloud54 / jam54.name).iterdir()) == ["02 - Polyn 2.wav"])
    ok("a take that could not be renamed is left as it was, the others done",
       "04 - polyn 4" in dirs54())
    names_entry54 = next(e for e in p54.activity()["entries"] if e["kind"] == "names")
    ok("and the background work says which take, and why",
       names_entry54["state"] == "failed" and "“Polyn 4”" in names_entry54["error"]
       and "open in another program" in names_entry54["error"])
    ok("the next pass picks it up", p54._names_pass.run() == 1 and "04 - Polyn 4" in dirs54())
    entries54 = len(p54.activity()["entries"])
    ok("once every name matches, a pass renames nothing and says nothing",
       p54._names_pass.run() == 0 and len(p54.activity()["entries"]) == entries54)

    third54 = Path(takes54[3]["tracks"][0]["file"]).parent
    taken54 = jam54 / "03 - Take 3 (2)"
    third54.rename(taken54)
    p54._lib.update_take(jam54, 3, tracks=[{"name": "Gtr", "file": str(taken54 / "Gtr.wav")}])
    ok("a folder that took “(2)” because the name was taken counts as carrying it",
       all(n != 3 for _, n, _ in p54._names_out_of_line()))

    first54 = Path(takes54[1]["tracks"][0]["file"]).parent
    lower54 = jam54 / "01 - polyn"
    first54.rename(lower54)
    p54._lib.update_take(jam54, 1, tracks=[{"name": "Gtr", "file": str(lower54 / "Gtr.wav")}])
    p54.player_open([{"name": "Gtr", "file": str(lower54 / "Gtr.wav")}])
    ok("a take open in the player is left for next time, not closed under the listener",
       p54._names_pass.run() == 0 and "01 - polyn" in dirs54()
       and p54._open_tracks is not None)
    p54.player_close()
    ok("and is renamed once the player lets go",
       p54._names_pass.run() == 1 and "01 - Polyn" in dirs54())

    p54._recorder = object()
    ok("it waits while a take records", p54._names_must_wait())
    p54._recorder = None
    crop54 = p54._journal.begin("crop", "Cropping")
    ok("and while a take is being cropped", p54._names_must_wait())
    crop54.done()
    ok("and not otherwise", not p54._names_must_wait())
```

- [ ] **Step 2: Run it and watch it fail**

Run: `venv/bin/python tests/test_engine.py`
Expected: `ModuleNotFoundError: No module named 'rehearsal_recorder.names_pass'`

- [ ] **Step 3: The loop**

Create `src/rehearsal_recorder/names_pass.py`:

```python
"""
Putting names right, in the background.

A take's folder on disk and its copies in the cloud folder are named after
the take, and the name follows from its song and its go (store/names.py).
When the name changes without the files — migration 0002 respelling "polyn
2" as "Polyn 2", "Recovered take 5" becoming "Take 5" — this renames
whatever no longer carries it.

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
        for i, (folder, take_number, name) in enumerate(todo):
            while self._busy() and not self._stop.is_set():
                self._stop.wait(self._wait)
            if self._stop.is_set():
                entry.discard()
                return renamed
            entry.progress(i / len(todo), f"“{name}”")
            result = self._fix(folder, take_number)
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
```

In `src/rehearsal_recorder/cloud.py`, add to `PublishQueue` after `states`:

```python
    def busy(self):
        """Whether a copy is being made right now."""
        with self._lock:
            return self._active is not None
```

- [ ] **Step 4: Wire it into Api**

In `src/rehearsal_recorder/api.py`, add the import after the `cloudmod` import:

```python
from rehearsal_recorder.names_pass import NamesPass
```

Add after `_take_dir_name`:

```python
def _carries(dir_name, expected):
    """
    Whether a folder named `dir_name` carries the name `expected`: it is
    that name, or that name with " (2)" after it, which _unique_path gives a
    take whose name was taken. Renaming such a folder would only land on
    " (2)" again, on every open.
    """
    return (dir_name == expected
            or re.fullmatch(re.escape(expected) + r" \(\d+\)", dir_name) is not None)
```

In `Api.__init__`, after `self._window = None`:

```python
        # Renaming a take's files and putting names right do not run over
        # each other's folders.
        self._files_lock = threading.RLock()
        # Takes whose folder or cloud copy no longer carries their name are
        # renamed in the background — see names_pass.py.
        self._names_pass = NamesPass(
            find=self._names_out_of_line, fix=self._put_name_right,
            busy=self._names_must_wait, journal=self._journal,
        )
```

In `attach_window`, after `self._cloud_queue.start()`: `self._names_pass.start()`.
In `shutdown`, after `self._cloud_queue.stop()`: `self._names_pass.stop()`.
In `set_recordings_dir`, after `self._server.set_media_root(folder)`: `self._names_pass.request()`.

Extract the folder move from `rename_take` into a method. Put it just before `rename_take`:

```python
    def _move_take_dir(self, folder, take_number, take, name):
        """
        A take's folder renamed to carry `name`, so the names still make
        sense browsing the disk. Returns (moved, tracks, error): the (old,
        new) folders when it moved, the take's files at their new paths
        (None when nothing moved), and why it could not be moved.
        """
        old_dirs = {Path(t["file"]).parent for t in take["tracks"] if t.get("file")}
        if len(old_dirs) != 1:
            return None, None, None
        old_dir = old_dirs.pop()
        target = folder / _take_dir_name(take_number, name)
        # Path itself compares case-insensitively on Windows, so whether
        # the spelling actually changed is asked of plain strings.
        same_spelling = str(target) == str(old_dir)
        same_folder = same_spelling or (
            target.exists() and old_dir.exists() and target.samefile(old_dir)
        )
        if same_folder:
            # The name is unchanged, or changes only in case (a case-blind
            # file system sees the same folder either way). A case-only
            # rename is still a real change to show, so it is made in place;
            # otherwise nothing moves — chasing `_unique_path` here would
            # only push the take into its own "(2)" folder.
            new_dir = old_dir if same_spelling else target
        else:
            new_dir = _unique_path(target)
        if not old_dir.exists() or str(old_dir) == str(new_dir):
            return None, None, None
        # Windows will not rename a folder holding a file the player has
        # mapped, and the rehearsal screen is usually playing the very take
        # it offers to rename. The interface reopens the take from its new
        # path afterwards.
        self._release_player_in(old_dir)
        try:
            old_dir.rename(new_dir)
        except OSError as e:
            return None, None, str(e)
        return ((old_dir, new_dir),
                [{**t, "file": str(new_dir / Path(t["file"]).name)} for t in take["tracks"]],
                None)
```

`rename_take` then becomes the following. The checks before `take = self._lib.take(…)` stay as they are; from there on, all of it runs under the lock:

```python
        with self._files_lock:
            take = self._lib.take(folder, take_number)
            if take is None:
                if not self._lib.has(folder):
                    return {"ok": False, "error": "Rehearsal not found"}
                return {"ok": False, "error": "Take not found"}

            # The folder carries the name the take ends up with, which can
            # differ from what was typed: renamed to its own song, a take
            # keeps its go.
            named = self._lib.resolve_name(folder, display_name, take_number)
            moved, new_tracks, error = self._move_take_dir(
                folder, take_number, take, named["name"])
            if error is not None:
                print(f"[rename] take folder: {error}")

            try:
                updated = self._lib.update_take(
                    folder, take_number, name=display_name, tracks=new_tracks
                )
            except Exception:
                # The folder must not stay renamed under a record that still
                # points at the old one: the take would stop opening.
                if moved:
                    moved[1].rename(moved[0])
                raise
            if updated is None:
                # Deleted while the folder was being renamed.
                if moved:
                    moved[1].rename(moved[0])
                return {"ok": False, "error": "Take not found"}

            # The copies in the cloud folder are named after the take.
            self._rename_take_copies(folder, take_number, updated)
            return {"ok": True, "take": updated}
```

In `delete_take`, wrap everything from `target = self._lib.take(folder, take_number)` to the final `return` in `with self._files_lock:`.

Add the pass's side of it after `_move_rehearsal_copies`, at the end of the class:

```python
    # ---------- putting names right ----------

    def _out_of_line(self, take):
        """
        What of a take does not carry its name: a subset of {"disk",
        "cloud"}. Only what can be renamed counts: a take whose files are in
        more than one folder, or are not on disk, has no folder to rename.
        """
        wrong = set()
        dirs = {Path(t["file"]).parent for t in take["tracks"] if t.get("file")}
        if len(dirs) == 1:
            d = next(iter(dirs))
            if d.is_dir() and not _carries(d.name, _take_dir_name(take["take_number"], take["name"])):
                wrong.add("disk")
        shared = take.get("cloud") or {}
        base = self._cloud_base(take["take_number"], take)
        for key in ("mix", "tracks"):
            if shared.get(key):
                path = Path(shared[key])
                if (path.stem if key == "mix" else path.name) != base:
                    wrong.add("cloud")
        return wrong

    def _names_out_of_line(self):
        """Every take on disk whose folder or cloud copy does not carry its
        name, as (folder, take_number, name). The database, plus one
        is_dir() per take."""
        if self._library is None:
            return []
        todo = []
        for r in self._lib.rehearsals():
            if r["missing"]:
                continue
            for t in r["takes"]:
                if self._out_of_line(t):
                    todo.append((r["folder"], t["take_number"], t["name"]))
        return todo

    def _names_must_wait(self):
        """Files in use: a take recording, a copy being made, or a take being
        saved, cropped or recovered. The pass waits for them."""
        if self._recorder is not None or self._cloud_queue.busy():
            return True
        return any(e["state"] == "running" and e["kind"] in ("stop", "crop", "recover")
                   for e in self._journal.snapshot())

    def _playing_from(self, take):
        """Whether the player has this take's files open."""
        with self._player_lock:
            open_tracks = self._open_tracks or []
            return any(_is_inside(o["file"], Path(t["file"]).parent)
                       for o in open_tracks for t in take["tracks"] if t.get("file"))

    def _put_name_right(self, folder, take_number):
        """
        One take's folder and cloud copies renamed to carry its name, as
        rename_take would. A take open in the player is left for the next
        open, rather than closed under whoever is listening.
        """
        folder = Path(folder)
        with self._files_lock:
            take = self._lib.take(folder, take_number)
            wrong = self._out_of_line(take) if take is not None else set()
            if not wrong:
                return {"renamed": False, "error": None}
            if "disk" in wrong:
                if self._playing_from(take):
                    return {"renamed": False, "error": None}
                moved, tracks, error = self._move_take_dir(
                    folder, take_number, take, take["name"])
                if error is not None:
                    return {"renamed": False, "error": error}
                try:
                    updated = self._lib.update_take(folder, take_number, tracks=tracks)
                except Exception as e:
                    if moved:
                        moved[1].rename(moved[0])
                    return {"renamed": False, "error": str(e)}
                if updated is None:
                    if moved:
                        moved[1].rename(moved[0])
                    return {"renamed": False, "error": None}
                take = updated
            if "cloud" in wrong and self._cloud_dir is not None:
                self._rename_take_copies(folder, take_number, take)
            return {"renamed": True, "error": None}
```

In `ui/src/lib/api.ts`, change `ActivityEntry.kind` to `"cloud" | "crop" | "stop" | "recover" | "names"`.

- [ ] **Step 5: Run every suite**

Run: `venv/bin/python tests/run_all.py`
Expected: all pass. [9], [11g], [11m] and [25] still pass now that `rename_take` uses `_move_take_dir`.

Run: `cd ui && npm test && npm run lint && npm run build && npm run test:e2e`
Expected: passes, with 20 lint warnings.

- [ ] **Step 6: Commit**

```bash
git add src/rehearsal_recorder/names_pass.py src/rehearsal_recorder/cloud.py src/rehearsal_recorder/api.py ui/src/lib/api.ts tests/test_engine.py
git commit -m "Putting names right: old folders and cloud copies renamed to match, in the background

After the songs migration some takes' names differ from their folders and
cloud copies. A pass on every open renames them one take at a time, as
'Putting names right' in the background-work list, waiting while anything
records, copies, saves, crops or recovers, and leaving a take open in the
player for next time.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Docs, and a check in the real app

**Files:**
- Modify: `docs/design-notes.md`, `docs/development.md`, `docs/using-it.md`, `CHANGELOG.md`

- [ ] **Step 1: design-notes.md**

In "The history database", replace the paragraph that begins `**Songs are still not stored.**` with:

```markdown
**Songs are stored, and a take's name is not.** For a long time a song was
worked out from take names — "Verse riff 3" a third go at "Verse riff" — on
the grounds that a stored copy of a rule would drift from the names. That
held while a song was only a way of grouping takes. Once a song had data of
its own to carry (the one best take, a page of its own, a plan for the
evening) and was picked with a click rather than typed, the song became the
fact and the name the derived thing: `song` is a table, a take points at one
with its go, and `store/names.py` writes the name from the two. A spelling
is then one row, and a title ending in a number ("Opus 5") can be a song of
its own.

**The go is stored, not counted.** Counting goes from the takes on every
read would renumber them when one is deleted: "Polyn 3" would become "Polyn
2", and its folder and cloud copy would be renamed for no reason. A stored
go is what the take was called when it was made.

**Names are put right in the background.** A take's folder and cloud copy
are named after it, so when its name changes without them — migration 0002
respelling "polyn 2" as "Polyn 2" — `names_pass.py` renames them on the next
open, a take at a time, waiting while anything records, copies or crops.
```

- [ ] **Step 2: development.md**

In "Changing the history's schema", step 3, replace the batch-mode bullet with:

```markdown
   - SQLite can barely `ALTER` a table. Adding a column, or dropping one
     that is in no index or constraint, works in place (`ALTER TABLE … ADD
     COLUMN` / `DROP COLUMN`, SQLite 3.35 and later), and that is what to use
     on `rehearsal` and `take`. Anything more needs batch mode (`with
     op.batch_alter_table(...) as batch:`), which rebuilds the table: a copy,
     `DROP TABLE`, and a rename. With foreign keys on — and the app always
     turns them on — that `DROP TABLE` deletes the rows of every table that
     points at it with `ON DELETE CASCADE`: rebuilding `take` this way empties
     `take_file`, `marker` and `cloud_copy`. Batch mode is safe only on a
     table nothing cascades from. `env.py` renders migrations in batch mode,
     so check what the generated file does to those two tables; migration
     0002 shows the in-place way.
```

- [ ] **Step 3: using-it.md**

In "Names and songs", after its second paragraph (the one ending "…and are not counted as a song."), add:

```markdown
Each take is a go at a song, and its name follows from that: the song's
title, then "Polyn 2", "Polyn 3", in the order played that evening. The app
counts the goes, so typing "Polyn 5" for the third go names it "Polyn 3". A
song is spelled one way everywhere: typing "polyn" gives "Polyn" when that
song is there. A title can end in a number, like "Opus 5", as long as no
song is called "Opus"; otherwise it is the fifth go at "Opus". A take nobody
named is called by its number, "Take 4", and so is a recovered take you did
not name.
```

- [ ] **Step 4: CHANGELOG.md**

Add as the first item under `## Unreleased`:

```markdown
- **Songs are kept in the history, and a take's name follows from its
  song.** A take is a go at a song: the song's title, then "Polyn 2",
  "Polyn 3". The app counts the goes, so a typed number does not change
  which go a take is; a song is spelled one way everywhere; and a title can
  end in a number ("Opus 5") when no song is called "Opus". A recovered take
  nobody named is "Take 5", like any other. Older takes move over the first
  time this version opens the recordings folder (a copy of the history is
  kept beside it, as `library.sqlite.bak-0001`), and their folders and cloud
  copies are renamed to match in the background, as *Putting names right*.
  Nothing else looks different. This is what the song pages and the one
  best take will stand on (#12).
```

- [ ] **Step 5: Commit the docs**

```bash
git add docs/design-notes.md docs/development.md docs/using-it.md CHANGELOG.md
git commit -m "Docs: songs are stored, names follow from them, and why take is altered in place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Check in the real app, on a copy of the library**

The real recordings folder migrates the first time this version opens it. Check on a copy first: the folder structure and the database, without the audio, and with no cloud folder.

```bash
SCRATCHPAD="/path/from/the/system/prompt"   # this session's scratchpad directory
CHECK="$SCRATCHPAD/songs-check"
rm -rf "$CHECK" && mkdir -p "$CHECK/home/.rehearsal-recorder"
REC=$(venv/bin/python -c 'import json, pathlib; p = pathlib.Path.home() / ".rehearsal-recorder" / "config.json"; c = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}; print(c.get("recordings_dir") or pathlib.Path.home() / "RehearsalRecordings")')
rsync -a --exclude='*.wav' --exclude='*.flac' --exclude='*.mp3' --exclude='*.raw' "$REC/" "$CHECK/Rec/"
venv/bin/python - "$CHECK" <<'EOF'
import json, pathlib, sys
check = pathlib.Path(sys.argv[1])
source = pathlib.Path.home() / ".rehearsal-recorder" / "config.json"
config = json.loads(source.read_text(encoding="utf-8")) if source.exists() else {}
config["recordings_dir"] = str(check / "Rec")
config.pop("cloud_dir", None)
(check / "home" / ".rehearsal-recorder" / "config.json").write_text(json.dumps(config), encoding="utf-8")
EOF
HOME="$CHECK/home" nohup venv/bin/python -m rehearsal_recorder > "$CHECK/app.log" 2>&1 &
```

Look at the app and check:
- History lists the same rehearsals. Their songs read as before, except that each song is spelled one way and old "Recovered take N" takes are "Take N".
- The background-work list showed *Putting names right* once, with the number of takes renamed.
- `find "$CHECK/Rec" -mindepth 2 -maxdepth 2 -type d | sort`: every take folder is `NN - <its name>` as History shows it.
- `ls "$CHECK/Rec"` shows `library.sqlite.bak-0001`.
- Quit and start again with the same command: the background-work list shows nothing new.
- `cat "$CHECK/app.log"` has no traceback.

Report what was seen. Do not point the app at the real recordings folder; the user decides when.
