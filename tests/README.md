# Tests

```bash
python tests/run_all.py
```

Four suites, because they answer different questions.

## test_engine.py — the audio

Mixing, seeking, A–B looping, disk estimates, crash recovery, take naming,
renaming, markers, both bit depths, and compressing cloud copies.

No sound card and no browser: `sounddevice` is replaced by a stub before
anything imports it, the renderer is called directly, and the samples that
come out are inspected. That is why FLAC being lossless is a fact here rather
than a claim — the bytes are compared.

## test_platform.py — the three systems

Only one operating system is ever present, so the code is driven into each
shape deliberately: no recycle bin, no encoder, Windows naming rules, a path
near the 260-character limit.

This proves the code takes the right branch, not that the branch works where
it runs: only the system itself shows that. CI runs every suite on macOS and
on Windows for exactly that reason — it used to run them on Linux, where a
check about a filesystem that ignores case had nothing to catch and skipped
itself for weeks.

## test_store.py — the history database

The schema, the migrations and the move of every old `session.json` into the
database. The migrations run for real on SQLite, the way the app runs them at
start, and a chain of test-only migrations stands in for the ones later
versions will add — so the backup taken first, and the rollback when one
fails halfway, are checked before there is a second real migration to need
them.

## The interface — in ui/, in TypeScript

```bash
cd ui
npm test                             # Vitest: what needs no browser, seconds
npm run build && npm run test:e2e    # Playwright: the built bundle in a browser
```

The interface's tests are being moved out of Python into `ui/`, where the
code they test is:

- **`src/**/*.test.ts`**, beside the code, under Vitest: what can be checked
  without a browser. How loud a meter draws, what a time is written as, where
  the ruler puts its ticks.
- **`e2e/*.spec.ts`**, under Playwright Test: the built `ui/dist` in a real
  browser, against the faked Python side in `e2e/fake-bridge.js`. For what
  needs a page laid out and a mouse. Each test sets up the state it needs, so
  they run side by side, and they wait for what they are waiting for rather
  than for a length of time.

CI runs both once, on Linux: nothing in them depends on the system
underneath.

## test_interface.py — what has not been moved yet

The rest of the interface's tests, the old way: one long run through every
screen in a headless browser, against the same `ui/e2e/fake-bridge.js`.
Its sections move to `ui/e2e/` one at a time and are deleted here as they
do. CI runs what is left on Windows.

Needs `ui/dist` built (`cd ui && npm run build`) and Playwright for Python.
Screenshots land in `tests/screenshots/` and CI keeps them as artifacts.

## docs_screenshots.py — the pictures in the docs

Not a suite: it checks nothing and `run_all.py` does not run it. It takes the
pictures in the README and `docs/using-it.md` — the same bundle and the same
mocked bridge as `test_interface.py`, with a band of four on an XR18 and
waveforms worked out from a song, so the pictures look like a rehearsal
rather than a test. It writes `docs/screenshots/*.png`. Run it after changing
anything they show, and look at them before committing.

## Why not pytest

`test_engine.py` stubs the `sounddevice` module before importing anything
that would otherwise need a real sound card, and that has to happen at import
time. Making that work under pytest's collection means fighting it for no
benefit: each suite exits non-zero on failure, prints a readable report, and
CI runs them directly.
