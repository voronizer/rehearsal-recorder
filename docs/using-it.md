# Using it

What each screen is for, and the decisions behind how they behave.
## Screens

- **Setup** — rehearsal name and the list of tracks (name + input number),
  with a line showing which interface and quality it will record with; that
  line is a button to Settings, where those are chosen. The track layout is
  saved as a template (`~/.rehearsal-recorder/config.json`) and filled in next
  time. "Check signal" opens the inputs without recording: everyone plays in
  turn and watches the bar move next to their own name. Free disk space is on
  screen the whole time, next to "Add track".
- **Settings** (the gear in the header) — four groups rather than one long
  column, because six sections stacked in a row was a wall nobody could scan:
  **Audio** (the recording interface, rate and depth; the card used for
  playback), **Folders** (where rehearsals go, where cloud copies go, whether
  saved takes go there on their own and what they are written as),
  **Appearance** (theme and scale) and **Under the hood** (paths and the
  local server). The track layout is deliberately not
  duplicated here: it is edited where it is defined, on the setup screen. The
  interface and the quality are the opposite case — they belong to the room
  and the card, not to one evening, so they are settled once here and the
  setup screen only reports them.
- **Rehearsal** — the hub: the takes recorded so far and a big "Record take"
  button. Takes are a strip along the top; click one to listen to it in the
  player below. Nothing is selected until you pick one, so opening a rehearsal
  does not start reading audio files nobody asked for. Clicking a take again
  keeps it open — selecting is sticky.
- **Recording** — a large timer, a level meter per track, and a status line
  that is always visible: interface connected, how much recording time the
  disk has left, and any warning. The meter shows the state as well as the
  level: fine / silent / clipping.
- **Review** — straight after stopping: the player (below), a name field, and
  "Save take" or "Discard". Markers work here too, which takes explaining: the
  take has no folder yet, so there is nowhere on disk to write them. They are
  held in the screen and travel with the take when it is saved — and go away
  with it if it is discarded. It is the same player component throughout;
  earlier it simply had nothing to attach a mark to and so did not offer one.
- **History** — every past rehearsal, read from disk, so it survives a
  restart. Each row says when it was, how long it ran, what it weighs on disk
  and what was played in it — "Polyn ×3 · Vesna ×2 · Ogon" — because a date
  and a take count are not how anybody recognises a rehearsal from three
  months ago. The size is measured by walking the folder, not worked out from
  the durations, so it is the number Finder would give you. Click a rehearsal
  to open it; takes are a strip along the top, the same component as on the
  rehearsal screen. Takes and whole rehearsals can be renamed and deleted;
  deletion asks first and says how much space is coming back, and is not
  permanent — the folder goes to the Trash.
- **Unsaved takes** — shown before anything else on startup when a take was
  recorded but never saved (see "If the app dies mid-take" below).
- **Finished** — the rehearsal summary and the path to its folder.

## Naming and renaming

A take inherits the previous take's name with the counter bumped: name the
first one "Verse riff" and the next ones come up as "Verse riff 2", "Verse
riff 3". It is the same song until somebody says otherwise, which is how a
rehearsal actually goes.

That counter is also what History reads to say what a rehearsal was spent on:
the name without its trailing number is the song, so "Verse riff 3" counts as
a third go at "Verse riff". Naming the first take of each song is the whole
price of that summary. Takes nobody named stay "Take 4" and are left out of
it — they are still counted as takes, but they are not a song.

Takes and rehearsals can be renamed afterwards, from the rehearsal screen and
from history, with the pencil button. The folder on disk is renamed with them,
so what you see in the app and what you see in Finder stay the same thing. A
rehearsal folder keeps its date stamp: "Tuesday jam - 2026-09-18 19-00".
Renaming a take while you are listening to it does not stop playback.

## The player

Audio is played by Python (`audio/player.py`), not the browser. That was for
output-device selection: on the web the output is switched with `setSinkId`,
which this engine does not offer for `AudioContext`. The side benefits turned
out to be just as large — the memory ceiling is gone, and so is the split
between two playback modes.

All the tracks of a take share one timeline: a ruler at the top with the
clock, the markers and the playhead, a lane each underneath, and the fader
with M and S in the gutter on the left. Anything that belongs to the take
rather than to one track — the A–B region, the marker lines, the playhead —
is drawn once across every lane, which is what makes it possible to see that
two tracks parted company at 1:12.

Drag across the timeline to set the repeat region, in either direction; its
edges are grips on the ruler and can be dragged afterwards. A press that does
not travel is a click, and a click seeks, as it always did — that is what lets
one surface do both jobs without a mode switch. Because the edges are grabbed
on the ruler rather than down the lanes, a press on the lanes always begins a
new region, so you can redraw one starting exactly where the old one ended.
The A and B buttons put an edge exactly at the current playback position for
when you have found the spot by ear. The playhead has a grip of its own on the
ruler: dragging that scrubs, which is what dragging the waveform used to do.

