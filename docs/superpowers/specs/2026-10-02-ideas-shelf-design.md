# The ideas shelf: riffs and jams that are not a song yet

The thing most easily lost from a rehearsal is not a take of a song. It is a
riff somebody played once, between songs or in a jam, that everyone liked
and nobody wrote down.

- **Such a take is "Take 4".** It belongs to no song, so it is under *Not
  named* in its rehearsal's overview and nowhere else. To find it a month
  later, you have to know which evening it was.
- **A marker can say "this bit"**, but the four kinds are about how a take
  went: *Note*, *Keep this*, *Went wrong*, *Do again*
  (`MARKER_KINDS` in `src/rehearsal_recorder/store/library.py` and
  `ui/src/lib/markers.ts`). A good riff inside a song's take, marked *Keep
  this*, reads as praise for the take.
- **Nothing collects marks across rehearsals.**

This adds a fifth kind of marker, *Idea*, and a place that gathers every
idea and every take that is not a song yet. From there, an idea becomes a
song with the naming that already exists. It stands on
[songs in the store](2026-10-02-songs-in-the-store-design.md) and
[a song's page](2026-10-02-song-page-design.md).

## Decisions

- **D1. An idea is a marker kind, not a new kind of take.** It is dropped
  at a moment, with or without a note, on any take: a jam, or a song's take
  with a lick worth keeping. Nothing about takes changes.
- **D2. The shelf is History's last entry in the Songs view.** It replaces
  *Takes with no song* (the song page's H3), so there is one place for
  everything not yet a song, rather than two.
- **D3. Making a song of an idea is naming its take**: the Rename dialog,
  where an existing song is a click and a new title is typed. A new title
  is the one place typing is expected; there is nothing to pick it from.

## The marker

- **M1. *Idea*, a fifth kind,** in the marker dialog (`MarkerDialog.tsx`)
  and wherever kinds are listed. Its colour is distinct from the other
  four, and it has a lightbulb, in `ui/src/lib/markers.ts`. It needs no
  migration: a marker's kind is already a string, and `as_marker` accepts
  it once it is in `MARKER_KINDS`.
- **M2. Like the others,** it shows as a dot on the bars and in the player,
  and as a line in the overview's notes.

## The shelf

- **S1. The last entry in History's Songs view is *Ideas and jams*.** It
  counts the ideas and the takes with no song: "14 ideas · 9 takes with no
  song".
- **S2. Its page has two parts.**
  1. **Ideas**, newest first:
     - every *Idea* marker in the library, on any take;
     - each row shows the note (or "Idea"), the take's name, its
       rehearsal's date, and the moment;
     - ▶ plays from 5 seconds before the moment, in place;
     - a click opens the take in the player at that spot.
  2. **Takes with no song**, by rehearsal, newest first. These are the
     overview's rows, so ▶ plays in place, a click opens the player, and
     Rename gives the take a song (D3). A take with an *Idea* marker is in
     both parts.
- **S3. Naming a take with no song after a new song** moves it out of the
  shelf and into that song's page as its go that evening. Its ideas stay
  in *Ideas*, which lists markers wherever they are.

## Python

- **A1.** `MARKER_KINDS` gains `"idea"`.
- **A2.** `list_ideas()`:
  - every idea marker as `{folder, rehearsal, created_at, take, at, note}`,
    newest first;
  - one query.
- **A3.** `list_songs()` (the song page's A1) gains a last entry for the
  shelf with its two counts. `get_song(None)` is the takes with no song, as
  the song page already defines it.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - an idea marker round-trips through `add_take_marker` and the library;
  - A2's order and fields;
  - an unknown kind still falls back to *Note*.
- **Playwright:**
  - *Idea* in the marker dialog;
  - the shelf listing ideas from a song's take and from a jam;
  - ▶ on an idea playing from 5 s before;
  - a take with no song renamed to an existing song leaving the shelf and
    appearing on that song's page.

## Docs

- `docs/using-it.md`: markers, and the shelf.
- `CHANGELOG.md`.

## Not part of this

- Cutting an idea out into a take of its own.
- Recognising riffs by their audio.
