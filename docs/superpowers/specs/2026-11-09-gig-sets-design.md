# Sets for a gig, in the band service and in РЭХА

A band plays a gig from a list: the songs in order, short enough for the
minutes the club gives. Today РЭХА keeps sets for rehearsing (Settings ›
Sets, picked beside **Start rehearsal**), and the band service has none. This
spec brings sets to the service, with each song's length and the set's total
time, a screen to play the set from on a phone, and a sheet to print for the
stage, and keeps them the same in РЭХА and the service, both ways, as songs
are kept since 0.24.0 ([song sync](2026-11-05-song-sync-design.md)).

Issue #107. The mockups, built from the service's and РЭХА's own components:

1. the set and how to build it: https://claude.ai/artifact/Gcosx32NLs1FkBUEg2pLjU
2. a song's length: https://claude.ai/artifact/DXKY6Bp2Hkx2pRa2PVgBnT
3. the set at the gig: https://claude.ai/artifact/TUquC5HTNDG16mNaqjsmYn
4. the printed set: https://claude.ai/artifact/N5XUmE43t3Q8dG5fTBCcBF
5. reha.stream: https://claude.ai/artifact/9DabgsNBsAvXJkioCXmrAr
6. sets in РЭХА and the service: https://claude.ai/artifact/NnFWupQfmYUkvEHu9zd94c
7. the check button: https://claude.ai/artifact/XJV3CBjbUj9n4b7yyFURoK

Their sources are in /mnt/project-files/band-service/sets/q1-mock/ to
q6-mock/. Where this spec and a mockup differ, this spec wins.

## Alex's picks

In the thread «Сделать сеты для концерта в сервисе», 9 November 2026 (UTC).

- 20:31 (card «А. Как в РЭХЕ») A set is edited right on its page, as in
  РЭХА's Settings › Sets: a handle to drag a song, its number, ✕ to take it
  out, and under the songs a field with the band's songs as pills.
- 20:33 The set can be renamed. **New set** makes the set at once and opens
  it, with nothing to fill in first.
- 20:35 (card «Б. Дубль или вписанная») A song's length in a set is its
  best take's, and anyone can type their own over it.
- 20:37 («да») The layout is РЭХА's too: the sets listed on the left with
  **New set** under them, the picked set beside them.
- 20:41 (card «Б. Сцена») **On stage** opens the set one song a screen, big,
  with ‹ and › at the bottom.
- 20:42 (card «А. Один столбец») The printed set is one column in big
  letters: number, title, and the key and tempo on the right.
- 20:43 No marks on the stage view for now. 20:45 (card «А. На экране
  «Сцена»») It says “Still in development” in a small grey line at its top,
  and nowhere else.
- 20:53 reha.stream shows the set on a computer only; the stage view is not
  on the site yet.
- 21:02 Sets go both ways between РЭХА and the service. РЭХА checks when it
  starts, every hour, and when a button is pressed.
- 21:05 (card «В. В меню сетов у Start») That button is in the menu of sets
  beside **Start rehearsal**, under **New set…**.
- 21:06 Build it without waiting for an «ок» on this spec or the plan, and
  release it.

## How it works

A set is a name and songs in an order. It has one number in РЭХА and the
service, given by the service, as a song has. Its name and its songs go both
ways. A song's typed length lives in the service only: РЭХА's sets have no
lengths.

| Where | What was done | On the other side | When |
|---|---|---|---|
| РЭХА | **New set**, a rename, songs added, taken out or moved | The same in the service | At once; with no internet, when it is back |
| РЭХА | **Delete set** | The set goes to the service's Trash | At once |
| Service | **New set**, a rename, songs added, taken out or moved | The same in РЭХА | At the check |
| Service | **Delete set** | The set goes from РЭХА | At the check |
| Service | **Restore** in the Trash | The set comes back to РЭХА | At the check |
| Both | The same set changed before a check | The change that reached the service later wins | At the check |
| Both | First check after the update | Sets with the same name are one set; the rest are made on the other side | Once |

“At the check” means when РЭХА starts, when a rehearsal starts, every hour,
or when **Check the band service** is pressed. A rehearsal keeps its own copy
of its set, as now: a change later changes nothing in History.

## The service

### What it keeps

Migration `0008_sets.sql`. It only adds, as the migrations before it do.

