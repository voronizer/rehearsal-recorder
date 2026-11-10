# Clear ways between pages in the band service

On 10 November 2026 Alex wrote that it is still not clear in the band
service what to press to get where, for example between takes and songs.
He also asked that a press on the wave in a take's row open the take
rather than play it, and said the take lists are too tight: a take's name
is hard to read and the list turns to mush.

Later the same day he asked for a hand pointer over whatever presses,
for one look for every list, and for the song's statuses and the labels to
be edited in the panel from the right, with **New song** as a dialog.

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
8. The pointer. Alex, 11:29: «на ссылках некоторых нету "лапки" - обычная
   стрелка», then «это везде надо проверить». A script put the pointer
   over every thing that presses, on every page of the service (a local
   Worker), every screen of РЭХА (the fake bridge) and every page of the
   site. In the service all 206 links show the hand and all 426 buttons the
   arrow, among them the words with a dotted line that open something: a
   take's name, a mark's words, a row of **Rehearsals**. In a row of
   **Songs** or **Marks** the row shows the hand and the take's name and ▶
   in it the arrow. In РЭХА all 331 buttons show the arrow; the hand is
   only over a wave, a volume slider and **Send to the cloud**. The site's
   own links and buttons show the hand (`site/src/page/page.css`); the live
   РЭХА on its first screen is as РЭХА. The cause is Tailwind 4: it leaves
   a button the browser's arrow, where Tailwind 3 gave it the hand, and we
   have no rule of our own. shadcn's menu items and a list's items carry
   `cursor-default` (`ui/src/components/ui/dropdown-menu.tsx:83`,
   `select.tsx:109`).
9. The lists. Alex, 11:57: «подчеркивение все еще нужно? и у нас разнобой в
   списках - все по разному выглядят». Thirteen lists measured on the same
   band: a row is 32 px on **Marks**, 36 px in a set's songs, 46 px in
   **Songs** for a song with takes (its ▶ makes it so) and 34 px for one
   without, 56 px in the list of sets, 62 px for a take, 64 px in
   **Members**. Between rows: 0 in a set's songs, 2 to 14 px elsewhere.
   Only a set's songs have lines between rows. A mark is two lines in
   **Home**'s **Latest marks** and one on **Marks**. The dotted line under a
   name (`OPENS`, `service/src/shell/parts.tsx:171`) stands in rows that
   light up under the pointer anyway: a take's, a song's, a mark's, a
   rehearsal's day.
10. **Statuses** and **New song** on **Songs**, and **Labels** on **Marks**,
    open as a card at the top of the page that pushes the list down
    (`EditCard`, `service/src/shell/EditList.tsx:21`; Alex's pick A of
    2026-11-08, editors in place). Alex, 12:09: «в песнях на кнопку статусов
    открывается панель - нахрена такая? давай сделаем в боковой правой
    редактирование».

Claude read “the small player” as a take's row in a list (▶, name, wave)
and said so at 10:5x; Alex did not correct it.

Mockups Alex picked from (the service's own pages on answers recorded from
a local Worker; sources in /mnt/project-files/band-service/navigation/):

- what a press on a take opens: https://claude.ai/artifact/FYDVKp6fczQCHV9kvYLdp8
- how pages lead to a song and a rehearsal: https://claude.ai/artifact/8KzqsfWPL9kN8NY9uiCgL5
- room between take rows: https://claude.ai/artifact/54b3jYD5w8eXLUMmXu3ryp
- a rehearsal's page leading to a song: https://claude.ai/artifact/Bg53WGkG9rpJdeJgKqXqpk
- how the song's line stands out: https://claude.ai/artifact/FSwWSjGZ3EP6uJ7VXJCQ7s
- one rule for every list: https://claude.ai/artifact/Xhm7vh51pcJEwtGx2p3vti
- editing in the panel from the right: https://claude.ai/artifact/55BT83BcpFhcMQSumfkBSy

## Alex's picks

All on 10 November 2026 (UTC), each a tap on a card unless quoted.

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
- 11:23:14, on a picture of the song's pill on a rehearsal's page: «херня.
  не нравится. неочевидная кнопка нифига».
- 11:27:48, on three ways from a rehearsal's page to a song: «строка песни
  - лучше. только нужно ее как-то выделить - а то дубли с волноформами
  перебивают внимание». A line for the song over its takes.
