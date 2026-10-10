# Recording MIDI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Any track records its audio, its MIDI or both; the notes are saved as a `.mid` beside the take's WAVs, drawn in the player and never played; reha.stream and the docs say so.

**Architecture:** A new package `src/rehearsal_recorder/midi/` holds everything about notes, one small module per job. Only `midi/ports.py` imports pylibremidi; only `midi/smf.py` and `midi/notes.py` import mido. A `MidiRig` keeps the rehearsal's ports open, feeds one writer thread, and hands a take's events to a `MidiRecorder`, which writes `.midraw` as it goes and a `.mid` at stop, placed on the audio's own clock (`midi/clock.py`, fed from the audio callback). The library keeps notes files beside the WAVs in `take_file`, apart from `tracks`, so no audio path ever opens a `.mid`. The interface gets a mode switch and a port line on each setup card, MIDI on the recording tiles, and notes lanes in the player.

**Tech Stack:** Python 3.12 (CI and builds), pylibremidi 5.4.3, mido 1.3.3, SQLAlchemy + Alembic on SQLite; React 19 + TypeScript + Tailwind in `ui/`; Vitest and Playwright on the fake bridge; the Vite site in `site/`.

**Spec:** `docs/superpowers/specs/2026-10-08-midi-recording-design.md` (decisions D1–D10, rules P1–P8, F1–F7, A1). Read it whole before the first task; every task argues from it.

**Approved looks:** the mockups Alex approved are working patches over the real UI. They are a reference for markup, classes and wording only, not code to copy (mockup-only flags such as `kind`, `noAudio` and the `MK_*` globals must not reach the app):
- setup cards, recording tiles and player lanes: `/mnt/project-files/midi/q6/src/ui.diff` with `mkMidi.tsx` beside it (ways `pair`, keys `switch`, gone `wait`, tempo `fixed`); mockups https://claude.ai/artifact/4jtAuT3ku5hE57psx9mKDv (Q4, the switch) and https://claude.ai/artifact/Rjh7aoutpPt6g1HccqzfB3 (Q5, a port not plugged in);
- the reha.stream tile: `/mnt/project-files/midi/q7/src/patch_site.py` and `/mnt/project-files/midi/q7/mkdata.js`, variant A; mockup https://claude.ai/artifact/VpBaviEkvB19w6khmYnB6F.

## Global Constraints

- Python check labels and Playwright test titles are Latin only (Windows CI prints cp1252): "Palyn", not "Pałyn"; no ✓, ★ or ▶ in a label. Test data may be in any script.
- `pylibremidi>=5.4.3` and `mido>=1.3.3` in `requirements.txt`; `requires-python` stays `>=3.10`.
- Only `midi/ports.py` imports `pylibremidi`. Only `midi/smf.py` and `midi/notes.py` import `mido`.
- A take's `tracks` list is audio files only, everywhere, as now. Notes files are a separate `notes` list.
- Every time on the Python side is `time.perf_counter_ns()` (on Python 3.12 Windows, `time.monotonic` ticks in 15 ms steps).
- The `.mid`: Standard MIDI File format 0, 960 ticks per beat, tempo 500000 µs (120 bpm) stated at tick 0, `MidiFile(charset="utf-8")`, tick = `round(seconds * 1920)` from the take's start, never summed from deltas.
- Kept in the `.mid`: channel messages (status 0x80–0xEF) and whole SysEx (`F0 … F7`). Everything else is skipped and counted, never fatal (F2).
- Ports open with `ignore_sysex=False`, `ignore_sensing=False`, `ignore_timing=True`.
- Old configs, bands, templates and rehearsals read as *Audio*; nothing saved before this changes meaning.
- Names are never cut or shown with an ellipsis on the setup cards, the port picker or its list (D5); at 960 px nothing is cut.
- Copy, exact (spec wording):
  - "At least one track has to record sound, so the takes can be heard." (A1)
  - "Keys has no MIDI port yet. Pick one, or set it to Audio." / plural "Keys, Synth have no MIDI port yet. Pick one, or set them to Audio." (P3)
  - "Drums and Keys both take notes from TD-17." (P2)
  - "“TD-17” is not connected. Drums records its notes from the moment it is plugged in." (D7)
  - "“TD-17” is in use by another app." (P5)
  - "Keys gets the same notes as Synth. Is it one instrument plugged in twice?" (P8)
  - "No MIDI ports. Plug one in." · "not connected" · "no notes" · "N notes" / "1 note" · "MIDI" · "Saved as .mid, not played here" · "No notes in this take" · "Not connected, no .mid saved"
  - Cloud hint: "Every track as recorded, untouched, and the notes as .mid — for opening in a DAW later."
  - Site: "Notes too, from an e-kit or a keyboard." / "A track records its audio, its MIDI or both. The notes are saved as .mid beside the audio, ready for your DAW."
- No layout jumps: a card's height and every control's place stay put when a check starts or stops, when ports come and go, and when notes arrive.
- Tests come first and are seen failing. Python suites are plain scripts with `ok(label, cond)` sections, as now.
- Commits end with the two attribution lines the session gives; no model names anywhere in the repo.
- No merge without Alex's word. The PR opens only after the final whole-branch review's findings, minors included, are fixed and pushed.

## Review Focus

The five things the spec implies but no rule of it tests, most likely to bite first. Each one's test is added to the task named.

1. **A take renamed, merged or put right by the names pass after it was recorded.** `rename_take` and `_put_name_right` call `library.update_take(tracks=…)`, which replaces every `take_file` row today, so the notes rows would vanish. Expected: the notes move with the folder and stay listed. Tests in Task 2 (library) and Task 12 (Api).
2. **The app dying in the first seconds of a take**, before a clock mark reached the disk. Expected: the draft still recovers a `.mid`, placed by the take's start time. Test in Task 8.
3. **The band edited between Check signal and Start**: a track renamed, its port changed, or set back to Audio. Expected: Start opens exactly what the final tracks say; notes go to the new name; no port stays open for a track that no longer takes notes. Test in Task 10.
4. **The disk refusing a `.midraw` write mid-take** (full disk, folder gone). Expected: the audio take goes on, the writer keeps draining, the error is said once in the app's log, and Stop keeps whatever `.mid` can still be made. Test in Task 9.
5. **No MIDI system at all** (pylibremidi missing from a build, or its observer refusing to start). Expected: every audio path works as before; a *Both* track records its audio and shows its port as not connected; the port picker says why there are no ports. Test in Task 10.

## What is checked before it is relied on, and by whom

- **On macOS CI (Task 1):** pylibremidi starts, sees a virtual port made after it started and one closed (P6), and its event times convert to `perf_counter_ns` within 5 ms. If CoreMIDI does not answer on the runner, Task 1 says so and P6 on macOS joins the hand checks; nothing is faked.
- **On Windows CI (Task 1):** pylibremidi imports, says which Windows MIDI systems it has, and starts its observer. There are no ports there, so hot-plugging on Windows is a hand check.
- **If libremidi fails these** in a way its own docs and issues do not fix, stop and bring it to Alex with what failed; switching to rtmidi2 changes how ports appear and how times are taken, so it is his call.
- **By hand, before the PR (Task 21):** on Windows, a USB MIDI device plugged in after Start (classic Windows MIDI, and Windows MIDI Services where installed) and a port held by another app (P5); on both systems, a click recorded as audio and as MIDI at once, at the start of a take and after an hour (F1, aim within 10 ms). These need the devices: whoever has them runs the built app from this branch.

## Files

New, in `src/rehearsal_recorder/midi/`:

| File | Its one job |
|---|---|
| `__init__.py` | The package's docstring: what lives where. |
| `ports.py` | The OS's MIDI inputs through pylibremidi: list, watch, open; times converted to `perf_counter_ns`. |
| `identity.py` | P1: a saved port found again among the ports there now. |
| `rules.py` | A track's mode; A1, P2, P3; where a notes lane sits among the audio lanes. |
| `state.py` | F6 and F7: what a port has set, per channel, and what is held. |
| `clock.py` | F1: OS time to seconds into the take, on the audio's clock. |
| `smf.py` | F2, F4: what a `.mid` can hold; writing one; cropping one. |
| `capture.py` | F3, F5, F7: one take's notes, `.midraw` while recording, `.mid` at stop; drafts. |
| `rig.py` | The rehearsal's ports: open, waiting (D7), hot-plug (P4), in use (P5), active sensing (F7), same notes twice (P8), live activity, the writer thread. |
| `notes.py` | Part 6: a `.mid` read back as lanes for the player. |

Changed: `layouts.py`, `audio/devices.py`, `audio/capture.py`, `audio/drafts.py`, `store/models.py`, `store/library.py`, new migration `0007_midi.py`, `api.py`, `cloud.py`, `diagnostics.py`, `mediaserver.py`, `app.py`, `packaging/rehearsal-recorder.spec`, `requirements.txt`, `.github/workflows/tests.yml`.

Tests: new suite `tests/test_midi.py` (the `midi/` modules on their own; added to `tests/run_all.py`), new `tests/fake_midi.py` (a fake port system both suites import), new `tests/midi_live.py` (the real library, CI only), new sections in `tests/test_engine.py` (the Api) and `tests/test_store.py` (migration 0007). Every existing suite blocks the real library before importing the app: `sys.modules["pylibremidi"] = None`, so a fresh `Api` sees no MIDI system unless a test hands it the fake.

