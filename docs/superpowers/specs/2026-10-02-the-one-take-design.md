# The one: a song's best take, picked with one click

When somebody comes back for a song, they almost always want *the* take: the
version the band settled on. Today nothing says which one that is.

- **"Keep" is any good mark, anywhere in a take.** A take with one *Keep
  this* marker on a lick is drawn green as a whole:
  - its bar in the rehearsal overview (`keep` in `TakeRow`,
    `ui/src/components/RehearsalOverview.tsx`);
  - its block in the evening strip (`keep` in `_runs_of`,
    `src/rehearsal_recorder/api.py`).

  A good passage and a good take look the same.
- **Last time plays the last go, not the best.** A song's ▶ on the setup
  screen plays `goes[-1]` (`last_time` in `api.py`; `SongRow` and the
  not-played rows in `ui/src/components/LastTime.tsx`), even when an earlier
  go is the one marked to keep.
- **There is no one-click verdict on a whole take.** Marking one means:
  open it, press M, choose *Keep this* in the marker dialog, and save. That
  leaves a marker at a moment in the take, not a verdict on the take.

This adds **the one**: at most one take per song, across every rehearsal,
picked with one click and shown as ★. It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md): the one
belongs to a song.

## Decisions

- **D1. One per song, across all rehearsals.** Picking another take of the
  song moves ★ to it. There is one current best Polyn, not one per evening.
- **D2. Only a take with a song can be the one.** A jam has no song to be
  the best take of.
- **D3. ★ is the whole-take verdict; markers stay about moments.** The green
  look, which today means "has a good mark somewhere", moves to the one. A
  take with good marks shows them as marks: dots on its bar, and lines in
  its notes. It is no longer drawn green and no longer labelled "keep".
- **D4. Wherever ▶ plays a song rather than a take, it plays the one.** A
  song with no one plays its last go, as today.

## Schema (migration 0003)

| Table | Change |
|---|---|
| `song` | `best_take_id` → `take` ON DELETE SET NULL, nullable. |

Nothing is filled in by the migration. A take with a good mark is not made
the one: nobody chose it as such, and the marks stay where they are.

## Picking the one

- **P1. On every take row of a song, a ★ button.**
  - **Where:** the rehearsal overview, a song's page (#12), and the player's
    take strip, as the pill's own ★.
  - **Look:** filled and always visible on the one; an outline on the other
    rows, shown under the mouse as Rename and Delete are. A row with no song
    has none.
  - **Click:** on another take, it moves ★ there, without asking: ★ is easy
    to move back. On the one, it takes ★ away.
- **P2. On the review screen, a ★ toggle beside Save take**, "The one". Off
  by default. Saving with it on makes the take its song's one. It is shown
  only while the name field names a song, not "Take N".
- **P3. In the player, ★ beside the take's name**, the same toggle as P1.
- **P4.** Renaming a take to another song takes ★ from it if it was its old
  song's one. Deleting the one leaves its song with none.

## Where the one shows

- **S1. Its row and its pill carry ★**, and its bar is the green one (D3).
- **S2. In the evening strip** (`EveningStrip`, from `runs`), the one's
  block is the green block. Each go in `runs` says `best` instead of `keep`.
- **S3. Last time** plays the one (D4). The row says which go it is and when
  it was played, when it is not the last go of last time: "★ Polyn 3 ·
  28 Sep".
- **S4. Song pills** (`SongPills`) show nothing of it. They name takes; they
  do not play.

## Python

- **A1.** `set_best_take(folder, take_number, best)`:
  - with `best` true, makes the take its song's one;
  - with `best` false, takes it away if it is the one;
  - `{"ok": False, "error": …}` for a take with no song.
- **A2.** `keep_take(…, best=False)` saves with P2's toggle.
- **A3.** Every take sent to the interface gains `best: bool`. `runs[].takes[]`
  carries `best` in place of `keep`. `last_time`'s `take` for a song is its
  one, or its last go.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - A1's three cases;
  - moving ★ between rehearsals;
  - P4 on rename and on delete;
  - `last_time` playing the one, and the last go without one;
  - migration 0003 on a database at 0002.
- **Playwright:**
  - ★ on a row moves from one go to another;
  - ★ shows on the one's pill in the player;
  - the review screen's toggle saves the one;
  - Last time's ▶ plays the one;
  - a take with only a good mark is not drawn green.
- **Updated:** the e2e tests that today read "keep" off a good mark. They
  change with D3, and say so.

## Docs

- `docs/using-it.md`:
  - ★ and what it does wherever it shows;
  - *Keep this* marks now being about a moment.
- `CHANGELOG.md`.

## Not part of this

- ★ in the cloud folder's file names or a "best" folder: the cloud step.
- Playing every song's one in a row (the "best of" list) was turned down.
