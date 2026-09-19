"""
Take playback, done in Python.

The tracks used to be played by the browser through Web Audio. That made it
impossible to pick an output device: on the web the output is switched with
setSinkId, which this engine does not implement for AudioContext. It also
meant holding the whole take in memory decoded (float32, ~11.5 MB per minute
per track) and maintaining a second, streaming mode for long takes.

This is simpler and more honest: sounddevice (the same library used for
recording), the output device is chosen explicitly, and tracks are read
through memmap — the OS pages in what is needed, so memory does not grow with
take length and seeking is just an index change.

Synchronisation comes for free: every track is mixed into one stream from the
same position, so there is nothing to drift apart.
"""

import threading
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

from rehearsal_recorder.audio.devices import STREAM_LOCK, usable_output
from rehearsal_recorder.audio.format import unpack24

BLOCK_FRAMES = 1024

# How quickly gain follows a change. Switching the coefficient instantly
# clicks, so it is eased towards the target over a few blocks.
GAIN_SMOOTHING = 0.25


def _open_track(path):
    """
    Returns (memmap, frames, samplerate, sample_bytes) for a 16- or 24-bit wav.

    Neither is decoded here. 16-bit audio is mapped as int16 and read
    directly; 24-bit is mapped as raw bytes, shaped (frames, 3), and turned
    into numbers a block at a time while playing — numpy has no 24-bit type,
    and converting a whole take up front would put its length back into memory,
    which is exactly what memmap is here to avoid.
    """
    path = Path(path)
    with wave.open(str(path), "rb") as wf:
        frames = wf.getnframes()
        samplerate = wf.getframerate()
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()

    if sampwidth not in (2, 3):
        raise ValueError(
            f"{path.name}: expected 16- or 24-bit, got {sampwidth * 8}"
        )

    # In our files the data chunk is last, so the offset is derived from the
    # end of the file instead of parsing the header by hand.
    data_bytes = frames * channels * sampwidth
    offset = path.stat().st_size - data_bytes
    if offset < 0:
        raise ValueError(f"{path.name}: file is shorter than its header claims")

    if sampwidth == 2:
        data = np.memmap(
            path, dtype="<i2", mode="r", offset=offset, shape=(frames * channels,)
        )
        if channels > 1:
            data = data.reshape(-1, channels)[:, 0]  # first channel only
    else:
        data = np.memmap(
            path,
            dtype=np.uint8,
            mode="r",
            offset=offset,
            shape=(frames, channels, 3),
        )[:, 0, :]  # first channel only, still (frames, 3)

    return data, frames, samplerate, sampwidth


class Track:
    def __init__(self, name, path):
        self.name = name
        self.data, self.frames, self.samplerate, self.sample_bytes = _open_track(
            path
        )
        self.volume = 1.0
        self.muted = False
        # Current smoothed coefficient, so mute/solo does not click.
        self.current_gain = 1.0
        # Everything is mixed at 16-bit scale, because that is what goes out
        # to the card. A 24-bit sample is 256 times larger for the same
        # loudness, so it is scaled down as it is read — one multiply that
        # rides along with the volume.
        self.scale = 1.0 / 256.0 if self.sample_bytes == 3 else 1.0


