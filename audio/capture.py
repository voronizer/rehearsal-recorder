"""
Multi-channel capture with continuous crash-safe writing.

Nothing is buffered in memory for long: every block goes straight to disk as
raw PCM (one file per track), and every 30 seconds those files are force-
flushed (flush + fsync). If the app dies or the interface is unplugged, at
most the last ~30 seconds are lost instead of the whole take.

On stop() the raw files are wrapped into proper .wav files. That is why a
take interrupted by a crash leaves .raw files behind — see audio/drafts.py,
which turns them back into playable takes.
"""

import os
import threading
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

from audio.devices import STREAM_LOCK
from audio.format import (
    bytes_per_sample,
    capture_dtype,
    full_scale,
    normalize_depth,
    pack24,
)

FLUSH_INTERVAL_SEC = 30

# Capture block size. This used to be half a second, which made the level
# meters visibly lag: a peak arrived only twice per second and was averaged
# over the whole block. ~21 ms at 48 kHz keeps the meters lively and costs
# next to nothing.
BLOCK_FRAMES = 1024

RAW_SUFFIX = ".raw"


class AudioRecorder:
    def __init__(self, device_index, samplerate, tracks, out_dir, bit_depth=16):
        """
        tracks: list of {"name": str, "channel": int}; channel is 1-based,
                the way it is shown in the interface (channel 1 = first input).
        out_dir: where this take's files are written.
        bit_depth: 16 or 24 — see audio/format.py for what that costs and buys.
        """
        if not tracks:
            raise ValueError("No tracks configured")

        self.device_index = device_index
        self.samplerate = samplerate
        self.bit_depth = normalize_depth(bit_depth)
        self._dtype = capture_dtype(self.bit_depth)
        self._sample_bytes = bytes_per_sample(self.bit_depth)
        self._full_scale = full_scale(self.bit_depth)
        self.tracks = tracks
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)

        self._stream = None
        self._raw_files = {}
        self._frames_written = 0
        self._max_channel = max(t["channel"] for t in tracks)

        self._stop_flush = threading.Event()
        self._flush_thread = None

        self._levels = {t["name"]: 0.0 for t in tracks}
        self._levels_lock = threading.Lock()

        # One contiguous scratch buffer per track, allocated once. The
        # callback runs on the audio thread; asking the allocator for memory
        # there every 21 ms is the kind of thing that only ever hurts.
        self._scratch = {
            t["name"]: np.zeros(BLOCK_FRAMES, dtype=self._dtype) for t in tracks
        }
        # Only 24-bit needs a second buffer: the packed bytes on their way out.
        self._packed = (
            {t["name"]: np.zeros((BLOCK_FRAMES, 3), dtype=np.uint8) for t in tracks}
            if self.bit_depth == 24
            else {}
        )

        # The last PortAudio status (xrun and friends), for whoever asks.
        self.last_status = None
        self._stopped = False

        # Why the recording stopped on its own — almost always an unplugged
        # interface. The interface polls this and can stop the take, keeping
        # whatever was recorded so far.
        self.error = None
        self._stopping = False
        self._result = {"duration_sec": 0.0, "tracks": []}

    @staticmethod
    def safe_name(name):
        keep = "".join(c if c.isalnum() or c in " -_()" else "_" for c in name)
        return keep.strip() or "track"

    def _finished(self):
        """PortAudio calls this when the stream stops. If we did not ask for
        the stop, the device went away."""
        if not self._stopping and self.error is None:
            self.error = (
                "Recording stopped: the audio interface stopped responding. "
                "Everything captured up to that point has been saved."
            )

    def is_active(self):
        return bool(self._stream is not None and self._stream.active)

    def _callback(self, indata, frames, time_info, status):
        # No print() here: this is the audio thread. A dropped block is worth
        # knowing about, not worth stalling the stream over.
        if status:
            self.last_status = str(status)
        if frames == 0:
            return

        peaks = {}
        for track in self.tracks:
            name = track["name"]
            column = indata[: frames, track["channel"] - 1]

            # A column of an interleaved block is strided, so it is copied
            # into a contiguous buffer to be written — the buffer is reused,
            # unlike tobytes(), which would allocate on every block.
            buf = self._scratch.get(name)
            if buf is None or buf.shape[0] < frames:
                buf = np.zeros(frames, dtype=self._dtype)
                self._scratch[name] = buf
            chunk = buf[:frames]
            np.copyto(chunk, column)

            if self.bit_depth == 24:
                packed = self._packed.get(name)
                if packed is None or packed.shape[0] < frames:
                    packed = np.zeros((frames, 3), dtype=np.uint8)
                    self._packed[name] = packed
                out = packed[:frames]
                pack24(chunk, out)
                self._raw_files[name].write(memoryview(out))
            else:
                self._raw_files[name].write(memoryview(chunk))

            # Normalised to 0..1 for the UI. max()/min() return scalars, so
            # nothing is allocated.
            loudest = max(abs(int(chunk.max())), abs(int(chunk.min())))
            peaks[name] = loudest / self._full_scale

        # Blocks are shorter than the UI polling interval, so accumulate the
        # maximum between polls — otherwise a short spike could slip through
        # unnoticed.
        with self._levels_lock:
            for name, peak in peaks.items():
                if peak > self._levels.get(name, 0.0):
                    self._levels[name] = peak
        self._frames_written += frames

    def get_levels(self):
        """Peak (0..1) per track since the last poll. Reading resets the
        accumulator, so the next call reports only what arrived after it."""
        with self._levels_lock:
            snapshot = dict(self._levels)
            for name in self._levels:
                self._levels[name] = 0.0
        return snapshot

    def _flush_loop(self):
        while not self._stop_flush.wait(FLUSH_INTERVAL_SEC):
            self.flush()

    def start(self):
        for track in self.tracks:
            path = self.out_dir / f"{self.safe_name(track['name'])}{RAW_SUFFIX}"
            self._raw_files[track["name"]] = open(path, "wb")

        with STREAM_LOCK:
            self._stream = sd.InputStream(
                device=self.device_index,
                channels=self._max_channel,
                samplerate=self.samplerate,
                dtype=self._dtype,
                blocksize=BLOCK_FRAMES,
                callback=self._callback,
                finished_callback=self._finished,
            )
            self._stream.start()

        self._stop_flush.clear()
        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._flush_thread.start()

    def flush(self):
        """Force everything to disk. Runs every 30 seconds on its own, but can
        be called by hand."""
        for f in self._raw_files.values():
            f.flush()
            os.fsync(f.fileno())

    def stop(self):
        # Stopping can be asked for twice — the interface vanishes and the
        # health check stops the take at the same moment somebody presses
        # Stop. The second call must not fsync closed files or try to rebuild
        # .wav files whose .raw sources are already gone.
        if self._stopped:
            return self._result
        self._stopped = True

        self._stop_flush.set()
        if self._flush_thread is not None:
            self._flush_thread.join(timeout=2)

        # Mark the stop as ours, otherwise finished_callback would report it
        # as a vanished interface.
        self._stopping = True
        with STREAM_LOCK:
            stream, self._stream = self._stream, None
            try:
                if stream is not None:
                    stream.stop()
                    stream.close()
            except Exception as e:
                print(f"[audio] stop: {e}")

        self.flush()
        for f in self._raw_files.values():
            f.close()

        duration = self._frames_written / self.samplerate

        finalized = []
        for track in self.tracks:
            raw_path = self.out_dir / f"{self.safe_name(track['name'])}{RAW_SUFFIX}"
            wav_path = self.out_dir / f"{self.safe_name(track['name'])}.wav"
            raw_to_wav(raw_path, wav_path, self.samplerate, self.bit_depth)
            raw_path.unlink(missing_ok=True)
            finalized.append({"name": track["name"], "file": str(wav_path)})

        self._result = {"duration_sec": duration, "tracks": finalized}
        return self._result


def raw_to_wav(raw_path, wav_path, samplerate, bit_depth=16):
    """
    Wrap a raw mono PCM file into a .wav with a proper header.

    The raw file already holds the final bytes, so this only adds the header —
    which is why a take interrupted by a crash can still be rescued.
    """
    width = bytes_per_sample(bit_depth)
    with open(raw_path, "rb") as rf:
        data = rf.read()
    # A take cut off mid-sample would otherwise produce a wav whose length
    # does not divide evenly, which some players refuse outright.
    usable = len(data) - (len(data) % width)
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(width)
        wf.setframerate(samplerate)
        wf.writeframes(data[:usable])
