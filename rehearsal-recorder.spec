# -*- mode: python ; coding: utf-8 -*-
"""
Packaging: one file you double-click, nothing to install.

    pip install pyinstaller
    pyinstaller rehearsal-recorder.spec
    dist/RehearsalRecorder --selftest      # or the .app / .exe

Everything goes in: Python itself, numpy, PortAudio (through sounddevice),
libsndfile (through soundfile), the webview toolkit and the built interface.
Nobody downloads anything at a rehearsal — a venue with no wifi is normal and
an app that needs the internet to start recording is useless.

Two things that are easy to get wrong and expensive to discover later:

  The interface. ui/dist has to be built before packaging, and has to be
  bundled under the same relative path the app looks for it at — see
  app_root() in platform_support.py, which is what makes that path work both
  from source and from inside a bundle.

  The microphone on macOS. Without NSMicrophoneUsageDescription in the
  Info.plist, macOS does not refuse politely: it kills the process the moment
  the app opens an input. The build would look perfect until the first take.
"""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files

SPEC_DIR = Path(SPECPATH)
NAME = "RehearsalRecorder"

ui_dist = SPEC_DIR / "ui" / "dist"
if not (ui_dist / "index.html").exists():
    raise SystemExit(
        "ui/dist is not built — run `cd ui && npm install && npm run build` "
        "before packaging, or the app will start with no interface."
    )

datas = [(str(ui_dist), "ui/dist")]

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
    ["app.py"],
    pathex=[str(SPEC_DIR)],
    binaries=[],
    datas=datas,
    hiddenimports=["send2trash"],
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
