# Songs kept the same in РЭХА and the band service

Today a song reaches the band service only inside a take: its title and
tempo ride along with each take, one way, and the service finds the song by
its title. So a rename in РЭХА leaves an empty old song in the service, a
song made in the service is unknown to РЭХА, and a rename in the service
would be undone by the next ★. This spec gives each song one number that
both sides keep, and lets its title, tempo and signature be changed on
either side. A take can be moved to another song in the service too.

Everything behind it (the facts with file and line, the cases tried on a
copy of the service, three rounds of questions and the review) is in the
Claude Doc https://claude.ai/artifact/MqDTG2eAriPCJWeiWb5pgB. The mockups:

- the song's title and tempo in the service:
  https://claude.ai/artifact/GQBFTvpwrfCkzFyjrHEwJs
- moving a take in the service:
  https://claude.ai/artifact/4QMNbg44jpimNm8wdrJBfb
- what РЭХА shows after a check:
  https://claude.ai/artifact/Ru4QhZG7wt2Bx5nbqwYZ2w

Their sources are in /mnt/project-files/band-service/song-sync/q1-mock/,
q2-mock/ and q3-mock/. Where this spec and a mockup differ, this spec wins.

## Alex's picks

In the thread «Продумать синхронизацию песен с сервисом», 5 November 2026
(UTC).

- 11:24 A song can be renamed in both places; РЭХА learns of a rename in the
  service when it starts or within the hour. Think the whole sync through
  rather than fix one case.
- 11:45 A song has a lasting number that both sides keep; titles are
  matched only once, while the number is unknown. Songs made in the service
  show in РЭХА as songs from its own **New song**. Songs made in РЭХА
  appear in the service at once, before their first take, with their tempo.
  One computer sends today, but it is built for several. РЭХА checks when it
  starts, every hour and when a rehearsal starts.
- 12:04 A song's tempo and signature can be changed on both sides and
  travel as the title does. РЭХА records, and no file comes from the
  service to РЭХА; an assembled take is downloaded and added as a backing
  track by hand. Status, key, notes and files live in the service only; the
  backing track in РЭХА only; each side keeps its own sets. The later change
  wins. A song with no takes deleted in the service goes from РЭХА too, its
  backing track to РЭХА's Trash. The first check joins the pairs that came
  apart after renames, by РЭХА's old names.
- 12:06 (card «Только в РЭХА») Songs are merged in РЭХА only. The service
  turns down a rename to another song's title.
- 12:16 (card «И в сервисе») A take can be moved to another song in the
  service too. РЭХА renames it at the check and gives its number.
- 12:37 Tempo and signature change apart, as they do now; when two changes
  meet, the pair wins whole. The service writes the tempo as РЭХА does, with
  ♪ in 6/8.
- 12:38 «там тоже ок» to round 3:
  - A song deleted in the service goes from РЭХА only if this computer has
    none of its takes either. Otherwise it stays in РЭХА and lies in the
    service's Trash, as a song with takes does.
  - The service is the judge, with no clocks: РЭХА sends its own changes at
    once and takes the rest from the service at the check. The change that
    reaches the service later wins.
  - The service gives a song its number, and РЭХА keeps it.
  - From this release on, the service turns away an older РЭХА, which asks
    to be updated.
  - Two different songs with one title: the change that arrives second is
    turned down. The song keeps its old title, and РЭХА says why in the list
    of background work.
- 12:39, 12:40, 12:50 The service's panel that slides in from the right
  turns white. The column on the left stays grey, and РЭХА does not change.
- 12:52 No pop-up windows: things are changed where they stand.
- 12:58 «ок» to the first mockup: ✎ makes the title a field in place, tempo
  and signature beside Key are saved at once, ⋯ at the far right of the row
  (his comment on the mockup).
- 13:04 No words in the interface about what anyone can see: a line under a
  field only when it says something the person cannot see or guess.
- 13:12 Moving a take by renaming it is turned down («мозг ломается»).
- 13:15 «в меню»: ⋯ › **Move to song** on a take.
- 13:24 «список и сообщение»: each change from the service is a line in the
  list of background work, and a check that brought changes also shows a
  notice with **See**.
- 13:27 (card «Пара фраз») On reha.stream, two sentences in the band service
  page's chapter “Nothing gets lost”, with no new picture.

## How it works

A song has one number in РЭХА and in the service, given by the service.
Title, tempo and signature go both ways; files go only from РЭХА to the
service.