Interface: `ui/src/lib/api.ts`, new `ui/src/lib/midi.ts` (+ `midi.test.ts`), new `ui/src/components/midi/` (`ModeSwitch.tsx`, `PortPicker.tsx`, `NotesCheck.tsx`, `MidiGlyph.tsx`, `NotesLane.tsx`, `NotesPlate.tsx`, `MidiTile.tsx`), `ui/src/components/NameField.tsx` (wrapping name field), `screens/Setup.tsx`, `screens/Recording.tsx`, `components/TrackTile.tsx`, `components/Timeline.tsx`, `components/LaneControls.tsx`, `components/TakePlayer.tsx`, `screens/Review.tsx`, `screens/Settings.tsx`, `components/ShareDialog.tsx`, `e2e/fake-bridge.js`, new `e2e/midi.spec.ts`.

Docs and site: `docs/using-it.md`, `CHANGELOG.md`, `tests/docs_screenshots.py`, `site/content/features.md`, `site/src/content/index.ts`, `site/src/page/Features.tsx`, `site/src/page/pieces.tsx`, new `site/src/stage/notes.js`.

## Shapes every task shares

```python
# A band member in config.json (layouts.band_member). Audio members carry neither key.
{"name": "Drums", "icon": "drums", "mode": "both",
 "midi_port": {"name": "TD-17", "device": "TD-17", "maker": "Roland", "id": "…"}}
# A saved port keeps only the fields the OS filled in; a bare string "TD-17" reads as {"name": "TD-17"}.

# A track on the setup screen and in the session (load_default_tracks, start_rehearsal):
{"name", "channel": int | None, "stereo": bool, "icon"?: str,
 "mode": "audio" | "both" | "midi", "midi_port": dict | None}
# mode "midi": channel None, stereo False.

# A take as the library returns it (_take_data), and stop_take's result:
"tracks": [{"name", "file"}],                          # audio only, as now
"notes": [{"name", "file", "port", "after"}],          # the .mid files
"notes_missing": [{"name", "port", "after"}],          # notes tracks with no .mid in this take (F5)
# "after": the audio track whose lane this notes lane follows (its own name for a Both track),
# or None to go first. Worked out in rules.lane_after from the band order.
```

---

### Task 1: The libraries, and the one module that talks to the ports

**Files:**
- Modify: `requirements.txt`
- Create: `src/rehearsal_recorder/midi/__init__.py`, `src/rehearsal_recorder/midi/ports.py`
- Modify: `src/rehearsal_recorder/app.py` (selftest)
- Modify: `packaging/rehearsal-recorder.spec:97` (hiddenimports)
- Modify: `.github/workflows/tests.yml` (one step in the `test` job)
- Create: `tests/midi_live.py`, `tests/fake_midi.py`
- Modify: `tests/test_engine.py:94`, `tests/test_store.py:32`, `tests/test_platform.py:27` (block the real library)

**Interfaces:**
- Produces, in `midi/ports.py`:
  - `@dataclass(frozen=True) class PortInfo: name: str; device: str = ""; maker: str = ""; id: str = ""` and `PortInfo.saved() -> dict` (the non-empty fields, `name` always).
  - `class PortBusy(Exception)`: a listed port the OS would not open.
  - `class PortSystem`: `name: str` ("CoreMIDI", "Windows MIDI Services", "Windows MIDI"); `inputs() -> list[PortInfo]`; `watch(on_change: Callable[[], None]) -> None`; `open(port: PortInfo, on_event: Callable[[int, bytes], None]) -> OpenPort`; `close() -> None`.
  - `class OpenPort`: `connected() -> bool`; `resync() -> None` (measures the time offset again); `close() -> None`.
  - `def open_system() -> tuple[PortSystem | None, str | None]`: the system, or None and why.
- Produces, in `tests/fake_midi.py`: `FakePortSystem` with the same methods plus `plug(PortInfo)`, `pull(name)`, `send(name, ns, data)`, `refuse: set[str]` (names whose open raises `PortBusy`).

- [ ] **Step 1: Add the dependencies.** In `requirements.txt`, after `certifi`, a commented block in the file's style: `pylibremidi>=5.4.3` (MIDI ports: told when one is plugged in or pulled out, and the OS's own time for each event; spec Part 9) and `mido>=1.3.3` (writing and reading `.mid` files). `pip install -e .`

- [ ] **Step 2: Read the installed `pylibremidi.pyi`** and note in `ports.py`'s docstring the constructor forms used (`Observer(conf, api_conf)`, `MidiIn(conf, api_conf)`), `PortInformation`'s fields and `InputConfiguration.timestamps` values (0 none, 1 relative, 2 absolute, 3 system monotonic; `include/libremidi/input_configuration.hpp`).

- [ ] **Step 3: Write `tests/midi_live.py`** (a plain script, exits non-zero on failure, not in `run_all.py`). On macOS:
  - `PortSystem` starts and `name == "CoreMIDI"`;
  - a `pylibremidi.MidiOut` virtual port named "Reha probe" made after `watch()` makes `on_change` fire within 2 s and `inputs()` list it; print every `PortInfo` field (the P1 field check for macOS);
  - `open()` it; send 100 note-ons 10 ms apart; all 100 arrive in order; each event's ns is within 5 ms of `perf_counter_ns()` taken just before its send;
  - close the virtual port: within 2 s `on_change` fires, `inputs()` drops it, the open port says `connected() is False`; make it again: seen again.
  - On Windows: `open_system()` answers; print `system.name`, `pylibremidi.available_apis()` and `inputs()`; the observer starts.
  - Elsewhere: print "no live MIDI check on this system" and exit 0.

- [ ] **Step 4: Run it to see it fail**: `python tests/midi_live.py` → `ModuleNotFoundError: rehearsal_recorder.midi`.

