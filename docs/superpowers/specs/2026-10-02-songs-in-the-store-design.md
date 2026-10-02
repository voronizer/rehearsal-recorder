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
- **The number in a name causes trouble.** The go is part of the text, so
  everything that reads a name has to take it apart again:
  - a title ending in a number ("Song 2", "Опус 5") is read as a go at
    "Song";
  - a pill has to offer "Polyn 3" rather than Polyn;
  - a typed "Polyn 7" means something nobody intended.

This makes the song the thing a take is *of*. The go becomes a number of its
own: it is shown beside the title, and is never typed or picked. It is the
first step of the songs work in #12, and the one every other step stands on.

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
  - `song_choices` (`here`: this rehearsal's songs as their next go, "Polyn
    3"; `other`: the rest of the library, newest first, spelled as last
    used);
  - `last_time`.
- **A take's name is free text**, stored in `take.name`
  (`src/rehearsal_recorder/store/models.py`). It comes from:
  - `keep_take(custom_name)`;
  - `rename_take(new_name)`;
  - `recover_draft(name)`, which falls back to "Recovered take N", a name the
    rule reads as a song called "Recovered take";
  - the importer, for `session.json` files from before the database.
- **The name is in the files.**
  - On disk, a take's folder is `NN - <name>` (`keep_take`, `rename_take`,
    `recover_draft`).
  - In the cloud folder, a copy is `<rehearsal folder>/NN - <name>.<ext>`, and
    `NN - <name>/` for the tracks (`share_take`, `_rename_take_copies`).
  - `cloud.source_of` fingerprints a copy with the name, so a copy whose name
    no longer matches is made again.
- **The interface shows the go apart already, in one place.** The song pills
  under the name field (`ui/src/components/SongPills.tsx`) draw "Polyn 3" as
  the title with the number in a muted colour.
- **Migrations** are Alembic, one so far (`0001_initial`). `store/db.py`
  copies the database aside before migrating
  (`library.sqlite.bak-<revision>`).

## Decisions

- **D1. A take is a go at a song, or at nothing.** A take the app named
  itself (a jam, a warm-up, a take nobody named) has no song.
- **D2. What is typed or picked is a song's title, never a go.** The name
  field holds the title, and the pills put a title in it. The go is the
  app's (N2).
- **D3. A take's name is not stored; it follows from its song and its go.**
  - On screen, it is the title with the go beside it, in the muted style the
    pills already use: **Polyn** 3. The go is always there, from 1.
  - As plain text, it is "Polyn 1", "Polyn 3". Plain text is where a name is
    only text: file names, dialog titles, the background-work list and
    labels for screen readers.
  - With no song, it is "Take N", N being the take's number, with no go.
- **D4. Go numbers run across the whole library, per song**, not per
  rehearsal. If yesterday ended at Polyn 2, today's first go is Polyn 3. A go
  number then names one take of a song wherever it was played: "Polyn 17 was
  the one" needs no date.
- **D5. A go number is given once and kept.** It is stored, not counted from
  the takes:
  - deleting Polyn 2 does not turn Polyn 3 into Polyn 2, so it does not
    rename the take's files;
  - a take that becomes a go at a song later (named, renamed) gets that
    song's next number then, whenever it was played. Numbers follow the order
    takes became goes, which is nearly always the order they were played.
- **D6. A recovered draft with no name gets no song**, so it is "Take N" like
  any other take nobody named. The old "Recovered take N" names become
  "Take N".
- **D7. Files carry the go as well:** a take's folder is `01 - Polyn 1`, and
  so are its cloud copies. What the band sees in the cloud folder then reads
  as the app does. The old first goes (`01 - Polyn`) are renamed once, in the
  background (F1–F5).

## Schema (migration 0002)

| Table | Change |
|---|---|
| `song` | new: `id` PK, `title` TEXT NOT NULL, spelled as shown. Unique case-blind. An index on `lower(title)` cannot fold Cyrillic in SQLite, so Python enforces it: a title is looked up with `casefold()` before a song is made. |
| `take` | `song_id` → `song` ON DELETE SET NULL, nullable, indexed. `go` INT, nullable; null exactly when `song_id` is. `name` is dropped. |

The migration alters `take` in place (`ALTER TABLE … ADD COLUMN` / `DROP
COLUMN`), not in Alembic's batch mode. Batch mode rebuilds the table with a
`DROP TABLE`, which, with foreign keys on, deletes every marker, track file
and cloud copy through their `ON DELETE CASCADE`.

A song with no takes left is deleted with its last take, by the code that
deletes or renames takes, not by a trigger.

## Naming a take

The interface sends what is in the name field as a string, as it does now.
Python turns the string into a song and a go.

