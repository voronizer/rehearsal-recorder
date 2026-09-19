"""
Compressing the copies that go to the cloud.

Only the copies. What is recorded stays untouched WAV on disk: it is the one
thing in this app that cannot be recreated, and it is not worth running it
through an encoder to save space on a drive that costs less than a cymbal.
The cloud copy is a different matter — it is uploaded over somebody's home
connection and mostly listened to on a phone.

Three choices, in the order they cost you something:

  wav   what was recorded, byte for byte. Biggest.
  flac  lossless. Around half the size of the wav for real music, and it
        decodes back to the identical samples — 16- and 24-bit alike.
  mp3   lossy, variable bitrate. Roughly a tenth. Plays on anything with a
        speaker, which is the point: it is what you send the drummer.

This used to shell out to afconvert or ffmpeg, which meant it worked on macOS
and silently did nothing on Windows. Now it goes through libsndfile, which
arrives as a prebuilt wheel with the soundfile package on all three systems —
no external program, nothing for anyone to install by hand.

The earlier worry about native code was about the recording path, where a
fault costs a take that cannot be played again. This runs afterwards, on a
copy, in an ordinary call — a different risk entirely, and the wrong place to
have been cautious at the cost of the feature not working at all.

Files are converted a block at a time. A twenty-minute eight-track take is
several gigabytes; reading one into memory to compress it would undo the care
taken everywhere else to keep memory flat.
"""

from pathlib import Path

FORMATS = ("wav", "flac", "mp3")
DEFAULT_FORMAT = "wav"

# Frames per block. Big enough that the per-call overhead disappears, small
# enough that memory does not grow with the length of a take.
BLOCK_FRAMES = 1 << 16

# libsndfile's scale, where 0.0 is the best quality. For MP3 that is variable
# bitrate: about 320 kbps for a stereo mix, about 128 for a mono track, which
# is the same quality per channel. 1.0 is rejected outright by libsndfile, so
# nothing here ever passes it.
MP3_QUALITY = 0.0

CLOUD_FORMATS_INFO = [
    {
        "id": "wav",
        "label": "As recorded",
        "hint": "Exactly the files on disk. Biggest, and the safest thing to "
                "hand to someone who will work on them.",
    },
    {
        "id": "flac",
        "label": "Lossless (FLAC)",
        "hint": "Around half the size for real music, and it decodes back to "
                "the identical samples. Nothing is given up but upload time.",
    },
    {
        "id": "mp3",
        "label": "Compressed (MP3)",
        "hint": "Roughly a tenth of the size, and lossy. Right for a mix the "
                "band listens to on phones, wrong for tracks headed into a DAW.",
    },
]


def _soundfile():
    """libsndfile, or None if the package was left out of the install."""
    try:
        import soundfile
    except Exception:
        return None
    return soundfile


def available():
    """What can compress, or None."""
    return "soundfile" if _soundfile() is not None else None


def missing_encoder_hint():
    """
    The same on every system now, which is the whole point of the change: it
    is one pip package rather than whatever the operating system happens to
    ship.
    """
    return (
        "The soundfile package is missing, so copies will go up as WAV. "
        "Installing it (pip install soundfile) and restarting the app enables "
        "the other two options."
    )


def normalize_format(value):
    value = (value or "").strip().lower()
    return value if value in FORMATS else DEFAULT_FORMAT


def extension(fmt):
    fmt = normalize_format(fmt)
    return {"wav": ".wav", "flac": ".flac", "mp3": ".mp3"}[fmt]


def _flac_subtype(source_subtype):
    """FLAC keeps the depth it was given. Anything unexpected goes to 24, the
    wider of the two, so nothing is thrown away."""
    return "PCM_16" if source_subtype == "PCM_16" else "PCM_24"


def encode(src, fmt, dst=None):
    """
    Converts src into fmt, next to it unless dst says otherwise, and removes
    the wav it came from — this is the cloud copy, the recording itself is
    somewhere else entirely.

    Returns {"ok", "file", "format", "note"}. It never fails the caller: if
    the library is missing, or the conversion goes wrong, the original file
    stays where it is and `note` says what happened, because a copy in the
    wrong format beats no copy at all.
    """
    src = Path(src)
    fmt = normalize_format(fmt)
    if fmt == "wav":
        return {"ok": True, "file": str(src), "format": "wav", "note": None}

    sf = _soundfile()
    if sf is None:
        return {"ok": True, "file": str(src), "format": "wav",
                "note": missing_encoder_hint()}

    dst = Path(dst) if dst else src.with_suffix(extension(fmt))
    try:
        with sf.SoundFile(str(src)) as fin:
            if fmt == "flac":
                opts = {"format": "FLAC", "subtype": _flac_subtype(fin.subtype)}
            else:
                opts = {"format": "MP3", "compression_level": MP3_QUALITY}

            with sf.SoundFile(
                str(dst), "w",
                samplerate=fin.samplerate,
                channels=fin.channels,
                **opts,
            ) as fout:
                # int32 whatever the source depth: libsndfile left-justifies,
                # so 16- and 24-bit both come through without losing a bit,
                # and one code path covers them.
                for block in fin.blocks(
                    blocksize=BLOCK_FRAMES, dtype="int32", always_2d=True
                ):
                    fout.write(block)
    except Exception as e:
        Path(dst).unlink(missing_ok=True)
        return {"ok": True, "file": str(src), "format": "wav",
                "note": f"Could not compress ({e}); the copy stayed a WAV."}

    if not dst.exists() or dst.stat().st_size == 0:
        dst.unlink(missing_ok=True)
        return {"ok": True, "file": str(src), "format": "wav",
                "note": "The encoder produced nothing; the copy stayed a WAV."}

    src.unlink(missing_ok=True)  # the cloud copy only
    return {"ok": True, "file": str(dst), "format": fmt, "note": None}
