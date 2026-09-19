# Contributing

## The most useful thing

A report from an actual rehearsal. This app has a narrow job and a specific
situation — a room, a band, an interface, nobody watching the screen — and
almost every real bug in it so far came from someone doing that rather than
from reading the code. If a take did not save, a meter lied, or the app died,
that is worth an issue even without a diagnosis.

If the app crashed, `~/.rehearsal-recorder/crash.log` has a Python traceback
for every thread at that moment. It is usually the single most useful thing
in the report.

## Getting set up

```bash
python3 -m venv venv
source venv/bin/activate          # venv\Scripts\activate on Windows
pip install -r requirements.txt
pip install playwright && playwright install chromium   # for the interface suite

cd ui && npm install && npm run build && cd ..
python3 app.py
```

Node is needed: `ui/dist` is what the app actually serves, and it is build
output rather than something in the repository, so a fresh clone has to build
it once. **Rebuild it whenever you change anything under `ui/src/`**, or
neither the running app nor the interface suite will see the change.

While you are working on the interface, `npm run dev` plus `python3 app.py
--dev` gives you hot reload instead of a rebuild every time. The whole
development loop — both halves, the proxy between them, what to check when
the meters sit at zero — is in [docs/development.md](docs/development.md).

## Tests

```bash
python tests/run_all.py
```

They must pass before a pull request, and they run on every push. They are
plain scripts rather than pytest modules — [tests/README.md](tests/README.md)
explains why, and what each one covers.

If you fix a bug, the useful move is to make the suite fail first. Several
things in here were only really fixed once a test reproduced them: the
player's open/close race, for instance, was confirmed by putting the old code
back and watching the new test catch it.

## What the code tries to be

**Comments say why, not what.** The diff shows what. A comment earns its
place by explaining a decision that would otherwise look wrong — why
playback is in Python, why the meters avoid the pywebview bridge, why raw
PCM is written instead of WAV.

**Nothing in the audio callback allocates.** Buffers are preallocated and
reused, peaks use scalar comparisons, and nothing prints. That thread has a
deadline and the one crash this app has had was a memory fault.

**Recordings are never destroyed.** Deleting moves things. Anything that
touches a file somebody played into deserves a suspicious second read.

**Honest failure beats a silent fallback.** If the chosen output device is
gone, the app says which device and why it fell back. If there is no Trash on
this system, the confirmation does not promise one. The pattern throughout is
to do the sensible thing and say so, rather than either failing or pretending.

**Platform differences live in `platform_support.py`.** All of them. This
started as a macOS app and quietly stayed one for longer than it should have,
because `sys.platform` checks were scattered around. One file makes the next
omission visible.

## Releasing

1. Update `CHANGELOG.md`.
2. GitHub → Releases → Draft a new release → new tag (`v0.2.0`) → Publish.
3. `.github/workflows/release.yml` builds on a real Mac and a real Windows
   machine, runs every suite plus `--selftest` on the built app, and attaches
   the zips to the release.

A build that fails its own self-test is never attached. That check exists
because the way a packaged app fails is specific: it starts, and then the
first time it reaches for the sound card it turns out a native library was
never bundled.
