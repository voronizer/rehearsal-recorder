"""
What `python -m rehearsal_recorder` runs, and what PyInstaller packages.

A file of its own rather than app.py itself: a module run directly is
`__main__`, so the package-relative imports inside app.py would have nothing
to resolve against. Going through an import here means the app starts the
same way whether it was launched by this line, by the `rehearsal-recorder`
command, or from inside a bundle.
"""

import multiprocessing
import sys

from rehearsal_recorder.app import main

if __name__ == "__main__":
    # First: in a built app, a second process (a take's drift, counted apart:
    # audio/drift.py) starts this same program, and this is where it turns
    # into that count instead of a second window.
    multiprocessing.freeze_support()
    sys.exit(main())
