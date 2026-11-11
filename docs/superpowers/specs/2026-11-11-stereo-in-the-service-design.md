# Stereo and the Backing track in the band service's player, and a ring on every track

On 11 November 2026 Alex asked whether the band service plays a mono track
in the middle. It does: a mono track sounds in both speakers at the level
of its file, with nothing taken off for the middle (checked in the code and
in Chromium). He then asked why the service has no mono and stereo signs
and no level in two bars, as he remembered РЭХА having, and asked for it to
be done properly.

What Claude found in the code (main at a57de94):

1. РЭХА's player has no sign on a band's track. One ring or two are on the
   start screen's **Stereo** button (`ui/src/components/TrackRow.tsx:148`)
   and on the Backing track's plate (`ui/src/components/LaneControls.tsx:223`).
   A stereo track shows itself by its level in two bars, left above right
   (`LaneControls.tsx:24`, `:51`), and by its wave in two halves, left above
   the line and right below (`ui/src/components/Waveform.tsx:28`).
2. The service always draws one bar and one wave, even for a stereo track.
   Each track has one meter, and it mixes the two sides into one
   (`service/src/takes/player/player.ts:433`, `sound.ts:74`). The wave comes
   from the track's `.peaks`, which РЭХА writes as one row, the louder side
   in each slice (`src/rehearsal_recorder/sending/service_files.py:205`;
   `sound.ts:145`). The phone's desk writes one bar outright
   (`service/src/takes/Desk.tsx:36`).
3. This was Claude's own call while building the service's player (#94,
   2 November: "stereo shown as one" in its build notes). Alex was not
   asked.
4. A `.peaks` of a take already in the service can be sent again: the
   upload route takes any file the take's generation lists
   (`service/worker/uploads/routes.ts:37`). РЭХА already sends takes that are
   up the tempo line in the background (`sending/band_service.py:1076`).
5. The take's Backing track goes to the service as one of the take's
   tracks: РЭХА sends every track that has a file
   (`sending/service_files.py:53`), and the library lists Backing among
   them (`store/library.py:294`). The service draws it as a band's track,
   with no dashed frame, and plays it from the start: РЭХА sends the
   tracks' levels (`service_files.py:117`) but not Backing's M. Claude
   first told Alex the service had no Backing at all, and corrected it.
6. In РЭХА, Backing is muted the first time a take of its song opens; after
   that it opens as M was last left for that song
   (`ui/src/hooks/useMultitrackPlayer.ts:65`). The service keeps each
   member's level for a track by its name (`service/worker/shared/schema.ts:456`)
   and keeps no M.
7. A file in the service is kept by the browser for a day
   (`service/worker/files/routes.ts:50`); a page keeps a wave for as long as
   it is open (`service/src/api.ts:179`).

## Alex's picks

All on 11 November 2026 (UTC).

- 19:00:23 «моно треки сервис нормально воспроизводит - по центру панорамы?»
- 19:04:30 «в рэхе по моему есть в плеере значки моно это или стерео. и
  уровень прыгает зелененьким в одну или две полоски. нет? и почему в
  сервисе такого нет?»
- 19:08:16 «так, бля, давай сделаем нормально все»: the service shows stereo
  as РЭХА does, its level in two bars and its wave in two halves, on a
  computer and on a phone; РЭХА sends both sides, so it needs a release.
