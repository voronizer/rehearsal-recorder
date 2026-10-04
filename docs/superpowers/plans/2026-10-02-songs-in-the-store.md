# Songs in the Store Implementation Plan

**Status:** done — every task implemented, reviewed and merged on 2026-10-04.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store songs in the history database. A take becomes a go at a song (or at nothing), with a go number of its own. Go numbers run across the whole library and are shown beside the song's title. Every existing take moves over, and old folders and cloud copies are renamed to match in the background.

**Architecture:**
- `song` and `take.song_id` / `take.go` replace `take.name`. Migration 0002 alters `take` in place and numbers old goes afresh.
- `store/names.py` holds:
  - `take_name`, which writes a take's plain-text name ("Polyn 3", "Take 4");
  - `legacy_song`, the frozen rule that reads old names.
- `Library` turns the text in the name field into a song and a go (`_resolve`). It offers the same answer read-only (`resolve_name`, `next_goes`) for naming folders and choices.
- `api.py` groups takes by their `song` field and sends the name field only titles.
- The interface shows the go beside the title (`GoTitle`, `TakeTitle`). The name field works out its go from the choices it already has (`goFor`).
- `names_pass.py` renames old folders and cloud copies in the background.

**Tech Stack:** Python 3.10+ (builds use 3.12), SQLite through SQLAlchemy 2 and Alembic, pywebview, React 19 + TypeScript + Tailwind, Vitest, Playwright against `ui/e2e/fake-bridge.js`.

**Spec:** `docs/superpowers/specs/2026-10-02-songs-in-the-store-design.md`

## Global Constraints

- No new dependencies: `requirements.txt` and `ui/package.json` stay as they are.
- SQLite 3.35.5 or newer (for `ALTER TABLE … DROP COLUMN`). Migration 0002 checks it and says so. The builds' Python 3.12 ships 3.40 or newer.
- **Never batch-alter `take` or `rehearsal`.** Alembic's batch mode rebuilds a table: a copy, `DROP TABLE`, then a rename. With `PRAGMA foreign_keys=ON`, which the app always sets, that `DROP TABLE` deletes every row pointing at the table with `ON DELETE CASCADE`. Checked on 2026-10-02: rebuilding `take` emptied `marker`, `take_file` and `cloud_copy`. Alter in place instead.
- Go numbers run per song across the whole library. A number is given once and kept (spec D4, D5).
- A take's plain-text name is `"<title> <go>"`, the go always there from 1, or `"Take N"` with no song (spec D3). Folders and cloud copies are `"NN - <plain-text name>"` (spec D7).
- The name field holds only a title, or "Take N". It never holds a go (spec D2).
- Python tests are scripts, not pytest. Each check is `ok(label, cond)` inside `main()`, under `print("\n[N] …")` headings. Run them with `venv/bin/python tests/test_store.py`, `venv/bin/python tests/test_engine.py`, or all at once with `venv/bin/python tests/run_all.py`.
- Interface checks: `cd ui && npm test`, `cd ui && npm run lint` (20 warnings today, no more), `cd ui && npm run build && npm run test:e2e`.
- **Changing an existing test.**
  - Python tests may change only where this plan names them, with the new value the plan gives.
  - Playwright tests may change only where a value differs because of spec D2, D3, I1–I5 or the fake's new shapes. Examples: a name now carries its go ("Polyn 1"), a field now holds the title ("Ogon" where "Ogon 2" was), a pill's text now carries its go ("Vesna 1").
  - Every changed test is listed in the commit message with the decision it follows.
  - Any other failure: stop and report it with its output. Do not edit the test.
- Comments follow the repo's voice: they say why, in plain sentences, like the surrounding code.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Nothing is pushed unless the user asks.
- Do not run the new version against the real recordings folder. Task 5 checks it on a copy.

## Decisions made while planning

These fill gaps the spec leaves open. The user agreed to the spec's direction, and these are the details.

1. **Migration 0002 alters `take` in place,** for the reason in Global Constraints. Downgrading is refused; `library.sqlite.bak-0001` is the way back.
2. **A case-only rename of a song's only take respells the song** ("Polyn" → "POLYN" when no other take is a go at Polyn). When other takes are, the title stays: respelling a song with many takes is *renaming a song*, a later step.
3. **For the take being renamed, its own song is offered with its own go** (`song_choices(folder, take_number)`), because renaming to its own song keeps its go (N2).
4. **Spelling of migrated songs:** the newest rehearsal's first go at the song, as `song_choices` spelled "other" songs before. **An imported `session.json`:**
   - a song already in the library keeps its title, and its goes continue from its highest;
   - a new song is spelled the way that rehearsal first spells it.
5. **An empty name passed to `keep_take` is "Take N",** as today. The interface never sends an empty name; ✕ puts the default back. A recovered draft with no name is "Take N" (D6).
6. **The pass:**
   - a folder named "NN - name (2)" counts as matching (`_unique_path` adds that suffix when a name is taken, and renaming such a folder would only land on "(2)" again);
   - a take open in the player is left for the next open;
   - it waits while a take records, a copy is being made, or a take is being saved, cropped or recovered. It reads the journal's running entries for the last three.
7. **The interface works out the go beside the field itself,** with `goFor(text, choices)`: N1's steps over the choices the field already has. Neither the field nor the recording screen makes an extra call.
8. **The fake bridge counts goes within the takes it is given,** not across the library. Python's tests cover the numbering; the interface's tests check that it shows what it is sent. Each of the fake's "other" songs is offered as go 1.
9. **Until Task 3, `song_choices` entries keep a `name` key holding the title,** so the interface keeps working between commits. Task 3 drops it.

## Review Focus

1. **Migrating a real library keeps every marker, track file and cloud copy.** A batch rebuild of `take` would delete them through the cascades. → Task 2, test_store [9], row counts before and after.
2. **Cyrillic names that differ only in case are one song** ("ПОЛЫНЬ", "Полынь 2"). SQLite's `lower()` folds ASCII only. → Task 2, test_store [9] and [10].
3. **A typed "Take 9" for take 5 is "Take 5", and a number typed after a title names the song without choosing the go,** on disk too. → Task 2, test_store [10] and test_engine [52].
4. **A take folder that got " (2)" because its name was taken** is not "put right" on every open. → Task 4, test_engine [53].
5. **A take open in the player is not closed by the pass,** and is renamed once the player lets go. → Task 4, test_engine [53].

---

## File structure

| File | Change | What it is responsible for |
|---|---|---|
| `src/rehearsal_recorder/store/names.py` | create | `take_name`, `split_go`, `UNNAMED_TAKE`, and the frozen `legacy_song` |
| `src/rehearsal_recorder/store/models.py` | modify | `Song`; `Take.song_id`, `Take.go`, `Take.song`; `Take.name` dropped |
| `src/rehearsal_recorder/store/migrations/versions/0002_songs.py` | create | the schema change, and old names moved into songs and goes (M1–M4) |
| `src/rehearsal_recorder/store/library.py` | modify | `_resolve`, `resolve_name` and `next_goes`; songs made and deleted with their takes; `song`/`go`/`name` in what it returns; the importer's old-name rule |
| `src/rehearsal_recorder/api.py` | modify | grouping from `song`/`go`; the next take; title-only field text; `song_choices` with `go`; folders named after the plain-text name; the pass's wiring |
| `src/rehearsal_recorder/cloud.py` | modify | `PublishQueue.busy()` |
| `src/rehearsal_recorder/names_pass.py` | create | the background loop that puts names right (F1–F5) |
| `ui/src/lib/api.ts` | modify | `Take.song`/`go`, `SongChoice`, `next_take_go`, activity kind `"names"` |
| `ui/src/lib/goes.ts` (+ `goes.test.ts`) | create | `goFor(text, choices)` |
| `ui/src/components/TakeTitle.tsx` | create | `GoTitle` and `TakeTitle` |
| `ui/src/components/SongPills.tsx`, `TakeNameField.tsx`, `TakeStrip.tsx`, `RehearsalOverview.tsx`, `ConfirmDialog.tsx` | modify | the go beside the title |
| `ui/src/screens/Rehearsal.tsx`, `ui/src/screens/Recording.tsx`, `ui/src/App.tsx` | modify | the recording screen shows the go |
| `ui/e2e/fake-bridge.js` | modify | the fake sends what Python now sends |
| `ui/e2e/naming.spec.ts` (and others) | modify | new checks, and existing ones following D2/D3 |
| `tests/test_store.py`, `tests/test_engine.py` | modify | as each task says |
| `docs/design-notes.md`, `docs/development.md`, `docs/using-it.md`, `CHANGELOG.md` | modify | docs |

---

### Task 1: The naming rule, in one place

**Files:**
- Create: `src/rehearsal_recorder/store/names.py`
- Test: `tests/test_store.py` (new section [8], just before the summary at the end of `main()`)

**Interfaces:**
- Produces:
  - `UNNAMED_TAKE` (compiled `^Take \d+$`).
  - `take_name(title: str | None, go: int | None, take_number: int) -> str`.
  - `split_go(name: str | None) -> tuple[str, int | None]`.
  - `legacy_song(name: str | None) -> str | None`.

- [ ] **Step 1: Write the failing test**

In `tests/test_store.py`, add to the imports beside the other `rehearsal_recorder` imports:

```python
from rehearsal_recorder.store.names import legacy_song, split_go, take_name  # noqa: E402
```

Insert this section in `main()` just before the final `print()` / `if problems:` block:

```python
    print("\n[8] What a take is called, and what an old name meant")
    ok("a take is called by its song and its go, the first go too",
       take_name("Polyn", 1, 4) == "Polyn 1" and take_name("Polyn", 3, 4) == "Polyn 3")
    ok("a title ending in a number keeps it", take_name("Song 2", 2, 1) == "Song 2 2")
    ok("a take with no song is called by its own number",
       take_name(None, None, 7) == "Take 7")
    ok("a trailing number is split off", split_go(" Polyn 3 ") == ("Polyn", 3))
    ok("a name without one has none", split_go("Polyn") == ("Polyn", None))
    ok("a bare number is a name, not a go", split_go("1999") == ("1999", None))
    ok("old names: a trailing number was the go, the rest the song",
       legacy_song("Polyn 3") == "Polyn" and legacy_song("Polyn") == "Polyn"
       and legacy_song("Полынь 2") == "Полынь")
    ok("old names: the app's own names are no song",
       legacy_song("Take 4") is None and legacy_song("Recovered take 2") is None
       and legacy_song("  ") is None and legacy_song(None) is None)
    ok("old names: what the rule cannot know stays as it reads",
       legacy_song("Опус 5") == "Опус")
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
stored but follows from the two: the song's title and its go, "Polyn 3" —
the go always there, from 1 — or "Take N", N being the take's own number,
for a take with no song. take_name() is that rule, and the only place it is
written. The interface draws the go apart from the title; this is the name
as plain text, which folders, cloud copies and dialog titles carry.

Naming a take goes the other way, from what was typed or clicked to a song
and a go. That needs the songs already in the library, so it is in
library.py (Library._resolve), using split_go from here.

legacy_song() is how names were read before songs were stored: a trailing
number was the go, the rest was the song. Migration 0002 and the import of
old session.json files read old names with it, so the two cannot differ. It
describes data that already exists, so it must not change when the rule for
new names does.
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
    """'Polyn 1', 'Polyn 3', or 'Take 7' for a take with no song."""
    if title is None:
        return f"Take {take_number}"
    return f"{title} {go or 1}"


def split_go(name):
    """'Polyn 3' -> ('Polyn', 3); 'Polyn' -> ('Polyn', None). Trimmed."""
    name = (name or "").strip()
    match = _TRAILING_NUMBER.match(name)
    if match and match.group(1).strip():
        return match.group(1).strip(), int(match.group(2))
    return name, None


def legacy_song(name):
    """
    The song an old take name was a go at, or None for a take nobody named.
    "Song 2" is a go at "Song" whether or not a song by that title was ever
    played: the old rule could not tell, and reading it any other way would
    change what old rehearsals say. The old number is not kept: goes are
    numbered afresh across the library.
    """
    name = (name or "").strip()
    if not name or UNNAMED_TAKE.match(name) or _RECOVERED_TAKE.match(name):
        return None
    return split_go(name)[0]
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

### Task 2: Python speaks songs

The store and `api.py` change together. Changing the store alone would change every name the API returns, and a whole round of test edits would then be undone by the next task. The interface keeps working after this task: the name field gets titles, and the pills get a `name` key holding the title (decision 9).

**Files:**
- Modify: `src/rehearsal_recorder/store/models.py`
- Create: `src/rehearsal_recorder/store/migrations/versions/0002_songs.py`
- Modify: `src/rehearsal_recorder/store/library.py`
- Modify: `src/rehearsal_recorder/api.py`
- Test: `tests/test_store.py` (adjust [1], [3], [4] and [7]; new [9] and [10])
- Test: `tests/test_engine.py` (new [52]; the changes listed in Step 9)

**Interfaces:**
- Consumes: `take_name`, `split_go`, `UNNAMED_TAKE` and `legacy_song` (Task 1).
- Produces:
  - Every take dict from `Library` and the API has `"name"` (plain text, D3), `"song"` (`str | None`) and `"go"` (`int | None`).
  - `Library.resolve_name(folder, name: str | None, take_number: int) -> {"song": str | None, "go": int | None, "name": str}`, writing nothing.
  - `Library.next_goes() -> dict[str, int]`: each title and its next go.
  - `Library.add_take(folder, take)` and `Library.update_take(folder, n, name=…)` resolve the typed name.
  - `Library.import_rehearsal(…)` reads names by `legacy_song`.
  - `Api._next_take(take_number=None, chosen=True) -> {"song", "go", "name"}`.
  - `Api.suggest_take_name(...)` returns the field text: the title, or "Take N".
  - `session_state()` gains `"next_take_go"`, and its `"next_take_name"` / `"next_take_default"` are field text.
  - `set_next_take_name` returns `{"ok", "next_take_name", "next_take_go"}`.
  - `stop_take`'s `suggested_name` / `default_name` are field text.
  - `song_choices` entries are `{"song", "name" (= song), "go", "last_take"?}`.
  - `_take_dir_name(take_number, name) -> "03 - Polyn 3"` (module level in `api.py`).

- [ ] **Step 1: Stand test_store's migration chain on the newest revision**

These checks hard-code revision `0001`, and their test-only `0002` would clash with the real one. This changes the test setup, not app behaviour; it passes before and after this task.

In `tests/test_store.py`, add after the other imports:

```python
from alembic.script import ScriptDirectory  # noqa: E402

# The newest migration the app ships. The test-only migrations below sit on
# top of it, so they keep working as real ones are added.
HEAD = ScriptDirectory.from_config(db.alembic_config()).get_current_head()
```

Change the start of the `SECOND` template to:

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

In [1]: `ok("it is at the newest migration", db.current_revision(engine) == HEAD)`.

In [3]:

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
Expected: all `ok`. `HEAD` is still `0001` at this point.

- [ ] **Step 2: Write the failing store tests**

Change two existing checks, because a take's name now carries its go (D3):
- In [4], `renamed["name"] == "Polyn"` becomes `renamed["name"] == "Polyn 1"`. This is the take's name, not the rehearsal's.
- In [7], `ok("cp1252 text is read as cp1252", r["name"] == "Café" and first["name"] == "Café")` becomes `… and first["name"] == "Café 1")`.

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
       names_of("Old")[0] == ("Polyn 1", "Polyn", 1)
       and names_of("Mid")[3] == ("Полынь 1", "Полынь", 1)
       and names_of("New") == [("Полынь 2", "Полынь", 2)])
    ok("goes are numbered across rehearsals in the order played, gaps closed",
       [names_of("Old")[0][2], names_of("Old")[5][2],
        names_of("Mid")[0][2], names_of("Mid")[1][2]] == [1, 2, 3, 4])
    ok("two takes of one name in a rehearsal get a go each",
       names_of("Old")[5] == ("Polyn 2", "Polyn", 2))
    ok("an old name with a trailing number is a go at the song without it",
       names_of("Old")[4] == ("Song 1", "Song", 1) and names_of("Mid")[2] == ("Song 2", "Song", 2))
    ok("even with no such song anywhere: what the rule cannot know stays as it reads",
       names_of("Old")[6] == ("Опус 1", "Опус", 1))
    lib.close()

    try:
        db.open_engine(rec9, migrations_up_to(tmp, "0001")).dispose()
        refused = None
    except db.LibraryUnavailable as e:
        refused = str(e)
    ok("an app from before songs refuses the database, as any older app would",
       refused == db.NEWER_DATABASE)

    print("\n[10] Naming a take: a go at a song, numbered across the library")
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

    ok("a new title is a new song, at go 1", add(1, "Polyn") == ("Polyn 1", "Polyn", 1))
    ok("the same title in another case is the same song, at its next go",
       add(2, "polyn") == ("Polyn 2", "Polyn", 2))
    ok("a number typed after the title names the song; the go is the app's",
       add(3, "Polyn 7") == ("Polyn 3", "Polyn", 3))
    ok("Take N is no song, and is called by the take's own number",
       add(4, "Take 9") == ("Take 4", None, None))
    ok("so is an empty name", add(5, "  ") == ("Take 5", None, None))
    ok("a title ending in a number is a song of its own when no shorter one exists",
       add(6, "Song 2") == ("Song 2 1", "Song 2", 1)
       and add(7, "Song 2") == ("Song 2 2", "Song 2", 2))
    ok("Cyrillic is compared case-blind too",
       add(8, "Полынь") == ("Полынь 1", "Полынь", 1)
       and add(9, "ПОЛЫНЬ 4") == ("Полынь 2", "Полынь", 2))
    ok("one row per song", song_titles() == ["Polyn", "Song 2", "Полынь"])

    before = song_titles()
    ok("asking what a name would be writes nothing",
       lib.resolve_name(jam, "Vesna", 10) == {"song": "Vesna", "go": 1, "name": "Vesna 1"}
       and lib.resolve_name(jam, "polyn", 10) == {"song": "Polyn", "go": 4, "name": "Polyn 4"}
       and lib.resolve_name(jam, "", 10) == {"song": None, "go": None, "name": "Take 10"}
       and song_titles() == before)

    other = rec10 / "Other"
    lib.create_rehearsal(other, "Other", "2026-10-02T19:00:00", 48000, 24, [])
    ok("goes run on across rehearsals", add(1, "Polyn", other) == ("Polyn 4", "Polyn", 4))
    ok("the next go of every song, in one look",
       lib.next_goes() == {"Polyn": 5, "Song 2": 3, "Полынь": 3})

    ok("renamed to the song it already has, a take keeps its go",
       rename(3, "Polyn") == ("Polyn 3", "Polyn", 3))
    ok("renamed to another song, it is that song's next go",
       rename(4, "polyn") == ("Polyn 5", "Polyn", 5))
    ok("renamed to a new title, it is a new song", rename(9, "Vesna") == ("Vesna 1", "Vesna", 1))
    ok("a case-only rename of a song's only take respells the song",
       rename(8, "ПОЛЫНЬ") == ("ПОЛЫНЬ 1", "ПОЛЫНЬ", 1))
    ok("but not a song that other takes are goes at",
       rename(1, "POLYN") == ("Polyn 1", "Polyn", 1))
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
    ok("an imported rehearsal is read by the old rule, its goes numbered after the "
       "ones already there, even though it is older",
       [(t["name"], t["song"], t["go"]) for t in lib.rehearsal(old_jam)["takes"]] == [
           ("Polyn 2", "Polyn", 2), ("Polyn 3", "Polyn", 3), ("Take 3", None, None),
           ("zima 1", "zima", 1), ("zima 2", "zima", 2), ("Опус 1", "Опус", 1)])
    lib.close()
```

- [ ] **Step 3: Run it and watch it fail**

Run: `venv/bin/python tests/test_store.py`
Expected:
- FAIL on [4] "a rename changes the name and the files" and on [7] "cp1252 text is read as cp1252";
- FAIL on [9] "after it was copied aside";
- then the suite stops with `sqlite3.OperationalError: no such table: song`.

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

In `Take`, replace `name: Mapped[str] = mapped_column(String)` with:

```python
    # What the take is a go at, and which go: both None for a take nobody
    # named. Goes are numbered per song across the whole library and kept,
    # not counted again on every read: deleting Polyn 2 must not turn Polyn 3
    # into another name, and so another folder and another cloud copy.
    song_id: Mapped[int | None] = mapped_column(
        ForeignKey("song.id", ondelete="SET NULL"), index=True, nullable=True
    )
    go: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

and add to `Take`'s relationships, before `files`:

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

Songs were worked out from take names on every read. They are stored now; a
take points at its song with a go number, and its name follows from the two.
This reads the old names by the rule they were written under
(names.legacy_song), numbers the goes of each song afresh across the library
in the order they were played (every rehearsal had its own "Polyn 1"), and
drops the column. Only the database changes: folders and cloud copies whose
names come out differently are renamed afterwards, in the background
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

from rehearsal_recorder.store.names import legacy_song

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
    rows = bind.execute(sa.text(
        "SELECT take.id, take.name, rehearsal.created_at, rehearsal.id FROM take "
        "JOIN rehearsal ON rehearsal.id = take.rehearsal_id "
        "ORDER BY rehearsal.created_at, rehearsal.id, take.take_number"
    )).all()
    # Oldest first, so each song's goes are numbered in the order played. A
    # song is spelled as the newest rehearsal's first go at it spells it —
    # how song_choices spelled it before — so a later rehearsal's spelling
    # replaces an earlier one's, and within a rehearsal the first one stays.
    titles, counted, goes = {}, {}, []
    for take_id, name, created_at, rehearsal_id in rows:
        title = legacy_song(name)
        if title is None:
            continue
        key = title.casefold()
        played = (created_at, rehearsal_id)
        if key not in titles or titles[key][0] < played:
            titles[key] = (played, title)
        counted[key] = counted.get(key, 0) + 1
        goes.append({"id": take_id, "key": key, "go": counted[key]})
    ids = {
        key: bind.execute(sa.text("INSERT INTO song (title) VALUES (:title)"),
                          {"title": title}).lastrowid
        for key, (_, title) in titles.items()
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
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload, sessionmaker

from rehearsal_recorder.store.db import MIGRATIONS, open_engine
from rehearsal_recorder.store.models import (
    CloudCopy, Marker, Rehearsal, Song, Take, TakeFile, Track,
)
from rehearsal_recorder.store.names import UNNAMED_TAKE, legacy_song, split_go, take_name
```

