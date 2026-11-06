# Taking a take out of its song in the band service

A take gets its song from the name field in РЭХА. When the band jams with
Viasna still in the field, the jam comes to the band service as Viasna 13
and sits among Viasna's takes. Until now the service could only move it to
another song or to a new one (⋯ › **Move to song**). This change adds
**Not named** to that list: the take leaves its song and goes to **Not
named**, where takes nobody named a song are, and РЭХА does the same on
the laptop at its next check.

The mockup Alex picked from is https://claude.ai/artifact/LQ3bPEm7DtCTayXdvMp2hu
(the service's own pages on answers recorded from a local Worker; source in
/mnt/project-files/band-service/take-out/q1-mock/).

## Alex's picks

All on 5 November 2026 (UTC).

- 23:26-23:30 In the thread about 0.23.0 he asked whether a jam that came
  to the service inside a song can be taken out of it, and said «хочу.
  давай сделаем» to doing it right in the service.
- 23:39 **Not named** is the first line of ⋯ › **Move to song** (card «A.
  Not named в Move to song»), so it works from every take's line in the
  lists too, as **Move to song** does.
- 23:40 Nothing on reha.stream (card «Ничего не добавлять»): the change is
  in the guide and CHANGELOG only.

In the message before the first card Claude wrote that РЭХА follows (renames the take to Take N at its
check), as it does for **Move to song** since 0.24.0, and that the song
stays even with no takes left. Alex did not object; they are listed under
Calls Claude made, since he did not pick them.

## What the band sees

⋯ › **Move to song** on a take opens the list it has now, with **Not
named** on top and a line under it:

    Not named
    ─────────
    Kupalle
    Pałyn      ✓
    Viasna
    ─────────
    New song…

The tick is where the take is now. A take already in **Not named** has the
tick on **Not named**, and picking it again does nothing.

Picking **Not named** takes the take out of its song at once:

- Its name becomes Take and its number in the rehearsal, Take 3, the name
  РЭХА gives a take with no song. The service knows the number, so there is
  no wait for РЭХА and no “number from РЭХА” after the name.
- On the rehearsal's page it moves from its song's group to **Not named**,
  last. On **Songs** it shows under **Not named**. On the song's page it is
  gone; the song's best take, count, length and dates follow from the takes
  left, as they already do.
- Its stars, marks, replies and files stay with it. Its page and panel stay
  open, under the new name.
- The song stays, even with no takes left, as any song does. The band can
  delete it with ⋯ › **Delete song**.

Anyone in the band can do it, as with **Move to song**. A take in the
**Trash** has no ⋯, as now.

To put it back, ⋯ › **Move to song** › the song.

## What РЭХА does

РЭХА asks the service what the band changed when it starts, every hour,
and when a rehearsal starts (song sync, 0.24.0). The answer already lists
every take the band moved (`moved`, with `song_id` null for this one).
For a take moved to no song РЭХА:

1. renames it to Take and its number, as typing that in **Rename take**
   does: the take leaves its song, and its folder and cloud copies take the
   new name;
2. adds a line to the list of background work, “Viasna 13 → Take 3”, with
   “Ivan moved it in the band service”, and counts the song it left in the
   notice (“Ivan changed 1 song in the band service”);
3. sends the take again with no song and its new name, which ends the wait
   in the service, as for any move.

The rules **Move to song** has keep:

- Renamed in РЭХА since it last went: РЭХА's change goes and wins, and the
  take goes back where РЭХА has it.
- Already with no song in РЭХА: nothing is renamed; the take goes again so
  the service stops listing it.
- Being cropped: it waits for the next check.

## How it is built

### Service

- `PATCH /api/takes/{uid}` also takes `{ "song": null }`. The take gets
  `songId` null, `name` “Take {number}”, and `movedBy` the member, so РЭХА
  learns of it. A take with no song already answers ok and changes nothing.
- `moved` in a take's row and page is true only for a take moved to a song
  (`movedBy` set and `songId` not null): it is what makes the name read
  “Viasna · number from РЭХА”, and a take with no song has its number.
- `GET /api/reha/songs` needs no change: it already lists every take with
  `movedBy`, `song_id` null included.
- `useMoveTake` takes `{ song: null }`; `MoveSub` draws **Not named** first,
  a separator under it.
- The hint by **Not named** said “takes recorded in РЭХА without a song's
  title” on **Songs** and “recorded in РЭХА without a song's title” on a
  rehearsal's page. That is no longer true, so it becomes the count of
  takes, as every other group's hint is.
- `openapi.json` is made again.

No migration: `take.moved_by` is there since 0.24.0.

### РЭХА

- `ServiceSongs._moves` (sending/service_songs.py) reads `song_id` null
  as no song: the new name is `Take {take_number}`, through
  `api.rename_take`, as for a song. The notice counts the song the take
  left.
- A take already with no song goes again by clearing what was last sent of
  its name, so `_put` sends its song and name.
- `tests/fake_band_service.py` gets the same move to no song.

## Words

- The list: **Not named**, as the group the take goes to.
- The guide (docs/using-it.md, the band service's songs) and CHANGELOG
  under Unreleased: a take that is no song's goes to **Not named** from
  the same list, and РЭХА renames it to Take and its number.
- Nothing on reha.stream (Alex, 23:40).

## Tests

- Service (vitest): the move to no song (name, song, `moved` false, listed
  for РЭХА with `song_id` null); again on a take with no song changes
  nothing; РЭХА sending it with no song ends the listing.
- Service (Playwright, takes.spec.ts): ⋯ › **Move to song** › **Not named**
  from a song's page: the take is Take N under **Not named**, and the list
  ticks **Not named** after.
- РЭХА (test_sending.py): a take moved to no song there is renamed Take N
  here, with its line, and sent with no song; one renamed here first keeps
  РЭХА's name; one with no song here already only goes again.

While developing, only the tests a change touches run, once each; the full
suites run once, on CI.

## Calls Claude made

1. РЭХА follows the move and renames the take to Take N, as with **Move to
   song** (Alex's 0.24.0 pick «И в сервисе»).
2. The song stays when its last take leaves.
3. The service names the take Take N at once, with no “number from РЭХА”.
4. The **Not named** hint becomes the count of takes, since “recorded in
   РЭХА” is no longer always true.
5. The notice in РЭХА counts the song the take left.
6. Picking **Not named** for a take already there does nothing, with no
   call to the service.

## Not in this

- Taking several takes out at once.
- The same in РЭХА: **Rename take** with Take N already does it there.
