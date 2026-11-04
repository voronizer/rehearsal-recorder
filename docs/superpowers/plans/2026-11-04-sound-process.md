# Sound in a process of its own: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every stream to a card runs in a second РЭХА process, fed and
emptied by rtmixer from rings, so the rest of the app cannot make it skip.

**Architecture:** two layers. A ring layer (`audio/ring.py`) puts each of
today's stream classes on rtmixer: an output ring that a feeder thread keeps
a second ahead by calling the class's own fill code, an input ring that a
reader thread drains every 2 ms into the class's own block code. A process
layer (`audio/sound/`) runs those classes in a spawned sound process and
gives the main process proxies with today's methods; what the screen polls
comes back through shared memory.

**Tech Stack:** Python 3.12, rtmixer 0.1.7 (cffi, PortAudio through
sounddevice), multiprocessing (spawn, Pipe, shared memory), numpy.

**Spec:** `docs/superpowers/specs/2026-11-04-sound-process-design.md`
(a copy of /mnt/project-files/take-stutter/spec/2026-11-04-sound-process-design.md).
The reference engine measured for it:
/mnt/project-files/take-stutter/rtmixer-bench/ringplay.py, with the probe's
"quick" guard (`.../rtmixer-probe/probe.py`, `Engine.run`).

Alex waived the plan's «ок» on 4 November at 20:47 («Ок от меня не нужно.
Делай релиз как закончишь.»): built, merged and released without asking again.

## Global Constraints

- `rtmixer==0.1.7` from PyPI, as it is (his pick, 18:42).
- Reserve 1 s; blocks of 1024 frames; a setting is mixed again from
  `2 * max_blocksize + 256` frames ahead of the card; a move puts 24 blocks
  (~0.5 s) in one piece and cuts the rest; after a dry ring, playing again at
  0.6 s in it.
- A record ring of at least 2.5 s of every channel; read every 2 ms.
- The notes' clock: one mark a second, the mean of that second's reads (the
  middle of the two reads around each arrival), the age the stream's input
  latency; `AudioClock`'s fit unchanged.
- PortAudio only in the sound process. The main process never imports
  sounddevice or rtmixer.
- The sound process starts with the app; a call waits for it up to 30 s.
  Died: started again once; dead again within 60 s, left down.
- No switch back to the old sound (his words, 20:35).
- The app's words: design system F7, P2, C3, B8; British English. The new
  message: “Recording stopped: РЭХА's sound stopped working. The take is kept
  up to this moment.”
- Tests: only the suites a change touches while developing, once each; the
  full suites once on CI.
- Commits and the PR end with plain "Generated with Claude Code"; no session
  link, no model name.

## Review Focus

1. A card unplugged mid-take or mid-listening: the take stops with today's
   message and keeps its audio; playback says nothing went out (heartbeat
   through the rings). Task 2 and 3 tests.
2. The sound process killed mid-take: the take's raw files are on disk and
   come back as a draft; the screen shows the new message; the next take
   works after the restart. Task 4 test.
3. The main process killed mid-take: the sound process closes the raw files
   and exits within 2 s (no orphan holding the ASIO card). Task 4 test.
4. A record ring that overflows (a stalled disk): the gap is filled with
   silence so the take keeps its length and its notes their places, and the
   log says how much. Task 3 test.
5. A rescan (Settings › Audio, a card plugged in) while nothing plays: the
   device list in the main process is the sound process's new one. Task 5
   test.

---

### Task 1: rtmixer, a fake card for tests, and the build

