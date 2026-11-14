# Louder takes in the band service: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The band service plays each take louder by one amount for all its
tracks. РЭХА counts the take's peak from its WAV files and sends it with the
take's details; the service turns the peak into the amount and plays the
take, and makes the **Download** mix, with it.

**Architecture:** РЭХА sends a number, the service decides the amount. The
peak is the loudest sample of the take's audio tracks added at full level,
counted by the same pass that `audio/mixdown.py` makes for the cloud
folder's mix. The service keeps it with the generation it was counted for
and gives the take page `gain` = min(16, 0.891 / peak), or 1. The player
multiplies each track's gain node by it; the **Download** mix multiplies
each track's level by it.

**Tech Stack:** Python 3 and numpy (РЭХА); Hono, zod-openapi, Drizzle and
D1 (the Worker); React and Web Audio (the service's page); vitest with the
Workers pool; РЭХА's script tests (`tests/test_sending.py`,
`tests/test_engine.py`).

**Spec:** `docs/superpowers/specs/2026-11-14-service-louder-takes-design.md`
(Alex's «ок» 2026-11-14 12:40Z).

## Global Constraints

- While developing, run only the tests a change touches, once each; the full
  suites run once, on CI. Say so in every subagent brief.
- Test titles and check labels: cp1252 characters only (Windows CI).
- The amount's two numbers live in the service only, in one file:
  `CEILING = 0.891` (−1 dBFS) and `MOST = 16` (+24 dB).
- The peak is 1.0 at full scale and may be above 1 (several tracks
  together). РЭХА sends it only when it could read every audio file of the
  take; 0 (silence) is a valid peak and gives the amount 1.
- A take's peak counts for its generation only: the page uses it when
  `peak_gen` equals the generation it shows.
- Nothing in `ui/` changes, so РЭХА's player, History and the site do not.
- Words people read follow CLAUDE.md "Writing": British spelling, curly
  double quotes in the guide and CHANGELOG, button names in bold, each
  CHANGELOG item starting bold. Check the guide and CHANGELOG text with the
  humanizer skill.
- No other feature thread is running (checked 2026-11-14 12:35Z); MIDI fold
  merged as #161.

## Review Focus

1. A take whose details arrive without `peak` (an older РЭХА, a ★ from a
   РЭХА that could not count) keeps the peak it had for that generation.
2. The page never applies a peak counted for another generation.
3. A ★, a rename or new marks resend the details without reading the WAVs
   again: the peak comes from what was last sent for the same generation.
4. The count waits while a take records or plays (`Api._sound_busy`), and
   the names pass waits while it reads (`BandService.making`).
5. M, S and the faders behave as before; only what is heard and the meters
   change.

### Task 1: The service takes the peak and plays with it

**Files:**
- Modify: `service/worker/shared/schema.ts` (`take`: `peak` real,
  `peakGen` integer `peak_gen`, both nullable)
- Create: `service/migrations/0010_*.sql` and its snapshot, by
  `npm run migrations`
- Modify: `service/worker/takes/meta.ts` (`TakeMeta.peak`)
- Modify: `service/worker/takes/store.ts` (`putTake` keeps it)
- Modify: `service/worker/takes/reha-routes.ts` (the listing's `peak_gen`)
- Create: `service/worker/takes/gain.ts` (`CEILING`, `MOST`, `gainOf`)
- Modify: `service/worker/takes/band-routes.ts` (`TakePage.gain`)
- Modify: `service/src/takes/player/player.ts` (`setBoost`)
- Modify: `service/src/takes/player/one.tsx` (each Player gets its take's gain)
- Modify: `service/src/takes/player/mix.ts` (`makeMix` uses `take.gain`)
- Modify: `service/openapi.json` (by `npm run openapi`)
- Test: `service/test/reha.test.ts`, `service/src/takes/player/player.test.ts`,
  `service/src/takes/player/mix.test.ts`

- [ ] **Step 1: Tests first.** In `test/reha.test.ts`, next to the drift
  test: a PUT with `peak: 0.3236` at gen 1 lists `peak_gen: 1`; the take
  page answers `gain` ≈ 0.891 / 0.3236 (2.753); a PUT without `peak` (a ★)
  keeps it; a PUT at gen 2 without `peak` makes the page, once gen 2 is
  shown, answer `gain: 1`; `peak: 0` gives 1; `peak: 0.01` gives 16; a
  negative peak is refused with 400. In `player.test.ts`, with the fake
  nodes it already uses: after `setBoost(2)` a heard track's gain node is
  its level times 2, a muted one 0, and `gain(i)` still answers the level.
  In `mix.test.ts`: `makeMix` with `gain: 2` adds each track at twice its
  level before `turnDown`.
- [ ] **Step 2: The column and the field.** `schema.ts`: `peak: real("peak")`,
  `peakGen: integer("peak_gen")`. `npm run migrations` writes
  `0010_*.sql` (two `ALTER TABLE take ADD`). `meta.ts`: `peak:
  z.number().min(0).optional()` with a comment: the loudest
  sample of the take's audio tracks added at full level, 1.0 at full scale,
  counted by РЭХА from its WAVs; missing from РЭХА 0.27 and older.
  `store.ts` `putTake`: `...(meta.peak !== undefined && { peak: meta.peak,
  peakGen: meta.gen })` in `fields`.
- [ ] **Step 3: The listing and the page.** `reha-routes.ts`: the listing
  selects `peakGen` and answers `peak_gen`; its description says РЭХА asks
  which takes still need their peak. `gain.ts`:
  `gainOf(peak, peakGen, gen)`: 1 when `peakGen !== gen`, `peak` is null or
  `peak <= 0`; else `Math.min(MOST, CEILING / peak)`. Comment the two
  numbers: −1 dBFS because MP3 raised a measured take's peak by 0.25 dB;
  +24 dB so an almost silent take's hiss is not raised further.
  `band-routes.ts`: `TakePage.gain: z.number()` with a comment, answered as
  `gainOf(t.peak, t.peakGen, gen)`.
- [ ] **Step 4: The player.** `player.ts`: `private boost = 1`;
  `setBoost(v: number)` keeps `v` (at least 0) and calls `this.mix()`;
  `mix()` sets a heard track's node to `this.levels[i] * this.boost`.
  `one.tsx`: right after `new Player(...)`, `p.setBoost(t.gain)`.
  Update the comments that say a track's level is 0 to 1 where they now
  mean the node, not the fader.
- [ ] **Step 5: The mix.** `mix.ts`: `makeMix(take: Pick<TakePage,
  "tracks" | "gain">, …)` multiplies each track's gain by `take.gain`;
  `turnDown` stays. Update the file's top comment: the take is turned up by
  its amount, as the page plays it, then turned down only if it goes over.
- [ ] **Step 6: openapi.json.** `npm run openapi`.
- [ ] **Step 7: Run the touched tests once:** `npx vitest run
  test/reha.test.ts test/openapi.test.ts test/migration.test.ts
  src/takes/player/player.test.ts src/takes/player/mix.test.ts`, then
  `npm run typecheck`.
- [ ] **Step 8: Commit** "Service: a take plays louder by the amount its
  peak allows".

### Task 2: РЭХА counts the peak and sends it

**Files:**
- Modify: `src/rehearsal_recorder/audio/mixdown.py` (`mix_peak`)
- Modify: `src/rehearsal_recorder/sending/service_files.py` (`meta`
  docstring names `peak`; a helper `audio_files(take)` if `_audio` is
  needed outside)
- Modify: `src/rehearsal_recorder/sending/band_service.py` (count in
  `_send`, catch-up in `_compare` and `_mark_up`)
- Modify: `src/rehearsal_recorder/sending/service_client.py` (`takes`
  docstring: `peak_gen`)
- Modify: `tests/fake_band_service.py` (keeps `peak`, lists `peak_gen`)
- Test: `tests/test_engine.py`, `tests/test_sending.py`

- [ ] **Step 1: Tests first.** `test_engine.py`, by the mixdown checks:
  `mix_peak` of a mono 16-bit and a stereo 24-bit WAV equals the loudest
  sample of their sum (mono into both sides), as a fraction of full scale;
  of silence 0.0; of a missing file None; `stop` answering true raises
  `mixdown.Stopped`.
  `mixdown` gives the same file and gain as before. `test_sending.py`,
  with the fake service: a new take's details carry `peak` equal to
  `mix_peak` of its WAVs; a ★ afterwards sends the same peak without
  counting again (count the calls); a crop counts again for gen 2; a take
  sent before (no `peak` kept, the fake lists `peak_gen: None`) gets its
  details again with `peak` and no files, with no line in the list; a fake
  that lists no `peak_gen` (an older service) is not sent it; a take whose
  WAVs are gone sends none and is asked again at the next look; while a
  take plays the count waits.
- [ ] **Step 2: `mix_peak`.** In `audio/mixdown.py`:
  `mix_peak(files, stop=None)`: the files of one take, each at full level;
  the loudest sample of their sum, 1.0 at full scale (the 16-bit range the
  mixdown sums in divided by 32768), or None when a file cannot be opened;
  when `stop()` answers true between chunks it raises a new
  `mixdown.Stopped`, so a pause is never taken for a missing file. `mixdown` uses the same first pass
  (one private function for the pass, both call it), so the two cannot
  drift apart.
- [ ] **Step 3: The count in `_send`.** A method `_peak(take_id, gen, take,
  sent)`: when `sent` holds `peak` and `sent["gen"] == gen`, that; else
  `self._check(take_id, gen)`, `self.making = True`, `mix_peak` of the
  take's audio files (the same list `service_files.meta` sends as tracks,
  Backing included, notes not) with `stop=lambda: bool(self.api._sound_busy())`,
  `making` back to False in a `finally`; `mixdown.Stopped` raises
  `_Paused(self.api._sound_busy() or "playing")`, as `_make` does; a file
  that cannot be read gives None. `_send` sets `meta["peak"]` when the
  answer is a number, before `client.put_take`, so the service has it
  before the MP3s are marked ready.
- [ ] **Step 4: Takes already up.** `_compare`: for a row up at its
  generation, not due, with no error, with `sent`, not set aside, when the
  listing has `peak_gen` and it differs from the row's `gen`: add it to a
  new set `self._owed_peaks` and to `self._owed_marks`. `_mark_up`, inside
  its `try`, after the marks and before `_owed_marks.discard`: when the take
  is in `_owed_peaks`, count with `_peak(..., sent=None)` and, for a number,
  `self._put_as_sent(client, take_id, row, gen, {"peak": p})`; then discard
  it from `_owed_peaks` (files gone: the next look, an hour on, asks again).
  A `_Paused` leaves it in both sets for the next turn; `_Changed` and the
  catch-all discard it as they discard `_owed_marks`. Clear `_owed_peaks`
  wherever `_owed_marks` is cleared or discarded (band_service.py:369, :552,
  :587). Keep `_mark_up`'s docstring, the set's comment in `__init__` and
  the `making` comment (:171) in step with this.
- [ ] **Step 5: The fake service.** `tests/fake_band_service.py`: PUT
  details keeps `peak` with the gen it came with; the listing adds
  `peak_gen` unless the fake is set to be an older service (as it does for
  `drift_gen`).
- [ ] **Step 6: Run the touched tests once:** `python tests/test_engine.py`
  and `python tests/test_sending.py` (each once).
- [ ] **Step 7: Commit** "РЭХА: sends each take's peak to the band service".

### Task 3: The guide and CHANGELOG

**Files:**
- Modify: `docs/using-it.md:814`
- Modify: `CHANGELOG.md` (Unreleased)

- [ ] **Step 1: The guide.** Replace “A take plays there at the levels its
  tracks have in РЭХА's player.” with three sentences: the tracks keep the
  levels they have in РЭХА's player; the service turns the whole take up
  as far as its loudest moment allows, every track by the same amount, so a
  take sounds louder there than in РЭХА; a take sent by an older РЭХА is
  turned up once РЭХА has been updated, if its files are still on the
  computer.
- [ ] **Step 2: CHANGELOG.** One item under “Unreleased”, after its first
  item (the menu fold), so the site's news line does not read it, starting
  **Louder takes in the band service.**: what the band hears, that the
  balance stays, that РЭХА's player and the files do not change, and that
  takes already in the service catch up in the background.
- [ ] **Step 3:** Check both texts with the humanizer skill.
- [ ] **Step 4: Commit** "Guide and CHANGELOG: louder takes in the band service".

### Finish

- [ ] Review the whole branch against the spec (code-review), fix every
  finding, minors too.
- [ ] Push, start `service.yml`, `reha.yml` and `site.yml` (CHANGELOG.md is
  one of its paths) by hand on the branch: the full suites, once.
- [ ] Open the PR with the repository's template, assign Alex, ask before
  the merge. After the merge the service goes up by itself; РЭХА's part
  ships with the next release.
