# Marks across the library: every mark with a label, from every rehearsal

The thing most easily lost from a rehearsal is not a take of a song. It is a
moment: a riff somebody played once, in a jam or between two songs, that
everyone liked and somebody marked.

- **A mark is found only through its take.** Open the rehearsal, find the
  take, read its notes. A riff marked in a jam three weeks ago is found only
  by whoever remembers the evening.
- **Nothing collects marks across rehearsals.**
  - [A song's page](2026-10-02-song-page-design.md) shows a song's goes with
    their notes. A mark on a jam belongs to no song.
  - "Everything we marked *Went wrong* this month" crosses every song.

This adds a third view to History, *Marks*: pick a label, and see every mark
with it, newest first, each played from its spot. It works the same for
every label, since no label means anything to the code
([labels](2026-10-04-labels-design.md), D1). A band that marks riffs *Idea*
gets a shelf of ideas, *Went wrong* gives a list of what does not work yet,
and *Solo* every solo. It stands on labels and on a song's page, which
gives History its switch.

## Decisions

- **D1. One view, for any label.** It lists whichever label is picked, and
  is the same for all of them.
- **D2. A mark is found where it is.** The list plays its take and opens it.
  Nothing is copied or cut out.
- **D3. Newest first, grouped by rehearsal.** The latest marks are the ones
  most often wanted, and a rehearsal is how the band remembers them
  ("Tuesday's").
- **D4. Takes with no song stay in the Songs view,** as its last row (the
  song page's H3). Making a song of a jam is renaming its take, as anywhere
  else.

## History: *Rehearsals | Songs | Marks*

- **H1. The switch gains *Marks*.** History opens on the view used last, as
  the song page has it.
- **H2. Left: the labels,** in their order, each with its dot and how many
  marks have it: "Idea · 14".
  - A label with no marks is listed, dimmed: "no marks yet".
  - ↑ and ↓ go through them, as they go through rehearsals.
- **H3. Right: the chosen label's marks,** D3's order.
  - A heading per rehearsal: its name and date, which opens that rehearsal
    in the Rehearsals view.
  - Under it, a row per mark:
    - ▶ plays the take from 5 seconds before the mark, in place
      (`useTakeStripPlayer` with `byFiles`, as `LastTime` does);
    - the comment, or the label's name when there is none;
    - the take's name and the moment: "Polyn 3 · 2:47";
    - a click opens the take in the full-window player at that spot, with
      its rehearsal's take strip. Escape comes back here, scrolled where it
      was;
    - the song's title opens its page, as song titles do everywhere (the
      song page's O1).
- **H4. The label chosen is kept** when switching views and back, as the
  rehearsal and the song are.
- **H5. A change made in the player shows on coming back:** a mark edited,
  given another label, moved by a crop, or deleted.

## Python

- **A1.** `list_marks(label_id)`:
  - every mark with that label as `{folder, rehearsal, created_at, take,
    at, note}`, D3's order: the rehearsal's date, then the take's place in
    the evening, then the moment;
  - `take` is the same take dict the rehearsal overview gets;
  - only rehearsals on disk: a mark whose take cannot be played is no use
    here;
  - one query, no files read.
- **A2.** H2's counts are `list_labels()`'s (labels, A1).
- **A3. Measure before deciding on paging.** Build a library of 300
  rehearsals × 20 takes × 5 marks, and time A1. Paging is added only if A1
  for the biggest label takes more than 100 ms.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - A1's order and fields;
  - marks on a song's take and on a jam, both listed;
  - a rehearsal not on disk left out;
  - a mark listed under its new label after its old one was deleted with
    its marks moved.
- **Playwright:**
  - the switch with three views, and History opening on the one used last;
  - the labels with their counts, and one with no marks dimmed;
  - a label's marks newest first, grouped by rehearsal;
  - ▶ playing from 5 s before the mark;
  - a click opening the player at the spot, and Escape back to the same
    place;
  - a mark with no comment shown by its label's name.

## Docs

- `docs/using-it.md`: History's *Marks* view.
- `CHANGELOG.md`.

## Not part of this

- Marks of several labels at once, or searching comments by typing.
- Cutting a marked moment out into a take of its own.
- Recognising riffs by their audio.
