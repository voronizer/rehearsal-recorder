# Sound in a process of its own

РЭХА skips. A take played back loses sound, and a take being recorded loses
it too, without saying so. The cause is Python: the card asks for sound, or
hands it over, every 1024 frames, and when the rest of the app holds Python
at that moment the card gets nothing, or its sound is dropped. Measured on
GitHub's machines through virtual cables, 30 seconds a run (report:
/mnt/project-files/take-stutter/rtmixer-check.md):

| | Playback lost today | Recording kept today |
|---|---|---|
| Windows, ASIO 1024, usual load | 0.22 s in 16 places | 29.9 s of 30 |
| Windows, ASIO 1024, heavy load | 4.5 s in 27 places | 26.5 s of 30 |
| Mac, usual load | 3.1 s in 19 places | 28.8 s of 30 |
| Mac, heavy load | 5.7 s in 29 places | 25.2 s of 30 |

After this work every stream to a card runs in a second РЭХА process that
does nothing else, and the card is fed and emptied by rtmixer's C code from
rings that Python fills a second ahead and drains behind. In the same tests,
with the heavy load kept in the first process, nothing was lost to Python on
either machine, in playback or in recording.

Alex approved this spec on 4 November at 20:44 («Ок»). The plan:
`docs/superpowers/plans/2026-11-04-sound-process.md`.

## Alex's picks

All on 4 November 2026, in the thread «Найти радикальное решение заиканий».

- 10:39 «нужно найти какое-то радикальное решение с заиканиями в рэхе».
- 10:59 «Звук карте на C» (card): the part that feeds the card is C, not
  Python.
- 14:28 «Берём rtmixer» (card).
- 16:13 «Проверь все сначала. А потом меня спрашивай.» Every question after
  this one came with measurements.
- 18:38 «Да, вместе» (card): recording moves to rtmixer together with
  playback.
- 18:42 «Как есть, 0.1.7» (card): rtmixer from PyPI as it is; our own copy
  only if it breaks.
- 19:31 «Сначала дожать Mac» (card): before the spec, clean sound on a Mac
  under heavy load. A bigger reserve did not do it; a separate process did.
- 20:05 «Да, отдельный процесс» (card): sound, the click and recording in a
  second РЭХА process.
- 20:09 «Ничего» (card): reha.stream stays as it is, and the CHANGELOG item
  for this is not the first of its release, so it is not the site's news line.
- 20:33 «Я смогу только на репетиции проверить. Релиз будет нужен.»
- 20:35 «Давай сейчас обычным релизом безо всяких откатов. Если заработает -
  ок. Если нет - переписываем все нахрен на другой стэк.» So the release has
  the new sound only, with no switch back (Part 12).

## What the band notices

- Playback and recording do not skip because the app is busy.
- M, S, a fader and Master are heard about 0.17–0.19 s after the press,
  where today it is about 0.1 s (ASIO 1024 on GitHub's machines; the XR18
  will have its own figures). Play, Pause and a seek about 0.11–0.13 s,
  today about 0.06–0.08 s.
- Switching the click or the backing track off during a take, or changing
  its volume, is heard after about the same 0.2 s.
- A 24-bit take plays in 24 bits; today the player sends 16
  (`audio/player.py:246`).
- РЭХА starts its sound part in the background as it opens, in 0.3–0.7 s.
  Task Manager and Activity Monitor show two РЭХА processes.
- Nothing else on the screen changes, except one new message for the case
  when the sound part stops (Part 9).

## Part 1. The sound process

As РЭХА opens, it starts a second copy of itself with multiprocessing's
spawn, as tempo drift's counting already does (`audio/drift.py:197`). That
copy, the sound process, holds every stream to a card:

- playback of a take, with a click take's click (today `TakePlayer`);
- the take's recording, with its click and backing track on the recording
  card or on another device (`AudioRecorder`, `TakeClick`);
- the level check before a take (`LevelMonitor`);
- the click and the backing track between takes (`ClickOutput`).

All four move, because ASIO allows one
stream in a process (`pa_asio.cpp:1632`, the reason for `ANOTHER_ASIO`,
`metronome.py:91`), and a card the sound process holds cannot be opened by
the other one.

