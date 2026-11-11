# Stereo and the Backing track in the band service: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every track with sound shows one ring (mono) or two (stereo) in
РЭХА's player and the service; the service shows a stereo track's level in
two bars and its wave in two halves, and the take's Backing track as РЭХА
does, its M kept per member and song; РЭХА sends both sides of a stereo
wave and marks Backing, and sends both to takes already up.

**Architecture:** The look is in the shared player (`ui/src`): `LaneControls`
draws the rings from the channels it is given, `Timeline` takes them from
the media, `useMultitrackPlayer` keeps Backing's M through the sound it is
given. РЭХА's Python writes `sides` into a stereo track's `.peaks`, marks
`kind: "backing"` in a take's details, and its background pass for takes
already up sends both again. The service's Worker keeps `kind` in the
take's JSON tracks and says so in its answer, keeps Backing's M per member
and song in a new table, and has wave files revalidated; its page reads
`sides` (or an MP3's first bytes) for channels, splits each track's meter
into its sides, and passes `kind` and the song to the shared hook.

**Tech Stack:** Python 3 (РЭХА), React 19 + Tailwind 4 (`ui/`), Hono +
zod-openapi + Drizzle on D1/R2 (service Worker), Web Audio + WebCodecs
(service page), Vitest, Playwright, pytest.

**Spec:** `docs/superpowers/specs/2026-11-11-stereo-in-the-service-design.md`
(Alex's «ок» 2026-11-11 19:29:37Z).

## Global Constraints

- While developing, run only the tests a change touches, once each; the full
  suites run once, on CI. Say so in every subagent brief.
- Local browser tests: a throwaway Playwright config with
  `launchOptions.executablePath: "/opt/pw-browsers/chromium"`, never
  committed. Same for `tests/docs_screenshots.py`.
- Test titles and check labels: cp1252 characters only.
- Words people read follow CLAUDE.md "Writing"; guide and CHANGELOG checked
  with the humanizer skill.
- Rows keep their heights (`LANE_REM` 3.5); the rings take 16 px plus the
  row's 8 px gap after the name, nothing else moves. Rings never appear
  after a row is drawn: a row is drawn once its channels are known.
- An older service must keep working with the new РЭХА, and the new service
  with an older РЭХА: `.peaks` keeps `peaks`; `kind` is optional.
- Commits carry `Co-Authored-By:` and no `Claude-Session:` line.

## Task 1: Rings and channels in the shared player (`ui/src`)

**Files:** `ui/src/components/LaneControls.tsx`, `ui/src/components/Timeline.tsx`,
`ui/src/lib/api.ts` (`TrackMedia`), `ui/src/lib/playerSound.ts`,
`ui/src/hooks/useMultitrackPlayer.ts`, `ui/e2e/lanes.spec.ts`,
`ui/e2e/fake-bridge.js`, `docs/design-system.md` (C6).

- [ ] `TrackMedia` (`api.ts:662`) gets optional `channels` (0, 1 or 2; 0 =
  could not be read). `Timeline` (`:655-657`) passes `m.channels ??
  m.peaks.length` as `channels`, and `file` only as the flag for Backing's
  dashed frame (`backing`), no longer as words.
- [ ] `LaneControls` draws `ChannelsIcon` after the name for every track
  with sound when `channels` is 1 or 2, its tip “Mono file” or “Stereo
  file” taken from `channels`; Backing draws the same rings, so its own
  ring code (`:223-234`) goes. The MIDI sign comes after the rings.
  Nothing for `channels` 0, for a notes plate and for Master. The comment
  at `:124-127` changes to say the rings show it.
- [ ] `PlayerSound` (`playerSound.ts:17-40`) gets optional
  `keepBackingHeard(songId, heard)`; `useMultitrackPlayer`'s `keepHeard`
  (`:366-372`) calls it when the sound has it, else РЭХА's
  `set_song_backing_heard` as now. A failure is not shown: M stays as
  pressed.
- [ ] `docs/design-system.md` C6: every audio plate has one or two rings
  after its name, tip “Mono file” or “Stereo file”, the MIDI sign after
  them; notes plates and Master have none; Backing is told apart by its
  dashed frame.
- [ ] e2e (`lanes.spec.ts`): one ring on a mono track, two on a stereo one
  (`__STEREO_TRACKS__`), none on a notes row and Master, none for
  `channels` 0; Backing keeps its frame and rings; a long name still cut
  with its tip, the row's height unchanged; tip words; both themes.
- [ ] Run only `lanes.spec.ts` and the touched unit tests.

## Task 2: РЭХА sends both sides and marks Backing

**Files:** `src/rehearsal_recorder/sending/service_files.py`,
`src/rehearsal_recorder/sending/band_service.py`, their tests in `tests/`.

- [ ] `.peaks` (`service_files.py:203-207`): for a file with two rows from
  `wav_peaks`, write `{"peaks": [max per bucket], "sides": [left, right]}`,
  each row as long as `peaks`; a mono file as now.
- [ ] `meta()` tracks: `"kind": "backing"` on the Backing track
  (`t.get("kind") == "backing"`), nothing on others.
- [ ] Two marks in the row's `sent` details, РЭХА's own record, left out of
  every PUT as `tempo` is (`:1019`, `:1104`): `sides` (the waves are as
  this РЭХА writes them) and `kind` (the service said it keeps Backing's
  mark, or the take has no Backing). A take sent fresh gets `sides` with
  its files and `kind` from the PUT's answer.
- [ ] Owed: in the hourly look at the service, beside the tempo's
  (`:856-861`), a take the service lists with `sent` not None, not `due`,
  no `error`, not removed, `mp3_gen == gen`, and a mark missing, not set
  aside this run. Run from `_next` after the tempo pass (`:696-698`),
  one take at a time, nothing in the list, waiting while sound plays
  (`_sound_busy`), offline tried again after `RETRY_SEC`, a take changed
  meanwhile left to its own pass (the `_check` guards at `:1093-1095`).
- [ ] For such a take: with no `sides`, for each track whose WAV is on
  disk and has two channels, drop its made `.peaks` record
  (`drop_service_file`), make it again through `_make` and upload it by
  the upload route; files gone, or all mono, upload nothing; then set
  `sides`. With no `kind` and a Backing track: PUT the details again with
  `kind`, its song and name left out as the tempo pass does
  (`:1100-1104`); set `kind` only when the answer says `kind: true`; an
  answer without it (an older service) leaves the take for the next
  hourly look. A take with no Backing gets `kind` with no request.
- [ ] Any other failure: one line in stderr, as the tempo pass prints
  (`:1118`), and the take set aside until РЭХА starts again.
- [ ] pytest: `sides` for stereo, none for mono, rows as long as `peaks`;
  `kind` only on Backing; the pass sends `.peaks` once for a take with a
  stereo track, never for an all-mono take, skips missing files and still
  marks; sends details once for a take with Backing, files or not, marks
  `kind` only on `kind: true`, tries again after the next look without it;
  waits while sound plays; offline tries later; an error sets the take
  aside with a line in stderr; nothing in the list.

## Task 3: The service's Worker

**Files:** `service/worker/takes/meta.ts`, `service/worker/takes/reha-routes.ts`,
`service/worker/takes/band-routes.ts`, `service/worker/files/routes.ts`,
`service/worker/shared/schema.ts`, `service/migrations/0009_backing_heard.sql`,
a new `service/worker/backing/routes.ts`, `service/openapi.json`, worker
tests in `service/test/`.

- [ ] Take PUT schema (`meta.ts:82-89`) accepts `kind?: "backing"` on a
  track; the PUT's answer (`reha-routes.ts:42-52`) adds `kind: true`, which
  tells РЭХА the mark is kept; the take page (`band-routes.ts:37`) returns
  `kind`. Tracks are JSON in the take's row, no table change. Zod strips
  unknown keys, so an older service takes the new РЭХА's details as
  before and answers without `kind`; an older РЭХА sends none.
- [ ] `.peaks` answers `Cache-Control: private, no-cache` with its ETag and a
  304 on `If-None-Match`; other files as now (`files/routes.ts:50`).
- [ ] Table `backing_heard` (member_id, song_id, heard), primary key both,
  cascade on member and song; `GET /api/me/backing` (all of the member's)
  and `PUT /api/me/backing` `{song_id, heard}` (404 for a song the band
  does not have, or one in the Trash); `npm run openapi`.
- [ ] Vitest for each route and the migration (as `levels` has): `kind`
  kept and returned, the answer's `kind: true`, unknown `kind` refused;
  304 for `.peaks`; another member's rows unseen; a song deleted takes its
  rows.

## Task 4: The service's page and player

**Files:** `service/src/api.ts`, `service/src/takes/player/sound.ts`,
`player.ts`, `peaks.ts`, `mp3.ts`, `lanes.ts`, `service/src/takes/Desk.tsx`,
`service/src/takes/Take.tsx`, their tests, `service/test/fixtures/t7.mp3`,
`service/e2e/seed.ts`, `service/e2e/backing.spec.ts`, `service/e2e/takes.spec.ts`.

- [ ] `peaksQuery` (`api.ts:179-190`) fetches with `cache: "no-cache"` and
  returns `{peaks, sides?}`; `sides` that are not two rows as long as
  `peaks` are ignored. `serviceSound`'s tracks (`sound.ts:37`) carry
  `kind`.
- [ ] `media()` (`sound.ts:128-148`) gives the rows of `sides` when there,
  else `[peaks]`; `channels` from `sides`, else from the MP3's first
  bytes (a ranged GET read by `parseFrames`, `mp3.ts:59`, once per track
  per page, cached with the query client); a read that fails gives
  `channels` 0. `media()` never fails for either.
- [ ] Zoomed stretch keeps as many rows as the coarse wave has (`Fold` per
  row, `player.ts:366-376`): two from `sides`, one without.
- [ ] Meters: per track, a `ChannelSplitter` after the gain into two
  analysers when the source has two channels; `loudness()`
  (`player.ts:243-245`) gives `number[][]`; `sound.ts:74` passes them;
  Master one bar as now.
- [ ] `lanes.ts:18`: a track of notes alone goes after the last track that
  is not Backing, so Backing stays last, right above Master.
- [ ] `Desk.tsx`: rows drawn once `player.media` is there; `channels` from
  the media (`:36`, not `1`); Backing's row with the dashed frame, last
  before Master, after rows of notes alone.
- [ ] `Take.tsx` (`:165`, `:223`, now `null`): the player opens once
  `GET /api/me/backing` has answered, and gets `{id: take.song.id,
  heard}` (false when no row, and when the GET fails);
  the service sound's `keepBackingHeard` PUTs it, a failure not shown. A
  take with no song, or with its song in the Trash (`song` null,
  `band-routes.ts:161`), passes `null`.
- [ ] Download mix: unchanged code; a test that muted Backing is left out.
- [ ] Fixture `t7.mp3`: a stereo file made by РЭХА's own encoder
  (`audio/encode.py`), short as t1-t6; the e2e seed gets a take with a
  stereo track and a take with Backing (`kind`), one with `sides` and one
  without.
- [ ] Vitest: two levels for stereo, one for mono; channels from `sides`,
  from an MP3 with no `sides`, 0 from one that cannot be read; malformed
  `sides` ignored; stretch rows; `lanes.ts` with Backing and a notes track.
  e2e (`takes.spec.ts`): rings, two bars and halves at 1180×820 and 960×680
  and on a phone, both themes. e2e (`backing.spec.ts`): Backing dashed
  and last on a computer and a phone; muted the first time; kept for the
  member and read on the next take of the song; not for another member; no
  song, muted and nothing kept.

## Task 5: Pictures, guide, CHANGELOG

**Files:** `tests/docs_screenshots.py` outputs in `docs/screenshots/`,
`service/pictures/` outputs, `docs/using-it.md`, `CHANGELOG.md`.

- [ ] Retake the guide's player pictures (rings on every plate) and the
  service's pictures lanes, mark, three-weeks-ago, downloads. Show Alex the
  site's four pictures and its first screen (the live player, with rings)
  before merge.
- [ ] Guide: the player's tracks (near `docs/using-it.md:408`): one ring
  mono, two stereo; a stereo track's level in two bars and its wave in two
  halves. Band service part (near `:815`): stereo and Backing as in РЭХА,
  Backing's M each member's own and not synced with РЭХА, takes already up
  get their waves in two halves after the update. The Backing text about
  its rings stays (`:1577`).
- [ ] CHANGELOG Unreleased, three items, each starting with a bold lead
  sentence: **Every track shows mono or stereo.** (rings in РЭХА's player
  and the service); **The band service shows stereo as РЭХА does.** (two
  bars, two halves; waves sent again to takes already up);
  **The band service shows the Backing track.** (dashed frame, muted the
  first time, M kept per member and song).

## Task 6: Review and PR

- [ ] Review the whole branch, fix every finding, minors too.
- [ ] Push and open the PR. It runs `reha.yml`, `interface.yml`,
  `service.yml`, `site.yml` and `bridge.yml` on their paths.
- [ ] PR body ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
  and no session link; ask Alex before merge. The service goes up on
  merge; РЭХА's part waits for a release, which waits for him.
