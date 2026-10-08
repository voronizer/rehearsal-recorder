# Recording MIDI

The drummer plays an e-kit. Its audio out goes to the desk, and its USB
cable carries every hit as MIDI. The band wants both: the sound of the kit
as it was in the room, and the hits as notes, to put other drum sounds on
in a DAW later. A keyboard player may want only the notes.

Today a track is one input on the interface and nothing else. This adds
MIDI to a track: any track records its audio, its MIDI, or both. The notes
are saved as a `.mid` file beside the take's WAVs, for a DAW. РЭХА draws
them in the player and never plays them.

It builds on [stereo tracks](2026-09-25-stereo-tracks-design.md),
[a track layout per interface](2026-09-25-track-layout-per-interface-design.md),
[looking for interfaces again](2026-09-25-device-rescan-design.md),
[the player timeline](2026-09-20-player-timeline-design.md),
[crop and zoom](2026-09-21-crop-and-zoom-design.md) and
[cloud auto-publish](2026-09-19-cloud-auto-publish-design.md). It is built
after step 8 (song sets) is merged, on top of it: step 8 changes the
rehearsal screen and the start of the setup screen, and this changes the
track cards, the recording tiles and the player's lanes.

## Decisions

Alex decided these on 8 Oct 2026, one question at a time, each on a
mockup built from the app.

- **D1. The notes are for a DAW** (21:02Z, «DAW»). The app records them and
  saves a `.mid` beside the WAVs. There is no built-in synth, and the
  player never plays notes.
- **D2. Several MIDI devices at once** (21:04Z). An e-kit and a keyboard
  can both record in one take, each on its own track.
- **D3. Audio and MIDI of one instrument are one track, shown as a pair**
  (21:20Z, «с парой мне нравится»). In the player the notes lane sits right
  under the instrument's audio lane, its plate joined to the audio plate as
  the lower half of one card. The notes lane has no M, S or volume: there is
  nothing to hear.
- **D4. Any track records audio, both or MIDI** (21:22Z, «любой трек может
  быть записан или только в аудио, или аудио + миди, или только миди»).
- **D5. An Audio / Both / MIDI switch on every track card, and nothing
  truncated** (21:34Z, «мне нравится С, но нужно сделать так чтобы ничего не
  обрезалось»; the redone mockup approved 21:52Z, «так ок»). Long track names
  and long port names wrap to a second line. They are never cut and never
  shown with an ellipsis.
- **D6. How the device is connected does not matter** (21:52Z, dropped as a
  question). A USB cable or a MIDI cable through an interface both show up as
  a MIDI port with a name, and the app only sees ports.
- **D7. A port not plugged in does not stop the rehearsal** (22:01Z, «A»).
  Start works, the track waits, and its notes are recorded from the moment
  the port appears. A cable pulled during a take keeps everything else
  recording.
- **D8. No tempo anywhere in the app** (22:13Z). The `.mid` is written at
  120 bpm, with that tempo stated in the file, so a DAW can offer to take it.
  The player draws notes by seconds, as it draws audio.
- **D9. The notes go to the cloud with the original tracks.** This was
  decided without a question and Alex was told. *The original tracks* and
  *Both* copy each `.mid` as it is. *The mix* has no notes in it.
