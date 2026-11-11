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
take's JSON tracks, keeps Backing's M per member and song in a new table,
and lets wave files be revalidated; its page reads `sides` (or an MP3's
first bytes) for channels, splits each track's meter into its sides, and
passes `kind` and the song to the shared hook.

**Tech Stack:** Python 3 (РЭХА), React 19 + Tailwind 4 (`ui/`), Hono +
zod-openapi + Drizzle on D1/R2 (service Worker), Web Audio + WebCodecs
(service page), Vitest, Playwright, pytest.

**Spec:** `docs/superpowers/specs/2026-11-11-stereo-in-the-service-design.md`
(Alex's «ок» 2026-11-11 19:29Z).

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
  row's 8 px gap after the name, nothing else moves.
- An older service must keep working with the new РЭХА, and the new service
  with an older РЭХА: `.peaks` keeps `peaks`; `kind` is optional.

## Task 1: Rings and channels in the shared player (`ui/src`)

**Files:** `ui/src/components/LaneControls.tsx`, `ui/src/components/Timeline.tsx`,
`ui/src/lib/api.ts` (`TrackMedia`), `ui/src/lib/playerSound.ts`,
`ui/src/hooks/useMultitrackPlayer.ts`, `ui/e2e/lanes.spec.ts`,
`ui/e2e/fake-bridge.js`.

- [ ] `TrackMedia` gets optional `channels` (1 or 2); `Timeline` passes
  `m.channels ?? m.peaks.length` to `LaneControls` (now `Timeline.tsx:657`).
- [ ] `LaneControls` draws `ChannelsIcon` after the name for every track
  with sound when `channels` is 1 or 2, tip “Mono file” / “Stereo file”
  (the Backing words, `file` prop, stay as they are); the MIDI sign after
  the rings; nothing for `channels` 0. Its comment at `:124-127` changes to
  say the rings show it.
- [ ] `PlayerSound` gets optional `keepBackingHeard(songId, heard)`;
  `useMultitrackPlayer`'s `keepHeard` (`:366-372`) calls it when the sound
  has it, else РЭХА's `set_song_backing_heard` as now.
- [ ] e2e (`lanes.spec.ts`): one ring on a mono track, two on a stereo one
  (`__STEREO_TRACKS__`), none on a notes row and Master, Backing keeps its
  frame and rings, a long name still cut with its tip; tooltip words.
- [ ] Run only `lanes.spec.ts` and the touched unit tests.

## Task 2: РЭХА sends both sides and marks Backing

**Files:** `src/rehearsal_recorder/sending/service_files.py`,
`src/rehearsal_recorder/sending/band_service.py`, their tests in `tests/`.

- [ ] `.peaks` (`service_files.py:203-207`): for a file with two rows from
  `wav_peaks`, write `{"peaks": [max per bucket], "sides": [left, right]}`;
  a mono file as now.
- [ ] `meta()` tracks: `"kind": "backing"` on the Backing track
  (`t.get("kind") == "backing"`), nothing on others.
- [ ] The background pass beside the tempo's (`band_service.py:696-698`,
  `_catch_up` at `:1076`): a take is owed it when its row's `sent` details
  have no `stereo` mark (РЭХА's own record; no change to the service's
  listing). For such a take, once: if it has a Backing track, PUT its
  details again with `kind`, its song and name left out as the tempo pass
  does (`:1100-1104`); for each stereo track whose WAV is on disk, make and
  upload `<position>.peaks` again through `_make`/the upload route; then
  set `sent["stereo"] = 1`. A take whose files are gone gets the details
  and no waves, and is marked done. An all-mono take with no Backing is
  marked done with no request. Same rules as the tempo pass: one take at a
  time, nothing in the list, waits while sound plays (`_sound_busy`),
  offline tries later (`RETRY_SEC`), a take changed meanwhile is left to
  its own pass. A take sent fresh by this РЭХА gets the mark with its
  first details.
- [ ] pytest: sides for stereo, none for mono; `kind` only on Backing; the
  pass sends `.peaks` once for a take with a stereo track, never for an
  all-mono take, skips missing files; sends details for a take with Backing
  once, files or not.

