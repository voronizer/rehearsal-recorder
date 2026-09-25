"""
Listening to the inputs without recording — the "check signal" step.

The point is to confirm, before the rehearsal starts, that the guitarist
really lands on the guitar track and not the vocal one. The stream is opened
exactly like it is for recording, but nothing is written to disk: only levels
are measured.
"""

import threading

import sounddevice as sd

from rehearsal_recorder.audio.devices import STREAM_LOCK

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
        # One figure per channel: a dead half of a stereo pair is the very
        # thing this screen exists to catch, and reducing the two to their
        # louder half would hide it.
        self._levels = {t["name"]: [0.0] * self._width[t["name"]] for t in tracks}
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
                name = track["name"]
                first = track["channel"] - 1
                held = self._levels.setdefault(name, [0.0] * self._width[name])
                for c in range(self._width[name]):
                    column = indata[: frames, first + c]
                    loudest = max(abs(int(column.max())), abs(int(column.min())))
                    peak = loudest / 32768.0
                    if peak > held[c]:
                        held[c] = peak

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
            snapshot = {name: list(v) for name, v in self._levels.items()}
            for name, held in self._levels.items():
                self._levels[name] = [0.0] * len(held)
        return snapshot

    def stop(self):
        with STREAM_LOCK:
            stream, self._stream = self._stream, None
            if stream is not None:
                stream.stop()
                stream.close()