| Where | What was done | On the other side | When |
|---|---|---|---|
| РЭХА | **New song** | The song appears in the service with its tempo and signature and the first status | At once; with no internet, when it is back |
| РЭХА | Renamed | Same song, new title; status, key, notes and files stay; its takes' names follow | At once |
| РЭХА | Merged Palyn into Pałyn | Merged in the service too (below); Palyn goes | At once |
| РЭХА | Tempo or signature, Tap included | The song's tempo and signature | At once |
| РЭХА | A take renamed into another song | As now: the take moves there with its stars and marks | At once |
| Service | **New song** | A song with no takes in РЭХА, under **Next take** and among the names offered | At the check |
| Service | Renamed | Renamed in РЭХА as its own rename is: takes, folders, cloud copies, the old title kept as an old name | At the check; folders wait for a take that records |
| Service | Renamed to another song's title | Turned down, saying songs are merged in РЭХА | At once |
| Service | A take moved to another song | Renamed in РЭХА as **Rename take** does: the song's next number, its folder too | At the check |
| Service | Tempo or signature | The song's metronome takes the new tempo | At the check |
| Service | A song deleted that has no takes on this computer | It goes from РЭХА, its backing track to РЭХА's Trash | At the check |
| Service | A song deleted that has takes on this computer | As now: РЭХА keeps everything; a take sent again brings the song back | As now |
| Both | The same thing changed before a check | The change that reached the service later wins | At the check |
| Both | First check after the update, or with a new key | Songs are matched by title; pairs that came apart after renames are joined by РЭХА's old names | Once |

“At the check” means when РЭХА starts, when a rehearsal starts, or within
the hour.

## The service

### What it keeps

Migration `0007_song_sync.sql`. It only adds, as the migrations before it
do, so the Worker before keeps working while the new one goes up.

- `song.signature`: “4/4”, “3/4”, “2/4” or “6/8”, or null. `song.tempo`
  is kept as РЭХА keeps it: a whole number in the signature's own count.
- `song.title_by`, `song.meter_by`, `song.made_by`: the member who last
  renamed it, last changed its tempo or signature, or made it in the
  service; null when РЭХА did. They are what РЭХА's lines say (“Ivan renamed
  it in the band service”).
- `take.go`: the take's number within its song, as РЭХА gives it. The
  migration fills it from the names the service has, where a name is its
  song's title, a space and a number.
- `take.moved_by`: the member who moved the take to another song in the
  service, until РЭХА has given it its number there; null otherwise.

A take's name is worked out when it is read: its song's title and its go
(“Pałyn 8”), the stored name for a take with no song (“Take 14”) or with no
go yet. A rename in the service renames the takes at once, with nothing to
wait for.

