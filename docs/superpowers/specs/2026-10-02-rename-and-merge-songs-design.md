# Renaming and merging songs, across every rehearsal

Spellings drift: Polyn, Polin, Полынь. So do titles: a working title becomes
the real one.

- **Fixing a spelling is one rename per take today** (`rename_take` in
  `src/rehearsal_recorder/api.py`): open each rehearsal, find each go, and
  rename it in a dialog. Ten rehearsals with three goes each is thirty
  dialogs.
- **Two spellings are two songs.** Grouping is case-blind but no more, so
  "Polin" and "Polyn" each get their own row in Last time, their own pills,
  and later their own page and their own newest ★ go.

With songs stored, a song's title is one row, and its takes point at it.
This renames a song, or merges it into another, from its page. Every take's
folder on disk and its copy in the cloud follow, as was decided: renamed
everywhere. It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md),
[stars](2026-10-02-stars-design.md) and
[a song's page](2026-10-02-song-page-design.md).

## Decisions

- **D1. Renaming is changing the song's title; merging is pointing its
  takes at another song.** Both are one change in the database. The files
  then follow through the pass that already brings names into line (songs
  in the store, F1–F5), which renames what does not match, can stop and
  start again, and shows in the background-work list.
- **D2. One dialog does both.** It has the title field, and the other songs
  as pills under it. Typing a title no song has renames. Picking or typing
  another song's title merges, after saying what will happen.
- **D3. The goes merged in are numbered after the song's own, in the order
  they were played.** Go numbers run across the library and are given once
  (songs in the store, D4–D5), so Polyn's goes keep theirs. Polyn 1–10 and
  Polin 1–3 become Polyn 1–13, Polin 1 being Polyn 11. Without new numbers
  two takes would carry the same name.
- **D4. ★ after a merge.** Stars belong to takes (stars, D1), so a merge
  moves none: every ★ go of both songs keeps its ★. The merged song's ▶
  plays the newest of them, whichever song it was played as.
- **D5. A merge cannot be undone as one step.** It asks first, saying how
  many goes in how many rehearsals will be renamed. Splitting a song back is
  renaming takes one by one, as today.

## The dialog

- **R1. On a song's page, a pencil beside the title** opens *Rename song*:
  - the title field (the take name field's compact size, with ✕ putting
    back the current title);
  - the other songs as pills under it, with *All songs…*.
- **R2. Typing a title that no other song has, then Rename,** renames the
  song.
  - The page shows the new title at once.
  - The background-work list shows "Renaming Polin to Polyn · 12 takes"
    while the files follow.
- **R3. A pill clicked, or another song's title typed,** turns the button
  into *Merge…*. It asks first: "Merge Polin into Polyn? 12 goes in 5
  rehearsals become Polyn 11–22, and their folders and cloud copies are
  renamed." Confirmed, the page becomes Polyn's.
- **R4. A title that differs only in case** ("polyn" for "Polyn") is a
  rename of the same song: it respells it.

## Python

- **A1.** `rename_song(song_id, title)`:
  - returns `{"ok": False, "error": …}` when the title is another song's
    (case-blind); merging is A2;
  - otherwise sets the title, then starts the pass for the song's takes.
- **A2.** `merge_songs(from_id, into_id)`:
  - points `from_id`'s takes at `into_id` and numbers them per D3, in one
    transaction;
  - deletes `from_id`, then starts the pass for the takes whose names
    changed; ★ stays on its takes (D4);
  - returns the counts R3 quotes; a dry run, `merge_songs(…, dry_run=True)`,
    returns them without changing anything, for the question.
- **A3.** The pass takes a set of takes to look at, not only "everything on
  open", so a rename does not walk the whole library. Renaming a single
  take moves its files itself, as `rename_take` does now.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - A1, including a case-only respelling and a clash refused;
  - A2 numbering the moved goes after the song's own, in the order played,
    with the song's own goes unchanged;
  - D4: the ★ goes of both songs still starred after a merge, and the
    merged song's ▶ playing the newest of them;
  - the dry run's counts;
  - the pass renaming folders and cloud copies afterwards, and a second run
    renaming nothing.
- **Playwright:**
  - the pencil and the dialog;
  - typing a new title renaming;
  - a pill turning Rename into Merge…, with the question naming the counts;
  - after a merge, the page is the target song's, with every go;
  - the background-work entry.

## Docs

- `docs/using-it.md`: under "Names and songs".
- `CHANGELOG.md`.

## Not part of this

- Merging several songs at once, or finding likely duplicates (Polyn /
  Polin) automatically.
- Splitting a song.
