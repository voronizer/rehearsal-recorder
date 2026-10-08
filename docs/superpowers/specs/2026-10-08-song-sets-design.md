# Song sets: the songs a rehearsal goes through, in order

A band getting ready for a gig rehearses the same songs in the same order,
evening after evening. Today the app does not know that.

- **Every take is named by hand, or after the take before it**
  (`_next_take` in `src/rehearsal_recorder/api.py`): the next song is a pill
  under the Next take field, found among all the others.
- **Nothing says what is left.** The pills say what has been played tonight,
  not what was meant to be, and History says the same afterwards.
- **The rehearsal screen's panel is crowded:** the field, two rows of pills
  and *Before tonight* under them. The screen after a take is the same: a
  field and its pills take half its footer, to say a name nobody needs to
  change most of the time.

This lets the band keep sets: a name and songs in an order, made once in
Settings or from the start screen, and picked beside Start rehearsal. The
evening then goes through the set on the rehearsal screen, ↑ and ↓ moving
from song to song, and History says which of its songs were played and
which were not. The pills under the Next take field give way to a list of
the band's songs, set or no set, and *Before tonight* goes. The screen after
a take says the song, its goes tonight and how long this one ran, with a
pencil to rename it.

It stands on [songs in the store](2026-10-02-songs-in-the-store-design.md)
and [renaming and merging songs](2026-10-02-rename-and-merge-songs-design.md).
It replaces [a plan for the evening](2026-10-02-plan-for-the-evening-design.md),
put off on 7 Oct 2026 (a plan made for one evening only), and takes back
the *Before tonight* card of [last time while rehearsing](2026-10-02-last-time-while-rehearsing-design.md),
which was never released.

## Decisions

Alex chose each of these on 8 Oct 2026, most from a mockup of the real app.

- **D1. A set is a name and songs in an order, kept in the library.** No
  lengths, notes or statuses. It is made and changed in Settings › Sets
  («менеджить сеты - в настройках», 19:06Z), and made from the start screen
  too.
- **D2. Picked beside Start rehearsal** (C, 19:29Z). *No set* plays freely,
  exactly as today.
- **D3. A take stays its song until the band moves on** (A, 19:19Z). The
  band plays a song several times in a row; nothing moves on by itself.
  Any song of the set, back or ahead, is one click on its row (19:20Z, «а к
  предыдущей как?»), or ↓ and ↑ (D12). There is no *Next song* button
  (20:30Z, «кнопка next song наверное лишняя если у нас стрелки песню
  выбирают»).
- **D4. Settings › Sets: the sets down the left, the chosen one beside
  them, saved as it is changed** (A, 19:38Z), as the rest of Settings is.
- **D5. History: the set's name, and a card of what was played and what was
  not** (B, 19:45Z), over the rehearsal's songs.
- **D6. On reha.stream, a tile of its own** in *Built for the room* (A,
  19:53Z).
- **D7. A rehearsal keeps its own copy of its set,** as it was when the
  rehearsal started. Changing or deleting the set later changes nothing in
  History: the card says what that evening was meant to be.
- **D8. A set's songs are titles, resolved as any typed name is.** A song
  renamed or merged away is still found through its old name, so a set
  shows its songs under their current titles. A title no song has yet is a
  song not played yet, which a set may hold: a new song for the gig. Its
  first take makes it a song, as typing it does today.
- **D9. A song is in a set once.** Set names are unique, case-blind, as
  labels are.
- **D10. Songs outside the set are one click away,** in a list under the
  set, or typed; they do not join the set («сет - это заготовленный список
  песен, но мы можем выбрать и другую», 19:59Z).
- **D11. The rehearsal screen lists the songs instead of the pills**
  («пилюли под названием песни немного redundant… а мы можем от них
  отказаться?», 19:57Z): under the set the songs outside it, with no set
  every song, in rows like the set's. Five show, the rest are one click
  more (B, 20:12Z).
- **D12. ↑ and ↓ pick the next take's song** (20:17Z, «нужно чтобы
  клавишами "вверх/вниз" выбиралась песня»), through the rows as they
  stand: the set, then the other songs. While a take is open in the player
  they stay the strip's, as today.
- **D13. A click into the Next take field selects the name whole** (20:27Z,
  «Выделять»), so typing replaces it; a second click places the caret.