Titles follow РЭХА's rules on both sides, compared case-blind in every
alphabet: “Take 14” is what a take with no song is called and cannot be a
song's title; two songs never share a title. The service folds case as
РЭХА does (Python's `casefold`), which differs from `toLocaleLowerCase` in
a few letters such as ß. The tempo is a whole number from 30 to 300, from
60 to 600 in 6/8.

### What РЭХА calls

All with РЭХА's key, as now.

- `POST /api/reha/songs/link`: the first check. РЭХА sends every song it
  shows with its old names, tempo and signature; the answer gives each its
  number. A song is matched by its title. A song of the service whose title
  is one of the РЭХА song's old names is joined to it: renamed when the
  РЭХА title matches no song there, merged into it otherwise. A song that
  matches nothing is made. The service does this in one batch, so a check
  cut short leaves nothing half joined.
- `POST /api/reha/songs`: a song made in РЭХА, with its tempo and
  signature; the answer is its number. A title the service already has is
  that song.
- `PATCH /api/reha/songs/{id}`: a change made in РЭХА: the title, or the
  tempo and signature together. A title another song has is turned down
  (409), saying which song.
- `POST /api/reha/songs/{id}/merge` with `into`: a merge made in РЭХА. The
  takes move to `into`; `into` keeps its status, and its key, or takes the
  merged song's when it has none; the notes go one under the other; the
  files go with them. The merged song is deleted.
- `GET /api/reha/songs`: every song with its number, title, tempo,
  signature, whether it is in the Trash, and who last changed what (by
  name); and every take moved in the service and not yet numbered by РЭХА,
  with its song and who moved it.
- `PUT /api/reha/takes/{uid}` changes: it carries the song's number and the
  take's go (`song_id`, `go`) when РЭХА changed the take's song since it last
  sent it (and always the first time), and leaves them out otherwise; then
  the take keeps its song in the service. While a take waits to be numbered
  after a move in the service, a PUT without them leaves its song and go
  alone, so a ★ does not undo the move. The song's `tempo` no longer rides
  with a take; the take's own `meter` stays.

`MIN_REHA_VERSION` goes up to the version after the last release, 0.23.1
if nothing ships before this. The release itself will be 0.24.0, and a
build of main from source after a tag counts as the next patch
(setuptools-scm makes it 0.23.1.devN), so Alex's own copy is not turned
away. An older РЭХА is answered 426, “Update РЭХА to send takes here”, which
its take's line already shows.

### What the band does

- `PATCH /api/songs/{id}` also takes `title`, and `tempo` with
  `signature`. A title another song has, in the Trash or not, is turned
  down: “Viasna is another song. Songs are merged in РЭХА: Rename song
  there.” “Take 14” is turned down as РЭХА turns it down.
- `PATCH /api/takes/{uid}` with `song`, a song's number, or `new_song`, a
  title: the take moves there and waits for its number. `new_song` makes the
  song, with the first status; a title another song has is turned down:
  “Pałyn is already a song: pick it in the list.”
- **Delete song** puts every song in the Trash, also one that never had a
  take, so РЭХА can learn of it at the check. It leaves the Trash after 30
  days, as songs with takes do now, and **Restore** brings it back.

### The service's screens

As the mockups show them, built from the components the service and РЭХА
share.

- **A song's title**, on its page and in the panel from the right: ✎ beside
  it makes it a field in place. Enter or ✓ renames, Esc or ✕ leaves it. A
  line under the field says only what cannot be seen: why a title is turned
  down, or that its takes become “Dym nad vadoj 1, Dym nad vadoj 2…”,
  each keeping its number.
- **Tempo and signature** beside Key, with РЭХА's own tempo field and
  signature list, saved at once. In 6/8 the service writes ♪ in place of
  “bpm”, as РЭХА does.
- The song's ⋯ stands at the far right of that row, apart from the tempo.
- **Move to song** in a take's ⋯ menu, on the take's page, in the panel and
  in the lists: the band's songs with the take's own ticked, then **New
  song…**, which turns the take's song into a field in its line. Until РЭХА
  numbers it, the take reads “Pałyn · number from РЭХА” in titles and
  “Pałyn” in rows.
- The panel from the right is white in the light theme; the column on the
  left stays grey, and the dark theme does not change. This is the service's
  exception to design-system rule F4, which keeps grey for side panels; the
  rule gets a line saying so.

## РЭХА

### What it keeps

Migration `0014_service_songs`.

- `service_song`: a song's number in the service and what the two sides
  last agreed on for it (title, tempo, signature). One row per song.
- `service_song_merge`: a merge made in РЭХА and not yet told to the
  service, by the two numbers.

A key to another service forgets them with the rest (`forget_service`), as
it forgets the takes.

Three values tell РЭХА who changed what, with no clocks: what it has now,
what the service has, and what they last agreed on. If only РЭХА's differs
from the agreed one, the change is РЭХА's and goes to the service. If only
the service's differs, it is the service's and РЭХА takes it. If both
differ, РЭХА's change has not reached the service yet (it was made with no
internet); it goes now, reaches the service later, and wins, as round 3
said. A take's song works the same way, with what РЭХА last sent of the
take (`ServiceCopy.sent`).

### Sending its own changes

A change to a song (**New song**, **Rename song**, **Merge**, the tempo,
signature or Tap, a backing track's tempo given to the song, a click take
that gives the song its tempo) wakes the sending, which sends it before any
take: a take carries its song's number, so the song goes first. With no
internet it waits, as takes do. A rename the service turns down because
another song has the title is put back in РЭХА, and the song's line in the
list of background work says why: “Zorka is another song in the band
service now. Merge them in РЭХА if they are one song.”

### The check

When РЭХА starts, when a rehearsal starts, and every hour:

1. The first time with this service, `link` (above).
2. What РЭХА changed and has not told the service yet: merges, then songs.
3. `GET /api/reha/songs`, and what it says is done here:
   - a song new to РЭХА is made as **New song** makes one. If its title is
     an old name of a song here, that song forgets the old name first;
   - a title is changed as **Rename song** changes it, folders after any
     take that records. A title that is an old name of another song here is
     forgotten there first;
   - a tempo and signature are set as the song's page sets them;
   - a take moved there is renamed as **Rename take** renames it, and then
     sent with its new song and go. One being cropped waits for the next
     check;
   - a song in the service's Trash, or gone from it, is removed here when
     this computer has none of its takes, its backing track to РЭХА's Trash.
     With takes here, it stays.