- **N1. The text resolves to a song.** Trimmed, then, in order:
  1. empty, or "Take N" (`_UNNAMED_TAKE`), is no song;
  2. a song whose title is the whole text, compared with `casefold()`, is
     that song;
  3. a song whose title is the text less a trailing number is that song.
     This is a safety net for a number typed out of habit ("Polyn 3"): the
     number is dropped, not used;
  4. anything else is a new song with exactly that title. "Опус 5" is a
     title of its own unless a song called "Опус" exists.
- **N2. The go is the app's.** A take gets the next go at its song: one past
  the highest go at it anywhere in the library (D4). A take renamed to the
  song it already has keeps its go.
- **N3. The next take** is the previous take's song, at its next go: the
  field shows the title, and the go beside it. After a take with no song, it
  is "Take N".

  `set_next_take_name` keeps holding a title picked for the next take until a
  take is kept. That title is resolved by N1 when it is used.
- **N4. Renaming a take** (`rename_take`) gives it the song its text
  resolves to (N1), and that song's next go (N2). Its folder on disk
  and its cloud copy are renamed to match, as today.
- **N5.** What the interface is sent:
  - every take has `name` (D3, plain text), `song` (the title, or null) and
    `go` (null with no song);
  - `song_choices` entries are `{song, go, last_take?}`: the title, and the
    go a take would be as that song, for every song offered, this
    rehearsal's and the rest. For the take being renamed, its own go at its
    own song. The old `name` key ("Polyn 3") goes;
  - `session_state`:
    - `next_take_name` is the field's text: the title, or "Take N";
    - `next_take_go` is the go beside it (null with no song);
    - `next_take_default` is the text the field would hold without a title
      picked;
  - `stop_take`'s `suggested_name` and `default_name` are field text too;
  - `songs`, `runs`, `last_attempt` and `last_time` are built from `song_id`
    and `go`, not by parsing names.

  The interface still never groups takes itself.

## The interface

- **I1. A take's title, wherever a take is shown,** is the song's title and
  its go beside it in the pills' muted style. It is "Take N" with no song.
  One component draws it, used in:
  - the strip of takes (`TakeStrip.tsx`);
  - History's rows of a rehearsal (`RehearsalOverview.tsx`);
  - the recording screen's name.

  Last time's rows are songs, not takes, and the player's title is the
  rehearsal's; neither changes.
- **I2. The name field holds only the title.** Inside the field, after the
  text, the go it will be is shown muted, and it follows what is typed:
  - a song's go, taken from the choices the field already has;
  - 1 for a title no song has;
  - nothing for "Take N".

  The go cannot be selected or edited.
- **I3. The pills look as they do now,** the title and the go muted, and put
  only the title in the field.
- **I4. The Rename take dialog** opens with the take's title in the field,
  not its plain-text name.
- **I5. Plain-text places** (dialog titles such as `Delete “Polyn 3”?`,
  screen-reader labels, notices, the background-work list) use `name`.

## Migration

- **M1. Songs come from the names by today's rule.** It is case-blind, a
  trailing number is the go, and "Take N" and "Recovered take N" are no song
  (D6). An empty name is no song. The title is the spelling of the newest
  rehearsal's first go at the song, which is how `song_choices` already
  spells it.
- **M2. Goes are numbered afresh, per song, in the order played:** by
  rehearsal date, then take number. Today's numbers cannot be kept: every
  rehearsal has its own Polyn 1. So Polyn, Polyn 2 on 28 Sep and Polyn,
  Polyn 2, Polyn 3 on 30 Sep become goes 1–2 and 3–5. Gaps left by deleted
  takes close, and two takes with one name in a rehearsal get a number
  each.
- **M3. The importer** (`store/importer.py`) gives the takes of a
  `session.json` a song and a go by the same rule, through the same function
  as M1, so the two cannot differ. A song already in the library keeps its
  title. A new one is spelled the way that rehearsal first spells it. Its
  goes get their songs' next numbers in take order (D5), even when the
  rehearsal is older than ones already in the library.
- **M4. The migration touches only the database.** It renames nothing on
  disk or in the cloud folder, so a failure leaves every file where it was,
  and the copy `db.py` made beside it is what it was before.
- **M5. What the rule cannot know stays as it reads.** A song really called
  "Song 2" in old data is read as a go at "Song", as today. Renaming or
  merging songs, a later step, puts it right.

## Bringing files into line

After M1 and M2 almost every take's name comes out differently from the name
its files carry:
- the go is numbered across the library (`03 - Polyn 2` on 30 Sep becomes
  `03 - Polyn 4`);
