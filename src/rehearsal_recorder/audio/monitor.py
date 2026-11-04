"""
Listening to the inputs without recording — the "check signal" step.

The point is to confirm, before the rehearsal starts, that the guitarist
really lands on the guitar track and not the vocal one. The stream is opened
exactly like it is for recording, through rtmixer's ring (audio/ring.py), but
nothing is written to disk: only levels are measured.
"""

import threading

import sounddevice as sd

from rehearsal_recorder.audio import heartbeat
from rehearsal_recorder.audio.devices import (
    STREAM_LOCK,
    close_stream,
    input_latency,
    open_stream,
)
from rehearsal_recorder.audio.ring import RingInput

BLOCK_FRAMES = 1024


class LevelMonitor:
    def __init__(self, device_index, samplerate, tracks):
        if not tracks:
            raise ValueError("No tracks configured")

        self.device_index = device_index
        self.samplerate = samplerate
        self.tracks = tracks
        # A stereo track reaches one input past its own number.
        self._width = {t["name"]: 2 if t.get("stereo") else 1 for t in tracks}
        self._max_channel = max(
            t["channel"] + self._width[t["name"]] - 1 for t in tracks
        )

        self._stream = None
        self._input = None
        # Whether the card is still sending: unplugged mid-check, an ASIO
        # card leaves every bar at rest and says nothing.
        self._heartbeat = heartbeat.Heartbeat()
        self.error = None
        try:
            self._name = sd.query_devices(device_index)["name"]
        except Exception:
            self._name = None
        # One figure per channel: a dead half of a stereo pair is the very
        # thing this screen exists to catch, and reducing the two to their
        # louder half would hide it.
        self._levels = {t["name"]: [0.0] * self._width[t["name"]] for t in tracks}
        self._lock = threading.Lock()
        self.last_status = None

    def _measure(self, indata, first_frame=0, arrival_ns=None):
        """The ring's frames (float32, frames by inputs), each input's peak
        kept until the next poll. max()/min() hand back scalars."""
        frames = len(indata)
        if not frames:
            return
        with self._lock:
            for track in self.tracks:
                name = track["name"]
                first = track["channel"] - 1
                held = self._levels.setdefault(name, [0.0] * self._width[name])
                for c in range(self._width[name]):
                    column = indata[: frames, first + c]
                    peak = min(1.0, max(abs(float(column.max())), abs(float(column.min()))))
                    if peak > held[c]:
                        held[c] = peak

    def start(self):
        import rtmixer  # the sound process's alone

        with STREAM_LOCK:
            self._stream = open_stream(
                rtmixer.Recorder,
                device=self.device_index,
                channels=self._max_channel,
                samplerate=self.samplerate,
                blocksize=BLOCK_FRAMES,
                latency=input_latency(sd, self.device_index),
            )
        self._input = RingInput(self._stream, self._max_channel, self.samplerate, self._measure,
                                heartbeat=self._heartbeat)
        self._input.start()

    def problem(self):
        """
        Why the check has stopped hearing the card, or None. Once said, it
        stays said: the stream it is about does not come back by itself.
        """
        if self.error is None and self._heartbeat.silent():
            card = f"“{self._name}”" if self._name else "the audio interface"
            self.error = (
                f"No sound from {card} for {heartbeat.SILENCE_SEC:.0f} seconds. "
                "It was unplugged, switched off or stopped answering. Plug "
                "it back in and press Check signal."
            )
        return self.error

    def get_levels(self):
        """Peak since the last poll; reading resets the accumulator."""
        with self._lock:
            snapshot = {name: list(v) for name, v in self._levels.items()}
            for name, held in self._levels.items():
                self._levels[name] = [0.0] * len(held)
        return snapshot

    def stop(self):
        recording, self._input = self._input, None
        if recording is not None:
            recording.stop(drain=False)
        self._heartbeat.stop()
        with STREAM_LOCK:
            stream, self._stream = self._stream, None
            if stream is not None:
                close_stream(stream)
