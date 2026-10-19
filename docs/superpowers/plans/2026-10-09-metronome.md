# A Metronome for Songs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each song keeps a tempo and a time signature; a metronome on the rehearsal screen clicks through an output of its own, counts in and flashes the beat; takes recorded to the click carry their tempo into `.mid` and WAV, play back with the click and show its bars on Master; reha.stream and the docs say so.

**Architecture:** The click's arithmetic and sounds live in `audio/click.py`, pure and shared by every stream that plays it. A take's click (`audio/take_click.py`) rides the recording stream when the click's output is the recording card (one stream with inputs and outputs, sample-locked) and otherwise drives its own output stream placed by the recording's clock (MIDI's `AudioClock` plus an `OutputClock`). Between takes the click plays through `audio/click_output.py`, or inside the player's stream when the player holds the same device. `metronome.py` holds the metronome's settings, the row's tempo and signature (following the next take's name, so Record from the screen, a key or the controller clicks the same), the free click and the state for the screen; `api.py` and `transport.py` only delegate. Files: a WAV writer of our own (`audio/wavfile.py`) adds the `acid` chunk; `midi/smf.py` gains tempo and time signature. The interface gets one row on the rehearsal screen, the count-in and edge light while recording, a Settings tab, a tempo row on a song's page, and a button and a striped lane on Master.

**Tech Stack:** Python 3.12, sounddevice/PortAudio, numpy, stdlib `wave` for reading, SQLAlchemy + Alembic on SQLite, mido and pylibremidi; React 19 + TypeScript + Tailwind in `ui/`, Vitest and Playwright on the fake bridge, Storybook for shared pieces; the Vite site in `site/`.

**Spec:** `docs/superpowers/specs/2026-10-09-metronome-design.md` (decisions M1–M16, "After the design system", Parts 1–11, "New in this spec" 1–14). Read it whole before the first task; every task argues from it.

**Built on main `3f447ba`** (the design system #43–#62, MIDI #37, the controller #57). Line numbers below are from that commit. Screens are drawn with the design system's components and rules (`docs/design-system.md`, `/mnt/project-files/design-system/rulings.md`); where a mockup and the design system differ, the design system wins.

**Approved looks** (reference for wording and placement only; their markup is pre-design-system and is not copied): `/mnt/project-files/metronome/q13/src/Metronome.tsx` with variants Q7 `b`, Q8 `b`, Q9 `a` + gear, Q10 `a`, Q11 `d`, Q13 `b`; mockups https://claude.ai/artifact/9f7bbX3awCVsaxkwyZVoNQ (Q11) and https://claude.ai/artifact/UWcojjzz2MVfyzCviavYC9 (Q13); reha.stream `/mnt/project-files/metronome/q12/src/patch_site.py` variant C (https://claude.ai/artifact/7HG5dsn5QtbNh5aCjjP21y). The recording screen's row: `/mnt/project-files/metronome/q14/` and its answer in `/mnt/project-files/metronome/rulings.md`.

## How the work runs

Nine tasks in four waves. Tasks in one wave run at once, each in its own git worktree on a branch off `claude/project-thread-87kzkw`; each gets a review (spec, then code quality) before it is merged back into `claude/project-thread-87kzkw`. A wave starts when the tasks it consumes are merged.

| Wave | Python | Interface |
|---|---|---|
| 1 | Task 1 (click, WAV, clocks) · Task 2 (`.mid`, library) · Task 3 (counter, pad taps) | Task 4 (bridge, `lib/metronome.ts`, fake) |
| 2 | Task 5 (the click in streams, `metronome.py`) | Task 6 (rehearsal row, recording screen) |
| 3 | Task 7 (Api, transport, crop, selftest) | Task 8 (Settings tab, song page, Master) |
| 4 | Task 9 (docs, site, alignment tool, review, PR) | |

**Tests while building:** run only the tests the change touches, each once: a single Python suite (`python tests/test_click.py`), one Vitest file (`cd ui && npx vitest run src/lib/metronome.test.ts`), one Playwright spec (`cd ui && npm run build && npm run test:e2e -- e2e/metronome.spec.ts`). No repeats, no flake loops, no unrelated suites. The full suites run once, on CI, on the PR. Every subagent brief says so.

## Global Constraints

- Test labels and Playwright titles: cp1252 characters only (CLAUDE.md "Writing"): "Palyn", "Ahon"; "·" and "—" are fine; no ł, ♪, ★, ▶ or arrows in a label. Test data may be in any script.
- Signatures exactly `"4/4"`, `"3/4"`, `"2/4"`, `"6/8"`. Clicks a bar 4, 3, 2, 6. Accent 2 on a bar's first click, 1 on 6/8's fourth, else 0.
- The tempo counts clicks: a click is `60 / tempo` seconds in every signature (a quarter in x/4, an eighth in 6/8). Range 30–300 in x/4, 60–600 in 6/8; integers. Quarter tempo = tempo in x/4, tempo / 2 in 6/8.
- A click's frame is `round(k * 60 * samplerate / tempo)` from the first click, computed from `k`, never summed.
- Stop on a click take, and a crop's end, go on to the next quarter boundary: the next click in x/4, the next even click in 6/8 (a whole quarter keeps the `acid` chunk's beat count whole).
- Sounds `"click"`, `"wood"`, `"hihat"` (labels Click, Woodblock, Hi-hat), made by the app; no sample files.
- Settings keys and defaults, in `config.json` through `Api._config` and `_write_config` (no file of the metronome's own): `click_device` (identity, through `_remember_device`, as `output_device`) and `click_channels` (none: the player's output), `click_sound` `"click"`, `click_volume` 0.7, `count_in_bars` 1 (0, 1, 2), `tempo_in_wav` true, `metronome_on` true.
- `.mid`: FF 51 = `round(60_000_000 / quarter tempo)`, 500000 when the take has no tempo; FF 58 x/4 `nn 02 18 08`, 6/8 `06 03 0C 08`, none without a signature.
- `acid` chunk, 24 bytes, before `data`: `struct.pack("<4sIIHHfIHHf", b"acid", 24, 0x04, 60, 0x8000, 0.0, beats, den, num, quarter_tempo)`; `beats` = the file's length in quarter notes. Reads back through libsndfile 1.2.2 as `time_sig_num=num`, `time_sig_den=den`, `bpm`, `num_beats`.
- A click plays only through `click_output.py`, the recorder's stream (`capture.py`) or the player's (`player.py`); nothing opens a second stream on a device the app holds (spec Part 3). A free click stops before `AudioRecorder.start`.
- Record has one path: the screen's `control_command("start")`, the keys and the controller all reach `Transport._start` (`transport.py:378`) and then `Api.start_take()` with no arguments. The take's tempo, signature and click come from `Metronome`, never from the caller.
- Every time on the Python side is `time.perf_counter_ns()`, as MIDI's.
- Old songs, takes and configs read as before: no tempo, not click takes, the click to the player's output.
- The interface follows `docs/design-system.md`: `Button` for every button; `Input`, `Select`, `Popover`, `Tooltip`, `Kbd` (chips hidden when keys are off, B9), `PickRow`, `Toggle`; Radix only inside `components/ui`; text-xs/sm/base/xl/2xl only, weights 400 and 600, figures with `tnum`; tokens only; the accent (`--primary`) for the one main action and what plays, a switch that is on or a choice that is picked in grey `bg-selected`; links are `Button variant="link"`; "amber" is `--warn` on the icon with the words in the text's colour (as `HealthLine`); corners rounded-sm/md/lg/xl/full; motion ≤ 400 ms, none on the recording screen but readings (F11 as amended by Task 6). `npm run design-check` passes with `ui/design-check.allow.json` still `{}`; `design-ok(rule): reason` only where the rules allow it (the count-in's window-sized digits).
- A piece used on two screens (tempo field, signature select, Tap, the drawn eighth, the slider) is shared: a story beside it and a line in `docs/design-system.md` (U3, U5, K1). Hooks live in `ui/src/hooks/`. A sentence used twice and every figure ("128 bpm", the drawn eighth in 6/8) come from one place (`lib/format.ts`, B8).
- No layout jumps; nothing cut at 960 px; both themes in the app (the site has one).
- Copy, exact (spec wording, written by CLAUDE.md "Writing"): the status lines of Part 4; "Count-in: 2 of 4" · "Clicking to Stop." · "Click off. The tempo still goes into the take." · "No click: this take has no tempo."; "Click with the take: 128 bpm · 4/4" · "This take was recorded without the click" · "Click 128 bpm · 4/4" · "Recorded without the click"; the Settings hints of Part 6 and the WAV checkbox's hint; "Count the tempo from a whole take of the song:"; the song page lines of Part 7; tooltips "Beats a minute" and "Eighths a minute: the six clicks of a bar"; the site's words in "On reha.stream". The word is take, never "go" (code and DB names such as `goes_of`, `SongGo` stay).
- Tests come first and are seen failing. Python suites are plain scripts with `ok(label, cond)` sections, as now. New sections take the next free number: `tests/test_engine.py` from `[79]`, `tests/test_store.py` from `[18]`, `tests/test_midi.py` from `[11]`.
- Commits end with the session's two attribution lines; no model names anywhere in the repo.
- No merge without Alex's word, after he has seen screenshots. The PR opens only after the whole-branch review's findings, minors included, are fixed and pushed.

## Review Focus

The things the spec implies but does not test, most likely to bite first. Each one's test is added to the task named.

1. **A tempo typed wrong**: empty, "abc", "128.6", "0", "9999", a minus sign, a 6/8 number pasted into 4/4. Expected: empty means no tempo; a number is rounded and kept in the signature's range; anything else puts the last good value back. Task 4.
2. **The click's output vanishing mid-take** (a headphone amp unplugged, Bluetooth gone). Expected: the take records on, stays a click take with its grid, the screen keeps flashing, `metronome_state()` says `output_missing`, Stop works, and `recording_health` does not report it as the recording's problem. Task 5.
3. **The click device at another sample rate** than the recording card (44.1 kHz jack, 48 kHz desk). Expected: the voices are made at the output's rate and each click still lands within the Part 3 aim. Task 5.
4. **The tempo changed while ▶ runs** (−/+, typing, Tap, another song picked, here or from the controller). Expected: the click goes on at the new tempo from its next click, no gap, no double click, the bar restarting on 1 only when the signature changes. Task 5.
5. **Stop pressed during the count-in.** Expected: the take ends on the next quarter, is kept or thrown away as any short take (false start rules unchanged), and its files and `.mid` start at the first click. Task 5.
6. **Record from the controller.** Expected: the same count-in and click as Record on the screen, the take keeps the row's tempo (a change held in the row included), and the controller's display shows 0:00 at the count-in's end. Task 7.

## Files

New, Python:

| File | Its one job |
|---|---|
| `audio/click.py` | Signatures, ranges, accents, click frames, the three voices, mixing clicks into a buffer, snapping a crop to the grid. |
| `audio/click_timing.py` | `OutputClock`; a stream's lead and a duplex stream's round trip from `time_info`. |
| `audio/click_source.py` | `ClickSource`: one running click rendered block by block into any stream; what is heard next, for the screen. |
| `audio/click_output.py` | `ClickOutput`: an output stream of its own for a `ClickSource`. |
| `audio/take_click.py` | `TakeClick`: a take's click, its first click frame, its end, duplex or another device. |
| `audio/wavfile.py` | `WavWriter` with an optional `acid` chunk; `read_acid`. |
| `audio/tempo.py` | Counting a tempo from a take (Part 10). |
| `metronome.py` | The settings, the row's tempo following the next take's name, the free click and previews, the state for the screen, which sink a click goes to. |
| `store/migrations/versions/0008_metronome.py` | Song and take tempo columns. |

Changed, Python: `audio/capture.py`, `audio/player.py`, `audio/crop.py`, `audio/mixdown.py`, `audio/drafts.py`, `midi/clock.py`, `midi/smf.py`, `midi/capture.py`, `midi/rig.py`, `store/models.py`, `store/library.py`, `api.py`, `transport.py`, `mediaserver.py`, `app.py` (selftest).

Tests: new suites `tests/test_click.py` and `tests/test_tempo.py` (in `tests/run_all.py` `SUITES`; "Twelve" becomes "Fourteen" in `run_all.py:6`, `tests/README.md:9`, `docs/controller-debugging.md:80`; a section each in `tests/README.md`); new sections in `tests/test_engine.py`, `tests/test_store.py`, `tests/test_midi.py`, `tests/test_transport.py`, `tests/test_platform.py`. Heavy arithmetic (an hour of clicks, drifting clocks) goes in `test_click.py`, never in `test_engine.py`, whose length bounds the whole Python run.

Interface: `ui/src/lib/api.ts`, `lib/format.ts`, new `lib/metronome.ts` (+ `metronome.test.ts`), new `components/metronome/` (`NoteGlyph`, `TempoField`, `SignatureSelect`, `TapButton`, `BeatDots`, `ClickSettings`, `MetronomeRow`, `StatusLine`, `CountIn`, `EdgeLight`, `TakeRow`, `SongTempoRow`, `MasterClick`, `MasterClickLane`, each shared one with a story), new `components/ui/slider.tsx` (+ story), new `hooks/useMetronome.ts`, new `components/MetronomeSettings.tsx`; changed `screens/Rehearsal.tsx`, `screens/Recording.tsx`, `screens/Settings.tsx`, `screens/HistoryScreen.tsx`, `screens/Review.tsx`, `components/SongPage.tsx`, `components/Timeline.tsx`, `components/LaneControls.tsx`, `components/TakePlayer.tsx`, `components/KeysSettings.tsx`, `lib/deletion.ts`, `hooks/useSpacebar.ts` (comment), `e2e/fake-bridge.js`, `e2e/band.js`, new `e2e/metronome.spec.ts`; `docs/design-system.md` (F11, B9, C8, the new pieces).

Docs, site, tools: `docs/using-it.md`, `CHANGELOG.md`, `README.md` (only if a picture it uses changes), `tests/docs_screenshots.py`, `docs/screenshots/`, `site/content/story.md`, `site/content/features.md`, `site/content/faq.md`, `site/src/content/index.ts`, `site/src/page/Features.tsx`, `site/src/page/pieces.tsx`, `site/src/stage/Story.tsx`, the site's tests, new `tools/click_alignment.py`.

## Shapes every task shares

```python
# A song (Library.songs(), get_song): adds
"tempo": int | None, "signature": "4/4" | "3/4" | "2/4" | "6/8" | None
# A take (_take_data, stop_take, keep_take, pending_take): adds
"tempo": int | None, "signature": str | None, "click": bool
# take.json, written at Record when the metronome has a tempo, kept by drafts:
"click": {"tempo": int, "signature": str, "on": bool, "wav_tempo": bool,
          "first_click_frame": int | None, "end_frame": int | None}
# first_click_frame: input frame of the first count-in click (None until chosen, or with no click);
# end_frame: the frame the files end on (None until Stop).
# metronome_state() (POLLABLE, not behind the transport's gate):
{"phase": "idle" | "preview" | "count" | "take",
 "tempo": int | None, "signature": str, "per_bar": int,
 "on": bool,                                   # the row's switch (metronome_on)
 "case": "song" | "song_without" | "free",     # spec Part 2's three cases, from the next take's name
 "song": {"id": int, "title": str, "tempo": int | None, "signature": str | None} | None,
 "held": bool,                                 # the row differs from the song (Save to song)
 "last_take": {"folder": str, "take_number": int, "name": str} | None,  # for "count it from the last take"
 "upcoming": [[in_ms: float, index_in_bar: int], ...],   # clicks heard in the next 1.5 s
 "count": int,                                 # 1-based count-in click, 0 outside the count-in
 "since_count_in_ms": float | None,            # ms since the count-in ended (negative before); None with no click
 "output_missing": str | None}                 # the click device's name when it cannot play
```

Calls on `Api` (the interface's whole surface): `get_settings()` (adds the settings keys and `click_device_index`), `set_click_device(index)`, `set_click_channels(channels)`, `set_metronome_setting(key, value)`, `metronome_set(tempo, signature)` (the row's change, held until the next take's name names another song), `metronome_save_to_song()`, `metronome_set_on(on)` (also mid-take), `metronome_play()`, `metronome_stop()`, `metronome_preview(sound=None)`, `metronome_state()`, `count_tempo(folder, take_number, signature)`, `set_song_tempo(song_id, tempo, signature)`, `metronome_tap_listen()`, `metronome_taps()` (POLLABLE: `{"ms_ago": [float]}`), `player_set_click(on)`; `list_output_devices()` items gain `click_unavailable: str | None`.

---

### Task 1: The click, the WAV's tempo and the clocks (wave 1, Python)

**Files:**
- Create: `src/rehearsal_recorder/audio/click.py`, `audio/wavfile.py`, `audio/click_timing.py`, `tests/test_click.py` (in `run_all.py` and `tests/README.md`; Task 3 adds `test_tempo.py` the same way, so whichever merges second settles the count at "Fourteen")
- Modify: `audio/capture.py` (`raw_to_wav:586`), `audio/crop.py` (`crop_wav:54`), `audio/mixdown.py` (`mixdown:28`), `midi/clock.py` (`AudioClock:49`, `fit:128`)
- Test: `tests/test_click.py`, `tests/test_engine.py`

**Interfaces:**
- `click.py`: `SIGNATURES`, `SOUNDS`; `tempo_range(signature) -> tuple[int, int]`; `clamp_tempo(value: float, signature) -> int`; `per_bar(signature)`; `per_quarter(signature)` (1, or 2 in 6/8); `accent(signature, k)`; `quarter_tempo(tempo, signature) -> float`; `click_frame(k, tempo, samplerate) -> int`; `class Voices(sound, samplerate, volume)` with `of(accent) -> np.ndarray` (float32, mono, ≤ 60 ms); `mix_clicks(out, first_frame, starts: list[tuple[int, int]], voices, route)` (adds each voice from its start frame, clipped to `out`; a voice starting before `first_frame` adds its tail); `snap_region(start_sec, end_sec, tempo, signature, samplerate, length_frames) -> tuple[int, int]` (start back to the bar line at or before it, end on to the next quarter boundary, both inside the file).
- `wavfile.py`: `@dataclass(frozen=True) class Acid: quarter_tempo: float; num: int; den: int`; `WavWriter(path, samplerate, channels, sampwidth, acid=None)`, a context manager with `write(frames: bytes)`, writing RIFF, `fmt `, `acid` (beats from the frames written, patched at close) and `data`; `read_acid(path) -> Acid | None`.
- `raw_to_wav(..., head_frames=0, frames=None, acid=None)` writes `[head_frames, head_frames + frames)`; `crop_wav(..., acid="keep")` copies the source's chunk with beats for the new length; `mixdown(..., acid=None)` writes the given chunk. All three write through `WavWriter`.
- `click_timing.py`: `OutputClock(samplerate)` with `mark(arrival_ns, first_frame, lead_sec)`, `frame_at(ns)`, `ns_at(frame)` (fitted as `fit` does); `lead_of(time_info, fallback_sec)`; `round_trip_frames(time_info, fallback_sec, samplerate)`.
- `AudioClock.ns_at(frame) -> int`: the fitted line read forward. The line is refitted only when a mark is kept and stored as one tuple replaced whole, so another stream's callback reads it without locks and without refitting (today `to_seconds` refits on every block, `clock.py:115-125`; keep its results unchanged).

- [ ] **Step 1: Write the failing sections** in `tests/test_click.py`:
  - `[1] The click`: ranges `(30, 300)` and `(60, 600)`; `clamp_tempo(128.6, "4/4") == 129`, `(20, "4/4") == 30`, `(700, "6/8") == 600`; accents 4/4 `[2,0,0,0,2]`, 6/8 `[2,0,0,1,0,0,2]`, 3/4 `[2,0,0,2]`, 2/4 `[2,0,2]`; `quarter_tempo(198, "6/8") == 99`; `click_frame(k, 128, 48000) == round(k * 22500)` for an hour of k; tempo 127 at 44100: the hour's last click within 0.5 frame of `k * 44100 * 60 / 127`; each voice's peak ≤ volume, accent 2 above 0 by spectral centroid, 1 between; three sounds differ; a voice at 44100 and at 48000 lasts the same within a frame; `mix_clicks` into two 256-frame blocks equals one 512-frame block for a click at 250, only on routed channels.
  - `[2] The WAV's tempo`: 16- and 24-bit stereo without `acid` byte-identical to `wave`'s; with `Acid(99.0, 6, 8)` and 8 quarters at 48000 libsndfile reads `time_sig_num 6`, `time_sig_den 8`, `num_beats 8`, `bpm 99.0` (`soundfile._snd.sf_command(f._file, 0x10E0, buf, 44)`, `struct.unpack("<hhiifi", buf[:20])`), `wave` reads the same frames, `read_acid` round trips; none on a plain file.
  - `[3] Where a click is heard`: an `AudioClock` fed an hour of marks at +200 ppm (MIDI's test data) and an `OutputClock` an hour at −150 ppm with ±2 ms jitter: the click of input frame `48000 * 3600` lands on the output frame heard within 1 ms of its capture time; `ns_at` inverts `to_seconds` within 1 µs; `lead_of`/`round_trip_frames` use the driver's times when sane, the fallback for 0, negative or > 1 s.
  - `[4] Snapping a crop`: 4/4 at 120, 3.3–10.2 s cuts 2.0–10.5 s; 6/8 at 180, 1.1–3.95 s cuts 0.0–4.0 s and 1.1–4.05 s cuts 0.0–4.6667 s (a quarter is 0.6667 s); a region starting in the count-in snaps to 0; one ending in the last part-quarter ends at the file's end.
- [ ] **Step 2: Add `[79] Files that keep their tempo`** to `tests/test_engine.py`: `raw_to_wav(head_frames=480, frames=48000)` writes exactly those frames; `crop_wav` keeps a chunk with beats for the cut length and adds none to a file without; `mixdown(acid=Acid(128.0, 4, 4))` carries it.
- [ ] **Step 3: Run** `python tests/test_click.py` and `python tests/test_engine.py` once each → fail.
- [ ] **Step 4: Implement.** Voices: a short sine burst with a fast exponential decay (Click: 900 Hz accent 0, 1100 accent 1, 1300 accent 2), a band-limited resonant burst (Woodblock), filtered noise (Hi-hat), each with a 1 ms raised-cosine attack, cached per `(sound, samplerate, volume)`.
- [ ] **Step 5: Run** both once → pass, and `python tests/test_midi.py` once (the clock).
- [ ] **Step 6: Commit** — `Metronome: the click, a WAV that carries its tempo, and the clocks to place it`.

### Task 2: The `.mid` and the library keep the tempo (wave 1, Python)

**Files:**
- Create: `src/rehearsal_recorder/store/migrations/versions/0008_metronome.py` (`revision="0008"`, `down_revision="0007"`, the docstring as 0007's)
- Modify: `midi/smf.py` (`write_mid:117`, `read_events:188`, `crop_mid:246`), `midi/capture.py` (`MidiRecorder.stop:355`, `finish_draft:494`, `_make_mid:579`, `_place:643`), `midi/rig.py` (`end_take:387`), `store/models.py` (`Song:58`, `Take:119`), `store/library.py` (`_take_data:202`, `merge_songs:558`, `songs:640`, `goes_of:680`, `add_take:943`, `update_take:975`; new `set_song_tempo`, `tempo_for`)
- Test: `tests/test_midi.py`, `tests/test_store.py`

**Interfaces:**
- `write_mid(path, *, track_name, port_name, start, events, tempo_us=500_000, time_signature=None)`; `read_events` metas add `tempo_us` and `time_signature`; `crop_mid` keeps both (today it drops the tempo when it rewrites, `smf.py:307`); `smf.meter_of(tempo, signature) -> tuple[int, tuple | None]`. Ticks: 960 a quarter, `tick = round(seconds * 960 * 1_000_000 / tempo_us)` from the take's start, never summed (1920 a second at 500000, as now).
- `MidiRecorder.stop(duration_sec, head_sec=0.0, meter=(500_000, None))` and `MidiRig.end_take(duration_sec, head_sec=0.0, meter=(500_000, None))` pass them on; every event's time is less `head_sec`, and what falls before 0 feeds the start state, as `_place` already does for `sec < 0`. `finish_draft(take_dir, duration_sec, samplerate=None)` reads `click.first_click_frame` and the meter from `take.json` itself.
- `Song.tempo`, `Song.signature`; `Take.tempo`, `Take.signature`, `Take.click` (default False). The migration adds columns in place (`ALTER TABLE … ADD COLUMN`, as 0003, 0006 and 0007's `take_file`); no batch mode: rebuilding `song` or `take` cascades into their children with `foreign_keys=ON` (`store/db.py:70`, 0007's docstring).
- `Library.set_song_tempo(song_id, tempo, signature) -> dict | None`; `Library.tempo_for(name) -> {"song": {"id", "title", "tempo", "signature"} | None, "last_take": {"folder", "take_number", "name"} | None}` (read only, through `resolve_name:448`); `add_take` and `update_take(..., tempo=None, signature=None, click=None)` read those keys.
- Rules (spec Part 2): `add_take` of a click take to a song with no tempo gives the song its tempo and signature; `update_take(name=…)` moving a take with a tempo into a song with none gives the song that tempo; a rename keeps a song's tempo; `merge_songs` keeps the target's, or takes the source's when the target has none. Undo of a removal brings the columns back already (`_take_record:1096`).

- [ ] **Step 1: Write the failing sections**: `tests/test_midi.py` `[11] The take's tempo in its .mid` (`meter_of(128, "4/4") == (468750, (4, 2, 24, 8))`; `meter_of(198, "6/8") == (606061, (6, 3, 12, 8))`; `meter_of(None, None) == (500000, None)`; a written file reads back `set_tempo` 606061 and 6/8 with `clocks_per_click == 12` at tick 0 before the start messages; `end_take(head_sec=0.25)` puts a note played at 1.0 s at 0.75 s, a pedal at 0.1 s into the start state, nothing before 0; `finish_draft` of a draft whose `take.json` has a click gives the same file; `crop_mid` keeps tempo and signature) and `tests/test_store.py` `[18] Tempos in the library` (migration on an existing library: all `None`, `None`, `False`; each rule above; 198 in 6/8 through `songs()` and `goes_of`; `tempo_for("Palyn 3")` finds Pałyn and its newest take, `tempo_for("Take 4")` no song; `set_song_tempo` refuses a signature outside the four and a tempo outside its range, changing nothing; a removed take's Undo keeps its tempo).
- [ ] **Step 2: Run** both suites once → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both once → pass, MIDI's own sections included.
- [ ] **Step 5: Commit** — `Metronome: a take's .mid states its tempo, and songs and takes keep one`.

### Task 3: Counting a tempo, and pads that tap (wave 1, Python)

**Files:**
- Create: `src/rehearsal_recorder/audio/tempo.py`, `tests/test_tempo.py` (in `run_all.py` and `tests/README.md`)
- Modify: `midi/rig.py` (`MidiRig:193`; taps hook into `_event:490`, where note-ons are seen)
- Test: `tests/test_tempo.py`, `tests/test_midi.py`

**Interfaces:**
- `tempo.count(*, drums_mid, drums_wav, wavs, signature) -> float | None`: the onset envelope and windowed autocorrelation of `/mnt/project-files/metronome/research/np_tempo.py`, the median of 8-second windows' tempos, read in blocks; in 6/8 the eighth whose triple period is also among the strongest; clamped to the signature's range; None for silence or under 8 s.
- `MidiRig.listen_taps(quiet_sec=2.0)` and `MidiRig.taps() -> list[int]` (ns of note-ons with velocity > 0 since the last read, from the rig's instrument ports only, only while listening; listening ends after `quiet_sec` with no hit). The controller's port is reserved out of the rig (`rig.py:298`, `768-773`), so its buttons never tap.

- [ ] **Step 1: Write the failing sections**: `tests/test_tempo.py` `[1] Counting a tempo` on synthetic takes made as `research/compare.py` makes them (4/4 at 128 → 128 ±2, or 64/256 flagged as the halve/double case in the label; 3/4 at 96; 6/8 eighths at 198 → 198 ±3; a drift 124→134 → within 3 of 129; a drums `.mid` used before the WAV; silence → None; prints the time for a 3-minute take, aim about 0.3 s) and `tests/test_midi.py` `[12] Pads that tap` (hits before `listen_taps` are not taps; after it they are; 2.1 s of quiet ends listening; the controller's port gives none).
- [ ] **Step 2: Run** both once → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both once → pass.
- [ ] **Step 5: Commit** — `Metronome: a tempo counted from a take, and pads that tap`.

### Task 4: The interface's side of the bridge (wave 1, interface)

**Files:**
- Modify: `ui/src/lib/api.ts` (`Song:328`, `SongSummary:445`, `SongDetail:476`, the take types, `Pollable:1414`), `ui/src/lib/format.ts`, `ui/e2e/fake-bridge.js`
- Create: `ui/src/lib/metronome.ts`, `ui/src/lib/metronome.test.ts`

**Interfaces:**
- `api.ts`: `Signature`, `ClickSound`, `MetronomeSettings`, `MetronomeState` as the Shapes above; songs and takes gain `tempo?`, `signature?`, `click?`; every call in the Shapes; `Pollable` gains `metronome_state` and `metronome_taps`.
- `format.ts`: `formatTempo(tempo, signature)` → "128 bpm", or the number with the drawn eighth's text form for 6/8 (the glyph itself is `NoteGlyph`, Task 6); `formatMeter(tempo, signature)` → "128 bpm · 4/4". Every tempo on screen goes through them (B8).
- `metronome.ts`: `SIGNATURES`, `tempoRange(sig)`, `parseTempo(text, sig, last) -> number | null` (Review Focus 1), `perBar(sig)`, `accentOf(sig, i)`, `unitTitle(sig)`, `tapTempo(timesMs, sig) -> number | null` (the average of the last four gaps; a gap over 2000 ms starts afresh; clamped), `statusLine(state, counting) -> { text; link?: { label; action: "save" | "count" }; warn?: boolean }` for every Part 4 line, `songLine(...)` for Part 7.
- The fake bridge (`__MAKE_API__` at `fake-bridge.js:938`; config through `readCfg`/`writeCfg`): tempos beside `REPERTOIRE` (`:523`; Pałyn 128 4/4, Viasna 128 4/4, Ahoń 198 6/8, Sonca 96 3/4, Daroha 118 4/4; Dym and Ptuška none) served by `get_song`, `list_songs` and `song_choices`; `tempo`, `signature`, `click` on the takes `start_take`/`keep_take` make and on the past rehearsals' takes (the demo band's at 128, click takes); `metronome_state` that follows the next take's name and holds a row change, driven by a timer from `start_take` through the count-in and the take; `metronome_set`, `metronome_save_to_song`, `metronome_set_on`, `metronome_play/stop/preview`, the settings calls, `count_tempo` (Dym 104, Ptuška 86), `metronome_tap_listen`, `metronome_taps`, `player_set_click`; `list_output_devices` with one `click_unavailable` device; `window.__CLICK_MISSING__` for the amber line.

- [ ] **Step 1: Write the failing `metronome.test.ts`**: `parseTempo("", "4/4", 120) === null`; `("128.6") === 129`; `("abc", …, 120) === 120`; `("0") === 30`; `("9999", "6/8") === 600`; `("-5") === 30`; `tapTempo([0, 500, 1000, 1500, 2000], "4/4") === 120`; a 2100 ms gap restarts; each Part 4 line from its state, Save to song only while `held`; `accentOf("6/8", 3) === 1`; `formatMeter(198, "6/8")` and `(128, "4/4")`.
- [ ] **Step 2: Run** `cd ui && npx vitest run src/lib/metronome.test.ts` once → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it once → pass; `npm run build` (CI's `tsc -b`) passes.
- [ ] **Step 5: Commit** — `Metronome: the interface's side of the bridge`.

### Task 5: The click in every stream, and the metronome (wave 2, Python; needs Task 1)

**Files:**
- Create: `src/rehearsal_recorder/audio/click_source.py`, `audio/take_click.py`, `audio/click_output.py`, `src/rehearsal_recorder/metronome.py`
- Modify: `audio/capture.py` (`AudioRecorder.__init__:126`, `_callback:298`, `start:396`, `_write_record:467`, `stop:498`; `stop` deletes `take.json` at 540-541 unless the take has notes: keep it for a click take too, or keep the click in the pending take, so a crop of the draft knows its grid), `audio/drafts.py` (`finalize:119`: cut a recovered click take at `first_click_frame` and cut the duration it passes to `finish_draft`), `audio/player.py` (`open_output:188`, `_start_output:228`, `_render:300`; the take click follows `master_muted:491`)
- Test: `tests/test_click.py`, `tests/test_engine.py` (the sounddevice stub at `:95-96` gains `Stream`, recorded as `InputStream` is)

**Interfaces:**
- `ClickSource(tempo, signature, voices, route, place=None, bars=None, start_k=0)` with `render(out, first_frame, arrival_ns, lead_sec)`, `set_on(on)`, `retime(tempo, signature)` (from the next click on the new period; the bar restarts on 1 only when the signature changes), `upcoming(now_ns, within_sec=1.5)`, `count_state(now_ns, count_in_clicks)`.
- `TakeClick(tempo, signature, count_in_bars, voices, route, on=True, wav_tempo=True, lead_sec=0.1, output=None)` with `duplex`, `first_click_frame`, `end_frame`, `on_duplex_block(outdata, frames_done, frames, time_info, latency)`, `on_input(frames_done, clock)`, `stop_frame(frames_done)`, `record()`, `acid()`, `meter()`.
- `AudioRecorder(..., clock=None, notes=(), click=None)`: with `click.duplex`, `start()` opens `sd.Stream(device=(index, index), channels=(inputs, max(route) + 1))`; the round trip comes from `time_info`, falling back to the stream's input and output latencies (`latency[0] + latency[1]`, not the requested latency `_stream_latency:115` falls back to); the first callback sets `first_click_frame = frames_done + lead + round_trip`, and the click of input frame `s` is written at output frame `s - round_trip`. With an output, the recorder's callback calls `on_input`, which sets `first_click_frame = frames_done + 0.2 s` at the first input block after the output's first block, each click placed at `out_clock.frame_at(in_clock.ns_at(first_click_frame + click_frame(k)))`. `stop()` keeps capturing until `stop_frame` (at most 2 s more; not when the stream has died) and writes `[first_click_frame, end_frame)` of each raw; `duration_sec` is that length. `take.json` gets `click` at start and again once `first_click_frame` is known. A failed click output never shows in `AudioRecorder.problem()` (`capture.py:240`).
- `ClickOutput(device_index, channels, samplerate=None)` with `start(source)`, `swap(source | None)`, `stop()`, `problem()`, `samplerate`; its callback marks an `OutputClock` and renders the source.
- `TakePlayer.open_output(device_index=None, channels=(1, 2), extra_channels=())` (wide enough for both); `play_free_click(source | None)` (on the source's route, outside the master volume and meters); `set_take_click(tempo, signature, voices | None)`, `set_click_on(on)` (Part 8: at the take's own frames from file frame 0, following seek and loop, scaled by the master volume, silent while muted, out of the meters; `state()` adds `"click": bool`).
- `Metronome(config, write_config, player_getter, device_lookup, library)`: `settings()`, `set_setting(key, value)` (validated, unknown keys refused, saved through `write_config`), `follow(name)` (the next take's name: the song's tempo or none, per Part 2; drops a held change only when the name names another song), `set(tempo, signature)` (held), `save_to_song()`, `set_on(on)`, `take_meter() -> (tempo, signature, on)` for `start_take`, `click_sink()` (`("player", TakePlayer)` when the player holds the click's device, else `("own", ClickOutput)`; with no click device saved, the player's output device and channels, New 1), `play()`, `stop()`, `preview(bars=1, sound=None)`, `state()` (the `metronome_state` shape), `output_problem()`.

- [ ] **Step 1: Write the failing sections** in `tests/test_click.py`: `[5] A take's click, one stream` (`TakeClick` on fake duplex blocks: round trip 9.5 ms at 48000, 1 bar of 4/4 at 120: the first click at output frame `first_click_frame - 456`; four count-in clicks; `on=False` writes silence and keeps counting; a 6/8 `stop_frame` on an even click); `[6] A take's click, another device` (input 48000 at +200 ppm, output 44100 at −100 ppm, jitter: every click of an hour within 1 ms, Review Focus 3; voices made at 44100; an output starting 2 s late moves the first click, the count-in stays whole); `[7] The click on its own` (Review Focus 4: retimed 120→140, no gap over 60/120 s, no two clicks closer than 60/140 s; a new signature's next click is accent 2; `preview(bars=1)` stops after one bar; `follow` gives Part 2's three cases and keeps a held change until another song).
- [ ] **Step 2: Add to `tests/test_engine.py`**: `[80] Recording to the click` (one stream with inputs and outputs; `take.json`'s `click` has `first_click_frame`; each WAV starts there and ends on `end_frame`, the `acid` chunk with `tempo_in_wav` and not without; a crashed take's draft recovers cut at the same frame, its `.mid` too; Review Focus 5: Stop in the count-in ends at the next quarter, the WAVs and `.mid` start at the first click); `[81] The click elsewhere` (the recording stream input only, a second `OutputStream` on the click device; Review Focus 2: that stream ending mid-take leaves the recording going, `problem()` set on the click and not on the recorder, Stop working, the take a click take); `[82] The click and the player` (player on device 3 outputs 1–2, click on device 3 outputs 3–4: one 4-channel stream, ▶ mixes into it and nothing else opens; the player closed, ▶ opens a `ClickOutput`; the take click at file frame 0 + `click_frame(k)` after a seek to 10.0 s and inside a loop, half level at master 0.5, silent while muted, `levels` untouched; `set_setting("click_volume", 2)` and `("count_in_bars", 3)` refused; a saved click device not plugged in gives `output_problem()` its name; with none saved the sink is the player's output).
- [ ] **Step 3: Run** `python tests/test_click.py` and `python tests/test_engine.py` once each → fail.
- [ ] **Step 4: Implement.** The duplex callback zeroes `outdata` and lets `TakeClick` write into it before `_take_block`; nothing in the callback allocates beyond what `mix_clicks` writes in place.
- [ ] **Step 5: Run** both once → pass, and `python tests/test_midi.py` once.
- [ ] **Step 6: Commit** — `Metronome: the click on the recording card, on another device and in the player`.

### Task 6: The rehearsal screen's row, and while recording (wave 2, interface; needs Task 4)

**Files:**
- Create: `ui/src/components/metronome/` `NoteGlyph.tsx`, `TempoField.tsx`, `SignatureSelect.tsx`, `TapButton.tsx`, `BeatDots.tsx`, `ClickSettings.tsx`, `StatusLine.tsx`, `MetronomeRow.tsx`, `CountIn.tsx`, `EdgeLight.tsx`, `TakeRow.tsx`, each shared one with a `.stories.tsx`; `ui/src/components/ui/slider.tsx` (shadcn Slider) with its story; `ui/src/hooks/useMetronome.ts`; `ui/e2e/metronome.spec.ts`
- Modify: `ui/src/screens/Rehearsal.tsx` (the footer `:525-576`: the row as `FooterRow`'s `left`), `ui/src/screens/Recording.tsx` (the clock `:427-446` and its fit `:276-338`; the bar against the last take `:368-391`; the footer `:397-401`), `ui/src/components/KeysSettings.tsx` (T in the player's keys: the Rehearsal and History rows and the hint `:74`), `ui/src/hooks/useSpacebar.ts` (the `useKey` comment), `docs/design-system.md` (F11, B9, C8 if `PickRow` leaves Settings, a line for each new shared piece), the e2e specs that count tabs or key chips (`rehearsal-frame.spec.ts:306-308`, `keys.spec.ts:235-265`)

**Interfaces:**
- `useMetronome()` → `{ state: MetronomeState, lit: number | null }` (polls `metronome_state`, lights each click at its `in_ms` with `requestAnimationFrame`, never a free-running timer).
- `TempoField({ tempo, signature, onChange })`; `SignatureSelect`; `TapButton({ signature, onTempo })` (button, key T through `useKey("t", …)`, which obeys the player's keys and skips text fields; pad hits from `metronome_taps` after a press); `ClickSettings()` (the four settings, the gear's popover with "The same settings are in Settings › Metronome.", reused by Task 8's tab; Sound and Count-in as `PickRow`, the volume as the shared slider; while no click device is saved the pickers show the player's device and outputs); `MetronomeRow()` (from `metronome_state`: the switch, the tempo, the signature, Tap, ▶/■, the dots, the gear; a change calls `metronome_set`; Save to song / Save now call `metronome_save_to_song`; "count it from the last take" calls `count_tempo` and keeps the count while the row is open).
- Recording: `CountIn` over the kept clock box while `phase === "count"` (the box and its fit stay, so nothing jumps; `// design-ok(px-text)` as the clock); the clock and the bar against the last take read `since_count_in_ms` when it is not null; `EdgeLight` (a fixed inset edge in `--primary`, 7 px, 14 px on accent 2, on and off on the click with no fade or transition, `aria-hidden`; still shown under Reduce motion, as the spec's "After the design system" says); `TakeRow` at the footer's far left, as on the rehearsal screen, and the status row moved to the footer's right, just left of Stop (Alex's answer to q14, «Слева, как было»).
- The status line keeps two lines' room; the beat dots in 6/8 in two groups of three with a 3 px gap and 6 px between the groups. Button and toggle sizes from `button.tsx:44-56` and `toggle.tsx:26-30` as they are now.

- [ ] **Step 1: Write the failing Playwright tests** (titles cp1252): `metronome row follows the next song` (Palyn 128 4/4 → Viasna → Dym "No tempo yet"); `a change holds until another song and saves to it`; `a free take`; `T taps a tempo and not inside the name field`; `T is off with the player keys`; `pads tap after Tap`; `play runs the click and Record stops it`; `the warning line when the click output is missing`; `nothing moves when a song is picked` (the row's and Record's boxes unchanged); `a signature change keeps the number`; `leaving the screen stops the click`; `row fits at 960 in both themes` (Ahoń in 6/8 too; measures the lanes in view at 960×680 before and after); `count-in digits then the edge light` (digits 1–4, then the edge on the next click); `6/8 counts to six`; `the clock starts after the count-in` (0:00 at the count-in's end, ±0.2 s); `the switch silences the click mid-take`; `no click, no light`; `the edge light shows with reduced motion`; `the take row fits at 960 beside the status`.
- [ ] **Step 2: Run** `cd ui && npm run build && npm run test:e2e -- e2e/metronome.spec.ts` once → fail.
- [ ] **Step 3: Implement**, as the Q7 B row with Q9's gear and Q13 B's 6/8, drawn with the design system's pieces; the stories; the docs/design-system.md lines.
- [ ] **Step 4: Run** the metronome spec, the specs whose counts changed (`rehearsal-frame`, `keys`), `npm run design-check`, `npx vitest run` on the touched tests and `npm run build-storybook`, each once → pass.
- [ ] **Step 5: Commit** — `Metronome: the row on the rehearsal screen, the count-in and the beat while recording`.

### Task 7: Record clicks, through the Api and the transport (wave 3, Python; needs Tasks 2, 3, 5)

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`__init__`, `get_settings:963`, `shutdown`, `start_take:2376` (its clock `:2403-2416` is made for a click on another device too, not only for notes), `stop_take:2473`, `_end_notes:2539`, `keep_take:2595`, `recover_draft`, `_describe_devices:1510`/`list_output_devices:1576`, `_player_open:4058`, `player_close:4095`, `_crop_tracks:3585`, `crop_take:3775`, `crop_draft:3971`, `get_song:3168`, `rename_take:3239`, `merge_songs:3312`, `_copy_to_cloud:5714`, `set_next_take_name:2154`, `finish_rehearsal:2220`, the signal check's port use `:1745/1781`; the new calls), `transport.py` (`_start:378`, `_stop_keep:415`, `_save_pending:436`, `_stop_rehearsal:257`, `state()` `elapsed:129`), `mediaserver.py` (`POLLABLE:37-56`), `app.py` (`selftest:80`, the list `:257-271`)
- Test: `tests/test_engine.py`, `tests/test_transport.py`, `tests/test_platform.py` (`:594-630`)

**Interfaces:**
- Every call in the Shapes. `metronome_play`, `metronome_stop` and `metronome_preview` are `@serialised` (the transport's gate, `transport.py:21-33`); `metronome_state` and `metronome_taps` are not.
- `start_take()` takes the tempo, signature and switch from `Metronome.take_meter()`: no tempo, or the switch off, records without a click (a take with a tempo and the switch off still keeps its tempo, `click` False). It builds the `TakeClick` (duplex when the click device is the recording device, else a `ClickOutput`) and stores `click` in `take.json`. `Transport._start` stops the free click before the recorder opens, beside `player_close` (`:390-395`).
- `Metronome.follow` is called wherever the next take's name changes (`set_next_take_name`, the controller's song steps through `transport.py:235, 529`, a new rehearsal).
- `stop_take` and `_end_notes` pass `head_sec` and the meter to `MidiRig.end_take`; `stop_take`, `keep_take` and `_save_pending` carry `tempo`, `signature`, `click` (the controller's Stop keeps through `_stop_keep`). `_stop_rehearsal` and `finish_rehearsal` stop ▶.
- The transport's `elapsed` counts from the count-in's end, as the screen's clock, so the controller's display shows 0:00 when the band starts.
- `_player_open` applies `player_set_click` (kept on the `Api` for the session, off in a fresh `Api`) and re-sinks a running free click; so does `player_close`.
- `crop_take` and `crop_draft` of a click take use `snap_region` and return `{"start_sec", "end_sec"}` as cut; the `.mid` is cut the same; the Undo hold (`_hold_uncut:3710`) is unchanged. The cloud's mix carries the chunk; WAV copies are byte for byte.
- `count_tempo(folder, take_number, signature)` and `set_song_tempo(song_id, tempo, signature)`; `metronome_tap_listen()` uses the rehearsal's rig, or outside one the band's ports through `self._midi.use(...)`/`release()` as the signal check does (no second rig: it would miss `reserve_controller` and clash on Windows' open-once ports), released after the quiet.
- `list_output_devices()` items gain `click_unavailable` ("Another ASIO card can't play while one records." for an ASIO device other than the recording card when that card is ASIO, `devices._is_asio:600`).
- Selftest `check("click and WAV tempo", …)`: renders a bar of each sound at 48000 and writes and reads back a WAV with an `acid` chunk; ASCII, lower case, as the others.

- [ ] **Step 1: Write the failing sections**: `tests/test_engine.py` `[83] The metronome through the Api` (with the click on the recording card one duplex stream, elsewhere two; switch off: none, the take keeps tempo 128 and `click` False; `metronome_state()` goes `count` (1–4) then `take`, `since_count_in_ms` near 0 at the count-in's end; `metronome_set_on(False)` mid-take keeps `click` True; the first kept click take of a song without a tempo gives it 128 · 4/4, a discarded false start does not; a held change survives a keystroke in the same song's name and goes on another song; the free click stops before the recorder opens; `click_unavailable`; `metronome_state` in `POLLABLE`; `player_set_click(True)` holds for the next `_player_open` and is off in a fresh `Api`), `[84] The grid after a crop` (the Task 1 cases through `crop_take` and `crop_draft`, WAVs keeping `acid` only when they had one, the `.mid` cut the same, still a click take, the cloud's mix and WAV copy carry the chunk, rename and merge keep tempos), `[85] Counting and tapping through the Api` (`count_tempo` on a take folder, a missing file's error, `set_song_tempo` refusals, `metronome_tap_listen` outside a rehearsal takes the band's port and gives it back after the quiet); `tests/test_transport.py` (Review Focus 6: `control_command("start")` and the controller's `record_stop` start the same click take with the row's held tempo; `_stop_keep` keeps tempo and click; `elapsed` is 0 at the count-in's end); `tests/test_platform.py` (the selftest prints the new check).
- [ ] **Step 2: Run** `test_engine`, `test_transport` and `test_platform` once each → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three once → pass; `python -m rehearsal_recorder --selftest` once (after `cd ui && npm run build`).
- [ ] **Step 5: Commit** — `Metronome: Record clicks from the screen, the keys and the controller, and takes keep their tempo`.

### Task 8: Settings › Metronome, a song's page, and Master (wave 3, interface; needs Task 6)

**Files:**
- Create: `ui/src/components/MetronomeSettings.tsx`, `ui/src/components/metronome/SongTempoRow.tsx`, `MasterClick.tsx`, `MasterClickLane.tsx` (with stories)
- Modify: `ui/src/screens/Settings.tsx` (`TABS:35-86`, `TabId:23`, the body switch `:203-212`, the comment `:139`; the tab after Audio with lucide's `Metronome` icon), `ui/src/components/SongPage.tsx` (the row in `PaneHead`'s `lines` `:204-223`), `ui/src/components/LaneControls.tsx` (`MasterControls:247-289`: the button after "Master" as the 20 px `lane` toggle, so the plate keeps 56 px; `ListeningVolume` renders it too), `ui/src/components/Timeline.tsx` (the Master band `:642-656`: plate and lane in one group, the lane on a well on `COLUMNS`/`COLUMN_GAP_PX`), `ui/src/components/TakePlayer.tsx` (its props carry the take's click), `ui/src/screens/Rehearsal.tsx:601`, `screens/Review.tsx:394`, `screens/HistoryScreen.tsx:1094`, `ui/src/lib/deletion.ts` (`croppedText:64`: where a click take now starts, once for every crop), `ui/e2e/band.js` (the band's takes on the grid from sample 0: the song starts on the count-in's end, `START` at `band.js:13`), `ui/e2e/band.spec.ts`, `docs/design-system.md` (the new pieces)
- Test: `ui/e2e/metronome.spec.ts`, `ui/e2e/settings.spec.ts:40`, `ui/e2e/keys.spec.ts:255`, `ui/e2e/band.spec.ts`

**Interfaces:**
- The tab "Metronome", blurb "Where the click is heard, its sound, and the count-in": `ClickSettings` in `SettingsGroup`s with `DevicePicker` and `OutputChannels` as `AudioSettings.tsx:261-351`, then **Write the tempo into WAV files** (`Checkbox` + `Label`) with its hint, then "The same settings are behind the gear in the metronome row, on the rehearsal screen."; errors through `notify`/`useNoticesGoWithPage`.
- `SongTempoRow({ song, takes })` (saved at once through `set_song_tempo`; "count it from a take" in a `DropdownMenu`, starred takes first, then newest; halve and double after counting; the count kept while the page is open; Tap and T open the band's ports through `metronome_tap_listen`; its ▶ unlike the head's 48 px `PlayButton`, C2).
- `MasterClick({ take })` (icon only, `aria-pressed`, `Tooltip` per the copy, disabled without a click); `MasterClickLane({ from, to, position, take })` (`clickLines(tempo, signature, from, to)`: bars only past 120 clicks in view, every fourth bar past 480; dimmed to 50 % while off; the playhead; the corner tag with `NoteGlyph` in 6/8).

- [ ] **Step 1: Write the failing tests**: `the tab and the gear show the same settings`; `picking a sound plays a bar`; `the WAV checkbox is on by default and saves`; `a second ASIO card is not offered for the click`; `song page counts a tempo and halves it`; `song page tempo saves at once`; `master click plays with the take`; `master stripes follow zoom`; `a take without the click`; `a cropped click take says where it starts`; `master lane lines up with the tracks at 960`; `the master plate keeps its height`; `stripes sit on the demo band's beats` (first beat's stripe within 2 px of the waveform's first onset at full zoom); the tab lists in `settings.spec.ts` and `keys.spec.ts`; `band.spec.ts` with the band on the grid.
- [ ] **Step 2: Run** `cd ui && npm run build && npm run test:e2e -- e2e/metronome.spec.ts` once → fail.
- [ ] **Step 3: Implement**, as Q10 A and Q11 D in the design system's pieces.
- [ ] **Step 4: Run** the metronome, settings, keys and band specs, `npm run design-check` and `npm run build-storybook`, each once → pass.
- [ ] **Step 5: Commit** — `Metronome: its settings, a song's tempo in History, and the click on Master`.

### Task 9: Docs, reha.stream, the alignment tool, review and the PR (wave 4)

**Files:**
- Modify: `docs/using-it.md` (a section "The metronome" before "## Keyboard" `:861`; the 120 bpm lines under "### In a DAW" `:829-834`; the count-in under "## A controller" `:915-941`; T under "## Keyboard"), `CHANGELOG.md` (a new "## Unreleased" above 0.12.0, each item starting bold, button names bold), `tests/docs_screenshots.py` (`HEIGHT:143-147` gains `metronome-row`, `metronome-master`; re-check the recording shot's wait after Record with the count-in), `docs/screenshots/` (the two new pictures, and every existing one the metronome changes: rehearsal, recording, review, player, zoom, midi-player, settings, history-songs; `README.md:13` uses player.png); `site/content/story.md:21-22` (step 2's two lines), `site/content/faq.md` (after `:18-21`), `site/content/features.md` (the tile before `{#formats}` at `:45`), `site/src/content/index.ts` (`TILES:39-50`: "metronome" between "sets" and "formats"), `site/src/page/Features.tsx` (`LAYOUT:9-23`, trash from `s4` to `s6`), `site/src/page/pieces.tsx` (`shots()` `:150-156` gains the metronome piece: the props-driven, inert row from `components/metronome/`), `site/src/stage/Story.tsx` (step 2's frames, `beat(1):178`, `beat(2):199`), the site's tests (`index.test.ts:13-26, 69-77, 102-111`, `page.spec.ts:364-386, 507`, `stage.spec.ts:126-153`)
- Create: `tools/click_alignment.py` (reusing `tools/midi_alignment.py`'s onset rule, windows, signed median and worst, exit codes and ASCII output), its section in `tests/test_click.py` (loading the tool as `test_midi.py:3074, 3120` does) and mentions where `run_all.py:80` and `tests/README.md:163` name `midi_alignment`

- [ ] **Step 1: The docs** with everything the spec's Docs part lists, the DAW paragraph from Part 9, the 6/8 note (a DAW shows half the number), what the controller's **Record/Stop** does with the count-in, and terms explained the first time (click, count-in, bpm, time signature, Master); checked with the humanizer skill; CLAUDE.md "Writing"; "**Settings → Metronome**" in the guide and CHANGELOG, "Settings › Metronome" on the site.
- [ ] **Step 2: Shoot**: `cd ui && npm run build`, then `python tests/docs_screenshots.py` once; look at every picture it wrote.
- [ ] **Step 3: reha.stream**: the failing site tests first (`metronome on the site`: the FAQ question with "its WAV and .mid files carry it"; the tile "A click for the drummer." with the row; step 2's "and its 128 bpm for the click."; every features row full at 1000, 1280 and 1440, MIDI's and the sets' tiles in), then as `q12/src/patch_site.py` variant C (its `VITE_MK_SITE` hooks do not carry over); `npm ci --prefix ui`, then `cd site && npm test && npm run build && npm run og && npm run test:e2e` once; look at 1280 and 390.
- [ ] **Step 4: `tools/click_alignment.py`** and `[8] The alignment tool` in `tests/test_click.py` (clicks 2 ms late on a 120 grid print a median of 2 ms).
- [ ] **Step 5: Whole-branch review** on the most capable model, against the spec and this plan; fix every finding, minors included, each with a failing test first, running only the tests each fix touches.
- [ ] **Step 6: Push once and open the PR** with `.github/pull_request_template.md` (What this changes / How it was checked / Anything not covered); subscribe to its activity; CI runs every suite; drive it green. The hand checks below go under "Anything not covered" until done.
- [ ] **Step 7: The hand checks**, with the app built by the Release workflow's manual run "Rehearse the builds" on this branch (artifacts RehearsalRecorder-macos and RehearsalRecorder-windows), by whoever has the devices:
  - macOS and Windows (ASIO): the click's output cabled into an input; a 1-minute and a 60-minute take; `python tools/click_alignment.py "<take folder>"` within 5 ms on the recording card and 10 ms on another device, at the start and the end;
  - Reaper (Linux build, in the container) opening a click take's WAVs: the tempo read, nothing stretched at the song's tempo; Cubase, Pro Tools or Studio One if someone has one; the `.mid` beside them on the same bars;
  - the counter on the band's own click takes;
  - the edge light at 600 a minute against WCAG 2.3.1's general flash threshold.
  A driver whose reported latency misses the aim goes to Alex with the numbers; no latency setting without his word.
- [ ] **Step 8: Screenshots to Alex and his word before merging.** After the merge: memory, rulings and this thread updated.
