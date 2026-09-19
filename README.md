# Rehearsal Recorder

Multitrack recording for band rehearsals. One track per musician, written to
disk as you play, a take you can listen back to the second you stop, and a
history of every rehearsal you have ever had.

Built for the situation it is actually used in: nobody is watching the screen
while the band plays, nobody is riding the gain, the laptop might get kicked,
and there may be no internet in the room.

![Recording, with a level meter per track](docs/screenshots/recording.png)

## Get it

Download the build for your system from
[Releases](../../releases), unzip, open. Nothing to install — Python, the
audio libraries and the interface are all inside.

The first launch has one hurdle, once, because the app is not signed with a
paid developer certificate: on macOS right-click it and choose **Open**
instead of double-clicking; on Windows click **More info** then **Run
anyway**. After that both open normally. macOS also asks for microphone
permission the first time you record.

No release yet, or you want to build it yourself? Double-click
**`build.command`** on macOS or **`build.bat`** on Windows — they are in the
root of this folder for exactly that reason. Each makes its own environment
inside the folder, builds the interface, packages the app, tests it, and
tells you where it landed. That step needs Python and Node installed; the app
it produces needs neither.

## What it does

**Records every musician to their own track** and keeps writing to disk the
whole time, forcing everything out every 30 seconds. If the app dies, the
laptop sleeps, or someone trips over the interface, you lose seconds — and
the interrupted take is offered back to you at the next launch.

**Tells you it is fine while it is running.** The interface is connected, the
disk has room for this long, this input is clipping, that one is silent. Not
buried in a menu: on screen during the take, because that is the only moment
anyone would act on it.

**Plays the take back immediately**, all tracks in sync, with per-track
volume, mute and solo, A–B repeat, and markers you drop while listening.

![A take with markers on the waveform](docs/screenshots/player-markers.png)

**Markers say what happened, not just where.** A note and a kind — keep this,
went wrong, do again — coloured on the waveform and on the take row, so a
glance at the list says which take has red in it.

**Sends the good ones to the cloud.** A whole rehearsal is mostly failed
attempts, so the recordings folder does not sync — only the takes you keep,
copied to a folder your Drive or Dropbox client watches, as WAV, FLAC or MP3.
Pick them one at a time, or switch on automatic sending and every take you
save goes up on its own, between takes rather than while one is recording.

**Never destroys anything.** Deleting means the Trash, or a `_deleted` folder
where there is no Trash to reach. A recording of a rehearsal cannot be made
again.

More on all of it in [docs/using-it.md](docs/using-it.md).

## Quality

16- or 24-bit, at 44.1, 48 or 96 kHz, and only the combinations your
interface actually accepts are shown — the card is asked before the choice is
offered rather than after it fails. 24-bit is the default: at a rehearsal
nobody watches the gain, and the headroom is worth the extra disk.

![Settings](docs/screenshots/settings.png)

## Running from source

Both halves have to be built: Python for the audio, Node for the interface.

macOS and Linux:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -e .
cd ui && npm install && npm run build && cd ..
python3 -m rehearsal_recorder
```

Windows:

```
py -3 -m venv venv
venv\Scripts\activate
pip install -e .
cd ui && npm install && npm run build && cd ..
py -3 -m rehearsal_recorder
```

`pip install -e .` installs the package in place, dependencies and all, so
the sources under `src/` are importable and edits to them take effect without
reinstalling. It also gives you a `rehearsal-recorder` command, which is the
same thing as the line above.

`npm run build` writes `ui/dist`, which is what the app serves. It is build
output, so it is not in the repository and a fresh clone needs that line once
— after which you only repeat it when you change something under `ui/src/`.
Start the app without it and it says so rather than opening an empty window.

Working on the interface itself is nicer with hot reload than with a rebuild
every time: `npm run dev` in one terminal, `python3 -m rehearsal_recorder
--dev` in another. That and the rest of the development loop is in
[docs/development.md](docs/development.md).

## Tests

```bash
python tests/run_all.py
```

Three suites: the audio itself with the sound card stubbed and the samples
inspected directly, the places the three operating systems differ, and the
built interface in a headless browser against a mocked Python bridge. They
run on every push and before every release build. See
[tests/README.md](tests/README.md).

## How it is put together

Python does the audio — capture, mixing and playback through
sounddevice/PortAudio, with numpy for the sample work. The interface is React
+ Tailwind + shadcn/ui, running in a pywebview window. A small local HTTP
server on 127.0.0.1 hands the interface its files, serves the audio to the
player, and answers the calls the meters poll many times a second.

```
src/rehearsal_recorder/     the Python application
  __main__.py               what `python -m rehearsal_recorder` runs
  app.py                    the window, the crash log, --selftest
  api.py                    the bridge to JS: rehearsals, takes, devices
  mediaserver.py            the local HTTP server (interface, audio, polling)
  platform_support.py       where macOS, Windows and Linux differ — all of it
  audio/capture.py          multichannel capture with continuous write
  audio/player.py           playback and mixing of a take
  audio/monitor.py          listening to inputs without recording
  audio/waveform.py         waveform peaks from a .wav
  audio/mixdown.py          bouncing a take down to one stereo .wav
  audio/drafts.py           unsaved takes: finding, describing, finalizing
  audio/devices.py          the stream lock, and asking a card what it can do
  audio/format.py           16- and 24-bit: packing, unpacking, what each costs
  audio/encode.py           compressing cloud copies (FLAC/MP3 via libsndfile)

ui/src/screens/             one file per screen
ui/src/components/          player, waveform, take list, meters, dialogs
ui/dist/                    the built interface (build output, not in git)

tests/                      the three suites
docs/                       how to use it, build it, work on it, and why
packaging/                  the PyInstaller spec and the debug-allocator run
build.command, build.bat    in the root because you double-click them
pyproject.toml              how the package installs; deps come from
                            requirements.txt, which stays the one list
```

Several decisions in here look odd until you know why — playback in Python
rather than the browser, the meters deliberately not using the pywebview
bridge, raw PCM on disk instead of WAV while recording. Those are written
down in [docs/design-notes.md](docs/design-notes.md), along with the ones
that were wrong the first time.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), and
[docs/development.md](docs/development.md) for how to run it while you work
on it. Bug reports about something that went wrong at an actual rehearsal are
the most useful thing there is.

## License

MIT — see [LICENSE](LICENSE).