- `band_set`: the number, the name, its place in the list, when it was made
  and by whom, who last changed it in the service (null when РЭХА did), and
  when it went to the Trash and by whom.
- `set_song`: a set's songs, each with its place. A song is in a set once.
  A song deleted for good leaves its sets with it.
- `song.typed_length`: the length in seconds someone typed for the song, or
  null.

Set names follow РЭХА's: 1 to 40 characters, trimmed, and two sets in use
never share a name, compared case-blind. New sets go to the end of the
list.

### What the band does

- `GET /api/sets`: the sets in their order, each with its songs' numbers.
- `POST /api/sets` with a name: a new set at the end, no songs.
- `PATCH /api/sets/{id}` with `name`, `songs` (the numbers in order) or
  both. A name another set has is turned down: “There is already a set
  called Club gig.”
- `DELETE /api/sets/{id}`: to the Trash.
- `POST /api/trash/sets/{id}/restore`. A name another set took meanwhile is
  turned down, saying so.
- `GET /api/trash` lists sets too.
- `PATCH /api/songs/{id}` also takes `typed_length`, whole seconds from 1
  to 3600, or null to go back to the best take's. `SongItem` gets
  `typed_length`.

### What РЭХА calls

All with РЭХА's key, as for songs.

- `POST /api/reha/sets/link`: the first check. РЭХА sends each of its sets,
  its name and its songs' numbers; the answer gives each its number. A set
  with the same name (case-blind) is that set, and takes РЭХА's songs. A set
  that matches nothing is made. Asked again after an answer that never came,
  it gives the same numbers.
- `POST /api/reha/sets`: a set made in РЭХА; the answer is its number. A
  name a set has already is that set.
- `PATCH /api/reha/sets/{id}`: a rename, new songs, or both.
- `DELETE /api/reha/sets/{id}`: to the Trash.
- `GET /api/reha/sets`: every set with its number, name, songs' numbers,
  whether it is in the Trash, and who last changed it there (by name).

A song the service does not know is turned down (400), naming it. The
service's minimum РЭХА version stays as it is: a РЭХА from before this
never calls these routes, and its sets stay its own until it updates.

### The service's screens

As the mockups show them.

- **Sets** in the menu on the left, after **Songs**.
- On a computer, the sets listed on the left, each with its name and “9
  songs · 31:15”, and **New set** under them; the picked set beside them. On
  a phone, the list, and a set opens on its own page with **Sets** to go
  back.
- **New set** makes “New set” (then “New set 2”, …) and opens it with its
  name selected, to type over.
- The set's name with ✎ to rename it in place, as a song's title is: Enter
  or ✓ renames, Esc or ✕ leaves it. Beside it **Print**, **On stage** and
  ⋯ › **Delete set**, which asks first: “It goes to the Trash, where anyone in
  the band can put it back for 30 days. Its songs stay as they are.”
- Under the name, “9 songs · 31:15 · no length: Kryły”: the total of the
  lengths, and which songs have none.
- The songs, as РЭХА's set editor shows them: a handle, the number, the
  title (a link to the song), its key, tempo and length, and ✕. Under them
  **Add**: a field and the band's songs not in the set as pills, with **All
  songs…**.
- A song's length is its best take's. Pressed, it becomes an “m:ss” field:
  Enter keeps what was typed, and an empty field goes back to the best
  take's. A song with no take and nothing typed says “no takes”.
- **On stage** opens the set's first song full screen: at the top the set's
  name with “Still in development” under it, “2 of 9” and ✕ back to the set;
  then the number and title, big, the key, tempo and length, the song's
  notes, its pictures shown whole and its other files as buttons; at the
  bottom ‹ with the song before and › with the song after (“The end” on the
  last). A swipe goes too. While it is open the phone's screen stays on,
  where the browser allows it.
- **Print** opens the browser's print window with the set on A4: its name
  and “9 songs · 31:15” at the top, then each song in big letters, its
  number, title, and on the right the key, short (“Em”, “F♯”), and the
  tempo. Twelve songs fit a sheet; more go on to the next.
- A set in the Trash shows there with **Restore**, as a song does. A song in
  the Trash is left out of its sets while it is there, and is back in its
  place when restored.

## РЭХА

### What it keeps

Migration `0016_service_sets`.

- `service_set`: a set's number in the service and what the two sides last
  agreed on for it: its name, and its songs as the service's numbers. A set
  deleted in РЭХА keeps its row, with no set, until the service has the
  delete.

