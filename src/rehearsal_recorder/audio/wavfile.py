"""
The app's own WAV writer, so that a click take's files can carry its tempo.

The only place a WAV keeps a tempo that a DAW reads is an `acid` chunk, and
neither `wave` nor python-soundfile writes a chunk of the caller's choosing
(metronome spec, Part 9). Without one, a file from here is byte for byte what
`wave` writes: RIFF, `fmt `, `data`. With one, the `acid` chunk goes between
`fmt ` and `data`, so the data still ends the file, which is where the player
finds it (audio/player.py, `_open_track`).

The chunk says the quarter tempo, the signature and how many quarters the file
holds. That count is only known at the end, so it is written then, with the
sizes, as `wave` writes its sizes.
"""

import struct
from dataclasses import dataclass

WAVE_FORMAT_PCM = 1

# The acid chunk as a DAW reads it, header and all: its id and size, flags
# (0x04: stretch to the project's tempo), the root note (60, middle C, meaning
# nothing here), two fields nobody has documented, then the beats in the file,
# the signature's denominator and numerator, and the tempo.
_ACID = struct.Struct("<4sIIHHfIHHf")
ACID_SIZE = _ACID.size - 8  # 24: the chunk less its id and size
ACID_FLAGS = 0x04
ACID_ROOT = 60


@dataclass(frozen=True)
class Acid:
    """A click take's tempo, as its files carry it: the quarter tempo (99.0
    for 6/8 at 198) and the signature."""

    quarter_tempo: float
    num: int
    den: int


class WavWriter:
    """
    A 16- or 24-bit PCM WAV, written a block of frames at a time and closed
    with its sizes (and the acid chunk's beats) filled in. A context manager,
    as `wave`'s writer is.
    """

    def __init__(self, path, samplerate, channels, sampwidth, acid=None):
        # A whole number: a stream's rate can come as 48000.0, and the header
        # holds only whole ones.
        self._samplerate = int(round(samplerate))
        self._channels = channels
        self._sampwidth = sampwidth
        self._acid = acid
        self._written = 0
        self._file = open(path, "wb")
        try:
            self._file.write(self._header())
        except BaseException:
            self._file.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def write(self, frames):
        """Whole frames, as bytes in the file's own layout."""
        self._file.write(frames)
        self._written += len(frames)

    def close(self):
        if self._file is None:
            return
        try:
            self._file.seek(0)
            self._file.write(self._header())
        finally:
            self._file.close()
            self._file = None

    def _header(self):
        """Everything before the audio, for the audio written so far."""
        block = self._channels * self._sampwidth
        fmt = struct.pack(
            "<4sIHHIIHH", b"fmt ", 16, WAVE_FORMAT_PCM, self._channels,
            self._samplerate, self._samplerate * block, block, self._sampwidth * 8,
        )
        acid = b""
        if self._acid is not None:
            # The file's length in quarters: whole for a take stopped on the
            # click, or cropped on its grid, which end on a quarter.
            frames = self._written // block
            beats = round(frames * self._acid.quarter_tempo / (60 * self._samplerate))
            acid = _ACID.pack(b"acid", ACID_SIZE, ACID_FLAGS, ACID_ROOT, 0x8000, 0.0,
                              beats, self._acid.den, self._acid.num, self._acid.quarter_tempo)
        data = struct.pack("<4sI", b"data", self._written)
        riff = struct.pack("<4sI4s", b"RIFF", 4 + len(fmt) + len(acid) + len(data) + self._written, b"WAVE")
        return riff + fmt + acid + data


def read_acid(path):
    """
    The tempo in a WAV's acid chunk, as an Acid; None for a file with none, one
    that is no RIFF WAVE, or one whose chunk is cut short.
    """
    with open(path, "rb") as f:
        head = f.read(12)
        if len(head) < 12 or head[:4] != b"RIFF" or head[8:] != b"WAVE":
            return None
        while True:
            chunk = f.read(8)
            if len(chunk) < 8:
                return None
            name, size = struct.unpack("<4sI", chunk)
            if name == b"acid":
                body = f.read(ACID_SIZE)
                if size < ACID_SIZE or len(body) < ACID_SIZE:
                    return None
                *_, den, num, tempo = _ACID.unpack(chunk + body)
                return Acid(tempo, num, den)
            # A chunk of an odd size is followed by a byte of padding.
            f.seek(size + (size & 1), 1)
