"""
Multitrack recording for band rehearsals.

The package is laid out by what each part is responsible for rather than by
layer: `audio` is everything that touches samples, `api` is what the
interface can ask for, `mediaserver` is how it asks, `platform_support` is
every place the three operating systems disagree, and `app` opens the window.
"""

import os
import sys


def enable_asio(platform, environ):
    """
    Ask sounddevice for its PortAudio built with ASIO, on Windows.

    The pip wheel ships two PortAudio DLLs on Windows and loads the one
    without ASIO unless SD_ENABLE_ASIO is set before `sounddevice` is first
    imported. Without ASIO a multichannel mixer is offered through MME or
    WASAPI with a fraction of its inputs (#3). This module is the one place
    that runs before that import for every way of starting the app.

    Worth knowing before touching it:
      - it only works with the pip-installed PortAudio; conda-forge's has no
        ASIO at all, so do not "simplify" the build onto conda;
      - a custom portaudio.dll on %PATH% defeats it without a word;
      - the cost is accepted on purpose: with the ASIO DLL, importing
        sounddevice briefly interrupts whatever else is playing when the
        output has exclusive mode on (python-sounddevice #496). That lands
        once, at launch, in an app people open in order to record.
    """
    if platform == "win32":
        environ.setdefault("SD_ENABLE_ASIO", "1")


enable_asio(sys.platform, os.environ)

try:
    # Written by setuptools-scm from the git tag when the package is built or
    # installed, so the version is the release and there is no number in the
    # source to keep in step. It is a real file by then, which is what lets a
    # PyInstaller bundle — where there is no git and no tag — still know.
    from rehearsal_recorder._version import version as __version__
except ImportError:
    # A clone that has not been installed. Saying so is more use than a
    # number that would be a guess.
    __version__ = "unknown"
