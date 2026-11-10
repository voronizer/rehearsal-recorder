# Clear ways between pages in the band service

On 10 November 2026 Alex wrote that it is still not clear in the band
service what to press to get where, for example between takes and songs.
He also asked that a press on the wave in a take's row open the take
rather than play it, and said the take lists are too tight: a take's name
is hard to read and the list turns to mush.

What Claude found in the code (main at dbc3621) and on a local Worker with
the pictures' band:

1. A dotted line under a word looks the same everywhere but leads to
   different things: a song's title opens its page
   (`service/src/home/Home.tsx:17`), a take's name opens the take's panel
   (`service/src/takes/parts.tsx:84`), a day opens its rehearsal's page.
2. On a computer a take's page is two presses away: its name, then the
   title in its panel (`service/src/takes/TakePanel.tsx:106`).
3. On a take's page the song is only in “‹ Viasna” above the title. It
   looks like Back, but always goes to the song, wherever the take was
   opened from (`service/src/takes/Take.tsx:231`).
4. On a take's page no section is lit in the column on the left
   (`service/src/shell/Side.tsx:86`).
5. On a song's page the days in **All takes** only fold; they do not lead
   to the rehearsal (`service/src/songs/Song.tsx:17`). On a rehearsal's
   page a song is reached by **Notes and files**, not by its title
   (`service/src/rehearsals/Rehearsal.tsx:57`). Alex, 10:56: «на странице
   репетиции на песню ведет кнопка "Notes and files" - что странно».
6. A press on the wave in a take's row plays from there
   (`service/src/takes/parts.tsx:203`). РЭХА's rows do the same
   (`ui/src/components/RehearsalOverview.tsx:458`).
7. From a row's wave to the next row's name: 14 px on **Home** and on a
   rehearsal's page, 4 px in a song's **All takes** and in **The band's
   favourites** (`service/src/songs/Song.tsx:18`,
   `service/src/home/Home.tsx:115`).

Claude read “the small player” as a take's row in a list (▶, name, wave)
and said so at 10:5x; Alex did not correct it.

Mockups Alex picked from (the service's own pages on answers recorded from
a local Worker; sources in /mnt/project-files/band-service/navigation/):

- what a press on a take opens: https://claude.ai/artifact/FYDVKp6fczQCHV9kvYLdp8
- how pages lead to a song and a rehearsal: https://claude.ai/artifact/8KzqsfWPL9kN8NY9uiCgL5
- room between take rows: https://claude.ai/artifact/54b3jYD5w8eXLUMmXu3ryp

## Alex's picks

All on 10 November 2026 (UTC), each a tap on a card.

- 11:04:00 «Б. Вся строка»: a take's whole row lights up under the
  pointer and opens the take's page, except ▶, ★ and ⋯. There is no take's
  panel any more.
- 11:05:32 «Б. Кнопки со значками»: a song and a rehearsal are pills with
  the icon their section has in the column on the left: under a take's
  title, on a rehearsal's page and on a song's page.
- 11:09:14 «А. Больше воздуха»: 24 px between take rows in every list.
- 11:10:47 «А. Волна и место»: РЭХА's take rows too: a press on the wave
  opens the take, as the rest of the row does, and 24 px between rows.
- 11:12:00 «А. Только картинки»: reha.stream gets its pictures of the
  service taken again; no text changes.

## What the band sees

### Take rows in the service