4. The takes, as now (`GET /api/reha/takes`).

### What РЭХА shows

As mockup 3, variant B.

- Each change from the service is a line in the list of background work,
  done, with who did it under it: “Pałyn: 132 bpm · 4/4 / Ivan changed the
  tempo in the band service”, “Viasna 3 → Pałyn 8 / Ivan moved it in the
  band service”, “Zorka / New song from Ivan in the band service”, “Zorka /
  Ira deleted it in the band service”. A rename is the line РЭХА's own
  rename makes, “Renaming Dym to Dym nad vadoj · 5 takes”, with “Ivan
  renamed it in the band service” under it. The button reads **Done** until
  the list is opened, as now.
- A check that brought changes shows one notice: “Ivan changed 4 songs in
  the band service”, with **See**, which opens the list. Two people are
  “Ivan and Vik”, more are “The band”. The notice has no ⌘Z, since there is
  nothing to undo.
- A change from РЭХА that loses to the service's says nothing, as decided
  in round 2.

Every check, and every change that lost, is written to РЭХА's error output,
as the service's refusals are now (`sending/band_service.py`), and to the
log when #133 brings one.

## Shipping

The service goes up when the pull request is merged into main, and it then
turns away РЭХА 0.23. So the pull request is merged just before the release,
and the release is published at once; РЭХА updates itself since 0.15.0.
Until a computer has updated, the service turns its takes down with “Update
РЭХА to send takes here”, and РЭХА 0.23 then leaves them unsent. So the new
РЭХА, when it first starts, sends again every take turned down for that
reason alone.

## Words

- The guide (`docs/using-it.md`), “Sending takes to a band service”: songs
  go both ways now, what happens to each change, and when РЭХА learns of
  it.
- CHANGELOG, under Unreleased, one item starting in bold.
- reha.stream, the band service page, “Nothing gets lost”: two sentences,
  roughly “A take filed under the wrong song moves to the right one with ⋯ ›
  **Move to song**, and a song's title or tempo changes where it stands.
  РЭХА learns of it within the hour and says who changed what.” Alex sees
  the page before release.
- The service's API descriptions that say a title comes from РЭХА.

## Tests

- The Worker (vitest): `link` with matches, joins and merges; each РЭХА
  call; the two refusals; a ★ that does not undo a move; take names after a
  rename; **Delete song** of a song that never had a take; 426 for 0.23.
- РЭХА (pytest): the three-way choice for each field; the check's order;
  each change from the service; a rename turned down and put back; old names
  forgotten; a song removed or kept; the lines and the notice's words; a
  key to another service.
- The service's screens and РЭХА's notice (Playwright), one test each for
  what a person does.

While building, only the tests a change touches run, once each; the full
suites run once, on CI.

## Calls Claude made

Alex did not pick these; each can change.

1. Songs in the service are found by number; the title is only the name.
   The first check is the one place titles are matched.
2. The first check sends the songs РЭХА shows in History, with their old
   names. A song РЭХА hides (its takes all deleted, no backing track) is not
   sent.
3. Who changed a song or moved a take is kept in the service, so РЭХА's
   lines can name them.
4. A take's name in the service is worked out from its song's title and its
   go, so a rename there needs no wait; the migration fills the go from the
   names already there.
5. A take moved in the service shows “Pałyn · number from РЭХА” until the
   check.
6. **Delete song** in the service puts a song that never had a take in the
   Trash too, rather than deleting it at once, so РЭХА can learn of it; it
   can now be restored.
7. A merge keeps the target's key, or takes the merged song's when the
   target has none, as РЭХА does with the tempo.
8. Files of a merged song are copied to the target's place in storage and
   the old copies deleted; storage has no move.
9. A rename РЭХА made that the service turns down is put back in РЭХА, so
   the two never disagree for long.
10. The notice names up to two people; more are “The band”.
11. The check also runs when a rehearsal starts, as round 1 said, before the
    first take.
12. The PUT of a take sends the song only when РЭХА changed it; this is how
    “РЭХА sends only its own changes” works for takes.
13. Takes an older РЭХА left unsent because the service asked for an update
    are sent again by the new one on its first start.
14. The minimum version the service takes is the next patch, 0.23.1, so
    Alex's build of main is not turned away.

## Not in this

- Merging songs in the service.
- Files from the service to РЭХА, and assembled takes coming back.
- Sets in the service.
