# A Backing Track for Songs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A song keeps one audio file; the app counts its tempo and finds bar 1, plays it through its own output from Record (on bar 1 after the count-in, or from the file's start with no click), keeps it in the take as a track "Backing" drawn dashed above Master and muted per song, and the song page, History, Settings, the guide and reha.stream say so.

**Architecture:** Python owns the file and the sound. `audio/backing_file.py` copies, checks, decodes and resamples (libsndfile + soxr) into a float WAV at the app's rate, read through a memory map; `audio/backing_count.py` counts it with the metronome's counter and drift's beat tracker. `audio/backing_source.py` renders the file into any stream block by block, as `ClickSource` does the click, with a clock follow on another device. A take's click (`audio/take_click.py`) carries the backing track as a second layer and gains a mode with no clicks, so both share the take's first frame, the duplex stream and the other-device streams; `capture.py` writes `Backing.wav` at Stop. `backing.py` holds the settings, the row's state and the play between takes, as `metronome.py` does for the click; `api.py` only delegates. The store gets five song columns and a third `take_file.kind`. The interface gets a row under the metronome's, a section on the song page, New song, a group in the click's settings and a dashed lane.

**Tech Stack:** Python 3.12, numpy, sounddevice/PortAudio, soundfile (libsndfile 1.2.2), soxr 1.1 (new), SQLAlchemy + Alembic on SQLite; React 19 + TypeScript + Tailwind in `ui/`, Vitest and Playwright on the fake bridge, Storybook; the Vite site in `site/`.

