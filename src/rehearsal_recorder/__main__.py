"""
What `python -m rehearsal_recorder` runs, and what PyInstaller packages.

A file of its own rather than app.py itself: a module run directly is
`__main__`, so the package-relative imports inside app.py would have nothing
to resolve against. Going through an import here means the app starts the
same way whether it was launched by this line, by the `rehearsal-recorder`
command, or from inside a bundle.
"""

import sys

from rehearsal_recorder.app import main

if __name__ == "__main__":
    sys.exit(main())