- 11:55:31 «А. Лапка на всём»: the hand over everything that presses, in
  the service, in РЭХА and in the live РЭХА on reha.stream.
- 11:56:07 «А. Серая полоса»: the song's line on a grey band.
- 12:09:29, on one rule for every list: «А - воздух». No lines, 24 px
  between rows as between takes, the rows of a list one height.
- 12:09:29, the same message: **Statuses** edited in the panel from the
  right.
- 12:11:33: «и у новой песни можно просто диалог сделать?» **New song** is
  a dialog.
- 12:13:39 «А. И метки»: **Labels** on **Marks** is edited in the panel from
  the right too.
- 12:14:36, on **New song** as a dialog: «кроме поля названия туда добавь
  еще статус».

## What the band sees

### Take rows in the service

Everywhere a take is a row: **Home** (the last rehearsal, **Songs**, **The
band's favourites**), **Songs** (**Not named**), a song's page (**Best
take**, **All takes**), a rehearsal's page.

- The row lights up under the pointer, as a row of **Songs** does. A press
  anywhere on it opens the take's page: the name, the wave, the empty
  room. ▶, ★ and ⋯ keep their jobs, and so do the marks listed under a
  take on a rehearsal's page (each plays from its moment).
- The name loses its dotted line, as every row that lights up does (see
  **Lists**). Tab still reaches it, and Enter opens the page.
- From a row's wave to the next row's name is 24 px in every one of those
  lists.
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

- Over each song's takes is the song's line, on a grey band the width of
  the list: a note, the title a size up (16 px, bold), then in grey the
  takes, the key and the tempo, “4 takes · E minor · 120 bpm”, and › at the
  right. The line lights up under the pointer and opens the song's page.
- A song's takes no longer fold.
- **Not named** stays a plain heading over its takes, with no line and no
  fold: it has no page.
- **Notes and files** goes.

### A song's page

- Each day in **All takes** is the rehearsal's pill: it opens the
  rehearsal's page. The arrow and the count fold its takes.

### Lists

Every list of the service by one rule: **Home** (the last rehearsal, the
songs with their best take, **Latest marks**, **The band's favourites**),
**Rehearsals**, a rehearsal's page, **Songs**, a song's page (**Best take**,
**All takes**, the files), the list of sets and a set's songs, **Marks**,
**Members**, **Trash**.

- No lines between rows. A set's songs lose theirs.
- From one row to the next, 24 px, as between takes: from the bottom of a
  row's last line (a take's wave) to the top of the next row's first. The
  light under the pointer fills that room.
- The rows of one list are one height: in **Songs** a song with no takes
  yet is as tall as one with ▶.
- No dotted line in a row that lights up and opens as a whole. It stays
  only where the word alone opens and the row round it does not: a song's
  title and its length in a set, a file in a song's notes, the last
  rehearsal's day on **Home**, a song's title over its best take on
  **Home**.
- A row of **Latest marks** on **Home** lights up and opens the mark, as a
  row of **Marks** does; the take's name in it opens the take's page.

### Statuses, Labels and New song

- **Statuses** on **Songs** opens the band's statuses in the panel from the
  right, over the page; the songs stay where they are under it. ✕, Esc or
  **Statuses** again closes it. **Edit statuses** in a song's status menu
  opens the same panel over the song's page.
- **Labels** on **Marks** opens the band's labels in the panel from the
  right in the same way.
- **New song** opens a dialog: the title, the status under it, **Add song**
  and **Cancel**. The status starts at the band's first one (“Learning”),
  which a new song gets now. **Add song** makes the song with that status
  and opens its page, as now.
- The card at the top of the page goes.

### The pointer

In the service, in РЭХА and in the live РЭХА on reha.stream the pointer is
a hand over everything that presses: links, buttons, the words with a
dotted line, rows that open something, menu items, switches, tabs, folds,
check boxes. These keep their own:

- a handle that drags a song or a label: the open hand;
- the wave in a take's player, where a press sets the playhead: the cross;
- the ends of a loop: the arrows left and right;
- a field to type in: the text cursor;
- what cannot be pressed now, greyed out, and the tab already open: the
  arrow.

The site's own links and buttons already show the hand.

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
  the arrow and the hint fold the group and the pill leads away (a song's
  page). A new `SongLine` (the grey band with the song's title, takes,
  key, tempo and ›, a link) for a rehearsal's page. `Rows` gets `takes`,
  which spaces take rows 24 px apart and leaves their light to the row
  itself.
- `takes/Take.tsx`: no `Back`; the line under the title starts with the
  pills.
- `rehearsals/Rehearsal.tsx`: each song a `SongLine` over its takes, no
  fold; **Not named** a plain heading.
- `songs/Song.tsx`, `home/Home.tsx`, `songs/Songs.tsx`: the day pills as
  titles on a song's page, `Rows takes` for every list of take rows.
- `shell/Side.tsx`: **Songs** is lit on `/takes/…`. The icons the pills
  use come from the same list as the column's.

### Lists, the dotted line, the editors

- `shell/parts.tsx`: `Rows` spaces every list's rows 24 px apart (`gap-0`,
  `py-3` on each row, the light over the padding); `takes` stays as the
  same rule for take rows. The favourites on **Home** and a song's **All
  takes** become `Rows`.
