"""
A song's backing track as a file (backing-track spec, Parts 1 and 2): the
band's file checked, copied into the library and made ready to play.

What the band adds is whatever their player exported: WAV, AIFF, FLAC, MP3 or
OGG, at any rate, mono or stereo. The app keeps it byte for byte in the Backing
tracks folder beside the library's database, so moving or deleting the
original breaks nothing. Beside the copy it keeps the file ready to play: a
32-bit float WAV at the rate the app records at, decoded by libsndfile and
resampled by soxr (VHQ, the resampler librosa uses). The ready file is a cache,
named with its rate, and made again when the rate changes or it is missing.

The ready file is read the way the player reads a take (audio/player.py,
`_open_track`): through a memory map, a block at a time, so a ten-minute file
costs what a short one does. It is made a block at a time too. The app writes
it itself (audio/wavfile.py), and reads its header itself, so playing it needs
no libsndfile; only adding a file does.
"""

import os
import shutil
import struct
import wave
from pathlib import Path

import numpy as np

from rehearsal_recorder.audio.format import unpack24
from rehearsal_recorder.audio.wavfile import WAVE_FORMAT_IEEE_FLOAT, WavWriter
from rehearsal_recorder.platform_support import unique_path

# The folder in the recordings folder, beside the library's database.
FOLDER = "Backing tracks"
# What the file picker offers: what the bundled libsndfile 1.2.2 reads. M4A
# and AAC, which iTunes and Apple Music give, are not among them.
FORMATS = (".wav", ".aif", ".aiff", ".flac", ".mp3", ".ogg")
UNREADABLE = "This file can't be read. Use WAV, AIFF, FLAC, MP3 or OGG; most players can export one."
# Frames decoded, resampled or written at a time: about 0.5 MB of stereo float.
BLOCK_FRAMES = 1 << 16
QUALITY = "VHQ"
# Buckets of a picture worked out at a time, as audio/waveform.py does.
PEAK_BUCKETS = 64


class BackingError(Exception):
    """A file the app will not take. Its text is what the band is told."""


def _too_wide(channels):
    return f"This file has {channels} channels. Use a mono or stereo file."


def _soundfile():
    """libsndfile, or None if the package was left out of the install."""
    try:
        import soundfile
    except Exception:
        return None
    return soundfile


def probe(path):
    """
    (seconds, channels) of a file the band picked. BackingError for one the app
    cannot read, and for one with more than two channels.
    """
    sf = _soundfile()
    if sf is None:
        with _open_wave(path) as w:
            rate, channels, frames = w.getframerate(), w.getnchannels(), w.getnframes()
    else:
        try:
            info = sf.info(str(path))
        except Exception:
            raise BackingError(UNREADABLE) from None
        rate, channels, frames = info.samplerate, info.channels, info.frames
    if rate <= 0 or frames <= 0:
        raise BackingError(UNREADABLE)
    if channels > 2:
        raise BackingError(_too_wide(channels))
    return frames / rate, channels


def import_copy(src, folder):
    """The app's own copy of `src`, byte for byte, in `folder`; a name already
    used there gets " (2)"."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    dest = unique_path(folder / Path(src).name)
    try:
        shutil.copyfile(src, dest)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    return dest


def ready_path(copy, rate):
    """Where the copy's ready file at `rate` goes: "Pałyn backing.wav (ready
    48 kHz).wav" beside it. The copy's whole name is kept, so a WAV and an MP3
    of the same name never share one."""
    copy = Path(copy)
    return copy.with_name(f"{copy.name} (ready {rate / 1000:g} kHz).wav")


def make_ready(copy, rate):
    """
    The copy's ready file at `rate`, made unless one is there already that is
    newer than the copy. A file that turns out unreadable on the way raises
    BackingError; a disk that refuses the write raises what it raises. Either
    way nothing half-made is left: it is written beside the ready file under
    another name and renamed when whole.
    """
    copy = Path(copy)
    ready = ready_path(copy, rate)
    if ready.exists() and ready.stat().st_mtime >= copy.stat().st_mtime:
        return ready
    part = ready.with_name(ready.name + ".part")
    with _Decoder(copy) as decoder:
        try:
            with WavWriter(part, rate, decoder.channels, 4) as out:
                if decoder.rate == rate:
                    for block in decoder.blocks():
                        out.write(_float_bytes(block))
                else:
                    import soxr

                    stream = soxr.ResampleStream(decoder.rate, rate, decoder.channels,
                                                 dtype="float32", quality=QUALITY)
                    for block in decoder.blocks():
                        out.write(_float_bytes(stream.resample_chunk(block)))
                    end = np.zeros((0, decoder.channels), np.float32)
                    out.write(_float_bytes(stream.resample_chunk(end, last=True)))
            os.replace(part, ready)
        except RuntimeError:
            # libsndfile gave up part way through: a damaged MP3, a cut-off FLAC.
            part.unlink(missing_ok=True)
            raise BackingError(UNREADABLE) from None
        except BaseException:
            part.unlink(missing_ok=True)
            raise
    return ready


def open_ready(path):
    """
    (memmap, frames, rate, 4, channels) for a ready file: the tuple
    `player._open_track` gives for a take's WAV, the memmap float32 shaped
    (frames, channels), 1.0 being full scale. Nothing is decoded here.
    """
    path = Path(path)
    kind, channels, rate, bits, offset, size = _layout(path)
    if kind != WAVE_FORMAT_IEEE_FLOAT or bits != 32 or channels not in (1, 2):
        raise ValueError(f"{path.name}: not a ready file (format {kind}, {bits} bits, {channels} channels)")
    frames = min(size, path.stat().st_size - offset) // (4 * channels)
    if frames == 0:
        return np.zeros((0, channels), np.float32), 0, rate, 4, channels
    data = np.memmap(path, dtype="<f4", mode="r", offset=offset, shape=(frames, channels))
    return data, frames, rate, 4, channels


def peaks(path, end_sec, buckets):
    """
    The ready file's picture from its start to `end_sec`: a list of `buckets`
    peaks in 0..1 for each channel, as `take_media` gives a take's tracks.
    Past the file's end the peaks are 0.
    """
    data, frames, rate, _, channels = open_ready(path)
    out = np.zeros((channels, max(0, buckets)), np.float32)
    wanted = max(0, int(round(end_sec * rate)))
    if wanted == 0 or buckets <= 0:
        return out.tolist()
    starts = (np.arange(buckets) * wanted) // buckets
    have = min(frames, wanted)
    inside = np.flatnonzero(starts < have)
    for k in range(0, len(inside), PEAK_BUCKETS):
        ids = inside[k:k + PEAK_BUCKETS]
        lo, last = starts[ids[0]], ids[-1]
        hi = starts[last + 1] if last + 1 < buckets else wanted
        hi = min(have, max(hi, starts[last] + 1))
        piece = np.abs(np.asarray(data[lo:hi]))
        out[:, ids] = np.maximum.reduceat(piece, starts[ids] - lo, axis=0).T
    return np.minimum(out, 1.0).tolist()


def take_frames(opened, from_frame, length):
    """`length` frames of an opened ready file from its frame `from_frame`, as
    float32 (length, channels); silence where the file does not reach, before
    its start (a negative `from_frame`) or after its end."""
    data, frames, _, _, channels = opened
    out = np.zeros((length, channels), np.float32)
    first, last = max(from_frame, 0), min(from_frame + length, frames)
    if first < last:
        out[first - from_frame:last - from_frame] = data[first:last]
    return out


def write_take_track(opened, from_frame, length, path, samplerate, sampwidth):
    """A take's Backing track: `length` frames of the file from `from_frame`,
    as `take_frames` gives them, written as a 16- or 24-bit WAV (`sampwidth`
    2 or 3), the take's own depth, so everything that opens a take opens it."""
    with WavWriter(path, samplerate, opened[4], sampwidth) as out:
        for start in range(0, length, BLOCK_FRAMES):
            block = take_frames(opened, from_frame + start, min(BLOCK_FRAMES, length - start))
            out.write(_pcm_bytes(block, sampwidth))


