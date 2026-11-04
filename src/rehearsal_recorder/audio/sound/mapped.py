"""
A file mapped in memory (np.memmap: a ready backing file, a take's WAV) goes
between the processes as where it is, its file, offset, type and shape, and
is mapped again on the other side. Sent by value it was the whole file each
time: 115 MB for five minutes of stereo at 48 kHz, on every health poll of a
take with a backing track, with the sound process's threads held meanwhile.

Only a whole read-only mapping goes this way. A piece of one keeps its
parent's offset, and a mapping open for writing must not be opened again
elsewhere, so both go by value; anything over BIG_BYTES that goes by value
is said in the log, so the next one is found.
"""

import logging
import mmap

import numpy as np

BIG_BYTES = 1 << 20

log = logging.getLogger(__name__)


def reference(obj):
    """("mapped", file, dtype, offset, shape) for a whole read-only memmap,
    else None. Says in the log when a big array goes by value."""
    if not isinstance(obj, np.ndarray):
        return None
    if (isinstance(obj, np.memmap) and isinstance(obj.base, mmap.mmap) and obj.filename
            and obj.mode == "r" and obj.flags.c_contiguous):
        return ("mapped", obj.filename, obj.dtype.str, int(obj.offset), tuple(obj.shape))
    if obj.nbytes > BIG_BYTES:
        log.warning("%.1f MB of samples went between РЭХА's processes by value", obj.nbytes / 1e6)
    return None


def load(pid):
    """The memmap `reference` described, mapped here."""
    _, filename, dtype, offset, shape = pid
    return np.memmap(filename, dtype=dtype, mode="r", offset=offset, shape=shape)