A key to another service forgets them, as it forgets songs and takes.

The same three values as for songs tell who changed what: what РЭХА has
now, what the service has, and what they last agreed on. Only РЭХА's
differs: it goes to the service. Only the service's: РЭХА takes it. Both:
РЭХА's change was made with no internet; it goes now and wins.

### Sending its own changes

A set made, renamed, changed or deleted in РЭХА wakes the sending, and goes
after the songs and before any take. A title in the set that is no song yet
(РЭХА lets a set name a song nobody has played) is made a song first, as
**New song** makes one, so it has a number in the service.

### The check

The songs, as now; then the sets; then the takes.

1. The first time with this service, `link`.
2. What РЭХА changed and has not told the service yet.
3. `GET /api/reha/sets`, and what it says is done here: a new set is made,
   a name or songs changed, a set deleted or back from the Trash. A name a
   set here already has gets “ 2” after it, as **New set** does.

### Check the band service

An item in the menu of sets beside **Start rehearsal**, under **New set…**,
with ⟳, there while takes are sent to the band service. It runs the check at
once, songs, sets and takes; while a take records or plays, right after.

### What РЭХА shows

- Each change from the service is a line in the list of background work,
  done, with who did it under it: “Club gig, 13 December / New set from Ivan
  in the band service”, “Club gig, 13 December / Ivan changed it in the band
  service”, “Club gig, 13 December / Ira deleted it in the band service”.
- The notice of a check counts sets with songs: “Ivan changed 4 songs and 1
  set in the band service”. A check from the button that brought nothing
  says “Nothing new in the band service.”

## Shipping

The service can go up before РЭХА: an older РЭХА does not call the new
routes. The release follows the merge at once, as Alex asked.

## Words

- The guide (`docs/using-it.md`): “Play by a set” says the sets are the same
  in the band service, and what **Check the band service** does; “Sending
  takes to a band service” says sets go both ways.
- CHANGELOG, under Unreleased, one item starting in bold.
- reha.stream, the band service page: a chapter “Make the set for a gig”
  before “How to start”, with a picture of the set on a computer (`sets`,
  1180×820, taken by `npm run pictures` in service/). No word of the stage
  view. Alex sees it before the merge.

## Tests

- The Worker (vitest): the band's set routes, names, the Trash and
  **Restore**; РЭХА's set routes and `link`; `typed_length`.
- The service's screens (Playwright): make a set, rename it, add and order
  songs, type a length, **On stage** ‹ ›, **Delete set** and **Restore**.
- РЭХА (pytest): the three-way choice for a set; a title made a song before
  its set goes; the check's order; each change from the service; the lines
  and the notice; a key to another service.
- РЭХА's interface (Playwright): **Check the band service** in the menu, and
  not there without the service.

While building, only the tests a change touches run, once each; the full
suites run once, on CI.

## Calls Claude made

Alex did not pick these; each can change.

1. **Sets** is its own section in the service, after **Songs**.
2. **Delete set** sends a set to the Trash for 30 days, as a song.
3. On a phone, the list of sets, then the set on its own page.
4. The printed keys are short: “Em”, “F♯”.
5. The total time counts no pause between songs.
6. A typed length is kept on the song, so it is the same in every set, and
   stays in the service.
7. **Print** is beside **On stage**, and opens the browser's print window.
8. The stage view keeps the phone's screen on (the Screen Wake Lock API,
   in every current browser, Safari included; not tried on Alex's iPhone
   yet).
9. At the first check, a set with the same name on both sides is one set,
   and РЭХА's songs win: they were there first.
10. A title in a РЭХА set that is no song yet is made a song before the set
    goes.
11. Set names are unique among the sets in use; **Restore** of a set whose
    name was taken meanwhile is turned down, saying so.
12. A song in the Trash is left out of its sets while there.
13. The check also runs when a rehearsal starts, as for songs.
14. **Check the band service** checks songs and takes too: it is one check.
15. Pressed with nothing new, it says so in a notice; otherwise the notice
    it gives is the one a check gives now, counting sets too.
16. Two members changing one set at once: the later save wins.
17. The service's minimum РЭХА version does not change.

## Not in this

- The song's open marks on the stage view.
- A leader whose phone moves everyone's to the next song.
- The stage view on reha.stream.
