"""
Sample formats: 16-bit and 24-bit.

Why both. 16 bits is plenty of resolution, but only if the level is set well,
and at a rehearsal nobody is watching the gain — the drummer hits harder in
the chorus and that is that. With 24 bits you can set the inputs with a lot of
room to spare and lose nothing for it, which is the whole point. It costs half
again as much disk.

Why the files are written the way they are. Nothing decodes anything while
recording: whatever comes off the card is packed into its final bytes and
written straight out, so the .raw file already holds exactly the bytes the
.wav will have and finishing a take is just writing a header. That is also
what lets a take survive a crash.

PortAudio hands over 24-bit audio as int32 with the sample left-justified —
the low byte is always zero — so packing is a matter of keeping the top three
bytes, and reading is the same trick backwards.
"""

import numpy as np

SUPPORTED_DEPTHS = (16, 24)

# What a new rehearsal records at unless told otherwise. 24, because the
# headroom is the point and disk is cheap.
DEFAULT_DEPTH = 24

# What a file must be read as when nothing recorded its depth. Rehearsals from
# before this setting existed are 16-bit, and guessing 24 would turn them into
# noise — so this is deliberately not the same constant as the one above.
LEGACY_DEPTH = 16


def normalize_depth(depth, fallback=DEFAULT_DEPTH):
    """Anything unexpected falls back rather than failing a rehearsal."""
    try:
        depth = int(depth)
    except (TypeError, ValueError):
        return fallback
    return depth if depth in SUPPORTED_DEPTHS else fallback


def bytes_per_sample(depth):
    return 3 if normalize_depth(depth, LEGACY_DEPTH) == 24 else 2


def capture_dtype(depth):
    """What to ask sounddevice for. numpy has no 24-bit type, so 24-bit audio
    arrives as int32 and is packed down on the way to disk."""
    return "int32" if normalize_depth(depth, LEGACY_DEPTH) == 24 else "int16"


def full_scale(depth):
    """The value a peak is measured against, in the captured dtype."""
    return 2 ** 31 if normalize_depth(depth, LEGACY_DEPTH) == 24 else 2 ** 15


def pack24(samples_i32, out_u8):
    """
    The top three bytes of each int32, into a contiguous (n, 3) uint8 buffer.

    out_u8 is preallocated by the caller — this runs on the audio thread.
    """
    view = samples_i32.view(np.uint8).reshape(-1, 4)
    np.copyto(out_u8, view[:, 1:4])


def unpack24(bytes_u8, out_i32):
    """
    (n, 3) little-endian 24-bit samples back into int32, sign preserved.

    The top byte is read as int8 first, which sign-extends it for free.
    """
    np.copyto(out_i32, bytes_u8[:, 2].view(np.int8), casting="unsafe")
    out_i32 <<= 8
    out_i32 |= bytes_u8[:, 1]
    out_i32 <<= 8
    out_i32 |= bytes_u8[:, 0]
