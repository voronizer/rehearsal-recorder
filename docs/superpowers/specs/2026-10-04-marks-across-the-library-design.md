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

Alex settled the design on 2026-10-08 in the thread "Задачи из обсуждения
#12", on the mockup https://claude.ai/artifact/NLduPwfdjF9NKzbBCFBN7e (its
screenshots are in the project's files, `issue12/step9/mockup/`), and where
it shows on reha.stream on https://claude.ai/artifact/AigUuiwEuxkwkXBbaKSmyB
(`issue12/step9/site/`) and https://claude.ai/artifact/Thti1fesgMHJe4RqSaaMLM
(`issue12/step9/site/copy/`).

## Decisions

- **D1. One view, for any label.** It lists whichever label is picked, and
  is the same for all of them.
- **D2. A mark is found where it is.** The list plays its take and opens it.
  Nothing is copied or cut out.
- **D3. Newest first, grouped as the band chooses** (Alex, 07:48Z: "а можно
  сделать переключатель группировки?"). By rehearsal, by song, or as one
  list, picked on the screen. By rehearsal comes first: a rehearsal is how
  the band remembers a mark ("Tuesday's"). The choice is kept like
  History's view, and is one for every label.
- **D4. Takes with no song stay in the Songs view,** as its last row (the
  song page's H3). Making a song of a jam is renaming its take, as anywhere
  else.
- **D5. Only labels on the left** (Alex, 07:44Z). No "All marks": a mark is
  looked for by what it says, and every label's list already crosses every
  rehearsal.
- **D6. A rehearsal not on disk keeps its marks in the list, greyed,** as a
  song's page keeps its goes: they are counted on the left, and cannot be
  played or opened until the drive is back.

## History: *Rehearsals | Songs | Marks*

- **H1. The switch gains *Marks*.** History opens on the view used last, as
  it does for Songs.
- **H2. Left: the labels,** in their order.
  - Each: its dot, its name, how many marks have it on the right, and under
    it in grey "3 rehearsals · last 22 Sep".
  - A label with no marks is listed, dimmed, with "no marks yet" under it
    and no count.
  - ↑ and ↓ go through them, as they go through rehearsals.
- **H3. Right: the chosen label's head.**
  - Its dot, its name large, and under it "5 marks in 3 rehearsals · last
    22 Sep".
  - Right of the name (Alex, 07:51Z): "Group by" and the three choices,
    *By rehearsal*, *By song*, *One list*, drawn as History's own switch.
    Off for a label with no marks.
  - A label with no marks says instead of a list: "Marks given the label
    Solo in the player gather here, from every rehearsal."
- **H4. The marks, newest first** (the newest rehearsal first; in one, the
  order played, then the moment), grouped as H3's switch says:
  - **By rehearsal:** a heading per rehearsal, "Tuesday jam · Tue 22 Sep
    · 3 marks", which opens that rehearsal in the Rehearsals view.
  - **By song:** a heading per song, "Pałyn · 2 marks", in the order of
    each song's newest mark, takes with no song last as "Not named". The
    heading opens the song's page.
  - **One list:** no headings.
- **H5. A row per mark** (Alex, 07:54Z: two lines and a bar):
  - ▶ plays the take from 5 seconds before the mark, in place, and again
    pauses it. The take's bar shows where it has got to.
  - First line: the comment, or the label's name when there is none.
  - Second line: the take's name and the moment, "Pałyn 4 · 1:51", the
    song's title a link to its page, as song titles are everywhere (the
    song page's O1). By song, the heading has the song, so the line gives
    the take and the rehearsal instead: "Pałyn 4 · 1:51 · Tuesday jam,
    22 Sep". In one list the rehearsal is added after the song's take.
  - On the right: the take as a bar, every bar of the list to one scale
    (the label's longest take), the mark a tick on it in the label's
    colour, then the take's length.
  - A click on the row opens the take in the full-window player at the
    mark, with its rehearsal's take strip. Escape comes back here,
    scrolled where it was.
- **H6. Long and many** (shown in the mockup's "Много и длинное"):
  - the list scrolls with its head, as a song's page does;
  - a long comment, take name or heading is cut with «…», and the whole
    comment shows on hover;
  - a long label name is cut in the head and on the left.
- **H7. What is kept.** The label chosen, when switching views and back, as
  the rehearsal and the song are. The grouping, across restarts (D3).
- **H8. A change made in the player shows on coming back:** a mark edited,
  given another label, moved by a crop, or deleted.

## Python

- **A1.** `list_marks(label_id)`:
  - `{"ok", "marks": [{folder, rehearsal, created_at, missing, take, at,
    note}]}`, H4's order;
  - `take` is the same take dict a song's goes have;
  - `missing` as `goes_of` has it (D6), each folder looked at once;
  - the takes read as `goes_of` reads them, so the number of queries does
    not grow with the marks, and no audio file is opened;
  - a label that is not there is `{"ok": False, "error": "Label not
    found"}`.
- **A2.** `list_labels()` adds to each label `rehearsals` (how many
  rehearsals have a mark with it) and `last_marked` (the newest of those
  rehearsals' dates, or None), for H2. Same query, two more aggregates.
- **A3. Measure before deciding on paging.** Build a library of 300
  rehearsals × 20 takes × 5 marks, and time A1. Paging is added only if A1
  for the biggest label takes more than 100 ms.
- **A4.** `save_history_view` takes "marks" too, and
  `save_marks_grouping(grouping)` keeps "rehearsal", "song" or "list";
  `get_settings()` gives `marks_grouping`, "rehearsal" when unset.

## reha.stream

The story keeps its five steps (Alex cut it to five on 2026-10-07). Step
4, **Find it later**, opens History on Marks at *Went wrong*, then a click
on Pałyn in one of its marks goes to the song's page, where step 5,
**Compare goes**, starts as now.

Every step is told more fully, along with the app beside it (Alex, 08:19Z:
"мне кажется там текста мало слева (да и в остальных шагах тоже)"; at
08:26Z he chose the variant told "по ходу кадра"):

- **S1. A step is its title, a line on what it is for, and three numbered
  lines,** one for each thing the app beside it does, in the order it does
  them.
- **S2. The line the app is on is lit,** in full colour on a tile; the
  others stay grey. A line is lit when the app gets to it and stays lit
  until the next one. Only the step on screen has a lit line, and only once
  the app has got to it: after a jump, nothing is lit until the app catches
  up.
- **S3. Compare goes** ends with ↓, to the next go, so its third line has
  something to show.
- **S4. The words:**

| Step | Line | 1 | 2 | 3 |
|---|---|---|---|---|
| Set up the tracks. | One track per musician, filled in from last time. | Name the rehearsal, or keep the date. | A track per musician: a name, an icon, the input it comes in on. | Check signal: everyone plays, and each bar moves for its own player. |
| Hear last week, then record. | Hear how the song went last week, then play it. | Pick Pałyn under Next take. | Its best go from last week plays right beside it. | Record: the take's name over a big clock, and a tile per track that turns red when it clips. |
| Keep the good ones. | Stop, listen, keep it. The evening sorts itself while everyone remembers. | Stop, and the take opens to listen to. Save it. | A take nobody named: one click on Sonca names it. | False starts are grey, and Send starred puts the ★ takes in the band's folder. |
| Find it later. | Every rehearsal, every mark and every song, in History. | History opens on the newest rehearsal. | Marks: every Went wrong, from every rehearsal. ▶ plays from just before it. | A click on Pałyn: its page, every go at it, one line an evening. |
| Compare goes. | Loop the bridge, then hear it in the next go. | Open Pałyn 5 and loop its bridge. | Step to Pałyn 6: it starts at the same bar, still looping. | ↑ and ↓ do the same, through every rehearsal. |

The demo band has six marks in History, three of them Went wrong on one
evening. It gets a few more on the earlier evenings, on its four labels, so
the view has something to show; Settings › Marks still shows the four a
library starts with.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - A1's order and fields;
  - marks on a song's take and on a jam, both listed;
  - a rehearsal not on disk listed as missing;
  - a mark listed under its new label after its old one was deleted with
    its marks moved;
  - A2's two new fields, and a label with no marks;
  - A4's grouping kept, refused when unknown, and its default.
- **Playwright:**
  - the switch with three views, and History opening on the one used last;
  - the labels with their counts and rehearsals, and one with no marks
    dimmed;
  - a label's marks newest first, under a heading per rehearsal;
  - By song and One list, and the choice kept after History is opened
    again;
  - ▶ playing from 5 s before the mark, and pausing;
  - a click opening the player at the spot, and Escape back to the same
    place;
  - a mark with no comment shown by its label's name;
  - a missing rehearsal's mark greyed, with nothing to play.
- **Site:**
  - step 4 shows Marks, then Pałyn's page; step 5 still compares;
  - every step has its line and three lines;
  - the app tells the page each line as it gets to it, in order, step by
    step;
  - the page lights that line in the step on screen, and none elsewhere.

## Docs

- `docs/using-it.md`: History's *Marks* view, with its picture.
- `CHANGELOG.md`.
- The History pictures taken again, as the band has more marks.

## Not part of this

- Marks of several labels at once, or searching comments by typing.
- Cutting a marked moment out into a take of its own.
- Recognising riffs by their audio.
