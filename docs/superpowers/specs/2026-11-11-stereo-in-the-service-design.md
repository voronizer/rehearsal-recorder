# Stereo in the band service's player, and a ring on every track

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
5. A file in the service is kept by the browser for a day
   (`service/worker/files/routes.ts:50`); a page keeps a wave for as long as
   it is open (`service/src/api.ts:179`).

## Alex's picks

All on 11 November 2026 (UTC).

- 19:00 «моно треки сервис нормально воспроизводит - по центру панорамы?»
- 19:04 «в рэхе по моему есть в плеере значки моно это или стерео. и уровень
  прыгает зелененьким в одну или две полоски. нет? и почему в сервисе
  такого нет?»
- 19:08 «так, бля, давай сделаем нормально все»: the service shows stereo as
  РЭХА does, its level in two bars and its wave in two halves, on a
  computer and on a phone; РЭХА sends both sides, so it needs a release.
- 19:17 Card «C. Значок у всех» (mockup
  https://claude.ai/artifact/2eWNXSmMDZ8ia6tWVmgdyk): one ring after a mono
  track's name and two after a stereo one's, on every track, in РЭХА's
  player and in the service.
- 19:18 Card «A. Дослать»: for takes already in the service, РЭХА sends the
  wave of each stereo track again, in the background. A take whose files
  are gone from the computer keeps one wave.
- 19:20 «мы досылаем вторую половину - а бля волну в стерео мы рисуем?»:
  answered that РЭХА already draws a stereo wave, left above the line and
  right below, and the service will draw it with the same component.
  Offered a mockup of two separate waves, one over the other, as a DAW
  draws them; no answer yet.
- 19:21 Card «A. Только картинки»: on reha.stream the pictures with tracks
  are taken again, and the rings show on them; no new text.

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
on a computer, the wave keeps its two halves.

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

## How it is built

- РЭХА: a stereo track's `.peaks` gets a row per side beside the row it has
  now (`sides`), which stays for an older service and for the take's wave
  in the service's lists (`service/worker/takes/shape.ts:19`). A mono
  track's file is as it was.
- РЭХА: the background pass that sends the tempo line to takes already up
  also sends `.peaks` again for each stereo track, once per take, through
  the same upload route.
- Service: the wave files are checked with the service each time they are
  asked for (ETag), so a wave sent again shows at the next opening of the
  take, not a day later.
- Service: a track's channels come from the `.peaks` when it has `sides`,
  and otherwise from the first bytes of its MP3 (a ranged request), read
  when the take's page opens.
- Service: each track's meter is split into its sides after its level, so
  a stereo track reports two numbers; Master stays one bar.
- Shared (`ui/src`): `LaneControls` draws the rings for every track with
  sound, from the channels it is given. Its comment on why nothing said
  mono or stereo goes.

## Pictures and the guide

- The guide's pictures with the player are taken again
  (`tests/docs_screenshots.py`), since every track now has rings.
- The service's pictures with tracks are taken again
  (`service/pictures/`): lanes, mark, three-weeks-ago, downloads.
- `docs/using-it.md`: the player's tracks get a line on the rings; the
  band service part says the service shows stereo as РЭХА does and that
  takes already up get their waves in two halves after the update.
- The Backing track's text about its rings stays (`docs/using-it.md:1577`).
- CHANGELOG, under Unreleased: the rings in РЭХА's player; stereo in the
  service; the waves sent again.

## Words

“Mono file” and “Stereo file” in the rings' tip, as the Backing track's
plate has now. No other new words.

## Tests

- РЭХА's screens: rings on every track with sound, one or two by its file;
  none on notes and Master; the name keeps its tip when cut.
- Service page: a stereo track's two bars and two-half wave, from `sides`
  and from an MP3 with no `sides`; the phone's desk the same.
- Service player: two levels for a stereo track, one for mono.
- РЭХА Python: `.peaks` with `sides` for a stereo file, without for mono;
  the background pass sends `.peaks` once for a take with a stereo track
  and not for an all-mono take, and skips a take whose files are gone.

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

## Not in this

- Pan or balance per track.
- How the take's Backing track shows in the service. РЭХА sends it as one
  of the take's tracks (`sending/service_files.py:53`), so the service shows
  it as an ordinary track: no dashed frame, and heard from the start, since
  its M in РЭХА is not sent. It gets its rings with every other track.
