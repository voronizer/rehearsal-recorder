# Contributing

## Bug reports

The most useful thing you can send is a report from an actual rehearsal. This
app has a narrow job in a specific situation (a room, a band, an interface,
nobody watching the screen), and almost every real bug in it so far came from
someone using it there rather than from reading the code. If a take did not
save, a meter lied or the app died, open an issue, even without a diagnosis.

If the app crashed, `~/.rehearsal-recorder/crash.log` has a Python traceback
for every thread at that moment. It is usually the most useful part of the
report.

## Getting set up

```bash
python3 -m venv venv
source venv/bin/activate          # venv\Scripts\activate on Windows
pip install -e .
cd ui && npm install && npm run build
npx playwright install chromium   # the browser the interface's tests run in
cd ..
python3 -m rehearsal_recorder
```

Node is needed: the app serves `ui/dist`, which is build output and not in
the repository, so a fresh clone has to build it once. **Rebuild it whenever
you change anything under `ui/src/`**, or neither the running app nor the
interface's browser tests will see the change.

While you are working on the interface, `npm run dev` plus
`python3 -m rehearsal_recorder --dev` gives you hot reload instead of a
rebuild every time. The whole development loop is in
[docs/development.md](docs/development.md): both halves, the proxy between
them, and what to check when the meters sit at zero.

How the screens look and work is in
[docs/design-system.md](docs/design-system.md): the colours, sizes and shared
components, and what CI refuses.
`npm run storybook` in `ui/` shows every shared component, in both themes
and as on the Mac and on Windows.

## Tests

```bash
python tests/run_all.py
```

They must pass before a pull request, and they run on every push. They are
plain scripts rather than pytest modules. [tests/README.md](tests/README.md)
explains why, and what each one covers.

If you fix a bug, make the suite fail first. Several things in here were only
fixed for good once a test reproduced them: the player's open/close race, for
instance, was confirmed by putting the old code back and watching the new test
catch it.

## The website

reha.stream is `site/`: the main page, built from the interface's own
components running on the same fake Python side as the interface's tests,
and Alex's stories, a page each. Its words are Markdown in `site/content/`,
the stories in `site/content/stories/`; its version and the news line come
from the release's tag and that version's section of `CHANGELOG.md`. A pull
request that touches `site/`, `ui/` or `CHANGELOG.md` builds it and runs its
tests, so a change to the interface can break it.

The stories' pages are written whole at build time, so `npm run dev` shows
only the main page; build and preview to see a story. A new story also needs
its name in the route in `site/vercel-config.json`, or reha.stream answers
404 for it.

```bash
cd ui && npm ci && cd ../site && npm ci
npm run dev                                 # to work on the main page
npm run build && npm run preview            # to read the stories
npm test && npm run build && npm run test:e2e
```

## What the code tries to be

**Comments say why, not what.** The diff shows what. A comment is for a
decision that would otherwise look wrong: why playback is in Python, why the
meters avoid the pywebview bridge, why raw PCM is written instead of WAV.

**Nothing in the audio callback allocates.** Buffers are preallocated and
reused, peaks use scalar comparisons, and nothing prints. That thread has a
deadline and the one crash this app has had was a memory fault.

**Recordings are never destroyed.** Deleting moves things. Anything that
touches a file somebody played into deserves a suspicious second read.

**Honest failure beats a silent fallback.** If the chosen output device is
gone, the app says which device and why it fell back. If there is no Trash on
this system, the confirmation does not promise one. The pattern throughout is
to do the sensible thing and say so, rather than either failing or pretending.

**Platform differences live in `platform_support.py`**, all of them. This
started as a macOS app and stayed one for longer than it should have, because
`sys.platform` checks were scattered around. With them in one file, the next
omission is easy to see.

## Releasing

If the repository is not pushed anywhere yet, start with
[docs/pushing-to-github.md](docs/pushing-to-github.md). After that:

1. Update `CHANGELOG.md`.
2. GitHub → Releases → Draft a new release → new tag (`0.2.0`, no `v`, to
   match the tags already there) → Publish.
3. `.github/workflows/release.yml` builds on a real Mac and a real Windows
   machine, runs every suite plus `--selftest` on the built app, and attaches
   the zips to the release.
4. Then the same workflow puts the website up for that release (its `site`
   and `site · deploy` jobs), unless it is a pre-release. The page's news
   line is the bold start of the first item in that version's section of
   `CHANGELOG.md`; without one it just says which version is new.

There is no version number to bump anywhere: the tag is the version.
setuptools-scm reads it at build time and writes it into the package, which
is what the app shows under Settings › Under the hood and what `--selftest`
prints. The build writes it on the `.app` and the `.exe` too, where Finder
and Explorer show it, and `--selftest` checks that the two agree. Run from a
clone that was never installed, it says `unknown`: there is no tag to read.

A build that fails its own self-test is never attached. That check exists
because the way a packaged app fails is specific: it starts, and then the
first time it reaches for the sound card it turns out a native library was
never bundled.
