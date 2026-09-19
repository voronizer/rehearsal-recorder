"""
Multitrack recording for band rehearsals.

The package is laid out by what each part is responsible for rather than by
layer: `audio` is everything that touches samples, `api` is what the
interface can ask for, `mediaserver` is how it asks, `platform_support` is
every place the three operating systems disagree, and `app` opens the window.
"""

__version__ = "0.1.0"
