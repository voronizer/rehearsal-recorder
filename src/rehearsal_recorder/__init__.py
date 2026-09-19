"""
Multitrack recording for band rehearsals.

The package is laid out by what each part is responsible for rather than by
layer: `audio` is everything that touches samples, `api` is what the
interface can ask for, `mediaserver` is how it asks, `platform_support` is
every place the three operating systems disagree, and `app` opens the window.
"""

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
