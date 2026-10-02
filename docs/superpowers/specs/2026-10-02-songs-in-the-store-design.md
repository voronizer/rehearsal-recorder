# Songs in the store: a take is a go at a song

A song is not stored anywhere. Every time one is needed it is worked out from
take names, "Polyn 3" being a go at "Polyn", and `docs/design-notes.md` says
why: *a song is a rule, not a fact, and a stored copy of it would drift from
the names*. That held while a song was only a way to group takes. It no
longer does:

- **A song is about to have data of its own** that no take name can carry:
  - the one best take (★);
  - a page of its own across every rehearsal;
  - a plan for the evening and notes per song.

  Each of these is a later step (#12), and each needs somewhere to hang.
- **A song is already a fact, not a guess.** It is picked with a click on a
  pill; typing is the exception.
- **Fixing a spelling is dozens of renames.** Polyn / Polin / Полынь across
  ten rehearsals is one rename per take.
- **The rule gets some titles wrong.** A title ending in a number ("Song 2",
  "Опус 5") is read as a go at "Song".

This makes the song the thing a take is *of*, and the take's name follow from
it. It is the first step of the songs work in #12, and the one every other
step stands on. Nothing a person sees changes in it.

## What the app has

- **The rule** lives in `src/rehearsal_recorder/api.py`:
  - `_UNNAMED_TAKE` (`^Take \d+$`, no song) and `_ATTEMPT_NUMBER` (a trailing
    number is the go);
  - `_song_of` (name → song);
  - `_songs_of` (a rehearsal's takes grouped, spelled as first used);
  - `_runs_of` (the evening strip);
  - `_next_go` (what the next go at a song is called);
  - `_last_attempt` ("Took 2:21 last time");
  - `suggest_take_name` (the previous name with its number bumped);
  - `song_choices` (`here`: this rehearsal's songs as their next go; `other`:
    the rest of the library, newest first, spelled as last used);
  - `last_time`.
- **A take's name is free text**, stored in `take.name`
  (`src/rehearsal_recorder/store/models.py`). It comes from:
  - `keep_take(custom_name)`;
  - `rename_take(new_name)`;
  - `recover_draft(name)`, which falls back to "Recovered take N" — a name the
    rule reads as a song called "Recovered take";
  - the importer, for `session.json` files from before the database.
- **The name is in the files.**
  - On disk, a take's folder is `NN - <name>` (`keep_take`, `rename_take`,
    `recover_draft`).
  - In the cloud folder, a copy is `<rehearsal folder>/NN - <name>.<ext>` and
    `NN - <name>/` for the tracks (`share_take`, `_rename_take_copies`).
  - `cloud.source_of` fingerprints a copy with the name, so a copy whose name
    no longer matches is made again.
- **Migrations** are Alembic, one so far (`0001_initial`). `store/db.py`
  copies the database aside before migrating
  (`library.sqlite.bak-<revision>`).

## Decisions

- **D1. A take is a go at a song, or at nothing.** A take the app named
  itself (a jam, a warm-up, a take nobody named) has no song.
- **D2. A take's name is not stored; it follows from its song.**
  - With a song, it is the title for the first go and "title N" for go N.
  - Without one, it is "Take N", N being the take's number.

  Everything that shows or files a take uses this one name: the screens, the
  folder on disk and the cloud copy.
- **D3. Go numbers are counted within a rehearsal**, as today: "Polyn 3" is
  the third go at Polyn that evening.
- **D4. The go is stored, not counted from the takes.** Deleting "Polyn 2"
  does not turn "Polyn 3" into "Polyn 2", so it does not rename the take's
  files.
- **D5. A recovered draft with no name gets no song**, so it is "Take N" like
  any other take nobody named. The old "Recovered take N" names become
  "Take N".

## Schema (migration 0002)

| Table | Change |
|---|---|
| `song` | new: `id` PK, `title` TEXT NOT NULL, spelled as shown. Unique case-blind (an index on `lower(title)` cannot fold Cyrillic in SQLite, so Python enforces it: a title is looked up with `casefold()` before a song is made). |
| `take` | `song_id` → `song` ON DELETE SET NULL, nullable, indexed. `go` INT, nullable; null exactly when `song_id` is. `name` is dropped. |

A song with no takes left is deleted with its last take, by the code that
deletes or renames takes, not by a trigger.

## Naming a take

The interface keeps sending a name as a string, as it does now: the field,
the pills and the dialogs are unchanged. Python turns the string into a song
and a go.

- **N1. A name resolves to a song.** Trimmed, then, in order:
  1. "Take N" (`_UNNAMED_TAKE`) is no song;
  2. a song whose title is the whole name, compared with `casefold()`, is that
     song;
  3. a song whose title is the name less a trailing number ("Polyn 3",
     `_ATTEMPT_NUMBER`) is that song;
  4. anything else is a new song with exactly that title, so a title ending
     in a number is only read as a go when a song by the shorter title
     exists.

  An empty name is the default (N3).
- **N2. The go is the app's.** A take gets the next go at its song in its
  rehearsal: one past the highest go there, as `_next_go` counts it now. A
  typed number does not pick one: "Polyn 5" typed while the next go is 3
  makes the take "Polyn 3". A take renamed to the song it already has keeps
  its go, as "Polyn 2" renamed to Polyn stays Polyn 2 today.
- **N3. The next take** is the previous take's song, at its next go. After a
  take with no song, it is "Take N".

  `set_next_take_name` keeps holding a name picked for the next take until a
  take is kept. That name is now a song resolved by N1, or no song.
- **N4. Renaming a take** (`rename_take`) gives it the song its new name
  resolves to (N1) and that song's next go there (N2). Its folder on disk and
  its cloud copy are renamed to match, as today.
- **N5.** What the interface is sent keeps its shape:
  - every take still has `name` (now D2's);
  - each take gains `song` (the title, or null) and `go`;
  - `songs`, `runs`, `song_choices`, `last_attempt` and `last_time` are built
    from `song_id` and `go`, not by parsing names.

  The interface still never groups takes itself.

## Migration

- **M1. Songs come from the names by today's rule.** It is case-blind, a
  trailing number is the go, and "Take N" and "Recovered take N" are no song
  (D5). An empty name is no song. The title is the spelling used most
  recently across the library, by rehearsal date then take number, as
  `song_choices` already chooses it.
- **M2. The go comes from the name:** "Polyn" → 1, "Polyn 3" → 3. Gaps stay
  gaps. Two takes with the same name in one rehearsal keep the same go, as
  their names do today: nothing is renumbered.
- **M3. The importer** (`store/importer.py`) gives the takes of a
  `session.json` a song and a go by the same rule, through the same function
  as M1, so the two cannot differ.
- **M4. The migration touches only the database.** It renames nothing on
  disk or in the cloud folder, so a failure leaves every file where it was,
  and the copy `db.py` made beside it is what it was before.
- **M5. What the rule cannot know stays as it reads.** A song really called
  "Song 2" in old data is read as the second go at "Song", as today. Renaming
  or merging songs, a later step, puts it right.

## Bringing files into line

After M1 some takes' names come out differently from the names their files
carry:
- a spelling changed ("polyn 2" under a song now spelled "Polyn");
- "Recovered take 5" becomes "Take 5";
- a "Take 3" is take number 5.

- **F1.** After the migration, and on every open after it, a background pass
  compares each take's folder on disk and its cloud copy with the name D2
  gives it, and renames what differs, the way `rename_take` does.
- **F2.** The pass shows in the background-work list with its progress, as
  "Putting names right", one entry for the whole pass. It does nothing, and
  shows nothing, when every name already matches.
- **F3.** It can be stopped at any point and started again. Each rename is
  one take, done and recorded before the next. A take whose files already
  match is skipped, so a second run picks up where the first stopped.
- **F4.** It does not run while a take is recording or a copy to the cloud
  is being made. It waits and runs after.
- **F5.** A rename that fails (a file open elsewhere on Windows, a cloud
  folder that is not there) is left for the next open, and the
  background-work list says which take and why.

## Testing

Tests come before the code, and each is seen failing first.

- **Python, the migration** (`tests/test_store.py`). A 0001 database with
  awkward names is migrated and checked:
  - case variants across rehearsals → one song spelled as the latest;
  - "Take 4", "Recovered take 2" and an empty name → no song;
  - "Polyn" and "Polyn 3" with no "Polyn 2" → gos 1 and 3;
  - two takes named "Polyn" in one rehearsal → both go 1;
  - "Song 2" with "Song" elsewhere in the library → a go at Song;
  - "Song 2" with no "Song" anywhere → read as a go at "Song" too (M5);
  - the backup file is there, and a downgrade is refused as before.
- **Python, naming** (`tests/test_engine.py`): N1–N4 through `keep_take`,
  `set_next_take_name`, `rename_take` and `recover_draft`. This includes a new
  title ending in a number and a typed go number being ignored.
- **Python, the pass:**
  - a take whose folder is "03 - polyn 2" is renamed to "03 - Polyn 2" on
    disk and in the cloud folder, including a case-only rename on a
    case-insensitive disk;
  - a second run renames nothing;
  - a failure on one take leaves the others done.
- **Everything that exists.** The Python suites and the Playwright suites
  (`ui/e2e/`) describe naming and grouping today and pass unchanged. A test
  that has to change is a behaviour change and needs its reason in the
  commit. The fake bridge (`ui/e2e/fake-bridge.js`) gains `song` and `go` on
  its takes.

## Docs

- `docs/design-notes.md`: "Songs are still not stored" is replaced with why
  they now are, and why the go is stored (D4).
- `docs/development.md`: the schema, if it lists tables.
- `docs/using-it.md`: under "Names and songs", that a title can end in a
  number when no song by the shorter title exists, and that an unnamed
  recovered take is "Take N".
- `CHANGELOG.md`: the names put right on first open, and why.

## Steps

Each commit leaves the app working.

1. The schema, migration 0002 and the importer (M1–M5), with the library
   reading `song` and `go`, and Python building `songs`, `runs` and the rest
   from them (N5). The names the interface shows come from D2.
2. Naming through songs: N1–N4 in `keep_take`, `set_next_take_name`,
   `rename_take` and `recover_draft`.
3. The pass that brings files into line (F1–F5).

## Not part of this

- ★, the one best take of a song: the next step, with its own migration.
- A song's page, songs on History's list, and the rest of #12's steps.
- Renaming or merging a song across every rehearsal.
- A new layout for the cloud folder: a later step. This one keeps today's
  layout and only brings names into line within it.