PortAudio itself moves there too: the device list, Settings › Audio, the
card probe (`audio/probe.py`) and a Mac's microphone question
(`api.py:1380`). PortAudio loads every ASIO driver just to list the devices
(`pa_asio.cpp:1026`), and a second PortAudio in the main process would load
the XR18's driver again while the sound process plays through it. The main
process no longer imports sounddevice.

In the main process, stand-ins keep today's classes' methods, so `api.py`
changes little: a call becomes a message to the sound process and its
answer (Part 7). The sound process has no window, no database and no
sending: nothing in it but sound, which is why the load in the main process
does not reach it.

If the first take or playback comes before the sound process is up, it
waits for it, up to 30 s as tempo drift's counting does
(`START_PATIENCE_SEC`). After that the screen says sound is unavailable
(Part 9).

## Part 2. Playback

The engine that was measured (called "rtq" in the report):

- rtmixer 0.1.7's `Mixer` plays a ring. The sound process mixes the take into
  it 1 second ahead, in blocks of 1024 frames. The reserve stays 1 s with no
  Settings row: 2 s and 3 s did not change how fast M is heard, and on a Mac
  under heavy load a bigger one ran dry as often and for longer.
- M, S, a fader, Master: the sound already in the ring is mixed again in
  place, from two card calls ahead of what the card is reading (twice the
  largest block it asks for, plus 256 frames).
- Play, Pause, a seek, the loop's jump: about 0.5 s of new sound goes in as
  one piece and everything after it is cut, so the old and the new never
  mix. Exact to the frame in the tests, under heavy load too.
- If the ring runs dry anyway, rtmixer stops playing it. The engine starts it
  again when 0.6 s is in the ring and counts it for the log (Part 8).
- Samples are float32, which holds 24 bits exactly (all 16.7 million values
  checked both ways).
- A click take's click, and the click or backing track between takes when
  they go to the same card, are mixed into the same ring on their own
  outputs, as today: one stream a device.

The playhead and the meters. The engine notes, for every piece it mixes,
which frame of the take it starts at and the levels in it. The playhead is
the piece the card is playing now: the stream's time less the time the ring
started, in frames. Checked on a test card: within 0.1 ms of what was
heard, on average 0, and up to 5 ms under heavy load. From the sound process,
as the screen gets it, it was 5–21 ms old in the middle, 57 ms at most (Mac
and Windows), and it never went back. Where a driver gives times that are not
believable (as `lead_of` guards today, `audio/click_timing.py:48`), it is
counted from the ring instead: frames handed over, less those still in it,
less the output latency.

## Part 3. Recording

- When the take's click or backing track goes to the recording card, one
  `MixerAndRecorder` stream records the inputs and plays a ring; otherwise a
  `Recorder` records.
- The inputs go into a ring of at least 2.5 s of every channel at the take's
  rate. Under heavy load it filled to 0.28 s at most.
- A take thread in the sound process reads the ring every 2 ms. It writes
  each track's raw file as today, in 16 or 24 bits, so a take whose app died
  is recovered by `audio/drafts.py` as now. The files are flushed to disk
  every 30 s on their own thread, as now. The thread also keeps each
  track's peaks for the meters, marks the notes' clock (Part 5) and watches
  for a card gone quiet and for sleep (Part 6).
- Stop works as today: the take records on to the next quarter of a click
  take, then the raw files become WAVs.

Checked under heavy load in the other process, 30 s, two runs each: Mac
29.9 and 29.9 s, Windows 30.0 and 29.8 s, nothing lost to Python. The one
gap, 11 ms in the second Windows run, came while both rings were full, so
it was lost in FlexASIO or the virtual cable, as the 50–70 ms gaps of the
first Windows runs were. Only the XR18 can say more.

## Part 4. The take's click and backing track

- They are rendered into a play ring a second ahead by today's code:
  `ClickSource.render` and `BackingSource.render` take a first frame and are
  handed numbers. The take's grid, its count-in, its first click and Stop on
  the next quarter do not change (`audio/take_click.py`).
