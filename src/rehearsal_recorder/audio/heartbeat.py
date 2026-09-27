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
"""

import time

# A block is ~21 ms, so this is well over a hundred of them missing: not a
# hiccup, a card that is gone.
SILENCE_SEC = 3.0


class Heartbeat:
    """Noted by a stream's callback on the way in and out; asked from
    anywhere else. Plain attributes, no lock: the callback runs on the audio
    thread and must not wait, and each read is of one value."""

    def __init__(self):
        self._last = None
        self._inside = False

    def start(self):
        """The stream is open and running: from now on, silence counts."""
        self._inside = False
        self._last = time.monotonic()

    def stop(self):
        """The stream is closed: a closed stream is quiet, not silent."""
        self._last = None

    def enter(self):
        self._last = time.monotonic()
        self._inside = True

    def leave(self):
        self._inside = False
        self._last = time.monotonic()

    def silent(self):
        """True when a running stream has gone SILENCE_SEC without a call,
        and is not in the middle of one now."""
        last = self._last
        return (
            last is not None
            and not self._inside
            and time.monotonic() - last > SILENCE_SEC
        )
