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

```
src/rehearsal_recorder/   the app — python -m rehearsal_recorder
ui/                       the interface; ui/dist is built, not committed
tests/                    the three suites
docs/                     this file and its neighbours
packaging/                the PyInstaller spec, the debug-allocator script
build.command, build.bat  in the root, because you double-click them
```

Nothing but the entry points, the package metadata and the files GitHub
insists on reading from the root (`README`, `LICENSE`, `CHANGELOG`,
`CONTRIBUTING`, `.github/`) lives there.
