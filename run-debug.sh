#!/bin/sh
#
# The app under the macOS allocator's debugging mode. macOS only — the
# switches below are Apple's; on Windows the equivalent is Application
# Verifier, and on Linux valgrind or ASan.
#
# A "memory corruption of free block" crash names the thread that was
# allocating when the damage was noticed — almost never the thread that did
# the damage. These switches make the allocator check itself constantly and
# abort at the moment of the bad write, so the crash report points at the
# culprit.
#
# It is noticeably slower, and MallocStackLogging eats memory, so this is for
# reproducing a crash, not for a rehearsal.
#
#   ./run-debug.sh
#
# Afterwards: the native report is in Console.app under Crash Reports, and the
# Python side of the same moment is in ~/.rehearsal-recorder/crash.log.

set -e
cd "$(dirname "$0")"

if [ "$(uname)" != "Darwin" ]; then
  echo "This script is macOS only — the switches below are Apple's." >&2
  echo "The crash log at ~/.rehearsal-recorder/crash.log works everywhere." >&2
  exit 1
fi

if [ -d venv ]; then
  . venv/bin/activate
fi

export MallocErrorAbort=1          # stop at the bad write, not later
export MallocScribble=1            # freed memory filled with 0x55
export MallocPreScribble=1         # fresh memory filled with 0xAA
export MallocGuardEdges=1          # guard pages around large blocks
export MallocCheckHeapStart=1000   # start checking after 1000 allocations
export MallocCheckHeapEach=1000    # and re-check every 1000
export MallocStackLogging=1        # keep allocation stacks
export MallocNanoZone=0            # the small-allocation zone off, so the
                                   # checks above cover everything

exec python3 app.py
