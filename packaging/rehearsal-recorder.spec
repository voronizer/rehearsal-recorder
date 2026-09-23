# -*- mode: python ; coding: utf-8 -*-
"""
Packaging: one file you double-click, nothing to install.

    pip install pyinstaller
    pyinstaller packaging/rehearsal-recorder.spec
    dist/RehearsalRecorder --selftest      # or the .app / .exe

Run it from the repository root, not from this folder: dist/ and build/ are
written next to where pyinstaller is invoked, and the paths below are
resolved from this file rather than from the working directory.

Everything goes in: Python itself, numpy, PortAudio (through sounddevice),
libsndfile (through soundfile), the webview toolkit and the built interface.
Nobody downloads anything at a rehearsal — a venue with no wifi is normal and
an app that needs the internet to start recording is useless.

Two things that are easy to get wrong and expensive to discover later:

  The interface. ui/dist has to be built before packaging, and has to be
  bundled under the same relative path the app looks for it at — see
  app_root() in src/rehearsal_recorder/platform_support.py, which is what
  makes that path work both from source and from inside a bundle.

  The microphone on macOS. Without NSMicrophoneUsageDescription in the
  Info.plist, macOS does not refuse politely: it kills the process the moment
  the app opens an input. The build would look perfect until the first take.
"""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# This file lives in packaging/, so the repository is one level up.
ROOT = Path(SPECPATH).parent
NAME = "RehearsalRecorder"

ui_dist = ROOT / "ui" / "dist"
if not (ui_dist / "index.html").exists():
    raise SystemExit(
        "ui/dist is not built — run `cd ui && npm install && npm run build` "
        "before packaging, or the app will start with no interface."
    )

datas = [(str(ui_dist), "ui/dist")]

# The history's migrations. Alembic reads them from disk by path — a
# ScriptDirectory walk of the versions/ folder — rather than importing them
# by name, so PyInstaller's analysis never sees them used and would leave
# them out unless they are named as data here.
datas += [(
    str(ROOT / "src" / "rehearsal_recorder" / "store" / "migrations"),
    "rehearsal_recorder/store/migrations",
)]

# The native libraries the audio wheels carry with them. PyInstaller has hooks
# for both packages, but naming them here as well means a missing library
# shows up at build time rather than as "no sound card" at a rehearsal. The
# _data packages are where the wheels actually put the binaries: PortAudio on
# macOS and Windows, libsndfile everywhere.
for package in ("soundfile", "_soundfile_data", "sounddevice", "_sounddevice_data"):
    try:
        datas += collect_data_files(package)
    except Exception:
        # sounddevice is a single module on Linux, where PortAudio comes from
        # the system — nothing to collect and nothing wrong.
        pass

a = Analysis(
    # Not app.py: a module run as a script is __main__, and the package
    # imports inside app.py would have nothing to resolve against. __main__.py
    # imports the package by name, exactly as `python -m` does.
    [str(ROOT / "src" / "rehearsal_recorder" / "__main__.py")],
    pathex=[str(ROOT / "src")],
    binaries=[],
    datas=datas,
    # Each migration module imports alembic.op and sqlalchemy only once
    # Alembic runs it, by path, at start — not at import time, so the
    # analysis above cannot see them used and misses them without help.
    hiddenimports=["send2trash", "sqlalchemy.dialects.sqlite", "mako",
                   *collect_submodules("alembic")],
    hookspath=[],
    excludes=[
        # Nothing here draws with these, and they are large.
        "tkinter", "matplotlib", "PIL", "pytest", "IPython",
    ],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=NAME,
    debug=False,
    strip=False,
    upx=False,
    # No terminal window behind the app on Windows. The crash log in
    # ~/.rehearsal-recorder/crash.log is where to look instead.
    console=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name=NAME,
)

if sys.platform == "darwin":
    app = BUNDLE(
        coll,
        name=f"{NAME}.app",
        bundle_identifier="band.rehearsal.recorder",
        info_plist={
            # Without this the app is killed on its first take, with no
            # message anyone could act on.
            "NSMicrophoneUsageDescription":
                "Rehearsal Recorder records your band through your audio "
                "interface.",
            "CFBundleName": "Rehearsal Recorder",
            "CFBundleDisplayName": "Rehearsal Recorder",
            "NSHighResolutionCapable": True,
            # It is a window, not a menu-bar accessory.
            "LSUIElement": False,
        },
    )
