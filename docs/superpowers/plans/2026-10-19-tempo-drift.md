# Where the Band Drifted Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Master's lane in the player draws the band's tempo bar by bar against the take's aim, amber where it ran ahead or dragged for two bars or more, with the number; Settings › Metronome sets how far is "off"; the guide, the changelog and reha.stream say so.

**Architecture:** Python counts (numpy only): `audio/tempo.py` gains a beat tracker and bar tempos beside the counter, shared later with the backing track; `audio/drift.py` picks the source, tracks and returns the bars; `Api.take_drift` resolves the aim from the take and the song, keeps 32 answers and stops when Record is pressed. The interface finds the stretches (`lib/drift.ts`), so the tolerance changes nothing in Python, and draws them in `DriftLine` inside `MasterClickLane`.

**Tech Stack:** Python 3.12 + numpy; React 19 + TypeScript + Tailwind in `ui/`, Vitest, Playwright on the fake bridge; the Vite site in `site/`.

**Spec:** `docs/superpowers/specs/2026-10-10-tempo-drift-design.md` (D1–D4, Parts 1–6, "Since the metronome was built", Testing, Docs, On reha.stream). Prototype and its numbers: `/mnt/project-files/tempo-drift/research/` (`drift.py`, `run.py`, `findings.md`). Built on main `d6c96db`.

**One call made here, not in the spec:** Python resolves the aim, not the interface (spec Part 1 says the interface picks it). The interface sends the take's own `{tempo, signature, click, song}`; Python looks the song's tempo up with `Library.song_tempos()`, so every screen gets the same aim without loading songs, and the answer carries the aim back for the tag.

## Global Constraints