Everywhere a take is a row: **Home** (the last rehearsal, **Songs**, **The
band's favourites**), **Songs** (**Not named**), a song's page (**Best
take**, **All takes**), a rehearsal's page.

- The row lights up under the pointer, as a row of **Songs** does. A press
  anywhere on it opens the take's page: the name, the wave, the empty
  room. ▶, ★ and ⋯ keep their jobs, and so do the marks listed under a
  take on a rehearsal's page (each plays from its moment).
- The name keeps its dotted line; Tab reaches it, and Enter opens the page.
- From a row's wave to the next row's name is 24 px in every one of those
  lists. Between the songs on **Home** stays as now.
- On a phone a take already opens its page; now the wave does too.

### No take's panel

- The panel from the right holds only marks. A take's name opens the
  take's page wherever it stands: in the bottom bar, in a mark (**Home**'s
  **Latest marks**, **Marks**, a mark's panel), in the **Trash**, as a song's
  best take on **Songs**.
- **Mark** in the bottom bar opens a new mark at the player's moment in
  the panel, as on a phone now.
- ⋯ › **Move to song** › **New song…** from a row opens the take's page
  with the field under the title, as on a phone now.
- An old address with a take's panel in it (`?panel=take:…`) opens that
  take's page.
- The drawer on a take's page stays as it is: the take's marks.

### A take's page

- Under the title: a pill with a note and the song's title, a pill with a
  calendar and the day of the rehearsal, then the length and the tracks,
  “4:05 · 4 tracks”. A pill opens its page. A take with no song has only
  the rehearsal's pill.
- “‹ Viasna” above the title goes.
- In the column on the left **Songs** is lit.
- On a phone the same pills, under the title.

### A rehearsal's page

- Each song's heading is the song's pill: it opens the song's page. The
  arrow and the count beside it fold the song's takes. **Not named** stays
  a word.
- **Notes and files** goes.

### A song's page

- Each day in **All takes** is the rehearsal's pill: it opens the
  rehearsal's page. The arrow and the count fold its takes.

### РЭХА

In the rehearsal screen's list, in **History** (a rehearsal, a song's
page with **Starred**, the song's ladder):

- A press on a take's wave opens the take in the player, as the rest of
  its row already does. A take that is playing goes on from where it was.
- From a row's wave to the next row's name is 24 px.
- **Last time** on the start screen and the **Marks** page keep their
  waves as they are: a press plays from there.

## How it is built

### Service

- `takes/parts.tsx`: `TakeLink` becomes a link to `/takes/$uid` with the
  same look. `TakeLine`'s top row gets the light under the pointer and
  opens the page on a press that is not on a button, a link or a menu.
  `Wave` in a row no longer plays; in a take's player (`moves`) it still
  moves the playhead.
- `shell/panel.tsx`: the `take` kind goes. `panelOf` reads an old
  `take:<uid>` as the take's page, and the provider sends the browser
  there in place of the address. The phone's special case for a take goes
  with it.
- `shell/Shell.tsx`: `PanelView` loses the take's case; on a take's page
  `marks` and `mark` stay as now.
- `takes/TakePanel.tsx`: `TakePanel` and `Lanes` go. `TakePlayer`, the
  phone page's wave with ▶, moves into `takes/Take.tsx`.
- `shell/PlayerBar.tsx`: **Mark** opens `{ kind: "mark", uid, at }`.
- `marks/MarkItem.tsx`: `OnTake` links to the take's page;
  `marks/MarkPanel.tsx` uses `TakeLink` and follows.
- `takes/move.tsx`: **New song…** from a row goes to the take's page and
  opens the field there, on a computer as on a phone.
- `shell/parts.tsx`: a new `Pill` (a song or a rehearsal: the section's
  icon, the words, a link). `Group` takes a pill as its title: with `fold`,
  the arrow and the hint fold the group and the pill leads away. `Rows`
  gets `takes`, which spaces take rows 24 px apart and leaves their light
  to the row itself.
- `takes/Take.tsx`: no `Back`; the line under the title starts with the
  pills.
- `rehearsals/Rehearsal.tsx`, `songs/Song.tsx`, `home/Home.tsx`,
  `songs/Songs.tsx`: the pills as titles, `Rows takes` for every list of
  take rows.
- `shell/Side.tsx`: **Songs** is lit on `/takes/…`. The icons the pills
  use come from the same list as the column's.

### РЭХА

- `components/RehearsalOverview.tsx`: `TakeRow`'s wave opens the take
  (`open(take)`). `onPlayAt` goes from `TakeRow`, `RehearsalOverview`,
  `SongLadder` and `SongPage`, and from the rows' wiring in
  `screens/Rehearsal.tsx` and `screens/HistoryScreen.tsx`. The Marks
  page's and **Last time**'s wave presses stay.
- The lists' gaps: rows of one song in `RehearsalOverview`, **Starred** in
  `SongPage`, the ladder's rows in `SongLadder`, each so that 24 px stands
  from a wave to the next name. The heading above a song's first row stays
  where it is.

## Words

- No new words on screen. A pill's name for a screen reader is its words,
  “Viasna” or “Thursday, 5 November”, as a link.
- `docs/using-it.md` (the guide, lines 194-196): “Click the wave to play
  the take from that spot” goes; a click on a take's row, the wave too,
  opens the take in the player.
- `docs/design-system.md` (the take in a list, in the shared components):
  “a press plays from there” becomes a press on the wave opening the take,
  as its row does, but on the Marks page; take rows 24 px apart; a song or
  a rehearsal that leads to its page in the band service is a pill with
  its section's icon.
- `CHANGELOG.md` gets an **Unreleased** section with two items:
  - **In the band service a take opens its page from anywhere on its
    row**, the wave too, and the take's panel is gone. Under a take's
    title its song and its rehearsal are buttons that open their pages; on
    a rehearsal's page a song's title opens the song, in place of **Notes
    and files**, and on a song's page a day opens its rehearsal. Take lists
    have more room between rows.
  - **A press on a take's wave opens the take**, as the rest of its row
    does, in the rehearsal screen's list and in **History**. The rows stand
    further apart.
- reha.stream: the pictures `new-takes`, `song`, `three-weeks-ago`,
  `lanes`, `mark` and `downloads` are taken again, light and dark
  (`npm run pictures` in `service/`). Alex sees them before the merge.
  РЭХА's rows on the site are live and follow by themselves.

## Tests

Playwright, changed where they open a take's panel or press a wave:

- `service/e2e/frame.spec.ts`: a press on a row's wave opens the take's
  page and plays nothing; on a phone the same; the panel tests use a mark's
  panel in place of a take's; **Mark** in the bar opens a new mark in the
  panel.
- `service/e2e/home.spec.ts`: a take's name and its row's empty room open
  its page; ▶ plays without leaving **Home**; 24 px between rows.
- `service/e2e/takes.spec.ts`: the tests that open a take's panel open its
  page; **M** and **S** before ▶ move to the take's page; the take's page
  has the song's and the rehearsal's pills and they lead there; an old
  `?panel=take:` address opens the take's page; **Songs** is lit.
- `service/e2e/rehearsals.spec.ts`: a song's pill opens its page, the
  arrow folds; no **Notes and files**.
- `service/e2e/songs.spec.ts`: a day's pill in **All takes** opens the
  rehearsal; the test with a take's panel over **Statuses** uses a mark's.
- `service/e2e/marks.spec.ts`: a mark's take opens the take's page.
- `ui/e2e/overview.spec.ts`, `ui/e2e/history.spec.ts`: a press on the wave
  opens the take in the player; a playing take goes on.

While developing, only the tests a change touches run, once each; the full
suites run once, on CI.

## Calls Claude made

1. The take's name keeps its dotted line inside the lit row: Tab reaches
   it, and a phone has no pointer to light the row.
2. A press on the wave opens the take's page at the start, or where the
   player has the take; it does not jump to the spot pressed.
3. With no take's panel, **Mark** in the bar and **New song…** from a row
   work on a computer as they do on a phone now.
4. An old `?panel=take:` address opens the take's page.
5. On a take's page **Songs** is lit, also for a take with no song
   (**Songs** lists those under **Not named**).
6. “‹ Viasna” above a take's title goes: the song's pill does its job.
7. Pills: the section's icon from the column on the left (a note for a
   song, a calendar for a rehearsal), the words in full, a thin line round
   them, lit under the pointer, 28 px tall.
8. On a rehearsal's and a song's page the pill is the group's title, and
   the arrow and the count fold it.
9. Between the songs on **Home** stays as now; only rows of takes get 24 px.
10. In РЭХА the **Marks** page and **Last time** keep their wave presses:
    a Marks row is a mark, and **Last time** has a row per song with
    nowhere to open.
11. One pull request for the service, РЭХА, the guide, the design system,
    the CHANGELOG and the pictures. No release in it.

## Not in this

- Going back to the page a take was opened from (variant В of the second
  question).
- Pills anywhere else, such as a take's song in **Marks**.
- A release.
