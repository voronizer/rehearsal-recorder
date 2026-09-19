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
**`build.command`** on macOS or **`build.bat`** on Windows. It makes its own
environment inside this folder, builds the app, tests it, and tells you where
it landed. You need Python installed for that step; the app it produces does
not.

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
attempts, so nothing syncs by itself: you pick a take, pick the mix or the
original tracks, and it is copied to a folder your Drive or Dropbox client
watches — as WAV, FLAC or MP3.

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

macOS and Linux:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Windows:

```
py -3 -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
py -3 app.py
```

Node is not needed to run it — the built interface is committed in
`ui/dist/`. It is needed to change the interface:

```bash
cd ui && npm install && npm run build
```

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
app.py                   entry point: the window, crash log, --selftest
api.py                   the bridge to JS: rehearsals, takes, devices, history
platform_support.py      where macOS, Windows and Linux differ — all of it
mediaserver.py           the local HTTP server (interface, audio, polling)
audio/capture.py         multichannel capture with continuous write
audio/player.py          playback and mixing of a take
audio/monitor.py         listening to inputs without recording
audio/waveform.py        waveform peaks from a .wav
audio/mixdown.py         bouncing a take down to one stereo .wav
audio/drafts.py          unsaved takes: finding, describing, finalizing
audio/devices.py         the stream lock, and asking a card what it can do
audio/format.py          16- and 24-bit: packing, unpacking, what each costs
audio/encode.py          compressing cloud copies (FLAC/MP3 via libsndfile)
ui/src/screens/          one file per screen
ui/src/components/       player, waveform, take list, meters, dialogs
ui/dist/                 the built interface, committed
tests/                   the three suites
rehearsal-recorder.spec  how the app is packaged
```

Several decisions in here look odd until you know why — playback in Python
rather than the browser, the meters deliberately not using the pywebview
bridge, raw PCM on disk instead of WAV while recording. Those are written
down in [docs/design-notes.md](docs/design-notes.md), along with the ones
that were wrong the first time.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports about something that went
wrong at an actual rehearsal are the most useful thing there is.

## License

MIT — see [LICENSE](LICENSE).
