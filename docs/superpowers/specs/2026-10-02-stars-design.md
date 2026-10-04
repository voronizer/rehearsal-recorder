# Stars: the goes worth coming back to, marked with one click

When somebody comes back for a song, they almost always want a good take:
the version the band settled on, or the one where it finally worked. Today
nothing says which takes those are.

- **"Keep" is any good mark, anywhere in a take.** A take with one *Keep
  this* marker on a lick is drawn green as a whole:
  - its bar in the rehearsal overview (`keep` in `TakeRow`,
    `ui/src/components/RehearsalOverview.tsx`);
  - its block in the evening strip (`keep` in `_runs_of`,
    `src/rehearsal_recorder/api.py`);
  - its bar in Last time's song rows (`SongRow`,
    `ui/src/components/LastTime.tsx`).

  A good passage and a good take look the same.
- **Last time plays the last go, not a good one.** A song's ▶ on the setup
  screen plays its last go (`last_time` in `api.py`; `SongRow` and the
  not-played rows in `LastTime.tsx`), even when an earlier go is the one
  marked to keep.
- **There is no one-click verdict on a whole take.** Marking one means:
  open it, press M, choose *Keep this* in the marker dialog, and save. That
  leaves a marker at a moment in the take, not a verdict on the take.

This adds **stars**: ★ on a take, put on and taken off with one click, on as
many takes as are worth coming back to. A song's ▶ plays its newest ★ go. It
stands on [songs in the store](2026-10-02-songs-in-the-store-design.md):
playing a song needs the song.

## Decisions

- **D1. ★ belongs to a take, and a song can have several.** Two goes can
  both be worth keeping: a slow one and a fast one, or one from before the
  arrangement changed and one from after. Starring a go changes no other
  go. Nothing puts ★ on or takes it off but a click on it.
- **D2. Any take can have ★, a jam included.** A good jam is worth finding
  again as much as a good go at a song.
- **D3. ★ is the whole-take verdict; markers stay about moments.** The green
  look, which today means "has a good mark somewhere", moves to ★. A take
  with good marks shows them as marks: dots on its bar, and lines in its
  notes. It is no longer drawn green and no longer labelled "keep".
- **D4. Wherever ▶ plays a song rather than a take, it plays the song's
  newest ★ go.** The band moves on, and the latest go they starred is the
  one that stands for the song now.
  - "Newest" is when it was played: the rehearsal's date, then its place in
    the evening. Not its go number, which a take renamed into the song gets
    afresh.
  - A song with no ★ plays its last go, as today.

## Schema (migration 0003)

| Table | Change |
|---|---|
| `take` | `starred` BOOLEAN NOT NULL DEFAULT 0. |

- **The column is added in place, with `ALTER TABLE take ADD COLUMN`,** as
  0002 changed `take`. Batch mode copies the table and drops the old one,
  and with foreign keys on, that DROP TABLE cascades away every take's
  markers, files and cloud copies (`docs/development.md`).
- **Nothing is filled in.** A take with a good mark is not starred: nobody
  starred it, and its marks stay where they are.

## Starring

- **P1. On every take row, a ★ button.**
  - **Where:** the rehearsal overview, a song's page (#12), and the player's
    take strip, as the pill's own ★.
  - **Look:** filled and always visible on a ★ take; an outline on the
    others, shown under the mouse as Rename and Delete are.
  - **Click:** puts ★ on, or takes it off, without asking. It touches that
    take alone.
- **P2. In the player, ★ beside the take's name,** the same toggle as P1.
- **P3. ★ stays with its take** through a rename (to another song, or to
  none), a crop, and *Putting names right*. A deleted take takes its ★ with
  it.

## Where ★ shows

- **S1. A ★ take's row and pill carry ★,** and its bar is the green one
  (D3). The "keep" label goes.
- **S2. In the evening strip** (`EveningStrip`, from `runs`), a ★ go's block
  is the green block. Each go in `runs` says `starred` instead of `keep`.
- **S3. Last time plays each song's newest ★ go** (D4), from whichever
  rehearsal it was played at.
  - When that is not last time's last go, the row says which go it is and
    when it was played: "★ Polyn 3 · 28 Sep".
  - The row's bars are green for ★ goes, and lit for the go ▶ plays when it
    is one of them.
  - The not-played rows work the same way: ▶ plays the song's newest ★ go,
    or, with none, the last go of the rehearsal the song was last played at.
- **S4. Song pills** (`SongPills`) show nothing of it. They name takes; they
  do not play.

## Python

- **A1.** `set_take_star(folder, take_number, starred)`:
  - puts ★ on the take, or takes it off;
  - `{"ok": True}`, or `{"ok": False, "error": …}` for a take that is not
    there.
- **A2.** Every take sent to the interface gains `starred: bool`.
  `runs[].takes[]` carries `starred` in place of `keep`.
- **A3.** In `last_time`, every song in `last.songs` and in `not_played`
  gains `plays`: `{folder, rehearsal, created_at, take}`, the go its ▶
  plays (D4). Only rehearsals on disk count, as for the rest of Last time.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - A1 putting ★ on and taking it off, on a jam, and on a take that is not
    there;
  - two ★ goes in one song, both kept;
  - ★ kept through a rename to another song and to "Take N", and through a
    crop; gone with a deleted take;
  - `plays`: the newest ★ go, one from an older rehearsal, and the last go
    when the song has no ★;
  - migration 0003 on a database at 0002, with every take's markers, files
    and cloud copies still there after it.
- **Playwright:**
  - ★ on a row put on and taken off;
  - two ★ goes in one song;
  - ★ on a jam's row;
  - ★ on a pill in the player, and beside the take's name;
  - Last time's ▶ playing the newest ★ go, with "★ Polyn 3 · 28 Sep";
  - a take with only a good mark not drawn green.
- **Updated:** the e2e tests that today read "keep" off a good mark. They
  change with D3, and say so.

## Docs

- `docs/using-it.md`:
  - ★ and what it does wherever it shows;
  - *Keep this* marks now being about a moment.
- `CHANGELOG.md`.

## Not part of this

- ★ in the cloud folder's file names, or a "best" folder: the cloud step.
- Playing every song's ★ in a row (the "best of" list) was turned down.
- A ★ toggle on the review screen, beside Save take. Right after saving,
  the take is in the overview, one click from ★; and whether a go was a
  good one is usually known after the next go, not while saving this one.
- Marks named and coloured by the band:
  [labels](2026-10-04-labels-design.md), next. With the whole-take verdict
  on ★, *Keep this* becomes one label among others.
