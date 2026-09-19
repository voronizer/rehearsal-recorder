"""
Deciding whether what is in the cloud folder is still what the settings and
the take say it should be.

A copy is made from four things: which of the mix and the tracks was asked
for, the take's name (the files are named after it), the format, and the
balance the mix was rendered with. Recording those next to the copy is what
lets a later pass skip a take that is already right, instead of mixing it
again every time something nudges the queue.
"""


def source_of(take, what, volumes, fmt):
    """What a copy of this take would be made from right now."""
    names = [t.get("name") for t in take.get("tracks", []) if t.get("name")]
    return {
        "what": what,
        "name": take.get("name", ""),
        "format": fmt,
        # Only this take's tracks: moving an unrelated fader must not make
        # every take in the folder look stale.
        "volumes": {n: float(volumes.get(n, 1.0)) for n in names},
    }


def is_current(take, what, volumes, fmt):
    """True when the cloud folder already holds this take in this shape."""
    shared = take.get("cloud") or {}
    if not shared:
        return False
    return shared.get("source") == source_of(take, what, volumes, fmt)
