# Building and releasing

How the app becomes something you double-click, and how the GitHub
release builds work.
## Packaging

`build.command` on macOS and `build.bat` on Windows do all of this in one
double-click. By hand, from the repository root:

    cd ui && npm ci && npm run build && cd ..
    python3 -m venv venv
    source venv/bin/activate          # Windows: venv\Scripts\activate
    pip install -e . pyinstaller
    pyinstaller packaging/rehearsal-recorder.spec --noconfirm
    dist/Reha.app/Contents/MacOS/Reha --selftest   # Windows: dist\Reha\Reha.exe --selftest

`pip install -e .` is the step that is easy to leave out. PyInstaller copies
in what is installed in the Python it runs in, and nothing else. With only
PyInstaller there, the build stops at `No package metadata was found for
mido`. Get past that one and the app it makes still cannot open a window
(`No module named 'webview'`) or reach the sound card, because pywebview,
numpy and sounddevice were never there to copy.

On macOS the self-test to run is the one inside the `.app`. `dist/Reha/Reha`
is the same program before it is wrapped, with no Info.plist beside it, so
its "version on the file" check fails though nothing else is wrong.

One folder you open, with everything inside: Python, numpy, PortAudio through
sounddevice, libsndfile through soundfile, the window toolkit and the built
interface. Nothing is downloaded at startup — a rehearsal room with no wifi is
normal, and an app that needs the internet before it can record is useless.

`ui/dist` has to be built first (`cd ui && npm run build`); the spec refuses
to package without it rather than producing an app with no interface.

**The icon** is drawn in `packaging/icon.svg`, and again for 32 px and under
in `icon-small.svg`: at 16 px, in a title bar, the full drawing's waveform is
thinner than a pixel, so the small one has no tile and three bars on whole
pixels. After changing either, run

    python packaging/make_icons.py

and commit what it writes: `packaging/icon.ico` for Windows, `icon.icns` for
macOS, and for the interface the small drawing as `ui/public/favicon.svg`
(the tab, and the setup screen's header) and the full one as `logo.svg` (the
screen shown while the app starts). It draws the sizes
with the Chromium Playwright installs for the interface tests, and both icon
formats hold PNGs as they are, so no image library is needed. The build reads
the finished files, so building needs nothing it does. Run from source on
Windows, the window is given the `.ico` too; otherwise the taskbar would show
python.exe's icon. Run from source on macOS, the Dock is given the `.icns`,
and the menu bar and About the app's name, version and copyright; otherwise
they would say Python.

**The self-test is the point.** A packaged app fails in a particular way: it
starts, and then the first time it reaches for the sound card it turns out a
native library was never bundled. Nothing in the source can catch that — only
the built thing knows. So the built thing is asked:

    $ dist/Reha/Reha --selftest
    РЭХА self-test on linux
      bundle root: .../dist/Reha/_internal
      frozen: True
      ok   audio engine — PortAudio up, 18 devices, 3 with inputs
      ok   sample formats — soundfile, libsndfile 1.2.2
      ok   numpy — numpy 2.4.4
      ok   window toolkit — pywebview 5.4
      ok   built interface — 1330 bytes of index.html
      ok   deleting — goes to the system

It exits non-zero if anything is missing, and the CI build runs it on the
artifact it just produced, on macOS and on Windows. A build that cannot answer
for itself is not uploaded. On those two it also checks the version written
on the file, which Finder and Explorer show, against the one the app knows:
the `.app` once said 0.0.0 and the `.exe` nothing.

**What the systems will say the first time.** The app is not signed with an
Apple Developer certificate ($99/year) or an Authenticode certificate, so:

- macOS: the first launch needs right-click → Open rather than a double-click.
  After that it opens normally. macOS also asks for microphone permission the
  first time you record — the Info.plist key that makes that a question rather
  than a silent kill is in the spec, and it is the single easiest thing to get
  wrong in a packaged audio app.
- Windows: SmartScreen may warn about an unrecognised publisher — "More info",
  then "Run anyway".

Signing removes both. It is the only remaining thing between this and a clean
double-click, and it is a purchase, not code.

**Builds for both systems** are in `.github/workflows/release.yml`. Publish a
release on GitHub and it builds on a real Mac and a real Windows machine,
runs every test suite plus `--selftest` on the app it just made, and attaches
the zips to that release. `workflow_dispatch` runs the same thing without
cutting a release, leaving the builds as workflow artifacts.

This is also the only way this app has ever been built on Windows — there is
no Windows in the environment it was written in, so the first real Windows
build will be the one that workflow makes.
