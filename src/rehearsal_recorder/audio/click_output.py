"""
The click's own output stream (metronome spec, Part 3): between takes when the
player does not hold the click's device, and during a take whose click goes to
another device than the recording card. The app never opens a second stream on
a device it holds, so on the recording card the click rides the take's stream
(audio/capture.py) and on the player's device the player's (audio/player.py).

The stream is float32, the clicks' own form, as wide as the highest output
asked for. Its callback marks the source's clock with when what it writes is
heard and renders the source into it; nothing else. A stream that ends under it
(a headphone amp unplugged, Bluetooth gone) or goes quiet says so in `problem`,
and only there: a take whose click has gone records on.

`SilentOutput` stands in for an output that is not there. Nothing is heard, but
the click is counted by the computer's clock, so the screen still flashes the
beat (Part 3, "When the click's output is not there").
"""

import threading
import time

import numpy as np
import sounddevice as sd

from rehearsal_recorder.audio import heartbeat
from rehearsal_recorder.audio.click_timing import lead_of
from rehearsal_recorder.audio.devices import STREAM_LOCK, close_stream, open_stream, output_latency

BLOCK_FRAMES = 1024

# The rate of an output that says none, and of one that is not there.
DEFAULT_RATE = 48000

STOPPED = "The click's output stopped answering: it was unplugged, switched off or taken by another app."


def _device(index):
    """What PortAudio says of an output device, the system's for None; {}
    when it says nothing usable."""
    try:
        info = sd.query_devices(index, "output") if index is not None else sd.query_devices(kind="output")
    except Exception:
        return {}
    return info if isinstance(info, dict) else {}


class ClickOutput:
    """
    An output stream on `device_index` (None: the system's), its `channels`
    counted from 1 as the card labels them, at `samplerate` or the device's
    own. `route` is the same outputs counted from 0, for the source.
    """

    def __init__(self, device_index, channels, samplerate=None):
        self.device_index = device_index
        self.channels = tuple(channels)
        self.route = tuple(c - 1 for c in self.channels)
        info = _device(device_index)
        self.name = info.get("name") or ("the system output" if device_index is None else "the click's output")
        rate = samplerate or info.get("default_samplerate") or DEFAULT_RATE
        self.samplerate = int(round(rate))
        self._latency = output_latency(sd, device_index)
        self._source = None
        self._stream = None
        self._frames = 0
        self._stopping = False
        self._failed = None
        self._heartbeat = heartbeat.Heartbeat()

    def start(self, source):
        """Opens the stream and plays `source` in it. Raises what the opening
        raised, with `problem` saying so."""
        self._source = source
        try:
            with STREAM_LOCK:
                self._stream = open_stream(
                    sd.OutputStream,
                    device=self.device_index,
                    channels=max(self.channels),
                    samplerate=self.samplerate,
                    dtype="float32",
                    blocksize=BLOCK_FRAMES,
                    latency=self._latency,
                    callback=self._callback,
                    finished_callback=self._finished,
                )
        except Exception as e:
            self._failed = f"The click's output would not open: {e}"
            raise
        latency = getattr(self._stream, "latency", None)
        if isinstance(latency, (int, float)) and 0 < latency < 1:
            self._latency = float(latency)
        self._heartbeat.start()

    def swap(self, source):
        """Another source from the next block, or None for silence."""
        self._source = source

    def stop(self):
        """Closes the stream. Never raises: the take or the click it served is
        over either way."""
        self._stopping = True
        self._source = None
        self._heartbeat.stop()
        with STREAM_LOCK:
            stream, self._stream = self._stream, None
            if stream is None:
                return
            try:
                close_stream(stream)
            except Exception as e:
                print(f"[click] close: {e}")

    def problem(self):
        """Why the click is not being heard, or None. Plain reads, so a take's
        callback may ask."""
        if (self._failed is None and self._stream is not None and not self._stopping
                and self._heartbeat.silent()):
            self._failed = STOPPED
        return self._failed

    def _finished(self):
        if not self._stopping and self._failed is None:
            self._failed = STOPPED

    def _callback(self, outdata, frames, time_info, status):
        # The audio thread: no print, no lock, nothing allocated but what the
        # source mixes in place.
        self._heartbeat.enter()
        try:
            outdata.fill(0)
            source = self._source
            if source is not None and frames:
                source.render(outdata, self._frames, time.perf_counter_ns(),
                              lead_of(time_info, self._latency))
            self._frames += frames
        finally:
            self._heartbeat.leave()


class SilentOutput:
    """
    Where the click goes when its output is not there: nowhere, but counted
    by the computer's clock as a stream would count it, a block at a time, as
    far as `pump` is asked to, so the screen can light each click on time.
    `name` is the output that is missing; `problem` says why.
    """

    LEAD_SEC = 0.05

    def __init__(self, name, reason="Not connected.", samplerate=DEFAULT_RATE):
        self.name = name
        self.device_index = None
        self.channels = (1,)
        self.route = (0,)
        self.samplerate = samplerate
        self._reason = reason
        self._source = None
        self._started_ns = None
        self._frames = 0
        self._scratch = np.zeros((BLOCK_FRAMES, 1), np.float32)
        self._pumping = threading.Lock()

    def start(self, source):
        self._started_ns = time.perf_counter_ns()
        self._frames = 0
        self._source = source

    def swap(self, source):
        self._source = source

    def stop(self):
        self._source = None

    def problem(self):
        return self._reason

    def pump(self, now_ns=None):
        """Counts the click on to `now_ns` and a little beyond, as an output
        would have written it by then."""
        source = self._source
        if source is None or self._started_ns is None or not self._pumping.acquire(blocking=False):
            return
        try:
            now = time.perf_counter_ns() if now_ns is None else now_ns
            lead = round(self.LEAD_SEC * 1e9)
            # Long unasked (a window hidden for a while): on from now.
            behind = now - self._due(self._frames, lead)
            if behind > 1e9:
                self._frames += int(behind * self.samplerate / 1e9) // BLOCK_FRAMES * BLOCK_FRAMES
            while self._due(self._frames, lead) <= now:
                self._scratch.fill(0)
                source.render(self._scratch, self._frames, self._due(self._frames, lead), self.LEAD_SEC)
                self._frames += BLOCK_FRAMES
        finally:
            self._pumping.release()

    def _due(self, frame, lead):
        """When a block from `frame` would be written: a lead before it is heard."""
        return self._started_ns + round(frame * 1e9 / self.samplerate) - lead
