# The band's service: РЭХА's player on a take's page (#94)

A take's page in the service gets РЭХА's own player: the transport, the
map and zoom, a lane per track with its wave, its level, M and S, a piece on
repeat, the marks as chips. The service's own lanes on that page go. One
player screen then serves РЭХА and the service, with the sound behind one
interface: Python in РЭХА, the browser in the service.

The clickable prototype is https://claude.ai/artifact/6CmaPVRS6m8BqvanGjv3g5
(v38; source in `service/mock/`, not committed, copy in
/mnt/project-files/band-service/player/mock/). It runs РЭХА's real
`TakePlayer` on the interface's fake Python. Every answer behind it, with
its time, is in /mnt/project-files/band-service/player/decisions-log.md.
Where this spec and the prototype differ, this spec wins; each such place
is said below.

## Alex's picks

In the thread «Поставить плеер РЭХИ в сервис», 1 and 2 November 2026 (UTC).

- 23:42 The player (#94) comes next. What else the concept had is parked as
  issues #104-#113.
- 23:52 The full player lives on the take's page. The take's panel keeps
  its simple player.
- 23:56 Each member has their own track levels: they start from the
  balance РЭХА sent with the take, are kept by track name for that member
  only, and there is a way back to РЭХА's balance.
- 23:57 Mockups build on the service prototype, not on a page drawn anew.
- 00:10 No frame round the player; it sits on the page as in РЭХА.
- 00:32 Marks are chips in the player, as in РЭХА. Pressing one opens its
  talk in the panel from the right. Downloads go under the player.
- 00:35 On a phone: the take's one wave with its marks, and under it a row
  per track as on РЭХА's desk (name, level, M, S), no wave per track.
- 00:38 The player is split into a screen and its sound, behind a typed
  interface. РЭХА plugs in Python, the service the browser.
- 00:39 The wave when zoomed in is worked out in the browser, from the MP3
  it already holds, as РЭХА works it out from the WAV.
- 00:40 On reha.stream the chapter “Hear your own part” also tells of your
  own levels; the other pictures are taken again.

## What the band sees

### A take's page on a computer

Back to the song, the take's name, **★ at rehearsal**, who starred, the
line “Thursday, 29 October · 4:05 · 4 tracks”, as in part 2. Then РЭХА's
player across the page, on the page itself, with no card or frame round it:

- the transport: to the start, back 10 s, ▶, on 10 s, the time,
  **Repeat**, **Mark**, the keys button;
- the map of the whole take while zoomed in, and zoom with Ctrl and the
  wheel, down to 2 seconds across;
- a lane per track: its name, its level, M and S, its wave; a drag across
  the lanes sets the piece **Repeat** plays;
- the marks, as chips under the lanes and as lines across them.

Under the player a line says “Levels as РЭХА sent them.”, or “Your levels.
Only you hear them.” once you have moved one, with **РЭХА's levels** on its
right to go back. Then **Download tracks**, as in part 2.

What РЭХА's player has and the service does not, it does not show: the
Master row (no click, no master level), the metronome, the band's tempo
along the take, MIDI lanes, **Crop**.

A take in the Trash shows its player as any other, under the line with
**Restore**.

### Marks in the player

Pressing a mark chip (its words or its pencil) opens the panel from the
right with that mark: its label, its note, the talk under it, **Comment**,
**Close**, as a mark shows in **Marks**. A mark has no ✕ on its chip; who
wrote it deletes it in the panel, as in part 2.

**Mark** fixes the moment and opens the panel with a new mark there, its
label and note to fill in, as the bar's **Mark** does. The player keeps
playing.

This replaces the prototype's v36 page with marks on the right (part 2,
17:40): with the full player that column left the lanes no room.

### On a phone

Under the take's line: ▶ and the take's wave with its marks, as in part 2.
Then **Tracks**: a row per track as РЭХА's desk draws it, the track's name,
its level, M and S. No wave per track, no zoom, no **Repeat**. Then the
marks and their talk, then **Download tracks**, as in part 2.

### Your levels

A track's level is yours: the level you last set for a track of that name,
in any take, on any device you sign in on. A track you have not touched
plays at the level РЭХА sent with the take (its `balance`). **РЭХА's
levels** forgets your levels for this take's tracks, and they play at
РЭХА's balance again.

Your levels play only for you. Nobody else in the band hears them, and they
never go back to РЭХА. The mix to download stays as РЭХА made it.

The bar at the bottom and the take's panel play at the same levels, since
they are the same player.

### Keys

As in РЭХА: Space plays and stops, Esc closes; the arrows, Home, M (mark),
R (repeat) and ? (the list of keys). T, which taps a tempo in РЭХА, does
nothing here. The keys button lists them. They always work: РЭХА switches
them off in Settings › Keys, and the service has no settings.

### Unchanged

The bar at the bottom, the take's panel and every list stay as in part 2.
One take plays at a time, wherever its ▶ was pressed.

## What РЭХА does

Nothing new is sent. РЭХА's player looks and works as before; only its code
is split (below).

## On reha.stream

The chapter “Hear your own part” on reha.stream/band-service also tells
how each of you sets your own levels, which only you hear. Its picture,
`lanes`, is taken again on a phone: the take's wave and the desk rows, the
guitar's level up. The other pictures of the take's page are taken again
with the new page (`npm run pictures` in `service/`). The chapter's story
comes from Alex's band; Alex checks it before it goes live.

## How it is built

### One player screen, two sounds

`ui/src/lib/playerSound.ts` holds the interface between the player's
screen and its sound:

```ts
export type PlayerSound = {
  open(tracks: TrackFile[], reuse?: boolean): Promise<PlayerState>
  /** The tracks' waves, for the whole take or, zoomed in, a stretch of it. */
  media(tracks: TrackFile[], buckets?: number, from?: number, to?: number): Promise<TrackMedia[]>
  state(): Promise<PlayerState>
  play(): Promise<PlayerState>
  pause(): Promise<PlayerState>
  toggle(): Promise<PlayerState>
  seek(seconds: number): Promise<PlayerState>
  setLoop(a: number | null, b: number | null): Promise<PlayerState>
  setMuted(name: string, muted: boolean): Promise<PlayerState>
  setSolo(name: string | null): Promise<PlayerState>
  setVolume(name: string, volume: number): Promise<unknown>
  setMaster(volume: number): Promise<unknown>
  /** Where the levels are kept: РЭХА's settings, or the member's in the service. */
  keepLevels(volumes: Record<string, number>): Promise<unknown>
  close(): Promise<unknown>
}
```

`TrackFile`, `TrackMedia` and `PlayerState` are the types `lib/api.ts`
has now, and each call answers in the shape its bridge call does, so the
hook changes by name only. `pythonSound` in the same file answers each call with the bridge
call it stands for (`player_open`, `take_media`, `player_state` by the same
poll as now, `save_mix`, and so on).

`useMultitrackPlayer(tracks, duration, song, sound = pythonSound)` calls
the sound instead of `api()`. What only РЭХА has stays outside the sound:
the song's backing track heard (`set_song_backing_heard`) and the listening
level in the header (`lib/listening.ts`). Every screen of РЭХА passes
nothing new, so РЭХА behaves exactly as before.

The player reads one more thing besides its sound, the labels: the
service fills РЭХА's label store with `labelsChanged` (exported already)
from its own labels. The keys need nothing: they are on until
`loadKeys` says otherwise, and the service never calls it.

`TakePlayer` and `Timeline` get `master={false}` to leave out the Master
row; РЭХА's screens pass nothing and keep it.

### The service's sound

`service/src/takes/player/sound.ts` makes a `PlayerSound` from the
service's one player (`one.tsx`, `player.ts`). The player learns:

- a track's level while playing (it now takes each level once, at the
  start);
- a piece on repeat: from the piece's end it goes on from its start
  without a gap, the start decoded ahead and placed on the same clock, as
  the tracks are kept in step now;
- a stretch's wave: the frames of that stretch of each MP3 it holds,
  decoded by a decoder of their own and reduced to peaks, as many as
  `take_media` gives РЭХА. Until a stretch of the MP3 has come, its wave is
  the coarse one from `.peaks`.

`open` gives the tracks' waves from their `.peaks` files (1200 points),
their levels (yours where you have one, else the take's `balance`) and the
player's state; `state` reads the one player's clock.

### Data

Migration `0002_levels`: a table `level`, one row per member and track
name: the member, the track's name, the level.

### API

- `GET /api/me/levels`: your levels by track name.
- `PUT /api/me/levels`: levels by track name to keep; a level of `null`
  forgets that track (what **РЭХА's levels** sends).

Each answers for the member signed in only. `openapi.json` is made again.

### The pages

- `takes/Take.tsx`: the take's page as above; `TakePanel.tsx` loses
  `Lanes` from the page (the panel keeps it).
- `takes/Desk.tsx`: the phone's rows, from РЭХА's `LaneControls`.
- `marks/`: a panel for one mark, opened from a chip, with a new mark's
  draft when **Mark** was pressed.

### Tests

While building, only the tests a change touches, each once; the full
suites once on CI.

- РЭХА: the tests of the player stay as they are and pass
  (`src/components/TakePlayer.test.ts`, `e2e/player.spec.ts`,
  `history.spec.ts`, `review.spec.ts`), which shows the split changed
  nothing. A unit
  test for `pythonSound` checks each call goes to its bridge call.
- Service, Worker: the levels routes (yours only, `null` forgets).
- Service, pages in Node: the peaks of a stretch from MP3 frames; where a
  repeated piece's start is placed on the clock.
- Service, pages in the browser: the take's page draws a lane per track
  and the chips; a chip opens its mark in the panel; a level moved is the
  level after a reload, and **РЭХА's levels** brings back the balance; the
  phone shows the desk rows and no lanes.

## Not in this part

Slowing a take down (#105), comparing two takes (#104), a master level in
the service, **Repeat** and zoom on a phone, MIDI lanes.

## Calls to review

1. Keys as in РЭХА without T, always on: the service has no settings to
   switch them off. At 00:40 I told you their switch would be kept per
   member; РЭХА's player has no such switch, it lives in Settings › Keys.
2. Your levels are kept in the service, so they follow you from the phone
   to the computer; not in the browser.
3. **РЭХА's levels** forgets your levels only for this take's tracks.
4. Levels never go back to РЭХА; the mix to download stays as РЭХА made it.
5. No Master row on the take's page: the service has no click, and its
   master level is the device's volume.
6. A mark chip has no ✕; marks are deleted in their panel by who wrote them.
7. **Mark** on the take's page opens the panel with a new mark, as the
   bar's **Mark** does.
8. The phone has no **Repeat** and no zoom; the computer has both.
9. A piece on repeat loops without a gap. If the browser cannot place it
   seamlessly on some phone, a short gap is the fallback, not a stop.
10. Until a stretch of the MP3 has come, the zoomed wave is the coarse one.
11. The pictures: `lanes` on a phone with the guitar's level up; the rest
    of the take's page taken again as they are.