- Test labels and Playwright titles in cp1252 only ("Palyn"); test data may say "Pałyn".
- Signatures `"4/4"`, `"3/4"`, `"2/4"`, `"6/8"`; beats a bar 4, 3, 2, 6; tempo counts beats (eighths in 6/8).
- Drift hop `round(sr * 256 / 22050)`; the counter keeps `512`. `.mid` envelope 200 a second, kick and snare 1, rest 0.4 (`_hits_envelope` as it is).
- Tracker: Ellis DP, tightness 100. Snap within ±15% of a beat. Bar tempo: Theil–Sen over the bar's beats and one either side; `None` when more than half its beats found no hit.
- Sources in order: drums-icon `.mid` → drums-icon WAVs summed → all WAVs summed except icon `"backing"`; the next when one gives no steady beat.
- Tolerance setting `drift_tolerance` ∈ {0.01, 0.02, 0.03, 0.05}, default 0.02. Lane range ±8%. Stretch: ≥2 bars off the same way, joined across ≤2 bars; chip = largest difference after a 3-bar median, whole bpm, "+7" / "−5" (U+2212).
- Words exactly as the spec: tags "Click 128 bpm · 4/4", "No click · 128 bpm · 4/4", "Pałyn 128 bpm", "No tempo · middle 126 bpm", suffix " · from the mix"; states "Counting the tempo…", "Too short to show the tempo", "No steady beat found"; hover "Bar 61 · 135 bpm (+7)"; screen reader "Tempo: ahead 7 bpm, bars 46 to 68; behind 5 bpm, bars 70 to 75." / "Tempo: steady."; setting "Drift shown past", hint "How far from the tempo a stretch of two bars turns amber on Master. 2% is about 2.5 bpm at 128."; tab's last line "The click's settings are also behind the gear in the metronome row, on the rehearsal screen."
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` only; the PR body ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)" only.
- While building, run only the tests a change touches, once each; the full suites run once on CI.

## Review Focus

1. A take whose drums track is silent or missing on disk: falls to the next source or says nothing new, never an error bar. (Task 2 tests "silent drums fall back to the mix", "missing".)
2. A take recorded in 6/8 or 3/4: bar numbers and chips in the signature's own count, the drawn eighth in the tag. (Task 1 6/8 test; Task 3 tag test.)
3. Record pressed while a long take is being counted: the count stops at once, the next open counts again. (Task 2 "Record stops a count".)
4. A stretch inside a looped region still reads (amber over amber). (Task 4 e2e "a stretch inside a region".)
5. Opening another take while the first is still counting never shows the first's line on the second. (Task 4 hook keeps the answer with its lists, as `useTakeNotes`.)

---

### Task 1: Beats and bar tempos in `audio/tempo.py`

**Files:**
- Modify: `src/rehearsal_recorder/audio/tempo.py`
- Create: `tests/test_drift.py` (added to `tests/run_all.py` with a line in its docstring)

**Interfaces:**
- Produces: `_audio_envelope(paths, hop=None, stop=None)` (hop default unchanged); `_hits_envelope(path)` unchanged; `class Cancelled(Exception)`; `track(env, fps, tempo, tightness=100.0, stop=None) -> np.ndarray` (beat steps); `snap(beats, env, fps, tempo) -> (times: np.ndarray seconds, found: np.ndarray[bool])`; `bar_tempos(times, found, per_bar, first=0) -> list[dict(n, start, end, tempo|None)]`; `middle_tempo(env, fps, signature) -> float|None` (the counter's window median on any envelope).

- [ ] **Step 1: Failing tests** in `tests/test_drift.py`, synthetic takes made as in the research's `run.py` (per-bar tempo, rock/waltz/6/8/ballad patterns, band bleed), reusing `hit`, `write_wav`, `write_drums_mid` from `test_tempo`: each bar within 2% of the truth for drums audio with bleed, drums `.mid`, the mix, 3/4 at 96, 6/8 at 198, a ballad at 72; a two-bar stop gives `None` for those bars; a sustained chord finds most beats without a hit.
- [ ] **Step 2:** `python tests/test_drift.py` fails (no `track`).
- [ ] **Step 3:** Port the prototype's `track`, `snap`, `bar_tempos` into `tempo.py` in its own style. `found` is a hit that stands out: its envelope peak above the local median plus a multiple of the local spread over about two bars (calibrated on the tests: the chord must miss). `stop()` is checked once per block and every 2,000 tracker steps, raising `Cancelled`.
- [ ] **Step 4:** The suite passes; `python tests/test_tempo.py` still passes.

### Task 2: `audio/drift.py`, `Api.take_drift`, the setting

**Files:**
- Create: `src/rehearsal_recorder/audio/drift.py`
- Modify: `src/rehearsal_recorder/api.py` (`take_drift`, `start_take`, `set_metronome_setting`), `src/rehearsal_recorder/metronome.py` (`DEFAULTS`, `_checked`)
- Test: `tests/test_drift.py`

**Interfaces:**
- Consumes: Task 1.
- Produces: `drift.count(*, drums_mid=(), drums=(), mix=(), tempo=None, signature="4/4", click=False, stop=None) -> dict` with `{"ok": True, "source": "drums-mid"|"drums"|"mix", "per_bar", "middle", "tempo", "bars"}` or `{"ok": False, "why": "short"|"no-beat"}`; `Api.take_drift(tracks, notes, meter) -> dict`, `meter = {tempo, signature, click, song}` from the take; answers as the spec's Part 2 plus `"aim": {"tempo", "signature", "from": "click"|"take"|"song"|"middle", "song"}`, or `{"ok": False, "why": "short"|"no-beat"|"missing"|"recording"}`. Settings: `drift_tolerance` in `get_settings`.

- [ ] **Step 1: Failing tests:** sources (`.mid` before audio; two drums-icon WAVs summed; no icon gives "mix"; the Backing track icon left out of the mix; silent drums fall back to the mix); bar 1 after a two-bar count-in on a click take; drums in after eight bars of guitar; "short" (6 s), "no-beat" (a sustained chord), "missing"; the aim's four rows (click, take tempo without click, the song's tempo through the library, middle) and 4/4 with none; the cache returns the same object, a rewritten file is counted afresh, 33 takes push out the first; `start_take` during a count gives "recording"; `drift_tolerance` default 0.02, 0.03 saved, 0.04 refused.
- [ ] **Step 2:** They fail.
- [ ] **Step 3:** `drift.count`: per source, envelope at the drift hop; the tempo given, else `middle_tempo`; track, snap; bar 1 on a click take is the first grid bar (`k * per_bar * 60 / tempo` from 0) the drums play in, else the first beat; a source with fewer than half its bars counted is no steady beat. Short is fewer than 4 bars. `Api.take_drift`: icons from `layouts.icons`, missing files → "missing", key `(path, size, mtime_ns)` of every file read plus the aim, an `OrderedDict` of 32; a generation number bumped by `start_take` and checked by `stop`; while `self._recorder` is set, "recording" at once.
- [ ] **Step 4:** `python tests/test_drift.py` passes; `python tests/test_engine.py` passes.

### Task 3: The interface's arithmetic and the fake

**Files:**
- Create: `ui/src/lib/drift.ts`, `ui/src/lib/drift.test.ts`
- Modify: `ui/src/lib/api.ts` (types, `take_drift`, `MetronomeSettings.drift_tolerance`, `MetronomeSettingKey`, the method list), `ui/e2e/fake-bridge.js` (`take_drift`, validator, default), `ui/e2e/band.js` (Pałyn takes without the click)

**Interfaces:**
- Produces: `type DriftBar = {n, start, end, tempo: number|null}`; `type TakeDrift = {ok: true, source, per_bar, middle, aim: DriftAim, bars: DriftBar[]} | {ok: false, why}`; `stretches(bars, aim, tolerance): Stretch[]` with `{first, last, sign: 1|-1, chip: number, peak: DriftBar}`; `chipsShown(stretches, xOf, minGapPx)`; `driftTag(answer) -> {text, tempo, signature, meter: boolean, lead, tail}`; `spokenDrift(stretches, signature)`; `yOf(tempo, aim)`; `signed(d)`; `RANGE = 0.08`; `TOLERANCES = [0.01, 0.02, 0.03, 0.05]`.

- [ ] **Step 1: Failing tests** in `drift.test.ts`: one bar off is no stretch; two are; same sign only; joined across two bars, not three; chip from the 3-bar median (+7 where the raw peak is +8); the smaller of two overlapping chips hidden; each tag row of Part 1, 6/8 with "♪", " · from the mix"; the spoken sentence and "Tempo: steady."; a 3% tolerance turns fewer bars amber.
- [ ] **Step 2:** `cd ui && npx vitest run src/lib/drift.test.ts` fails.
- [ ] **Step 3:** Write `drift.ts`; the fake's `take_drift` makes bars from the Q2 mockup's curves (`/mnt/project-files/tempo-drift/q2/src/Drift.tsx` `TAKES`, `anyTake`), found by the take's first track file; band.js's `clickedAt` gives Pałyn takes `click: false`, keeping 128 4/4, except the take the story records.
- [ ] **Step 4:** The Vitest file passes.

### Task 4: The player and Settings

**Files:**
- Create: `ui/src/components/metronome/DriftLine.tsx` (+ `DriftLine.stories.tsx`), `ui/src/hooks/useTakeDrift.ts`, `ui/e2e/drift.spec.ts`
- Modify: `MasterClickLane.tsx` (states, tag, label, stripes at a third), `Timeline.tsx` and `TakePlayer.tsx` (the take's files reach the lane), `MetronomeSettings.tsx` (group "Tempo drift", the last line), `useClickSettings.ts` (`setDriftTolerance`)

**Interfaces:**
- Consumes: Task 3.
- Produces: `useTakeDrift(take) -> {answer: TakeDrift|null, counting: boolean}`, asked once per take's lists; `useDriftTolerance()` shared by every player and set by Settings.

- [ ] **Step 1: Failing e2e** (`drift.spec.ts`): Pałyn 2's line, band, chips and hover; Viasna's stripes under the line at a third; Take 4's middle tag; the states (slow answer: spinner after 1 s, words after 10 s; short; no beat; missing files show the click lane as before); zoom moves the line; Review shows it; a 5% setting leaves fewer chips; a stretch inside a region; nothing cut or moving at 960 px; dark theme.
- [ ] **Step 2:** `cd ui && npm run build && npx playwright test e2e/drift.spec.ts` fails.
- [ ] **Step 3:** Build it. The lane keeps its 56 px; the line is SVG in a 0–100 box with non-scaling 2 px strokes; chips and hover are HTML over it; the hover listens on the lane and leaves the Timeline's drag alone. `metronome.spec.ts` lines that expect "Recorded without the click" change to the drift tag.
- [ ] **Step 4:** `drift.spec.ts` and `metronome.spec.ts` pass; `npm run lint`, `npm run design-check`, `npx tsc -b` clean.

### Task 5: Guide, changelog, site

**Files:**
- Modify: `docs/using-it.md` ("Where the band drifted" after "Listening back to the click"; that section's last paragraph), `tests/docs_screenshots.py` (shot `drift-master`), `CHANGELOG.md` (Unreleased), `site/content/story.md`, `site/content/faq.md`, `site/content/features.md`, `site/src/page/pieces.tsx` (Master's row of Pałyn 2 under the metronome row; plate hidden under 600 px), site e2e for the tile

- [ ] **Step 1:** Write the texts as the spec has them, by CLAUDE.md "Writing".
- [ ] **Step 2:** `cd site && npm run build && npx playwright test e2e/page.spec.ts` passes; a picture of the new tile for Alex.

### Task 6: Review, PR, CI

- [ ] Whole-branch review; fix every finding before the PR. PR with Before/After/How; "Anything not covered": takes from a real rehearsal room by hand. Watch CI to green; ask Alex before merging.
