# Using it

What each screen is for, and the decisions behind how they behave.
## Screens

- **Setup** — rehearsal name and the list of tracks (name + input number),
  with a line showing which interface and quality it will record with; that
  line is a button to Settings, where those are chosen, and it states how
  many inputs the card has, since that governs the list below it. The band —
  the track names, in order — and each interface's input numbers are saved
  separately (`~/.rehearsal-recorder/config.json`) and filled in next time;
  see "Changing the interface" below. "Check signal" opens the inputs without recording: everyone plays in
  turn and watches the bar move next to their own name. Free disk space is on
  screen the whole time, next to "Add track".
- **Settings** (the gear in the header) — four groups rather than one long
  column, because six sections stacked in a row was a wall nobody could scan:
  **Audio** (the recording interface, rate and depth; the card used for
  playback and, on a card with more than two outputs, which pair — or which
  single output — the takes come out of; on Windows each card through its
  driver first, since one card offers a different number of inputs through
  each), **Folders** (where rehearsals go, where cloud copies go, whether
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
  does not start reading audio files nobody asked for; until then the space
  where the player goes shows the evening — the songs with their goes and
  lengths, and every note left while listening, each of which opens its take
  at that spot. History shows the same overview for a past rehearsal. Clicking a take again
  keeps it open — selecting is sticky.
- **Recording** — a large timer, a level meter per track, and a status line
  that is always visible: interface connected, how much recording time the
  disk has left, and any warning. The meter shows the state as well as the
  level: fine / silent / clipping.
- **Review** — straight after stopping: the player (below), a name field, and
  "Save take" or "Discard". Above the buttons it says whether the take will
  go to the cloud folder, with a box to decide otherwise for this take alone;
  the setting in Settings is not changed by it. Markers work here too, which takes explaining: the
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
Renaming a take moves its files on disk, so the player reopens it from the
start: the take stays open and on screen, but playback and the A–B region do
not survive the rename.

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
The stretch says its own length, written on the band. Beside **Repeat** there
is only a **Clear**. That used to be a pair of buttons, A and B, that put an
edge at the playback position — the only way to place one to the tenth of a
second, until the timeline learned to zoom, where a drag is finer than that. The playhead
has a grip of its own on the ruler: dragging that scrubs, which is what
dragging the waveform used to do.

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
- **Repeat** loops: the whole take, or just the stretch marked on the
  timeline when there is one. The region is independent of repeat, so you can
  draw it in advance and switch looping on when you want it, and **Clear**
  puts it back to the whole take.
- **Transport.** To start (|◀), ±10 seconds, click the timeline to seek. At
  the end of a take the player returns to the start instead of sitting at the
  tail.
- **The balance is remembered.** Track volumes are stored by name in the
  config and picked up on the next take and after a restart.

### Trimming a take

Mark the part worth keeping — drag across the tracks — and press **Crop**. The take becomes that part: same number, same name, and the
markers inside it move along with the audio. What is removed is not destroyed;
it goes to the Trash, or a `_deleted` folder where there is no Trash to reach,
as one folder named after the take, so the audio of an over-eager crop comes
back by dropping that folder's files into the take folder. The audio is all
that comes back: the take's stored length is still the short one, and the
markers stay where the crop moved them, with the ones outside it still gone.

**Crop** is greyed out for two kinds of region: one shorter than a second,
which at that length is far more likely a slip of the mouse than an intention,
and one that covers the whole take, which has nothing to remove. Both are worth
knowing, because a greyed-out button beside a region you have just drawn
otherwise looks broken.

Two things worth knowing. Markers outside the region go with the audio they
pointed at, and the question says how many before you agree. And a take that
has been copied to the cloud folder loses that copy when it is cropped — the
copy is of a different take now. With automatic sending on the cropped take is
queued straight away and goes up by itself; with it off, send it again by hand
when you want it there.

Cropping works right after recording as well, on the review screen, which is
usually where you can see the twenty seconds of nothing at the start.

### Looking closer

The whole take is on screen by default, which for a nine-minute take is about a
second and a half per centimetre. Roll the wheel over the tracks to zoom in —
the moment under the pointer stays under the pointer — and two fingers sideways
(or Shift and the wheel) to move along the take. The waveform is redrawn for
the part on screen, so zooming in shows detail rather than a stretched picture.
**Whole take**, at the left of the ruler, gives it all back. Zooming stops at
two seconds across the screen; closer than that is detail nobody is looking for
and a gesture that has become twitchy.

The wheel over the track names on the left still scrolls the list of tracks, so
a rehearsal with eight of them is still reachable.

While a take is playing the window follows the playhead. If you move along the
take by hand it stops following until the playhead comes back into view.

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
An ASIO card is the exception: ASIO answers about the rate and says nothing
about the depth, so a rate it takes is offered at both — and it is asked once
per rate rather than once per combination, because each question loads and
unloads the driver in full and ASIO drivers do not enjoy being cycled.

A card can also refuse to answer at all, which is not the same as answering
"none of those" — and the screen now says which happened. It used to fall
back to the usual three rates in silence, so a card that said nothing looked
exactly like one that said yes to everything. An XR18 has no 96 kHz at all
and takes only the rate its own mixer is set to, yet all three were offered
as though it had confirmed them.
If a saved choice stops being possible (a different interface, a different
setup) the app moves to one that works rather than failing at the moment
everyone is ready to play. The setup screen's disk estimate follows whatever
is chosen.

Old rehearsals keep working untouched. Playback, waveforms and the cloud
mixdown all read both depths, and a take can even hold tracks of each. The
mixdown itself is written 16-bit on purpose: it is what gets sent to people,
and every phone plays it.

## Changing the interface

The band is one list. Who is in it — the track names, in order — is the same
whatever is plugged in. Where each of them is plugged in belongs to the card:
input 3 on an eighteen-input desk is somebody's guitar, and on a two-input
box it does not exist.

So each interface remembers where people are plugged in on it, and nothing
else. Rehearse on the desk, record at home on a small box, come back next
week: each card brings its own input numbers back, and the band is the same
on both. Nobody is lost by changing the interface.

Someone the card has never seen — a new member, or the first time that card
is used at all — goes on the lowest input nobody else is on. Worth a glance:
the app knows the input is free, not that anything is plugged into it.

Where the band outnumbers the card's inputs, everybody still appears, and the
ones who do not fit arrive with no input at all, marked. The rehearsal will
not start until they have one. Which musicians sit out is not a decision the
app makes: five people do not fit on a two-input box in any arrangement, and
which three to leave out is the band's answer.

Removing a track removes that person everywhere, because the band is one
list. Interfaces remember sockets, not membership.

### An interface switched on after the app

The list of interfaces is made once, when the app starts — that is how
PortAudio, the audio library underneath, works. A desk switched on or plugged
in afterwards is not in it, and at a rehearsal that is the usual order of
things: the laptop is opened first, and an XR18 takes longer to start than a
laptop does to wake.

When the interface chosen in Settings is not there, the setup screen says so
— "“X18/XR18” is not connected" — rather than recording from something else,
and offers **Look again**. Press it once the desk is on. When it turns up,
the tracks take the inputs that desk remembers, and any names changed in the
meantime are kept. Settings has the same button beside Recording, for picking
an interface that was not there a moment ago; it looks for playback devices
at the same time.

Looking again is never done while recording, and never on its own. On
Windows it starts every ASIO driver on the machine in turn, the same as when
the app opens, which is not something to do in the middle of a song. A take
that is open in the player keeps its place and carries on.

## Recording an instrument in stereo

A keyboard has two outputs. So does a pair of microphones over a drum kit, or
a stereo room mic. Recorded into one mono file, half of what arrived is
thrown away; recorded as two tracks, they are two tracks — two lanes, two
faders, and nothing saying they belong together.

The **Stereo** button on a track takes the input after its own as well, and
writes the pair as one two-channel file. The input control then reads a pair,
`Inputs 9–10`, and offers only the inputs a pair can start on — the last
input of a card is not one of them.

Both inputs have to be free. Turning stereo on where the next input is
already somebody else's leaves the track waiting for an input rather than
quietly recording the same signal into two tracks, and the screen says which
track is waiting.

Being stereo belongs to the instrument, not to the card: the keyboard has two
outputs wherever it is plugged in, so it stays stereo when you change
interfaces, and each card remembers which pair it sits on.

Levels and waveforms are kept per channel, and this is the reason to bother.
A meter is one bar split along its length — left above, right below — and the
player draws a stereo lane with its left channel above the centre and its
right below. An overhead that stopped arriving is visible at the moment it
stopped, instead of being covered by the microphone that still works. The
signal check waits for both sides before it calls a track checked.

A stereo track costs twice the disk of a mono one, which the estimate on the
setup screen counts. It has no balance control: a rehearsal is not panned.

## When the card will not open

Checking the signal, or starting a take, can fail with a message ending in
`[PaErrorCode -9999]`. That number carries no meaning of its own: it is
PortAudio saying "the driver refused and told me nothing useful". It comes up
almost only on Windows with ASIO.

The app can ask the card why. From a terminal, in the folder the app was
unpacked into:

```
RehearsalRecorder.exe --audio-probe
```

It opens the saved card several times over, changing exactly one thing each
time — two channels instead of eight, the rate the driver is already at, the
block size left to the driver, the outputs opened alongside the inputs — and
reads the answer off which attempts got in. Then it says what to do about it.
Add an index from the list it prints to ask about a different card.

The common answer is the dull one: an ASIO card belongs to one program at a
time, and something else has it — a DAW, the card's own mixer or control
panel, or a second copy of this app. Close those and the check works. If
nothing at all opens and nothing else is running, the card is unplugged or its
driver wants reinstalling.

If the probe says the driver will only hand over its inputs together with its
outputs, record through WASAPI instead for now: the same card is listed there
too, with fewer inputs but no such condition.

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
seek ±10 seconds, Home goes back to the start, M drops a marker and R turns
Repeat on and off; **?** lists them. The main button of each screen shows
its key, and only while the key presses it: with a take open Space plays the
take instead of recording, and Escape is not on Finish because it closes the
take first.
Shortcuts do not fire while the cursor is in a text field.

Escape means one level up, and it takes one rung per press. A dialog closes
first, because while one is open it is the topmost thing on screen. Then the
take you are listening to, which on the rehearsal screen also hands the
spacebar back to starting a new take. Then the screen itself: out of a
rehearsal in History into the list, out of the list, out of Settings, and out
of a rehearsal by finishing it, which is the only way up from that screen.

Where the rung is a decision, Escape asks rather than taking it. Finishing a
rehearsal that has takes in it asks, because doing it by accident leaves the
rest of the evening in a second folder; an empty rehearsal does not, because
there is nothing to protect and Python removes the folder anyway. On the
review screen, where the only ways out are saving and giving the take up, it
asks too: the take was played seconds ago and cannot be played again, and a
key pressed by accident is exactly what a confirmation is for. The buttons
themselves — Finish, Discard — do not ask, because pressing a labelled button
is not an accident.

The one thing Escape never touches is a recording in progress. Stopping a
take is a deliberate act with a button, and only that.

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
~/RehearsalRecordings/
  library.sqlite                  ← the history — every rehearsal, take,
                                     marker and cloud copy; History is built
                                     from it
  Tuesday jam - 2026-09-18 19-00/
    _drafts/
      take 3/                     ← being written right now, while recording
        Guitar 1.wav
        Vocals.wav
    01 - Verse riff/               ← saved take 1
    02 - Verse riff 2/             ← saved take 2
```

Until a take is saved it is written to `_drafts` inside the rehearsal folder
rather than a system temp folder — the path is predictable and visible in
Finder. "Save take" moves the files into the take's own folder, "Discard"
moves them to the Trash — the same place everything else deleted in this app
goes, and for the same reason: a take recorded two minutes ago is the one
recording in the whole app that cannot be made again. An empty `_drafts`
folder cleans itself up either way.

Older rehearsals used to keep their own `session.json` in each folder; those
are moved into `library.sqlite` the first time this version opens the
recordings folder, and the `session.json` is then removed — nothing to do by
hand. If a rehearsal's folder is later moved, renamed by hand from outside the
app, or is simply not there — a drive not plugged in, say — it still shows up
in History, marked "Not found on disk", with "Locate folder…" to point it at
where the folder is now and "Remove from history" to drop it without touching
whatever is on disk. "Locate folder…" takes only a rehearsal that really is
missing, and only a folder that is not part of another rehearsal.

Going back to an older version after this one has opened the recordings
folder:

- **A version from before the history moved into `library.sqlite`** opens
  the folder fine but shows an empty History, because the `session.json`
  files it looks for are gone. Nothing is lost: the recordings are untouched,
  and whatever that old version records writes its own `session.json`, which
  is moved in the next time this version opens the folder.
- **A version with `library.sqlite`, but older than the one that last opened
  the folder,** may not open it at all: when a newer version has reshaped the
  database for changes the older one has never heard of, the older app says
  so and leaves the folder alone rather than guess.

The recordings folder belongs to one computer. Keep it on this computer's own
disk — not in a folder a Drive or Dropbox client syncs, and not on a network
share — and do not open it from two computers at once. The database is a file
beside the audio that is changed while the app runs: a sync client can upload
it half-written or make conflicting copies of it, two computers on one synced
folder each end up with a history of their own, and SQLite cannot keep it
safe on a network drive. To move or copy the recordings folder — to a new
drive or a new computer — close the app first, then move the whole folder. For
sharing takes with the band, that is what the cloud folder is for.

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
  alone: there is a real recording in it. So is a folder with any other file
  in it at all — a set list dropped in, or someone's own files in a folder
  "Locate folder…" was pointed at: only a folder with nothing left in it but
  empty folders is removed.
