# Building and releasing

How the app becomes something you double-click, and how the GitHub
release builds work.
## Packaging

    pip install pyinstaller
    pyinstaller rehearsal-recorder.spec
    dist/RehearsalRecorder/RehearsalRecorder --selftest

One folder you open, with everything inside: Python, numpy, PortAudio through
sounddevice, libsndfile through soundfile, the window toolkit and the built
interface. Nothing is downloaded at startup — a rehearsal room with no wifi is
normal, and an app that needs the internet before it can record is useless.

`ui/dist` has to be built first (`cd ui && npm run build`); the spec refuses
to package without it rather than producing an app with no interface.

**The self-test is the point.** A packaged app fails in a particular way: it
starts, and then the first time it reaches for the sound card it turns out a
native library was never bundled. Nothing in the source can catch that — only
the built thing knows. So the built thing is asked:

    $ dist/RehearsalRecorder/RehearsalRecorder --selftest
    Rehearsal Recorder self-test on linux
      bundle root: .../dist/RehearsalRecorder/_internal
      frozen: True
      ok   audio engine — PortAudio up, 18 devices, 3 with inputs
      ok   sample formats — soundfile, libsndfile 1.2.2
      ok   numpy — numpy 2.4.4
      ok   window toolkit — pywebview 5.4
      ok   built interface — 1330 bytes of index.html
      ok   deleting — goes to the system

It exits non-zero if anything is missing, and the CI build runs it on the
artifact it just produced, on macOS and on Windows. A build that cannot answer
for itself is not uploaded.

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