- [ ] **Step 5: Implement `midi/ports.py`.**
  - `open_system()`: import pylibremidi inside a try; any exception → `(None, "MIDI is not available: <reason>")`. On Windows try `WINDOWS_MIDI_SERVICES` first (its observer must start), else `WINDOWS_MM`; elsewhere the platform default. `name` from the API chosen.
  - Times: on CoreMIDI `timestamps = 2` (the packet's host time); on Windows `timestamps = 3` (stamped by the library with the same QPC clock `perf_counter_ns` reads). Each `OpenPort` keeps `offset = perf_counter_ns() - absolute_timestamp()`, taken as the tightest of 5 bracketed reads (`t1 = pc(); a = abs(); t2 = pc()`, keep the smallest `t2 - t1`, offset `(t1 + t2) // 2 - a`); `on_event(msg.timestamp + offset, bytes(msg.bytes))`.
  - The callback only calls `on_event`; nothing else runs on the library's thread.
  - `open()` raises `PortBusy(str(error))` when the OS refuses a port it listed.
  - `PortInfo.name` is `port_name`, else `display_name`; `id` is `str(port)` only on CoreMIDI until Step 3's output shows another system fills a stable one.

- [ ] **Step 6: Write `tests/fake_midi.py`** with `FakePortSystem` as in Interfaces; `send` calls the open port's `on_event(ns, data)` directly; `pull` makes that port's `connected()` False and calls every watcher.

- [ ] **Step 7: Block the real library in the three suites**: beside each `sounddevice` stub, `sys.modules["pylibremidi"] = None`. Run `python tests/run_all.py`: every suite still passes.

- [ ] **Step 8: Selftest and build.** In `app.selftest`, `check("MIDI", midi_up)` printing "<system name> up, N inputs" (fails the build when `open_system()` gives None). In the PyInstaller spec, add `"pylibremidi"` to `hiddenimports`. In `tests.yml`'s `test` job, after "Run every suite": `- name: The MIDI library on this machine` / `run: python tests/midi_live.py`.

- [ ] **Step 9: Push the branch and read both runs.** macOS: Step 3's checks pass and the printed fields are copied into `ports.py`'s docstring. Windows: the printed systems are copied there too. If CoreMIDI does not answer on the runner, record that in the docstring and in Task 21's hand list.

- [ ] **Step 10: Commit** — `MIDI: the libraries, and the one module that talks to the ports`.

### Task 2: The band and the library keep modes, ports and notes files (migration 0007)

**Files:**
- Modify: `src/rehearsal_recorder/layouts.py` (`band_member`, `remember`, `for_device`)
- Create: `src/rehearsal_recorder/store/migrations/versions/0007_midi.py`
- Modify: `src/rehearsal_recorder/store/models.py` (`Track`, `TakeFile`)
- Modify: `src/rehearsal_recorder/store/library.py` (`create_rehearsal`, `import_rehearsal`, `_rehearsal_data`, `_files`, `_take_data`, `add_take`, `update_take`)
- Create: `src/rehearsal_recorder/midi/rules.py` (only `mode_of`, `records_audio`, `records_notes`, `lane_after` here; Task 3 adds the rest)
- Test: `tests/test_engine.py` (new section), `tests/test_store.py` (new section)

**Interfaces:**
- Produces: `rules.mode_of(track) -> str` ("audio" for a missing or unknown mode); `rules.records_audio(track) -> bool`; `rules.records_notes(track) -> bool`; `rules.port_ref(value) -> dict | None` (a saved port: a str becomes `{"name": s}`, a dict keeps its non-empty `name`, `device`, `maker`, `id`, anything else or no name is None); `rules.lane_after(band: list[dict], audio_names: set[str], name: str) -> str | None`.
- Produces: `layouts.for_device` gives every track `mode` and, when set, `midi_port`; a *MIDI* member gets `channel: None` and takes no input from anyone.
- Produces: `Library.add_take(folder, take)` accepts `take["notes"] = [{"name", "file"}]`; `Library.update_take(..., tracks=None, notes=None)` replaces only the kind it is given; takes come back with `tracks`, `notes`, `notes_missing` as in *Shapes*; `_rehearsal_data` tracks are `{"name", "channel", "mode", "midi_port"}` (`midi_port` the port's name).

- [ ] **Step 1: Write the failing layouts checks** in `tests/test_engine.py`, a new section `[63] A track records audio, both or MIDI`:

```python
port = {"name": "TD-17", "device": "TD-17", "maker": "Roland"}
card = {"name": "Interface", "host_api": "CoreAudio"}
ok("a member keeps its mode and port",
   layouts.band_member({"name": "Drums", "channel": 1, "icon": "drums", "mode": "both",
                        "midi_port": port})
   == {"name": "Drums", "icon": "drums", "mode": "both", "midi_port": port})
ok("an audio member saves neither",
   layouts.band_member({"name": "Bass", "channel": 2, "mode": "audio", "midi_port": port})
   == {"name": "Bass"})
ok("a port saved as a bare name is a port",
   layouts.band_member({"name": "K", "mode": "midi", "midi_port": "TD-17"})["midi_port"]
   == {"name": "TD-17"})
placed = layouts.for_device(
    [{"name": "Keys", "mode": "midi", "midi_port": {"name": "Launchkey Mini MK3"}},
     {"name": "Bass"}], [], card, 2)
ok("a MIDI member gets no input", placed[0]["channel"] is None and placed[0]["mode"] == "midi")
ok("and takes none from the others", placed[1]["channel"] == 1)
ok("an old member reads as audio", placed[1]["mode"] == "audio" and "midi_port" not in placed[1])
ok("remember keeps no input for a MIDI member",
   "Keys" not in layouts.remember([], card, [{"name": "Keys", "channel": 3, "mode": "midi"}])[0]["inputs"])
```

- [ ] **Step 2: Write the failing store checks** in `tests/test_store.py`, section `[16] MIDI tracks and notes files (migration 0007)`:
  - a library made at 0006 with a rehearsal, one take with two WAV rows, a marker and a cloud copy, upgraded to head: every track reads `mode == "audio"`; the take, both files, the marker and the cloud copy are all still there;
  - `create_rehearsal` with, in this order, `{"name": "Drums", "channel": 1, "mode": "both", "midi_port": {"name": "TD-17"}}`, `{"name": "Bass", "channel": 3}` and `{"name": "Keys", "channel": None, "mode": "midi", "midi_port": {"name": "Launchkey Mini MK3"}}`; `add_take` with `tracks` Drums.wav and Bass.wav and `notes` Drums.mid: `take["tracks"]` names are `["Drums", "Bass"]`; `take["notes"] == [{"name": "Drums", "file": <abs>, "port": "TD-17", "after": "Drums"}]`; `take["notes_missing"] == [{"name": "Keys", "port": "Launchkey Mini MK3", "after": "Bass"}]`;
  - Review Focus 1: `update_take(folder, n, tracks=<the WAVs at new paths>)` leaves `notes` as it was; `update_take(..., notes=[…new path…])` moves only the notes;
  - downgrade to 0006 and up again: every take, file row of kind audio and marker survives; notes rows and MIDI-only tracks are gone after the downgrade (an old app must not read a `.mid` as a track).
  - `compare_metadata` (the suite's existing drift check) finds nothing.

- [ ] **Step 3: Run both suites to see them fail**: `python tests/test_engine.py`, `python tests/test_store.py`.

- [ ] **Step 4: Implement.**
  - `layouts.band_member`: add `mode` when it is "both" or "midi", and then `midi_port` through `rules.port_ref` when there is one.
  - `layouts.remember`: skip tracks whose `mode_of` is "midi". `layouts.for_device`: a "midi" member is placed with `channel None`, `stereo False`, and is skipped by both placing loops; every output track carries `mode` and, when set, `midi_port`.
  - Migration `0007_midi.py`, its docstring saying why `track` may be rebuilt and `take` may not: nothing has a foreign key to `track`, so batch mode's DROP TABLE cascades into nothing (unlike 0006's tables).
    - `upgrade`: `with op.batch_alter_table("track")`: `channel` nullable; add `mode` String NOT NULL `server_default "audio"`; add `midi_port` String nullable. Then `ALTER TABLE take_file ADD COLUMN kind VARCHAR NOT NULL DEFAULT 'audio'`.
    - `downgrade`: `DELETE FROM take_file WHERE kind = 'midi'`; `ALTER TABLE take_file DROP COLUMN kind`; `DELETE FROM track WHERE channel IS NULL`; batch: drop `midi_port`, `mode`, `channel` NOT NULL.
  - `models.Track`: `channel: Mapped[int | None]` nullable; `mode: Mapped[str] = mapped_column(String, default="audio", server_default="audio")`; `midi_port: Mapped[str | None]`. `models.TakeFile.kind` likewise, default "audio".
  - `library`: `_files(folder, files, kind)`; `add_take` writes `tracks` as kind audio and `notes` as kind midi, positions in one sequence; `update_take(tracks=…)` replaces only audio rows and `notes=…` only midi rows; `_take_data` splits rows by kind and works out `port`, `after` and `notes_missing` from `take.rehearsal.tracks` (band order) with `rules.lane_after`; `create_rehearsal` and `import_rehearsal` store `mode` and the port's name.
  - `rules.lane_after(band, audio_names, name)`: `name` itself when it is in `audio_names`; else the nearest track before it in `band` that is in `audio_names`; else None.

- [ ] **Step 5: Run both suites**: all pass, old sections included.

- [ ] **Step 6: Commit** — `MIDI: the band, the database and a take keep modes, ports and notes files`.

### Task 3: What stops Start (A1, P2, P3)

**Files:**
- Modify: `src/rehearsal_recorder/midi/rules.py`
- Modify: `src/rehearsal_recorder/audio/devices.py:496` (`channels_available`)
- Create: `tests/test_midi.py` (the suite; add `"test_midi.py"` to `SUITES` in `tests/run_all.py`)

**Interfaces:**
- Consumes: `rules.mode_of`, `records_audio`, `records_notes` (Task 2).
- Produces: `rules.notes_problem(tracks: list[dict]) -> str | None` (A1, then P3, then P2). `devices.channels_available(device_index, tracks)` asks `notes_problem` first, then checks only the tracks that record audio.

- [ ] **Step 1: Start `tests/test_midi.py`** with the house header (path to `src`, `sounddevice` stub, `sys.modules["pylibremidi"] = None`, `ok`, `main`) and section `[1] What stops Start`:

```python
gtr = {"name": "Gtr", "channel": 1}
keys = {"name": "Keys", "mode": "midi", "channel": None, "midi_port": {"name": "Launchkey Mini MK3"}}
ok("all on MIDI is refused", notes_problem([keys]) ==
   "At least one track has to record sound, so the takes can be heard.")
ok("a MIDI track with no port is refused", notes_problem([gtr, {**keys, "midi_port": None}]) ==
   "Keys has no MIDI port yet. Pick one, or set it to Audio.")
ok("and two", notes_problem([gtr, {**keys, "midi_port": None},
                             {**keys, "name": "Synth", "midi_port": None}]) ==
   "Keys, Synth have no MIDI port yet. Pick one, or set them to Audio.")
drums = {"name": "Drums", "mode": "both", "channel": 2, "midi_port": {"name": "TD-17"}}
ok("two tracks on one port are refused",
   notes_problem([gtr, drums, {**keys, "midi_port": {"name": "TD-17"}}]) ==
   "Drums and Keys both take notes from TD-17.")
ok("a port picked but not plugged in stops nothing", notes_problem([gtr, drums, keys]) is None)
ok("an old band is fine", notes_problem([gtr, {"name": "Bass", "channel": 2}]) is None)
ok("the card check passes a MIDI track with no input",
   channels_available(0, [gtr, keys]) is None)
ok("and says A1 before anything about inputs", channels_available(0, [keys]).startswith("At least one"))
```

- [ ] **Step 2: Run** `python tests/test_midi.py` → fails on the import.

- [ ] **Step 3: Implement `notes_problem`** (two tracks share a port when their ports' `name` is equal) and the first lines of `channels_available`: `problem = notes_problem(tracks)`; return it when set; then `tracks = [t for t in tracks if records_audio(t)]` before everything that is there now.

- [ ] **Step 4: Run** `python tests/run_all.py` → all pass.

- [ ] **Step 5: Commit** — `MIDI: what stops Start, said as the spec says it`.

### Task 4: A saved port found again, and a device's ports in order (P1, P7)

**Files:**
- Create: `src/rehearsal_recorder/midi/identity.py`
- Test: `tests/test_midi.py`

**Interfaces:**
- Consumes: `ports.PortInfo` (Task 1).
- Produces: `identity.bare_name(name: str) -> str`; `identity.find_port(saved: dict, ports: list[PortInfo]) -> tuple[PortInfo | None, bool]` (the port, and whether two were alike and none was picked); `identity.in_order(ports) -> list[PortInfo]` (by device, and within a device its playing port first: a port whose name has "DAW", "MIDIIN2", "InControl", "Control" or "Ctrl" in it, any case, goes after the device's others; otherwise the OS's order).

- [ ] **Step 1: Write the failing section `[2] A saved port found again`**:

```python
P = PortInfo
here = [P("TD-17", "TD-17", "Roland", "1001"), P("Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3", "Novation")]
ok("found by its id first", find_port({"name": "renamed", "id": "1001"}, here)[0] is here[0])
ok("then by its name", find_port({"name": "TD-17"}, here)[0] is here[0])
ok("then by its name as Windows renumbers it", find_port({"name": "TD-17 1"}, [P("TD-17 2")])[0].name == "TD-17 2")
ok("and with a second device's 2- in front", find_port({"name": "2- TD-17"}, [P("TD-17")])[0].name == "TD-17")
ok("two alike are not guessed between", find_port({"name": "TD-17"}, [P("TD-17"), P("TD-17")]) == (None, True))
ok("nor two alike once the numbers are taken off", find_port({"name": "TD-17"}, [P("TD-17 1"), P("2- TD-17 2")]) == (None, True))
ok("one not there is just missing", find_port({"name": "TD-17"}, []) == (None, False))
ok("bare_name takes off both", bare_name("2- TD-17 1") == "TD-17")
lk = [P("Launchkey Mini MK3 DAW Port", "Launchkey Mini MK3"), P("TD-17", "TD-17"),
      P("Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3")]
ok("a keyboard's playing port comes before its DAW port",
   [p.name for p in in_order(lk)] ==
   ["Launchkey Mini MK3 MIDI Port", "Launchkey Mini MK3 DAW Port", "TD-17"])
ok("and Windows' MIDIIN2 after the first",
   [p.name for p in in_order([P("MIDIIN2 (Launchkey Mini MK3)", "Launchkey Mini MK3"),
                              P("Launchkey Mini MK3", "Launchkey Mini MK3")])][0] == "Launchkey Mini MK3")
```

- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement.** `bare_name` strips `^\d+-\s*` and `\s+\d+$`. `find_port`: an `id` match (both non-empty) wins; then exact `name` (one → it; more → `(None, True)`); then `bare_name` equal (one → it; more → `(None, True)`); else `(None, False)`.
- [ ] **Step 4: Run** `python tests/test_midi.py` → pass.
- [ ] **Step 5: Commit** — `MIDI: a saved port is found again after a replug, a device's playing port first`.

### Task 5: The `.mid` file (F2, F4)

**Files:**
- Create: `src/rehearsal_recorder/midi/smf.py` (writing only here; Task 12 adds `crop_mid`)
- Modify: `src/rehearsal_recorder/app.py` (selftest)
- Test: `tests/test_midi.py`

**Interfaces:**
- Produces: `smf.TICKS_PER_BEAT = 960`, `smf.TEMPO = 500_000`, `smf.TICKS_PER_SEC = 1920`; `smf.storable(data: bytes) -> bool`; `smf.write_mid(path, *, track_name: str, port_name: str, start: list[bytes], events: list[tuple[float, bytes]]) -> int` (how many events were skipped; `events` in time order, seconds ≥ 0); `smf.read_events(path) -> tuple[dict, list[tuple[float, bytes]]]` (the metas `{"track_name", "device_name"}` and every channel and SysEx event with its seconds), for Tasks 12 and 14.

- [ ] **Step 1: Write the failing section `[3] The .mid file`.** `import mido` in the test to read back. With

```python
events = [(0.0, b"\x99\x24\x64"), (0.1, b"\x89\x24\x00"), (0.5, b"\xB9\x04\x5A"),
          (1.0, b"\xF0\x41\x10\x42\xF7"), (1.2, b"\xF8"), (1.3, b"\xFE"), (1.4, b"\xFF"),
          (1.5, b"\xF2\x00\x10"), (1.6, b"\xF1\x20"), (1.7, b"\xF6"), (1.8, b"\x90\x40"),
          (1.9, b"\xF0\x41\x10"), (2.0, b"\x99\x26\x50")]
skipped = write_mid(path, track_name="Pałyn", port_name="TD-17", start=[b"\xB9\x04\x5A"], events=events)
```
  check: `mid.type == 0 and mid.ticks_per_beat == 960`; a `set_tempo` of 500000 at tick 0; `track_name == "Pałyn"` read back with `charset="utf-8"`, and one more file named "Барабаны"; `device_name == "TD-17"`; the channel and SysEx messages in order are control_change (the start), note_on, note_off, control_change, sysex, note_on; `skipped == 8` (clock, sensing, reset, song position, time code, tune request, a cut note, a cut SysEx); the notes on channel 9; a note at 3600.0005 s on tick 6912001; 100000 events 0.037 s apart each on `round(t * 1920)`; `read_events` gives back the same seconds within 1/1920.

- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement.** `storable`: status 0x80–0xEF with 3 bytes (2 for 0xC0–0xDF) and data bytes < 0x80; or `F0 … F7` with every byte between < 0x80. Messages through `mido.Message.from_bytes` and `mido.Message("sysex", data=…)`, each in its own try (a failure is one more skipped). Metas `track_name`, `device_name`, `set_tempo` at tick 0, then the start messages at tick 0, then the events; `delta = tick - previous_tick` with `tick = round(t * TICKS_PER_SEC)`. Save with `MidiFile(type=0, ticks_per_beat=960, charset="utf-8")`.
- [ ] **Step 4: Selftest**: `check("MIDI files", …)` writes a two-note `.mid` named "Pałyn" to a temp folder and reads it back: "mido <version>, a .mid written and read back".
- [ ] **Step 5: Run** `python tests/test_midi.py` and `python -m rehearsal_recorder --selftest` → pass.
- [ ] **Step 6: Commit** — `MIDI: a .mid holds everything a .mid can, named in UTF-8`.

### Task 6: What a port has set, and what is held (F6, F7)

**Files:**
- Create: `src/rehearsal_recorder/midi/state.py`
- Test: `tests/test_midi.py`

**Interfaces:**
- Produces: `class PortState` with `feed(data: bytes) -> None`, `start_messages() -> list[bytes]`, `releases() -> list[bytes]`, `copy() -> PortState`. Start messages per channel, channels ascending: CC0, CC32, program, the other controllers by number, pitch bend, channel pressure. Releases: a note-off (`0x80|ch, note, 0`) per key held, in the order pressed, then CC64, CC66, CC67 to 0 for each that is down (value ≥ 64).

- [ ] **Step 1: Write the failing section `[4] Where everything was when the take started`**:

```python
s = PortState()
for m in [b"\xB0\x00\x01", b"\xB0\x20\x02", b"\xC0\x05", b"\xB9\x04\x5A", b"\xE0\x00\x50", b"\xD0\x30",
          b"\xB0\x07\x64", b"\xB0\x79\x00", b"\xB0\x58\x10", b"\xB0\x06\x01", b"\xB0\x26\x01",
          b"\xB0\x62\x01", b"\xB0\x40\x7F", b"\x90\x3C\x40", b"\xA9\x31\x7F"]:
    s.feed(m)
start = s.start_messages()
ok("the bank comes before the program",
   start.index(b"\xB0\x00\x01") < start.index(b"\xB0\x20\x02") < start.index(b"\xC0\x05"))
ok("the hi-hat, volume, sustain, bend and pressure are set",
   all(m in start for m in [b"\xB9\x04\x5A", b"\xB0\x07\x64", b"\xB0\x40\x7F", b"\xE0\x00\x50", b"\xD0\x30"]))
ok("commands and parameter numbers are not repeated",
   not any(m[0] & 0xF0 == 0xB0 and m[1] in (0x79, 0x58, 0x06, 0x26, 0x62) for m in start))
ok("nothing about keys: no note, no choke", not any(m[0] & 0xF0 in (0x90, 0xA0) for m in start))
ok("only what arrived", not any(m[0] & 0x0F == 1 for m in start))
ok("a held key is let go", s.releases()[0] == b"\x80\x3C\x00")
ok("and the sustain let up", b"\xB0\x40\x00" in s.releases())
s.feed(b"\x90\x3C\x00")
ok("a note-on at velocity 0 is a release", b"\x80\x3C\x00" not in s.releases())
```

- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement** (never kept as state: CC 120–127, 88, 6, 38, 96–101; a key struck twice and not let go is one release).
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `MIDI: the state at a take's start, and nothing left hanging`.

### Task 7: The audio's own clock (F1)

**Files:**
- Create: `src/rehearsal_recorder/midi/clock.py`
- Modify: `src/rehearsal_recorder/audio/capture.py` (`AudioRecorder.__init__`, `_callback`, `start`)
- Test: `tests/test_midi.py`, `tests/test_engine.py` (the recorder)

**Interfaces:**
- Produces: `clock.MARK_EVERY_SEC = 1.0`; `class AudioClock(samplerate: int)` with attributes `latency_sec: float` and `started_ns: int | None`, and `mark(arrival_ns: int, frames_end: int, frames: int, age_sec: float | None) -> None`, `marks() -> list[tuple[int, int]]` (ns of a block's first frame, that frame's index; one per second of frames, plus the latest), `to_seconds(ns: int) -> float`; `clock.fit(marks, samplerate, started_ns) -> Callable[[int], float]` (pure, shared with recovery); `clock.save_line(mark) -> str` and `clock.load(path) -> list[tuple[int, int]]` (`"<ns> <frame>\n"` lines; a bad line is skipped).
- Produces: `AudioRecorder(device_index, samplerate, tracks, out_dir, bit_depth=16, clock=None, notes=())`; with a clock, every callback marks it and `start()` sets `clock.started_ns` before the stream opens and `clock.latency_sec` from the open stream; `notes` (`[{"file", "port"}]`) is written into `take.json` beside `tracks`.

- [ ] **Step 1: Write the failing section `[5] On the audio's own clock`**:

```python
SR = 48000
c = AudioClock(SR); c.latency_sec = 0.010
T0, rate = 5_000_000_000, SR * 1.0002          # an interface 200 ppm fast
rnd = random.Random(7)
for k in range(1, 3600 * SR // 1024):
    end = k * 1024
    c.mark(T0 + int(end / rate * 1e9) + 10_000_000 + rnd.randint(-2_000_000, 2_000_000), end, 1024, None)
ok("a note an hour in lands on its sample", abs(c.to_seconds(T0 + 3_600_000_000_000) - 3600 * 1.0002) < 0.001)
ok("and one at the start on time 0", abs(c.to_seconds(T0)) < 0.001)
ok("one mark a second is kept", 3590 < len(c.marks()) < 3610)
a = AudioClock(SR); a.mark(T0 + 21_333_333 + 12_000_000, 1024, 1024, 0.012 + 1024 / SR)
ok("a driver's own capture time is used", abs(a.marks()[0][0] - T0) < 100_000)
b = AudioClock(SR); b.latency_sec = 0.005; b.mark(T0 + 21_333_333 + 5_000_000, 1024, 1024, -3.0)
ok("a capture time that makes no sense is not", abs(b.marks()[0][0] - T0) < 100_000)
z = AudioClock(SR); z.started_ns = T0
ok("with no mark yet, from when the take started", z.to_seconds(T0 + 2_000_000_000) == 2.0)
```
  plus a save/load round trip of 3600 marks, and a file with one torn last line loading the rest.

- [ ] **Step 2: Add to `tests/test_engine.py`** (section `[64] The recorder marks the clock`): an `AudioRecorder(0, SR, tracks, dir, clock=c, notes=[{"file": "Keys", "port": "Launchkey Mini MK3"}])`, `_raw_files` opened by hand as section [7c] does; `_callback(block, 256, None, None)` leaves one mark whose frame is 0 and whose ns lies within `[before - 10 ms - 256/SR, after]` of `perf_counter_ns()` around the call; `_write_record()` puts `"notes": [{"file": "Keys", "port": "Launchkey Mini MK3"}]` in `take.json`; with `clock=None` nothing changes (section [7c] still passes).
- [ ] **Step 3: Run both suites to see them fail.**
- [ ] **Step 4: Implement.** `mark`: `age_sec` is how old the block's first frame is when the callback runs, as the driver says it (`time_info.currentTime - time_info.inputBufferAdcTime`). When `0 <= age_sec < 1`, that frame was at `arrival_ns - age_sec*1e9`; otherwise at `arrival_ns - (frames/samplerate + latency_sec)*1e9`. Keep the first mark, then one whenever its frame is ≥ `MARK_EVERY_SEC * samplerate` past the last kept, and always the latest. `fit`: least squares of ns on frame (centred, float64) over ≥ 2 marks spanning ≥ 0.5 s; one mark → nominal rate through it; none → `(ns - started_ns) / 1e9`. In `AudioRecorder._callback`, before `_take_block`: `self._clock.mark(time.perf_counter_ns(), self._frames_written + frames, frames, age)` with `age` read from `time_info` in a try (a missing or zero field → None). Nothing here allocates beyond one tuple a second.
- [ ] **Step 5: Run both suites** → pass, [4b] and [7c] included.
- [ ] **Step 6: Commit** — `MIDI: notes placed on the audio's own clock, drift included`.

### Task 8: One take's notes on disk (F3, F5, F7, drafts)

**Files:**
- Create: `src/rehearsal_recorder/midi/capture.py`
- Modify: `src/rehearsal_recorder/audio/drafts.py` (`has_audio`, `describe`, `finalize`)
- Test: `tests/test_midi.py`, `tests/test_engine.py` (drafts)

**Interfaces:**
- Consumes: `PortState` (Task 6), `AudioClock`, `fit`, `load` (Task 7), `write_mid` (Task 5).
- Produces: `capture.MIDRAW_SUFFIX = ".midraw"`, `capture.CLOCK_FILE = "take.clock"`; `class MidiRecorder(out_dir, anchor: AudioClock, tracks: list[dict], states: dict[str, PortState])` (`tracks`: `[{"name", "port"}]`, every notes track of the take) with `present(name, ns)`, `feed(name, ns, data)`, `gone(name, ns)`, `flush()`, `stop(duration_sec) -> list[dict]` (`[{"name", "file", "port"}]`), `abandon()`; `capture.finish_draft(take_dir, duration_sec) -> list[dict]`.
- File names: `<AudioRecorder.safe_name(track name)>.midraw` and `.mid`, so a Both track's `.mid` has its WAV's name (spec Part 1).
- `.midraw` lines: `t <started_ns>` first, then `s <hex>` (the state at the start), `n <ns> <hex>` (an event), `g <ns>` (the port went at ns). `take.clock` gets each kept clock mark as it is made; both are fsynced with the audio's 30-second flush.

- [ ] **Step 1: Write the failing section `[6] A take's notes on disk`** with an `AudioClock` whose `started_ns = T0` and no marks, `tracks` Drums (TD-17), Keys (Launchkey Mini MK3), Synth (Gone), `states={"Drums": <CC4=90 on ch 10>}`, `present` for Drums and Keys at `T0`:
  - feed Drums: note-on 36 at `T0 - 50 ms` and its note-off at `T0 + 20 ms`; 38 on at +1.0 s and off at +1.1 s; 42 on at +2.0 s; `flush()` → `Drums.midraw` is not empty;
  - `stop(3.0)`: no `.midraw` and no `take.clock` left; files named Drums and Keys only (F5: Synth never appeared, no file);
  - Keys.mid has its metas and no events (F5: there, but silent);
  - Drums.mid starts with CC4=90 on channel 9 at tick 0, has no note 36 at all, 38 at ticks 1920–2112, and 42 released at tick 5760 (F7 at stop);
  - a second recorder: 42 on at +2.0 s, `gone("Drums", T0 + 2.5 s)`, `present` again at +2.8 s, 40 at +2.9 s: one file, 42 released at tick 4800, 40 there;
  - a burst of 20000 note-ons and offs within one second: all 40000 in the `.mid`;
  - Review Focus 2: `abandon()`, delete `take.clock`, `finish_draft(dir, 3.0)` gives the same notes as `stop` would, from `t`.
- [ ] **Step 2: Drafts, in `tests/test_engine.py`** (section `[65] A crashed take with notes`): a drafts folder with only `Keys.midraw` and `take.json` counts as audio for `has_audio` (a take whose only recording is notes is not empty); `describe` lists `"notes": ["Keys"]`; with a `Drums.raw` beside it, `finalize` returns `notes` `[{"name": "Keys", "file": …/Keys.mid}]` and the `.mid` exists.
- [ ] **Step 3: Run both suites to see them fail.**
- [ ] **Step 4: Implement.** Conversion (shared by `stop` and `finish_draft`): parse; `PortState` from `s` lines; events before time 0 feed the state, and a key struck before 0 is left out with its release; events from 0 to the end are kept and also fed to a running state; at each `g`, the running state's releases at that time; at the end, its releases at `duration_sec`; events at or past the end dropped. Port names from `take.json`'s `notes`, else the file stem.
- [ ] **Step 5: Run** → pass.
- [ ] **Step 6: Commit** — `MIDI: a take's notes written as they are played, a .mid at stop, and drafts`.

### Task 9: The rehearsal's ports (D7, P4, P5, P8, F7's active sensing)

**Files:**
- Create: `src/rehearsal_recorder/midi/rig.py`
- Test: `tests/test_midi.py`

**Interfaces:**
- Consumes: `PortSystem`/`FakePortSystem`, `PortBusy` (Task 1); `find_port` (Task 4); `records_notes`, `port_ref` (Task 2); `PortState` (Task 6); `MidiRecorder` (Task 8).
- Produces: `rig.SENSING_TIMEOUT_SEC = 0.3`, `rig.TICK_SEC = 0.25`, `rig.ECHO_MS = 5`, `rig.ECHO_HITS = 4`; `class MidiRig(system, error=None, threads=True, now_ns=time.perf_counter_ns)` with:
  - `ports() -> dict` — `{"system": name | None, "ports": [PortInfo.saved() + {"notes": int}], "error": str | None}`, in `identity.in_order`; `notes` counts what each port sent during the check (P7);
  - `use(tracks, check=False) -> None` — opens the port of every track that records notes, keeps ports already open for the same track and port, closes the rest; with `check=True` it also listens to the other ports of each picked port's device (same non-empty `device`), only to count their notes, so the picker can show which of a keyboard's ports is being played (P7); they close when the check ends or the rehearsal starts;
  - `refresh() -> None` — reads the port list again (Look again);
  - `reset_counts() -> None`;
  - `activity() -> dict` — `{track: {"vel": 0..1 loudest since last read, "notes": int, "connected": bool, "state": "ok" | "missing" | "in_use" | "ambiguous" | "none", "echo"?: track}}`;
  - `begin_take(out_dir, anchor) -> None`; `end_take(duration_sec) -> list[dict]`; `abandon_take() -> None`;
  - `release() -> None`; `shutdown() -> None`;
  - `drain() -> None` and `tick() -> None` — the writer's and the watcher's loop bodies, which tests call directly; with `threads=True` the rig runs them on its own two threads.

- [ ] **Step 1: Write the failing section `[7] The rehearsal's ports`** on a `FakePortSystem`, `threads=False`, `now_ns` from a list the test moves:
  - `use([drums on TD-17 (plugged), keys on Launchkey (not)])`: Drums `state "ok"`, `connected`; Keys `"missing"`;
  - a note-on velocity 100 from TD-17 then `drain()`: Drums `notes == 1`, `vel` 100/127; read again: `vel == 0`;
  - D7: `begin_take`; plug Launchkey; `tick()`; a note from it; `drain()`; `end_take(3.0)` lists Keys; a port pulled mid-take and plugged back gives one file with its held notes released at the pull;
  - F6: CC4=90 sent between takes; the next take's `.mid` starts with it;
  - P5: `refuse` TD-17 → `"in_use"`, `connected False`, Start not stopped (nothing raises);
  - P1: two ports both named TD-17 → `"ambiguous"`;
  - F7: active sensing every 250 ms, then none for 400 ms, `tick()` → `"missing"` and the held note released at the last sensing; sensing again → `"ok"`;
  - P8: Keys and Synth on two ports receiving the same note and velocity within 2 ms, four times → Synth's activity has `echo == "Keys"`, Keys' none; 6 ms apart → no echo;
  - P7: `use([keys on "Launchkey Mini MK3 DAW Port"], check=True)` with the device's MIDI Port also there; notes played on the MIDI Port → `ports()` gives it `notes > 0` and the DAW Port 0; `use(..., check=False)` closes the MIDI Port again;
  - counts start again at `begin_take` and at `reset_counts()`; the recorder is flushed every `capture.FLUSH_INTERVAL_SEC` of ticks;
  - Review Focus 4: a recorder whose `feed` raises `OSError` → `drain()` goes on, counts go on, `end_take` returns what it can, one log line;
  - `use()` with Keys set back to Audio closes Keys' port;
  - 10000 events from one port then `drain()`: all counted.
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement.** One `queue.SimpleQueue` of `(track, ns, data)`; each open port's `on_event` only puts on it. The writer updates the track's `PortState`, counts note-ons with velocity > 0, keeps the loudest, notes when sensing last came, checks echoes while no take is recording, and hands the event to the recorder when one is. `tick()` every `TICK_SEC`: sensing timeouts; every fourth tick the port list is diffed (observer callbacks also call it) — waiting tracks are opened, vanished ones get `recorder.gone(name, last_heard_ns)`; every fourth tick `resync()` on each open port; the recorder flushed every `FLUSH_INTERVAL_SEC` (30 s, `audio/capture.py`). `end_take` puts a marker on the queue and waits for the writer to pass it (or drains itself with `threads=False`), so every event that arrived before Stop is written.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** — `MIDI: the rehearsal's ports, waiting, coming and going`.

### Task 10: The Api, before a take (ports, check, Start, Finish)

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`__init__`, `shutdown:517`, `under_the_hood:700`, `bug_report:776`, `rescan_devices:1195`, `start_monitor:1303`, `stop_monitor:1340`, `recording_health:1375`, `start_rehearsal:1399`, `finish_rehearsal:1682`, `_channels_of:419`; new `list_midi_ports`, `midi_activity`)
- Modify: `src/rehearsal_recorder/mediaserver.py:37` (`POLLABLE`)
- Modify: `src/rehearsal_recorder/diagnostics.py` (`report_text`)
- Test: `tests/test_engine.py`

**Interfaces:**
- Consumes: `MidiRig` (Task 9), `open_system` (Task 1), `notes_problem` via `channels_available` (Task 3).
- Produces: module-level `api.open_midi_system = ports.open_system` and `api.MIDI_THREADS = True`, which tests replace; `Api.list_midi_ports() -> dict`; `Api.midi_activity() -> dict`; `Api.stop_monitor(keep_ports=False)`; both new calls in `POLLABLE`; session tracks carry `mode` and `midi_port`; `under_the_hood()["midi"] = {"system", "ports", "error"}` and a "MIDI:" line per port in Copy details.

- [ ] **Step 1: Write the failing section `[66] MIDI before a take`** with `apimod.open_midi_system = lambda: (fake, None)` and `apimod.MIDI_THREADS = False`:
  - `list_midi_ports()` lists the fake's ports; `"list_midi_ports"` and `"midi_activity"` are in `POLLABLE`;
  - `start_monitor(0, SR, [gtr, drums])` opens TD-17; `midi_activity()["Drums"]["state"] == "ok"`; with `[keys]` only (all MIDI) the check still opens its port (A1 stops Start, not the check);
  - `stop_monitor(keep_ports=True)` then `start_rehearsal(...)`: the port was not closed in between (the fake counts opens); `stop_monitor()` alone closes it;
  - `start_rehearsal` refuses A1, P2 and P3 with the spec's words and makes no folder;
  - Review Focus 3: check with Drums on TD-17, then Start with Drums renamed "Kit" and on port Launchkey: TD-17 closed, Launchkey open, activity keyed "Kit";
  - `finish_rehearsal()` closes every port; `shutdown()` stops the rig;
  - `disk_estimate` through `recording_health` counts only audio channels (`_channels_of` skips MIDI tracks);
  - `session_state()["tracks"]` carry `mode` and `midi_port`;
  - Review Focus 5: `open_midi_system = lambda: (None, "MIDI is not available: test")`: `list_midi_ports()["error"]` says so; a rehearsal with Drums on Both starts, `midi_activity()["Drums"]["connected"] is False`;
  - `bug_report()["text"]` has a line starting "MIDI:".
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement.** In `__init__`: `system, error = open_midi_system()`; `self._midi = MidiRig(system, error, threads=MIDI_THREADS)`. `start_monitor`: `channels_available(device_index, [t for t in tracks if records_audio(t)])`; the level monitor only when there are audio tracks; `self._midi.use(tracks, check=True)`; `self._midi.reset_counts()`. `stop_monitor(keep_ports=False)`: `release()` unless kept. `start_rehearsal`: after the checks, `self._midi.use(tracks)`. `rescan_devices` also calls `self._midi.refresh()`. `finish_rehearsal` → `release()`; `shutdown` → `abandon_take()`, `shutdown()`.
- [ ] **Step 4: Run** `python tests/run_all.py` → pass.
- [ ] **Step 5: Commit** — `MIDI: ports for the check and the rehearsal, and what Under the hood says`.

### Task 11: The Api, a take (start, stop, keep, recover)

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`start_take:1777`, `stop_take:1811`, `keep_take:1849`, `recover_draft:2019`, `list_drafts:2000`)
- Test: `tests/test_engine.py`

**Interfaces:**
- Consumes: `AudioClock`, `AudioRecorder(clock=, notes=)` (Task 7), `MidiRig.begin_take/end_take` (Task 9), `drafts.finalize` notes (Task 8), `Library.add_take` notes (Task 2), `rules.lane_after`.
- Produces: `stop_take()` adds `"notes"` and `"notes_missing"` (*Shapes*); `keep_take(take_number, temp_dir, custom_name, duration_sec, tracks, markers=None, send_to_cloud=None, notes=None)`; drafts list `notes`.

- [ ] **Step 1: Write the failing section `[67] A take with notes`** (the audio side driven by calling the recorder's `_callback` with blocks, as the existing take sections do):
  - a rehearsal with Gtr (audio), Drums (Both, TD-17) and Keys (MIDI, Launchkey not plugged): `start_take` gives the AudioRecorder only Gtr and Drums; notes sent; `stop_take()["tracks"]` names `["Gtr", "Drums"]`, `notes` `[{"name": "Drums", …, "port": "TD-17", "after": "Drums"}]`, `notes_missing` `[{"name": "Keys", "port": "Launchkey Mini MK3", "after": "Drums"}]`;
  - `keep_take(..., notes=stop["notes"])` moves `Drums.mid` into the take folder beside the WAVs, the drafts folder is gone, and the kept take lists it;
  - `keep_take` without `notes` (an older interface) still saves the audio;
  - a crash: `shutdown()` mid-take leaves `Drums.midraw` and `take.clock` in the draft; `list_drafts()` shows `notes`; `recover_draft` gives a take with `Drums.mid` and moves nothing to be lost;
  - a take where only notes arrived on a Both track still keeps its audio (silent WAV) and its `.mid`;
  - TD-17 pulled mid-take: `recording_health()` has no error and the take goes on.
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement.** `start_take`: `clock = AudioClock(samplerate)`; `AudioRecorder(... audio tracks ..., clock=clock, notes=[{"file": safe_name(t["name"]), "port": port name} for notes tracks])`; after `recorder.start()`, `self._midi.begin_take(temp_dir, clock)`. `stop_take`: inside the journaled step, `recorder.stop()` then `self._midi.end_take(duration)`; `notes_missing` from the session's notes tracks without a file; `after` with `lane_after` over the session tracks. `keep_take` and `recover_draft` move `notes` with `_move_tracks` (same function: it moves any `[{"name", "file"}]`) before the drafts folder is removed (`api.py:1886`, `2041`), and pass `notes` to `add_take`.
- [ ] **Step 4: Run** `python tests/run_all.py` → pass.
- [ ] **Step 5: Commit** — `MIDI: a take's notes recorded, kept and recovered beside its audio`.

### Task 12: Everything that moves a take's files (Part 7)

**Files:**
- Modify: `src/rehearsal_recorder/midi/smf.py` (`crop_mid`)
- Modify: `src/rehearsal_recorder/api.py` (`_move_take_dir:2264`, `rename_take:2306`, `_put_name_right:3921`, `delete_take:3036`, `_crop_tracks:2628`, `crop_take:2727`, `crop_draft:2823`)
- Test: `tests/test_midi.py`, `tests/test_engine.py`

**Interfaces:**
- Consumes: `read_events`, `write_mid` (Task 5), `PortState` (Task 6), `update_take(notes=)` (Task 2).
- Produces: `smf.crop_mid(source, target, start_sec, end_sec) -> dict` (`{"ok": True}` or `{"ok": False, "error"}`); `_move_take_dir` returns `(moved, tracks, notes, error)`; `_crop_tracks(tracks, start_sec, end_sec, progress=None, notes=())`; `crop_draft(temp_dir, tracks, start_sec, end_sec, notes=None)` returns `notes` too.

- [ ] **Step 1: Write the failing crop checks** in `tests/test_midi.py`, section `[8] Cropping a .mid`: from a file with CC4=90 at 0.5 s, CC64=127 at 0.6 s, a note 1.0–3.0 s, a note 2.5–2.6 s and a note 4.0–6.0 s, `crop_mid(…, 2.0, 5.0)`: the first note is gone with its release (held across the start); the 2.5 note is at 0.5–0.6 s; the 4.0 note starts at 2.0 s and is released at 3.0 s (held across the end); CC4=90 and CC64=127 are at tick 0; the metas are kept.
- [ ] **Step 2: Write the failing Api checks** in `tests/test_engine.py`, section `[68] A take's notes follow it`:
  - Review Focus 1: `rename_take` moves the folder and the take still lists `Drums.mid` at its new path; so does merging its song into another (`merge_songs`) and the names pass putting it right (`_put_name_right`);
  - `delete_take` on a take whose WAVs were deleted by hand still trashes the folder, found through its notes;
  - `crop_take` crops the `.mid` with the WAVs; the original `.mid` is in "(before crop)" with them; `crop_draft(..., notes=…)` likewise.
- [ ] **Step 3: Run both to see them fail.**
- [ ] **Step 4: Implement.** `crop_mid` reads with `read_events`, feeds a `PortState` with what came before `start_sec` (notes held across the start left out with their releases), writes the state at 0, the events shifted, and the releases at the end. `_crop_tracks` writes each `.mid` under `WRITING_PREFIX` beside the WAVs and moves both kinds through the same aside folder, so the undo covers both. Every caller of `_move_take_dir` passes `notes` to `update_take`.
- [ ] **Step 5: Run** `python tests/run_all.py` → pass.
- [ ] **Step 6: Commit** — `MIDI: renaming, merging, deleting and cropping carry the notes`.

### Task 13: The cloud (Part 8)

**Files:**
- Modify: `src/rehearsal_recorder/api.py` (`_copy_to_cloud:3521`)
- Modify: `src/rehearsal_recorder/cloud.py` (`source_of:24`)
- Modify: `ui/src/screens/Settings.tsx:81-97`, `ui/src/components/ShareDialog.tsx:125-151` (the hint)
- Test: `tests/test_engine.py`, `ui/e2e/settings.spec.ts` (the words)

**Interfaces:**
- Produces: `source_of` adds `"notes": [names]` only for a take that has notes, so every copy already in a cloud folder still reads as current.

- [ ] **Step 1: Write the failing section `[69] Notes go to the cloud with the tracks`**:
  - *The original tracks* with FLAC set: `Drums.mid` is in the copy's folder, byte for byte the take's, and no `Drums.wav` was made from it; *Both* the same; *The mix* has no `.mid` and `mixdown` was given only WAVs;
  - a take with no notes: `source_of` is exactly what it was before this change (an existing copy is not sent again);
  - a crop sends the take again, `.mid` included.
- [ ] **Step 2: Add the Playwright check** to `ui/e2e/settings.spec.ts`: the hint for *The original tracks* reads "Every track as recorded, untouched, and the notes as .mid — for opening in a DAW later."; the same in the share dialog.
- [ ] **Step 3: Run to see them fail.**
- [ ] **Step 4: Implement.** In `_copy_to_cloud`, after the tracks loop, copy each existing notes file with `shutil.copy2` to `_writing_path(dest / name)` then `os.replace` onto `dest / name` (never through `encode`); it weighs nothing in the stages. Both hints changed.
- [ ] **Step 5: Run** `python tests/run_all.py` and `cd ui && npx playwright test settings` → pass.
- [ ] **Step 6: Commit** — `MIDI: the notes go to the cloud with the original tracks, as they are`.

### Task 14: A `.mid` read back for the player (Part 6's data)

**Files:**
- Create: `src/rehearsal_recorder/midi/notes.py`
- Modify: `src/rehearsal_recorder/api.py` (new `take_notes`, beside `take_media:1034`)
- Test: `tests/test_midi.py`, `tests/test_engine.py`

**Interfaces:**
- Consumes: `read_events` (Task 5).
- Produces: `notes.DRUM_ROWS = ["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"]`; `notes.DRUM_MAP: dict[int, int]` (note → row); `notes.read_notes(path, drums_icon: bool) -> dict`: drums `{"drums": True, "rows": DRUM_ROWS (+ "Other" when used), "notes": [[t, d, row, vel]]}`, else `{"drums": False, "low": int, "high": int, "notes": [[t, d, pitch, vel]]}`. `Api.take_notes(files: list[{"name", "file"}]) -> list[dict]`, each with `"name"`, or `{"name", "error": "Notes file not found"}`; the icon is the band's, by name, as `take_media` finds it.

- [ ] **Step 1: Write the failing section `[9] Notes for the player`**:
  - drums found by the icon, and by notes on channel 10 without it; pitches otherwise;
  - the map: 36 → Kick, 38 and 40 → Snare, 37 → Snare, 42, 44, 46, 22, 26 → Hi-hat, 48, 50, 45, 47, 43, 58 → Toms, 51, 53, 59 → Ride, 49, 55, 57, 52 → Crash; 99 → Other, and "Other" is a row only then;
  - a roll on 38 with each release 0.1 s after its hit and hits 0.05 s apart: releases paired oldest first, each note 0.1 s long;
  - a note-on at velocity 0 is a release;
  - pitched: notes 61 and 74 give `low == 60`, `high == 83` (whole octaves, C to B).
- [ ] **Step 2: In `tests/test_engine.py`, section `[70] take_notes`**: a Both track named Drums with the drums icon in the band reads as drums; a missing file is reported as "Notes file not found" and the other files still answer.
- [ ] **Step 3: Run both to see them fail.**
- [ ] **Step 4: Implement** (pairing: a FIFO per channel and note).
- [ ] **Step 5: Run** `python tests/run_all.py` → pass.
- [ ] **Step 6: Commit** — `MIDI: a take's notes read back for the player`.

### Task 15: The interface's side of the bridge

**Files:**
- Modify: `ui/src/lib/api.ts`
- Create: `ui/src/lib/midi.ts`, `ui/src/lib/midi.test.ts`
- Modify: `ui/e2e/fake-bridge.js`

**Interfaces:**
- Produces, in `api.ts`: `RecordMode = "audio" | "both" | "midi"`; `MidiPortRef = { name: string; device?: string; maker?: string; id?: string }`; `Track` and `PlacedTrack` gain `mode?: RecordMode` and `midi_port?: MidiPortRef | null` (`PlacedTrack.channel` becomes `number | null`); `NotesFile = { name: string; file: string; port: string; after: string | null }`; `MissingNotes = { name: string; port: string; after: string | null }`; `Take` and `PendingTake` gain `notes?: NotesFile[]`, `notes_missing?: MissingNotes[]`; `MidiPorts`, `MidiActivity`, `TakeNotes` as the Python returns them; bridge calls `list_midi_ports`, `midi_activity`, `take_notes`, `stop_monitor(keepPorts?)`, `keep_take(..., notes?)`, `crop_draft(..., notes?)`; `Pollable` gains `list_midi_ports` and `midi_activity`.
- Produces, in `midi.ts`: `modeOf(t)`, `recordsAudio(t)`, `recordsNotes(t)`, `notesProblem(tracks): string | null` (the Python rules' words, so Start greys out before asking), `laneOrder(tracks: TrackFile[], notes: NotesFile[], missing: MissingNotes[])` → the lanes top to bottom as `{kind: "audio" | "notes" | "missing", …}`.
- Produces, in the fake bridge: `window.__MIDI_PORTS__` (default `["TD-17", "Launchkey Mini MK3"]`), `window.__MIDI_GONE__`, `window.__MIDI_BUSY__`, `window.__MIDI_ECHO__`; `midi_activity` with a fake kit playing while a check or take runs; `take_notes` with a kit pattern and a keyboard line from the take's length; stop_take/keep_take/crop_draft carry `notes` for tracks on Both or MIDI. `band.js` is untouched.

- [ ] **Step 1: Write `midi.test.ts`** (Vitest): `notesProblem` gives the five sentences of Task 3 for the same bands; `laneOrder` puts Drums' notes right after Drums, Keys' after the audio lane before it, a notes track first in the band before every audio lane, and a missing one where its `.mid` would be.
- [ ] **Step 2: Run** `cd ui && npx vitest run src/lib/midi.test.ts` → fails.
- [ ] **Step 3: Implement** the types, `midi.ts` and the fake bridge.
- [ ] **Step 4: Run** `npm run build && npm test` → pass (tsc flags every `PlacedTrack.channel` use; each gets the narrowing its screen needs).
- [ ] **Step 5: Commit** — `MIDI: the interface's types, rules and fake ports`.

### Task 16: The setup screen (Part 4)

**Files:**
- Create: `ui/src/components/midi/ModeSwitch.tsx`, `PortPicker.tsx`, `NotesCheck.tsx`, `MidiGlyph.tsx`; `ui/src/components/NameField.tsx`
- Modify: `ui/src/screens/Setup.tsx` (cards at `:605-735`, `canStart:204`, `channelCount:183`, `start:342`, `lookAgain:220`)
- Create: `ui/e2e/midi.spec.ts`

**Interfaces:**
- Consumes: Task 15's types, `notesProblem`, `pollPython("list_midi_ports")` and `pollPython("midi_activity")`.
- Look: the approved Q4/Q5 mockups (`q6/src/ui.diff`, `mkMidi.tsx`'s `ModeSwitch`, `NameField`, `PortLabel`, `MidiCheck`). The switch is built like `HistorySwitch` (grey track, white selected pill, `aria-pressed`), a fixed width.

- [ ] **Step 1: Write the failing Playwright tests** in `ui/e2e/midi.spec.ts` (`describe("setup")`):
  - each card has a switch "Track N records" with Audio, Both, MIDI; Both adds a port line under the input line; MIDI takes the input line away; Audio puts it back;
  - switching to Both with ports listed picks none and Start is off with the P3 sentence; picking TD-17 turns Start on;
  - two tracks on TD-17: Start off, the P2 sentence; all tracks on MIDI: Start off, the A1 sentence;
  - `__MIDI_GONE__ = ["TD-17"]`: the picker has an amber edge and "not connected", the note above the cards has the D7 sentence, Start is on; `__MIDI_BUSY__`: the P5 sentence;
  - no ports at all: the picker says "No MIDI ports. Plug one in."; a port added to `__MIDI_PORTS__` appears within 2 s without a click;
  - a new track starts on Audio; Save as template sends each track's mode and port;
  - Check signal: the port line's "no notes" becomes "✓ notes" when the fake kit plays; `__MIDI_ECHO__` puts the P8 sentence on the second card; with a keyboard's two ports listed, the open picker lists its MIDI Port before its DAW Port and marks the one being played "✓ notes" (P7);
  - nothing moves: every card's box and every control's box is the same before the check, during it and after it; and the same when a port goes and comes back;
  - D5 at 960 px: a track named "Overheads left and right microphones" and a port named "Launchkey Mini MK3 MIDI Port (DAW In) on the second USB hub" wrap to a second line in the card and in the open list, and no element under the cards has `scrollWidth > clientWidth` or a computed `text-overflow: ellipsis`;
  - the disk estimate asks for audio channels only (the fake records the count).
- [ ] **Step 2: Run** `cd ui && npx playwright test midi` → fail.
- [ ] **Step 3: Implement.** Card top line: `IconPicker`, `NameField` (a textarea that grows, one row at rest), `ModeSwitch`, trash. Under it a line per thing recorded: the input `Select` + Stereo + level meter slot; the `PortPicker` + `NotesCheck` slot. Both slots always take their width (`invisible` while not checking), so a check moves nothing. `PortPicker` is the app's `Select` with its trigger and items set to wrap (`whitespace-normal`, no line clamp); a saved port that is not plugged in is listed and marked "not connected". The ports come from polling `list_midi_ports` every second while the screen is up. Start passes `stop_monitor(true)` so the check's ports are handed to the rehearsal.
- [ ] **Step 4: Run** `npx playwright test` (all) and `npm test` → pass.
- [ ] **Step 5: Commit** — `MIDI: Audio, Both or MIDI on each setup card, and the port`.

### Task 17: While recording (Part 5)

**Files:**
- Create: `ui/src/components/midi/MidiTile.tsx`
- Modify: `ui/src/components/TrackTile.tsx` (a `midi` prop), `ui/src/screens/Recording.tsx:255-278` (tiles, polling)
- Test: `ui/e2e/midi.spec.ts` (`describe("recording")`)

**Interfaces:**
- Consumes: `pollPython("midi_activity")`, session tracks with `mode`.
- Produces: `TrackTile` takes `midi?: { vel: number; notes: number; connected: boolean }`; `MidiTile({ name, icon, port, vel, notes, connected })`.

- [ ] **Step 1: Write the failing tests**: tiles in band order; a Both tile has a dashed column labelled MIDI whose fill follows the fake kit's velocity in the accent colour and "N notes" in its header; a MIDI track's tile says "MIDI" where an audio tile says "Input 3", has the port as its tooltip, and never turns grey (no `data-silent`) when nothing plays; `__MIDI_GONE__` gives an amber edge and "not connected"; the counts go up while the fake plays.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement**, polling `midi_activity` with `get_levels`.
- [ ] **Step 4: Run** `npx playwright test` → pass.
- [ ] **Step 5: Commit** — `MIDI: the recording tiles show the notes coming in`.

### Task 18: In the player (Part 6)

**Files:**
- Create: `ui/src/components/midi/NotesLane.tsx`, `NotesPlate.tsx`
- Modify: `ui/src/components/Timeline.tsx` (lanes and rows, `LANE_MIN_PX:19`, `gridTemplateRows:287`), `ui/src/components/LaneControls.tsx`, `ui/src/components/TakePlayer.tsx`, `ui/src/screens/Review.tsx:144-196`
- Test: `ui/e2e/midi.spec.ts` (`describe("player")`)

**Interfaces:**
- Consumes: `laneOrder` (Task 15), `api().take_notes(files)` once per take opened, `Take.notes`, `Take.notes_missing`, `PendingTake.notes`.
- Produces: `NotesLane({ data: TakeNotes, duration, view, playhead })` (a canvas; rows labelled only when each row is ≥ 11 px tall); `NotesPlate({ name, icon?, port, paired, missing })`.

- [ ] **Step 1: Write the failing tests**: a take with Drums on Both shows a notes lane right under Drums' audio lane, its plate the lower half of Drums' card under a dashed line with "MIDI", "TD-17" and "Saved as .mid, not played here", and no M, S or volume; a Keys-only track has its own lane in band order with its icon and the same line; a take with Keys in `notes_missing` shows "No notes in this take" and "Not connected, no .mid saved"; zooming and the region move the notes with the audio; the part before the playhead is in the accent; audio lanes keep 92 px minimum and a notes lane grows to its plate; the review screen passes `notes` to `keep_take` and `crop_draft`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.** Grid rows from `laneOrder`: audio lanes `minmax(92px, 1fr)` as now, notes lanes `minmax(min-content, 1fr)`. The canvas draws each note as a bar its length, paler when softer, accent before the playhead and grey after, as the waveform does.
- [ ] **Step 4: Run** `npx playwright test` and `npm test` → pass.
- [ ] **Step 5: Commit** — `MIDI: notes lanes in the player, paired under their audio`.

### Task 19: The docs and the changelog

**Files:**
- Modify: `docs/using-it.md` (a new section "Recording MIDI" after "Stereo instruments", `:650`), `CHANGELOG.md` (Unreleased), `tests/docs_screenshots.py`
- Create: `docs/screenshots/midi-card.png`, `docs/screenshots/midi-player.png` (shot by the script)

- [ ] **Step 1:** Add two shots to `tests/docs_screenshots.py`: the setup screen with the drummer laid on *Both* over `band.js` for this shot only, and the player with a notes lane. Run it: `python tests/docs_screenshots.py`.
- [ ] **Step 2:** Write the section as the spec's Docs part lists it: the switch and the port; a port not plugged in; where the `.mid` files are; in a DAW (120 bpm or the file's tempo, the `.mid` at bar 1 where the WAVs start; Logic, Cubase's "Ignore Master Track Events on Merge", Ableton's one clip); Bluetooth MIDI's delay and that classic Windows MIDI does not see it; a port in use by another app on Windows.
- [ ] **Step 3:** The CHANGELOG entry, in the file's voice, first under Unreleased.
- [ ] **Step 4: Commit** — `MIDI: the docs say how, and the changelog what`.

### Task 20: reha.stream (D10)

**Files:**
- Modify: `site/content/features.md`, `site/src/content/index.ts` (`TILES`), `site/src/page/Features.tsx` (`LAYOUT`, `SPLIT`), `site/src/page/pieces.tsx`
- Create: `site/src/stage/notes.js` (the tile's notes)
- Test: `site/src/content/index.test.ts`, `site/e2e/` (the page spec)

- [ ] **Step 1: Write the failing tests**: the content has a `midi` tile with the heading and line of *Global Constraints*; the page shows it right after *Every musician on their own track*, the whole width (`tile s6`), its words beside its piece; every row of the section is full at 1000 px and up; the player on top and the story are unchanged (their existing tests).
- [ ] **Step 2: Run** `cd site && npm test && npx playwright test` → fail.
- [ ] **Step 3: Implement** from the Q7 mockup's variant A: two lanes from the real player, plate and notes, Drums from "TD-17" and Keys from "Launchkey Mini MK3", eight bars from the end of the chorus into the bridge, the part already heard in the accent. `notes.js` makes those notes from `band.js`'s song form, as `mkdata.js` did; the site's band stays the four it is.
- [ ] **Step 4: Run** → pass. Look at the page at 390, 960 and 1440 px.
- [ ] **Step 5: Commit** — `reha.stream: notes too, from an e-kit or a keyboard`.

### Task 21: Checked by hand, reviewed, and the PR

**Files:**
- Create: `tools/midi_alignment.py` (prints, for a take folder, how far each `.mid` hit is from the matching onset in its WAV: median and worst over the first and the last minute)

- [ ] **Step 1: Write `tools/midi_alignment.py`** and its check in `tests/test_midi.py` (`[10] The alignment tool`): on a WAV with clicks every 0.5 s and a `.mid` with notes 3 ms late, it prints a median of 3 ms.
- [ ] **Step 2: Build the app from the branch**: run the Release workflow by hand (`workflow_dispatch`) on this branch; both zips come as the run's artifacts.
- [ ] **Step 3: The hand checks**, with the built app, by whoever has the devices:
  - Windows: a USB MIDI device plugged in after Start records from then on; pulled and put back mid-take gives one file; on classic Windows MIDI and, where installed, Windows MIDI Services (Under the hood says which); a DAW holding the port shows "in use by another app";
  - both systems: an e-kit or a keyboard's audio into the interface and its MIDI by USB; a 1-minute take and a 60-minute take; `python tools/midi_alignment.py "<take folder>"` within 10 ms at the start and the end (F1); the `.mid` opens in a DAW at 120 bpm and lines up with the WAVs;
  - macOS, if Task 1 could not: a device plugged in after Start (P6).
  Anything that fails is fixed test first before going on. If a system sees no port plugged in after Start even by reading the list every second (P6), a port that appears mid-take is taken from the next take, and the amber note says "from the next take": built then, test first.
- [ ] **Step 4: Whole-branch review** on the most capable model, against the spec and this plan; fix every finding, minors included, each with a failing test first.
- [ ] **Step 5:** `python tests/run_all.py`, `cd ui && npm run build && npm test && npx playwright test`, `cd site && npm test && npx playwright test`, `python -m rehearsal_recorder --selftest` → all pass. Push once.
- [ ] **Step 6: Open the PR** with the repo's template if there is one, else Before / After / How; subscribe to its activity; drive CI green.
- [ ] **Step 7: Ask Alex before merging.** After the merge: memory and the MIDI thread updated.
