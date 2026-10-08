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

- the rules for ports (P1–P6);
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

- **P1. Ports are listed by the OS name.** The list comes from python-rtmidi
  (`MidiIn().get_ports()`), read fresh each time it is asked for.
  - RtMidi on Windows adds a number to each name ("TD-17 1"), and that
    number can change when devices are replugged. A saved port matches a
    listed one with that number ignored.
  - Two devices with the same name are told apart by the number, in the
    order the OS lists them.
- **P2. One port feeds one track.** Two tracks on the same port stop Start,
  as two tracks on one input do (`devices.channels_available`,
  `devices.py:546-559`): "Drums and Keys both take notes from TD-17."
- **P3. A *Both* or *MIDI* track with no port picked yet stops Start**, as
  a track with no input does: "Keys has no MIDI port yet. Pick one, or set it
  to Audio." A port that was picked but is not plugged in does not stop it
  (D7).
- **P4. Ports are looked for again on their own.** This is unlike audio
  interfaces, where the device rescan design deliberately has no hotplug.
  Listing MIDI ports does not tear down PortAudio or load ASIO drivers, so
  it is safe to do often:
  - the setup screen reads the list every 2 s while it is open;
  - a rehearsal looks every second for a port it is waiting for (Part 3).

  The existing **Look again** on the setup screen also reads the ports.
- **P5. A port another app holds open** (on Windows a port is usually open
  to one app at a time) is shown like one not plugged in, with its own words: "TD-17 is in
  use by another app."
- **P6. Whether a port plugged in after the app started is seen without a
  restart is checked first, in the plan.**
  - On macOS this can be checked in CI, with a virtual port made during a
    take.
  - Windows has no virtual ports without a third-party driver, so it is
    checked on a real machine with a real device.
  - If a platform does not see new ports, P4 falls back to **Look again**
    for ports between takes. A take then records only the ports that were
    there when it started, and the amber note says "from the next take".

## Part 3 — Recording

**The ports stay open for the whole rehearsal.** A new module,
`midi/ports.py`, opens one `rtmidi.MidiIn` per *Both* or *MIDI* track, with a
callback, when the rehearsal starts. It closes them when the rehearsal
finishes or the app closes.

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

**F1. When a note happened.** Each event is timed from the OS's own MIDI
timestamps (RtMidi's delta times), not from when Python got around to it.
Time 0 is the first sample of the take's audio:

- the audio callback's `time.inputBufferAdcTime` against the stream's
  `currentTime` puts that sample on the same clock as the MIDI events;
- where a driver reports no times (zeros), the time the first block arrived,
  less one block and the stream's input latency, stands in.

The aim is notes within 10 ms of the audio they belong to. That is below
what a drummer hears as a flam. The plan measures the offset on both
platforms with a click recorded as audio and as MIDI at once.

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
- SysEx, which some instruments use for their own settings. python-rtmidi
  drops it unless told not to (`ignore_types(sysex=False)`).

Not kept, because a Standard MIDI File has no place for them: it holds
channel messages, SysEx and its own meta events, and nothing else. mido
refuses the first group outright ("realtime messages are not allowed in
MIDI files"). They are signals about the cable and the sync, not playing:

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
- every event at its time in ticks, so one tick is about half a millisecond;
- the channels as the device sent them.

**F5. When there is no `.mid`.** A port that never appeared during a take
leaves no file, and the take has no notes entry for it. A port that was
there but sent nothing still leaves a `.mid`, with only its name and tempo,
so the DAW shows that the track was recording.

**F6. Where everything was when the take started.** Each port's state is
kept per channel for the whole rehearsal: the last value of every
controller, the program and bank, pitch bend and channel aftertouch. At time
0 of a take, the `.mid` gets that state, before any note. A DAW then plays
the take's first hi-hat closed if the pedal was already down, and the
keyboard's sound as it was picked before Record. A key already held when the
take starts is not in the file, nor its release.

**F7. Nothing left hanging at the end.** When a take stops, or its port
disappears mid-take, every note still held gets its release at that
moment. A sustain, sostenuto or soft pedal still down is let up. Without
this a DAW holds those notes to the end of the project.

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
  - **Drums** (notes on MIDI channel 10, the General MIDI drum channel e-kits
    use): six rows, Crash, Ride, Hi-hat, Toms, Snare, Kick, from the General
    MIDI drum map. A seventh row, Other, shows only in a take that has notes
    outside the map.
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

## Part 9 — Building the app

- **`requirements.txt`** gains:
  - `python-rtmidi` (MIT; wheels for macOS arm64 and x86_64 and for Windows
    x64 on Python 3.12, the version the builds use);
  - `mido` (MIT, pure Python).

  python-rtmidi reads the ports, and mido writes and reads the files.
- **The PyInstaller spec** collects rtmidi's compiled module.
- **macOS** asks no permission for MIDI.
- **The self-test** (`app.py --selftest`) opens the MIDI system and lists
  ports, with no device needed, so a build that lost rtmidi fails in CI,
  not at a rehearsal.
- **Without a working MIDI system** the app still records audio. The switch
  stays and the port picker says why there are no ports. Saved ports show as
  not connected, so a *Both* track records its audio and waits for its notes,
  as in D7.

## Testing

Tests come before the code, and each is seen failing first.

**Python** (`tests/test_engine.py`, with python-rtmidi stubbed the way
sounddevice is):

- the band and layouts with modes and ports: a *MIDI* member gets no
  channel, and an old band reads as *Audio*;
- migration 0006 on an existing library, with old tracks reading as *Audio*;
- `channels_available`:
  - a *MIDI* track accepted without an input;
  - P2 and P3 refusing a shared port and a missing port;
  - A1 refusing an all-MIDI rehearsal;
- P1: a saved Windows-style name matching with its number changed;
- the recorder:
  - events into a `.midraw`, then a `.mid` with the right ticks, tempo,
    track name and channels;
  - F2: everything played kept, SysEx included, and what a `.mid` cannot
    hold left out, so mido writes the file;
  - F6: pedal, program and pitch bend set before a take written at its
    time 0, from events that came between takes;
  - F7: notes held at stop, and at a port vanishing, released there, and a
    held sustain pedal let up;
  - F1's time 0 from a fake audio callback's times, and the fallback;
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
- `take_notes`: drums found by channel 10, pitches otherwise, and a missing
  file reported.

**CI on macOS**: a virtual port made after a take has started is picked up
(P6).

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
    and the notes line up with the WAVs.

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
