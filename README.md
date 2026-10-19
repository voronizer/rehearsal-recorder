# РЭХА

Multitrack recording for band rehearsals. One track per musician, written to
disk as you play, a take you can listen back to the second you stop, and a
history of every rehearsal you have ever had.

РЭХА is Belarusian for “echo”, and it sounds a little like “rehearsal”.

Built for the room it is used in: nobody is watching the screen while the
band plays, nobody is riding the gain, the laptop might get kicked, and there
may be no internet.

![A four-piece take open in the player: drums, bass, guitar and vocals on one timeline, with coloured marks and the bridge selected to repeat](docs/screenshots/player.png)

## Get it

Download the zip for your system from
[Releases](../../releases), unpack it and open Reha. Nothing to install:
Python, the audio libraries and the app's screens are all inside.

**On Windows, unblock the zip before you unpack it.** Right-click the
downloaded file, choose **Properties**, tick **Unblock** at the bottom, then
unpack it. Windows flags everything that arrives from the internet and
passes that flag on to every file unpacked from a flagged archive. It will
not load the app's audio libraries while they carry it, and the app then
fails to start with errors that do not say why. Unblocking the zip clears
the flag for everything inside in one go. Unpack first and you are
unblocking fifty files by hand.

The first time you open it, on macOS right-click it and choose **Open**
instead of double-clicking; on Windows click **More info**, then **Run
anyway**. You do this once, because the app is not signed with a paid
developer certificate. After that it opens normally. macOS also asks for
microphone permission the first time you record.

When a newer version is out, a dot appears on the gear on the start
screen. **Download** in **Settings › Under the hood** fetches it into your
Downloads folder. On Windows a zip the app downloads itself carries no
flag, so there is nothing to unblock. To find out, the app asks GitHub which
version is the latest when it starts and once a day, and sends nothing
else. **Check for new versions**, in the same place, switches that off.

No release yet, or you want to build it yourself? Double-click
**`build.command`** on macOS or **`build.bat`** on Windows, at the top of
this folder. Each sets up its own environment inside the folder, builds the
app's screens, packages the app, tests it, and tells you where it landed.
Building needs Python and Node installed; the app it makes needs neither.

## What it does

**Records every musician to their own track** and keeps writing to disk the
whole time. Every 30 seconds it makes sure all of it is safely on the disk.
If the app dies or someone trips over the interface, you lose seconds, and
the next launch offers the interrupted take back to you. While a take
records, the laptop and its screen stay awake; if the lid is closed anyway,
the take ends there with everything before it kept.

**Tells you it is fine while it is running.** The interface is connected, the
disk has room for this long, the battery needs the charger, this input is
clipping, that one is silent. All of it is on screen during the take, because
that is the only moment anyone would act on it.

**Plays the take back immediately**, all tracks in sync, with per-track
volume, mute and solo, and marks you drop on a moment while listening. Every
track shares one timeline, so you can point at the moment two of them drifted
apart. Drag across it to pick a part to repeat, and zoom in with Ctrl (⌘ on
a Mac) and the mouse wheel when you need the exact spot.

**Marks say what happened.** Each mark has a label (Keep this, Went wrong or
one of the band's own) and, if you like, a comment. The label's colour shows
on the timeline and beside each take in the strip over the player, so a
glance says which take has red in it. History lists every mark of a label
from every rehearsal, so every Went wrong is in one list, each playing from
just before it.

**Tells you what a rehearsal was.** Months later, nobody recognises a
rehearsal by its date and number of takes, so each one says what was played
in it, how long it ran and what it weighs on disk. It is read from the take
names, so nothing extra has to be filled in while you are playing.

**Sends the good ones to the cloud.** A rehearsal is mostly takes that went
wrong, so the whole recordings folder does not sync. Only the takes you keep
are copied, to a folder your Drive or Dropbox app syncs, as WAV, FLAC or MP3.
Pick them one at a time, or switch on automatic sending and every take you
save goes up on its own. It sends between takes, never while one is
recording.

**Records at the quality your interface can do.** 16- or 24-bit, at 44.1, 48
or 96 kHz, and only the combinations your interface accepts are offered: the
app asks it before showing the choice. If it does not answer, Settings says
so. 24-bit is the default: at a rehearsal nobody watches the gain, and the
headroom is worth the extra disk space.

**Never destroys anything.** Anything you delete goes to the Trash (the
Recycle Bin on Windows), or to a `_deleted` folder when there is neither to
reach. A recording of a rehearsal cannot be made again.

## Where the rest of it is

- [docs/using-it.md](docs/using-it.md): the guide, with a picture of every
  screen. It follows a rehearsal from setting up to sharing the good takes,
  and says what to do when something goes wrong.
- [docs/development.md](docs/development.md): running it from source, the
  hot-reload loop, and what every file in here is for.
- [docs/building.md](docs/building.md): packaging it into an app, and
  cutting a release.
- [docs/design-notes.md](docs/design-notes.md): the decisions that look odd
  until you know why, including the ones that were wrong the first time.
- [docs/design-system.md](docs/design-system.md): how the screens look and
  work, with each rule, the reason for it and the component that carries it.
- [tests/README.md](tests/README.md): the test suites and what each is for.
  `python tests/run_all.py` runs the Python ones.
- [CHANGELOG.md](CHANGELOG.md): what changed, newest first.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), and
[docs/development.md](docs/development.md) for how to run it while you work
on it. Reports of something that went wrong at a real rehearsal help the
most.

## License

MIT. See [LICENSE](LICENSE).
