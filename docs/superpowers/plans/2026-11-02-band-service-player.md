# РЭХА's player on the service's take page: plan

> For agentic workers: run with superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** the service's take page plays a take through РЭХА's own `TakePlayer`, with each member's own levels.

**Architecture:** `useMultitrackPlayer` talks to a `PlayerSound` instead of `api()`. РЭХА passes `pythonSound` (the bridge calls it has now); the service passes a sound made from its one player, which learns levels on the fly, a seamless loop and a stretch's wave from the MP3 it holds. Levels live in a new D1 table, per member and track name.

**Tech:** React 19, TypeScript, Vitest, Playwright; Hono + Drizzle on D1; WebCodecs and Web Audio.

**Spec:** `docs/superpowers/specs/2026-11-02-band-service-player-design.md` (Alex «го» 00:45Z; «сливай по зеленому» 00:46Z: no plan gate, merge on green; show the site chapter before the merge).

## Global constraints

- Writing: CLAUDE.md "Writing" (British English, curly quotes in user text, bold button names, test titles cp1252 only).
- РЭХА behaves exactly as before: its screens pass no new arguments.
- Tests while building: only those a change touches, once each; full suites once on CI. Browser tests here use a throwaway config with `launchOptions.executablePath: "/opt/pw-browsers/chromium"` (not committed).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review focus

1. A take whose MP3 has not fully come: zoom, loop and levels must not stop the sound.
2. Changing the loop's piece while it plays: no stuck lanes, no doubled sound.
3. A track name with no level kept and no `balance` entry plays at 1.
4. Two tabs or a phone and a computer: the last level written wins, nothing breaks.
5. РЭХА: Backing track mute kept with its song, the header's listening level, the click, all as before.

---

### Task 1: РЭХА's player behind `PlayerSound`

**Files:** create `ui/src/lib/playerSound.ts`, `ui/src/lib/playerSound.test.ts`; modify `ui/src/hooks/useMultitrackPlayer.ts`, `ui/src/components/TakePlayer.tsx`, `ui/src/components/Timeline.tsx`.

**Produces:**
- `export type PlayerSound = { open(tracks, reuse?): Promise<PlayerState>; media(tracks, buckets?, from?, to?): Promise<TrackMedia[]>; state(): Promise<PlayerState>; play(); pause(); toggle(); seek(s); setLoop(a, b); setMuted(name, on); setSolo(name | null): Promise<PlayerState>; setVolume(name, v); setMaster(v); keepLevels(volumes): Promise<unknown>; close(): Promise<unknown> }` — the bridge's own shapes, so the hook changes by name only.
- `export const pythonSound: PlayerSound` (each method its bridge call; `state` is `poll("player_state")`).
- `useMultitrackPlayer(tracks, fallbackDuration = 0, song = null, sound: PlayerSound = pythonSound)`.
- `TakePlayer` and `Timeline` take `master?: boolean` (default true); false leaves out the Master row.

- [ ] Test first: `playerSound.test.ts` mocks the bridge (as `lib/keys.test.ts` does) and checks `pythonSound.setLoop(1, 2)` calls `player_set_loop(1, 2)`, `keepLevels({Bass: 0.5})` calls `save_mix`, `media(t, undefined, 3, 4)` calls `take_media(t, undefined, 3, 4)`. Run, see it fail.
- [ ] Write `playerSound.ts`; the hook takes `sound`; every `api().player_*`, `take_media`, `save_mix` and the poll go through it. `set_song_backing_heard`, `lib/listening.ts` and the click stay as they are.
- [ ] `master` prop on `TakePlayer` → `Timeline`; Timeline skips the Master group when false.
- [ ] Run `npx vitest run src/lib/playerSound.test.ts src/components/TakePlayer.test.ts`, `npx tsc -b`, then `e2e/player.spec.ts`, `e2e/history.spec.ts`, `e2e/review.spec.ts` once each. All pass.
- [ ] Commit "РЭХА's player talks to its sound through PlayerSound".

### Task 2: each member's levels in the service

