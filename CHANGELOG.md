# Changelog

Notable changes, newest first. Versions follow [semantic
versioning](https://semver.org/): until 1.0 the shape of things can still
move, though recordings on disk are never left behind — old rehearsals keep
opening.

## 0.7.4

- The band survives a change of interface. A saved track carried two facts
  welded into one record — the name, which belongs to the band and is the
  same wherever they play, and the input number, which belongs to the card.
  Input 3 on an eighteen-input desk is somebody's guitar; on a two-input box
  it does not exist. They are stored apart now: the band is one list of
  names, and each interface remembers which input each of those names uses
  on it. Rehearse on the desk, record at home on a small box, come back next
  week — each card brings its own numbers back, and the band is the same on
  both. Starting a rehearsal saves that layout, so nobody has to remember a
  button.
- A track with nowhere to plug in says so instead of going blank. Where the
  band outnumbers the card's inputs, everybody still appears and the ones
  who do not fit arrive with no input, marked, and the rehearsal will not
  start until they have one — which musicians sit out is the band's answer,
  not the app's. The input selector used to show an empty box for a track
  numbered past the card, and the first real word came from PortAudio when
  the signal check opened the card: `Invalid number of channels [PaErrorCode
  -9998]`, a number about a card for a mistake about a template.
- The setup screen says how many inputs the interface has, beside the rate
  and the depth. That count governs every row of the track list underneath
  it and was the one thing not on screen.
- A card that will not say which rates it takes says so, instead of being
  shown as a card that takes all of them. The list used to fall back to
  44.1, 48 and 96 in silence, so a card that answered nothing looked exactly
  like one that said yes to everything. An XR18 has no 96 kHz at all and
  takes only the rate its own mixer is set to.

## 0.7.3

- A card that refuses to open can be asked why. `--audio-probe` opens the
  saved card several times over, changing exactly one thing each time — two
  channels instead of eight, the rate the driver is already at, the block
  size left to the driver, the outputs opened alongside the inputs — and
  reads the diagnosis off which attempts got in, then says what to do about
  it. Needed because a refused ASIO stream reports `-9999`,
  paUnanticipatedHostError, which means only "the driver said no and
  PortAudio has nothing to add": nothing in the app could tell a card held by
  a DAW from tracks assigned past the card's inputs.
- Playback says why a card was not used, instead of blaming the rate. Every
  refusal was reported as the card not taking the take's sample rate, and
  pointed at Audio MIDI Setup — a program only macOS has, offered to Windows
  too. The commonest refusal is not about the rate: PortAudio answers
  `paDeviceUnavailable` when the card is already open, and on ASIO that is
  routinely this app's own recording, since a card reached through ASIO plays
  through one program at a time. So you pressed play while recording through
  your interface, heard it come out of the laptop speakers, and were sent to
  check a sample rate that was never the problem.
- ASIO drivers are loaded far less. Asking a card what rates it takes cost
  six full load-and-unload cycles of the driver — PortAudio answers each such
  question by loading it, initialising it, asking and unloading it again, and
  answers without ever consulting the sample depth. It is three now, one per
  rate, and the answer stands for both depths. Asking a playback card in
  advance cost another cycle on every take, immediately before an opening
  that loads the driver once more; ASIO cards are not asked at all now, the
  opening decides, and a refusal there falls back to the system output the
  way the check used to. ASIO drivers are known to be touchy about being
  cycled, and none of that churn was buying an answer.

## 0.7.2

- The cloud settings fit on the screen. What a copy is written as, and what
  gets sent automatically, were six full-width cards with a heading and a
  sentence each, for two questions answered once; they are rows of small
  buttons now, the way the theme and the scale already are, with the sentence
  kept for the choice in force. How a copy is written comes first, under the
  folder, because it holds whether or not sending is automatic — the takes
  sent by hand are written the same way.
- The cloud folder decides what that part of the screen shows. Without one
  there are no copies, so nothing about a copy is offered at all; the folder
  says the whole of it. It used to leave everything on screen, greyed, with
  three sentences explaining copies that could not happen — and, before that,
  live: a format could be chosen for files nothing was going to write.
- With a cloud folder set and automatic sending off, what would be sent is
  still shown, greyed, saying so. It used to vanish, which moved everything
  under it out from beneath the pointer.

## 0.7.1

- Escape on a rehearsal with takes in it flickered and stayed put: the
  question about finishing opened and closed on the same press, so the only
  way out of that screen was the button. New in 0.7.0, and the reason for
  this release.
- A dialog's answers can be reached from the keyboard. The left and right
  arrows, and Tab, move between them, and the question about finishing a
  rehearsal opens on **Keep going** — so Escape, an arrow, Enter ends a
  rehearsal without the mouse. This is the app's own doing now rather than
  the window toolkit's: on a Mac, Tab moved focus out of the page entirely
  unless macOS **keyboard navigation** had been switched on, which it is not
  unless you went looking for it.

## 0.7.0

- The rehearsal history moved from a `session.json` in every rehearsal folder
  into one database, `library.sqlite`, at the top of the recordings folder.
  Old rehearsals move themselves in the first time this version opens the
  folder — nothing to do by hand, and the recordings on disk do not change.
  An older version opened on the folder afterwards shows an empty History,
  since the `session.json` files are gone; nothing is lost — the recordings
  are untouched, and anything that old version records is moved in the next
  time this version opens the folder.
- Keep the recordings folder on this computer's own disk — not in a synced
  folder or on a network share — open it from one computer at a time, and
  move or copy it with the app closed: the history database in it is written
  while the app runs.
- A rehearsal whose folder cannot be found — moved, renamed outside the app,
  or on a drive that is not plugged in — stays in History instead of
  vanishing, marked "Not found on disk", with "Locate folder…" and "Remove
  from history".
- The cloud folder can be moved to a new place — another drive, another
  machine — without every take being sent again: a cloud copy is kept
  relative to the cloud folder, so it is found again wherever that folder is
  now instead of at the absolute path it was copied to.
- Settings are written atomically — beside the real file, then moved onto
  it — so an app killed mid-write leaves the old settings rather than half of
  new ones.
- On Windows, ASIO is offered. A 16-channel mixer was listed with 2 or 8
  inputs because the PortAudio loaded by default has no ASIO; the one with
  ASIO ships in the same package and is now loaded instead. Starting the app
  can briefly interrupt other sound playing through a device in exclusive
  mode — once, at launch.
- The recording interface and the playback output are chosen through their
  driver first when there is more than one, instead of one list with the
  same card in it four or five times. On a Mac nothing changes.
- Device choices are remembered by name and driver, not only by position in
  the list, so plugging something in no longer moves them. On Windows a
  choice saved by an older version has to be made once more.
- The self-test fails a Windows build that lacks ASIO.
- Playback can come out of any stereo pair of a card with more than two
  outputs — 3–4 into the headphone amp, say — or out of one output on its
  own. It used to be 1–2, always. Choosing another card starts it again from
  1–2, since a pair means something different on every card.
- On Windows, **Save take** did nothing: the button dimmed and stayed that
  way. The review screen plays the take it is asking about, and Windows will
  not move a file that is open for playing. Deleting a take or a rehearsal
  while it played failed the same way. The player now lets go of those files
  first. On a Mac the move had always worked, which is why this was not seen.
- On Windows a take or rehearsal could not be renamed to anything in
  Cyrillic — or in any script outside Western European — and nothing said
  so. The rehearsal's file and the settings were written in the system's
  code page, cp1252 there; they are UTF-8 now, and files an older version
  wrote are still read. Renaming the take that was playing also left its
  folder under the old name without a word; the player now lets go of it
  first. And a folder is never left renamed under a record that could not
  be written.
- Saving a take says whether it goes to the cloud folder — "Send to the
  cloud — the mix, MP3" — and the box can be turned the other way for that
  one take: a false start kept anyway need not go up, and the one good take
  of an evening can, with sending off. A take kept out stays out of later
  re-sends of the rehearsal too. With no cloud folder it says the take stays
  on this computer.
- When something fails inside the app, it says so. A red bar gives the
  error's own words and where the full traceback is kept
  (`~/.rehearsal-recorder/crash.log`, which a windowed build now actually
  writes it to), and the screen that asked gets an answer — a button no
  longer dims and stays dimmed. Saving a take and renaming one both failed
  on Windows with nothing on screen at all, which is what this is for.
- The keys are on the buttons they press: Space on the main button of each
  screen, Esc on Back, on Discard and on Finish. The line under the main
  button that said the same thing for Space alone is gone. A key is shown
  only while it really does that — with a take open Escape closes the take,
  so Finish loses its Esc until then.
- The player's keys are listed behind **?** (or the keyboard button at the
  end of the transport) rather than drawn on its small buttons, which kept
  the row as plain as it was. Three of them are new: Home goes to the start,
  M marks, R turns Repeat on and off. None of them fire while typing a name.
