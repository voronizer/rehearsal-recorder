"""
The sound process: every stream to a card runs in a second РЭХА process
that does nothing else, so the rest of the app cannot hold Python while a
ring wants filling or emptying (docs/superpowers/specs/2026-11-04-sound-
process-design.md).

The main process makes each stream object with `new(kind, ...)`, which
answers with a stand-in (remote.Remote) with the object's own methods: a
call goes down a pipe and its answer comes back (link.Link). With no sound
process started (the tests, the self-test), `new` makes the object here, in
this process, as before.

PortAudio is only loaded in the sound process: audio/devices.py's `sd` is
sounddevice there, and in the main process the sound process's device list
(view.py).
"""

import threading

# Set in the sound process as it starts (host.main).
IN_HOST = False

_lock = threading.Lock()
_link = None


class SoundUnavailable(RuntimeError):
    """The sound process is not there to answer: it has not started yet in
    30 s, or it stopped twice within a minute."""


class IsMethod:
    """The sound process's answer when the attribute asked for is a method:
    the stand-in calls it instead."""


class PortAudioError(Exception):
    """sounddevice's PortAudioError as the main process gets it: the same
    args, without loading sounddevice there."""


def start(local=False, prepare=None):
    """Starts the sound process (`local`: its objects in this process, the
    tests' way), once. `prepare`, "module:function", is run there first (the
    tests' fake card)."""
    global _link
    from rehearsal_recorder.audio.sound.link import Link

    with _lock:
        if _link is None:
            _link = Link(local=local, prepare=prepare)
        return _link


def stop():
    """Lets the sound process go (the app is closing)."""
    global _link
    with _lock:
        link, _link = _link, None
    if link is not None:
        link.close()


def current():
    """The link to the sound process, None before start()."""
    return _link


def apart():
    """The link when the sound process is a process apart, else None."""
    link = _link
    return link if link is not None and not link.local else None


def new(what, *args, **kw):
    """`what`, a class of host.kinds() or its kind's name, made where the
    sound is: a stand-in for one in the sound process, or, with none apart,
    the object itself (made by the class given, so a suite's stand-in for
    one is the one made)."""
    link = _link
    if link is None or link.local:
        if isinstance(what, str):
            from rehearsal_recorder.audio.sound.host import make

            return make(what, args, kw)
        return what(*args, **kw)
    return link.new(what if isinstance(what, str) else what.kind, *args, **kw)


def function(name, *args, **kw):
    """`name` (host.FUNCTIONS) run where the sound is."""
    link = _link
    if link is None or link.local:
        from rehearsal_recorder.audio.sound.host import run_function

        return run_function(name, args, kw)
    return link.function(name, *args, **kw)


def kind_of(x):
    """The kind of a sound object or its stand-in ("ClickOutput", ...), None
    for anything else."""
    return getattr(x, "kind", None) if x is not None else None
