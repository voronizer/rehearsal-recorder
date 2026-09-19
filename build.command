#!/bin/bash
#
# Double-click this in Finder. It builds the app once; after that you open the
# app itself and never come back here.
#
# It makes its own venv inside this folder, so nothing is installed system
# wide and nothing you already have is touched.

set -e
cd "$(dirname "$0")"

# Without this, a failure anywhere below closes the Terminal window the
# instant it happens and the error is gone before it can be read — which is
# the whole problem with a script people double-click.
on_failure() {
  echo
  echo "Something went wrong above."
  echo "Nothing was installed outside this folder, so it is safe to fix"
  echo "whatever it is and run this again."
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 1
}
trap on_failure ERR

echo "Building Rehearsal Recorder"
echo "This takes a few minutes the first time, less after that."
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is not installed."
  echo "Get it from https://www.python.org/downloads/ and run this again."
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi

echo "==> Setting up a private environment"
[ -d venv ] || python3 -m venv venv
. venv/bin/activate

echo "==> Installing what the app needs"
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt pyinstaller --quiet

echo "==> Packaging"
pyinstaller rehearsal-recorder.spec --noconfirm --log-level WARN

APP="dist/RehearsalRecorder.app"
BIN="$APP/Contents/MacOS/RehearsalRecorder"
if [ ! -x "$BIN" ]; then
  # Not a Mac, or the bundle step did not run: the plain folder build.
  APP="dist/RehearsalRecorder"
  BIN="$APP/RehearsalRecorder"
fi

echo
echo "==> Checking the build has everything"
if "$BIN" --selftest; then
  echo
  echo "Done. The app is here:"
  echo "    $(pwd)/$APP"
  echo
  echo "Drag it to your Applications folder if you like."
  echo "The FIRST time you open it, right-click it and choose Open — macOS"
  echo "blocks apps that are not signed with a paid Apple certificate until"
  echo "you do that once. After that a double-click works normally."
  echo
  echo "It will also ask for microphone permission on the first take."
else
  echo
  echo "The build is missing something — see the failures above."
fi

echo
read -n 1 -s -r -p "Press any key to close."