- An open rehearsal with no take picked shows the evening instead of one
  line asking you to pick a take: how long it ran, each song with its goes
  and their lengths, the takes nobody named, and every note left while
  listening. A take opens from there, and a note opens its take at the spot
  it was left. The strip of take pills is hidden meanwhile, since it only
  repeated the overview; it comes back once a take is open, to switch
  between them.
- In that overview, a take already copied to the cloud folder has a small
  cloud on its chip, so what still needs sending is visible without opening
  each take.
- A tick just before the end of a take no longer puts a sideways scrollbar
  under the last track on Windows.

## 0.6.1

- At the closest zoom the window read-out was cut off mid-word — `0:04 – 0:06
  · cl…` — because it does not fit beside the **Whole take** button on one
  line. It wraps instead. Found by regenerating the screenshots for the
  documentation, not by the tests, which check that the read-out is there and
  that its first tick is inside the window but not that all of it is legible.

## 0.6.0

- Each track's fader shows how loud that track is coming out, as a level
  behind the slider itself. What comes out is the source's peak times the
  fader, so it can never pass the thumb: the thumb is the ceiling you set,
  the green is how close the track is getting to it, and the gap between
  them is the headroom left. Measured in the mix, after that track's own
  fader and mute, rather than guessed from the waveform.
