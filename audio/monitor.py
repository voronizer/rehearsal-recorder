"""
Listening to the inputs without recording — the "check signal" step.

The point is to confirm, before the rehearsal starts, that the guitarist
really lands on the guitar track and not the vocal one. The stream is opened
exactly like it is for recording, but nothing is written to disk: only levels
are measured.
"""

import threading

import sounddevice as sd

from audio.devices import STREAM_LOCK

BLOCK_FRAMES = 1024


class LevelMonitor:
    def __init__(self, device_index, samplerate, tracks):
        if not tracks:
            raise ValueError("No tracks configured")

        self.device_index = device_index
        self.samplerate = samplerate
        self.tracks = tracks
        self._max_channel = max(t["channel"] for t in tracks)

        self._stream = None
        self._levels = {t["name"]: 0.0 for t in tracks}
        self._lock = threading.Lock()
        self.last_status = None

    def _callback(self, indata, frames, time_info, status):
        # The audio thread: no printing, no allocating. max()/min() hand back
        # scalars, so measuring a peak costs nothing.
        if status:
            self.last_status = str(status)
        if frames == 0:
            return
        with self._lock:
            for track in self.tracks:
                column = indata[: frames, track["channel"] - 1]
                loudest = max(abs(int(column.max())), abs(int(column.min())))
                peak = loudest / 32768.0
                if peak > self._levels.get(track["name"], 0.0):
                    self._levels[track["name"]] = peak

    def start(self):
        with STREAM_LOCK:
            self._stream = sd.InputStream(
                device=self.device_index,
                channels=self._max_channel,
                samplerate=self.samplerate,
                dtype="int16",
                blocksize=BLOCK_FRAMES,
                callback=self._callback,
            )
            self._stream.start()

    def get_levels(self):
        """Peak since the last poll; reading resets the accumulator."""
        with self._lock:
            snapshot = dict(self._levels)
            for name in self._levels:
                self._levels[name] = 0.0
        return snapshot

    def stop(self):
        with STREAM_LOCK:
            stream, self._stream = self._stream, None
            if stream is not None:
                stream.stop()
                stream.close()
