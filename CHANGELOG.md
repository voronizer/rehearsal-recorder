# Changelog

Notable changes, newest first. Versions follow [semantic
versioning](https://semver.org/): until 1.0 the shape of things can still
move, though recordings on disk are never left behind — old rehearsals keep
opening.

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