- **Sync.** All tracks are mixed into one stream from one position, so they
  cannot drift apart even in principle.
- **Memory.** Tracks are read through `memmap`: the system pulls in the parts
  it needs, so a twenty-minute take costs no more than a three-minute one.
  Seeking is just a change of index.
- **Volume, mute and solo** are applied with short smoothing on the
  coefficient, otherwise switching clicks.
- **The waveform** is computed in Python (`audio/waveform.py`, numpy) and
  arrives as ready peaks. You can see where a track plays, where it is silent
  and where it clipped.
- **Markers.** "Mark" drops a marker at the current position and opens a note
  for it, because the thought about what just went wrong lasts about five
  seconds. A marker has a kind — a plain note, "keep this", "went wrong",
  "do again" — and the kind is a colour, on the waveform and on the take pill
  in the strip, so a glance says which take has red in it. Clicking a marker
  jumps there;
  the note can be edited or left empty. Markers are placed while listening
  back, not while recording, because nobody is looking at the screen during a
  take.
- **Repeat** loops: the whole take, or just the stretch between the A and B
  marks when they are set. The marks are independent of repeat, so you can
  place them in advance and switch looping on when you want it.
- **Transport.** To start (|◀), ±10 seconds, click the timeline to seek. At
  the end of a take the player returns to the start instead of sitting at the
  tail.
- **The balance is remembered.** Track volumes are stored by name in the
  config and picked up on the next take and after a restart.

## Recording quality

Two choices, in Settings. New installs record at 24 bit, 44.1 kHz.

**Bit depth — 16 or 24.** This is the one worth thinking about. 16 bits has
plenty of resolution, but only if the level is set well, and at a rehearsal
nobody is watching the gain: the drummer hits harder in the chorus and that is
that. So you leave margin, and the quiet parts get the leftovers. At 24 bits
there are about 48 dB more to play with — set the inputs low, stop worrying,
lose nothing. It costs half again as much disk: eight channels at 48 kHz is
0.77 MB/s at 16 bits and 1.15 MB/s at 24, so 2.8 GB an hour against 4.1 GB.

**Sample rate — 44.1, 48 or 96 kHz.** 44.1 or 48 are both fine for a band;
44.1 is the default because it is smaller and nothing downstream cares. 96
doubles the disk and the CPU for a difference nobody will hear in a room with
a drum kit in it; it is offered because some interfaces are set to it anyway
and there is no reason to fight them.

Only combinations the interface actually accepts are shown — the card is asked
before the choice is offered, not after it fails. A card that will not do 96
kHz does not have it on screen; a rate it only does at 24 bits greys out 16.
If a saved choice stops being possible (a different interface, a different
setup) the app moves to one that works rather than failing at the moment
everyone is ready to play. The setup screen's disk estimate follows whatever
is chosen.

Old rehearsals keep working untouched. Playback, waveforms and the cloud
mixdown all read both depths, and a take can even hold tracks of each. The
mixdown itself is written 16-bit on purpose: it is what gets sent to people,
and every phone plays it.

## Sending takes to the cloud

Syncing the whole recordings folder means syncing every failed attempt, and
most of a rehearsal is failed attempts. So the cloud folder is a separate
place — set it in Settings, to a folder some Drive or Dropbox client is
already watching — and only takes worth keeping go there. A failed attempt is
discarded on the review screen and never becomes a take at all, so "the takes
you saved" is already the list you would have picked by hand.

Two ways to get them there, and they do the same work underneath:

- **By hand**, from the cloud button on the take, after listening. Right for
  one take out of an old rehearsal, or one the setting below skipped.
- **On their own**, if **Send saved takes automatically** is ticked in
  Settings. Every take you keep is copied in the background, in the gap after
  it is saved: no copy is begun while a take is recording, because mixing one
  is not something to start competing with the sound card. The take says
  where it has got to: "Waiting for the cloud", "Copying to the cloud", the
  green cloud button once it is there, or "Not in the cloud" with the reason
  when something went wrong.

The setting needs a cloud folder and is greyed out until there is one.
Forgetting the folder switches it off again, rather than leaving every take
failing to reach nowhere.

Either way, three things can be sent — by hand it is asked per take, and
automatically it is chosen once in Settings:

- **The mix** — one stereo .wav with the balance set in the player. This is
  what gets sent to people; nobody's phone is going to open eight files. The
  level is pulled down automatically if the sum of the tracks would clip, and
  by how much is recorded.
- **The original tracks** — every track as recorded, untouched, for opening in
  a DAW later.
- **Both.**

The cloud button turns green once a take is up there, so the list shows at a
glance what has been shared. Sharing the same take again replaces the earlier
copy instead of piling up duplicates, and "Remove from the cloud" deletes the
copies while leaving the recording itself alone.