- **D14. ↑ ↓ are told by two small keys at the right of the *Next take*
  label** (A, 20:28Z), gone while a take is open.
- **D15. *Before tonight* goes** (20:29Z, «блок "before tonight" видимо
  можно убрать»), with its code, tests, docs and changelog line. It was
  never released. The recording screen's "Took 3:20 on 22 Sep" stays.
- **D16. The screen after a take: the song with a pencil, its goes tonight
  as bars, and how long this one ran against the last** (C, 20:51Z; «левая
  часть с переименованием слишком грузная», 20:37Z).
- **D17. reha.stream's second story step keeps its title,** *Hear last
  week, then record*: last week is heard with ▶ on the start screen, and ↓
  picks the song (C, 20:53Z).

## The start screen

- **S1. A button left of Start rehearsal,** the same height: the set's
  name, or *No set*, with a chevron. It opens a menu over it:
  - *No set: play freely*;
  - each set, with "6 songs";
  - *New set…*.

  The one chosen has ✓. A long name is cut with "…" and shown whole on
  hover; with more sets than fit, the menu scrolls.
- **S2. The choice is kept** until another is made, across restarts (in
  `config.json`, as `next_set`). A band rehearses for a gig over several
  evenings; the button says what Start will do, beside it. A set deleted in
  the meantime is *No set*.
- **S3. *New set…*** opens a small window, so the start screen is not left:
  - *Name*;
  - *Songs, in the order you play them*: the songs picked so far, numbered,
    each dragged by its handle (`SortableList`, as labels are) and with ✕;
  - under them, *Add*: the band's other songs as pills, and *Another
    song…*, a field for a song not played yet;
  - *Cancel* and *Create set*, which needs a name and a song.

  Created, the set is chosen.
- **S4. Starting** sends the chosen set with the rest (Y4).

## The rehearsal screen

The panel on the right holds the Next take field, then the set, then the
other songs. Nothing else.

- **R1. The set as a card under the Next take field:** "Gig on the 25th —
  2 of 6 played", then its songs in order, numbered.
  - The song the field names is lit.
  - The row after it says *next*. When the field names a song outside the
    set, *next* is on the set's first song not played yet.
  - Each song played tonight has ✓ and "4 goes".
- **R2. A click on any row** names the next take after that song, as a
  pill does today. Rows do not move: played or not, each stays in its
  place.
- **R3. The evening's first take is the set's first song,** and ✕ in the
  field puts it back. After that the name follows the take before it, as
  today (D3).
- **R4. Under the set, *Other songs*:** the band's songs outside it, in
  place of the pills (D11). With no set, the same list is *Songs*, right
  under the field, with every song.
  - Rows as the set's: a song played tonight has ✓ and "2 goes", the song
    the field names is lit, and a click names the next take after it.
    There are no numbers, but the names line up with the set's.
  - Tonight's songs first, then the other rehearsals' songs, the latest
    played first: the order the pills have today.
- **R5. Five rows show.** With more than six songs, *All 18 songs* under
  them opens the rest in place, and *Fewer* folds them back; the list stays
  as it was left for the rest of the evening. The song the field names is
  shown even when it is not among the five, after them.
- **R6. Typing in the field narrows the list** over all its songs, not only
  the five, as the pills narrow today. An old name typed shows the song it
  is now, alone and lit. With nothing matching: "No song has “Novaja” in
  it. The take makes it a new one." While the field has focus the list
  keeps its height, so nothing under it moves.
- **R7. A long set** makes the card as tall as it needs; the panel scrolls.
  The card's height does not change during the evening. A row picked by a
  key is scrolled into view.
- **R8. The other name fields keep their pills:** Rename take, Rename song
  and *Name:* in History. *All songs…* stays only there.

## Keys on the rehearsal screen

- **K1. With no take open, ↓ and ↑ name the next take after the row below
  or above the lit one,** in the order the rows stand: the set's songs,
  then the other songs. Going past the fifth other song opens the folded
  rest (R5). Past either end nothing happens. With the field naming no row
  (a new song typed, or "Take 7"), ↓ goes to the first row and ↑ does
  nothing.
- **K2. With a take open, ↑ and ↓ are the strip's,** stepping through the
  takes as they do today.
