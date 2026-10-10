"""
How far a take's notes are from the audio they belong to (spec F1).

    python tools/midi_alignment.py "<take folder>"

The aim is notes within 10 ms of their audio, at the start of a take and at the
end of an hour-long one. This measures it, on a take where the same thing was
recorded as audio and as MIDI at once: a click, or an e-kit or a keyboard whose
sound goes into the interface while its MIDI goes in by USB. For each `.mid` in
the folder it finds the WAV it belongs to, finds the onsets in that WAV, pairs
each note-on with the nearest onset, and prints how far the notes are from them,
in milliseconds, signed: plus is a note later than its audio, minus earlier.

    Drums.mid against Drums.wav (48000 Hz, 1:00:12 long)
      first minute 0:00-1:00:     matched 118 of 120 notes, median +3.1 ms, worst +4.4 ms (121 onsets in the audio)
      last minute  59:12-1:00:12: matched 119 of 120 notes, median +3.4 ms, worst +5.0 ms (120 onsets in the audio)

The median and the worst (the one furthest from 0, with its sign) are over the
first minute and over the last minute of the take, so a clock that drifts shows
as the two differing. A take shorter than two minutes is one window, all of it.
Only these stretches of the WAV are read, so an hour-long take is quick.

Which WAV: a Both track's `.mid` has its WAV's name (`Drums.mid` and
`Drums.wav`), and is measured against that. A `.mid` with no WAV of its name
(a MIDI track) is measured against the one given with `--wav NAME`; without
it, the tool says so and names the WAVs there are, to pick from. It never
guesses. It exits non-zero, with a plain message, for a folder with no `.mid`
or no `.wav`, and when no `.mid` could be measured; it exits 0 when at least one
was, and says on stderr about any that could not be.

What it assumes, so a result can be read for what it is:

- Time 0 of a `.mid` is the first sample of the WAV (F1: the notes are put on
  the audio's own clock). The `.mid` is read with the app's own reader
  (`midi.smf.read_events`), so this measures what the app wrote.
- The audio has hits that stand out: a click, a drum, a struck key. A hit is an
  onset when its peak in a millisecond is at least four times the average peak
  of the 100 ms before it (not counting the last 2 ms), at least 5% of the
  loudest hit in the stretch being read, and above -54 dBFS. Quieter hits are
  not counted, and a hit sustained or swelling into being, such as a bowed
  string, has no onset to measure.
- Hits caught less than 50 ms apart, a flam or a roll at its fastest, are one
  onset, at the first. And a hit that comes soon after a louder
  or longer-ringing one can be missed altogether, for it has to stand four times
  above what the ring leaves: a backbeat at 120 bpm is found, a fast fill or a
  hi-hat run after a crash may not be. The count of notes matched shows it, and
  the median and the worst are of the hits found.
- A WAV that opens on a loud sound, with nothing before it to compare with, has
  an onset at its first sample.
- The onset is where the hit starts to rise: the first sample that reaches a
  tenth of its peak (and one and a half times the level before it, twice when
  the hit before began within 100 ms, so the ring of that hit is not taken for
  this one), found by going back through the
  milliseconds of the rise from the one that caught the hit, up to 50 ms and not
  to the onset before it (and a few ms after that). A click is on its very
  sample. A drum is placed a share of its rise after it starts: about 0.5 ms for
  a rise of 3 ms, 1.5 ms for 10 ms and 2.5 ms for 30 ms, soft or hard, so a note
  exactly at the start of a drum hit reads that much early. Over the ring of a
  hit before it, later still: up to 3 ms for a 3 ms rise over a 100 ms ring, up
  to 7 ms for a 10 ms rise. Nothing here says when an e-kit sends its notes
  against its audio; that is what the figures are for, and a steady -1 or -2 ms
  on drums is within this slack.
- A stereo or wider WAV is read as its loudest channel at each sample, so two
  channels that are upside down against each other do not cancel out.
- The audio is high-passed first: the mean of the last 5 ms is taken off each
  sample. That is a gentle filter, 3 dB down at about 47 Hz and 10 dB down at
  20 Hz, with 60 Hz only 1.4 dB down and a lift of 1 to 2 dB between 90 and 150
  Hz, so a steady 50 or 60 Hz hum is hardly touched. What it takes out is the
  band-limited rumble of a stage floor or a passing lorry, which would
  otherwise pass for the rise of a soft hit. A rumble as loud as the softest
  hits (-40 dBFS, 60 Hz) still costs something: the worst of a take is typically
  3 ms off and up to 5 to 7, about what it was before the rise was followed back
  (without the high-pass, typically 6 and up to 15), and one twice as loud
  (-34 dBFS) can put a soft hit 10 ms or more early. Tones at 80 to 150 Hz that
  take 10 to 30 ms to rise are placed 0.4 to 1.2 ms later for it, at the median:
  a 100 Hz tone with a 30 ms rise about 4 ms after it starts, and soft ones up
  to 7 ms.
- A note is paired with the onset nearest it, if that is within 100 ms
  (`--max-ms`); a note with none is not matched. An onset goes to one note only,
  the nearest, so the second note of a chord, a note that makes no sound of its
  own (a hi-hat pedal) and a note while another's onset is nearer are left
  unmatched, which the count says; when none is matched the line says so, for a
  take whose notes are further than that from the audio, or are not of it. Only note-ons count (not a note-on at
  velocity 0, which is a release). Every channel and note number counts.
- A note paired with the wrong onset gives a wrong distance. On a click track
  that takes a note more than half a click from its own click; on drums, read
  the count: far fewer matched than were played means hits the detector missed
  or notes with no sound of their own, and the median is of the rest.

It needs numpy and soundfile, which are in the app's requirements, and runs from
a source checkout (src is put on the path, so the checkout is what is measured).
The text it prints is plain ASCII, for a Windows console's code page: a letter
outside ASCII in a name is written as its \\uXXXX escape, so names stay apart.
"""