A copy remembers what it was made from: the take's name, what was sent, the
format, the balance the mix was rendered with and the folder it went into.
Change any of those — rename the take, move a fader, choose another format,
point at a different cloud folder, rename the rehearsal — and the takes of
the rehearsal in progress are sent again, replacing what was there. Change
nothing and nothing is mixed twice for no reason. Older rehearsals keep what
they sent; the cloud button is there for redoing one of those by hand.

When the folder is not there — a client logged out, a drive unplugged — the
take says so instead of failing quietly, and the next take you save sweeps up
whatever could not be sent while it was gone. Nothing about a failure touches
the recording itself.

**What the copies are written as** is a setting, because the trade is
different for everyone's connection:

- **As recorded** — plain WAV, exactly the files on disk.
- **Lossless (FLAC)** — around half the size for real music, and it decodes
  back to the identical samples, 16- and 24-bit alike. Nothing is given up
  but upload time.
- **Compressed (MP3)** — roughly a tenth, and lossy; variable bitrate, which
  works out around 320 kbps for a stereo mix and 128 for a mono track, the
  same quality per channel. Right for a mix the band listens to on phones,
  wrong for tracks headed into a DAW.

Only the copies are affected. What was recorded stays untouched WAV on disk —
it is the one thing here that cannot be made again, and it is not going
through an encoder to save space on a drive that costs less than a cymbal.

This goes through libsndfile, via the `soundfile` package, which arrives as a
prebuilt wheel of about a megabyte on macOS, Windows and Linux. Nothing to
install by hand and no external program.

It did not start that way. The first version shelled out to `afconvert`,
reasoning that another native audio library was a bad idea after this project
had already had one memory fault. That reasoning was applied too widely:
afconvert only exists on macOS, so the feature quietly did nothing on Windows
— and the fault it was guarding against was in the recording path, where a
realtime callback runs and a crash costs a take. This runs afterwards, on a
copy, in an ordinary call. Different risk, and the wrong place to have been
careful at the cost of the feature not working at all.

Files are converted a block at a time, so a twenty-minute eight-track take
does not have to fit in memory to be compressed. If `soundfile` is missing the
copy stays a WAV and Settings says so. That FLAC round-trips bit-for-bit at
both depths is checked by the test suite, not assumed.

## Space instead of the mouse

On every screen the spacebar does the main thing, so nobody has to reach for
the mouse mid-rehearsal: start the rehearsal, start the take, stop recording,
play/pause while listening. On screens with a player the left and right arrows
seek ±10 seconds. The `Space` hint is shown next to the button. Shortcuts do
not fire while the cursor is in a text field. Escape closes the take you are
listening to on the rehearsal screen, which hands the spacebar back to starting
a new take on the same screen; while a dialog is open, Escape belongs to the
dialog.

## Theme and scale

The theme (dark, light or match system) and the interface scale (90–150%) are
set in Settings and remembered between launches.

They are stored in two places, deliberately. The real one is the config, next
to the other settings (`~/.rehearsal-recorder/config.json`); the copy in
localStorage exists so the appearance can be applied before the first paint,
while the bridge to Python is still coming up. Otherwise the window would show
a dark interface for a fraction of a second to somebody who chose light. If
they disagree, the Python config wins.

Scale changes the root font size, and the whole layout is in rem — so the
padding, the buttons and the waveform grow with it, not just the text.

## Where the files are

```
~/RehearsalRecordings/Tuesday jam - 2026-09-18 19-00/
  session.json              ← the take list; History is built from it
  _drafts/
    take 3/                 ← being written right now, while recording
      Guitar 1.wav
      Vocals.wav
  01 - Verse riff/          ← saved take 1
  02 - Verse riff 2/        ← saved take 2
```

Until a take is saved it is written to `_drafts` inside the rehearsal folder,
next to `session.json`, rather than a system temp folder — the path is
predictable and visible in Finder. "Save take" moves the files into the take's
own folder, "Discard" deletes them, and an empty `_drafts` folder cleans
itself up.

## What protects a recording

- **Continuous write.** Every track is written to disk as it is played, and
  every 30 seconds the files are forced out (flush + fsync). A crash costs the
  last ~30 seconds at most, not the take.
- **Disk space.** The setup screen shows how long the disk will last at the
  current track count, rate and depth. While recording it is rechecked every
  couple of seconds, and the status line turns into a warning before it
  becomes a problem.
- **The interface falling out.** If the audio interface disappears mid-take,
  the app notices and stops the recording itself. What was recorded up to that
  point becomes normal .wav files and lands on the review screen instead of
  vanishing.
- **If the app dies mid-take.** The raw audio is still in `_drafts`. On the
  next launch, before anything else, the app offers those takes: recover one
  and it becomes a normal take in its rehearsal, or discard it and it goes to
  the Trash. Nothing is decided silently.
- **Empty rehearsals** — folders with no saved take and no audio at all — are
  cleaned up on finishing a rehearsal and on opening History, so the list does
  not fill up with nothing. A folder holding an unrecovered draft is left
  alone: there is a real recording in it.