- The A and B buttons are gone. They existed to put an edge of the repeat
  region at the playback position, which was the only way to place one to the
  tenth of a second; the timeline zooms now, and a drag there is finer than
  that. The stretch says its own length on the band where it is drawn, so
  beside **Repeat** there is now only a **Clear** — which also stops being an
  unlabelled ×.
- Where something stops working, the app says why: the greyed-out **Crop**
  gives its reason beside the button rather than in a tooltip no disabled
  button can show, the zoom says when it will go no closer, and an interface
  listed once per audio system says so — which is how a card with sixteen
  inputs ends up offering two.

## 0.5.0

- A take can be trimmed to the region marked on the timeline. Most takes are a
  few minutes of music inside a longer recording — somebody walking back to the
  kit, a false start, the silence after everyone stopped — and until now there
  was no way to say so: the whole thing sat in history, in the size on disk,
  and in the time it took to find the part worth hearing again. Cropping keeps
  the take's number and name, moving the markers inside the region with the
  audio they pointed at — the rest go with what is removed. The originals go
  to the Trash, or a `_deleted` folder where there is no Trash to reach, as one
  folder named after the take, so they can be put back. A take that had been
  copied to the cloud folder loses that copy, because the copy is of a
  different take now; with automatic sending on it goes up again by itself.
- Cropping is offered on the review screen too, which is where the dead air at
  the start of a take is most obvious — you have just recorded it and can see it
  on the waveform.
- The timeline zooms. The wheel over the tracks zooms around the pointer, so the
  second under it stays under it; two fingers sideways, or Shift and the wheel,
  move along the take; **Whole take** returns. Fifteen seconds of a nine-minute
  take used to be twenty pixels wide, which made the region impossible to place
  accurately. The waveform is redrawn for the part on screen rather than
  stretched, so zooming in shows detail that was not there before.

## 0.4.0

- The player runs on one timeline across the window instead of a column in
  the middle of it. Every track shares the same time axis, so where one of
  them came apart is now a thing you can point at.
