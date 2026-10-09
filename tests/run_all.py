"""
Every Python suite, one command:

    python tests/run_all.py

Five of them, because they answer different questions and need different
things to be true:

    test_engine.py     the audio itself — mixing, seeking, disk safety,
                       crash recovery (a crashed take's notes included), both
                       bit depths, compression. No
                       browser, no sound card: PortAudio is stubbed and the
                       samples are inspected directly.

    test_platform.py   the places macOS, Windows and Linux differ. Only one
                       of them is here, so the code is driven into each shape
                       on purpose — no recycle bin, no encoder, Windows
                       naming rules.

    test_store.py      the history database — schema, migrations, and the move of
                       old session.json files into it.

    test_ports.py      midi/ports.py, the one module that talks to the MIDI
                       library, against a stand-in for the library that has
                       the real one's quirks. The other suites block the
                       library; this one puts the stand-in in its place.

    test_midi.py       recording notes beside the audio. So far: what stops
                       Start (no track that records sound, a track with no
                       port, two on one port), that the card check then
                       holds only the tracks that record audio, which saved
                       port is found again after a replug, the order a
                       device's ports are listed in, the .mid file (what
                       one can hold, written with mido and read back, names
                       in UTF-8, a DAW's own ticks and tempo read right), and
                       what a port has set and holds (the state a take starts
                       with, the keys and pedals let go at its end), and the
                       audio's own clock (a note placed on its sample, drift
                       included), and one take's notes on disk (a .midraw
                       written as they are played, the .mid made at Stop or
                       after a crash, a disk that refuses a write or takes it
                       in part, a recorder two threads drive).
                       Later tasks add to it. No port is opened: the library
                       is blocked and the rules are plain functions.

The interface's tests are in ui/, beside the code they test: `npm test` and
`npm run test:e2e` there. See tests/README.md.

They are plain scripts rather than pytest modules, and that is deliberate:
test_engine stubs the `sounddevice` module before importing anything that
needs a sound card, which has to happen at import time and fights with how
pytest collects. Each exits non-zero on failure, which is all CI needs.
"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUITES = ("test_engine.py", "test_platform.py", "test_store.py", "test_ports.py",
          "test_midi.py")


def main():
    failed = []
    for suite in SUITES:
        print(f"\n{'=' * 60}\n{suite}\n{'=' * 60}")
        result = subprocess.run([sys.executable, str(HERE / suite)])
        if result.returncode != 0:
            failed.append(suite)

    print(f"\n{'=' * 60}")
    if failed:
        print("FAILED: " + ", ".join(failed))
        return 1
    print("All suites passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