**Files:**
- Modify: `requirements.txt` (add `rtmixer==0.1.7` with a comment in the
  file's style), `packaging/rehearsal-recorder.spec` (collect `rtmixer`,
  `_rtmixer`, cffi's backend)
- Create: `tests/fake_rtmixer.py`
- Test: `tests/test_ring.py` (new suite, added to `tests/run_all.py`)

**Interfaces:**
- Produces: `fake_rtmixer.install()` puts a fake `rtmixer` in `sys.modules`:
  `RingBuffer(elementsize, size)` with `read_available`, `write_available`,
  `write`, `readinto`, `_ptr.writeIndex/bigMask/buffer`, `_ffi.buffer`;
  `Mixer`, `Recorder`, `MixerAndRecorder` with `start/stop/close`, `time`,
  `latency`, `actions`, `play_ringbuffer/record_ringbuffer(ring, channels=None,
  start=0, allow_belated=True)`, `cancel`, `stats`; actions with
  `actual_time`, `done_frames`, `stats.max_blocksize`. `card.pump(frames)`
  runs one card call by hand: a play action takes `frames` from its ring
  (dropped when the ring has fewer), a record action gets the frames set by
  `card.feed(array)` (dropped when its ring is full), `time` moves on.

- [ ] Delete nothing of the probe here: the branch starts from main; its
  files are kept in /mnt/project-files/take-stutter/rtmixer-probe/.
- [ ] Write `tests/test_ring.py::fake_card_behaves` checks: a play ring with
  2048 frames gives 1024 per pump and is dropped on the pump that finds 512;
  a record ring of 4096 is dropped on the pump that would overflow it;
  `actual_time` is the requested start.
- [ ] Implement the fake; run `python tests/test_ring.py`: passes.
- [ ] Commit.

### Task 2: the ring layer and playback

**Files:**
- Create: `src/rehearsal_recorder/audio/ring.py`
- Modify: `audio/player.py` (stream through `RingOutput`), `audio/click_output.py`
  (same), `audio/devices.py` (`open_ring(kind, **settings)` beside
  `open_stream`, on `AUDIO_THREAD`)
- Test: `tests/test_ring.py`, the player checks in `tests/test_engine.py`

**Interfaces:**
- Produces:
  - `RingOutput(mixer, channels, samplerate, fill, state=None, restore=None,
    heartbeat=None, reserve_sec=1.0)`. `fill(out, frame, now_ns, lead_sec)`
    writes one block (float32, `out.shape == (1024, channels)`) for ring
    frame `frame`. `state()`/`restore(s)` save and put back what `fill`
    depends on, for mixing again. Methods: `start()`, `stop()`,
    `change()` (mix again from the guard), `move(edit)` (`edit()` applied
    under the fill's lock, then 24 blocks in one piece, the rest cut),
    `heard()` (ring frame the card plays now, from `mixer.time -
    action.actual_time`; from the ring count when that is not believable:
    negative or more than the ring holds), `shown(frame)` (what `fill`
    returned for the block holding `frame`), `counts` dict: `ran_dry`,
    `lowest_reserve_frames`.
  - `RingInput(recorder, channels, samplerate, consume, heartbeat=None,
    seconds=2.5)`. `consume(block, first_frame, arrival_ns)` gets every
    arrival. A dropped record action is started again and the frames it
    missed (stream time) are handed over as zeros; `counts`: `overflowed`,
    `lost_frames`, `fullest_frames`.
  - `RingMarks(clock, samplerate, latency_sec)`: `read(first_frame, frames,
    arrival_ns)` per arrival; once a second of frames has passed, one
    `clock.mark_at(ns, frame)` with the means.
  - `AudioClock.mark_at(ns, frame)` in `midi/clock.py`: `_keep((ns, frame))`
    with `_latest` set, as `mark` does.
  - `TakePlayer`: same public methods. `open_output` opens a
    `rtmixer.Mixer` through `devices.open_ring` and a `RingOutput` whose
    `fill` is today's `_fill` mixing (route, free click and backing, levels
    kept per block), `state/restore` the probe's `_state/_restore` plus the
    loop. Settings call `ring.change()`; play, pause, toggle, seek, the loop's
    jump call `ring.move(...)`. `state()["position"]` and the levels come
    from `ring.shown(ring.heard())`. `skips()` returns `(seconds, ran_dry,
    0, 0.0)` and the counts reset.
  - `ClickOutput`: same methods, its stream a `RingOutput` whose `fill` is
    `source.render`; `swap` calls `change()`.

- [ ] Tests (fake card) in `test_ring.py`: `output_keeps_a_second` (after
  start, 47 blocks in the ring); `setting_heard_from_guard` (a change at heard
  frame h is in the ring from `h + 2*1024 + 256` rounded up to a block, not
  before); `move_is_exact` (seek to 20 s: the ring holds the old take up to a
  block, 24 blocks from 20.000 s after it, nothing old after them);
  `dry_ring_restarts` (pump with an empty ring: `ran_dry == 1`, playing again
  once 0.6 s is in); `heard_falls_back` (actual_time 0: heard from the ring
  count); `input_pads_overflow` (a dropped record action for 4800 frames:
  consume gets 4800 zeros, `lost_frames == 4800`); `marks_mean_of_second`
  (reads every 10 ms with ±5 ms arrival noise: each mark within 0.5 ms of the
  true line).
- [ ] Rewrite the player checks in `test_engine.py` that call `_callback` or
  `_fill` with a card's block to pump the fake card instead; mixing checks on
  `_render` stay as they are.
- [ ] Implement; run `python tests/test_ring.py` and `python
  tests/test_engine.py`: pass.
- [ ] Commit.

### Task 3: recording, the level check and the take's click

**Files:**
- Modify: `audio/capture.py`, `audio/monitor.py`, `audio/take_click.py`,
  `audio/probe.py` (its attempts through `RingInput`)
- Test: `tests/test_ring.py`, `tests/test_engine.py`, `tests/test_click.py`,
  `tests/test_backing.py`

**Interfaces:**
- Consumes: `RingInput`, `RingOutput`, `RingMarks` (Task 2).
- Produces:
  - `AudioRecorder`: same public methods. Inputs only: `rtmixer.Recorder`;
    with the click or backing on the card: `rtmixer.MixerAndRecorder`, play
    and record rings started at one requested time (`mixer.time + 0.1`,
    `allow_belated=False`). `consume` is today's `_block` minus the clock
    mark (now `RingMarks.read`) and minus `on_duplex_block`. The heartbeat
    and `_seen` run per arrival.
  - `TakeClick.fill_card(out, play_frame, now_ns, lead_sec, round_trip)`
    replaces `on_duplex_block`: `round_trip = round((play.actual_time -
    record.actual_time) * rate)`, the first click chosen as today from
    `frames_done + lead + round_trip` with `frames_done` the play frame.
  - `LevelMonitor`: `rtmixer.Recorder` and a `RingInput` whose `consume` is
    `_measure`.
  - After every take, one INFO line in the log: frames recorded, the most
    the record ring held, overflows and lost seconds.

- [ ] Tests: `take_writes_every_frame` (fake card feeds 10 s in random
  blocks: the raw file holds all of it, bit for bit, 16 and 24 bits);
  `card_gone_stops_take` (no frames for 3 s: `problem()` is today's
  `STALLED`); `click_on_card_lands_on_grid` (a click take's first click at
  `lead_sec` after the first input frame, written at play frame s for input
  frame s when the two start times are equal); `stop_on_quarter` unchanged;
  `marks_reach_clock` (after 5 s, five kept marks).
- [ ] Rewrite the recorder and click checks that drive `_callback`,
  `_duplex_callback` or `on_duplex_block` to pump the fake card.
- [ ] Implement; run `test_ring.py`, `test_engine.py`, `test_click.py`,
  `test_backing.py`: pass.
- [ ] Commit.

### Task 4: the sound process

**Files:**
- Create: `src/rehearsal_recorder/audio/sound/__init__.py`, `host.py`,
  `link.py`, `remote.py`, `shared.py`
- Test: `tests/test_sound.py` (new suite, in `run_all.py`)

**Interfaces:**
- Produces:
  - `link.start(local=False) -> Link`; `Link.new(kind, *args, **kw) ->
    Remote`, `Link.call(handle, method, *args, **kw)`,
    `Link.poll(handle) -> dict`, `Link.alive`, `Link.on_event(fn)`. A
    `Remote` passed as an argument arrives in the host as its object.
    `local=True` hosts the objects in this process (the tests' way, no pipe).
  - `host.main(conn, shared_name, parent_pid)`: the spawned process. Makes
    objects by kind from a fixed table (`TakePlayer`, `AudioRecorder`,
    `LevelMonitor`, `ClickOutput`, `SilentOutput`, `ClickSource`,
    `BackingSource`, `TakeClick`, `TakeBacking`, `InterfaceCheck`, `Devices`),
    runs each call on a pool of four threads, and every 10 ms writes each
    object's `poll()` into shared memory. Log records of
    `rehearsal_recorder.*` go to the main process as events and are logged
    there. Pipe closed or parent gone: every recorder `abandon()`s its files
    closed and the process exits.
  - `shared.Board(name, size=1 << 20)`: a seqlock over pickled bytes;
    `write(obj)`, `read() -> obj` (retries a torn read).
  - `remote.py`: proxy classes with today's method names. Calls go through
    the pipe; polled ones (`TakePlayer.state`, `playing`, `output_problem`,
    `AudioRecorder.problem/is_active/get_levels`, `LevelMonitor.problem/
    get_levels`, `ClickOutput.problem/closed`, `ClickSource.upcoming/
    count_state/done/fault/tempo/signature/route`, `BackingSource.done/
    fault/position_sec`, `TakeClick.count_state/upcoming/first_click_frame`)
    read the board. `get_levels` keeps today's "since the last ask": the host
    publishes peaks per 10 ms tick, numbered, the last 64; the proxy takes the
    loudest of the ticks after the one it saw last.
  - An `AudioClock` passed to a remote recorder stays in the main process
    and is fed the host clock's marks, `latency_sec` and `started_ns` as
    events.
  - Death: `Link` sees the process exit, sends `sound_stopped` to
    `on_event`, starts it again once; a second death within 60 s leaves it
    down (`alive False`, calls raise `SoundUnavailable`).
- [ ] Tests: `call_and_answer` (spawned host with the fake card: a player
  opens, plays, `state()` moves); `board_never_torn` (writer at 10 ms, reader
  5000 reads); `levels_since_last_ask`; `host_dies_take_kept` (kill the host
  mid-take: raw files there, `sound_stopped` event, restarted once);
  `parent_dies_host_exits` (kill the parent: host gone within 2 s);
  `logs_cross` (a host log line arrives in the main process's logger).
- [ ] Implement; run `python tests/test_sound.py`: passes.
- [ ] Commit.

### Task 5: the main process on the sound process

**Files:**
- Create: `src/rehearsal_recorder/audio/sound/view.py` (the device list the
  main process reads: `query_devices`, `query_hostapis` from the host's last
  list; `check_input_settings`, `check_output_settings`, `rescan` as calls)
- Modify: `api.py`, `metronome.py`, `backing.py`, `audio/devices.py`
  (functions that read the list take it from the view in the main process),
  `app.py` (start the link before the window), `audio/probe.py`
- Test: `tests/test_engine.py`, `test_transport.py`, `test_click.py`,
  `test_backing.py`, `test_control_api.py`, the controller suites (with
  `local=True`)

**Interfaces:**
- Consumes: `Link`, the proxies, `view` (Task 4).
- Produces: `api.py`, `metronome.py`, `backing.py` build every stream
  object with `sound.new(...)`; `isinstance(x, ClickOutput)` becomes
  `x.kind == "ClickOutput"`; `import sounddevice` leaves them;
  `_ask_for_microphone` is a host call; `_say_skips` logs dry runs and the
  lowest reserve; the `sound_stopped` event ends a take as a card gone quiet
  does, with the new message, and pauses playback with today's output
  problem; lines in the log for the sound process starting (how long it
  took), stopping, dying, starting again.
- [ ] Tests: `rescan_reaches_view` (Review Focus 5); `sound_stopped_message`
  (a fake `sound_stopped` mid-take: the take ends kept, the screen's problem
  is the new message); the suites above pass with `local=True`.
- [ ] Implement; run the touched suites once each: pass.
- [ ] Commit.

### Task 6: the release

**Files:**
- Modify: `CHANGELOG.md` (an item under Unreleased, not the first: his pick
  20:09), `docs/superpowers/specs/2026-11-04-sound-process-design.md` (the
  spec's copy), `tests/README.md` (the two new suites)
- [ ] Build with PyInstaller locally on Linux to see rtmixer collected; the
  Windows and Mac builds run on the PR's CI.
- [ ] Full review of the branch (one fresh reviewer), fix everything found.
- [ ] Open the PR, watch CI, merge on green (his words, 20:47), close
  "Unreleased" under the next version, give him the prefilled release link.