`_WITH_TAKES` gains the song, as its second entry:

```python
    selectinload(Rehearsal.takes).selectinload(Take.song),
```

In `_take_data`, make `title = take.song.title if take.song is not None else None` the first line, and replace `"name": take.name,` with:

```python
            # Not stored: it follows from the song and the go (D3).
            "name": take_name(title, take.go, take.take_number),
            "song": title,
            "go": take.go if title is not None else None,
```

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
        What take `take_number` of a rehearsal is a go at when the name field
        holds `name`: (song, title, go). `song` is the Song row when there is
        one already; `title` is None for no song, and a new song's title
        otherwise. In order:

        1. Nothing, or "Take N", is no song.
        2. A song whose title is the whole text, compared casefolded, is that
           song.
        3. A song whose title is the text less a trailing number is that
           song: a number typed out of habit ("Polyn 3") is dropped.
        4. Anything else is a new song with exactly that title — "Opus 5" is
           a title of its own unless a song called "Opus" exists.

        The go is the app's: one past the highest go at the song anywhere in
        the library. A take already a go at the song keeps its go ("Polyn 2"
        renamed to Polyn stays Polyn 2); and when it is the song's only take,
        a name differing from the title only in case respells the song.
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
        highest = db.scalar(select(func.max(Take.go)).where(Take.song_id == song.id))
        return song, title, (highest or 0) + 1

    @staticmethod
    def _song_row(db, song, title):
        """The Song a take resolved to (_resolve): made if it is new, and
        respelled if _resolve said so. None for no song."""
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
        What take `take_number` of the rehearsal in `folder` would be if the
        name field held `name`, by the rule add_take and update_take follow
        (_resolve), without writing anything: {"song": title or None, "go":
        int or None, "name": the plain-text name}. Used to name a take's
        folder before the take is written, and the next take before it is
        recorded.
        """
        take_number = int(take_number)
        with self._session() as db:
            rehearsal = self._find(db, folder)
            _, title, go = self._resolve(
                db, None if rehearsal is None else rehearsal.id, name, take_number)
        return {"song": title, "go": go, "name": take_name(title, go, take_number)}

    def next_goes(self):
        """{title: the go the next take of that song would be}, for every
        song: one past its highest go anywhere in the library, as _resolve
        counts it. One query, for the songs offered under a take's name."""
        with self._session() as db:
            rows = db.execute(
                select(Song.title, func.max(Take.go))
                .join(Take, Take.song_id == Song.id)
                .group_by(Song.id)
            ).all()
        return {title: (highest or 0) + 1 for title, highest in rows}
