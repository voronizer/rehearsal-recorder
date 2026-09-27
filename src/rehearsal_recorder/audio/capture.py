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

import json
import os
import threading
import wave
from pathlib import Path

import numpy as np
import sounddevice as sd

from rehearsal_recorder.activity import Stages
from rehearsal_recorder.audio import heartbeat
from rehearsal_recorder.audio.devices import (
    STREAM_LOCK,
    close_stream,
    open_stream,
)
from rehearsal_recorder.audio.format import (
    bytes_per_sample,
    capture_dtype,
    full_scale,
    normalize_depth,
    pack24,
)

FLUSH_INTERVAL_SEC = 30

# How much of a raw file is copied at a time: small enough that an hour of
# 24-bit audio is not read into memory whole, large enough that the copy is
# not slowed down by the number of pieces.
COPY_BYTES = 4 * 1024 * 1024

# A take whose card has gone quiet — see audio/heartbeat.py for how that is
# told, and why it has to be.
STALLED = (
    "Recording stopped: no sound has come from the audio interface for "
    f"{heartbeat.SILENCE_SEC:.0f} seconds — it was unplugged, switched off or "
    "stopped answering. Everything captured up to that point has been saved."
)

# Capture block size. This used to be half a second, which made the level
# meters visibly lag: a peak arrived only twice per second and was averaged
# over the whole block. ~21 ms at 48 kHz keeps the meters lively and costs
# next to nothing.
BLOCK_FRAMES = 1024

RAW_SUFFIX = ".raw"

# Written beside the raw files as recording starts. A .raw file carries no
# header, so without this nothing in a crashed take's folder says how wide
# each track was, and a rescued stereo keyboard would come back as one
# channel of twice the length.
TAKE_RECORD = "take.json"