- **D10. On reha.stream, a tile** (22:30Z, «а»). See
  [On reha.stream](#on-rehastream).

Claude's own calls, explained where they come up:

- the rules for ports (P1–P8);
- what goes into the file (F1–F7);
- a rehearsal needs at least one audio track (A1).

## Words

- **Port**: what the operating system lists as a MIDI input, by its name
  ("TD-17", "Launchkey Mini MK3 MIDI Port"). One port feeds one track.
- **Mode**: what a track records: *Audio*, *Both* or *MIDI*. Every existing
  track is *Audio*.
- **Notes**: everything a port sends that the `.mid` keeps (F2), not just
  notes. "N notes" on screen counts only the notes played.

## Part 1 — What is stored

**The band.** A band member gains its mode and its port. Both belong to the
band, as stereo and the icon do (`layouts.band_member`, `layouts.py:30-41`):
the e-kit goes with the drummer, whatever interface is on the desk.

```json
"tracks": [
  {"name": "Drums", "icon": "drums", "mode": "both", "midi_port": "TD-17"},
  {"name": "Bass"},
  {"name": "Keys", "icon": "keys", "mode": "midi", "midi_port": "Launchkey Mini MK3"}
]
```

- No `mode` means *Audio*, so every saved band and template reads as it
  did.
- `layouts.for_device` gives a *MIDI* member no channel, and does not count
  it as waiting for an input (`layouts.py:181-214`).
- `remember` stores no channel for a *MIDI* member.
- The per-interface `inputs` map is unchanged.

**The database** (migration 0006):

- `track.channel` becomes nullable. A *MIDI* track has no channel.
  SQLite needs Alembic's batch mode for this.
- `track.mode`: text, default `audio`.
- `track.midi_port`: text, nullable.
- `take_file.kind`: text, default `audio`; `midi` for a `.mid`.

**A take as the library returns it** (`library._take_data`,
`library.py:179-203`):

- `tracks` stays audio files only;
- a new `notes` list holds `[{name, file}]` for the `.mid` files.

Every audio path (the player, waveforms, the mix, crop, cloud encoding)
opens each entry of `tracks` as a WAV. Kept apart, they never see a `.mid`.

**On disk**, a take's folder:

```
03 - Pałyn 4/
    Drums.wav
    Drums.mid
    Bass.wav
    Keys.mid
```

- The `.mid` has the same name as the track's WAV, so a DAW import shows
  which go together.

## Part 2 — Ports

The ports come from **libremidi**, through its Python package `pylibremidi`
(Part 9 says why). Everything the app does with ports goes through one module
of its own, `midi/ports.py`, so the library could be swapped there alone.

- **P1. A port is remembered by what the OS says about it**: its name, the
  device's name and maker, and on macOS the ID CoreMIDI gives it. A saved
  port is found again in that order:
  1. the same ID;
  2. the same name;
  3. the same name without what Windows adds to it, the port's number at
     the end ("TD-17 1") and the "2- " in front of a second device of the
     same kind. Both can change when devices are replugged.

  Two identical devices that nothing tells apart are not guessed between:
  the track shows its port as not connected, and the picker lists both.
  The plan checks which of these fields each platform really fills in.
- **P2. One port feeds one track.** Two tracks on the same port stop Start,
  as two tracks on one input do (`devices.channels_available`,
  `devices.py:546-559`): "Drums and Keys both take notes from TD-17."
- **P3. A *Both* or *MIDI* track with no port picked yet stops Start**, as
  a track with no input does: "Keys has no MIDI port yet. Pick one, or set it
  to Audio." A port that was picked but is not plugged in does not stop it
  (D7).
- **P4. Ports plugged in or pulled out are noticed on their own.**
  - libremidi's observer calls the app when a port appears or goes, on
    CoreMIDI, on the classic Windows MIDI and on Windows MIDI Services.
  - The setup screen's list and the waiting tracks follow it at once.
  - This is unlike audio interfaces, where the device rescan design
    deliberately has no hotplug. Watching MIDI ports does not tear down
    PortAudio or load ASIO drivers.
  - The existing **Look again** on the setup screen also reads the ports.
- **P5. A port another app holds open** is shown like one not plugged in,
  with its own words: "TD-17 is in use by another app."
  - Windows' classic MIDI lets one app at a time use a port. A drummer's
    EZdrummer or a DAW on the same laptop would lock РЭХА out, or the
    other way round.
  - Windows MIDI Services, the new Windows 11 MIDI, lets several apps share
    a port. It is still reaching people.
  - The app opens only the ports its tracks use. The plan tests both
    Windows stacks, and the app's log says which one it is on.
- **P6. That a port plugged in after Start is seen is checked first, in the
  plan.**
  - On macOS it is checked in CI, with a virtual port made during a take.
  - Windows has no virtual ports without a third-party driver, so it is
    checked on a real machine with a real device.
  - If a platform's observer misses new ports, the app reads the port list
    every second instead. If it does not see them that way either, a take
    records only the ports there when it started, and the amber note says
    "from the next take".
- **P7. A device with several ports.** A keyboard such as the Launchkey has
  its playing port and a separate DAW port. The picker lists a device's
  playing port first, and during **Check signal** "✓ notes" shows on the
  port that is actually being played.
- **P8. The same notes arriving twice.** One instrument plugged in twice
  (by USB and through the interface's MIDI in) feeds two tracks with the
  same notes. When the check sees two ports sending the same notes within a
  few milliseconds, the second card says: "Keys gets the same notes as
  Synth. Is it one instrument plugged in twice?" It warns and stops
  nothing.

## Part 3 — Recording

**The ports stay open for the whole rehearsal.** A new module,
`midi/ports.py`, opens one libremidi input per *Both* or *MIDI* track, with a
callback, when the rehearsal starts. It closes them when the rehearsal
finishes or the app closes.

- The callback only puts the event on a queue and returns. A writer thread
  takes it from there, so a hi-hat pedal sending a stream of positions, or
  a burst of SysEx, never holds up the next event.

- Between takes it only keeps each port's state (F6) and looks for missing
  ports (P4).
- During a take it also hands every event to the take's writer,
  `midi/capture.py`'s `MidiRecorder(out_dir, anchor)`.
- `start_take` starts the writer with the `AudioRecorder`
  (`api.py:1765-1776`); `stop_take`, `shutdown` and `abandon` stop it beside
  the audio recorder.
- Losing a port never stops a take. `recording_health` reports only audio
  problems, as now.

Opening a port only when a take starts would lose what was set before it:
the pedal already down, the sound already picked (F6).

**F1. When a note happened, on the audio's own clock.** A note belongs at
the sample of the WAV that was being captured as it was played.

- **Each event carries the OS's own time** for when it arrived, in
  nanoseconds (libremidi's absolute timestamps), not the time Python got
  around to it.
- **The audio interface keeps its own time**, and its clock and the
  computer's do not run at quite the same speed.
  - Interfaces are typically within ±50 ppm. One measured interface ran at
    +196 ppm.
  - At 50 ppm a 10-minute take drifts 30 ms, and an hour 180 ms.
  - A note placed by the computer's clock alone would end a long take
    audibly early or late against the drums' audio.
- **So every audio block is a mark.** Each audio callback notes the OS time
  and how many frames the take has captured by then. A line fitted through
  those marks turns any OS time into a sample position, drift included. It
  is fitted afresh as the take goes on.
- **Time 0 is the take's first sample**, less the interface's input
  latency. Where a driver reports when a block was captured
  (`time.inputBufferAdcTime`), that is used. PortAudio has had a bug in
  those times for input-only streams on CoreAudio, so the plan checks them
  against the block arrival times.
- **Windows' classic MIDI** gives times to the millisecond, which is enough.

The aim is notes within 10 ms of the audio they belong to, at the start of
a take and at the end of an hour-long one. That is below what a drummer
hears as a flam. The plan measures it on both platforms with a click
recorded as audio and as MIDI at once.

**F2. What the file keeps: everything a `.mid` can hold** (Alex, 22:45Z,
«есть ли смысл что-то фильтровать на записи?»). Nothing is filtered by
choice. Kept, as sent:

- notes, with their velocities, the release velocity included;
- every controller: an e-kit's hi-hat pedal (CC 4, from fully open to
  closed), the sustain, sostenuto and soft pedals, the mod wheel, and the
  pad position some kits send;
- program and bank changes: the sound picked on a keyboard or a kit;
- pitch bend;
- aftertouch, for the whole channel and per note. Roland kits send a
  cymbal choke this way;
- SysEx, which some instruments use for their own settings. libremidi
  drops it unless told not to (`ignore_sysex = False`).

Not kept, because a Standard MIDI File has no place for them: it holds
channel messages, SysEx and its own meta events, and nothing else. They are
signals about the cable and the sync, not playing. They have to be left out
on purpose, because mido does not stop all of them. It refuses clock,
start, stop, continue and tune request, and the whole save fails. It writes
active sensing, song position and time code into the file as they are, and
a DAW may not read past them. It also writes a reset, whose byte starts a
meta event in a file, and then even mido cannot read the file back. All
three were tried with mido 1.3.3. So only channel messages and SysEx are
written, and one event the file cannot take is skipped and logged. It never
costs the take its `.mid`. Left out:

- clock, start, stop and continue, which a keyboard's arpeggiator or a drum
  module may send. The `.mid` has its own tempo (D8);
- active sensing, which an e-kit sends several times a second to say it is
  still there;
- MIDI time code, song position, song select and tune request.

**F3. Written as you play.** Events go to `<track>.midraw` as they arrive:
a line per event, its time in seconds and its bytes. That file is flushed
with the audio's 30-second flush (`capture.py:39, 331-336`).

- On stop, each `.midraw` becomes `<track>.mid` and is removed, as `.raw`
  becomes `.wav`.
- `take.json` lists the notes files: `notes: [{file, port}]`.
- A crash loses what an audio track loses, the seconds since the last flush.

**F4. The file.** It is built with mido's `MidiFile`:

- Standard MIDI File format 0, 960 ticks per beat;
- at tick 0, the track's name, the port's name as the device name, a
  120 bpm tempo (D8), then the state at the start (F6);
- every event at its time in ticks, so one tick is about half a millisecond.
  Each event's tick is worked out from its time from the start, not added
  up from the one before, so rounding never builds up over a long take;
- the channels as the device sent them;
- names written as UTF-8. mido writes Latin-1 unless told otherwise, and a
  track called "Pałyn" or "Барабаны" then fails the save
  (`UnicodeEncodeError`, tried with mido 1.3.3). Some DAWs still show such a
  name garbled; the file's own name is always right.

**F5. When there is no `.mid`.** A port that never appeared during a take
leaves no file, and the take has no notes entry for it. A port that was
there but sent nothing still leaves a `.mid`, with only its name and tempo,
so the DAW shows that the track was recording.

**F6. Where everything was when the take started.** Each port's state is
kept per channel for the whole rehearsal: the last value of every
controller, the program and bank, pitch bend and channel aftertouch. At time
0 of a take, the `.mid` gets that state, before any note. A DAW then plays
the take's first hi-hat closed if the pedal was already down, and the
keyboard's sound as it was picked before Record.

- The bank is written before the program, as instruments expect.
- Only values that actually arrived are written; nothing is made up.
- Some controllers are not a state and are never repeated:
  - 120–127 are commands (all notes off, local control, reset);
  - 88 only adds precision to the next note's velocity;
  - 6, 38 and 96–101 only mean something inside the sequence that set them.
- A key already held when the take starts is not in the file, nor its
  release.

**F7. Nothing left hanging at the end.** When a take stops, or its port
disappears mid-take, every note still held gets its release at that
moment. A sustain, sostenuto or soft pedal still down is let up. Without
this a DAW holds those notes to the end of the project.

A device switched off behind an interface's MIDI in leaves its port there,
since the port is the interface's. Many devices say they are alive with
active sensing: a TD-17 every 250 ms. When it has been arriving and stops
for more than 300 ms, which is the MIDI standard's own rule, the device
counts as gone. Its held notes are released at the moment it was last
heard, and its tile shows "not connected" until it is heard again.

**Drafts and recovery** (`audio/drafts.py`):

- `has_audio` also counts a `.midraw` or `.mid`, so a take whose only
  recording is notes is not taken for empty;
- `describe` and `finalize` turn a `.midraw` into a `.mid`;
- `keep_take` and `recover_draft` move the notes files as well as the WAVs,
  before the drafts folder is removed (`api.py:1886, 2041`). Otherwise the
  `.mid` would be deleted with it.

**A1. A rehearsal records audio.** At least one track has to be *Audio* or
*Both*. A take is timed, heard and mixed from its audio, and the player has
nothing to play without it. With every track on *MIDI*, Start is off and the
setup screen says: "At least one track has to record sound, so the takes can
be heard."

## Part 4 — The setup screen

Each track card (`Setup.tsx:579-728`), as the approved mockup has it:

- **The top line**: the icon, the name, the Audio / Both / MIDI switch, and
  the trash button.
  - The switch is the app's segmented control, of a fixed width.
  - The name field wraps to more lines instead of cutting a long name (D5).
- **Under it, a line per thing the track records**:
  - *Audio*: the input picker and **Stereo**, as now;
  - *MIDI*: the port picker;
  - *Both*: the input line, then the port line.
- **The check meter at each line's end**:
  - the audio level for an input;
  - "✓ notes" in the accent for a port, once a note has arrived during the
    check, and "no notes" in muted grey before that.

  The meter's place is kept while nothing is being checked, so starting a
  check moves nothing.
- **The port picker** lists the ports the OS lists now. The saved port, if
  it is not plugged in, is listed too, marked "not connected". A long port
  name wraps in the picker and in the list, and is not cut.
- **A port not plugged in** (D7):
  - the picker gets an amber edge and "not connected";
  - above the cards, an amber note: "“TD-17” is not connected. Drums records
    its notes from the moment it is plugged in.";
  - Start stays on.
- **New tracks** start as *Audio*. Switching to *Both* or *MIDI* with
  ports listed picks none (P3). With no ports at all, the picker says "No
  MIDI ports. Plug one in."
- **Save as template** and "filled in from last time" keep the mode and the
  port with the band (Part 1).
- **Check signal** also opens the ports of *Both* and *MIDI* tracks for the
  check, and hands them over to the rehearsal at Start.

Cards are now two or three lines tall. The setup screen was checked in the
mockup at 960–1600 px with ordinary, long and very long names: nothing cut,
nothing jumping.

## Part 5 — While recording

The tiles (`TrackTile.tsx`, `Recording.tsx:255-278`):

- **A *Both* track** keeps its audio tile.
  - On its right is a narrow column with a dashed edge, labelled MIDI
    upright. A fill jumps with each note's velocity, in the accent rather
    than the level's green: it is not a sound and has no level to set.
  - The tile's header adds "N notes".
- **A *MIDI* track** gets its own tile, in band order. It has the icon,
  "N notes", the same accent fill and the name upright. Where an audio tile
  says "Input 3", it says "MIDI", with the port in its tooltip.
- **A port not connected**: the tile's edge is amber and it says "not
  connected", as a tile waiting for its input does. Its notes start the
  moment the port appears (P4).
- A MIDI tile never turns grey as silent: notes come and go, and a pause is
  not a fault.

Live data comes from a new pollable `midi_activity()`, added to `POLLABLE`
(`mediaserver.py:37-48`) and polled with the levels:

```json
{"Drums": {"vel": 0.82, "notes": 1240, "connected": true}}
```

- `vel` is the loudest note since the last poll.
- `notes` counts the notes played this take, or this check.

## Part 6 — In the player

The lanes (`Timeline.tsx:457-497`), wherever a take opens in the player:

- **A *Both* track**: the notes lane goes right under its audio lane.
  - Its plate is the lower half of the instrument's card, under a dashed
    line, with the MIDI glyph, "MIDI", the port, and "Saved as .mid, not
    played here".
  - No M, S or volume (D3).
- **A *MIDI* track**: a lane of its own, in band order. Its plate has the
  instrument's icon, the name, the port and the same line.
- **The notes**, drawn on a canvas:
  - **Drums**: six rows, Crash, Ride, Hi-hat, Toms, Snare, Kick.
    - Which lanes are drums: a track with the drums icon, or notes on MIDI
      channel 10, the General MIDI drum channel. Drummers do move kits off
      channel 10, so the icon counts too.
    - The rows come from the General MIDI drum map, with the extra notes
      e-kits use beside it. On a TD-17, 22 and 26 are the hi-hat's edge,
      40 the snare's rim and 58 tom 3's rim; General MIDI calls 58 a
      vibraslap.
    - A seventh row, Other, shows only in a take that has notes outside the
      map.
    - An e-kit ends each hit about 0.1 s later, so a fast roll overlaps
      itself on one note. Each release goes to the oldest hit still
      sounding on that note. A note-on at velocity 0 is a release, as MIDI
      has it.
  - **Anything else**: notes by pitch, from the take's lowest note to its
    highest, rounded out to whole octaves, with each C labelled.
  - Each note is a bar as long as it was held. A softer note is paler. The
    part already played is in the accent and the rest is grey, as the
    waveform does.
  - Row names show only when the lane is tall enough to read them.
- **The notes lane follows the view**: zoom, the region, marks and the
  playhead cross it as they cross the audio lanes.
- **Its height**: a notes lane grows to fit its plate (`minmax(min-content,
  1fr)`). The audio lanes keep their 92–96 px.
- **A take whose port never appeared**: the lane says "No notes in this
  take", and the plate says "Not connected, no .mid saved".

The notes come from a new call, `take_notes(files)`. It returns, per file,
`{name, drums, notes: [[t, d, pitch, velocity], …]}`, or an error for a file
that is missing. It reads the `.mid` with mido. The notes of a whole take
are small enough to send at once, so zooming asks for nothing again.

## Part 7 — Everything that moves a take's files

Each of these handles the `notes` list as it does `tracks`:

- `keep_take` / `_move_tracks` and `recover_draft` (Part 3).
- **`_move_take_dir`** (`api.py:2238-2278`), and so renaming a take,
  renaming or merging songs, and the names pass: the notes paths are
  rewritten with the track paths.
- **`delete_take`** trashes the take's folder. When a take somehow has no
  audio file listed, its notes files still find the folder.
- **Crop** (`_crop_tracks`, `api.py:2573-2670`; `crop_draft`). Each `.mid` is
  cut to the region, with the times moved to start at the region:
  - a note held across the start is dropped, as a sound cut mid-note would
    be;
  - a note held across the end is ended there;
  - each controller's last value before the start (the hi-hat pedal, the
    sustain pedal) is set again at time 0, so the DAW starts with the pedals
    where they were.

  The original goes to "(before crop)" with the WAVs.
- **Folder size** (`_folder_bytes`) already counts every file.

## Part 8 — The cloud

- **The original tracks / Both**: each `.mid` is copied into the take's
  tracks folder as it is. It is never encoded, and keeps its `.mid` ending.
  Today a file goes through `encode` and comes out named `<stem>.wav`
  (`api.py:3564-3567`), which would break it.
- **The mix**: unchanged. `mixdown` is only ever given the WAVs.
- A copy's `source` includes the notes files, so a crop sends the take
  again.
- **The words**:
  - The hint for *The original tracks* becomes "Every track as recorded,
    untouched, and the notes as .mid — for opening in a DAW later." It is
    hard-coded twice, in `Settings.tsx:81-97` and `ShareDialog.tsx:125-151`,
    and both change.
  - `_copy_detail` is unchanged.

## Part 9 — The libraries, and building the app

**Ports: libremidi** (`pylibremidi` 5.4.3, MIT and BSD-2-Clause), asked for
after Alex questioned the first choice (22:49Z, «поищи - может что получше
и удобнее найдешь»). Three were compared:

| | python-rtmidi | rtmidi2 | pylibremidi |
|---|---|---|---|
| Last release | 1.5.8, Nov 2023 | 1.5.0, Oct 2026 | 5.4.3, Jan 2026 |
| Underneath | RtMidi | RtMidi 6 | libremidi, a rewrite of RtMidi |
| Wheels | up to Python 3.12 | 3.10–3.14 | 3.10–3.14 |
| Port plugged in or pulled out | not told; read the list again | not told; read the list again | told, by an observer |
| An open port still connected | not told | not told | `is_port_connected()` |
| Event times | time since the last event | time since the last event | the OS's time, in ns |
| Windows | classic MIDI | classic MIDI | classic MIDI, UWP and Windows MIDI Services |

- **python-rtmidi** was the first choice, and is dropped.
  - It has had no release since 2023 and has no wheels for Python 3.13.
  - Its open issues include a Windows crash on 3.13 (#228) and SysEx cut
    short on Windows (#200).
  - A delta-only time leaves the first event of each port without a time
    of its own.
- **rtmidi2** is alive and simple, but has the same RtMidi underneath: no
  word when a port comes or goes, and delta times.
- **libremidi** answers D7 and P4 directly, with its observer, and F1, with
  its absolute times. It is the library behind ossia score's MIDI and
  several OBS plugins.
  - Its Python package is young: four releases in January 2026, none
    since.
  - So it sits behind `midi/ports.py` alone, and rtmidi2 is the fallback if
    the plan's first checks fail on it.
  - Tried on Linux with Python 3.12: the observer and an input open, and
    its times are the system's monotonic clock in nanoseconds.
  - The Windows wheel has the classic, UWP and Windows MIDI Services
    backends compiled in; the macOS wheel has CoreMIDI.
  - Its Python package does not include libremidi's file reading and
    writing.

**Files: mido** (1.3.3, MIT, pure Python), the most used MIDI file library
for Python. Alternatives were looked at:

- pretty_midi and miditoolkit are built on mido, for music analysis, and
  drop what they do not model;
- symusic is fast but made for machine learning, around notes rather than
  every event;
- MIDIUtil has had no release since 2018.

mido's two traps for this use are handled in F2 (events a file cannot take)
and F4 (names as UTF-8).

**Building:**

- **`requirements.txt`** gains `pylibremidi` and `mido`.
- **The PyInstaller spec** collects pylibremidi's compiled module.
- **macOS** asks no permission for MIDI.
- **The self-test** (`app.py --selftest`) starts the MIDI system and lists
  ports, with no device needed, so a build that lost it fails in CI, not at
  a rehearsal.
- **Without a working MIDI system** the app still records audio. The switch
  stays and the port picker says why there are no ports. Saved ports show as
  not connected, so a *Both* track records its audio and waits for its
  notes, as in D7.

## Testing

Tests come before the code, and each is seen failing first.

**Python** (`tests/test_engine.py`, with pylibremidi stubbed the way
sounddevice is):

- the band and layouts with modes and ports: a *MIDI* member gets no
  channel, and an old band reads as *Audio*;
- migration 0006 on an existing library, with old tracks reading as *Audio*;
- `channels_available`:
  - a *MIDI* track accepted without an input;
  - P2 and P3 refusing a shared port and a missing port;
  - A1 refusing an all-MIDI rehearsal;
- P1: a saved port found by its ID, by its name, and by its name with
  Windows' number and "2- " changed; two identical devices not guessed
  between;
- P8: the same notes from two ports during a check warned about;
- the recorder:
  - events into a `.midraw`, then a `.mid` with the right ticks, tempo,
    track name and channels;
  - F2: everything played kept, SysEx included; clock, tune request,
    active sensing, song position, time code and reset left out, so the
    file saves and reads back; an event the file cannot take skipped
    without losing the rest;
  - F4: a track named "Pałyn" and one named in Cyrillic saved and read
    back; a long take's ticks not drifting from rounding;
  - F6: pedal, program and pitch bend set before a take written at its
    time 0, from events that came between takes;
  - F6: controllers 120–127, 88 and the parameter ones not repeated, and
    the bank written before the program;
  - F7: notes held at stop, and at a port vanishing, released there, and a
    held sustain pedal let up; active sensing stopping for over 300 ms
    counted as the device gone;
  - F1: time 0 from a fake audio callback's times, and the fallback; an
    interface running 200 ppm fast still putting a note an hour in on its
    sample, within a millisecond;
  - a burst of thousands of events in a second, with none lost;
- D7:
  - a port missing at start and appearing later, with notes from then on;
  - a port vanishing mid-take and coming back, with one file;
  - F5's two cases;
- recovery of a crashed take with a `.midraw`, including a take with notes
  only on that track;
- `keep_take` and `recover_draft` moving the `.mid` and losing nothing;
- renaming a take and merging songs carrying the notes paths;
- crop: times moved, a note across the start dropped, a note across the end
  ended, pedal values set again at 0;
- the cloud:
  - `.mid` copied as is with the tracks, never renamed `.wav`;
  - left out of the mix;
  - sent again after a crop;
- `take_notes`: drums found by the icon or by channel 10, pitches
  otherwise; TD-17's extra notes in their rows; a fast roll's overlapping
  hits paired oldest first; a note-on at velocity 0 as a release; a missing
  file reported.

**CI on macOS**: a virtual port made after a take has started is picked up
by the observer, and one closed is seen as gone (P6).

**By hand, before the PR** (the plan has a checklist for Alex or anyone with
the devices):

- on Windows, a USB MIDI device plugged in after Start, on the classic
  Windows MIDI and on Windows MIDI Services;
- on both platforms, a click recorded as audio and as MIDI at once, at the
  start of a take and after an hour (F1).

**Playwright** (the fake bridge gains `list_midi_ports`, `midi_activity`,
`take_notes` and modes on tracks):

- the switch on a card, the port picker, and the lines changing with the
  mode;
- the check's "✓ notes";
- the amber note and edge for a port not plugged in, with Start still on;
- P2, P3 and A1 stopping Start, with their words;
- the recording tiles for *Both* and *MIDI*, and "not connected";
- the player's lanes:
  - a pair under its audio lane, and a *MIDI* track's own lane;
  - no M, S or volume on either;
  - "No notes in this take";
- nothing cut at 960 px with long track and port names (D5).

## Docs

- **`docs/using-it.md`**, a new section, "Recording MIDI":
  - the switch and the port;
  - a port not plugged in;
  - where the `.mid` files are;
  - in a DAW: set the project to 120 bpm, or let it take the file's tempo,
    and put the `.mid` at bar 1 where the WAVs start; then they line up.
    Logic may ask about the tempo, or have the question turned off;
    Cubase's "Ignore Master Track Events on Merge" keeps the project's own
    tempo; Ableton puts every channel of a file in one clip;
  - Bluetooth MIDI adds a few milliseconds of uneven delay, and the classic
    Windows MIDI does not see it;
  - on Windows, a port in use by another app.

  It has one screenshot each of a card on *Both* and of the player with a
  notes lane, from the fake.
- **`CHANGELOG.md`**.
- **The docs band** (`ui/e2e/band.js`) stays four audio tracks. The
  screenshots that show MIDI lay a drummer on *Both* over it for those shots
  only.

## On reha.stream

A tile in *Built for the room*, right after *Every musician on their own
track*, the whole width of the section (D10):

- **The heading**: "Notes too, from an e-kit or a keyboard."
- **The line**: "A track records its audio, its MIDI or both. The notes are
  saved as .mid beside the audio, ready for your DAW."
- **Beside them**: two lanes from the real player, plate and notes:
  - Drums from "TD-17" and Keys from "Launchkey Mini MK3";
  - eight bars from the end of the chorus into the bridge;
  - the part already heard in the accent.

  The notes come from a small fixture beside the site's demo. The site's
  band stays the four it is, so the player on top and the story do not
  change.

Other notes for the site:

- Step 8 adds a wide sets tile to the same section. Where the two go is
  settled when both are in, so that every row is full.
- The FAQ does not change.
- What's new comes from `CHANGELOG.md`.

## Not part of this

- Playing notes, a built-in synth, or sending MIDI out or through.
- A tempo, a click or a metronome; quantizing or editing notes.
- Choosing which MIDI channels a track takes: a port's every channel goes to
  its track.
- Keeping MIDI clock or time code, which a `.mid` cannot hold (F2).
- Notes in the mix, or a rehearsal with no audio track (A1).
- Notes shown anywhere outside the player: History's lists and a song's
  goes are unchanged.