- **K3. While typing in the field, ↑ and ↓ move a highlight through the
  rows the typing left,** and Enter names the next take after the
  highlighted one and leaves the field. With nothing highlighted, Enter
  does what it does today.
- **K4. A click into the field selects the name whole** (D13); typing
  replaces it, and leaving the field without typing keeps it. A second
  click places the caret.
- **K5. Two keys, ↑ and ↓, sit at the right of the *Next take* label,**
  small, with "song" after them and "↑ ↓ the song before or after" on
  hover (D14). They are gone while a take is open.

## After a take

The review screen's footer keeps its buttons and the cloud line on the
right. On the left, in place of the field and its pills:

- **A1. The take's song, big, with its go after it, as the recording screen
  has it** ("Viasna 3", the number grey), and a pencil beside it. A take
  nobody named says "Take 7", grey. A long title is cut with "…", whole on
  hover.
- **A2. Under it, the length and against what:** "2:31 · 12 s shorter than
  go 2". Against the song's last go tonight; with none tonight, its last go
  before tonight, with the day ("8 s longer than on 22 Sep"), as the
  recording screen picks it; with neither, "the first go at it tonight". A
  difference under 2 seconds is "as long as go 2"; a minute or more is
  "1:05 longer". A take nobody named has the length alone.
- **A3. Left of the title, the song's goes tonight as bars,** each as tall
  as it ran, this one in the text colour, ★ goes green, the others grey,
  the go's number under each. A first go has no bars.
- **A4. The pencil opens Rename take,** the rehearsal screen's dialog with
  its pills, less the line about the folder: this take has none yet.
  Renamed, the title, the bars and the line follow the new name. In the
  dialog Space types and Esc closes it; outside it Space still saves and
  Esc still asks before discarding.
- **A5. The footer is as tall as its buttons:** 196 px today, about 110.
  The player gets the rest.

## Settings › Sets

- **T1. A tab *Sets*,** after *Marks*: "Songs in the order a rehearsal goes
  through them".
- **T2. Down the left, the sets,** each with its name and "6 songs", the
  chosen one lit, and *New set* under them. *New set* adds "New set" (or
  "New set 2"), with no songs, and chooses it.
- **T3. Beside them, the chosen set:**
  - *Name*, saved on Enter or on leaving the field; a name another set has
    is refused, and the field says so;
  - its songs and *Add*, as in S3, each change saved at once;
  - a song not played yet says so;
  - *Delete set*, after asking: "Delete Gig on the 25th? Rehearsals played
    by it keep their takes and their names."
- **T4. No sets:** "No sets yet. A set is the songs a rehearsal goes
  through, in order. Pick one beside Start rehearsal, or play freely as
  before."
- **T5. On a narrow window** the chosen set goes under the list.

## History

- **H1. A rehearsal played by a set** has the set's name in the list,
  under its date, and beside the date under its title, after a set icon.
- **H2. Over its songs, a card:** "Gig on the 25th — 4 of 6 played", the
  set's songs in order in two columns read down, each played one with ✓
  and its goes, each other "not played". A click on a played song scrolls
  to it.
- **H3. Songs played outside the set** are where they are today.
- **H4. A rehearsal played freely** looks as it does today.

## On reha.stream

- **W1. A wide tile in *Built for the room*,** after the cloud tile, a row
  of its own: "Rehearse the set, in order." and "Make the gig's songs a set
  once. Every take is the song you are on until you move on, and History
  says which ones you never got to."
- **W2. Beside the words, the rehearsal screen's panel mid-set,** from the
  app's own components on the demo band: the Next take field with
  "Viasna", and under it the set "Gig on the 25th" with Pałyn played four
  times, Viasna lit and Ahoń *next*. On a narrow window it goes under the
  words, as the health tile's does.
- **W3. The list replaces the pills on the page too,** wherever it shows
  the rehearsal screen: the story's rehearsal, and the field on the *Spell
  it however you like* tile, which shows *Songs* with Pałyn alone and lit
  under "Palyn → Pałyn".