```

In `add_take`:
- change the docstring's first line to `take: {"take_number", "name" (what the name field held — see _resolve), …`;
- keep the `if rehearsal is None: return None` check where it is, and build the row after it like this:

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

In `update_take`:
- the docstring becomes `"""Changes what is given and leaves the rest. name: what the name field held, made a song and a go as add_take makes it (_resolve), so the name the take ends up with can differ. tracks: the take's files at their new absolute paths. Returns the take, or None."""`;
- replace the `if name is not None: row.name = name` block with:

```python
            if name is not None:
                was = row.song_id
                song, title, go = self._resolve(db, row.rehearsal_id, name, take_number)
                row.song = self._song_row(db, song, title)
                row.go = go
                self._drop_songless(db, [was])
```

In `delete_take`, replace everything after the `None` check with:

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

In `import_rehearsal`:
- in the docstring, change `takes as for add_take` to `takes as for add_take, their names read by the old rule (names.legacy_song)`;
- inside `with self._session.begin() as db:`, before `db.add(Rehearsal(`, add:

```python
            songs = self._songs_by_key(db)
            highest = dict(db.execute(
                select(Take.song_id, func.max(Take.go))
                .where(Take.song_id.is_not(None)).group_by(Take.song_id)
            ).all())
            counted = {}

            def go_at(name):
                # Old names by the old rule, as migration 0002 read the
                # database's own. A song already in the library keeps its
                # title, and its goes go on from its highest, however old
                # this rehearsal is: a number, once given, is kept. A new
                # song is spelled as this rehearsal first spells it.
                title = legacy_song(name)
                if title is None:
                    return None, None
                key = title.casefold()
                if key not in songs:
                    songs[key] = Song(title=title)
                if key not in counted:
                    counted[key] = highest.get(songs[key].id) or 0
                counted[key] += 1
                return songs[key], counted[key]

            placed = {int(t["take_number"]): go_at(t.get("name"))
                      for t in sorted(takes, key=lambda t: int(t["take_number"]))}
```

and in the `Take(` built for each imported take, replace `name=t["name"],` with:

```python
                        song=placed[int(t["take_number"])][0],
                        go=placed[int(t["take_number"])][1],
```

- [ ] **Step 7: Run the store suite**

Run: `venv/bin/python tests/test_store.py`
Expected: `All store checks passed.`

If [9]'s drift check reports a foreign-key or index difference, make `models.py` and `0002_songs.py` agree: the same `ondelete`, the same index name `ix_take_song_id`. Do not loosen the check.

- [ ] **Step 8: Write the failing API test**

In `tests/test_engine.py`, insert before the closing `print("\n" + "=" * 60)`:

```python
    print("\n[52] A take is a go at a song, numbered across the library")
    _, s52 = fresh_api(Path(tempfile.mkdtemp()))

    def keep52(number, name):
        here = Path(s52._session["folder"])
        draft = here / "_drafts" / f"take {number}"
        write_wav(draft / "Gtr.wav", 100, seconds=0.5)
        s52._session["take_counter"] = number
        return s52.keep_take(number, str(draft), name, 0.5,
                             [{"name": "Gtr", "file": str(draft / "Gtr.wav")}])["take"]

    def folder_of(take):
        return Path(take["tracks"][0]["file"]).parent.name

    s52.start_rehearsal("Monday", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    first52 = keep52(1, "Polyn")
    ok("a take is a go at its song: its name is the title and the go, folder and all",
       (first52["name"], first52["song"], first52["go"]) == ("Polyn 1", "Polyn", 1)
       and folder_of(first52) == "01 - Polyn 1")
    ok("the field is offered the title alone, with the go beside it",
       s52.session_state()["next_take_name"] == "Polyn"
       and s52.session_state()["next_take_go"] == 2)
    keep52(2, s52.suggest_take_name())
    s52.finish_rehearsal()

    s52.start_rehearsal("Tuesday", 0, SR, [{"name": "Gtr", "channel": 1}], 16)
    f52 = Path(s52._session["folder"])
    named52 = s52.set_next_take_name("polyn")
    ok("goes run on across rehearsals: yesterday's 2 is followed by 3",
       named52 == {"ok": True, "next_take_name": "Polyn", "next_take_go": 3})
    typed52 = keep52(1, "Polyn 7")
    ok("a number typed after the title names the song; the go is the app's",
       typed52["name"] == "Polyn 3" and folder_of(typed52) == "01 - Polyn 3")
    unnamed52 = keep52(2, "Take 9")
    ok("a take nobody named is called by its own number",
       (unnamed52["name"], unnamed52["song"]) == ("Take 2", None)
       and folder_of(unnamed52) == "02 - Take 2")
    titled52 = keep52(3, "Song 2")
    ok("a title ending in a number is a song of its own when no shorter one exists",
       (titled52["name"], titled52["song"], titled52["go"]) == ("Song 2 1", "Song 2", 1))
    state52 = s52.session_state()
    ok("after a take, the next is another go at its song",
       state52["next_take_name"] == "Song 2" and state52["next_take_go"] == 2)
    ok("songs, runs and how long the last go ran come from the songs",
       [(s["name"], s["take_numbers"]) for s in state52["songs"]]
       == [("Polyn", [1]), ("Song 2", [3])]
       and [(r["song"], len(r["takes"])) for r in next(
           r for r in s52.list_rehearsals() if r["name"] == "Tuesday")["runs"]]
       == [("Polyn", 1), (None, 1), ("Song 2", 1)]
       and state52["last_attempt"] == {"song": "Song 2", "duration_sec": 0.5})
    ok("every song offered says which go it would be",
       [(c["song"], c["go"]) for c in s52.song_choices()["here"]]
       == [("Polyn", 4), ("Song 2", 2)])
    ok("the take being renamed keeps its own go at its own song",
       [(c["song"], c["go"]) for c in s52.song_choices(str(f52), 1)["here"]][0] == ("Polyn", 3))

    same52 = s52.rename_take(str(f52), 1, "Polyn")
    ok("renamed to its own song, a take keeps its go and its folder",
       same52["ok"] and same52["take"]["name"] == "Polyn 3"
       and folder_of(same52["take"]) == "01 - Polyn 3"
       and not any(p.name.startswith("01 - Polyn 3 (") for p in f52.iterdir()))
    moved52 = s52.rename_take(str(f52), 2, "polyn")
    ok("renamed to a song, a take is its next go, folder and all",
       moved52["take"]["name"] == "Polyn 4" and folder_of(moved52["take"]) == "02 - Polyn 4"
       and Path(moved52["take"]["tracks"][0]["file"]).exists())
    ok("a blank name is still refused",
       s52.rename_take(str(f52), 2, "  ") == {"ok": False, "error": "Name cannot be empty"})

    rescued52 = f52 / "_drafts" / "take 9"
    rescued52.mkdir(parents=True)
    (rescued52 / "Gtr.raw").write_bytes(struct.pack("<h", 1234) * SR)
    got52 = s52.recover_draft(str(rescued52))
    ok("a draft rescued with no name is a take nobody named",
       got52["ok"] and got52["take"]["name"] == "Take 4"
       and folder_of(got52["take"]) == "04 - Take 4")
```

- [ ] **Step 9: Change the existing engine checks this task changes**

Each change follows D2 (the field holds a title), D3 (a name carries its go, from 1) or D4 (goes run across the library). Make exactly these:

**[8] Take naming carries over:**
- `ok("next inherits the name", a.suggest_take_name() == "Polyn 2")` becomes:
  ```python
  ok("the next take is another go at the same song",
     a.suggest_take_name() == "Polyn" and a.session_state()["next_take_go"] == 2)
  ```
- `ok("the counter keeps climbing", a.suggest_take_name() == "Polyn 3")` becomes:
  ```python
  ok("the go keeps climbing",
     a.suggest_take_name() == "Polyn" and a.session_state()["next_take_go"] == 3)
  ```
- In "and the name it would have had is still known…", `== "Polyn 3"` becomes `== "Polyn"`.
- In "a kept take uses it up, and the next follows on from it", `a.suggest_take_name() == "Vesna 2"` becomes `a.suggest_take_name() == "Vesna" and a.session_state()["next_take_go"] == 2`.
- In "blank goes back to the name it would have had", `== "Vesna 2"` becomes `== "Vesna"`.
- The `plain` helper becomes:
  ```python
  def plain(choices):
      """A list of song choices as song and go only."""
      return [{"song": c["song"], "go": c["go"]} for c in choices]
  ```
- In "the songs of the rehearsal in progress, as the next go at each", the expected list becomes `[{"song": "Polyn", "go": 3}, {"song": "Vesna", "go": 2}, {"song": "Rescued", "go": 2}]`.
- `ok("the take being renamed is not a go of its own", plain(a.song_choices(str(folder), 2)["here"])[0] == {"song": "Polyn", "name": "Polyn 2"})` becomes:
  ```python
  ok("the take being renamed keeps its own go at its own song",
     plain(a.song_choices(str(folder), 2)["here"])[0] == {"song": "Polyn", "go": 2})
  ```

**[8c]:**
- Both `["name"] == "Полынь"` checks (the library and the reopened library) become `== "Полынь 1"`.
- `parent.name == "01 - Весна"` becomes `== "01 - Весна 1"`.

**[9] Renaming:**
- `parent.name == "01 - Polyn"` becomes `== "01 - Polyn 1"`.
- `p.name == "01 - Polyn (2)"` becomes `p.name == "01 - Polyn 1 (2)"`.
- The comment `# A separate take, so the case-only rename starts from "01 - Polyn"` becomes `… from "01 - Polyn 1"`.
- `parent.name == "01 - POLYN"` becomes `== "01 - POLYN 1"`.
- `("01 - Polyn (2)", "01 - POLYN (2)")` becomes `("01 - Polyn 1 (2)", "01 - POLYN 1 (2)")`.

**[11f]:**
- `take9["name"] == "After"` becomes `== "After 2"`. Take 3 of the same library is already After 1, and goes run across the library.
- `take9["cloud"]["source"]["name"] == "Before"` becomes `== "Before 1"`.
- `renamed9["name"] == "Renamed once more"` becomes `== "Renamed once more 1"`.

**[11m]:**
- `"01 - Polyn best.wav"` becomes `"01 - Polyn best 1.wav"`.
- `Path(after.get("tracks", "")).name == "01 - Polyn best"` becomes `== "01 - Polyn best 1"`.
- The rename to `"Ogon 2"` would now keep the take at Ogon (the number names the song, and the go is the app's). Rename it to another song instead:
  - `fc.rename_take(str(sf), 1, "Ogon 2")` becomes `fc.rename_take(str(sf), 1, "Zima")`;
  - `"01 - Ogon 2.wav"` becomes `"01 - Zima 1.wav"`;
  - `p.name.startswith("01 - Ogon 2")` becomes `p.name.startswith("01 - Zima")`.

**[16a]:**
- `d.session_state()["next_take_name"] == "Vesna 3"` becomes `d.session_state()["next_take_name"] == "Vesna" and d.session_state()["next_take_go"] == 5`. Songs' Vesna 1–2 come first, then tonight's 3 and 4.

**[16c]:**
- The take names in "with every take as the player needs it…" become `["Polyn 2", "Polyn 3", "Vesna 1", "Take 4", "Polyn 4"]`. First's Polyn is go 1.
- In "each with its last go, ready to play", `["Dym 2", "Ptaha", "Doroga 2"]` becomes `["Dym 2", "Ptaha 1", "Doroga 2"]`.
- In "naming a take offers what its rehearsal played…", the expected list becomes `[{"song": "Polyn", "go": 5}, {"song": "Vesna", "go": 2}]`.
- `ok("and every other song, the most recently played first", ch["other"] == [...])` becomes:
  ```python
  ok("and every other song, the most recently played first, each at its next go",
     plain(ch["other"]) == [{"song": "Dym", "go": 3}, {"song": "Ptaha", "go": 2},
                            {"song": "Doroga", "go": 3}])
  ```
- "a go missing in between is not named again" becomes:
  ```python
  ok("a take being renamed keeps its own go at its own song",
     e.song_choices(last, 2)["here"][0]["go"] == 3
     and e.song_choices(last, 5)["here"][0]["go"] == 4)
  ```
- `plain(e.song_choices(older)["here"])[1] == {"song": "Doroga", "name": "Doroga 3"}` becomes `… == {"song": "Doroga", "go": 3}`.

**[21]:**
- `[t["name"] for t in h.session_state()["takes"]] == ["Polyn"]` becomes `== ["Polyn 1"]`.
- `stored["name"] == "Polyn best"` becomes `== "Polyn best 1"`.
- `(other / "02 - Unkept")` becomes `(other / "02 - Unkept 1")`.
- `(other / "01 - Renamed")` becomes `(other / "01 - Renamed 1")`.

**[23]:** `str(live / "01 - Kept")` becomes `str(live / "01 - Kept 1")`.

**[51]:** `second51["default_name"] == "Polyn 2"` becomes `== "Polyn"`.

- [ ] **Step 10: Run it and watch it fail**

Run: `venv/bin/python tests/test_engine.py`
Expected: FAIL on [52] from "the field is offered the title alone…" onwards, and on each check changed in Step 9.

- [ ] **Step 11: Rewrite the API's naming**

In `src/rehearsal_recorder/api.py`:

Delete `_UNNAMED_TAKE`, `_ATTEMPT_NUMBER`, `_song_of` and `_next_go`, with their comments. Replace `_songs_of`, `_runs_of` and `_last_attempt` with:

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


def _last_attempt(takes, song):
    """
    How long the latest go at `song` among `takes` ran, as {"song",
    "duration_sec"}, or None when there was none. The recording screen says
    it under its clock — "Vesna took 2:21 last time" — so the band can see
    how far into the song they are.
    """
    if song is None:
        return None
    goes = [t for t in takes if t.get("song") == song]
    if not goes:
        return None
    return {"song": song, "duration_sec": goes[-1].get("duration_sec")}


def _field_text(named):
    """What the name field holds for a take resolved to `named`
    (Library.resolve_name): the song's title, its go shown beside it rather
    than typed into it; or "Take N" for a take nobody named."""
    return named["song"] or named["name"]
```

Add after `_unique_path`:

```python
def _take_dir_name(take_number, name):
    """What a take's folder is called: "03 - Polyn 3"."""
    return f"{int(take_number):02d} - {_safe_name(name)}"
```

In `session_state`, replace the `next_name = self.suggest_take_name()` line and the keys that used it:

```python
        coming = self._next_take()
```

```python
            # What the name field holds, and the go shown beside it.
            "next_take_name": _field_text(coming),
            "next_take_go": coming["go"],
            # What it would hold without a title picked, which the rehearsal
            # screen offers to go back to.
            "next_take_default": self.suggest_take_name(chosen=False),
            "last_attempt": _last_attempt(takes, coming["song"]),
```

Replace `suggest_take_name` with:

```python
    def _next_take(self, take_number=None, chosen=True):
        """
        What the take being named would be, as {"song", "go", "name"}.

        A new take is usually another go at the same song, so it is the
        previous take's song at its next go. After a take nobody named, it is
        "Take N".

        take_number is the take being named. Left out, it means the take that
        comes next, which is what the rehearsal screen shows before
        recording. Right after a take it must be passed, otherwise the very
        first take would be offered as "Take 2".

        A title picked for the next take on the rehearsal screen comes before
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
                # The library could not say which go it would be. The title
                # picked is still the one to offer, as it was typed.
                return {"song": None, "go": None, "name": picked}
        takes = self._session_takes()
        song = takes[-1].get("song") if takes else None
        return self._lib.resolve_name(folder, song or "", number)

    def suggest_take_name(self, take_number=None, chosen=True):
        """What the name field holds for the take being named: its song's
        title, or "Take N" — see _next_take."""
        return _field_text(self._next_take(take_number, chosen))
```

In `set_next_take_name`, return the go as well:

```python
        self._session["next_name"] = (name or "").strip() or None
        coming = self._next_take()
        return {"ok": True, "next_take_name": _field_text(coming),
                "next_take_go": coming["go"]}
```

In `stop_take`, replace the two `try` blocks that compute `name` and `default`, and the `_journaled` title, with:

```python
        try:
            coming = self._next_take(take_number)
        except Exception:
            # The name comes from the library. A take is not left recording,
            # holding the card, because the library could not answer.
            coming = {"song": None, "go": None, "name": f"Take {take_number}"}
        try:
            # What ✕ on the review screen puts back: what the field would hold
            # with no title picked before recording.
            default = self.suggest_take_name(take_number, chosen=False)
        except Exception:
            default = f"Take {take_number}"
        result = self._journaled(
            "stop", f"Saving “{coming['name']}”", temp_dir, take_number,
            lambda progress: recorder.stop(progress=progress),
        )
```

and in its return value, `"suggested_name": _field_text(coming),`.

Replace `song_choices` with:

```python
    def song_choices(self, folder=None, take_number=None):
        """
        The songs a take can be named after, so that nobody types a title the
        band has played before: {"here": [...], "other": [...]}, each
        {"song", "go"}: the title, which a pill puts in the name field, and
        the go a take would be as that song — one past its highest go
        anywhere in the library, or, for the take being renamed, its own go
        at its own song.

        "here" is what this rehearsal played, in the order it first played
        it, each with "last_take", the number of its latest take. "other" is
        every other song in the library, the most recently played first; the
        interface shows as many as it has room for.

        `folder` is the rehearsal, the one in progress when left out.
        `take_number` is the take being named.
        """
        if folder is None:
            folder = self._session["folder"] if self._session else None
        rehearsal = self._lib.rehearsal(Path(folder)) if folder else None
        takes = rehearsal["takes"] if rehearsal else []
        own = next((t for t in takes if t.get("take_number") == take_number), None)
        nexts = self._lib.next_goes()

        def go_for(song):
            if own is not None and own.get("song") == song:
                return own["go"]
            return nexts.get(song, 1)

        # "name" holds the title too, for the interface until it shows the go
        # beside the field (songs in the store, Task 3 of its plan).
        here = [{"song": s["name"], "name": s["name"], "go": go_for(s["name"]),
                 "last_take": max(s["take_numbers"])}
                for s in _songs_of(takes)]
        seen = {c["song"].casefold() for c in here}
        other = []
        # Newest first, so the first spelling met is the latest one used.
        for r in self._lib.rehearsals():
            if folder and Path(r["folder"]) == Path(folder):
                continue
            for s in _songs_of(r["takes"]):
                key = s["name"].casefold()
                if key not in seen:
                    seen.add(key)
                    other.append({"song": s["name"], "name": s["name"],
                                  "go": go_for(s["name"])})
        return {"here": here, "other": other}
```

In `keep_take`, replace the `display_name = …` and `take_dir = _unique_path(…)` lines with the following, and set `"name": (custom_name or "").strip(),` in `take_info`:

```python
        # Named as it will be kept: the song and go the name resolves to, not
        # what was typed — "polyn" for the third go is "Polyn 3".
        named = self._lib.resolve_name(s["folder"], custom_name, take_number)
        take_dir = _unique_path(s["folder"] / _take_dir_name(take_number, named["name"]))
```

In `recover_draft`, replace the `display_name = …` and `take_dir = _unique_path(…)` lines with the following (`take_info` keeps `"name": display_name`):

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

and change its target line to `target = folder / _take_dir_name(take_number, named["name"])`. The call `self._lib.update_take(folder, take_number, name=display_name, tracks=new_tracks)` stays as it is.

Check that nothing still uses the deleted helpers:

Run: `grep -n "_song_of\|_UNNAMED_TAKE\|_ATTEMPT_NUMBER\|_next_go" src/rehearsal_recorder/api.py`
Expected: no output.

- [ ] **Step 12: Run every Python suite**

Run: `venv/bin/python tests/run_all.py`
Expected: every suite passes. If a check not named in Step 9 fails, stop and report it with its output.

- [ ] **Step 13: Run the interface suites**

The interface has not changed, and the fake bridge stands in for Python, so these should pass as they are.

Run: `cd ui && npm test && npm run build && npm run test:e2e`
Expected: all pass.

- [ ] **Step 14: Commit**

```bash
git add src/rehearsal_recorder tests/test_store.py tests/test_engine.py
git commit -m "Songs are kept, a take is a go at one, and goes run across the library

Migration 0002 makes a song table, reads every take's name by the rule it
was written under, numbers each song's goes afresh in the order played,
and drops take.name. It alters take in place, since batch mode's rebuild
would cascade away every marker, file and cloud copy. A take's name now
follows from its song and go ('Polyn 1'); the name field is offered the
title alone, with next_take_go beside it; folders carry the full name.

Tests changed, all following the spec's D2-D4 (the field holds a title; a
name carries its go from 1; goes run across the library):
- test_store [1], [3]: the test-only migrations sit on the newest real one.
- test_store [4], [7]: a take's name is 'Polyn 1', 'Café 1'.
- test_engine [8], [8c], [9], [11f], [11m], [16a], [16c], [21], [23], [51]:
  names and folders carry their go; suggestions are titles with
  next_take_go; choices carry go; [11m] renames to another song, since
  'Ogon 2' now names Ogon.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The interface shows the go beside the title

**Files:**
- Create: `ui/src/lib/goes.ts`, `ui/src/lib/goes.test.ts`, `ui/src/components/TakeTitle.tsx`
- Modify:
  - `ui/src/lib/api.ts`;
  - `ui/src/components/SongPills.tsx`, `TakeNameField.tsx`, `TakeStrip.tsx`, `RehearsalOverview.tsx` and `ConfirmDialog.tsx`;
  - `ui/src/screens/Rehearsal.tsx` and `Recording.tsx`, and `ui/src/App.tsx`;
  - `ui/e2e/fake-bridge.js`;
  - `src/rehearsal_recorder/api.py` (`song_choices` drops `name`).
- Test: `ui/src/lib/goes.test.ts`, `ui/e2e/naming.spec.ts` (new tests), and any e2e test that follows D2/D3/I1–I5

**Interfaces:**
- Consumes: from Task 2, takes with `song`/`go`, `song_choices` entries `{song, go, last_take?}`, and `session_state.next_take_go`.
- Produces:
  - `goFor(text: string, choices: SongChoices | null): number | null`.
  - `<GoTitle title go />` and `<TakeTitle take />`.
  - The go span in the name field carries `data-take-go`.

- [ ] **Step 1: Write the failing tests**

Create `ui/src/lib/goes.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { goFor } from "./goes"

const choices = {
  here: [{ song: "Polyn", go: 4, last_take: 3 }],
  other: [{ song: "Полынь", go: 2 }],
}

describe("goFor", () => {
  it("is the go offered for a song, whatever the case", () => {
    expect(goFor("polyn", choices)).toBe(4)
    expect(goFor("ПОЛЫНЬ", choices)).toBe(2)
  })
  it("reads a number typed after a title as that song", () => {
    expect(goFor("Polyn 7", choices)).toBe(4)
  })
  it("is 1 for a title no song has, a number in it or not", () => {
    expect(goFor("Vesna", choices)).toBe(1)
    expect(goFor("Opus 5", choices)).toBe(1)
  })
  it("is nothing for a take nobody named", () => {
    expect(goFor("Take 4", choices)).toBeNull()
    expect(goFor("  ", choices)).toBeNull()
  })
})
```

Add to `ui/e2e/naming.spec.ts`, after the existing tests:

```ts
test("the field holds the song's title, and the go beside it follows what is typed", async ({
  page,
}) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Polyn")
  const next = page.locator("#next-take-name")
  const go = page.getByRole("group", { name: "Next take" }).locator("[data-take-go]")
  await expect(next).toHaveValue("Polyn")
  await expect(go).toHaveText("2")
  await next.fill("Vesna")
  await expect(go).toHaveText("1")
  await next.fill("Take 7")
  await expect(go).toHaveCount(0)
})

test("a pill puts only the song's title in the field", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Polyn")
  await recordTake(page, 2)
  await expect(pills(page).first()).toHaveText("Polyn 2")
  await pills(page).filter({ hasText: /^Vesna/ }).click()
  await expect(nameField(page)).toHaveValue("Vesna")
  await page.getByRole("button", { name: /Save take/ }).click()
  await expect.poll(async () => (await calls(page, "keep_take")).at(-1)?.args[2]).toBe("Vesna")
})

test("a take is shown as its song with the go beside it, from 1", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Polyn")
  await expect(page.getByRole("button", { name: /^Take 1 Polyn 1/ })).toContainText("Polyn 1")
  await page.keyboard.press("Space")
  await expect(page.getByRole("heading", { name: "Polyn 2" })).toBeVisible()
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd ui && npm test`
Expected: FAIL, `Failed to resolve import "./goes"`.

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts`
Expected: the three new tests fail (no `[data-take-go]`; the strip shows "Polyn"; the heading shows "Polyn").

- [ ] **Step 3: `goFor`, `GoTitle` and `TakeTitle`**

Create `ui/src/lib/goes.ts`:

```ts
import type { SongChoices } from "@/lib/api"

/** A take nobody named, as Python names it. */
const UNNAMED = /^Take \d+$/
/** A number typed after a title out of habit: "Polyn 3". */
const TRAILING_NUMBER = /^(.*?)\s+(\d+)$/

/**
 * The go a take would be if the name field held `text`: the go Python
 * offered for that song, 1 for a title no song has, and null for a take
 * nobody named. The same steps as Python's naming (Library._resolve), over
 * the choices the field already has, so the go beside the field follows
 * typing without asking Python on every key.
 */
export function goFor(text: string, choices: SongChoices | null): number | null {
  const name = text.trim()
  if (name === "" || UNNAMED.test(name)) return null
  const songs = choices ? [...choices.here, ...choices.other] : []
  const find = (title: string) =>
    songs.find((c) => c.song.toLocaleLowerCase() === title.toLocaleLowerCase())
  const exact = find(name)
  if (exact) return exact.go
  const typed = TRAILING_NUMBER.exec(name)
  const base = typed ? find(typed[1].trim()) : undefined
  return base ? base.go : 1
}
```

Create `ui/src/components/TakeTitle.tsx`:

```tsx
import type { Take } from "@/lib/api"

/**
 * A song's title with a go beside it, in the muted colour the song pills
 * have always given the number: "Polyn 3". The go is a number of its own,
 * never typed (songs in the store, D2–D3), so it is drawn apart from the
 * title rather than as part of it.
 */
export function GoTitle({ title, go }: { title: string; go: number | null | undefined }) {
  return (
    <>
      {title}
      {go != null && (
        <span className="tnum text-muted-foreground">
          {" "}
          {go}
        </span>
      )}
    </>
  )
}

/** A take as it is shown: its song and go, or "Take 3" for a take nobody
 *  named. Plain text — a dialog's title, a label — uses take.name. */
export function TakeTitle({ take }: { take: Pick<Take, "name" | "song" | "go"> }) {
  return take.song ? <GoTitle title={take.song} go={take.go} /> : <>{take.name}</>
}
```

- [ ] **Step 4: Types**

In `ui/src/lib/api.ts`:
- In `Take`, after `name: string`:
  ```ts
  /** The song this take is a go at, or null for a take nobody named. Its
   *  name ("Polyn 3") follows from the two. */
  song?: string | null
  /** Which go at the song this is, counted across the library; null with no
   *  song. */
  go?: number | null
  ```
- `SongChoice` becomes:
  ```ts
  export type SongChoice = {
    /** The title: what a pill puts in the name field. */
    song: string
    /** The go a take would be as this song. */
    go: number
    /** On a song this rehearsal played: the number of its latest take. */
    last_take?: number
  }
  ```
- In the session state type, after `next_take_name: string`, add `/** The go beside the name field's title; null with no song. */ next_take_go?: number | null`.
- `set_next_take_name(name: string): Promise<Ok<{ next_take_name?: string; next_take_go?: number | null }>>`.

In `src/rehearsal_recorder/api.py` `song_choices`, drop the `"name": s["name"],` from both entries, and delete the comment about it.

- [ ] **Step 5: Pills, field, rename dialog**

In `ui/src/components/SongPills.tsx`:
- Import `GoTitle` from `@/components/TakeTitle`. Delete `SongName` and its comment.
- Wherever a `SongChoice` is read by `c.name`, read `c.song`:
  - `isChoice`;
  - `key`;
  - the width map;
  - `setShown(picked.map((c) => c.song))`;
  - `byName`;
  - the `key`, `data-song-choice` and `onPick` of each pill and of each `AllSongsPill` song;
  - the `aria-current` and the lit class in `AllSongsPill`.
- Each `<SongName choice={c} />` becomes `<GoTitle title={c.song} go={c.go} />`.
- The doc comment's first paragraph becomes: `The songs under a take's name, in two rows at most: what this rehearsal played, then the other rehearsals' songs, the latest played first, and All songs… last. Each shows the go a take would be ("Polyn 3", the number dimmed); a click puts only the title in the field.`

In `ui/src/components/TakeNameField.tsx`:
- import `goFor` from `@/lib/goes`;
- after `const shown = draft ?? value`, add `const go = goFor(shown, choices)`;
- inside the field's bordered `div`, before the `<input`, add:

```tsx
        {/* The go this name will be, after the text: drawn over the field,
            behind an invisible copy of the text, so it sits where the text
            ends. It is never part of the name, so it cannot be selected or
            typed over (songs in the store, D2). */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 flex items-center overflow-hidden pr-11 pl-3.5 font-semibold whitespace-pre",
            size === "big" ? "text-[1.75rem] leading-9" : "text-base"
          )}
        >
          <span className="invisible">{shown}</span>
          {go !== null && (
            <span data-take-go className="tnum text-muted-foreground">
              {" "}
              {go}
            </span>
          )}
        </div>
        <span id={`${id}-go`} className="sr-only">
          {go !== null ? `Go ${go}` : ""}
        </span>
```

- give the `<input` `aria-describedby={`${id}-go`}`.

In `ui/src/components/ConfirmDialog.tsx` `RenameTakeForm`: `useState(take.song ?? take.name)`, and `fallback={take.song ?? take.name}`. The field holds the title (I4).

- [ ] **Step 6: Where a take is shown**

- `ui/src/components/TakeStrip.tsx`: `<span className="max-w-40 truncate">{take.name}</span>` becomes `<span className="max-w-40 truncate"><TakeTitle take={take} /></span>`, with the import `import { TakeTitle } from "@/components/TakeTitle"`. `takeButtonLabel` keeps `take.name` (I5).
- `ui/src/components/RehearsalOverview.tsx`: the row's visible `{take.name}` (inside the `relative truncate text-[13px]` span) becomes `<TakeTitle take={take} />`, with the same import. The `aria-label`s keep `take.name`.
- The recording screen:
  - In `ui/src/screens/Rehearsal.tsx`, import `goFor` from `@/lib/goes`. The prop type becomes `onStartTake: (takeNumber: number, takeName: string, takeGo: number | null) => void`, and the call becomes `onStartTake(res.take_number, nextNameRef.current, goFor(nextNameRef.current, nextChoices))`.
  - In `ui/src/App.tsx`, the screen union's recording entry becomes `{ name: "recording"; takeNumber: number; takeName: string; takeGo: number | null }`. The handler becomes `onStartTake={(takeNumber, takeName, takeGo) => setScreen({ name: "recording", takeNumber, takeName, takeGo })}`, and `<Recording` gets `takeGo={screen.takeGo}`.
  - In `ui/src/screens/Recording.tsx`, add the prop `takeGo: number | null` beside `takeName`. Import `GoTitle` from `@/components/TakeTitle`, and make the `<h1>`'s content `<GoTitle title={takeName} go={takeGo} />`.

- [ ] **Step 7: The fake sends what Python now sends**

In `ui/e2e/fake-bridge.js`:

Replace `songsOf`, `runsOf`, `nextGo` and `lastAttempt` with the following, keeping `REPERTOIRE` where it is:

```js
// Python groups takes by the song each is a go at (api._songs_of) and hands
// the result over; the mock does the same.
function songsOf(takes) {
  const songs = [], bySong = {};
  for (const t of takes) {
    if (!t.song) continue;
    if (bySong[t.song]) { bySong[t.song].takes++; bySong[t.song].take_numbers.push(t.take_number); }
    else { bySong[t.song] = {name: t.song, takes: 1, take_numbers: [t.take_number]}; songs.push(bySong[t.song]); }
  }
  return songs;
}

// And api._runs_of: the evening in order, in runs of goes at one song, each
// go as its length and whether it was marked to keep.
function runsOf(takes) {
  const runs = [];
  for (const t of takes) {
    const song = t.song || null;
    const go = {duration_sec: t.duration_sec,
                keep: (t.markers || []).some(m => m.kind === 'good')};
    if (runs.length && runs[runs.length - 1].song === song) runs[runs.length - 1].takes.push(go);
    else runs.push({song, takes: [go]});
  }
  return runs;
}

// And api._last_attempt: how long the latest go at the next take's song ran.
function lastAttempt(takes, song) {
  if (!song) return null;
  const goes = takes.filter(t => t.song === song);
  return goes.length ? {song, duration_sec: goes[goes.length - 1].duration_sec} : null;
}

// What a take is a go at, as Python's library resolves a name
// (Library._resolve), over the songs the mock knows: the takes it is given
// and REPERTOIRE. Python numbers goes across the whole library; the mock
// counts them within the takes it is given, which is all the interface's
// tests need — the interface shows what it is sent.
function songOf(text, takes) {
  const name = (text || '').trim();
  if (!name || /^Take \d+$/.test(name)) return null;
  const known = new Map();
  for (const t of takes) if (t.song) known.set(t.song.toLowerCase(), t.song);
  for (const s of REPERTOIRE) if (!known.has(s.toLowerCase())) known.set(s.toLowerCase(), s);
  if (known.has(name.toLowerCase())) return known.get(name.toLowerCase());
  const m = /^(.*?)\s+(\d+)$/.exec(name);
  if (m && known.has(m[1].trim().toLowerCase())) return known.get(m[1].trim().toLowerCase());
  return name;
}
function goAt(song, takes, n) {
  const own = takes.find(t => t.take_number === n);
  if (own && own.song === song) return own.go;
  return Math.max(0, ...takes.filter(t => t.song === song && t.take_number !== n).map(t => t.go)) + 1;
}
// A take's song, go and name, as Python returns them.
function resolved(text, takes, n) {
  const song = songOf(text, takes);
  if (!song) return {song: null, go: null, name: 'Take ' + n};
  const go = goAt(song, takes, n);
  return {song, go, name: `${song} ${go}`};
}
// The fixtures below are written as old names; this makes them what Python
// sends.
function asSent(takes) {
  const out = [];
  for (const t of takes) out.push({...t, ...resolved(t.name, out, t.take_number)});
  return out;
}

// Mirrors api._next_take: what the take being named would be.
function nextTake(n, chosen = true) {
  const number = n === undefined ? takeCounter + 1 : n;
  const takes = session ? session.takes : [];
  if (chosen && session && nextName) return resolved(nextName, takes, number);
  const last = takes[takes.length - 1];
  return resolved(last && last.song ? last.song : '', takes, number);
}
// And the name field's text for it: the title, or "Take N".
const fieldText = (r) => r.song || r.name;
```

Replace `suggestName` with:

```js
// Mirrors api.suggest_take_name: n is the take being named, left out it means
// the one that comes next.
function suggestName(n, chosen = true) { return fieldText(nextTake(n, chosen)); }
```

Then:
- `pastRehearsal`: each of its three `return {folder, …, takes}` returns `takes: asSent(takes)`.
- `session_state`:
  ```js
  next_take_name:suggestName(), next_take_go:nextTake().go,
  next_take_default:suggestName(undefined, false),
  last_attempt:lastAttempt(session.takes, nextTake().song),
  ```
- `set_next_take_name` returns `{ok:true, next_take_name:suggestName(), next_take_go:nextTake().go}`.
- `song_choices`:
  ```js
  const here = songsOf(takes).map(s => ({song:s.name, go:goAt(s.name, takes, n),
                                         last_take:Math.max(...s.take_numbers)}));
  const seen = new Set(here.map(c => c.song.toLowerCase()));
  const other = REPERTOIRE.filter(song => !seen.has(song.toLowerCase()))
    .map(song => ({song, go:1}));
  return {here, other};
  ```
- `keep_take`: `const take = {take_number:n, ...resolved(name, session.takes, n), duration_sec:dur, tracks, markers: markers || []};`.
- `rename_take`: `if (take) Object.assign(take, resolved(name, session.takes, n));`. The take stays in the list, so renaming it to its own song keeps its go, as in Python.
- `recover_draft`: `take:{take_number:1, song:'Recovered', go:1, name:'Recovered 1', duration_sec:5, tracks:[], markers:[]}`.

- [ ] **Step 8: Run the interface suites, and bring existing e2e tests in line**

Run: `cd ui && npm test && npm run lint`
Expected: Vitest passes, including `goes.test.ts`; lint shows 20 warnings and no errors.

Run: `cd ui && npm run build && npm run test:e2e`
Expected: the three new tests pass.

Some existing tests now fail because they pin a name, a field value or a pill's text. Change those, and only those, as Global Constraints says. Examples:
- `naming.spec.ts`'s first test expects the pills `["Polyn", "Vesna", …]`; they are now `["Polyn 1", "Vesna 1", …]` (I3: the pills carry the go).
- The same test's `toHaveValue("Ogon 2")` becomes `toHaveValue("Ogon")` (D2: the field holds the title), while its `pills(page).first()` stays `"Ogon 2"`.
- A strip button named `Take 1 Polyn` is now `Take 1 Polyn 1` (D3).

Run the e2e suite again until it is green. List every changed test in the commit message.

- [ ] **Step 9: Run the Python suites**

Run: `venv/bin/python tests/run_all.py`
Expected: all pass. `song_choices` lost its `name` key, and no Python check reads it.

- [ ] **Step 10: Commit**

```bash
git add ui src/rehearsal_recorder/api.py
git commit -m "The go is shown beside the song's title, and never typed

The name field holds the title, with the go it will be dimmed after the
text, following what is typed; the pills put only the title in it; the
strip, History's rows and the recording screen show the title with its go.

E2e tests changed (D2, D3, I1-I5): <list each test and what changed>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Replace the `<list …>` line with the actual list before committing.)

---

### Task 4: Putting names right, in the background

**Files:**
- Create: `src/rehearsal_recorder/names_pass.py`
- Modify: `src/rehearsal_recorder/cloud.py` (`PublishQueue.busy`)
- Modify: `src/rehearsal_recorder/api.py`:
  - `__init__`, `attach_window`, `shutdown` and `set_recordings_dir`;
  - `rename_take` and `delete_take`;
  - new methods `_move_take_dir`, `_out_of_line`, `_names_out_of_line`, `_names_must_wait`, `_playing_from` and `_put_name_right`;
  - a new module-level `_carries`.
- Modify: `ui/src/lib/api.ts` (`ActivityEntry.kind` gains `"names"`)
- Test: `tests/test_engine.py` (new [53])

**Interfaces:**
- Consumes:
  - `_take_dir_name` and `Library.update_take(…, tracks=)` (Task 2).
  - `activity.Journal.begin(kind, title)`, and `Entry.progress/done/fail/discard`.
- Produces:
  - `NamesPass(find, fix, busy, journal, wait=0.5)` with `.run() -> int`, `.request()`, `.start()` and `.stop()`.
  - `PublishQueue.busy() -> bool`.
  - `Api._move_take_dir(folder, take_number, take, name) -> (moved, tracks, error)`.

- [ ] **Step 1: Write the failing test**

Insert before the closing `print("\n" + "=" * 60)` in `tests/test_engine.py`:

```python
    print("\n[53] Putting names right")
    import shutil
    from sqlalchemy import text as sql_text
    from rehearsal_recorder.activity import Journal
    from rehearsal_recorder.names_pass import NamesPass
    from rehearsal_recorder.store import db as dbmod

    # The loop: waits while files are busy, renames take by take, one entry.
    journal53 = Journal()
    fixed53 = []
    waits53 = iter([True, True, False, False])

    def fix53(folder, number):
        fixed53.append(number)
        if number == 1:
            return {"renamed": True, "error": None}
        return {"renamed": False, "error": "it is open elsewhere"}

    loop53 = NamesPass(find=lambda: [("/r", 1, "Polyn 1"), ("/r", 2, "Vesna 1")], fix=fix53,
                       busy=lambda: next(waits53, False), journal=journal53, wait=0.001)
    ok("it waits while files are in use, then renames take by take",
       loop53.run() == 1 and fixed53 == [1, 2])
    entry53 = journal53.snapshot()[0]
    ok("one entry for the whole pass, saying which take was left and why",
       entry53["kind"] == "names" and entry53["title"] == "Putting names right"
       and entry53["state"] == "failed"
       and "“Vesna 1”: it is open elsewhere" in entry53["error"])
    quiet53 = Journal()
    ok("with nothing to put right it shows nothing",
       NamesPass(find=lambda: [], fix=fix53, busy=lambda: False, journal=quiet53).run() == 0
       and quiet53.snapshot() == [])
    stopped53 = Journal()
    halted53 = NamesPass(find=lambda: [("/r", 3, "Ogon 1")], fix=fix53, busy=lambda: True,
                         journal=stopped53, wait=0.001)
    halted53.stop()
    ok("stopped while it waits, it renames nothing and leaves nothing behind",
       halted53.run() == 0 and 3 not in fixed53 and stopped53.snapshot() == [])

    # The real thing: a library from before songs, opened by this version.
    tmp53 = Path(tempfile.mkdtemp())
    rec53, cloud53 = tmp53 / "Rec", tmp53 / "Drive"
    jam53 = rec53 / "Jam - 2026-01-10 19-00"
    later53 = rec53 / "Later - 2026-01-17 19-00"
    upto53 = tmp53 / "migrations"
    shutil.copytree(dbmod.MIGRATIONS, upto53, ignore=shutil.ignore_patterns("__pycache__"))
    for f in (upto53 / "versions").glob("*.py"):
        if f.name[:4] > "0001":
            f.unlink()
    rec53.mkdir(parents=True)
    dbmod.open_engine(rec53, upto53).dispose()
    engine53 = dbmod.make_engine(dbmod.database_path(rec53))
    with engine53.begin() as c:
        for folder53, created53, names53 in (
                (jam53, "2026-01-10T19:00:00", ["Polyn", "polyn 2", "Recovered take 3", "polyn 4"]),
                (later53, "2026-01-17T19:00:00", ["Polyn"])):
            rid = c.execute(sql_text(
                "INSERT INTO rehearsal (folder, name, created_at, samplerate, bit_depth) "
                "VALUES (:f, :f, :c, 48000, 16)"), {"f": folder53.name, "c": created53}).lastrowid
            for n, old in enumerate(names53, start=1):
                take_dir = folder53 / f"{n:02d} - {old}"
                write_wav(take_dir / "Gtr.wav", 100, seconds=0.5)
                tid = c.execute(sql_text(
                    "INSERT INTO take (rehearsal_id, take_number, name, duration_sec, "
                    "cloud_skip, cloud_send) VALUES (:r, :n, :name, 0.5, 0, 0)"),
                    {"r": rid, "n": n, "name": old}).lastrowid
                c.execute(sql_text("INSERT INTO take_file (take_id, position, name, file) "
                                   "VALUES (:t, 0, 'Gtr', :f)"),
                          {"t": tid, "f": f"{take_dir.name}/Gtr.wav"})
                if folder53 == jam53 and n == 2:
                    mix = cloud53 / jam53.name / f"{n:02d} - {old}.wav"
                    mix.parent.mkdir(parents=True)
                    mix.write_bytes(b"RIFF")
                    c.execute(sql_text("INSERT INTO cloud_copy (take_id, mix, mix_format, source) "
                                       "VALUES (:t, :m, 'wav', '{}')"),
                              {"t": tid, "m": f"{jam53.name}/{mix.name}"})
    engine53.dispose()
    (tmp53 / "config.json").write_text(json.dumps(
        {"recordings_dir": str(rec53), "cloud_dir": str(cloud53)}), encoding="utf-8")
    _, p53 = fresh_api(tmp53)

    def dirs53(folder=jam53):
        return sorted(p.name for p in folder.iterdir() if p.is_dir())

    real_move53 = p53._move_take_dir

    def refuse_take_4(folder, number, take, name):
        if number == 4:
            return None, None, "the folder is open in another program"
        return real_move53(folder, number, take, name)

    p53._move_take_dir = refuse_take_4
    try:
        renamed53 = p53._names_pass.run()
    finally:
        p53._move_take_dir = real_move53
    takes53 = {t["take_number"]: t for t in p53.get_rehearsal(str(jam53))["takes"]}
    ok("old names are put right on disk: the first go gains its number, a case-only "
       "rename is made, and a recovered take is Take N",
       renamed53 == 4
       and dirs53() == ["01 - Polyn 1", "02 - Polyn 2", "03 - Take 3", "04 - polyn 4"]
       and Path(takes53[2]["tracks"][0]["file"]).exists())
    ok("goes are numbered across the library on disk too",
       dirs53(later53) == ["01 - Polyn 4"])
    ok("and in the cloud folder",
       Path(takes53[2]["cloud"]["mix"]).name == "02 - Polyn 2.wav"
       and sorted(p.name for p in (cloud53 / jam53.name).iterdir()) == ["02 - Polyn 2.wav"])
    names_entry53 = next(e for e in p53.activity()["entries"] if e["kind"] == "names")
    ok("a take that could not be renamed is left, and the background work says which and why",
       names_entry53["state"] == "failed" and "“Polyn 3”" in names_entry53["error"]
       and "open in another program" in names_entry53["error"])
    ok("the next pass picks it up",
       p53._names_pass.run() == 1 and "04 - Polyn 3" in dirs53())
    entries53 = len(p53.activity()["entries"])
    ok("once every name matches, a pass renames nothing and says nothing",
       p53._names_pass.run() == 0 and len(p53.activity()["entries"]) == entries53)

    takes53 = {t["take_number"]: t for t in p53.get_rehearsal(str(jam53))["takes"]}
    taken53 = jam53 / "03 - Take 3 (2)"
    Path(takes53[3]["tracks"][0]["file"]).parent.rename(taken53)
    p53._lib.update_take(jam53, 3, tracks=[{"name": "Gtr", "file": str(taken53 / "Gtr.wav")}])
    ok("a folder that took “(2)” because the name was taken counts as carrying it",
       all(n != 3 for _, n, _ in p53._names_out_of_line()))

    lower53 = jam53 / "01 - polyn 1"
    Path(takes53[1]["tracks"][0]["file"]).parent.rename(lower53)
    p53._lib.update_take(jam53, 1, tracks=[{"name": "Gtr", "file": str(lower53 / "Gtr.wav")}])
    p53.player_open([{"name": "Gtr", "file": str(lower53 / "Gtr.wav")}])
    ok("a take open in the player is left for next time, not closed under the listener",
       p53._names_pass.run() == 0 and "01 - polyn 1" in dirs53()
       and p53._open_tracks is not None)
    p53.player_close()
    ok("and is renamed once the player lets go",
       p53._names_pass.run() == 1 and "01 - Polyn 1" in dirs53())

    p53._recorder = object()
    ok("it waits while a take records", p53._names_must_wait())
    p53._recorder = None
    crop53 = p53._journal.begin("crop", "Cropping")
    ok("and while a take is being cropped", p53._names_must_wait())
    crop53.done()
    ok("and not otherwise", not p53._names_must_wait())
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

In `src/rehearsal_recorder/api.py`, add `from rehearsal_recorder.names_pass import NamesPass` after the `cloudmod` import, and this after `_take_dir_name`:

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

Then:
- in `attach_window`, after `self._cloud_queue.start()`: `self._names_pass.start()`;
- in `shutdown`, after `self._cloud_queue.stop()`: `self._names_pass.stop()`;
- in `set_recordings_dir`, after `self._server.set_media_root(folder)`: `self._names_pass.request()`.

Move the folder renaming out of `rename_take` into this method, just before `rename_take`:

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

The checks at the top of `rename_take` stay. From `take = self._lib.take(…)` on, it becomes:

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

Add the pass's side at the end of the class, after `_move_rehearsal_copies`:

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

In `ui/src/lib/api.ts`, `ActivityEntry.kind` becomes `"cloud" | "crop" | "stop" | "recover" | "names"`.

- [ ] **Step 5: Run every suite**

Run: `venv/bin/python tests/run_all.py`
Expected: all pass. That includes [9], [11g], [11m], [25] and [52], all of which now go through `_move_take_dir`.

Run: `cd ui && npm test && npm run lint && npm run build && npm run test:e2e`
Expected: passes, 20 lint warnings.

- [ ] **Step 6: Commit**

```bash
git add src/rehearsal_recorder/names_pass.py src/rehearsal_recorder/cloud.py src/rehearsal_recorder/api.py ui/src/lib/api.ts tests/test_engine.py
git commit -m "Putting names right: old folders and cloud copies renamed to match, in the background

After the songs migration most takes' names differ from their folders and
cloud copies. A pass on every open renames them one take at a time, as
'Putting names right' in the background-work list, waiting while anything
records, copies, saves, crops or recovers, and leaving a take open in the
player for next time.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs, and a check in the real app

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
with its go, and `store/names.py` writes the name from the two.

**The go is a number of its own, never typed.** In a name, a number was
trouble: "Song 2" could be a title or a second go, a pill had to offer
"Polyn 3" rather than Polyn, and a typed "Polyn 7" meant nothing anyone
intended. So the name field holds a title, and the go is shown beside it.

**Goes run across the library, and are stored.** A song's goes are numbered
from its first ever, so "Polyn 17" is one take wherever it was played.
Counting them from the takes on every read would renumber them when one is
deleted, and rename its folder and cloud copy for no reason: a stored go is
given once and kept.

**Names are put right in the background.** A take's folder and cloud copy
are named after it, so when its name changes without them — migration 0002
numbering every old go afresh — `names_pass.py` renames them on the next
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

In "Names and songs", replace the first two paragraphs (from "A new take gets the name of the previous take…" to "…and are not counted as a song.") with:

```markdown
Each take is a go at a song. You name it with the song's title, and the app
counts the goes: the number beside the name, "Polyn 1", "Polyn 2", goes on
from one rehearsal to the next, so "Polyn 17" is one take wherever it was
played. A new take is another go at the song before it, so you only name a
take when the band moves on to another song.

Type the title only; the number is the app's. Typing "Polyn 5" names the
take Polyn, at whatever go is next. A song is spelled one way everywhere:
typing "polyn" gives "Polyn" when that song is there. A title can end in a
number, like "Opus 5", as long as no song is called "Opus". A take nobody
named is called by its number, "Take 4", is not counted as a song, and so is
a recovered take you did not name.
```

In the next paragraph, change "A song played in this rehearsal comes with the next number: with "Polyn" and "Polyn 2" already recorded, it gives "Polyn 3"." to "Each song comes with the go it would be, dimmed beside it; a click puts only the title in the field."

- [ ] **Step 4: CHANGELOG.md**

Add as the first item under `## Unreleased`:

```markdown
- **A take is a go at a song, and the go is a number of its own.** The name
  field holds the song's title, with the go it will be dimmed beside it, and
  the songs under it put only the title in. The go is counted across every
  rehearsal — yesterday's Polyn 2 is followed by today's Polyn 3 — and shown
  from 1, beside the title, wherever a take is. A typed number does not
  change which go a take is; a song is spelled one way everywhere; a title
  can end in a number ("Opus 5") when no song is called "Opus"; and a
  recovered take nobody named is "Take 5", like any other. Older takes move
  over the first time this version opens the recordings folder (a copy of
  the history is kept beside it, as `library.sqlite.bak-0001`), their goes
  numbered afresh in the order played, and their folders and cloud copies
  are renamed to match in the background, as *Putting names right*. This is
  what the song pages and the one best take will stand on (#12).
```

- [ ] **Step 5: Commit the docs**

```bash
git add docs/design-notes.md docs/development.md docs/using-it.md CHANGELOG.md
git commit -m "Docs: songs are stored, goes are their own numbers, and why take is altered in place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Check in the real app, on a copy of the library**

The real recordings folder migrates the first time this version opens it. Check on a copy first: the folders and the database, without the audio and with no cloud folder.

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
- History lists the same rehearsals.
- Each take shows its song with the go beside it. The goes run on from rehearsal to rehearsal, and each song is spelled one way.
- Old "Recovered take N" takes are "Take N".
- On a new rehearsal, the name field holds the title with the go beside it, and the go follows typing.
- The background-work list showed *Putting names right* once, with the number of takes renamed.
- `find "$CHECK/Rec" -mindepth 2 -maxdepth 2 -type d | sort`: every take folder is `NN - <title> <go>` or `NN - Take N`, as History shows it.
- `ls "$CHECK/Rec"` shows `library.sqlite.bak-0001`.
- Quit and start again with the same command: the background-work list shows nothing new.
- `cat "$CHECK/app.log"` has no traceback.

Report what was seen. Do not point the app at the real recordings folder; the user decides when.

---

## Added after the final review (2026-10-04)

The user decided that a go number is never given again, even after its take
is deleted (spec D5 as amended), and the final review left one visible
defect: the go runs into the title in the `cut` layout. Tasks 6 and 7 do
these. The Global Constraints above still bind; a change to an existing test
is allowed only where D5 (Task 6) or the restored space (Task 7) explains it,
listed in the commit message.

### Task 6: A go number is never given again

**Files:**
- Modify: `src/rehearsal_recorder/store/models.py`, `src/rehearsal_recorder/store/migrations/versions/0002_songs.py`, `src/rehearsal_recorder/store/library.py`
- Modify: `docs/design-notes.md`, `docs/using-it.md`, `CHANGELOG.md`
- Test: `tests/test_store.py` ([9], [10])

**Interfaces:**
- Produces: `Song.last_go: int` (the highest go the song has ever given); `Library.next_goes()` covers every song, also those with no takes left.
- Library no longer deletes a song when its last take goes (`_drop_songless` is removed).

- [ ] **Step 1: Write the failing tests**

In `tests/test_store.py` [9], just before that section's `lib.close()` (after the "what the rule cannot know stays as it reads" check), add:

```python
    ok("each song's count starts at its highest go",
       lib.next_goes() == {"Polyn": 5, "Song": 3, "Опус": 2, "Полынь": 3})
```

In [10], replace the block from `ok("a song left with no takes is gone", …` to `ok("forgetting rehearsals forgets the songs only they had", song_titles() == [])` with:

```python
    ok("a song left with no takes keeps its count: its next go is not 1 again",
       rename(9, "Take 9") == ("Take 9", None, None)
       and lib.resolve_name(jam, "vesna", 20) == {"song": "Vesna", "go": 2, "name": "Vesna 2"})
    lib.delete_take(jam, 2)
    ok("deleting a go does not renumber the rest", lib.take(jam, 3)["name"] == "Polyn 3")
    lib.delete_take(jam, 4)
    ok("deleting the latest go does not give its number out again",
       lib.resolve_name(jam, "Polyn", 20)["go"] == 6)
    lib.delete_take(jam, 8)
    ok("a song whose takes are all gone is kept, and carries on from its count",
       "ПОЛЫНЬ" in song_titles() and lib.resolve_name(jam, "полынь", 20)["go"] == 3)
    lib.forget_rehearsal(jam)
    lib.forget_rehearsal(other)
    ok("forgetting rehearsals keeps every song and its count",
       song_titles() == ["Polyn", "Song 2", "Vesna", "ПОЛЫНЬ"]
       and lib.next_goes() == {"Polyn": 6, "Song 2": 3, "Vesna": 2, "ПОЛЫНЬ": 3})
```

and change the import check after it (Polyn's count is 5, so the Kept take is Polyn 6 and the imported goes carry on from there):

```python
    ok("an imported rehearsal is read by the old rule, its goes carrying on from "
       "each song's count, even though it is older",
       [(t["name"], t["song"], t["go"]) for t in lib.rehearsal(old_jam)["takes"]] == [
           ("Polyn 7", "Polyn", 7), ("Polyn 8", "Polyn", 8), ("Take 3", None, None),
           ("zima 1", "zima", 1), ("zima 2", "zima", 2), ("Опус 1", "Опус", 1)])
```

- [ ] **Step 2: Run it and watch it fail**

Run: `venv/bin/python tests/test_store.py`
Expected: FAIL on "each song's count starts at its highest go" (or an error: `Song` has no `last_go`), and on the changed [10] checks.

- [ ] **Step 3: The count**

`models.py`, in `Song` after `title`:

```python
    # The highest go this song has ever given. The next go is one past it,
    # so a number is never given twice, even after its take is deleted; and
    # a song is kept when its last take goes, so its count is kept too.
    last_go: Mapped[int] = mapped_column(Integer, default=0)
```

`0002_songs.py`: the `song` table gains `sa.Column("last_go", sa.Integer(), nullable=False, server_default="0"),` after `title`; the insert becomes

```python
    ids = {
        key: bind.execute(
            sa.text("INSERT INTO song (title, last_go) VALUES (:title, :last_go)"),
            {"title": title, "last_go": counted[key]}).lastrowid
        for key, (_, title) in titles.items()
    }
```

and its docstring gains, after "…in the order they were played…": "Each song's count of goes given starts at its highest."

`library.py`:
- In the `# ---------- songs ----------` comment, replace the last sentence ("A song with no takes left goes with its last one, …") with: "A song is never deleted with its takes: one with none keeps its title and its count of goes given (Song.last_go), so a number is never given twice."
- `_resolve`: replace the last two lines (`highest = …` and its `return`) with `return song, title, (song.last_go or 0) + 1`, and in its docstring replace "one past the highest go at the song anywhere in the library" with "one past the song's count of goes given (Song.last_go), so a number is never given twice, even after its take is deleted".
- `_song_row` becomes:

```python
    @staticmethod
    def _song_row(db, song, title, go):
        """The Song a take resolved to (_resolve): made if it is new,
        respelled if _resolve said so, and its count moved on to `go`. None
        for no song."""
        if title is None:
            return None
        if song is None:
            song = Song(title=title, last_go=0)
            db.add(song)
        elif song.title != title:
            song.title = title
        song.last_go = max(song.last_go or 0, go)
        return song
```

  and both callers pass `go`: `self._song_row(db, song, title, go)` in `add_take` and `update_take`.
- Delete `_drop_songless` and every call to it:
  - `update_take`: drop `was = row.song_id` and `self._drop_songless(db, [was])`;
  - `delete_take`: the body after the `None` check becomes `rehearsal_id = row.rehearsal_id`, `db.delete(row)`, `db.flush()`, `return len(db.scalars(select(Take.id).where(Take.rehearsal_id == rehearsal_id)).all())`;
  - `forget_rehearsal`: drop the `song_ids = …` line and the call, leaving `db.delete(row)` and `return True`.

  Drop `delete` from the `sqlalchemy` import if nothing else uses it.
- `next_goes`:

```python
    def next_goes(self):
        """{title: the go the next take of that song would be}, for every
        song: one past its count of goes given, as _resolve counts it. One
        query, for the songs offered under a take's name."""
        with self._session() as db:
            rows = db.execute(select(Song.title, Song.last_go)).all()
        return {title: (last or 0) + 1 for title, last in rows}
```

- `import_rehearsal`: delete the `highest = dict(…)` query; in `go_at`, replace `counted[key] = highest.get(songs[key].id) or 0` with `counted[key] = songs[key].last_go or 0`, make a new song `Song(title=title, last_go=0)`, and after `counted[key] += 1` add `songs[key].last_go = counted[key]`. Its comment's "its goes go on from its highest" becomes "its goes go on from its count".

- [ ] **Step 4: Run it and watch it pass**

Run: `venv/bin/python tests/test_store.py`, then `venv/bin/python tests/test_engine.py`.
Expected: all pass. If a test_engine check fails, change it only if D5 (numbers never given again; songs kept with no takes) explains the difference, and list it in the commit message; otherwise stop and report.

- [ ] **Step 5: Docs**

- `docs/design-notes.md`, in "**Goes run across the library, and are stored.**", after "a stored go is given once and kept." add: "Each song keeps a count of the goes it has given, and a song is kept when its last take goes, so deleting the latest go does not give its number out again."
- `docs/using-it.md`, "Names and songs": after "so "Polyn 17" is one take wherever it was played." add "Deleting a take does not free its number."
- `CHANGELOG.md`, in the first Unreleased item, after "and shown from 1, beside the title, wherever a take is." add "A number is never given twice: deleting the latest go does not free it."

- [ ] **Step 6: Commit**

```bash
git add src/rehearsal_recorder/store tests/test_store.py tests/test_engine.py docs/design-notes.md docs/using-it.md CHANGELOG.md
git commit -m "A go number is never given twice, even after its take is deleted

Each song keeps a count of the goes it has given (song.last_go); the next
go is one past it, and a song is kept when its last take goes, so its
count is kept too.

Tests changed (spec D5 as amended): test_store [10] — a song with no takes
is kept with its count; deleting the latest go does not free its number;
the imported goes carry on from the count. <any test_engine changes>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: The go sits apart from the title

**Files:**
- Modify: `ui/src/components/TakeTitle.tsx`
- Test: `ui/e2e/naming.spec.ts`

The final re-review found that in `GoTitle`'s `cut` layout the go's span is a flex item, so its leading space is the start of a line and collapses: the strip, History's rows and the recording heading would show "Polyn3". The text in the DOM still has the space, so text checks do not see it.

- [ ] **Step 1: Write the failing test**

In `ui/e2e/naming.spec.ts`, add:

```ts
test("the go sits apart from the title, not run into it", async ({ page }) => {
  await openApp(page)
  await startRehearsal(page)
  await recordTake(page)
  await saveAs(page, "Polyn")
  const take = page.getByRole("button", { name: /^Take 1 Polyn 1/ })
  const title = await take.locator("[data-go-title]").boundingBox()
  const go = await take.locator("[data-go]").boundingBox()
  expect(go!.x - (title!.x + title!.width)).toBeGreaterThan(2)
})
```

and in `TakeTitle.tsx`'s `cut` branch give the title span `data-go-title` and the go span `data-go` (the attributes only; no style change yet).

- [ ] **Step 2: Run it and watch it fail**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts -g "apart from the title" --reporter=line`
Expected: FAIL, the gap is 0 (or under 2 px). If it passes, the space is not lost: stop, say so in the report, and make no style change.

- [ ] **Step 3: Keep the space**

In `GoTitle`, give the go's span `whitespace-pre` when `cut` (so its leading space survives the start of the flex item's line): `cn("tnum text-muted-foreground", cut && "shrink-0 whitespace-pre")`. Keep the `{" "}` so the text is still "Polyn 3".

- [ ] **Step 4: Run it and watch it pass**

Run: `cd ui && npm run build && npx playwright test e2e/naming.spec.ts e2e/player.spec.ts e2e/recording.spec.ts --reporter=line`, then `npm test` and `npm run lint` (20 warnings at most, no errors).
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/TakeTitle.tsx ui/e2e/naming.spec.ts
git commit -m "The go sits apart from the title when the title is cut short

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