- On the recording card: both rings start at one requested time, so a beat
  played on output frame j comes back at input frame j plus the difference
  of the two start times, in frames, which rtmixer gives. That is today's
  rule with the driver's round trip (`TakeClick.on_duplex_block`). Checked
  with the click looped back into the input: on a Mac (BlackHole, a loop
  with no delay of its own) today's code and the new way both land it on
  the very frame, in all four runs; here on a test card both land within 3
  frames of each other. On Windows the test chain cannot judge it: FlexASIO
  over the virtual cable moves its own loop by 10–37 ms from one opening to
  the next and within a run, today's code included.
- On another device (not with ASIO, as today): that device's own play ring
  and stream in the sound process, placed by the take's clock and the
  output's as today (`AudioClock.ns_at`, the output's `StreamClock`). The
  output's marks come from its play ring the way the input's do (Part 5).
- Switching the click or the backing track, or its volume, mixes the ring
  again in place, as M does.

## Part 5. The notes' clock

A MIDI note is stamped with the computer's clock, and placed at the sample
being captured then (spec F1, `midi/clock.py`). Today the recording's
callback marks the clock with every block. rtmixer's callback is C and runs
no Python, so the take thread marks it:

- A read of the ring that finds new frames says they arrived between it and
  the read before; the middle of the two is taken. One mark a second is the
  mean of that second's reads (50 to 500 of them), so a coarse sleep costs
  no precision: GitHub's Mac sleeps 10 ms when asked for 2.
- How old a block's first frame was when it arrived is the stream's input
  latency. That is what today's code gets from the driver: on Windows
  (FlexASIO, ASIO) 85.33 ms both, on a Mac 21.33 ms against 21.4–22.2 ms.
- `AudioClock` and its fit stay as they are. The sound process sends the
  marks to the main process, where the MIDI part places notes and writes
  `take.clock` as today.

This needs `time.perf_counter_ns` to count the same in both processes,
since a note is stamped in the main one. It does: a stamp sent from one
process reads 0.01–0.02 ms old in the other on Windows, 0.05–0.17 ms on a
Mac.

Checked on GitHub's Mac, today's marks and the new ones at once on one
device, two runs of 30 s: the new line places a note 1.6–2.1 ms earlier
than today's (2.5 ms at most), and each mark sits 0.4–0.6 ms from it. On
Windows ASIO allows one stream a process, so the two cannot run at once;
there the age is the same as today's to the frame, and each mark sits
0.8–1.0 ms from its line.

## Part 6. A card gone quiet, and sleep

- Recording: today a take with no block for 3 s (5 s before the first) stops
  with "Recording stopped: no sound has come from the audio interface…"
  (`audio/heartbeat.py`, `capture.py` `STALLED`). The take thread watches the
  ring for the same: no new frames for as long.
- Sleep: two signs of life too far apart mean the laptop slept, as today
  (`AudioRecorder._seen`), from the take thread and its tick.
- Playback: a card that stops taking sound for 3 s is an output problem, as
  today.

## Part 7. Between the processes

- Commands, such as open a take, Play, M, a seek, start or stop a take, go
  through a multiprocessing pipe: 0.1–0.2 ms each way in the tests. Each
  gets an answer, and the stand-in returns it, so a stream that will not
  open says why, as today.