class AudioRecorder:
    def __init__(self, device_index, samplerate, tracks, out_dir, bit_depth=16):
        """
        tracks: list of {"name": str, "channel": int, "stereo": bool};
                channel is 1-based, the way it is shown in the interface
                (channel 1 = first input). A stereo track takes that input
                and the next one, and is written as one two-channel file.
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
        # Whether the card is still delivering blocks.
        self._heartbeat = heartbeat.Heartbeat()
        # A stereo track reaches one input further than its own number, so
        # the stream has to be opened that much wider.
        self._width = {t["name"]: 2 if t.get("stereo") else 1 for t in tracks}
        self._max_channel = max(
            t["channel"] + self._width[t["name"]] - 1 for t in tracks
        )

        self._stop_flush = threading.Event()
        self._flush_thread = None

        # One figure per channel: a stereo pair whose right microphone died
        # looks exactly like a working one if the two are reduced to their
        # louder half, and the signal check exists to catch precisely that.
        self._levels = {t["name"]: [0.0] * self._width[t["name"]] for t in tracks}
        self._levels_lock = threading.Lock()

        # One contiguous scratch buffer per track, allocated once. The
        # callback runs on the audio thread; asking the allocator for memory
        # there every 21 ms is the kind of thing that only ever hurts.
        self._scratch = {
            t["name"]: np.zeros(
                (BLOCK_FRAMES, self._width[t["name"]]), dtype=self._dtype
            )
            for t in tracks
        }
        # Only 24-bit needs a second buffer: the packed bytes on their way out.
        self._packed = (
            {
                t["name"]: np.zeros(
                    (BLOCK_FRAMES * self._width[t["name"]], 3), dtype=np.uint8
                )
                for t in tracks
            }
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

    def problem(self):
        """
        Why this take is not recording, or None. What the health check asks.

        As well as a stream that ended on its own (see _finished), a card
        that has gone silent is called stopped, since an unplugged ASIO card
        never ends its stream. Once said, it stays said.
        """
        if self.error is None and not self._stopping and self._heartbeat.silent():
            self.error = STALLED
        return self.error

    def is_active(self):
        return bool(self._stream is not None and self._stream.active)

    def _callback(self, indata, frames, time_info, status):
        # No print() here: this is the audio thread. A dropped block is worth
        # knowing about, not worth stalling the stream over.
        self._heartbeat.enter()
        try:
            if status:
                self.last_status = str(status)
            # Once a stop is under way the files may be closing, whether or
            # not the driver has let go of the stream yet.
            if frames == 0 or self._stopping:
                return
            self._take_block(indata, frames)
        finally:
            self._heartbeat.leave()

    def _take_block(self, indata, frames):
        peaks = {}
        for track in self.tracks:
            name = track["name"]
            first = track["channel"] - 1
            width = self._width[name]
            column = indata[: frames, first : first + width]

            # Columns of an interleaved block are strided, so they are copied
            # into a contiguous buffer to be written — the buffer is reused,
            # unlike tobytes(), which would allocate on every block. Copied as
            # (frames, width), the bytes come out interleaved left then right,
            # which is the order a wav wants them in.
            buf = self._scratch.get(name)
            if buf is None or buf.shape[0] < frames:
                buf = np.zeros((frames, width), dtype=self._dtype)
                self._scratch[name] = buf
            chunk = buf[:frames]
            np.copyto(chunk, column)

            if self.bit_depth == 24:
                packed = self._packed.get(name)
                if packed is None or packed.shape[0] < frames * width:
                    packed = np.zeros((frames * width, 3), dtype=np.uint8)
                    self._packed[name] = packed
                out = packed[: frames * width]
                pack24(chunk.reshape(-1), out)
                self._raw_files[name].write(memoryview(out))
            else:
                self._raw_files[name].write(memoryview(chunk))

            # Normalised to 0..1 for the UI, one figure per channel. max()
            # and min() over a column return scalars, so nothing is allocated.
            peaks[name] = [
                max(abs(int(chunk[:, c].max())), abs(int(chunk[:, c].min())))
                / self._full_scale
                for c in range(width)
            ]

        # Blocks are shorter than the UI polling interval, so accumulate the
        # maximum between polls — otherwise a short spike could slip through
        # unnoticed.
        with self._levels_lock:
            for name, channels in peaks.items():
                held = self._levels.setdefault(name, [0.0] * len(channels))
                for c, peak in enumerate(channels):
                    if peak > held[c]:
                        held[c] = peak
        self._frames_written += frames

    def get_levels(self):
        """Peak (0..1) per track since the last poll. Reading resets the
        accumulator, so the next call reports only what arrived after it."""
        with self._levels_lock:
            snapshot = {name: list(v) for name, v in self._levels.items()}
            for name, held in self._levels.items():
                self._levels[name] = [0.0] * len(held)
        return snapshot

    def _flush_loop(self):
        while not self._stop_flush.wait(FLUSH_INTERVAL_SEC):
            self.flush()

    def start(self):
        self._write_record()
        try:
            for track in self.tracks:
                path = self.out_dir / f"{self.safe_name(track['name'])}{RAW_SUFFIX}"
                self._raw_files[track["name"]] = open(path, "wb")

            with STREAM_LOCK:
                self._stream = open_stream(
                    sd.InputStream,
                    device=self.device_index,
                    channels=self._max_channel,
                    samplerate=self.samplerate,
                    dtype=self._dtype,
                    blocksize=BLOCK_FRAMES,
                    callback=self._callback,
                    finished_callback=self._finished,
                )
        except BaseException:
            self._discard_files()
            raise
        self._heartbeat.start()

        self._stop_flush.clear()
        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._flush_thread.start()

    def _discard_files(self):
        """
        What start() made, taken back when the card would not open, or the
        disk would not take one of the files.

        Left behind, the empty raw files are audio as far as the drafts are
        concerned — a 0:00 unsaved take, and a rehearsal folder that is never
        cleaned away — and, still open, Windows will not let that folder be
        moved or deleted. Only what start() made is removed, and the folder
        only if that leaves it empty. Nothing here raises: the error that
        stopped the start is the one worth reporting.
        """
        # A stream that opens after the app stopped waiting is closed again
        # on the audio thread, but may be called once or twice before then.
        self._stopping = True
        made = [
            self.out_dir / f"{self.safe_name(name)}{RAW_SUFFIX}"
            for name in self._raw_files
        ]
        for f in self._raw_files.values():
            f.close()
        for path in [*made, self.out_dir / TAKE_RECORD]:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        try:
            self.out_dir.rmdir()
        except OSError:
            pass  # something else is in it, or it is already gone

    def _write_record(self):
        """What the folder needs to describe itself if the app dies: the
        format, and how wide each track is. Best effort — a take that cannot
        write this is still worth recording."""
        try:
            (self.out_dir / TAKE_RECORD).write_text(
                json.dumps({
                    "samplerate": self.samplerate,
                    "bit_depth": self.bit_depth,
                    "tracks": [
                        {"file": self.safe_name(t["name"]),
                         "channels": self._width[t["name"]]}
                        for t in self.tracks
                    ],
                }),
                encoding="utf-8",
            )
        except OSError as e:
            print(f"[audio] take record not written: {e}")

    def flush(self):
        """Force everything to disk. Runs every 30 seconds on its own, but can
        be called by hand."""
        for f in self._raw_files.values():
            f.flush()
            os.fsync(f.fileno())

    def stop(self, progress=None):
        # `progress(fraction, step)`, when given, hears how far along turning
        # the raw files into .wav is — the tracks weighed by their size.
        #
        # Stopping can be asked for twice — the interface vanishes and the
        # health check stops the take at the same moment somebody presses
        # Stop. The second call must not fsync closed files or try to rebuild
        # .wav files whose .raw sources are already gone.
        if self._stopped:
            return self._result
        self._stopped = True
        self._let_go()

        duration = self._frames_written / self.samplerate

        raws = [self.out_dir / f"{self.safe_name(t['name'])}{RAW_SUFFIX}"
                for t in self.tracks]
        stages = Stages(
            [(f"Track {i + 1} of {len(raws)}",
              p.stat().st_size if p.exists() else 0)
             for i, p in enumerate(raws)],
            progress or (lambda fraction, step: None),
        )
        finalized = []
        for i, track in enumerate(self.tracks):
            raw_path = raws[i]
            wav_path = self.out_dir / f"{self.safe_name(track['name'])}.wav"
            raw_to_wav(raw_path, wav_path, self.samplerate, self.bit_depth,
                       channels=self._width[track["name"]],
                       progress=stages.part(i))
            raw_path.unlink(missing_ok=True)
            finalized.append({
                "name": track["name"],
                "file": str(wav_path),
                **({"stereo": True} if self._width[track["name"]] == 2 else {}),
            })

        # The record has done its job: every wav now carries its own header.
        # Left behind it would ride along into the saved take.
        (self.out_dir / TAKE_RECORD).unlink(missing_ok=True)

        self._result = {"duration_sec": duration, "tracks": finalized}
        return self._result

    def abandon(self):
        """
        Lets go of the card and of the files, without finishing the take.

        What closing the window does to a take still recording. The raw files
        and their record stay exactly as a crash would leave them, flushed and
        closed, and the drafts recover them next time. Finishing them here
        would rewrite every track, each read whole into memory, after the
        window had already gone — a process lingering unseen for as long as
        that takes, and killed half-way if Windows is shutting down.
        """
        if self._stopped:
            return
        self._stopped = True
        self._let_go()

    def _let_go(self):
        """The stream closed and every byte on disk — what stopping and
        abandoning have in common."""
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
                    close_stream(stream)
            except Exception as e:
                print(f"[audio] stop: {e}")

        self.flush()
        for f in self._raw_files.values():
            f.close()


def raw_to_wav(raw_path, wav_path, samplerate, bit_depth=16, channels=1,
               progress=None):
    """
    Wrap a raw PCM file into a .wav with a proper header.

    The raw file already holds the final bytes, in their final order, so this
    only adds the header — which is why a take interrupted by a crash can
    still be rescued, stereo or not. Copied a piece at a time: it used to be
    read whole, some 500 MB for an hour of one 24-bit track.
    """
    width = bytes_per_sample(bit_depth) * channels
    size = os.path.getsize(raw_path)
    # A take cut off mid-frame would otherwise produce a wav whose length does
    # not divide evenly, which some players refuse outright. A stereo file cut
    # between its two channels is the same problem, one sample further in.
    usable = size - (size % width)
    with open(raw_path, "rb") as rf, wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(bytes_per_sample(bit_depth))
        wf.setframerate(samplerate)
        left = usable
        while left > 0:
            # Whole frames only: wave counts frames from what it is given.
            want = min(left, COPY_BYTES - (COPY_BYTES % width))
            piece = rf.read(want)
            if not piece:
                break
            wf.writeframes(piece)
            left -= len(piece)
            if progress is not None:
                progress((usable - left) / usable)
    if progress is not None:
        progress(1.0)