class TakePlayer:
    def __init__(self, tracks):
        """tracks: [{"name":.., "file":..}] — the tracks of one take.

        No audio device is opened here; that lives in open_output() so mixing,
        seeking and looping can be tested without a sound card."""
        if not tracks:
            raise ValueError("No tracks")

        self.tracks = [Track(t["name"], t["file"]) for t in tracks]
        self.samplerate = self.tracks[0].samplerate
        self.total_frames = max(t.frames for t in self.tracks)

        self._lock = threading.Lock()
        self.last_status = None
        self._pos = 0
        self._playing = False
        self._loop = None  # (start_frame, end_frame)
        self._soloed = None
        self._finished = False

        self._out_channels = 2
        self._stream = None

        # Buffers are allocated once and reused. Allocating inside an audio
        # callback means calling malloc on the realtime thread every 21 ms —
        # it is the one thing in this app that touches the allocator from a
        # thread we do not control, and it buys nothing.
        self._mix = None
        self._scratch = None
        self._out16 = None
        # Only needed when a take has 24-bit tracks: the bytes unpacked into
        # numbers, once per block.
        self._i32 = None

    def open_output(self, device_index=None):
        """
        Opens the output. Returns a complaint when the chosen device could not
        be used and the system one was taken instead — the take still plays,
        the person just needs to know it is coming out somewhere else.
        """
        index, complaint = usable_output(device_index, self.samplerate)

        with STREAM_LOCK:
            self.close_output()
            self._stream = sd.OutputStream(
                device=index,
                channels=self._out_channels,
                samplerate=self.samplerate,
                dtype="int16",
                blocksize=BLOCK_FRAMES,
                callback=self._callback,
            )
            self._stream.start()
        return complaint

    # ---------- audio ----------

    def _effective_gain(self, track):
        if track.muted:
            return 0.0
        if self._soloed is not None and self._soloed != track.name:
            return 0.0
        return track.volume

    def _ensure_buffers(self, frames):
        if self._mix is not None and self._mix.shape[0] >= frames:
            return
        self._mix = np.zeros((frames, self._out_channels), dtype=np.float32)
        self._scratch = np.zeros(frames, dtype=np.float32)
        self._out16 = np.zeros((frames, self._out_channels), dtype=np.int16)
        self._i32 = np.zeros(frames, dtype=np.int32)

    def _render(self, frames):
        """
        Produces one block of audio. Kept separate from the callback so that
        mixing, seeking and looping can be verified without a sound card.

        Returns a view on a reused buffer: the caller copies it into the
        device's own buffer straight away and never holds on to it.
        """
        self._ensure_buffers(frames)
        out = self._mix[:frames]
        out.fill(0.0)
        result = self._out16[:frames]

        if not self._playing:
            result.fill(0)
            return result

        written = 0
        while written < frames:
            if self._loop is not None:
                seg_start, seg_end = self._loop
                if self._pos < seg_start or self._pos >= seg_end:
                    self._pos = seg_start
            else:
                seg_end = self.total_frames

            available = seg_end - self._pos
            if available <= 0:
                if self._loop is not None:
                    self._pos = self._loop[0]
                    continue
                # Take finished: stop and rewind to the start.
                self._playing = False
                self._finished = True
                self._pos = 0
                break

            n = min(frames - written, available)

            for track in self.tracks:
                target = self._effective_gain(track)
                track.current_gain += (target - track.current_gain) * GAIN_SMOOTHING
                gain = track.current_gain
                if gain < 1e-4:
                    continue

                end = min(self._pos + n, track.frames)
                if end <= self._pos:
                    continue
                length = end - self._pos
                seg = self._scratch[:length]
                if track.sample_bytes == 3:
                    whole = self._i32[:length]
                    unpack24(track.data[self._pos:end], whole)
                    np.copyto(seg, whole, casting="unsafe")
                else:
                    np.copyto(seg, track.data[self._pos:end], casting="unsafe")
                seg *= gain * track.scale
                out[written:written + length, 0] += seg
                out[written:written + length, 1] += seg

            self._pos += n
            written += n

        np.clip(out, -32768, 32767, out=out)
        np.copyto(result, out, casting="unsafe")
        return result

    def _callback(self, outdata, frames, time_info, status):
        # Deliberately no print() here: this runs on the audio thread, where
        # anything that takes a lock or allocates can cost a dropout. The last
        # status is kept for whoever asks.
        if status:
            self.last_status = str(status)
        with self._lock:
            outdata[:] = self._render(frames)

    # ---------- transport ----------

    def play(self):
        with self._lock:
            if self._pos >= self.total_frames:
                self._pos = 0
            self._finished = False
            self._playing = True

    def pause(self):
        with self._lock:
            self._playing = False

    def toggle(self):
        with self._lock:
            if self._playing:
                self._playing = False
            else:
                if self._pos >= self.total_frames:
                    self._pos = 0
                self._finished = False
                self._playing = True

    def seek(self, seconds):
        with self._lock:
            frame = int(max(0.0, seconds) * self.samplerate)
            self._pos = min(frame, self.total_frames)
            self._finished = False

    def set_loop(self, start_sec, end_sec):
        with self._lock:
            if start_sec is None or end_sec is None:
                self._loop = None
                return
            a = int(max(0.0, start_sec) * self.samplerate)
            b = int(min(end_sec, self.total_frames / self.samplerate) * self.samplerate)
            if b - a < int(0.2 * self.samplerate):
                self._loop = None
                return
            self._loop = (a, b)
            if not (a <= self._pos < b):
                self._pos = a

    # ---------- mix ----------

    def set_volume(self, name, volume):
        with self._lock:
            for t in self.tracks:
                if t.name == name:
                    t.volume = float(min(1.0, max(0.0, volume)))

    def set_muted(self, name, muted):
        with self._lock:
            for t in self.tracks:
                if t.name == name:
                    t.muted = bool(muted)

    def set_solo(self, name):
        with self._lock:
            self._soloed = name

    # ---------- state ----------

    def state(self):
        with self._lock:
            return {
                "playing": self._playing,
                "position": self._pos / self.samplerate,
                "duration": self.total_frames / self.samplerate,
                "finished": self._finished,
                "loop": (
                    {
                        "a": self._loop[0] / self.samplerate,
                        "b": self._loop[1] / self.samplerate,
                    }
                    if self._loop
                    else None
                ),
                "soloed": self._soloed,
                "muted": [t.name for t in self.tracks if t.muted],
                "volumes": {t.name: t.volume for t in self.tracks},
            }

    def close_output(self):
        """
        Closes just the stream, keeping the take loaded — this is what
        switching the playback device needs.

        The reference is taken out first and under the lock: two closes can
        arrive at once (the interface closing a player while a device change
        reopens it), and the old code could pass its `is not None` check and
        then find the stream gone, which is where
        "'NoneType' object has no attribute 'close'" came from.
        """
        with STREAM_LOCK:
            stream, self._stream = self._stream, None
            if stream is None:
                return
            try:
                stream.stop()
                stream.close()
            except Exception as e:
                print(f"[player] close: {e}")

    def close(self):
        """Closes the stream and lets go of the audio."""
        self.close_output()
        with self._lock:
            for t in self.tracks:
                t.data = None
            self.tracks = []