class _Decoder:
    """
    A file read as float32 (frames, channels) blocks, 1.0 being full scale:
    through libsndfile, or without it, a 16- or 24-bit WAV through `wave`.
    BackingError on opening one the app cannot read or with more than two
    channels. A context manager, which closes the file.
    """

    def __init__(self, path):
        sf = _soundfile()
        if sf is not None:
            try:
                self._file = sf.SoundFile(str(path))
            except Exception:
                raise BackingError(UNREADABLE) from None
            self.rate, self.channels, self._wave = self._file.samplerate, self._file.channels, False
        else:
            self._file = _open_wave(path)
            self.rate, self.channels, self._wave = self._file.getframerate(), self._file.getnchannels(), True
        if self.channels > 2:
            self._file.close()
            raise BackingError(_too_wide(self.channels))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self._file.close()

    def blocks(self):
        while True:
            if not self._wave:
                block = self._file.read(BLOCK_FRAMES, dtype="float32", always_2d=True)
                if not len(block):
                    return
                yield block
                continue
            raw = self._file.readframes(BLOCK_FRAMES)
            if not raw:
                return
            if self._file.getsampwidth() == 2:
                ints = np.frombuffer(raw, dtype="<i2").astype(np.float32) * np.float32(1 / 32768)
            else:
                whole = np.zeros(len(raw) // 3, dtype=np.int32)
                unpack24(np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3), whole)
                ints = whole.astype(np.float32) * np.float32(1 / 8388608)
            yield ints.reshape(-1, self.channels)


def _open_wave(path):
    """A 16- or 24-bit WAV opened with `wave`, for when libsndfile is missing."""
    try:
        w = wave.open(str(path), "rb")
    except (wave.Error, EOFError, OSError):
        raise BackingError(UNREADABLE) from None
    if w.getsampwidth() not in (2, 3):
        w.close()
        raise BackingError(UNREADABLE)
    return w


def _layout(path):
    """(format, channels, rate, bits, offset of the audio, its size in bytes)
    from a WAV's chunks."""
    with open(path, "rb") as f:
        head = f.read(12)
        if len(head) < 12 or head[:4] != b"RIFF" or head[8:] != b"WAVE":
            raise ValueError(f"{path.name}: not a WAV")
        fmt = None
        while True:
            chunk = f.read(8)
            if len(chunk) < 8:
                raise ValueError(f"{path.name}: no audio in it")
            name, size = struct.unpack("<4sI", chunk)
            if name == b"data":
                if fmt is None:
                    raise ValueError(f"{path.name}: no format before the audio")
                kind, channels, rate, _, _, bits = fmt
                return kind, channels, rate, bits, f.tell(), size
            body = f.read(size + (size & 1))
            if name == b"fmt ":
                if size < 16:
                    raise ValueError(f"{path.name}: its format is cut short")
                fmt = struct.unpack("<HHIIHH", body[:16])


def _float_bytes(block):
    return np.ascontiguousarray(block, dtype="<f4").tobytes()


def _pcm_bytes(block, sampwidth):
    """Float frames as 16- or 24-bit PCM bytes, clipped to full scale."""
    if sampwidth == 2:
        return np.clip(np.rint(block.astype(np.float64) * 32767.0), -32768, 32767).astype("<i2").tobytes()
    whole = np.clip(np.rint(block.astype(np.float64) * 8388607.0), -8388608, 8388607).astype("<i4")
    return whole.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