- The repeat region is drawn with the mouse across the tracks, in either
  direction, and its edges can be dragged afterwards. A press that does not
  travel still seeks, as it always did. A and B keep their jobs for when you
  have just heard the exact spot and want it to the tenth of a second.
- Takes in a rehearsal and in history are a strip along the top rather than
  rows that expand. The player sits below and stops moving when you switch
  takes.
- Escape means one level up, one rung per press: a dialog, then the take you
  are listening to, then the screen — out of a rehearsal in History, out of
  the list, out of Settings, and out of a rehearsal by finishing it. Where the
  rung is a decision it asks first: before finishing a rehearsal with takes in
  it, and before giving up a take on the review screen. An empty rehearsal it
  simply leaves. A recording in progress it never touches.
- Discarding a take on the review screen moves it to the Trash instead of
  deleting it. It was the one place left in the app where a recording was
  really destroyed, and the one that needed it least: that take was played
  seconds earlier and cannot be played again. It also refuses a path outside
  the recordings folder rather than removing whatever it is handed.

## 0.3.0

- A rehearsal in History says what was played in it: how long it ran and the
  songs, with the number of goes each one got — "Polyn ×3 · Vesna ×2 · Ogon".
  It is read from the take names, so nothing extra has to be filled in during
  a rehearsal; a rehearsal whose takes were never named says nothing rather
  than repeating its own take count.
- Each rehearsal also says what it weighs on disk, measured rather than
  estimated, and deleting one says how much space that gives back.

## 0.2.0

- The app says which version it is, under Settings → Under the hood, and in
  what `--selftest` prints. The number is the release tag itself, read at
  build time, so there is nothing to keep in step by hand.
- Saved takes can go to the cloud folder on their own. Switch on **Send saved
  takes automatically** in Settings and every take you keep is copied in the
  background, between takes rather than while one is recording, with the
  take's row showing where it has got to. A take that is renamed or remixed
  is sent again; one that has not changed is left alone. Off by default, and
  not offered until there is a cloud folder to send to.

Two changes to the repository:

- The built interface (`ui/dist`) is no longer committed. It is build output:
  the build scripts and CI produce it, and a clone builds it once with
  `cd ui && npm install && npm run build`.
- The Python moved into `src/rehearsal_recorder/`, installed with
  `pip install -e .` and started with `python3 -m rehearsal_recorder`. The
  PyInstaller spec and the debug-allocator script moved to `packaging/`;
  `build.command` and `build.bat` stayed in the root, because they are meant
  to be double-clicked.

## 0.1.0

First release. Everything below already works.

### Recording

- Multitrack capture, one track per input, written to disk continuously and
  forced out every 30 seconds, so a crash costs seconds rather than a take.
- 16- or 24-bit at 44.1, 48 or 96 kHz — only the combinations the interface
  actually accepts are offered.
- A signal check before the rehearsal: open the inputs without recording and
  watch each musician land on their own track.
- The status line during a take shows the interface is alive and how much
  recording time the disk has left. If the interface disappears mid-take the
  recording stops itself and keeps what it had.
- A take interrupted by a crash is offered for recovery at the next launch.

### Listening

- Playback and mixing in Python, so the output device can be chosen and
  memory stays flat however long the take.
- Markers with a note and a kind — a plain note, "keep this", "went wrong",
  "do again" — coloured on the waveform and on the take row. They can be
  placed on the review screen before a take is even saved.
- A–B repeat, ±10 second transport, per-track volume, mute and solo, with the
  balance remembered between takes.

### Keeping and sharing

- History of every past rehearsal, read from disk.
- Renaming takes and rehearsals, folders on disk renamed to match.
- Selected takes copied to a cloud folder as WAV, FLAC or MP3 — as a stereo
  mix, as the original tracks, or both.
- Deleting is never destruction: the system Trash where there is one, a
  `_deleted` folder where there is not.

### Running it

- macOS, Windows and Linux, packaged into an app with everything inside.
- A self-test the packaged app runs on itself, so a missing native library is
  found at build time rather than at a rehearsal.
