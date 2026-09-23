"""
Every suite, one command:

    python tests/run_all.py

Three of them, because they answer different questions and need different
things to be true:

    test_engine.py     the audio itself — mixing, seeking, disk safety,
                       crash recovery, both bit depths, compression. No
                       browser, no sound card: PortAudio is stubbed and the
                       samples are inspected directly.

    test_platform.py   the places macOS, Windows and Linux differ. Only one
                       of them is here, so the code is driven into each shape
                       on purpose — no recycle bin, no encoder, Windows
                       naming rules.

    test_store.py      the history database — schema, migrations, and the move of
                       old session.json files into it.

    test_interface.py  the built interface in a headless browser against a
                       mocked Python bridge. Needs `ui/dist` built and
                       Playwright installed.

They are plain scripts rather than pytest modules, and that is deliberate:
test_engine stubs the `sounddevice` module before importing anything that
needs a sound card, which has to happen at import time and fights with how
pytest collects. Each exits non-zero on failure, which is all CI needs.
"""

import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUITES = ("test_engine.py", "test_platform.py", "test_store.py", "test_interface.py")


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
