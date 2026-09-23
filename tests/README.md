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

## test_interface.py — the built interface

The real `ui/dist` bundle in a headless browser, against a mocked Python
bridge. Every screen, the whole flow, and specific past failures: the startup
race where the bridge object exists before its methods do, appearance applied
before the first paint, the interface as it looks on a machine with no Trash.

Needs `ui/dist` built (`cd ui && npm run build`) and Playwright installed.
Screenshots land in `tests/screenshots/` and CI keeps them as artifacts.

## Why not pytest

`test_engine.py` stubs the `sounddevice` module before importing anything
that would otherwise need a real sound card, and that has to happen at import
time. Making that work under pytest's collection means fighting it for no
benefit: each suite exits non-zero on failure, prints a readable report, and
CI runs them directly.
