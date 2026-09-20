# Changelog

Notable changes, newest first. Versions follow [semantic
versioning](https://semver.org/): until 1.0 the shape of things can still
move, though recordings on disk are never left behind — old rehearsals keep
opening.

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
