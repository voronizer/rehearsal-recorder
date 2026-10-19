"""
When a click written into an output stream is heard (metronome spec, Part 3).

A click take's clicks belong on frames of the recording, and a beat played on
one should land on its frame. On the recording card, with one stream that has
inputs and outputs, a click written into the output comes back into the input
a round trip later, so it is written that much earlier. On another device,
whose clock drifts from the recording card's, each click goes through the
computer's clock: the recording's clock (midi/clock.AudioClock.ns_at) says when
its frame is captured, and the output's own clock (OutputClock) which of its
frames is heard then.

Both take their times from what the driver says (PortAudio's time_info), and a
stream's latency where the driver says nothing believable. Every time on the
computer's clock is `time.perf_counter_ns()`, as MIDI's are.

It imports neither sounddevice nor numpy: it is handed numbers.
"""

from rehearsal_recorder.midi.clock import MAX_AGE_SEC, StreamClock

_NS = 1e9


class OutputClock(StreamClock):
    """
    An output stream's clock: which of its frames is heard at a moment on the
    computer's clock, and when a frame is heard. Its callback marks it with
    every block, and the line through a mark a second, refitted as each is
    kept, reads both ways, as MIDI's clock does (midi/clock.fit).
    """

    def mark(self, arrival_ns, first_frame, lead_sec):
        """
        The callback ran at `arrival_ns`, writing a block that begins with the
        stream's frame `first_frame`, which is heard `lead_sec` later (see
        lead_of). Audio thread: single assignments and one append.
        """
        self._keep((arrival_ns + round(lead_sec * _NS), first_frame))

    def frame_at(self, ns):
        """The frame heard at `ns`, rounded to a whole one; None before the
        stream's first block."""
        frame = self._frame_at(ns)
        return None if frame is None else round(frame)


def lead_of(time_info, fallback_sec):
    """
    How long after the callback runs the first frame it writes is heard, in
    seconds: PortAudio's outputBufferDacTime less its currentTime.
    `fallback_sec`, the stream's output latency, when the driver says nothing
    or nothing believable: a time it left at 0, a lead of 0 or less, or one of
    a second or more.
    """
    try:
        now = time_info.currentTime
        heard = time_info.outputBufferDacTime
    except AttributeError:
        return fallback_sec
    if now and heard and 0 < heard - now < MAX_AGE_SEC:
        return heard - now
    return fallback_sec


def round_trip_frames(time_info, fallback_sec, samplerate):
    """
    In a stream with inputs and outputs, how many frames after a sound is
    written into the output it comes back in the input, through the air or a
    cable: when the first frame written is heard, less when the first frame
    read was captured (outputBufferDacTime less inputBufferAdcTime).
    `fallback_sec`, the stream's input and output latencies together, when
    the driver says nothing believable, as in lead_of; None then when it is
    None, the stream's latencies not yet known.
    """
    try:
        captured = time_info.inputBufferAdcTime
        heard = time_info.outputBufferDacTime
    except AttributeError:
        captured = heard = None
    if captured and heard and 0 < heard - captured < MAX_AGE_SEC:
        return round((heard - captured) * samplerate)
    return None if fallback_sec is None else round(fallback_sec * samplerate)
