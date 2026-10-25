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

The activation lasts as long as the terminal does. In every new one, run
`source venv/bin/activate` again before any `python3` below. Without it
`python3` is the system's, which has none of this installed: it says `No
module named rehearsal_recorder`, or, run from inside `src/`, `No module
named 'webview'`.

The browser the interface's tests run in, once:

```bash
cd ui && npx playwright install chromium
```

Playwright for Python only takes the pictures in the docs
(`tests/docs_screenshots.py`) and draws the app's icons
(`packaging/make_icons.py`): `pip install playwright && playwright install
chromium` if you change either.

## Changing Python: the audio, the API, the packaging

```bash
cd ui && npm run build && cd ..   # once, unless you are changing the interface
python3 -m rehearsal_recorder
```

`rehearsal-recorder` on its own does the same thing: `pip install -e .` puts
that command in the venv.

`npm run build` writes `ui/dist`, which is what the app serves. It is build
output and not committed, so a fresh clone needs this once before the app
will start. Run without it and the app says so instead of opening an empty
window.

Restart after a Python change. There is no reload; the audio engine holds
open streams and file handles, and restarting is both faster and less
surprising than trying to swap them underneath.

## Changing the interface, with hot reload

Two terminals.

```bash
# terminal 1 — Vite, on port 5173
cd ui && npm run dev