**Spec:** `docs/superpowers/specs/2026-10-11-backing-track-design.md` (B1–B9, Words, Parts 1–9, Testing, Docs, On reha.stream, "Since it was ok'd", New in this spec 1–19). Read it whole before the first task. Built on main `79c7993` (the metronome #65, tempo drift #66, the four-step site #68); line numbers below are from that commit.

**Calls made here, not in the spec:**
1. `add_backing` counts as it adds, and Replace is `add_backing` on a song that has one, so the spec's `count_backing` is not needed.
2. The ready file is read through a float memory map of its own (`open_ready`); `audio/tempo.py`'s block mixer learns float. `Backing.wav` in a take has the take's bit depth, so the player, crop, the mix and the cloud read it as any track.
3. `TakeClick` carries the backing track and, for a take with no click, runs with `clicks=False`: no clicks, no count-in, Stop not snapped, files starting at the first frame heard. One first-frame choice serves both.
4. A file of more than two channels says "This file has 6 channels. Use a mono or stereo file." (the number is the file's).
5. The ready file sits beside the copy as "<copy's name> (ready 48 kHz).wav".
6. Record pressed while the ready file is still being made records without the backing track; the status line says "Getting the backing track ready…" until it is.

## How the work runs

Eight tasks in four waves. Tasks in one wave run at once, each in its own git worktree on a branch off `claude/project-thread-q4tpvv`, each reviewed (spec, then code quality) before it is merged back. A wave starts when the tasks it consumes are merged.

| Wave | Python | Interface |
|---|---|---|
| 1 | Task 1 (store) · Task 2 (the file, counting) | Task 3 (bridge, `lib/backing.ts`, fake) |
| 2 | Task 4 (playing it in a take and between takes) | Task 5 (song page, New song, History, Next take) |
| 3 | Task 6 (`backing.py`, Api, the counters) | Task 7 (rehearsal row, recording row, Settings, the lane) |
| 4 | Task 8 (docs, site, review, PR) | |

**Tests while building:** only the tests a change touches, each once: one Python suite (`python tests/test_backing.py`), one Vitest file, one Playwright spec. No repeats, no unrelated suites. The full suites run once, on CI. Every subagent brief says so.

## Global Constraints

- Test labels and Playwright titles in cp1252 only ("Palyn", "Backing (2)"); no ł, ▶, ★, arrows. Test data may say "Pałyn".
- Readable files: `.wav .aif .aiff .flac .mp3 .ogg`, mono or stereo. Messages exactly: "This file can't be read. Use WAV, AIFF, FLAC, MP3 or OGG; most players can export one." and "This file has N channels. Use a mono or stereo file."
- The copy: folder "Backing tracks" in the recordings folder (beside `store/db.py` `database_path`), byte for byte, " (2)" on a name in use (`api.py:252` `_unique_path`, moved to a shared helper). The ready file beside it: "<copy's name> (ready 48 kHz).wav" ("44.1 kHz", "96 kHz"), 32-bit float, at the recording settings' rate, soxr `quality="VHQ"`. Replace and Remove send the copy and every ready file of it to the Trash (`platform_support` send2trash).
- Song columns (migration 0009, `ALTER TABLE ... ADD COLUMN` as 0008): `backing_file` VARCHAR NULL (relative to the recordings folder), `backing_name` VARCHAR NULL, `backing_first_bar` FLOAT NULL (seconds, hundredths), `backing_tempo` INTEGER NULL (the song's own count), `backing_heard` BOOLEAN NOT NULL DEFAULT 0. `take_file.kind` gains `"backing"` (`BACKING_FILE` beside `AUDIO_FILE`, `NOTES_FILE`); what opens audio keeps `kind != NOTES_FILE`.
- A take's track dicts (`_take_data` "tracks") are `{"name", "file"}` as now, plus `"kind": "backing"` on the Backing track only; the take adds `"backing_heard": bool` (its song's).
- `take.json` gains `"backing": {"file": ready path, "from_frame": int, "name": str}`; `from_frame` is the ready file's frame at the take's frame 0 and may be negative (silence first).
- Settings in `config.json` through `Api._config`: `backing_device` (identity through `_remember_device`) and `backing_channels` (none: where the player plays), `backing_volume` 0.8, `backing_on` true, `backing_row` false (set true when any song first gets a backing track).
- Counting: `tempo.middle_tempo` on the ready file's envelope at `TRACK_HOP` in the song's signature (4/4 with none), clamped with `click.clamp_tempo`; beats from `tempo.track` and `tempo.snap`; no steady beat when fewer than half the beats found a hit or no tempo comes out. Bar 1: of the `per_bar` phases, the one whose beats' envelope is highest on average; its first beat, to a hundredth.
- When it comes in (spec Part 3): click take → file frame `round(first_bar * rate) - count_in_frames + take_frame`; no click → `take_frame`; free take, no backing track, or `backing_on` false → not played, not recorded. It plays to Stop; past the file it is silent; at Stop a 20 ms linear fade. Another device: playback rate follows the recording's clock, the ratio kept within ±0.001.
- Streams: the recording card's take stream carries it in its outputs (with the click when both are there); another device gets one output stream for whatever goes there (the click and the backing track share one when they share a device); between takes, its own output or the player's stream when the player holds its device. Never a second stream on a device the app holds; a second ASIO card is refused as the click's is (`metronome.py` `ANOTHER_ASIO`).
- Channels: stereo to the two outputs picked; mono to both of a pair; one output plays stereo as mono. Volume changes what is heard only.
- `Backing.wav`: the take's rate and bit depth, the file's channels, the take's length, placed as heard; name "Backing", "Backing (2)" when a band track has that name; icon `"backing"` (`ui/src/lib/instruments.ts:53`).
- The interface follows `docs/design-system.md` as the metronome's plan has it (Button, Input, Popover, Tooltip, Kbd, Toggle; tokens only; five text sizes, weights 400 and 600, `tnum` figures; amber is `--warn` on the icon; no layout jumps; nothing cut at 960 px; both themes). `npm run design-check` passes with `ui/design-check.allow.json` still `{}`. Sentences used twice and every figure come from `lib/format.ts` or `lib/backing.ts`.
- Copy exactly as the spec: Part 5's status sentences and row lines, Part 6's song page lines, New song's, Part 7's plate, Part 8's tab label "Click & backing track", popover title "Click and backing track", their lines, and "On reha.stream". Plus "Getting the backing track ready…" (call 6). The word is take, never "go".
- Python suites are plain scripts with `ok(label, cond)` sections; new sections take the next free number: `tests/test_engine.py` from `[86]`, `tests/test_store.py` from `[19]`. New suite `tests/test_backing.py` goes in `tests/run_all.py` `SUITES` ("Fifteen" becomes "Sixteen" in `run_all.py:6` and `tests/README.md`).
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` only; the PR body ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)" only.
- No merge without Alex's word. Before asking, a picture of the new site item, no app screenshots.

## Shared places (tempo drift and the metronome)

This changes, on main: Settings › Metronome (renamed "Click & backing track", a group after The click, its line and last line), the metronome row's gear (its title, a group, its last line), the metronome row (a row under it, the status line under both), Master's neighbour in the player (a dashed lane above it; Master's plate, button and drift line unchanged), `Api.count_tempo` and `Api.take_drift` (leave the Backing track out by its kind), and the site's step "Before you play." and the FAQ (a question after drift's).

## Review Focus

1. **The backing track's output unplugged mid-take.** Expected: the take records on with its click; `Backing.wav` is still written as placed (it is the file, not what was heard); the amber line shows once the screen polls; no error bar, and `recording_health` does not report it. Task 4.
2. **A short file or a late bar 1**: a 3-second loop, a file shorter than the count-in, bar 1 dragged past the file's end. Expected: silence where the file has ended, the take's length kept; the drawn start runs to bar 1 + 4 bars anyway; the field refuses nothing in the file's length and clamps past it. Tasks 2, 4, 5.
3. **The recording rate changed, or the ready file deleted by hand.** Expected: made again on the next pick or `backing_play`, with "Getting the backing track ready…" meanwhile; Record during that records without it. Task 6.
4. **The copy deleted from "Backing tracks" by hand.** Expected: the song page says "Pałyn backing.wav is missing from the Backing tracks folder." with Replace… and Remove; the row says the same; Record records without it; nothing raises. Tasks 5, 6, 7.
5. **Replace or Remove while ▶ plays it, or while a take records.** Expected: ▶ stops first; during a take the menu items are disabled ("Takes already recorded keep the backing track they were played with." stays true); the running take keeps the ready file it opened (the Trash move waits until the take ends). Task 6.

---

### Task 1: The store keeps a song's backing track (wave 1, Python)

**Files:**
- Create: `src/rehearsal_recorder/store/migrations/versions/0009_backing.py`
- Modify: `store/models.py` (`Song:58`, `BACKING_FILE`), `store/library.py` (`_take_data:232`, `_files:325`, `songs:742`, `goes_of:786`, `merge_songs:656`, `rename_song:620`, `add_take:1052`, new methods)
- Test: `tests/test_store.py`

**Interfaces:**
- Produces on `Library`: `add_song(title) -> {"ok": True, "id"} | {"ok": False, "error": "Pałyn is already a song."}` (a title or an old name in use, case-blind as `_taken`), `last_go` 0; `song_backing(song_id) -> {"file": Path, "name", "first_bar", "tempo", "heard"} | None`; `set_song_backing(song_id, file: Path, name, first_bar, tempo) -> Path | None` (returns the old copy to send to the Trash); `clear_song_backing(song_id) -> Path | None`; `set_backing_first_bar(song_id, seconds)`; `set_backing_tempo(song_id, tempo)`; `set_backing_heard(song_id, heard)`; `songs()` items gain `"backing": {"name", "first_bar", "tempo"} | None` and `"goes": 0` rows for songs with `last_go` 0 or a backing track and no takes; `goes_of(song_id)` gains the same `"backing"` and works for a song with no takes (empty goes); `song_titles_without_takes() -> list[str]` for the Next take list; `merge_songs` keeps the target's backing track or takes the merged song's, and its result gains `"trash": [Path]`; a take dict passed to `add_take` with `"backing": {"name", "file"}` stores a `BACKING_FILE` row after the audio rows.

- [ ] **Step 1: Write `[19] A song's backing track`** in `tests/test_store.py`: migration on an existing library leaves every song with none and `backing_heard` false; `take_file` kind "backing" comes back in "tracks" with `"kind": "backing"` and never in "notes"; `add_song("Palyn")` refused when "Pałyn" or an old name of it exists, with the message; a new song listed by `songs()` with `goes` 0, and by `song_titles_without_takes()`; a song whose takes were all deleted hidden unless it has a backing track; `set_song_backing` returns the old copy; merge keeps the target's, takes the merged one's when the target has none, and returns the other copy in `"trash"`; rename keeps it; `backing_heard` survives reopening the library.
- [ ] **Step 2: Run** `python tests/test_store.py` once → fails.
- [ ] **Step 3: Implement.** `songs()` becomes an outer join from `Song` so songs with no takes appear; the not-named row is unchanged.
- [ ] **Step 4: Run** it once → passes; `python tests/test_engine.py` once (the take files).
- [ ] **Step 5: Commit** — `Backing track: a song keeps one, and a take keeps its Backing track`.

### Task 2: The file, made ready and counted (wave 1, Python)

**Files:**
- Create: `src/rehearsal_recorder/audio/backing_file.py`, `audio/backing_count.py`, `tests/test_backing.py` (in `run_all.py` and `tests/README.md`)
- Modify: `audio/tempo.py` (`_mix:150` float branch; `_audio_envelope:171` split into `_envelope(opened, hop, stop)` that it calls), `api.py` (`_unique_path` moves to `platform_support.unique_path`, imported back), `requirements.txt` (soxr, with a comment as soundfile's), `packaging/rehearsal-recorder.spec` (soxr collected), `app.py` selftest (imports soxr and resamples a second)
- Test: `tests/test_backing.py`

**Interfaces:**
- `backing_file.py`: `class BackingError(Exception)` (its text is the message to show); `probe(path) -> (seconds: float, channels: int)`; `import_copy(src: Path, folder: Path) -> Path`; `ready_path(copy: Path, rate: int) -> Path`; `make_ready(copy, rate) -> Path` (no-op when it exists and is newer than the copy); `open_ready(path) -> (memmap float32 (frames, channels), frames, rate, 4, channels)`, the same tuple shape as `player._open_track`; `peaks(path, end_sec, buckets) -> list[list[float]]` (per channel, as `take_media` gives); `take_frames(opened, from_frame, length) -> np.ndarray` float32 (zeros outside the file); `write_take_track(opened, from_frame, length, path, samplerate, sampwidth) -> None` through `audio/wavfile.WavWriter`.
- `backing_count.py`: `count(ready: Path, signature: str | None) -> {"tempo": int | None, "first_bar": float}`.

- [ ] **Step 1: Write the failing sections** in `tests/test_backing.py`:
  - `[1] Reading the file`: WAV 16/24/float, AIFF, FLAC, MP3, OGG made with soundfile all probe; M4A bytes and a text file raise the first message; a 6-channel WAV raises "This file has 6 channels. Use a mono or stereo file."; `import_copy` twice gives "Palyn backing (2).wav", byte-identical.
  - `[2] Ready to play`: 44.1→48 kHz and 96→48 kHz: a 1 kHz sine's frequency within 0.1 Hz and level within 0.05 dB, aliasing of a 30 kHz tone under −90 dB; 48→48 copies samples exactly; an MP3 decodes to the same frames twice; `make_ready` again after the copy changes; `open_ready` frames equal soundfile's read.
  - `[3] Counting`: synthetic files (reuse `test_tempo`'s `hit` and `write_wav`) at 4/4 128 with a 0.80 s lead-in, 3/4 96, 6/8 198 with a pickup beat, a ballad 72: tempo within 1, `first_bar` within 0.02 s (the pickup case on the bar, not the pickup); pads (sustained chords, no hits) give `tempo` None and `first_bar` 0.0; no signature counts 4/4.
  - `[4] The take's track`: `take_frames` with `from_frame` −4800 starts with 4800 zeros; past the end zeros; `write_take_track` at 24-bit stereo reads back within one LSB of the float.
- [ ] **Step 2: Run** `python tests/test_backing.py` once → fails.
- [ ] **Step 3: Implement.** Decode with `soundfile.read(dtype="float32", always_2d=True)`; resample with `soxr.resample(x, rate_in, rate, quality="VHQ")`; write with `soundfile.write(subtype="FLOAT")`. `open_ready` reads frames and channels with `soundfile.info` and maps the data chunk from the file's end, as `_open_track` does. Without soundfile, only 16- and 24-bit WAV at the app's rate are accepted (the first message otherwise).
- [ ] **Step 4: Run** it once → passes; `python tests/test_tempo.py` and `python tests/test_drift.py` once each (the split envelope).
- [ ] **Step 5: Commit** — `Backing track: the file copied, made ready at the app's rate and counted`.

### Task 3: The interface's side of the bridge (wave 1, interface)

**Files:**
- Create: `ui/src/lib/backing.ts`, `ui/src/lib/backing.test.ts`
- Modify: `ui/src/lib/api.ts` (types and methods below), `ui/e2e/fake-bridge.js` (the calls, a fake ready file's peaks, settings defaults), `ui/e2e/band.js` (Pałyn: counted 128, bar 1 0.80, stereo 3:42; Sonca: pads, no tempo counted, bar 1 0.00, song tempo 96 typed; Viasna: counted 126, song 128; Dym none; a song "Hlyboka" with no takes; Viasna 1 and the story's Pałyn 3 with a Backing track)

**Interfaces:**
- `api.ts`: `type SongBacking = {name: string; seconds: number; channels: 1 | 2; tempo: number | null; first_bar: number; missing: boolean}`; `SongSummary.backing: SongBacking | null`; `SongPage.backing` the same; `Track.kind?: "backing"`; `Take.backing_heard?: boolean`; `type BackingState = {song: (SongBacking & {song_id: number; title: string}) | null; on: boolean; volume: number; row: boolean; playing: boolean; position_sec: number; output_missing: string | null; getting_ready: boolean; free: boolean}`; `MetronomeState.backing: BackingState`; `Settings` gains `backing_device_index`, `backing_channels`, `backing_volume`, `backing_on`; methods `add_backing(song_id)`, `remove_backing(song_id)`, `set_backing_first_bar(song_id, seconds)`, `set_backing_tempo(song_id, tempo, to_song: boolean)`, `set_song_backing_heard(song_id, heard)`, `add_song(title)`, `song_backing_peaks(song_id, end_sec, buckets)`, `backing_play(song_id: number | null, with_click: boolean)`, `backing_stop()`, `backing_preview()`, `set_backing_device(index)`, `set_backing_channels(channels)`, `set_backing_setting(key: "backing_volume" | "backing_on", value)`.
- `backing.ts`: `rowSentence(state: MetronomeState) -> {text: string; amber: boolean} | null` (Part 5's five sentences, "Getting the backing track ready…", the missing-file line, null when no row); `rowLine(state)` (the row's own line for no backing track and a free take); `pageLine(song: {tempo, signature}, backing: SongBacking | null, counting: string | null) -> {text: string; links: ("earlier" | "later" | "halve" | "double" | "take")[]}` (Part 6's lines, chosen from what is stored); `stepBarOne(seconds, delta, length) -> number` (hundredths, clamped to 0..length); `parseBarOne(text) -> number | null` ("0:00.80", "0.8", "12.345" → hundredths); `beatShift(first_bar, tempo, signature, by: 1 | -1) -> number`; `drawnRange(first_bar, tempo, signature, length) -> {end: number}` (bar 1 + 4 bars, at least 8 s); `barLines(first_bar, tempo, signature, end) -> {at: number; bar: number | null}[]`.

- [ ] **Step 1: Write the failing tests** in `backing.test.ts`: every sentence of Part 5 for its case (click take, no click, off, a held tempo 132 against a counted 128, output missing "X18 5–6"), a song without one, a free take; every line of Part 6 for its case with its links; `parseBarOne` on "0:00.80", "0.8", "", "abc", "-1"; `stepBarOne` by 0.01 and 0.1, clamped; `beatShift` in 4/4 at 128 (0.47) and 6/8 at 198; `drawnRange` 8 s floor; `barLines` numbers bars from 1.
- [ ] **Step 2: Run** `cd ui && npx vitest run src/lib/backing.test.ts` once → fails.
- [ ] **Step 3: Implement**, the fake's calls answering as Python will (Task 6's Interfaces).
- [ ] **Step 4: Run** it once → passes; `npx tsc -b` clean.
- [ ] **Step 5: Commit** — `Backing track: the bridge, its sentences and the fake band's files`.

### Task 4: Playing it, in a take and between takes (wave 2, Python; needs Task 2)

**Files:**
- Create: `src/rehearsal_recorder/audio/backing_source.py`
- Modify: `audio/take_click.py` (`TakeClick:93`), `audio/click_output.py` (`ClickOutput.start` takes a source or `Sources`), `audio/capture.py` (the duplex outputs `:372-400`, Stop, `take.json`), `audio/drafts.py` (recovery writes `Backing.wav`), `audio/player.py` (a free `BackingSource` beside `_free_click`, `:516`)
- Test: `tests/test_backing.py`, `tests/test_engine.py`

**Interfaces:**
- Consumes: `backing_file.open_ready`, `take_frames`, `write_take_track`.
- `backing_source.py`: `class BackingSource(opened, route, volume, place=None, follow=None)` with `render(out, first_frame, arrival_ns, lead_sec)` (the `ClickSource.render` contract: adds, never raises, keeps `fault`), `set_on(on)`, `set_volume(v)`, `fade_out()` (20 ms, then silent), `position_sec`, `done`; `place(output_frame) -> float | None` maps a stream frame to a file frame (None: silent); `follow` is `(AudioClock, OutputClock)` for another device. `class Sources(*sources)` renders each in turn and has the same contract.
- `TakeClick(..., clicks=True, backing=None)`: `backing` is a `TakeBacking(opened, from_frame, route | output, volume, on)`, defined in `take_click.py`; `TakeBacking.problem()`; `TakeClick.backing_record() -> {"file", "from_frame", "name"} | None` once the first frame is chosen. With `clicks=False` it renders no clicks, has no count-in, its `stop_frame` is the frame Stop came at, and `acid`/`meter` are None.
- `AudioRecorder.stop()` result gains `"backing": {"name", "file"} | None`; `take.json` has `"backing"` from Record on.

- [ ] **Step 1: Write the failing sections** in `tests/test_backing.py`:
  - `[5] Placing it`: bar 1 lands on the first click after a one- and a two-bar count-in (frame-exact in a duplex block run); a 3.2 s lead-in with a one-bar count-in at 120 skips 1.2 s; count-in None starts at bar 1 with the first click; `clicks=False` starts the file at the take's frame 0 and the files start where it is first heard.
  - `[6] The streams`: duplex blocks carry click and backing on their own routes; mono to `(2, 3)` on both; stereo to one output averaged; a `Sources` of click and backing on one `ClickOutput`; a free `BackingSource` in the player's stream; a second ASIO card refused with the click's words.
  - `[7] Another device`: output clock −150 ppm, recording +200 ppm, an hour: the file frame heard at the hour is within 10 ms (480 frames) of where `Backing.wav` has it; the ratio never past ±0.001.
  - `[8] The take's Backing track`: `Backing.wav` sample-exact to `take_frames` at the take's depth, the take's length, silent past the file; the same with `set_on(False)` and a volume change mid-take; "Backing (2)" with a band track "Backing"; a recovered draft gets the same file from `take.json`; no track when the output was missing at Record; the output vanishing mid-take still writes it (Review Focus 1); a 20 ms fade at Stop in what is heard, not in the file.
- [ ] **Step 2: Add `[86] A take's Backing track in the mix and crop`** to `tests/test_engine.py`: `mixdown` by its fader, muted or not; `crop_wav` cuts it with the others.
- [ ] **Step 3: Run** `python tests/test_backing.py` and `python tests/test_engine.py` once each → fail.
- [ ] **Step 4: Implement.** Clock follow: each block, the ratio is the recording clock's rate over the output clock's (both fitted lines), clamped, and the file is read with linear interpolation at that step; the duplex and own-device cases read at exactly 1.0. The first frame waits for every output a take has, as `on_input` waits for the click's.
- [ ] **Step 5: Run** both once → pass; `python tests/test_click.py` once.
- [ ] **Step 6: Commit** — `Backing track: played in the take's streams and kept as its Backing track`.

### Task 5: A song's page, New song, History and Next take (wave 2, interface; needs Task 3)

**Files:**
- Create: `ui/src/components/backing/SongBacking.tsx` (+ story), `backing/FileStart.tsx` (+ story), `backing/BarOneField.tsx` (+ story), `backing/NewSongDialog.tsx`, `ui/e2e/backing-song.spec.ts`
- Modify: `components/SongPage.tsx` (the section under `SongTempoRow`; "No takes yet" with no go ladder), `components/SongList.tsx` and `screens/HistoryScreen.tsx` (New song over the list; "No takes yet" rows), `components/NextTakeSongs.tsx` (songs with no takes offered), `docs/design-system.md` (the new shared pieces)

**Interfaces:**
- Consumes: Task 3's `api.ts` and `backing.ts`.
- `SongBacking({song, onChanged})`; `FileStart({peaks, length, firstBar, tempo, signature, end, playhead, onFirstBar})` (SVG waveform, bar and beat lines numbered from bar 1, a draggable marker with ← → and Shift; the scale fixed while mounted); `BarOneField({value, length, onChange})`.

- [ ] **Step 1: Write the failing e2e** in `backing-song.spec.ts`: adding to Dym (counting line, then "Counted 104 bpm, now the song's tempo…", halve and double); Pałyn (as the song, one beat earlier and later move bar 1 by 0.47); Viasna (126, the song stays at 128, take the backing track's tempo); Sonca (no steady beat); drag bar 1 and type it; ▶ shows the playhead; Replace… and Remove with their line; a missing copy's line; New song refusing "palyn"; "No takes yet" in the list and on the page; picked under Next take; nothing cut or moving at 960 px; dark theme.
- [ ] **Step 2: Run** `cd ui && npm run build && npx playwright test e2e/backing-song.spec.ts` once → fails.
- [ ] **Step 3: Implement.** Every change saves at once, as the tempo row's do.
- [ ] **Step 4: Run** it once → passes; `npm run lint`, `npm run design-check`, `npx tsc -b` clean.
- [ ] **Step 5: Commit** — `Backing track: a song's page, New song and songs with no takes`.

### Task 6: `backing.py`, the Api and the counters (wave 3, Python; needs Tasks 1, 2, 4)

**Files:**
- Create: `src/rehearsal_recorder/backing.py`
- Modify: `api.py` (the calls below; `get_settings:1126`; `metronome_state:4843` adds `"backing"`; `start_take:2606` and `stop_take:2738`; `count_tempo:4866` and `take_drift` leave out `kind == "backing"`; `take_media:1559` gives it the "backing" icon; `merge_songs:3681` trashes the left-over copy; `song_choices:2390` offers songs with no takes under "other"; `list_output_devices` items gain `backing_unavailable`), `metronome.py` (`take_click:459` takes the backing track and makes `clicks=False` takes; its device rules shared with `backing.py`)
- Test: `tests/test_backing.py`, `tests/test_engine.py`

**Interfaces:**
- Consumes: Tasks 1, 2, 4.
- `backing.py`: `class Backing(config, write_config, library, player_getter, device_lookup, recordings_dir)` with `settings()`, `set_setting(key, value)`, `state(next_song_id, phase) -> BackingState` (Task 3's shape), `take_backing(song_id, device_index, samplerate, count_in_frames | None) -> TakeBacking | None`, `play(song_id, with_click)`, `stop()`, `preview()` (2 s), `ready_for(song_id)` (made on a thread when the next take's song changes), `close()`.
- `Api`: `add_backing(song_id)` (picker, copy, ready, count; sets the song's tempo when it had none; `backing_row` true) → `{ok, name, seconds, channels, tempo, first_bar}` or `{ok: False, error}` / `{ok: False, cancelled: True}`; `remove_backing(song_id)`; `set_backing_first_bar(song_id, seconds)`; `set_backing_tempo(song_id, tempo, to_song)`; `set_song_backing_heard(song_id, heard)`; `add_song(title)`; `song_backing_peaks(song_id, end_sec, buckets)`; `backing_play(song_id, with_click)`, `backing_stop()`, `backing_preview()`; `set_backing_device(index)`, `set_backing_channels(channels)`, `set_backing_setting(key, value)`.

- [ ] **Step 1: Write the failing sections** in `tests/test_backing.py` `[9] Through the Api` (sounddevice stubbed): `add_backing` with the picker stubbed fills the song and its tempo, refuses a 6-channel file with its message, Replace trashes the old copy and ready files; a click take starts it on bar 1, a take with the switch off or no tempo from the file's start, a free take and `backing_on` false not at all; `metronome_state()["backing"]` for each case incl. `getting_ready` and `output_missing`; `count_tempo` and `take_drift` on a take with a steady Backing track and a band at 120 count 120; Replace during a take disabled and the running take unharmed (Review Focus 5); the copy deleted by hand (Review Focus 4); the rate changed (Review Focus 3); `set_song_backing_heard` across a restart; `song_choices` offers "Hlyboka", a song with no takes; a take sent to the cloud with its tracks carries `Backing.wav`.
- [ ] **Step 2: Run** `python tests/test_backing.py` once → fails.
- [ ] **Step 3: Implement**, `api.py` delegating to `Backing` as it does to `Metronome`.
- [ ] **Step 4: Run** it once → passes; `python tests/test_engine.py` and `python tests/test_drift.py` once each.
- [ ] **Step 5: Commit** — `Backing track: settings, the row's state and Record, through the Api`.

### Task 7: The rehearsal row, the recording row, Settings and the lane (wave 3, interface; needs Task 3)

**Files:**
- Create: `ui/src/components/backing/BackingRow.tsx` (+ story), `backing/BackingTakeRow.tsx` (+ story), `backing/BackingSettings.tsx` (+ story), `ui/e2e/backing.spec.ts`
- Modify: `components/metronome/MetronomeRow.tsx` (a `below` slot between the row and `StatusLine`; the line gets `rowSentence`), `screens/Rehearsal.tsx`, `screens/Recording.tsx` (`BackingTakeRow` under `TakeRow:473`), `components/MetronomeSettings.tsx` (group "Backing track" after The click; the last line), `screens/Settings.tsx` (`:63` label and blurb), `components/metronome/ClickSettings.tsx` (title, the backing output, `:133` line), `components/Timeline.tsx` (`laneOrder` puts the Backing track last; dashed plate and lane), `components/LaneControls.tsx` ("Stereo file" / "Mono file" under the name), `components/TakePlayer.tsx` and its player hook (opens the Backing track muted unless `backing_heard`; M calls `set_song_backing_heard`), the rehearsal screen's disk line (one more track's channels while a backing track will play, spec Part 4), `lib/format.ts`

**Interfaces:**
- Consumes: Task 3. `BackingRow({state, onSwitch, onVolume, onPlay})`; `BackingTakeRow({state, onSwitch, onVolume})`; `BackingSettings({compact})` used by the tab and the gear.

- [ ] **Step 1: Write the failing e2e** in `backing.spec.ts`: the row hidden until a song has one, then always; Pałyn's row with its sentence, Dym's line, a free take's; off dims and says so; ▶ and ■ with "0:12 / 3:42"; the amber line; "Getting the backing track ready…"; the recording screen's row without ▶; the disk line counting one more track; Settings tab "Click & backing track" with its group and lines, the mono line on one output, picking an output previews; the gear's title and group; the player: Viasna 1's dashed lane above Master, muted the first time, M kept from Viasna 1 to another Viasna take, Review the same; nothing cut or moving at 960 px in every row state, both themes.
- [ ] **Step 2: Run** `cd ui && npm run build && npx playwright test e2e/backing.spec.ts` once → fails.
- [ ] **Step 3: Implement.** `metronome.spec.ts` and `drift.spec.ts` lines that name the tab or the gear's title change with it.
- [ ] **Step 4: Run** `backing.spec.ts`, `metronome.spec.ts` and `drift.spec.ts` once each → pass; `npm run lint`, `npm run design-check`, `npx tsc -b` clean.
- [ ] **Step 5: Commit** — `Backing track: its row, Settings and the dashed lane`.

### Task 8: Guide, changelog, reha.stream, review and the PR (wave 4)

**Files:**
- Modify: `docs/using-it.md` (section "The backing track" after the drift's), `tests/docs_screenshots.py` (shots `backing-row`, `backing-song`, `backing-lane`), `docs/screenshots/`, `CHANGELOG.md` (Unreleased, first item bold), `site/content/story.md` (the step line; item `backing` after `tempo`), `site/src/content/index.ts` (`ITEMS.before`), `site/src/page/evening.ts` (`KIND.backing = "tile"`, `SHOWS.backing = piece("backing")`), `site/src/page/pieces.tsx` (piece `backing`: Pałyn's `SongBacking`, still; rows wrap on a phone), `site/content/faq.md` (after "Does it show where we sped up?"), the site's tests (`site/e2e/page.spec.ts`, `site/src/content/index.test.ts`)

- [ ] **Step 1:** Write the texts as the spec has them, by CLAUDE.md "Writing" (humanizer on the guide section).
- [ ] **Step 2:** `cd site && npm run build && npx playwright test e2e/page.spec.ts` once → passes; take a picture of the new item for Alex.
- [ ] **Step 3:** Whole-branch review; fix every finding, minors included, before the PR.
- [ ] **Step 4:** PR (Before / After / How; "By hand": the cable test of spec Testing on macOS and Windows ASIO, a take in a DAW, the counter on the band's own files). Watch CI to green; send the site picture; ask Alex before merging.