- every first go gains its number (`01 - Polyn` becomes `01 - Polyn 3`, D7);
- a spelling changed ("polyn 2" under a song now spelled "Polyn");
- "Recovered take 5" becomes "Take 5";
- a "Take 3" is take number 5.

- **F1.** After the migration, and on every open after it, a background pass
  compares each take's folder on disk and its cloud copy with its plain-text
  name (D3), and renames what differs, the way `rename_take` does.
- **F2.** The pass shows in the background-work list with its progress, as
  "Putting names right", one entry for the whole pass. It does nothing, and
  shows nothing, when every name already matches.
- **F3.** It can be stopped at any point and started again. Each rename is
  one take, done and recorded before the next. A take whose files already
  match is skipped, so a second run picks up where the first stopped. A
  folder that took " (2)" because its name was taken counts as matching.
- **F4.** It does not run while a take is recording, a copy to the cloud is
  being made, or a take is being saved, cropped or recovered. It waits and
  runs after. A take open in the player is left for the next open.
- **F5.** A rename that fails (a file open elsewhere on Windows, a cloud
  folder that is not there) is left for the next open, and the
  background-work list says which take and why.

## Testing

Tests come before the code, and each is seen failing first.

- **Python, the migration** (`tests/test_store.py`). A 0001 database with
  awkward names is migrated and checked:
  - case variants across rehearsals → one song spelled as the latest;
  - Cyrillic case variants → one song;
  - "Take 4", "Recovered take 2" and an empty name → no song;
  - goes numbered across rehearsals in the order played: "Polyn", "Polyn 2"
    on one date and "Polyn" on a later one → 1, 2 and 3;
  - "Polyn" and "Polyn 3" with no "Polyn 2" → goes 1 and 2 (gaps close);
  - two takes named "Polyn" in one rehearsal → two goes;
  - "Song 2" with "Song" elsewhere in the library → a go at Song;
  - "Song 2" with no "Song" anywhere → read as a go at "Song" too (M5);
  - every marker, track file and cloud copy is still there;
  - the backup file is there, and a downgrade is refused as before.
- **Python, naming** (`tests/test_engine.py`): N1–N5 through `keep_take`,
  `set_next_take_name`, `rename_take`, `recover_draft`, `song_choices` and
  `session_state`. This includes the next go after yesterday's, a new title
  ending in a number, a number typed out of habit, and folders named
  `NN - Title G`.
- **Python, the pass:**
  - `01 - Polyn` becomes `01 - Polyn 1`, `03 - Polyn 2` of a later
    rehearsal becomes `03 - Polyn 4`, and `03 - polyn 2` becomes
    `03 - Polyn 2`, on disk and in the cloud folder, the last a case-only
    rename on a case-insensitive disk;
  - a second run renames nothing;
  - a failure on one take leaves the others done;
  - a " (2)" folder is left alone, and a take open in the player is left for
    later.
- **Playwright** (`ui/e2e/`):
  - the field shows the title, with the go beside it that follows typing (a
    song's next go across the library, 1 for a new title, none for "Take
    N");
  - a pill puts only the title in the field;
  - the strip, History's rows and the recording screen show the title with
    its go, from 1.
- **Everything that exists.** The other Python and Playwright tests describe
  naming and grouping today. Where one has to change for D2 or D3 (a name
  read as "Polyn 1", a pill sending a title), the reason goes in the commit.
  The fake bridge (`ui/e2e/fake-bridge.js`) gains `song` and `go` on its
  takes, and `go` on its choices.

## Docs

- `docs/design-notes.md`: "Songs are still not stored" is replaced with why
  they now are, why the go is a number of its own, counted across the
  library and stored, and why `take` is altered in place.
- `docs/development.md`: batch mode is not for `take` or `rehearsal`.
- `docs/using-it.md`: "Names and songs", rewritten for a title with the go
  beside it; an unnamed recovered take is "Take N".
- `CHANGELOG.md`: the go beside the title, and the names put right on first
  open.

## Steps

Each commit leaves the app working.

1. The schema, migration 0002 and the importer (M1–M5), with the library
   reading `song` and `go`, and Python building `songs`, `runs` and the rest
   from them. `name` becomes D3's plain text ("Polyn 1"), which the interface
   shows as it is until step 3.
2. Naming through songs: N1–N5 in `keep_take`, `set_next_take_name`,
   `rename_take`, `recover_draft`, `song_choices` and `session_state`, with
   folders named after D3.
3. The interface: I1–I5.
4. The pass that brings files into line (F1–F5).

## Not part of this

- ★, the one best take of a song: the next step, with its own migration.
- A song's page, songs on History's list, and the rest of #12's steps.
- Renaming or merging a song across every rehearsal.
- A new layout for the cloud folder: a later step. This one keeps today's
  layout and only brings names into line within it.