## Task 3: The service's Worker

**Files:** `service/worker/takes/*` (PUT schema, take page), 
`service/worker/files/routes.ts`, `service/worker/shared/schema.ts`,
`service/migrations/0009_backing_heard.sql`, a new
`service/worker/backing/routes.ts` (or beside `levels/`), `service/openapi.json`,
worker tests in `service/test/`.

- [ ] Take PUT (`service/worker/takes/meta.ts:82-89`) accepts
  `kind?: "backing"` on a track; the take page (`band-routes.ts:37`)
  returns it (tracks are JSON in the take's row, no table change). Zod
  strips unknown keys, so an older service takes the new РЭХА's details
  as before; an older РЭХА sends none.
- [ ] `.peaks` answers `Cache-Control: private, no-cache` with its ETag and a
  304 on `If-None-Match`; other files as now (`files/routes.ts:50`).
- [ ] Table `backing_heard` (member_id, song_id, heard), primary key both,
  cascade on member and song; `GET /api/me/backing` (all of the member's)
  and `PUT /api/me/backing` `{song_id, heard}`; `npm run openapi`.
- [ ] Vitest for each route and the migration (as `levels` has).

## Task 4: The service's page and player

**Files:** `service/src/api.ts`, `service/src/takes/player/sound.ts`,
`player.ts`, `peaks.ts`, `mp3.ts`, `service/src/takes/Desk.tsx`,
`service/src/takes/Take.tsx`, their tests, `service/e2e/`.

- [ ] `peaksQuery` returns `{peaks, sides?}`; `media()` gives `sides` as the
  rows when there, else `[peaks]`, and `channels` from `sides`, else from
  the MP3's first bytes (a ranged GET read by `parseFrames`, once per track
  per page, cached with the query client); `kind` passed through.
- [ ] Zoomed stretch keeps a row per channel (`Fold` per channel,
  `player.ts:366-376`).
- [ ] Meters: per track, a `ChannelSplitter` after the gain into two
  analysers when the source has two channels; `loudness()` gives
  `number[][]`; `sound.ts:74` passes them; Master one bar as now.
- [ ] `Desk.tsx`: `channels` from the media, not `1`; Backing's row with
  `file` words and the dashed frame, last before Master.
- [ ] `Take.tsx` (`:165`, `:223`, now `null`): passes `{id: take.song.id,
  heard}` from `GET /api/me/backing` (false when no row) to
  `useMultitrackPlayer`; the service sound's `keepBackingHeard` PUTs it. A
  take with no song (`song` null) passes `null`.
- [ ] Download mix: unchanged code; a test that muted Backing is left out.
- [ ] Vitest: two levels for stereo, one for mono; channels from `sides` and
  from an MP3 with no `sides`; stretch rows. e2e: rings, two bars and
  halves on a computer and a phone; Backing dashed and muted the first
  time, kept for the member, not for another; no song, muted.

## Task 5: Pictures, guide, CHANGELOG

**Files:** `tests/docs_screenshots.py` outputs in `docs/screenshots/`,
`service/pictures/` outputs, `docs/using-it.md`, `CHANGELOG.md`.

- [ ] Retake the guide's player pictures (rings on every plate) and the
  service's pictures lanes, mark, three-weeks-ago, downloads. Show Alex the
  site's four pictures before merge.
- [ ] Guide: the player's tracks (near `docs/using-it.md:408`): one ring
  mono, two stereo; a stereo track's level in two bars. Band service part
  (near `:815`): stereo and Backing as in РЭХА, Backing's M each member's
  own, takes already up get their waves after the update.
- [ ] CHANGELOG Unreleased: **Rings** on every track in the player; the
  service shows **stereo** and **Backing** as РЭХА does; waves and Backing
  sent again to takes already up.

## Task 6: Review and PR

- [ ] Review the whole branch, fix every finding, minors too.
- [ ] Push, start the CI workflows the paths touch (`reha.yml`,
  `interface.yml`, `service.yml`, `site.yml` if the site's pictures change).
- [ ] PR with the attribution block; ask Alex before merge. The service goes
  up on merge; РЭХА's part waits for a release, which waits for him.