- `songs/Songs.tsx`: a song's row `min-h-8`, with ▶ or without.
- `sets/SetPage.tsx` and `ui/src/components/SortableList.tsx`'s use there:
  no lines between a set's songs, the same room as other lists. `sets/
  Sets.tsx`: the list of sets 24 px apart.
- `OPENS` leaves `TakeLink` in a row, `Songs`, `Rehearsals`, `Marks` and
  the marks under a take; it stays in `SetPage` (title, length),
  `songs/parts.tsx` (a file) and `home/Home.tsx` (the day, a song's title).
- `marks/MarkItem.tsx`: a compact row (**Latest marks**) lights up and opens
  the mark's panel, as `Marks`' rows do.
- `shell/panel.tsx`: `statuses` and `labels` kinds, `?panel=statuses` and
  `?panel=labels`, on any page; `shell/Shell.tsx` draws `StatusesEditor`
  and `LabelsEditor` in the panel. An old `?edit=statuses` or
  `?edit=labels` opens it. `songs/parts.tsx`: **Edit statuses** opens the
  panel where it is. `shell/editor.ts` and `useEditor` go with the card.
- `songs/NewSong.tsx`: `NewSongEditor` becomes `NewSongDialog` in the shared
  `Dialog` (C3), with the shared `Select` for the status. `?edit=new-song`
  goes; an old address with it opens **Songs** with the dialog.
- `worker/songs/routes.ts`: **New song** (`POST /api/songs`) takes an
  optional `status_id`, checked as the song's own change checks it (“No
  such status”); without it, the first status, as now. `openapi.json`
  follows (`npm run openapi`), and `api.ts`' `useAddSong` sends it.
- `shell/EditList.tsx`: `EditCard` goes once no page uses it.

### The pointer

- `ui/src/index.css`, in its base layer, which the service and the site's
  live РЭХА take too: the hand over a button that is not disabled,
  `[role=button]`, `summary` and a label round a check box or a radio.
- `ui/src/components/ui/dropdown-menu.tsx` and `select.tsx`: the items'
  `cursor-default` becomes `cursor-pointer`; the list's scroll arrows keep
  theirs.
- `service/src/takes/parts.tsx`: `TakeLine`'s row gets `cursor-pointer`
  with its light. Rows that open something already have it (`Songs`,
  `Marks`, РЭХА's `TakeRow` and Marks page).

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
- `docs/design-system.md` also gets the pointer rule in the foundation:
  the hand over everything that presses, and the five that keep their own;
  in C1 `OPENS` is for a word that opens on its own, not for a row that
  lights up and opens as a whole; the band service's lists: no lines, 24 px
  between rows, one height in a list; its editors of the band's lists in
  the panel from the right.
- `CHANGELOG.md` gets an **Unreleased** section with three items:
  - **In the band service a take opens its page from anywhere on its
    row**, the wave too, and the take's panel is gone. Under a take's
    title its song and its rehearsal are buttons that open their pages; on
    a rehearsal's page each song has a grey line over its takes that opens
    the song, in place of **Notes and files**, and on a song's page a day
    opens its rehearsal. Every list has the same room between rows and no
    lines. **Statuses** and **Labels** open in the panel on the right, and
    **New song** is a dialog.
  - **A press on a take's wave opens the take**, as the rest of its row
    does, in the rehearsal screen's list and in **History**. The rows stand
    further apart.
  - **The pointer is a hand over everything you can press**, in РЭХА and in
    the band service: buttons, menus, switches, a take's name and row, not
    only links.
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
- `service/e2e/rehearsals.spec.ts`: a song's line opens its page; the
  takes do not fold; no **Notes and files**.
- `service/e2e/songs.spec.ts`: a day's pill in **All takes** opens the
  rehearsal. “Statuses and New song open at the top of Songs…” (`:59`),
  “New song pressed over a take's panel on Statuses…” (`:101`) and “Edit
  statuses on a song's page opens Statuses on Songs” (`:119`) become: the
  statuses' panel and **New song**'s dialog, one at a time, Back and Esc
  close them, the songs stay under the panel, **Edit statuses** opens the
  panel over the song's page, the dialog makes the song with the status
  picked and opens its page. A Worker test: a song made with a status has
  it, one with a status that is not there is refused.
  `marks.spec.ts` (`:45`, `:75`): **Labels** in the panel.
- `service/e2e/marks.spec.ts`: a mark's take opens the take's page; a row
  of **Latest marks** opens the mark; an old `?edit=statuses` or
  `?edit=labels` opens the panel.
- 24 px between rows and no lines in each list named above, one check per
  page where a test already opens it; a song without takes as tall as one
  with.
- `ui/e2e/overview.spec.ts`, `ui/e2e/history.spec.ts`: a press on the wave
  opens the take in the player; a playing take goes on.
- New `service/e2e/pointer.spec.ts` and `ui/e2e/pointer.spec.ts`: on each
  page of the service and each screen of РЭХА, with a menu open too, the
  pointer over every link, button, menu item, switch and row that opens
  something is the hand, as the script above found it, but for the five
  that keep their own.

While developing, only the tests a change touches run, once each; the full
suites run once, on CI.

## Calls Claude made

1. A take's name in its row loses the dotted line. Alex asked at 11:57
   whether it is still needed; Claude answered that a row that lights up
   and opens as a whole does not need it, and every way in the lists'
   mockup drew it so. Tab still reaches the name.
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
8. On a song's page the day's pill is the group's title, and the arrow and
   the count fold it.
9. On **Home** a song's title stays 8 px over its best take, as a heading
   over its row; from one song's take to the next song's title is 24 px,
   by the rule for lists.
10. In РЭХА the **Marks** page and **Last time** keep their wave presses:
    a Marks row is a mark, and **Last time** has a row per song with
    nowhere to open.
11. One pull request for the service, РЭХА, the guide, the design system,
    the CHANGELOG and the pictures, the pointer too. No release in it.
12. Under a take's title and on a song's page the pills stay, as picked at
    11:05:32; only a rehearsal's page changed after 11:23.
13. With the song's line, a song's takes on a rehearsal's page no longer
    fold, as in the mockup. **Not named** has no page, so it stays a plain
    heading, and it does not fold either, to match.
14. The song's line is 16 px bold on `bg-panel`, the grey of РЭХА's side
    panels, as in the mockup; lit as a row is under the pointer.
15. The pointer keeps its own over a drag handle, a take's wave in its
    player, a loop's ends, a field, and what cannot be pressed now or the
    tab already open (the list above). A label beside a text field keeps
    the arrow: a press there only puts the cursor in the field.
16. The rule for lists does not reach the rows of an editor (a status, a
    label: a field to type in each) or a mark's talk on a take's page, which
    reads as messages.
17. **Statuses** and **Labels** in the panel are in the address
    (`?panel=statuses`, `?panel=labels`), as a mark's panel is: Back
    closes it, a reload keeps it. On a phone the panel takes the whole
    screen, as a mark's does.
18. **New song**'s dialog keeps the service's words: **Add song** and
    **Cancel**, the title field with “Zorka” in grey, the status named
    “Status” as on a song's page. РЭХА's dialog has **Create** and no
    status (РЭХА has none); the two stay as they are.
19. РЭХА keeps its own dotted words and lists: the rule for lists is the
    service's.
20. A row of **Latest marks** on **Home** opens the mark, as a row of
    **Marks** does, so its words lose the dotted line too. The dotted line
    stays on five words that open while their row does not (the list under
    **Lists**).

## Not in this

- Going back to the page a take was opened from (variant В of the second
  question).
- Pills anywhere else, such as a take's song in **Marks**.
- A release.