- What the screen asks five times a second (the playhead, the meters, the
  click's flash, a problem) goes through the same pipe. The sound process
  answers it on four threads of its own, beside each stream's commands, so
  a slow command never holds up the screen. The first plan wrote it into
  shared memory about 100 times a second; that was dropped while building
  it, as it cost the sound process a write every 10 ms for five reads a
  second, and a question through the pipe takes 0.1–0.2 ms.
- Larger answers, such as a stopped take's record, go through the pipe.

## Part 8. The log

Alex's rule from 3 November: when a problem like the skips is looked into,
the log records that situation too. In crash.log, as today:

- After a listening that ran dry, today's line (`api.py:4951`) says how many
  times the reserve ran dry, the least it held, and how many takes waited to
  be sent.
- After every take: the frames recorded, the most the record ring held, and
  whether it ever overflowed. Today a lost piece of recording is not logged
  at all.
- The sound process starting, how long that took, stopping, dying and
  starting again.

The sound process sends its lines to the main process, which writes them;
one writer, so lines never cross. If the sound process itself crashes, its
trace goes to crash.log too (faulthandler, as `app.py:47`).

## Part 9. When a process dies

- The sound process: the main process sees it go. The raw files of a take
  being recorded are on disk, so the take is kept up to there and recovered
  as after a crash today. The screen says: “Recording stopped: РЭХА's sound
  stopped working. The take is kept up to this moment.” Playback shows the
  problem a lost output shows today. The main process starts the sound
  process again; if it dies again within a minute, it is left down and the
  screen says sound is unavailable until РЭХА is restarted.
- The main process: the sound process sees its pipe close, closes the raw
  files and exits. The take is recovered at the next start, as today.

## Part 10. Building and starting

- `rtmixer==0.1.7` goes into requirements, with what it needs (cffi).
- PyInstaller bundles it: checked on Windows (ASIO) and a Mac.
- `multiprocessing.freeze_support()` is already in `__main__.py`; the spawned
  process plays from the built app on both systems (checked).

## Part 11. Tests

- The engine on a fake rtmixer, with no card: moves, cuts, playhead, levels,
  a dry ring and its restart, the click's place.
- The stand-ins and the messages between the processes, with a fake sound
  process.
- Today's player and recorder tests that drive a callback are rewritten for
  the rings.
- The cable checks on GitHub's machines are not kept in CI: they need
  drivers installed and take minutes. The probe branch is deleted when this
  work is merged, as agreed.

## Part 12. The XR18, at a rehearsal

Alex can try the XR18 only at a rehearsal, with a release. The release has
the new sound only, with no switch back (his words, 20:35). If it skips,
the log (Part 8) says whether the reserve ran dry. If it never did and the
band heard skips anyway, Python gave the card everything in time, and they
came from the driver or the card. That matters for what comes next: on the
vMix forum in 2020 the XR18 crackled at ASIO buffer 1024 in a program with
no Python at all.

At the same rehearsal: a take recorded to the click, to hear that the beats
sit on the click, and a take with MIDI notes, to see them on the drums.

## Calls Claude made on its own

1. Every card stream moves to the sound process, the level check and the
   click between takes too, because of ASIO's one stream a process.
2. PortAudio only in the sound process, the device list too.
3. Stand-ins with today's methods in the main process.
4. The sound process starts with РЭХА, not at the first take; a take waits
   up to 30 s for it.
5. Reserve 1 s, no Settings row (told on 4 November ~19:30).
6. Changes mixed again from two card calls ahead (M heard after 0.17–0.19 s).
7. After a dry ring, sound again at 0.6 s in the ring.
8. A record ring of at least 2.5 s, read every 2 ms.
9. The notes' clock: one mark a second from that second's reads, the age
   from the stream's input latency.
10. A pipe for everything, what the screen polls answered on threads of its
    own (shared memory was dropped while building it: Part 7).
11. A dead sound process is started again once; a second death in a minute
    leaves it down. The new message's wording in Part 9.
12. The click or backing track switched during a take is heard after 0.2 s.
13. The log lines in Part 8.
14. No cable checks in CI.

## Not tested yet

- The XR18's driver: at a rehearsal, with the release (Part 12).
- A real rehearsal's load; the "usual" load was built from 0.22.0's logs.
- ASIO buffer 256: on GitHub's machines FlexASIO and the cable make 3 ms
  gaps by themselves.
- How soon sound returns after a dry ring: the 0.6 s restart took almost a
  second under heavy load on a Mac.
- The backing track between takes, and a click going from Pause into a take.
- The take's click on Windows: the test chain moves its own loop (Part 4).
- Whether a Mac asks for the microphone for the built app's sound process
  as it does for the app.
- A sound process that dies and starts again (Part 9) has not been run.

## Not in this work

reha.stream, the band service and the screens (beyond Part 9's message).
MIDI capture stays in the main process.