- 19:17:44 Card «C. Значок у всех» (mockup
  https://claude.ai/artifact/2eWNXSmMDZ8ia6tWVmgdyk): one ring after a mono
  track's name and two after a stereo one's, on every track, in РЭХА's
  player and in the service.
- 19:18:18 Card «A. Дослать»: for takes already in the service, РЭХА sends
  the wave of each stereo track again, in the background. A take whose
  files are gone from the computer keeps one wave.
- 19:20:41 «мы досылаем вторую половину - а бля волну в стерео мы
  рисуем?»: answered that РЭХА already draws a stereo wave, left above the
  line and right below, and the service will draw it with the same
  component. Offered a mockup of two separate waves, one over the other, as
  a DAW draws them.
- 19:21:18 Card «A. Только картинки»: on reha.stream the pictures with
  tracks are taken again, and the rings show on them; no new text. (Asked
  before Backing joined this work.)
- 19:22:18 «кстати про Backing. он до сервиса доезжает?»
- 19:24:11 «да» to showing Backing in the service as in РЭХА: its dashed
  frame, and muted when a take opens. Claude put it in this same work: the
  same files and the same release of РЭХА.
- 19:25:16 Card «A. Как в РЭХА, у каждого»: in the service, Backing is
  muted the first time you open a take of its song; after that it opens as
  you last left M for that song. Each member has their own, on any device,
  as with the levels. So the service's M and РЭХА's do not sync.
- 19:27:47 Card «A. Как в РЭХА сейчас»: the stereo wave stays as РЭХА
  draws it, one wave with the left side up from the line and the right side
  down; no DAW mockup.
- 19:29:37 «ок» to this spec.
- 19:52:09 Card «A. Барабаны стерео», asked after the plan's check: Drums is
  a stereo track in the demo band's data, as the site's story says
  (`site/content/stories/digital-mixer.md:100`), so the pictures and the
  site's live pieces show two rings, two bars and a wave in two halves on
  it.
- 19:53:19 Card «A. Ничего нового»: reha.stream says nothing new about
  Backing in the service; its pictures are only retaken, as for stereo.
- 19:54:15 Card «A. Не менять»: `service/README.md` stays as it is; a
  band gets this by **Sync fork**, and the deploy adds the new table.
- 19:54:59 «ок» to the plan
  (`docs/superpowers/plans/2026-11-11-stereo-in-the-service.md`).
- 21:18:01 Card «A. Как на странице», asked while building: a take played
  with ▶ from a list starts its Backing as its page does, muted unless
  you turned it on for that song.
- 21:52:50 Card «A. Только в плеере», asked while building: Drums is a
  stereo file in the demo data, and the start screen keeps it mono on
  input 1, as now.

## What the band sees

### The rings

After a track's name, in the player, one ring says the track is a mono
file and two rings a stereo one, as the Backing track has them now. Every
track with sound has them: in РЭХА's player, on a take's page in the
service on a computer, and on the phone's desk. Hovering the rings shows
“Mono file” or “Stereo file”. The MIDI sign, where a track has one, comes
after the rings. A track of notes alone, the notes' row under a track, and
Master have none.

The rings say what the file is, not how the band is set up today: a take
recorded before the keyboard went stereo keeps one ring.

### Level and wave

A stereo track in the service shows its level in two bars, left above
right, and its wave in two halves, left above the line and right below,
as РЭХА's player does. A mono track keeps one bar and one wave. Zoomed in
on a computer, the wave keeps as many parts as it has zoomed out: two
halves when РЭХА sent both sides, one piece when it did not.

A track whose MP3 cannot be read for its channels has no rings and one
bar, and plays as before.

### Takes already in the service

The rings and the two bars are right on every take, old or new: the
service reads how many channels a track has from the track's own MP3.
Only the wave in two halves needs РЭХА: after the update, РЭХА sends the
waves of the stereo tracks of takes already up, one take at a time, in the
background, with nothing in the list of what is being sent. A take whose
files are no longer on the computer keeps a wave in one piece, with two
rings and two bars.

A band whose service is older than this РЭХА sees no change: the new wave
file still holds the one row an older service reads.

### The Backing track

A take recorded with the song's backing track shows **Backing** in the
service as РЭХА shows it: the last track, right above Master, even when
the take has a track of notes alone, its plate and wave in a dashed
frame, with its rings. On the phone's desk its row has the dashed frame
too, last before Master.

The first time you open a take of a song, Backing is muted, so you hear
the band on its own. Turn **M** off, and every take of that song opens for
you with the backing track heard, on the phone and on the computer, until
you turn **M** on again. The others keep their own. The same holds when you
play a take with ▶ from a list, without opening it (21:18:01). A take with no song,
or whose song is in the Trash, opens with Backing muted, and nothing is
kept. If M cannot be kept, nothing is said: M stays as pressed on this
page.

Backing's M in the service and in РЭХА do not sync: what РЭХА keeps for a
song is not sent, and a member's M does not come back to РЭХА (19:25:16).

Its level, S, and the mix you download work as for any track: muted, it is
not in the mix.

Takes already in the service get this too: РЭХА marks Backing among the
take's tracks when it sends a take, and adds the mark to takes already up
in the same background pass that sends the waves. That needs no files, so
every take gets it. A service too old to keep the mark says so in its
answer, and РЭХА tries again after its hourly look at the service, so a
band that updates its service later still gets it.

## How it is built

- РЭХА: a stereo track's `.peaks` gets a row per side beside the row it has
  now (`sides`), which stays for an older service and for the take's wave
  in the service's lists (`service/worker/takes/shape.ts:19`). A mono
  track's file is as it was.
- РЭХА: a background pass of its own, beside the one that sent the tempo
  line, sends `.peaks` again for each stereo track of a take already up,
  once per take, through the same upload route. РЭХА keeps which takes it
  has done.
- Service: the wave files are checked with the service each time they are
  asked for (ETag), and the page asks past the browser's own copy, so a
  wave sent again shows at the next opening of the take, not a day later.
- Service: a track's channels come from the `.peaks` when it has `sides`,
  and otherwise from the first bytes of its MP3 (a ranged request), read
  when the take's page opens.
- Service: each track's meter is split into its sides after its level, so
  a stereo track reports two numbers; Master stays one bar.
- РЭХА: each track in a take's details says `kind: "backing"` for the
  Backing track; the same pass sends the details again for takes already
  up that have one.
- Service: a take's tracks keep `kind` (they are JSON in the take's row,
  so no change to the table's shape). The page passes it to the player as
  РЭХА's own does, so the dashed frame and the M rule come from the shared
  hook (`useMultitrackPlayer.ts`).
- Service: a new table keeps, per member and song, whether Backing is
  heard, with a route for the page to read and set it.
- Shared (`ui/src`): `LaneControls` draws the rings for every track with
  sound, from the channels it is given, and takes the tip's words from them
  too. Its comment on why nothing said mono or stereo goes.
- `docs/design-system.md` C6: every audio plate has one or two rings after
  its name, tip “Mono file” or “Stereo file”, the MIDI sign after them;
  notes plates and Master have none; Backing is told apart by its dashed
  frame.

## Pictures and the guide

- Drums is stereo in the demo band's data (19:52:09): `ui/e2e/band.js`
  for РЭХА's screens, the guide's pictures and the site's live pieces,
  `service/pictures/seed.ts` for the service's pictures.
- The guide's pictures with the player are taken again
  (`tests/docs_screenshots.py`), since every track now has rings.
- The service's pictures with tracks are taken again
  (`service/pictures/`): lanes, mark, three-weeks-ago, downloads.
- The site's live pieces (its first screen and the story) run РЭХА's
  player from `ui/src`, so they show the rings from the merge on, before
  РЭХА's release.
- `docs/using-it.md`: the player's tracks get a line on the rings, and on
  a stereo track's level in two bars and its wave in two halves; the
  band service part says the service shows stereo and Backing as РЭХА
  does, that Backing's M is each member's own, and that takes already up
  get their waves in two halves after the update.
- The Backing track's text about its rings stays (`docs/using-it.md:1577`).
- CHANGELOG, under Unreleased: the rings in РЭХА's player; stereo in the
  service, with the waves sent again; Backing in the service.

## Words

“Mono file” and “Stereo file” in the rings' tip, as the Backing track's
plate has now. No other new words.

## Tests

- РЭХА's screens: rings on every track with sound, one or two by its file;
  none on notes and Master; the name keeps its tip when cut.
- Service page: a stereo track's two bars and two-half wave, from `sides`
  and from an MP3 with no `sides`; the phone's desk the same.
- Service player: two levels for a stereo track, one for mono.
- Service Backing: dashed and last on a computer and a phone; muted the
  first time a take of its song opens; M kept for that member and song and
  read on the next take; another member unaffected; a take with no song
  muted and nothing kept; muted Backing left out of the downloaded mix.
- РЭХА Python: `.peaks` with `sides` for a stereo file, without for mono;
  the background pass sends `.peaks` once for a take with a stereo track
  and not for an all-mono take, and skips a take whose files are gone;
  the details mark Backing, and the pass sends them again once for a take
  that has one, files or not.

## Calls Claude made

1. The rings' tip says “Mono file” and “Stereo file”, the Backing track's
   words.
2. The MIDI sign comes after the rings.
3. Channels in the service are read from the MP3 when the wave file does
   not say, so old takes show rings and bars without a release.
4. The `.peaks` keeps its one row and adds `sides`, so older services and
   the lists' row waves keep working.
5. Wave files are revalidated on every request (ETag), so a wave sent again
   shows without waiting a day.
6. Master keeps one bar.
7. The service knows Backing by the mark РЭХА sends, not by its name, so
   a band's track called “Backing” stays a band's track.
8. A take with no song opens with Backing muted and keeps nothing.
9. Backing's level is kept by name like any track's, so one level serves
   every song's Backing.
10. The pass shows no line in the list, as the tempo pass does
    (`band_service.py:1081`).
11. Pan per track is not in this work.
12. If Backing's M cannot be kept, nothing is said.
13. A track whose channels cannot be read has no rings and one bar.

## Not in this

- Pan or balance per track.
- The song's backing track file itself stays РЭХА's only
  (`docs/using-it.md:928`).
