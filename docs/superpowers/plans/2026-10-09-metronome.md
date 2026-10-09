# A Metronome for Songs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each song keeps a tempo and a time signature; a metronome on the rehearsal screen clicks through an output of its own, counts in and flashes the beat; takes recorded to the click carry their tempo into `.mid` and WAV, play back with the click and show its bars on Master; reha.stream and the docs say so.

**Architecture:** The click's arithmetic and sounds live in `audio/click.py`, pure and shared by every stream that plays it. A take's click (`audio/take_click.py`) rides the recording stream when the click's output is the recording card (one stream with inputs and outputs, sample-locked) and otherwise drives its own output stream placed by the recording's clock (MIDI's `AudioClock` plus an `OutputClock`). Between takes the click plays through `audio/click_output.py`, or inside the player's stream when the player holds the same device. `metronome.py` holds the rehearsal-side state and settings so `api.py` only delegates. Files: a WAV writer of our own (`audio/wavfile.py`) adds the `acid` chunk; `midi/smf.py` gains tempo and time signature. The interface gets one row on the rehearsal screen, the count-in and edge light while recording, a Settings tab, a tempo row on a song's page, and a button and a striped lane on Master.

**Tech Stack:** Python 3.12 (CI and builds), sounddevice/PortAudio, numpy, stdlib `wave` for reading, SQLAlchemy + Alembic on SQLite, mido and pylibremidi (from MIDI recording); React 19 + TypeScript + Tailwind in `ui/`, Vitest and Playwright on the fake bridge; the Vite site in `site/`.

**Spec:** `docs/superpowers/specs/2026-10-09-metronome-design.md` (decisions M1–M16, Parts 1–11, "New in this spec" 1–14). Read it whole before the first task; every task argues from it.

**Built on:** the design-system work and MIDI recording, both merged before Task 1. Names below from MIDI (`midi/clock.py` `AudioClock`, `fit`; `midi/smf.py` `write_mid`, `read_events`, `crop_mid`; `midi/capture.py` `MidiRecorder`, `finish_draft`, `_place`; `midi/rig.py` `MidiRig`) are as on its branch `claude/project-thread-lwtn0c` at `0d374e9`; re-read them on main first and use what merged. Screens are drawn with the design system's components and rulings (`/mnt/project-files/design-system/rulings.md`); where a mockup and the design system differ, the design system wins.

**Approved looks** (reference for markup, wording and placement only; the `__MK_*` globals, `where13`, the mockup's own state store and its browser-made click never reach the app):
- every app piece: `/mnt/project-files/metronome/q13/src/Metronome.tsx` with variants Q7 `b`, Q8 `b`, Q9 `a` + gear, Q10 `a`, Q11 `d`, Q13 `b`; where each piece is mounted: the patch chain `q7/src/patch.py` → `q8` → `q9` → `q10` → `q11` → `q13` (Rehearsal.tsx footer `left`, Recording.tsx, Settings.tsx tab, SongPage.tsx, Timeline.tsx sticky Master block, LaneControls.tsx `extra` slot); mockups https://claude.ai/artifact/9f7bbX3awCVsaxkwyZVoNQ (Q11) and https://claude.ai/artifact/UWcojjzz2MVfyzCviavYC9 (Q13);
- reha.stream: `/mnt/project-files/metronome/q12/src/patch_site.py`, variant C; mockup https://claude.ai/artifact/7HG5dsn5QtbNh5aCjjP21y.

## Global Constraints

- Python check labels and Playwright test titles are Latin only (Windows CI prints cp1252): "Palyn", "Ahon"; no ♪, ★ or ▶ in a label. Test data may be in any script.
- Signatures exactly `"4/4"`, `"3/4"`, `"2/4"`, `"6/8"`. Clicks a bar 4, 3, 2, 6. Accent 2 on a bar's first click, 1 on 6/8's fourth, else 0.
- The tempo counts clicks: a click is `60 / tempo` seconds in every signature (a quarter in x/4, an eighth in 6/8). Range 30–300 in x/4, 60–600 in 6/8; integers. Quarter tempo = tempo in x/4, tempo / 2 in 6/8.
- A click's frame is `round(k * 60 * samplerate / tempo)` from the first click, computed from `k`, never summed.
- Stop on a click take, and a crop's end, go on to the next quarter boundary: the next click in x/4, the next even click in 6/8. The spec says "the next click"; a whole quarter is also a whole number of clicks, and it keeps the `acid` chunk's beat count whole whichever note it counts in 6/8.
- Sounds `"click"`, `"wood"`, `"hihat"` (labels Click, Woodblock, Hi-hat), made by the app; no sample files.
- Settings keys and defaults: `click_device` (identity, as `output_device`) and `click_channels` (none: the player's output), `click_sound` `"click"`, `click_volume` 0.7, `count_in_bars` 1 (0, 1, 2), `tempo_in_wav` true, `metronome_on` true.
- `.mid`: FF 51 = `round(60_000_000 / quarter tempo)`, 500000 when the take has no tempo; FF 58 x/4 `nn 02 18 08`, 6/8 `06 03 0C 08`, none without a signature.
- `acid` chunk, 24 bytes, before `data`: `struct.pack("<4sIIHHfIHHf", b"acid", 24, 0x04, 60, 0x8000, 0.0, beats, den, num, quarter_tempo)`; `beats` = the file's length in quarter notes. This order reads back through libsndfile 1.2.2 as `time_sig_num=num`, `time_sig_den=den`, `bpm`, `num_beats` (checked in the container while writing this plan).
- A click plays only through `click_output.py`, the recorder's stream (`capture.py`) or the player's (`player.py`); nothing opens a second stream on a device the app holds (spec Part 3).
- Every time on the Python side is `time.perf_counter_ns()`, as MIDI's.
- Old songs, takes and configs read as before: no tempo, not click takes, the click to the player's output.
- No layout jumps; nothing cut at 960 px; both themes.
- Copy, exact (spec wording): the status lines of Part 4; "Count-in: 2 of 4" · "Clicking to Stop." · "Click off. The tempo still goes into the take." · "No click: this take has no tempo."; "Click with the take: 128 bpm · 4/4" · "This take was recorded without the click" · "Click 128 bpm · 4/4" · "Recorded without the click"; the Settings hints of Part 6 and the WAV checkbox's hint; "Count the tempo from a whole go of the song:"; the song page lines of Part 7; tooltips "Beats a minute" and "Eighths a minute: the six clicks of a bar"; the site's words in "On reha.stream".
- Tests come first and are seen failing. Python suites are plain scripts with `ok(label, cond)` sections, as now.
- Commits end with the session's two attribution lines; no model names anywhere in the repo.
- No merge without Alex's word. The PR opens only after the whole-branch review's findings, minors included, are fixed and pushed.

## Review Focus

The five things the spec implies but does not test, most likely to bite first. Each one's test is added to the task named.

1. **A tempo typed wrong**: empty, "abc", "128.6", "0", "9999", a minus sign, a 6/8 number pasted into 4/4. Expected: empty means no tempo; a number is rounded and kept in the signature's range; anything else puts the last good value back. Tests in Task 12.
2. **The click's output vanishing mid-take** (a headphone amp unplugged, Bluetooth gone). Expected: the take records on, stays a click take with its grid, the screen keeps flashing, `metronome_state()` says `output_missing`, Stop works. Test in Task 7.
3. **The click device at another sample rate** than the recording card (44.1 kHz jack, 48 kHz desk). Expected: the voices are made at the output's rate and each click still lands within the Part 3 aim. Test in Task 7.
4. **The tempo changed while ▶ runs** (−/+, typing, Tap, another song picked). Expected: the click goes on at the new tempo from its next click, no gap, no double click, the bar restarting on 1 only when the signature changes. Test in Task 8.
5. **Stop pressed during the count-in.** Expected: the take ends on the next quarter, is kept or thrown away as any short take (false start rules unchanged), and its files and `.mid` start at the first click. Test in Task 6.

## Files

New, Python:

| File | Its one job |
|---|---|
| `audio/click.py` | Signatures, ranges, accents, click frames, the three voices, mixing clicks into a buffer. |
| `audio/click_timing.py` | `OutputClock`; a stream's lead and a duplex stream's round trip from `time_info`. |
| `audio/click_source.py` | `ClickSource`: one running click (pattern, voices, placement, on/off, bars), rendered block by block into any stream; what is heard next, for the screen. |
| `audio/click_output.py` | `ClickOutput`: an output stream of its own for a `ClickSource`. |
| `audio/take_click.py` | `TakeClick`: a take's click, its first click frame, its end, duplex or another device. |
| `audio/wavfile.py` | `WavWriter` with an optional `acid` chunk; `read_acid`. |
| `audio/tempo.py` | Counting a tempo from a take (Part 10). |
| `metronome.py` | The settings, the free click between takes and in previews, the state for the screen, which sink a click goes to. |
| `store/migrations/versions/00NN_metronome.py` | Song and take tempo columns (next free number). |

Changed, Python: `audio/capture.py`, `audio/player.py`, `audio/crop.py`, `audio/mixdown.py`, `audio/drafts.py`, `midi/clock.py`, `midi/smf.py`, `midi/capture.py`, `midi/rig.py`, `store/models.py`, `store/library.py`, `api.py`, `mediaserver.py`, `app.py` (selftest).

Tests: new `tests/test_click.py` (the `audio/click*`, `take_click`, `wavfile`, `tempo` modules; added to `tests/run_all.py`), new sections in `tests/test_engine.py` (Api, recorder, player, crop, mixdown, drafts), `tests/test_store.py` (migration, library rules) and `tests/test_midi.py` (`.mid` tempo, head shift, taps).

Interface: `ui/src/lib/api.ts`, new `ui/src/lib/metronome.ts` (+ `metronome.test.ts`), new `ui/src/components/metronome/` (`NoteGlyph.tsx`, `TempoField.tsx`, `SignatureSelect.tsx`, `TapButton.tsx`, `BeatDots.tsx`, `ClickSettings.tsx`, `MetronomeRow.tsx`, `StatusLine.tsx`, `CountIn.tsx`, `EdgeLight.tsx`, `TakeRow.tsx`, `SongTempoRow.tsx`, `MasterClick.tsx`, `MasterClickLane.tsx`, `useMetronome.ts`), `screens/Rehearsal.tsx`, `screens/Recording.tsx`, `screens/Settings.tsx`, `components/SongPage.tsx`, `components/Timeline.tsx`, `components/LaneControls.tsx`, `components/TakePlayer.tsx`, `screens/Review.tsx`, `e2e/fake-bridge.js`, new `e2e/metronome.spec.ts`.

Docs, site, tools: `docs/using-it.md`, `CHANGELOG.md`, `tests/docs_screenshots.py`, `site/content/features.md`, `site/content/faq.md`, `site/src/content/index.ts`, `site/src/page/Features.tsx`, `site/src/page/pieces.tsx`, `site/src/page/Story.tsx`, new `tools/click_alignment.py`.

## Shapes every task shares

```python
# A song (Library.songs(), get_song): adds
"tempo": int | None, "signature": "4/4" | "3/4" | "2/4" | "6/8" | None
# A take (_take_data, stop_take, keep_take): adds
"tempo": int | None, "signature": str | None, "click": bool
# take.json, written at Record when the metronome has a tempo:
"click": {"tempo": int, "signature": str, "on": bool, "wav_tempo": bool,
          "first_click_frame": int | None, "end_frame": int | None}
# first_click_frame: input frame of the first count-in click (None until chosen, or with no click);
# end_frame: the frame the files end on (None until Stop).
# metronome_state() (POLLABLE):
{"phase": "idle" | "preview" | "count" | "take",
 "tempo": int | None, "signature": str, "per_bar": int,
 "upcoming": [[in_ms: float, index_in_bar: int], ...],   # clicks heard in the next 1.5 s
 "count": int,                     # 1-based count-in click, 0 outside the count-in
 "since_count_in_ms": float | None,  # ms since the count-in ended (negative before); None with no click
 "on": bool, "output_missing": str | None}  # the click device's name when it cannot play
```

---

### Task 1: The click's arithmetic and its sounds

**Files:**
- Create: `src/rehearsal_recorder/audio/click.py`
- Create: `tests/test_click.py` (and add it to `tests/run_all.py`)

**Interfaces:**
- Produces: `SIGNATURES`, `SOUNDS`; `tempo_range(signature) -> tuple[int, int]`; `clamp_tempo(value: float, signature) -> int`; `per_bar(signature) -> int`; `per_quarter(signature) -> int` (1, or 2 in 6/8); `accent(signature, k: int) -> int` (k counted from the first click of a bar-aligned run); `quarter_tempo(tempo, signature) -> float`; `click_frame(k: int, tempo: int, samplerate: int) -> int`; `class Voices(sound: str, samplerate: int, volume: float)` with `of(accent) -> np.ndarray` (float32, mono, ≤ 60 ms); `mix_clicks(out: np.ndarray, first_frame: int, starts: list[tuple[int, int]], voices: Voices, route: tuple[int, ...]) -> None` (adds each voice from its start frame, clipped to `out`; a voice starting before `first_frame` adds its remaining tail).

- [ ] **Step 1: Write the failing section `[1] The click`**: ranges `(30, 300)` and `(60, 600)`; `clamp_tempo(128.6, "4/4") == 129`, `clamp_tempo(20, "4/4") == 30`, `clamp_tempo(700, "6/8") == 600`; accents for 4/4 `[2,0,0,0,2]`, 6/8 `[2,0,0,1,0,0,2]`, 3/4 `[2,0,0,2]`, 2/4 `[2,0,2]`; `quarter_tempo(198, "6/8") == 99`; `click_frame(k, 128, 48000)` equals `round(k * 22500)` for k up to 128 * 60 (an hour), and for tempo 127 at 44100 the hour's last click is within 0.5 frame of `k * 44100 * 60 / 127`; each `Voices` peak ≤ `volume`, accent 2 louder or higher than 0 (spectral centroid), 1 between them; three sounds differ; a voice made at 44100 and at 48000 lasts the same time within a frame; `mix_clicks` into two 256-frame blocks gives the same samples as into one 512-frame block for a click starting at frame 250, and only on the routed channels.
- [ ] **Step 2: Run** `python tests/test_click.py` → fails (no module).
- [ ] **Step 3: Implement.** Voices are a short sine burst with a fast exponential decay (Click: 900 Hz accent 0, 1100 accent 1, 1300 accent 2, the mockup's pitches), a band-limited resonant burst (Woodblock), filtered noise (Hi-hat), each with a 1 ms raised-cosine attack, cached per `(sound, samplerate, volume)`.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `Metronome: the click's arithmetic and its three sounds`.

### Task 2: A WAV that carries its tempo

**Files:**
- Create: `src/rehearsal_recorder/audio/wavfile.py`
- Modify: `src/rehearsal_recorder/audio/capture.py` (`raw_to_wav:509`), `audio/crop.py` (`crop_wav`), `audio/mixdown.py` (`mixdown`)
- Test: `tests/test_click.py`, `tests/test_engine.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) class Acid: quarter_tempo: float; num: int; den: int`; `class WavWriter(path, samplerate, channels, sampwidth, acid: Acid | None = None)` as a context manager with `write(frames: bytes)`; it writes RIFF, `fmt `, `acid` (when given, beats from the frames written, patched at close) and `data`, and fixes sizes at close; `read_acid(path) -> Acid | None`.
- Produces: `raw_to_wav(raw_path, wav_path, samplerate, bit_depth=16, channels=1, progress=None, head_frames=0, frames=None, acid=None)` (writes `[head_frames, head_frames + frames)`, all after `head_frames` when `frames` is None); `crop_wav(..., acid="keep")` copies the source's chunk with beats for the new length; `mixdown(..., acid=None)` writes the given chunk.

- [ ] **Step 1: Write the failing section `[2] The WAV's tempo`**: a 16-bit and a 24-bit stereo file written by `WavWriter` without `acid` is byte-identical to what `wave` writes for the same frames; with `Acid(99.0, 6, 8)` and 8 quarters of audio at 48000, libsndfile reads back `time_sig_num 6`, `time_sig_den 8`, `num_beats 8`, `bpm 99.0` (read with `soundfile._snd.sf_command(f._file, 0x10E0, buf, 44)` and `struct.unpack("<hhiifi", buf[:20])`), `wave` reads the same frames, and `read_acid` gives the `Acid` back; `read_acid` of a file without one is None.
- [ ] **Step 2: Add to `tests/test_engine.py`** (`[70] Files that keep their tempo`): `raw_to_wav(head_frames=480, frames=48000)` writes exactly those frames; `crop_wav` of a file with a chunk keeps it with beats for the cut length, of one without adds none; `mixdown(acid=Acid(128.0, 4, 4))` carries it; the existing crop, mixdown and raw_to_wav sections still pass unchanged.
- [ ] **Step 3: Run both suites** → fail.
- [ ] **Step 4: Implement**; `raw_to_wav`, `crop_wav` and `mixdown` write through `WavWriter`.
- [ ] **Step 5: Run** → pass.
- [ ] **Step 6: Commit** — `Metronome: WAV files can carry their tempo`.

### Task 3: The `.mid` carries the take's tempo, and starts at the first click

**Files:**
- Modify: `src/rehearsal_recorder/midi/smf.py` (`write_mid`, `crop_mid`, `read_events`), `midi/capture.py` (`MidiRecorder.stop`, `finish_draft`, `_place`, `_make_mid`)
- Test: `tests/test_midi.py`

**Interfaces:**
- Produces: `write_mid(path, *, track_name, port_name, start, events, tempo_us: int = 500_000, time_signature: tuple[int, int, int, int] | None = None)`; `read_events` metas add `"tempo_us"` and `"time_signature"`; `crop_mid` keeps both; `smf.meter_of(tempo: int | None, signature: str | None) -> tuple[int, tuple | None]` (FF 51 and FF 58 values per Global Constraints).
- Produces: `MidiRecorder.stop(duration_sec, head_sec=0.0, meter=(500_000, None))` and `finish_draft(take_dir, duration_sec, samplerate=None, head_sec=0.0, meter=(500_000, None))`: every event's time is less `head_sec`; what falls before 0 feeds the start state, as events before a take's start do now.

- [ ] **Step 1: Write the failing section `[11] The take's tempo in its .mid`**: `meter_of(128, "4/4") == (468750, (4, 2, 24, 8))`; `meter_of(198, "6/8") == (606061, (6, 3, 12, 8))`; `meter_of(None, None) == (500000, None)`; a file written with them reads back a `set_tempo` of 606061 and a `time_signature` 6/8 with `clocks_per_click == 12` at tick 0, before the start messages; a recorder stopped with `head_sec=0.25` puts a note played at 1.0 s at 0.75 s, a pedal pressed at 0.1 s into the start state and no note before 0; `finish_draft` with the same `head_sec` gives the same file; `crop_mid` keeps tempo and signature.
- [ ] **Step 2: Run** `python tests/test_midi.py` → fail.
- [ ] **Step 3: Implement.** 960 ticks stay one quarter, so a tick is no longer 1/1920 s at every tempo: `tick = round(seconds * 960 * 1_000_000 / tempo_us)` from the take's start, never summed (1920 a second at 500000, as now).
- [ ] **Step 4: Run** → pass, MIDI's own sections included.
- [ ] **Step 5: Commit** — `Metronome: a take's .mid states its tempo and time signature`.

### Task 4: Songs and takes keep tempos (migration)

**Files:**
- Create: `src/rehearsal_recorder/store/migrations/versions/00NN_metronome.py`
- Modify: `src/rehearsal_recorder/store/models.py` (`Song`, `Take`), `store/library.py` (`add_take:848`, `update_take:878`, `merge_songs:481`, `songs:539`, `goes_of:579`, `_take_data:184`; new `set_song_tempo`, `tempo_for`)
- Test: `tests/test_store.py`

**Interfaces:**
- Produces: `Song.tempo: int | None`, `Song.signature: str | None`; `Take.tempo: int | None`, `Take.signature: str | None`, `Take.click: bool` (default False); `Library.set_song_tempo(song_id, tempo, signature) -> dict | None`; `Library.tempo_for(name) -> {"song": {"id", "title"} | None, "tempo", "signature", "last_take": {"folder", "take_number", "name"} | None}` (the next take's name resolved as `_resolve` does, read only); `add_take(folder, take)` and `update_take(..., tempo=None, signature=None, click=None)` read those keys.
- Rules (spec Part 2): `add_take` of a click take to a song with no tempo gives the song its tempo and signature; `update_take(name=…)` moving a take that has a tempo into a song with no tempo gives the song that tempo; a rename keeps a song's tempo; `merge_songs` keeps the target's, or takes the source's when the target has none.

- [ ] **Step 1: Write the failing section `[30] Tempos in the library`**: migration on an existing library: every song and take reads `None`, `None`, `False`; the rules above, one check each; a song's tempo of 198 in 6/8 survives `songs()` and `goes_of`; `tempo_for("Palyn 3")` finds Pałyn and its newest take; `tempo_for("Take 4")` has no song; `set_song_tempo` refuses a signature outside the four and a tempo outside its range (returns None, changes nothing).
- [ ] **Step 2: Run** `python tests/test_store.py` → fail.
- [ ] **Step 3: Implement**, the migration with Alembic's batch mode as MIDI's.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `Metronome: songs and takes keep a tempo and a time signature`.

### Task 5: Clocks for a click that is heard

**Files:**
- Create: `src/rehearsal_recorder/audio/click_timing.py`
- Modify: `src/rehearsal_recorder/midi/clock.py` (`AudioClock`: new `ns_at`)
- Test: `tests/test_click.py`

**Interfaces:**
- Produces: `AudioClock.ns_at(frame: int) -> int` (the fitted line forward, the inverse of `to_seconds`; safe to call from another thread: the line is one tuple replaced whole at each kept mark); `class OutputClock(samplerate)` with `mark(arrival_ns: int, first_frame: int, lead_sec: float)`, `frame_at(ns) -> int`, `ns_at(frame) -> int` (same fitting as `fit`); `lead_of(time_info, fallback_sec) -> float` (`outputBufferDacTime - currentTime` when it is within `[0, 1)`, else `fallback_sec`); `round_trip_frames(time_info, fallback_sec, samplerate) -> int` (`(outputBufferDacTime - inputBufferAdcTime) * samplerate` when within `(0, 1)` s, else `fallback_sec * samplerate`).

- [ ] **Step 1: Write the failing section `[3] Where a click is heard`**: an `AudioClock` fed an hour of marks at +200 ppm (MIDI's test data) and an `OutputClock` fed an hour at −150 ppm with ±2 ms arrival jitter: the click of input frame `48000 * 3600` lands on the output frame whose heard time is within 1 ms of that frame's capture time; `ns_at(to_seconds-inverse)` round trips within 1 µs; `lead_of` and `round_trip_frames` use the driver's times when sane and the fallback for 0, negative or > 1 s.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass; `python tests/test_midi.py` still passes.
- [ ] **Step 5: Commit** — `Metronome: the recording's clock read forward, and an output's own clock`.

### Task 6: A take's click on the recording card

**Files:**
- Create: `src/rehearsal_recorder/audio/click_source.py`, `audio/take_click.py`
- Modify: `src/rehearsal_recorder/audio/capture.py` (`AudioRecorder.__init__`, `_callback`, `start:336`, `stop:425`, `_write_record:398`), `audio/drafts.py` (`finalize`, `describe`)
- Test: `tests/test_click.py`, `tests/test_engine.py`

**Interfaces:**
- Consumes: Task 1, Task 2 (`raw_to_wav(head_frames, frames, acid)`), Task 3 (`head_sec`, `meter`), Task 5.
- Produces: `class ClickSource(tempo, signature, voices, route, place=None, bars=None, start_k=0)` with `render(out, first_frame, arrival_ns, lead_sec)`, `set_on(on)`, `retime(tempo, signature)` (Task 8), `upcoming(now_ns, within_sec=1.5) -> list[tuple[float, int]]` (ms from now, index in bar), `count_state(now_ns, count_in_clicks) -> tuple[int, float | None]`; `place(k) -> frame` defaults to `origin + click_frame(k)`.
- Produces: `class TakeClick(tempo, signature, count_in_bars, voices, route, on=True, wav_tempo=True, lead_sec=0.1)` with `duplex: bool`, `first_click_frame: int | None`, `end_frame: int | None`, `on_duplex_block(outdata, frames_done, frames, time_info, latency)`, `stop_frame(frames_done) -> int` (the next quarter boundary at or after `frames_done`), `record() -> dict` (the `take.json` `click` shape), `acid() -> Acid | None`, `meter() -> tuple`.
- Produces: `AudioRecorder(device_index, samplerate, tracks, out_dir, bit_depth=16, clock=None, notes=(), click=None)`. With `click.duplex`, `start()` opens `sd.Stream(device=(index, index), channels=(inputs, max(route) + 1))`; the first callback sets `first_click_frame = frames_done + lead + round_trip`, and the click of input frame `s` is written at output frame `s - round_trip`. `stop()` keeps capturing until `stop_frame` (at most 2 s more; not when the stream has died) and writes `[first_click_frame, end_frame)` of each raw; `duration_sec` is that length. `take.json` gets `click` at start and again once `first_click_frame` is known.
- Produces: `drafts.finalize` cuts a recovered click take at `first_click_frame` (to the raw's end, spec Part 3) and passes `head_sec` to `finish_draft`.

- [ ] **Step 1: Write the failing section `[4] A take's click, one stream`** in `tests/test_click.py` on a `TakeClick` driven by fake duplex blocks (time_info with `inputBufferAdcTime`, `outputBufferDacTime`, `currentTime`): with a round trip of 9.5 ms at 48000 and 1 bar of 4/4 at 120 count-in, the first click is written at output frame `first_click_frame - 456`; the count-in is 4 clicks; `on_duplex_block` with `on=False` writes silence and keeps counting; a 6/8 `stop_frame` lands on an even click.
- [ ] **Step 2: Add `[71] Recording to the click` to `tests/test_engine.py`** with sounddevice stubbed as now (its `Stream` recorded, its callback driven by hand): the stream opened is one with inputs and outputs; `take.json`'s `click` has `first_click_frame`; after Stop each WAV starts at `first_click_frame` and ends on `end_frame`, the `acid` chunk present with `tempo_in_wav` and absent without; a crashed take's drafts recover cut at the same frame; Review Focus 5: Stop during the count-in ends at the next quarter, the take's duration is that short span and its WAVs and `.mid` start at the first click.
- [ ] **Step 3: Run both suites** → fail.
- [ ] **Step 4: Implement.** The duplex callback zeroes `outdata` and lets `TakeClick` write into it before `_take_block`; nothing in the callback allocates beyond what `mix_clicks` writes in place.
- [ ] **Step 5: Run** → pass; MIDI's recorder and clock sections still pass.
- [ ] **Step 6: Commit** — `Metronome: a take's click on the recording card, its files on the beat`.

### Task 7: A take's click on another device

**Files:**
- Create: `src/rehearsal_recorder/audio/click_output.py`
- Modify: `src/rehearsal_recorder/audio/take_click.py`, `audio/capture.py`
- Test: `tests/test_click.py`, `tests/test_engine.py`

**Interfaces:**
- Consumes: `ClickSource`, `TakeClick` (Task 6), `AudioClock.ns_at`, `OutputClock` (Task 5).
- Produces: `class ClickOutput(device_index, channels: tuple[int, ...], samplerate=None)` with `start(source: ClickSource)`, `swap(source | None)`, `stop()`, `problem() -> str | None` (the device's name when its stream failed or ended), `samplerate`; its callback marks an `OutputClock` and renders the source.
- Produces: `TakeClick(..., output: ClickOutput | None = None)`: with an output, `duplex` is False; the recorder's callback calls `take_click.on_input(frames_done, clock)`, which sets `first_click_frame = frames_done + 0.2 s` at the first input block after the output's first block; each click is placed at `out_clock.frame_at(in_clock.ns_at(first_click_frame + click_frame(k)))`.

- [ ] **Step 1: Write the failing section `[5] A take's click, another device`**: input at 48000 running +200 ppm, output at 44100 running −100 ppm, with arrival jitter: over an hour every click's heard time is within 1 ms of its input frame's capture time (Review Focus 3); voices made at 44100; an output that starts 2 s late moves the first click, so the count-in is whole.
- [ ] **Step 2: Add `[72] The click elsewhere` to `tests/test_engine.py`**: the recording stream stays input only and a second `OutputStream` opens on the click device; Review Focus 2: the output's stream ending mid-take leaves the recording going, `problem()` set, Stop working and the take a click take with its grid.
- [ ] **Step 3: Run** → fail.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** → pass.
- [ ] **Step 6: Commit** — `Metronome: a click on another device, placed by the recording's clock`.

### Task 8: The click between takes, in previews, and in the player

**Files:**
- Create: `src/rehearsal_recorder/metronome.py`
- Modify: `src/rehearsal_recorder/audio/player.py` (`TakePlayer.open_output:187`, `_start_output:227`, `_render:299`, new click methods)
- Test: `tests/test_click.py`, `tests/test_engine.py`

**Interfaces:**
- Consumes: `ClickSource`, `ClickOutput`, `Voices`.
- Produces: `TakePlayer.open_output(device_index=None, channels=(1, 2), extra_channels=())` (the stream opens wide enough for both); `TakePlayer.play_free_click(source | None)` (mixed into its stream on the source's route, outside the master volume and meters); `TakePlayer.set_take_click(tempo, signature, voices | None)` and `set_click_on(on)` (Part 8: clicks at the take's own frames from file frame 0, following seek and loop, scaled by the master volume, out of the meters; `state()` adds `"click": bool`).
- Produces: `class Metronome(config, player_getter, device_lookup)` with `settings() -> dict`, `set_setting(key, value) -> dict` (validated; unknown keys refused), `click_sink() -> ("player", TakePlayer) | ("own", ClickOutput)`, `play(tempo, signature) -> dict`, `retime(tempo, signature)`, `stop()`, `preview(bars=1, sound=None) -> dict`, `state() -> dict` (the `metronome_state` shape), `output_problem() -> str | None` (the click device saved but not found, or its stream failed).
- `ClickSource.retime(tempo, signature)`: from the next click on the new period; the bar restarts on 1 only when the signature changes.

- [ ] **Step 1: Write the failing section `[6] The click on its own`**: Review Focus 4: a running `ClickSource` retimed from 120 to 140 has no gap longer than 60/120 s and no two clicks closer than 60/140 s around the change; with a new signature the next click is an accent 2; `preview(bars=1)` stops after one bar.
- [ ] **Step 2: Add `[73] The click and the player` to `tests/test_engine.py`**: the player on device 3, outputs 1–2, and the click on device 3, outputs 3–4: one stream on device 3 with 4 channels; ▶ mixes into it and nothing else opens; the player closed, ▶ opens a `ClickOutput`; the take click plays at file frame 0 + `click_frame(k)` after a seek to 10.0 s and inside a loop, at half level with the master at 0.5, and leaves `player_state()["levels"]` alone; `set_setting("click_volume", 2)` and `("count_in_bars", 3)` are refused; a saved click device not plugged in gives `output_problem()` its name; with no click device saved, `click_sink()` uses the player's output device and channels (spec, New 1).
- [ ] **Step 3: Run** → fail.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** → pass.
- [ ] **Step 6: Commit** — `Metronome: the click between takes, in previews and with a take played back`.

### Task 9: The Api, before and during a take

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`__init__`, `get_settings:648`, `shutdown`, `start_take:1808`, `stop_take:1849`, `keep_take:1892`, `recover_draft`, `list_output_devices:1176`, `player_open:2909`; new calls below), `mediaserver.py` (`POLLABLE`)
- Test: `tests/test_engine.py`

**Interfaces:**
- Consumes: `Metronome` (Task 8), `TakeClick`, `ClickOutput`, `AudioRecorder(click=)` (Tasks 6–7), `Library.tempo_for`, `add_take` tempo keys (Task 4), `MidiRecorder.stop(head_sec, meter)` (Task 3).
- Produces, all on `Api`: `get_settings()` adds the Global Constraints keys and `"click_device_index"`; `set_click_device(device_index)`, `set_click_channels(channels)`, `set_metronome_setting(key, value)`; `metronome_play(tempo, signature)`, `metronome_retime(tempo, signature)`, `metronome_stop()`, `metronome_preview(sound=None)`; `metronome_state()` (POLLABLE); `metronome_set_on(on)` (also mid-take); `tempo_for(name)`; `start_take(click=None)` with `click = {"tempo", "signature"}` or None (None, or `metronome_on` false: no click, the take still records `tempo`/`signature` when given); `stop_take()` and `keep_take(...)` carry `tempo`, `signature`, `click`; `player_set_click(on)` (kept on the `Api` for the session and applied at every `player_open`; off when the app starts); `list_output_devices()` items gain `"click_unavailable": str | None` ("Another ASIO card can't play while one records." for an ASIO device other than the recording card when that card is ASIO).
- `start_take` stops a free click, closes the player when it holds the click's device, builds the `TakeClick` (duplex when the click device's index is the recording device's, else a `ClickOutput`), and stores `click` in `take.json`.

- [ ] **Step 1: Write the failing section `[74] The metronome through the Api`**: `start_take(click={"tempo": 128, "signature": "4/4"})` with the click on the recording card opens one duplex stream; on another device two streams; with `metronome_on` false none and the take keeps tempo 128, `click` False; `metronome_state()` goes `count` (counts 1–4) then `take`, `since_count_in_ms` near 0 at the count-in's end; `metronome_set_on(False)` mid-take keeps `click` True; `keep_take` of the first click take of a song without a tempo gives the song 128 · 4/4; a false start discarded does not; the free click stops at `start_take`; the ASIO rule in `list_output_devices`; `metronome_state` in `POLLABLE`; `player_set_click(True)` holds for the next `player_open` and is off in a fresh `Api`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass, every older section included.
- [ ] **Step 5: Commit** — `Metronome: Record clicks, and takes keep their tempo`.

### Task 10: Crop, mix, rename and the cloud keep the grid

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`_crop_tracks:2671`, `crop_take:2770`, `crop_draft:2866`, the mix for the cloud, `rename_take:2349`, `merge_songs`, `get_song`)
- Test: `tests/test_engine.py`

**Interfaces:**
- Consumes: `crop_wav(acid="keep")`, `mixdown(acid=)`, `read_acid` (Task 2); `crop_mid` (Task 3); `click_frame`, `per_bar`, `per_quarter` (Task 1).
- Produces: `snap_region(start_sec, end_sec, tempo, signature, samplerate, length_frames) -> tuple[int, int]` in `audio/click.py` (start back to the bar line at or before it, end on to the next quarter boundary, both inside the file); `crop_take` and `crop_draft` of a click take use it and return `{"start_sec", "end_sec"}` as cut, for the notice.

- [ ] **Step 1: Write the failing section `[75] The grid after a crop`**: a 4/4 take at 120 cropped 3.3–10.2 s cuts 2.0–10.5 s; a 6/8 take at 180 cropped 1.1–4.05 s cuts 0.0–4.0 s (bar 2.0 s, quarter 0.6667 s); a region starting in the count-in snaps to 0, one ending in the last part-quarter ends at the file's end; the cut WAVs keep their `acid` only when they had one; the `.mid` is cut the same; the take stays a click take; the mix of a click take recorded with the chunk carries it, and so does its WAV copy in the cloud; a rename and a merge keep tempos as Task 4's rules say.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `Metronome: a cropped click take still starts on a bar`.

### Task 11: Counting a tempo from a take, and pads that tap

**Files:**
- Create: `src/rehearsal_recorder/audio/tempo.py`
- Modify: `src/rehearsal_recorder/midi/rig.py` (taps), `api.py` (`count_tempo`, `set_song_tempo`, `metronome_tap_listen`, `metronome_taps`), `mediaserver.py`
- Test: `tests/test_click.py`, `tests/test_midi.py`, `tests/test_engine.py`

**Interfaces:**
- Produces: `tempo.count(*, drums_mid: str | None, drums_wav: str | None, wavs: list[str], signature: str) -> float | None` (the onset envelope and windowed autocorrelation of `/mnt/project-files/metronome/research/np_tempo.py`, median of 8-second windows' tempos, read in blocks; in 6/8 the eighth whose triple period is also among the strongest; the result clamped to the signature's range; None for silence or under 8 s).
- Produces: `Api.count_tempo(folder, take_number, signature) -> {"ok", "tempo"}` or `{"ok": False, "error"}`; `Api.set_song_tempo(song_id, tempo, signature) -> {"ok"}`; `MidiRig.listen_taps(quiet_sec=2.0)` and `MidiRig.taps() -> list[int]` (ns of note-ons with velocity > 0 since the last read, from any open port, only while listening; listening ends after `quiet_sec` with no hit); `Api.metronome_tap_listen()` (opens the saved band's notes ports through a rig of its own when no rehearsal runs, closed when listening ends); `Api.metronome_taps() -> {"ms_ago": [float]}` (POLLABLE).

- [ ] **Step 1: Write the failing section `[7] Counting a tempo`** on synthetic takes made as `research/compare.py` makes them: 4/4 at 128 → 128 ±2 (or 64 or 256, the halve/double case, flagged as such in the check's label); 3/4 at 96; 6/8 eighths at 198 → 198 ±3; a drift 124→134 → within 3 of 129; a drums `.mid` used before the WAV; silence → None.
- [ ] **Step 2: Add `[12] Pads that tap` to `tests/test_midi.py`**: hits before `listen_taps` are not taps; after it they are; 2.1 s of quiet ends listening.
- [ ] **Step 3: Add `[76] Counting and tapping through the Api`** to `tests/test_engine.py`: `count_tempo` on a take folder; a missing file's error; `set_song_tempo` refusals; `metronome_tap_listen` outside a rehearsal opens the band's port and closes it after the quiet.
- [ ] **Step 4: Run** → fail.
- [ ] **Step 5: Implement.**
- [ ] **Step 6: Run** → pass. The section prints the counter's time for a 3-minute take (aim about 0.3 s).
- [ ] **Step 7: Commit** — `Metronome: a tempo counted from a take, and tapped on a pad`.

### Task 12: The interface's side of the bridge

**Files:**
- Modify: `ui/src/lib/api.ts`, `ui/e2e/fake-bridge.js`
- Create: `ui/src/lib/metronome.ts`, `ui/src/lib/metronome.test.ts`

**Interfaces:**
- Produces, in `api.ts`: `Signature`, `ClickSound`, `MetronomeSettings`, `MetronomeState`, `TempoFor` as the Python returns them; `Song`, `SongGo`, `Take`, `PendingTake` gain `tempo?`, `signature?`, `click?`; every Task 9–11 call; `Pollable` gains `metronome_state` and `metronome_taps`.
- Produces, in `metronome.ts`: `SIGNATURES`, `tempoRange(sig)`, `parseTempo(text: string, sig, last: number | null) -> number | null` (Review Focus 1), `perBar(sig)`, `accentOf(sig, i)`, `unitTitle(sig)`, `tapTempo(timesMs: number[], sig) -> number | null` (the average of the last four gaps; a gap over 2000 ms starts afresh; clamped), `statusLine(input) -> { text: string; link?: { label: string; action: "save" | "count" } ; amber?: boolean }` for every Part 4 line, `songLine(...)` for Part 7.
- Produces, in the fake bridge: tempos for the demo songs (Pałyn 128 4/4, Viasna 128 4/4, Ahoń 198 6/8, Sonca 96 3/4, Daroha 118 4/4; Dym and Ptuška none), click takes for the demo band's takes at 128 (first stick beat checked against the stripes in Task 16), `metronome_state` driven by a timer from `start_take`, `count_tempo` (Dym 104, Ptuška 86), `metronome_taps`, `window.__CLICK_MISSING__`.

- [ ] **Step 1: Write the failing `metronome.test.ts`**: `parseTempo("", "4/4", 120) === null`; `("128.6") === 129`; `("abc", …, 120) === 120`; `("0") === 30`; `("9999", "6/8") === 600`; `("-5") === 30`; `tapTempo([0, 500, 1000, 1500, 2000], "4/4") === 120`; a 2100 ms gap restarts; each Part 4 line from its inputs, `Save to song` only while song and row differ; `accentOf("6/8", 3) === 1`.
- [ ] **Step 2: Run** `cd ui && npm test` → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and `npx tsc -p tsconfig.app.json --noEmit` → pass.
- [ ] **Step 5: Commit** — `Metronome: the interface's side of the bridge`.

### Task 13: The rehearsal screen's row

**Files:**
- Create: `ui/src/components/metronome/NoteGlyph.tsx`, `TempoField.tsx`, `SignatureSelect.tsx`, `TapButton.tsx`, `BeatDots.tsx`, `ClickSettings.tsx`, `StatusLine.tsx`, `MetronomeRow.tsx`, `useMetronome.ts`
- Modify: `ui/src/screens/Rehearsal.tsx` (`FooterRow` `left`)
- Create: `ui/e2e/metronome.spec.ts`

**Interfaces:**
- Consumes: Task 12.
- Produces: `useMetronome()` → `{ state: MetronomeState, lit: number | null }` (polls `metronome_state`, lights each click at its `in_ms` with `requestAnimationFrame`, never a free-running timer); `TempoField({ tempo, signature, onChange, big? })`; `TapButton({ signature, onTempo })` (button, key T through `useKey("t", …)` outside text fields, and pad hits from `metronome_taps` after a press); `ClickSettings({ compact })` (the four settings, used by the gear's popover, with the line "The same settings are in Settings › Metronome.", and by Task 15's tab; while no click device is saved the pickers show the player's device and outputs); `MetronomeRow({ nextName })` (follows `tempo_for(nextName)`; holds a change until another song; Save to song / Save now / count it from the last take).
- The status line keeps two lines' room; the beat dots in 6/8 in two groups of three with a 3 px gap and 6 px between the groups.

- [ ] **Step 1: Write the failing Playwright tests** (titles Latin only): `metronome row follows the next song` (Palyn 128 4/4 → Viasna 128 4/4 → Dym "No tempo yet"); `a change holds until another song and saves to it`; `a free take`; `T taps a tempo and not inside the name field`; `pads tap after Tap`; `play runs the click and Record stops it`; `the amber line when the click output is missing`; `nothing moves when a song is picked` (the row's box and Record's box unchanged); `a signature change keeps the number`; `leaving the screen stops the click`; `row fits at 960 in both themes` (Ahoń in 6/8 included).
- [ ] **Step 2: Run** `npx playwright test e2e/metronome.spec.ts` → fail.
- [ ] **Step 3: Implement**, as the Q7 B row with Q9's gear and Q13 B's 6/8.
- [ ] **Step 4: Run** → pass; the whole Playwright suite still passes.
- [ ] **Step 5: Commit** — `Metronome: the row on the rehearsal screen`.

### Task 14: While recording

**Files:**
- Create: `ui/src/components/metronome/CountIn.tsx`, `EdgeLight.tsx`, `TakeRow.tsx`
- Modify: `ui/src/screens/Recording.tsx` (clock `:57-80`, `:221`; the footer)
- Test: `ui/e2e/metronome.spec.ts`

**Interfaces:**
- Consumes: `useMetronome()` (Task 13).
- Produces: `CountIn({ fontSize })` in the clock's place while `phase === "count"`; `EdgeLight()` (a fixed inset edge of `var(--primary)`, 7 px, 14 px on accent 2, fading over 150 ms; `aria-hidden`); `TakeRow()`; the clock shows `since_count_in_ms` when it is not null, else its own timer as now.
- The edge light covers less than 25 % of any 10° field at 960–1600 px windows (WCAG 2.3.1's general flash threshold: a thin edge only, no saturated red); Task 20 checks the measure.

- [ ] **Step 1: Write the failing tests**: `count-in digits then the edge light` (digits 1–4, then the edge lit on the next click); `6/8 counts to six`; `the clock starts after the count-in` (0:00 at the count-in's end, ±0.2 s); `the switch silences the click mid-take` (the line becomes "Click off. The tempo still goes into the take."); `no click, no light` for a take without a tempo.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement**, as Q8 B; nothing else on the screen moves (R21).
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `Metronome: the count-in and the beat while recording`.

### Task 15: Settings › Metronome

**Files:**
- Modify: `ui/src/screens/Settings.tsx` (a tab `metronome` after `audio`)
- Test: `ui/e2e/metronome.spec.ts`

**Interfaces:**
- Consumes: `ClickSettings` (Task 13), `set_click_device`, `set_click_channels`, `set_metronome_setting`, `list_output_devices` `click_unavailable`.
- Produces: the tab "Metronome", blurb "Where the click is heard, its sound, and the count-in": the four settings, then **Write the tempo into WAV files** with its hint, then "The same settings are behind the gear in the metronome row, on the rehearsal screen."

- [ ] **Step 1: Write the failing tests**: `the tab and the gear show the same settings` (a change in one seen in the other); `picking a sound plays a bar` (`metronome_preview` called); `the WAV checkbox is on by default and saves`; `a second ASIO card is not offered for the click` with its line.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `Metronome: its settings`.

### Task 16: A song's page, and Master in the player

**Files:**
- Create: `ui/src/components/metronome/SongTempoRow.tsx`, `MasterClick.tsx`, `MasterClickLane.tsx`
- Modify: `ui/src/components/SongPage.tsx`, `components/LaneControls.tsx` (`MasterControls` `extra` slot), `components/Timeline.tsx` (the sticky Master block), `components/TakePlayer.tsx`, `screens/Review.tsx`
- Test: `ui/e2e/metronome.spec.ts`

**Interfaces:**
- Consumes: `TempoField`, `SignatureSelect`, `TapButton` (Task 13); `count_tempo`, `set_song_tempo`, `player_set_click`, `Take.tempo/signature/click`.
- Produces: `SongTempoRow({ song, goes })` (saved at once; "count it from a take" menu, starred goes first, then newest; halve and double after counting; the count kept while the page is open so a signature picked after it converts); `MasterClick({ take })` (24 px, icon only, `aria-pressed`, tooltips per Global Constraints with "♪" for "bpm" in 6/8, disabled without a click); `MasterClickLane({ from, to, position, take })` (`clickLines(tempo, signature, from, to)`: bars only past 120 clicks in view, every fourth bar past 480; dimmed to 50 % while off; the playhead; the corner tag, with `NoteGlyph` for "bpm" in 6/8). The crop's notice on a click take adds where it now starts, from `crop_take`'s `start_sec` (spec Part 9).

- [ ] **Step 1: Write the failing tests**: `song page counts a tempo and halves it`; `song page tempo saves at once`; `master click plays with the take` (`player_set_click(true)`); `master stripes follow zoom`; `a take without the click`; `a cropped click take says where it starts`; `master lane lines up with the tracks at 960`; `stripes sit on the demo band's beats` (the fake's takes: first beat's stripe within 2 px of the waveform's first onset at full zoom).
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement**, as Q10 A and Q11 D.
- [ ] **Step 4: Run** → pass; the whole suite still passes.
- [ ] **Step 5: Commit** — `Metronome: a song's tempo in History, and the click on Master`.

### Task 17: The docs and the changelog

**Files:**
- Modify: `docs/using-it.md` (a new section "The metronome" after "Recording MIDI"; that section's "set the project to 120 bpm" line), `CHANGELOG.md` (Unreleased), `tests/docs_screenshots.py`
- Create: `docs/screenshots/metronome-row.png`, `docs/screenshots/metronome-master.png` (shot by the script)

- [ ] **Step 1: Write the section** with everything the spec's Docs part lists, the DAW paragraph from Part 9's list, and the 6/8 note (a DAW shows half the number).
- [ ] **Step 2: Shoot**: `python tests/docs_screenshots.py` → both files written; look at them.
- [ ] **Step 3: Commit** — `Metronome: the docs`.

### Task 18: reha.stream

**Files:**
- Modify: `site/src/content/index.ts` (step 2's two lines), `site/content/faq.md` (after the audio-interfaces answer), `site/content/features.md` (the tile), `site/src/page/Features.tsx` (`LAYOUT`), `site/src/page/pieces.tsx` (the row as a piece), `site/src/page/Story.tsx` if the step's frame needs Pałyn's tempo
- Test: `site/e2e` (existing suite)

- [ ] **Step 1: Write the failing site test** `metronome on the site`: the FAQ question "Is there a metronome?" with "its WAV and .mid files carry it"; the tile "A click for the drummer." with the row; story step 2's line "and its 128 bpm for the click."; every features row full at 1280 and 390 with the MIDI and sets tiles in.
- [ ] **Step 2: Run** `cd site && npx playwright test` → fail.
- [ ] **Step 3: Implement**, as `q12/src/patch_site.py` variant C with the FAQ's "WAV and"; place the tile so every row is full with MIDI's and the sets' tiles (spec "On reha.stream").
- [ ] **Step 4: Run** `npm test && npx playwright test` → pass; look at both widths and both themes.
- [ ] **Step 5: Commit** — `Metronome: on reha.stream`.

### Task 19: The selftest and the build

**Files:**
- Modify: `src/rehearsal_recorder/app.py` (selftest)
- Test: `python -m rehearsal_recorder --selftest`

- [ ] **Step 1: Add** `check("Click", …)`: renders a bar of each sound at 48000 and writes and reads back a WAV with an `acid` chunk: "3 sounds, a WAV with its tempo written and read back".
- [ ] **Step 2: Run** the selftest → pass. Commit — `Metronome: the selftest checks the click and the WAV's tempo`.

### Task 20: Checked by hand, reviewed, and the PR

**Files:**
- Create: `tools/click_alignment.py` (for a take folder recorded with the click's output cabled into an input: the median and worst distance of the recorded clicks from the grid, over the first and the last minute)

- [ ] **Step 1: Write `tools/click_alignment.py`** and its check in `tests/test_click.py` (`[8] The alignment tool`): a WAV with clicks 2 ms late on a 120 grid prints a median of 2 ms.
- [ ] **Step 2: Build the app from the branch**: the Release workflow by hand on this branch; both zips as the run's artifacts.
- [ ] **Step 3: The hand checks**, with the built app, by whoever has the devices:
  - macOS and Windows (ASIO): the click's output cabled into an input; a 1-minute and a 60-minute take; `python tools/click_alignment.py "<take folder>"` within 5 ms on the recording card and within 10 ms on another device (the laptop's jack), at the start and the end;
  - Reaper (Linux build, in the container) opening a click take's WAVs: the tempo read, nothing stretched at the song's tempo; Cubase, Pro Tools or Studio One if someone has one; the `.mid` beside them on the same bars;
  - the counter on the band's own click takes (their tempos are known): how many land on the tempo, half or double;
  - the edge light at 600 a minute measured against WCAG 2.3.1's general flash threshold.
  Anything that fails is fixed test first before going on. A driver whose reported latency misses the aim is brought to Alex with the numbers; a latency setting is not added without his word.
- [ ] **Step 4: Whole-branch review** on the most capable model, against the spec and this plan; fix every finding, minors included, each with a failing test first.
- [ ] **Step 5:** `python tests/run_all.py`, `cd ui && npm run build && npm test && npx playwright test`, `cd site && npm test && npx playwright test`, `python -m rehearsal_recorder --selftest` → all pass. Push once.
- [ ] **Step 6: Open the PR** with the repo's template if there is one, else Before / After / How; subscribe to its activity; drive CI green.
- [ ] **Step 7: Ask Alex before merging.** After the merge: memory and the metronome thread updated.