import argparse
import sys
from pathlib import Path

import numpy as np

# The checkout's own sources first, so this measures the code beside it, and so
# it runs without the package having been installed.
_SRC = Path(__file__).resolve().parent.parent / "src"
if (_SRC / "rehearsal_recorder").is_dir():
    sys.path.insert(0, str(_SRC))

from rehearsal_recorder.midi.smf import read_events  # noqa: E402

AIM_MS = 10.0  # F1

# Windows: the first and the last minute of a take, one window under two minutes.
WINDOW_SEC = 60.0

# How far a note may be from an onset and still be paired with it.
MAX_MS = 100.0

# Onset detection (see the docstring). The audio is cut into frames of about a
# millisecond, each as its peak; a frame is a hit's if its peak is RISE_RATIO times
# the average peak of the LEVEL_SEC before it, leaving out the last GUARD_FRAMES.
FRAME_SEC = 0.001
LEVEL_SEC = 0.1
GUARD_FRAMES = 2
RISE_RATIO = 4.0
FLOOR_REL = 0.05  # of the loudest frame in the stretch
FLOOR_ABS = 0.002  # of full scale, which is 1.0: -54 dBFS
REFRACTORY_SEC = 0.05
# Then the onset itself is placed to the sample: the first at or over a tenth of
# the hit's peak (but over HIT_OVER_LEVEL times the level before it, so the ring
# of a hit before is not taken for this one). The frame that caught a hit can be
# late in a slow or soft rise, so the rise is followed back from it through the
# frames that are all over that, for LOOK_BACK_SEC at most (as far as two hits
# can be apart) and not to the onset before it and SETTLE_SEC. The hit's peak is
# looked for LOOK_AHEAD_SEC on.
HIT_FRACTION = 0.1
HIT_OVER_LEVEL = 1.5
HIT_OVER_LEVEL_NEAR = 2.0  # when the hit before began within LEVEL_SEC of this one
LOOK_BACK_SEC = 0.05
LOOK_AHEAD_SEC = 0.02
SETTLE_SEC = 0.005

