# Working on it

Two halves that have to be running at once: Python does the audio, and a web
interface draws it. How you run them depends on which half you are changing.

## Once, after cloning

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -e .

cd ui && npm install && cd ..
```

`-e` is an editable install: the package is registered but the files stay
where they are, so an edit under `src/` takes effect on the next run with no
reinstall. It reads its dependency list from `requirements.txt` through
`pyproject.toml`, so there is still only one list.

Playwright too, if you want to run the interface suite:

```bash
pip install playwright && playwright install chromium
```

## Changing Python — the audio, the API, the packaging

```bash
cd ui && npm run build && cd ..   # once, unless you are changing the interface
python3 -m rehearsal_recorder
```

`rehearsal-recorder` on its own does the same thing — `pip install -e .` puts
that command in the venv.

`npm run build` writes `ui/dist`, which is what the app serves. It is not
committed — it is build output — so a fresh clone needs this once before the
app will start. Run without it and the app says so instead of opening an
empty window.

Restart after a Python change. There is no reload; the audio engine holds
open streams and file handles, and restarting is both faster and less
surprising than trying to swap them underneath.

## Changing the interface — with hot reload

Two terminals.

```bash
# terminal 1 — Vite, on port 5173
cd ui && npm run dev

# terminal 2 — Python, in development mode
python3 -m rehearsal_recorder --dev
```

The window opens Vite's dev server instead of the built bundle, so edits to
anything under `ui/src/` appear immediately, with React state kept where it
can be. Python still does all the audio.

The two halves are wired together like this: the bridge (`window.pywebview.api`)
is injected by pywebview into whatever page is loaded, so it works unchanged.
The calls that do **not** go over that bridge — `/api/...` for everything the
meters poll, `/media/...` for the audio the player reads — are forwarded by
Vite to the Python server. That is the `server.proxy` block in
`ui/vite.config.ts`, and it is why the Python server takes a fixed port
(`DEV_SERVER_PORT` in `src/rehearsal_recorder/app.py`) in this mode rather
than a random one: a config file cannot be told a number that is picked at
startup.

If the window opens but every meter sits at zero, the forwarding is what to
look at. The two ports have to agree — 17817 in `app.py` and in
`vite.config.ts`, 5173 for Vite itself.

## Before committing an interface change

```bash
cd ui && npm run build && cd ..
python tests/run_all.py
```

The interface suite drives `ui/dist`, not `ui/src`, so a change that has not
been built is a change the tests cannot see.

## Tests

```bash
python tests/run_all.py
```

Three suites and what each is for: [tests/README.md](../tests/README.md).

## Packaging it into an app

```bash
./build.command        # macOS — or double-click it in Finder
build.bat              # Windows
```

They are in the repository root rather than in `packaging/` because
double-clicking them is the point. What they drive — the PyInstaller spec —
lives in `packaging/`.

Builds the interface, makes a private venv, packages everything with
PyInstaller, and runs the built app's own self-test. Details and what the
self-test is for: [building.md](building.md).

## A few things that will save you time

**The audio callback must not allocate.** Buffers are preallocated and
reused, peaks use scalar comparisons, nothing prints. That thread has a
deadline.

**Platform differences go in `platform_support.py`**, all of them. Scattered
`sys.platform` checks are how this quietly became macOS-only once already.

**`~/.rehearsal-recorder/config.json`** holds the settings, and
`~/RehearsalRecordings/` the takes. Delete the config to see what a first run
looks like.

**`~/.rehearsal-recorder/crash.log`** gets a Python traceback for every
thread if the process dies hard — including the threads that are not yours.

**`packaging/run-debug.sh`** (macOS) runs the app with the allocator checking
itself on every operation. Slow, but a memory fault lands on the bad write
instead of on some innocent allocation later.

## Where things are

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
  audio/crop.py             cutting a take down to the part worth keeping
  audio/drafts.py           unsaved takes: finding, describing, finalizing
  audio/devices.py          the stream lock, and asking a card what it can do
  audio/format.py           16- and 24-bit: packing, unpacking, what each costs
  audio/encode.py           compressing cloud copies (FLAC/MP3 via libsndfile)

ui/src/screens/             one file per screen
ui/src/components/          player, timeline, waveform, take strip, dialogs
ui/dist/                    the built interface (build output, not in git)

tests/                      the three suites
docs/                       this file and its neighbours
packaging/                  the PyInstaller spec and the debug-allocator run
build.command, build.bat    in the root because you double-click them
pyproject.toml              how the package installs; deps come from
                            requirements.txt, which stays the one list
```

Nothing but the entry points, the package metadata and the files GitHub
insists on reading from the root (`README`, `LICENSE`, `CHANGELOG`,
`CONTRIBUTING`, `.github/`) lives there.

Several decisions in here look odd until you know why — playback in Python
rather than the browser, the meters deliberately not using the pywebview
bridge, raw PCM on disk instead of WAV while recording. Those are written
down in [design-notes.md](design-notes.md), along with the ones that were
wrong the first time.