**Files:** `service/worker/shared/schema.ts` (table `level`), `service/migrations/0002_levels.sql` (drizzle-kit), create `service/worker/levels/routes.ts`, mount in `worker/index.ts`, `service/src/api.ts` (`useLevels`, `useKeepLevels`), `service/openapi.json`, test `service/test/levels.test.ts`.

**Produces:** `GET /api/me/levels` → `{ levels: Record<string, number> }`; `PUT /api/me/levels` with `{ levels: Record<string, number | null> }` → the levels after; `null` deletes. Level 0..2 (РЭХА's fader range; check `LaneControls`), else 400.

- [ ] Test first (Worker): Ira's PUT is not in Vik's GET; `null` forgets; out of range is 400; signed out is 401. Run, fail.
- [ ] Table, migration, routes, `npx drizzle-kit check`, `npm run openapi`. Tests pass. Commit.

### Task 3: the service's sound

**Files:** `service/src/takes/player/player.ts`, create `service/src/takes/player/peaks.ts` + `peaks.test.ts`, `service/src/takes/player/loop.ts` + `loop.test.ts`, create `service/src/takes/player/sound.ts`, modify `one.tsx`.

**Produces:**
- `Player.setGain(i, v)`; `Player.setLoop(a: number | null, b: number | null)`; `Player.stretch(i, from, to, buckets): Promise<number[] | null>` (null while that stretch has not come).
- `peaks.ts`: `peaksOf(planes: Float32Array[][], buckets: number): number[]` (max of |sample| over channels per bucket).
- `loop.ts`: `loopTime(raw: number, a: number, b: number): number` (where the playhead is after `raw` seconds of playing through a loop) and `passStart(pass, a, b)`.
- `one.tsx` exposes the one player's take, `Player` and a `useServiceSound(take)` returning a `PlayerSound`: `open` answers from the take's tracks (`.peaks`), levels (yours, else `balance`, else 1); `state` from the player's clock; `keepLevels` → `PUT /api/me/levels`; `media` → `stretch` or the coarse peaks.

- [ ] Tests first: `peaksOf` on a known sine; `loopTime` over two passes and before `a`. Run, fail; write; pass.
- [ ] Player: levels on the fly; loop by restarting a lane's decoder at `a` once its cursor passes `b`, pieces placed one pass later (the clock is the same), `time()` through `loopTime`; a stretch decoded by its own AudioDecoder from the frames held.
- [ ] `sound.ts` and `one.tsx`. Typecheck. Commit.

### Task 4: the pages

**Files:** `service/src/takes/Take.tsx`, `TakePanel.tsx`, create `service/src/takes/Desk.tsx`, `service/src/marks/MarkPanel.tsx` (or the shell's panel kind), `service/src/shell/panel.tsx`, `service/src/main.tsx` (labels into РЭХА's store with `labelsChanged`), test `service/e2e/takes.spec.ts`.

- [ ] Tests first (browser): the take page shows a lane per track and the marks' chips; a chip opens its mark in the panel; **Mark** opens the panel with a new mark; a level moved stays after a reload and **РЭХА's levels** brings back the balance; at 390 px the desk rows show and no lanes. Run, fail.
- [ ] Take page: `TakePlayer master={false}` on the page itself, `onEditMarker` → mark panel, `onAddMarker` → panel with a draft; the levels line; downloads under. Phone: wave + `Desk` (РЭХА's `LaneControls`). Tests pass. Commit.

### Task 5: words and pictures

**Files:** `site/content/band-service.md` (“Hear your own part”), `service/pictures/site.spec.ts` (the `lanes` shot on a phone with the guitar up), `site/src/stories/band-service/*.webp` (`npm run pictures`), `docs/using-it.md` (the band service part), `CHANGELOG.md` (Unreleased, item starts bold).

- [ ] Texts, pictures, look at each picture once. `npx vitest run` in `site/`. Commit.

### Finish

Fresh review of the branch, fix every finding with a test where one can be written, PR, show Alex the chapter, merge when CI is green (his word 00:46Z).