- **W4. The story's second step** (D17) keeps *Hear last week, then
  record.* and its line, and tells:
  - "▶ beside Pałyn on the start screen plays its best go from last week."
  - "Start, and ↓ picks Pałyn under Next take."
  - "Record: the take's name over a big clock, and a tile per track that
    turns red when it clips."

  The stage plays Pałyn from *Last time* on the start screen for a few
  seconds, starts the rehearsal, presses ↓ until the field says Pałyn, and
  records.
- **W5.** *What's new* takes its line from `CHANGELOG.md`, as it does for
  every release. The questions do not change.

## Schema (migration 0006)

| Table | Change |
|---|---|
| `song_set` | New: `id` (never given twice), `name`, `songs` JSON (titles in order), `position`. |
| `rehearsal` | `set_name` and `set_songs` JSON, both nullable: the copy of D7. |

Band chat's spec says migration 0006; it becomes 0007.

## Python

- **Y1.** `list_sets()`: `[{"id", "name", "songs": [{"title", "new"}]}]` in
  order, each title resolved to the song's current title (D8), `new` for a
  song with no go yet.
- **Y2.** `add_set(name, songs)`, `update_set(set_id, name=None,
  songs=None)` and `delete_set(set_id)` each answer `{"ok", "sets"}`, or
  `{"ok": False, "error"}`: an empty name, a name taken. Songs repeated are
  kept once, at their first place.
- **Y3.** `save_next_set(set_id)` and `get_settings()["next_set"]` for S2.
- **Y4.** `start_rehearsal(…, set_id=None)` copies the set's name and songs
  onto the rehearsal (D7).
- **Y5.** `_next_take`: with no take yet and nothing picked, the set's first
  song (R3).
- **Y6.** `session_state()["set"]` and `get_rehearsal()["set"]`: `{"name",
  "songs"}` from the copy, titles resolved, or None.
- **Y7.** `list_rehearsals()` gives each rehearsal's `set_name`.
- **Y8.** `last_attempt(name)`: what A2 measures a take against, for the
  song `name` resolves to, by the rule `session_state()["last_attempt"]`
  already has.
- **Y9.** `_before_tonight`, `_before_tonight_for` and
  `session_state()["before_tonight"]` go (D15). The go before tonight that
  `_last_attempt` falls back on is picked as the card picked its first one:
  `_plays_of` over `Library.goes_before`.

## Testing

Tests come before the code, and each is seen failing first.

- **Python:**
  - Y1–Y3, with a renamed song, a merged one and a song not played yet;
  - Y4's copy, and that a set changed or deleted later leaves it;
  - Y5, and that the second take follows the first;
  - Y6, Y7, Y8;
  - Y9: `last_attempt` before tonight still says the day; no
    `before_tonight` in the state;
  - migration 0006.
- **Playwright** (the fake bridge gets the same calls, and loses
  `before_tonight`):
  - S1–S3: the menu, a long name, many sets, New set from the start screen;
  - S2 across a reload;
  - R1–R3: the card, *next*, a row back and ahead, a song outside the set;
  - R4–R6: the list with and without a set, All N songs and Fewer, typing,
    an old name, nothing matching, the height held; the tests that click
    pills on the rehearsal screen today click rows;
  - K1–K5: ↓ through the set into the folded list, ↑ at the top, a take
    open, typing with ↑ ↓ and Enter, the click that selects, the keys
    hidden with a take open;
  - A1–A5: a go with goes before it, a first go, a take with no song, a
    long title, renaming, Space and Esc in and out of the dialog;
  - T2–T5: making, renaming, a name taken, dragging, deleting, no sets;
  - H1–H4;
  - `before.spec.ts` goes with the card.
- **The site's own tests** follow the story step and the tiles.

## Docs

- `docs/using-it.md`: the start screen, the rehearsal screen (its *Next
  take* paragraph tells the list, the keys and the click, and the
  paragraphs on *Before tonight* go), after a take, Settings › Sets,
  History. The screenshots are taken again (`tests/docs_screenshots.py`).
- `CHANGELOG.md`: a line for sets, and the after-take screen. The line *Hear
  last time before you play it* loses the card and keeps the panel and
  "Took 3:20 on 22 Sep".

## Not part of this

- Lengths, keys, notes or statuses per song in a set.
- Printing a set list.
- A song in a set twice.
- Sets in the Songs view of History.
- The pills in the other name fields (R8).
- The start screen's left part, which the design-system work redoes.