# Samples of a WAV read at a time (frames times channels), so a wide file is not held whole.
BLOCK_FRAMES = 1 << 20

# The audio is high-passed before anything else: at each sample, the mean of the
# last HIGH_PASS_SEC is taken off (gently: 3 dB down at about 47 Hz). A low
# rumble under a soft hit is as loud as the hit and varies as slowly as its
# rise, and the rise was followed back into it.
HIGH_PASS_SEC = 0.005


def say(text, stream=None):
    """Prints `text` as plain ASCII: a letter outside ASCII, in a name, is shown as
    its \\uXXXX escape, which keeps two names that differ apart."""
    print(str(text).encode("ascii", "backslashreplace").decode("ascii"), file=stream or sys.stdout)


def complain(text):
    say(text, sys.stderr)


def clock(seconds):
    """Seconds as m:ss, or h:mm:ss from an hour."""
    whole = int(round(seconds))
    hours, rest = divmod(whole, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def windows(duration):
    """The stretches of a take of `duration` seconds to measure, [(label, start,
    end)]: its first minute and its last, or all of it when under two minutes."""
    if duration < 2 * WINDOW_SEC:
        return [("whole take", 0.0, duration)]
    return [("first minute", 0.0, WINDOW_SEC), ("last minute", duration - WINDOW_SEC, duration)]


def find_onsets(rectified, rate):
    """
    The onsets in `rectified`, the absolute value of mono audio at `rate`, as
    seconds from its first sample, in order. Described in the module docstring.
    """
    hop = max(1, round(rate * FRAME_SEC))
    count = len(rectified) // hop
    if count < 1:
        return np.zeros(0)
    peaks = rectified[:count * hop].reshape(count, hop).max(axis=1).astype(np.float64)
    floor = max(FLOOR_ABS, FLOOR_REL * peaks.max())

    # The level before each frame: the average peak of the frames LEVEL_SEC back
    # from GUARD_FRAMES before it, by a running sum.
    level_frames = max(1, round(LEVEL_SEC * rate / hop))
    sums = np.concatenate(([0.0], np.cumsum(peaks)))
    end = np.maximum(np.arange(count) - GUARD_FRAMES, 0)
    begin = np.maximum(end - level_frames, 0)
    level = (sums[end] - sums[begin]) / np.maximum(end - begin, 1)

    refractory = max(1, round(REFRACTORY_SEC * rate / hop))
    back_frames = max(1, round(LOOK_BACK_SEC * rate / hop))
    settle = round(SETTLE_SEC * rate)
    ahead = round(LOOK_AHEAD_SEC * rate)
    onsets = []
    last = None
    for frame in np.flatnonzero((peaks >= floor) & (peaks > RISE_RATIO * level)):
        if last is not None and frame - last < refractory:
            continue
        last = frame
        # This frame is in the hit, perhaps late in its rise. Where the hit
        # begins is the first sample of it that is a tenth of its peak (and over
        # HIT_OVER_LEVEL times the level before it, so the tail of a hit before
        # is not taken for this one; more times when that hit began within the
        # level's 100 ms, for the level then holds the quiet from before it and
        # its tail is over the usual line). The peak is at least this frame's,
        # which is over four times the level, so there is always such a sample.
        at = int(frame) * hop
        peak = rectified[at:at + ahead].max()
        near = bool(onsets) and at - onsets[-1] < level_frames * hop
        times = HIT_OVER_LEVEL_NEAR if near else HIT_OVER_LEVEL
        over = max(HIT_FRACTION * peak, times * level[frame])
        # Back through the frames of the rise, as many as are all over that,
        # and not further than LOOK_BACK_SEC, nor to the onset before this one
        # and a moment after it.
        lowest = max(0, int(frame) - back_frames)
        if onsets:
            lowest = max(lowest, (onsets[-1] + settle) // hop + 1)
        k = int(frame)
        if peaks[k] >= over:
            while k > lowest and peaks[k - 1] >= over:
                k -= 1
        first = k * hop
        onsets.append(first + int(np.argmax(rectified[first:at + ahead] >= over)))
    return np.asarray(onsets, dtype=np.float64) / rate


def match(note_times, onset_times, max_sec):
    """
    The notes' distances from the onsets, in seconds, note minus onset: each note
    is paired with the onset nearest it, if within `max_sec`, and an onset goes
    to one note only, the nearest to it. Both are sorted arrays of seconds.
    """
    if not len(note_times) or not len(onset_times):
        return np.zeros(0)
    last = len(onset_times) - 1
    after = np.minimum(np.searchsorted(onset_times, note_times), last)
    before = np.maximum(after - 1, 0)
    use_after = np.abs(onset_times[after] - note_times) < np.abs(note_times - onset_times[before])
    nearest = np.where(use_after, after, before)
    distance = note_times - onset_times[nearest]
    taken, kept = set(), []
    for i in np.argsort(np.abs(distance), kind="stable"):
        if abs(distance[i]) > max_sec:
            break
        if nearest[i] not in taken:
            taken.add(nearest[i])
            kept.append(distance[i])
    return np.asarray(kept)


def high_pass(block, tail, length):
    """
    `block` (frames by channels) less, at each frame, the mean of the `length`
    frames up to and including it. `tail` is the `length` frames before the block
    (zeros before the start of the stretch). Answers (the filtered block, the
    tail for the block after it). Looks back only, so the start of a hit is not
    smeared to before it.
    """
    joined = np.concatenate((tail, block))
    sums = np.concatenate((np.zeros((1, joined.shape[1])), np.cumsum(joined, axis=0, dtype=np.float64)))
    means = (sums[len(tail) + 1:] - sums[len(tail) + 1 - length:len(joined) + 1 - length]) / length
    return block - means, joined[-length:]


def loudness(snd, first, last):
    """The WAV's frames `first` up to `last` as one channel: the loudest of the
    channels, high-passed, as an absolute value, at each sample."""
    snd.seek(first)
    parts = []
    left = last - first
    step = max(1, BLOCK_FRAMES // snd.channels)
    length = max(2, round(HIGH_PASS_SEC * snd.samplerate))
    tail = np.zeros((length, snd.channels), dtype=np.float32)
    while left > 0:
        block = snd.read(min(left, step), dtype="float32", always_2d=True)
        if not len(block):
            break
        block, tail = high_pass(block, tail, length)
        parts.append(np.abs(block).max(axis=1).astype(np.float32))
        left -= len(block)
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)


def measure(mid_path, wav_path, soundfile, max_sec=MAX_MS / 1000):
    """
    How far the notes of `mid_path` are from the onsets of `wav_path`. Answers
    (rate, duration, [one dict for each window]); a window has "label", "start",
    "end", "notes" (note-ons in it), "onsets" (heard in it) and "deltas" (the
    matched notes' distances, seconds). Raises what the files raise.
    """
    _, events = read_events(mid_path)
    notes = np.array(sorted(t for t, data in events if data[0] & 0xF0 == 0x90 and data[2] > 0), dtype=np.float64)
    results = []
    with soundfile.SoundFile(str(wav_path)) as snd:
        rate = snd.samplerate
        if not snd.frames:
            raise ValueError("it holds no audio")
        duration = snd.frames / rate
        margin = max_sec + LEVEL_SEC + 0.1  # for the audio before the first note, and after the last
        for label, start, end in windows(duration):
            first = int(max(0.0, start - margin) * rate)
            last = min(snd.frames, int((end + margin) * rate))
            onsets = find_onsets(loudness(snd, first, last), rate) + first / rate
            inside = notes[(notes >= start) & (notes < end)]
            results.append({"label": label, "start": start, "end": end, "notes": len(inside),
                            "onsets": int(np.count_nonzero((onsets >= start) & (onsets < end))),
                            "deltas": match(inside, onsets, max_sec)})
    return rate, duration, results


def describe(result, max_ms):
    """One window's line, after its label and span."""
    if not result["notes"]:
        return "no notes"
    deltas = result["deltas"]
    text = f"matched {len(deltas)} of {result['notes']} notes"
    heard = f"{result['onsets']} onsets in the audio"
    if not len(deltas):
        return text + f": none within {max_ms:g} ms of an onset ({heard}). Further apart than that, or not of the same take?"
    median = float(np.median(deltas)) * 1000
    worst = float(deltas[np.argmax(np.abs(deltas))]) * 1000
    return text + f", median {median:+.1f} ms, worst {worst:+.1f} ms ({heard})"


def find_wav(folder, wavs, name):
    """The WAV that `--wav name` means: a file in the folder (with or without
    .wav, in any case), or else a path; None if there is none."""
    wanted = {name.casefold(), (name + ".wav").casefold()}
    for wav in wavs:
        if wav.name.casefold() in wanted:
            return wav
    path = Path(name)
    return path if path.is_file() else None


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="midi_alignment.py",
        description="Says how far the notes of a take's .mid files are from the onsets in the "
                    "audio they belong to: median and worst, in milliseconds, over the first and "
                    "the last minute of the take. Plus is a note later than its audio.",
        epilog="The aim is within 10 ms (spec F1).")
    parser.add_argument("folder", help="the take's folder, with its .mid and .wav files")
    parser.add_argument("--wav", metavar="NAME",
                        help="the WAV for a .mid with none of its own name (a MIDI track's)")
    parser.add_argument("--max-ms", type=float, default=MAX_MS, metavar="MS",
                        help=f"how far from an onset a note may be and still be matched to it "
                             f"(default {MAX_MS:g})")
    args = parser.parse_args(argv)
    if not args.max_ms > 0:
        parser.error("--max-ms has to be more than 0")

    folder = Path(args.folder)
    if not folder.is_dir():
        complain(f"{args.folder} is not a folder. Give the folder of a take.")
        return 1
    files = sorted((p for p in folder.iterdir() if p.is_file()), key=lambda p: p.name.casefold())
    mids = [p for p in files if p.suffix.lower() == ".mid"]
    wavs = [p for p in files if p.suffix.lower() == ".wav"]
    if not mids:
        complain(f"There is no .mid file in {args.folder}, so there are no notes to measure.")
        return 1
    chosen = None
    if args.wav is not None:
        chosen = find_wav(folder, wavs, args.wav)
        if chosen is None:
            complain(f"--wav {args.wav}: there is no such file in {args.folder}.")
            return 1
    if not wavs and chosen is None:
        complain(f"There is no .wav file in {args.folder}, so there is no audio to measure against.")
        return 1

    try:
        import soundfile
    except (ImportError, OSError):  # not installed, or its libsndfile is not there
        complain("This needs the soundfile package, which is in the app's requirements: "
                 "pip install -r requirements.txt")
        return 1

    own = {wav.stem.casefold(): wav for wav in wavs}
    measured = 0
    for mid in mids:
        wav = own.get(mid.stem.casefold()) or chosen
        if wav is None:
            complain(f"{mid.name} has no .wav of its own name. Pick the audio it belongs to with "
                     f"--wav NAME (here: {', '.join(w.name for w in wavs)}).")
            continue
        try:
            rate, duration, results = measure(mid, wav, soundfile, args.max_ms / 1000)
        except Exception as e:
            problem = str(e) or type(e).__name__
            complain(f"{mid.name} against {wav.name} could not be measured: {problem}")
            continue
        measured += 1
        say(f"{mid.name} against {wav.name} ({rate} Hz, {clock(duration)} long)")
        for result in results:
            span = f"{clock(result['start'])}-{clock(result['end'])}"
            say(f"  {result['label']:<12} {span + ':':<15} {describe(result, args.max_ms)}")
    if measured:
        say(f"A plus is a note later than its audio, a minus earlier. The aim is within {AIM_MS:g} ms.")
    return 0 if measured else 1


if __name__ == "__main__":
    raise SystemExit(main())