# terminal 2 — Python, in development mode
source venv/bin/activate          # Windows: venv\Scripts\activate
python3 -m rehearsal_recorder --dev
```

The window opens Vite's dev server instead of the built bundle, so edits to
anything under `ui/src/` appear immediately, with React state kept where it
can be. Python still does all the audio.

pywebview injects the bridge (`window.pywebview.api`) into whatever page is
loaded, so it works unchanged. Vite forwards the calls that do **not** go
over that bridge to the Python server: `/api/...` for everything the meters
poll, and `/media/...` for the audio the player reads. That is the
`server.proxy` block in `ui/vite.config.ts`, and it is why the Python server
takes a fixed port (`DEV_SERVER_PORT` in `src/rehearsal_recorder/app.py`) in
this mode rather than a random one: a config file cannot be told a number
that is picked at startup.

If the window opens but every meter sits at zero, look at the forwarding. The
ports have to agree: 17817 in `app.py` and in `vite.config.ts`, and 5173 for
Vite itself.

## Before committing an interface change

```bash
cd ui && npm test && npm run build && npm run test:e2e && cd ..
python tests/run_all.py
```

The browser tests drive `ui/dist`, not `ui/src`, so they cannot see a change
that has not been built.

## Tests

```bash
python tests/run_all.py              # the audio, the systems, the database
cd ui && npm test                    # the interface, what needs no browser
cd ui && npm run test:e2e            # the interface in a browser (build first)
```

What each is for: [tests/README.md](../tests/README.md).

CI (`.github/workflows/checks.yml`) runs the Python suites on macOS and on
Windows, on every push to main and every pull request that changes more than
the website. It runs them on both because the two systems disagree about the
things this app does most: a filesystem that ignores case, a file that cannot
be moved while it is open, a code page with no Cyrillic. The interface's tests run
once, on Linux: they run in a browser against a faked Python side, and
nothing in them depends on the system.

## Packaging it into an app

```bash
./build.command        # macOS — or double-click it in Finder
build.bat              # Windows
```

Either one builds the interface, makes a private venv, packages everything
with PyInstaller, and runs the built app's own self-test. Details and what
the self-test is for: [building.md](building.md).

They are in the repository root rather than in `packaging/` because they are
meant to be double-clicked. The PyInstaller spec they drive lives in
`packaging/`.

### Trying Update and Restart now by hand

Updating needs two releases, the one you run and a newer one. To try it
before a real release, publish two pre-releases (say `0.15.0rc1` and
`0.15.0rc2`). Download the first, put it in Applications (or Documents on
Windows), open it once as usual, quit, and start it with `REHA_UPDATE_TAG`
set to the second:

```bash
# macOS, in Terminal. `open` would not pass the variable on.
REHA_UPDATE_TAG=0.15.0rc2 /Applications/Reha.app/Contents/MacOS/Reha
```

```bat
rem Windows, in cmd, in the app's folder. Two lines: `set X=y && ...`
rem would keep the space before && in the value.
set REHA_UPDATE_TAG=0.15.0rc2
Reha.exe
```

The app then treats that release as the newest, pre-release or not, and
**Update** gets it ready. Without the variable nothing changes. Worth
checking by hand, because no test here can:

- the update arrives with no quarantine (`xattr -l` on the new `Reha.app`)
  or Zone.Identifier;
- macOS asks for the microphone right after the restart;
- macOS's App Management lets the swap rename the bundle and the old copy
  go to the Trash;
- on Windows the new window opens in front, and a taskbar pin still opens
  the app;
- how long Windows Defender holds a freshly unpacked `Reha.exe` on a slow
  machine, and whether a Documents folder synced by OneDrive gets in the way;
- the meters stay steady with an ASIO interface while the new copy's
  self-test runs.

## Changing the history's schema

The rehearsal history (`library.sqlite`, in the recordings folder) is
described twice on purpose: `store/models.py` says what the code expects,
and the migrations under `store/migrations/versions/` say how a database on
disk gets there. `tests/test_store.py` fails the moment the two drift apart,
so a schema change always needs a migration as well as the edit to the
models.

1. Edit `store/models.py`.
2. Regenerate the migration against a clean database:

   ```bash
   rm -f .alembic-scratch.sqlite*
   alembic -c alembic.ini upgrade head
   alembic -c alembic.ini revision --autogenerate -m "<what changed>"
   ```

3. Read the file Alembic just wrote. Autogenerate gets the shape right and
   the judgement wrong:
   - SQLite can barely `ALTER` a table. Adding a column, or dropping one
     that is in no index or constraint, works in place (`ALTER TABLE … ADD
     COLUMN` / `DROP COLUMN`, SQLite 3.35 and later), and that is what to use
     on `rehearsal` and `take`. Anything more needs batch mode (`with
     op.batch_alter_table(...) as batch:`), which rebuilds the table: a copy,
     `DROP TABLE`, and a rename. With foreign keys on (and the app always
     turns them on), that `DROP TABLE` deletes the rows of every table that
     points at it with `ON DELETE CASCADE`: rebuilding `take` this way empties
     `take_file`, `marker` and `cloud_copy`. Batch mode is safe only on a
     table nothing cascades from. `env.py` renders migrations in batch mode,
     so check what the generated file does to those two tables; migration
     0002 shows the in-place way.
   - A new column that is `NOT NULL` needs a `server_default`. Otherwise the
     existing rows have no value to put there, and the `ALTER` fails against
     real data even though it succeeds against an empty test database.
   - Moving data from one shape to another (splitting a column, backfilling
     from another table) is not something autogenerate can write. Add it by
     hand, with `op.execute` or a small `sa.table()` for the rows it touches.
4. Add a check to `tests/test_store.py` that loads data in the *previous*
   revision's shape and confirms it still reads correctly after the upgrade.
   See `migrations_with` there for building a database on an older revision.
   This is what caught the previous migration's backup-and-rollback behaviour
   before there was a second real migration to exercise it.
5. `alembic -c alembic.ini check` should say "No new upgrade operations
   detected". If it does not, `models.py` and the migrations still disagree.

## A few things that will save you time

**The audio callback must not allocate.** Buffers are preallocated and
reused, peaks use scalar comparisons, nothing prints. That thread has a
deadline.

**Platform differences go in `platform_support.py`**, all of them. Scattered
`sys.platform` checks are how this became macOS-only once already.

**`~/.rehearsal-recorder/config.json`** holds the settings, and
`~/RehearsalRecordings/` the takes. Delete the config to see what a first run
looks like.

**`~/.rehearsal-recorder/crash.log`** gets a Python traceback for every
thread if the process dies hard, including the threads that are not yours.

**`packaging/run-debug.sh`** (macOS) runs the app with the allocator checking
itself on every operation. Slow, but a memory fault lands on the bad write
instead of on some innocent allocation later.

## Where things are

Python does the audio: capture, mixing and playback through
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
  diagnostics.py            what Settings › Under the hood says, and its report
  updates.py                whether a newer version is out; Update and
                            Restart now, which put it in place
  metronome.py              the metronome: the row's tempo, which follows the
                            next take's name, the click between takes, its
                            settings, and what the screen is told
  audio/capture.py          multichannel capture with continuous write
  audio/player.py           playback and mixing of a take
  audio/monitor.py          listening to inputs without recording
  audio/waveform.py         waveform peaks from a .wav
  audio/mixdown.py          bouncing a take down to one stereo .wav
  audio/crop.py             cutting a take down to the part worth keeping
  audio/drafts.py           unsaved takes: finding, describing, finalizing
  audio/devices.py          the stream lock, and asking a card what it can do
  audio/probe.py            asking a card why it will not open or send
                            (--audio-probe, and Check the interface)
  audio/format.py           16- and 24-bit: packing, unpacking, what each costs
  audio/encode.py           compressing cloud copies (FLAC/MP3 via libsndfile)
  audio/wavfile.py          the app's own WAV writer, which can carry a click
                            take's tempo in an acid chunk
  audio/click.py            the click's arithmetic (which frame each click
                            falls on) and its three sounds
  audio/click_source.py     one running click, rendered a block at a time into
                            whichever stream plays it
  audio/click_output.py     the click's own output stream, when no stream the
                            app already holds can carry it
  audio/take_click.py       a take's click: its count-in and its clicks to
                            Stop, on the take's own grid
  audio/click_timing.py     when a click written into an output is heard, so
                            it lands on its frame of the recording
  audio/tempo.py            counting a song's tempo from a take, numpy only
  store/                    the rehearsal history: models.py, db.py
                            (open + migrate), library.py (what api.py calls),
                            importer.py (session.json → rows), migrations/

ui/src/screens/             one file per screen
ui/src/components/          player, timeline, waveform, take strip, dialogs
ui/dist/                    the built interface (build output, not in git)

tests/                      the Python suites
docs/                       this file and its neighbours
packaging/                  the PyInstaller spec, the debug-allocator run, and
                            the app's icon: icon.svg and icon-small.svg, drawn
                            by hand, and the .ico and .icns make_icons.py
                            turns them into
build.command, build.bat    in the root because you double-click them
pyproject.toml              how the package installs; deps come from
                            requirements.txt, which stays the one list
```

Nothing but the entry points, the package metadata and the files GitHub
insists on reading from the root (`README`, `LICENSE`, `CHANGELOG`,
`CONTRIBUTING`, `.github/`) lives there.

Several decisions in here look odd until you know why: playback in Python
rather than the browser, the meters deliberately not using the pywebview
bridge, raw PCM on disk instead of WAV while recording. Those are written
down in [design-notes.md](design-notes.md), along with the ones that were
wrong the first time.
