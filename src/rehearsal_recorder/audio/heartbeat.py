"""
Whether a stream is still being called — the one way to tell that its card
has gone.

An ASIO card that is unplugged does not say so: PortAudio ignores the
driver's reset request, the stream is simply never called again, and it goes
on reporting itself active, so finished_callback never fires. Other drivers
do end the stream, and then it is not called again either. So every stream's
callback notes each call, and a stream that has gone a few seconds without
one has lost its card — whichever driver it is on.

A call that takes long does not count as silence. The card delivered, and
the app is busy with it: a take's block that a slow disk takes seconds to
swallow must not stop the take.

Nor does the wait for the first block, up to a point. A driver can take a
couple of seconds to start its card — FlexASIO's first block came two
seconds after the stream started — and counted from the start, that is
most of SILENCE_SEC gone before the card has had a chance to say anything.
"""

import time

# A block is ~21 ms, so this is well over a hundred of them missing: not a
# hiccup, a card that is gone.
SILENCE_SEC = 3.0

# How long a stream that has just started may wait for its first block.
# Longer than SILENCE_SEC so a slow driver is not taken for a missing card;
# no longer than this, because a take started into a card that never sends
# still has to be stopped before anyone thinks it is recording.
FIRST_BLOCK_SEC = 5.0


class Heartbeat:
    """Noted by a stream's callback on the way in and out; asked from
    anywhere else. Plain attributes, no lock: the callback runs on the audio
    thread and must not wait, and each read is of one value."""

    def __init__(self):
        self._last = None
        self._inside = False
        self._called = False

    def start(self):
        """The stream is open and running: from now on, silence counts."""
        self._inside = False
        self._called = False
        self._last = time.monotonic()

    def stop(self):
        """The stream is closed: a closed stream is quiet, not silent."""
        self._last = None

    def enter(self):
        # _last before _called, and silent() reads them the other way
        # round: whoever sees the first call also sees when it came.
        self._last = time.monotonic()
        self._called = True
        self._inside = True

    def leave(self):
        self._inside = False
        self._last = time.monotonic()

    def silent(self):
        """True when a running stream has gone SILENCE_SEC without a call —
        FIRST_BLOCK_SEC, while it has not had its first — and is not in the
        middle of one now."""
        limit = SILENCE_SEC if self._called else FIRST_BLOCK_SEC
        last = self._last
        return (
            last is not None
            and not self._inside
            and time.monotonic() - last > limit
        )
