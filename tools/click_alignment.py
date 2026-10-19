"""
How far a click take's recorded clicks are from their places (metronome spec,
Part 3).

    python tools/click_alignment.py "<take folder>"

The aim is a beat played on the click within 5 ms of its place in the files
when the click comes from the recording card, and within 10 ms when it comes
from another device, at the start of a take and after an hour. This measures
it with a cable: the click's output plugged into one of the interface's inputs,
and a take recorded to the click with a track on that input. In a click take's
files the first click of the count-in is the first sample, and click k falls
`round(k * 60 * rate / tempo)` frames after it (audio/click.py, `click_frame`),
so each click that came back through the cable should start there. For each
WAV in the folder it finds the onsets, pairs each click of that grid with the
onset nearest it, and prints how far they are, in milliseconds, signed: plus is
a click recorded later than its place, minus earlier.

    Click.wav against the click at 120 a minute, as the WAV says (48000 Hz, 1:00:12 long)
      first minute 0:00-1:00:     matched 120 of 120 clicks, median +1.2 ms, worst +1.9 ms (120 onsets in the audio)
      last minute  59:12-1:00:12: matched 120 of 120 clicks, median +1.4 ms, worst +2.2 ms (121 onsets in the audio)

The tempo is the one the WAV carries in its acid chunk, which the app writes
into a click take's WAVs while Settings > Metronome has "Write the tempo into
WAV files" on. The chunk says the quarter tempo and the signature, and the grid
is in clicks: the quarter tempo in x/4, twice it in 6/8, read as the app reads
a draft's (api.py, `_meter_of_wavs`). For a take whose WAVs carry none,
`--tempo N` gives it as the metronome showed it (198 for a 6/8 at 198).

Every WAV in the folder is measured, each on its own lines, so the track the
cable fed is the one whose clicks all match, and a track with no click shows
next to nothing matched. `--wav NAME` measures that one alone.

What it takes from tools/midi_alignment.py, which it imports, so that the two
measure alike: the onset rule (a click is found on its very sample; that tool's
docstring says what a drum or a rumble does to it), the windows (the first
minute and the last, one window for a take under two minutes, only those read),
the signed median and worst (the one furthest from 0), the exit codes and the
plain ASCII output. A click is paired with the onset nearest it if that is
within 100 ms (`--max-ms`) and within half the gap between two clicks, so at
600 a minute a click is never paired with the next one's onset. An onset goes
to one click only. A click with nothing recorded near it, one the row's switch
silenced say, is not matched, which the count shows.

It exits non-zero, with a plain message, for a folder with no `.wav`, and when
no WAV could be measured (a WAV with no tempo, and none given, cannot be); it
exits 0 when at least one was, and says on stderr about any that could not be.

It needs numpy and soundfile, which are in the app's requirements, and runs from
a source checkout, as midi_alignment.py does.
"""

import argparse
import sys
from pathlib import Path

import numpy as np

# The checkout's own sources first, so this measures the code beside it, and
# its sibling, whose onset rule this uses.
_HERE = Path(__file__).resolve().parent
_SRC = _HERE.parent / "src"
if (_SRC / "rehearsal_recorder").is_dir():
    sys.path.insert(0, str(_SRC))
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from midi_alignment import (  # noqa: E402
    LEVEL_SEC, MAX_MS, clock, complain, find_onsets, find_wav, loudness, match, say, windows)
from rehearsal_recorder.audio.click import SIGNATURES, click_frame, per_quarter  # noqa: E402
from rehearsal_recorder.audio.wavfile import read_acid  # noqa: E402

AIM_CARD_MS = 5.0  # the click on the recording card (Part 3)
AIM_OTHER_MS = 10.0  # the click on another device


def tempo_of(wav_path):
    """The clicks a minute a WAV's acid chunk says, or None for a WAV with no
    chunk, or with a signature the app does not have."""
    acid = read_acid(wav_path)
    if acid is None:
        return None
    signature = f"{acid.num}/{acid.den}"
    if signature not in SIGNATURES or not 0 < acid.quarter_tempo < float("inf"):
        return None
    return acid.quarter_tempo * per_quarter(signature)


def measure(wav_path, tempo, soundfile, max_sec=MAX_MS / 1000):
    """
    How far the clicks recorded in `wav_path` are from the grid of `tempo`
    (clicks a minute, the first at the file's first sample). Answers (rate,
    duration, [one dict for each window]); a window has "label", "start", "end",
    "clicks" (of the grid, in it), "onsets" (heard in it) and "deltas" (the
    matched clicks' distances, onset minus grid, seconds). Raises what the file
    raises.
    """
    results = []
    with soundfile.SoundFile(str(wav_path)) as snd:
        rate = snd.samplerate
        if not snd.frames:
            raise ValueError("it holds no audio")
        duration = snd.frames / rate
        margin = max_sec + LEVEL_SEC + 0.1  # for the audio before the first click, and after the last
        for label, start, end in windows(duration):
            first = int(max(0.0, start - margin) * rate)
            last = min(snd.frames, int((end + margin) * rate))
            onsets = find_onsets(loudness(snd, first, last), rate) + first / rate
            # The grid's clicks in the window, each frame from its number as
            # the app works it out, never summed.
            k = max(0, int(start * tempo / 60) - 1)
            grid = []
            while (at := click_frame(k, tempo, rate) / rate) < end:
                if at >= start:
                    grid.append(at)
                k += 1
            grid = np.asarray(grid, dtype=np.float64)
            results.append({"label": label, "start": start, "end": end, "clicks": len(grid),
                            "onsets": int(np.count_nonzero((onsets >= start) & (onsets < end))),
                            # match() answers grid minus onset; plus is a click recorded late.
                            "deltas": -match(grid, onsets, max_sec)})
    return rate, duration, results


def describe(result, max_ms):
    """One window's line, after its label and span."""
    if not result["clicks"]:
        return "no clicks"
    deltas = result["deltas"]
    text = f"matched {len(deltas)} of {result['clicks']} clicks"
    heard = f"{result['onsets']} onsets in the audio"
    if not len(deltas):
        return text + f": none within {max_ms:g} ms of an onset ({heard})"
    median = signed_ms(float(np.median(deltas)))
    worst = signed_ms(float(deltas[np.argmax(np.abs(deltas))]))
    return text + f", median {median} ms, worst {worst} ms ({heard})"


def signed_ms(seconds):
    """Seconds as milliseconds to a tenth, with a sign. A click on time, or
    less than 0.05 ms early, rounds to -0.0; adding 0.0 makes it +0.0."""
    return f"{round(seconds * 1000, 1) + 0.0:+.1f}"


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="click_alignment.py",
        description="Says how far the clicks recorded in a click take's WAVs, through a cable "
                    "from the click's output into an input, are from their places on the take's "
                    "grid: median and worst, in milliseconds, over the first and the last minute "
                    "of the take. Plus is a click recorded later than its place.",
        epilog=f"The aim is within {AIM_CARD_MS:g} ms with the click on the recording card, "
               f"{AIM_OTHER_MS:g} ms on another device (metronome spec, Part 3).")
    parser.add_argument("folder", help="the take's folder, with its .wav files")
    parser.add_argument("--wav", metavar="NAME", help="measure this WAV alone (the track the cable fed)")
    parser.add_argument("--tempo", type=float, metavar="N",
                        help="the take's tempo as the metronome showed it, for WAVs that carry none "
                             "(198 for a 6/8 at 198)")
    parser.add_argument("--max-ms", type=float, default=MAX_MS, metavar="MS",
                        help=f"how far from an onset a click may be and still be matched to it "
                             f"(default {MAX_MS:g}, and never more than half the gap between clicks)")
    args = parser.parse_args(argv)
    if not args.max_ms > 0:
        parser.error("--max-ms has to be more than 0")
    if args.tempo is not None and not 0 < args.tempo < float("inf"):
        parser.error("--tempo has to be a number more than 0")

    folder = Path(args.folder)
    if not folder.is_dir():
        complain(f"{args.folder} is not a folder. Give the folder of a take.")
        return 1
    files = sorted((p for p in folder.iterdir() if p.is_file()), key=lambda p: p.name.casefold())
    wavs = [p for p in files if p.suffix.lower() == ".wav"]
    if args.wav is not None:
        chosen = find_wav(folder, wavs, args.wav)
        if chosen is None:
            complain(f"--wav {args.wav}: there is no such file in {args.folder}.")
            return 1
        wavs = [chosen]
    if not wavs:
        complain(f"There is no .wav file in {args.folder}, so there are no clicks to measure.")
        return 1

    try:
        import soundfile
    except (ImportError, OSError):  # not installed, or its libsndfile is not there
        complain("This needs the soundfile package, which is in the app's requirements: "
                 "pip install -r requirements.txt")
        return 1

    measured = 0
    for wav in wavs:
        try:
            tempo = args.tempo if args.tempo is not None else tempo_of(wav)
        except OSError as e:
            complain(f"{wav.name} could not be read: {e}")
            continue
        if tempo is None:
            complain(f"{wav.name} carries no tempo. Give the take's tempo, as the metronome "
                     f"showed it, with --tempo N.")
            continue
        source = "as given" if args.tempo is not None else "as the WAV says"
        # Never as far as half a click: past that, the next click's onset is nearer.
        max_ms = min(args.max_ms, 0.5 * 60_000 / tempo)
        try:
            rate, duration, results = measure(wav, tempo, soundfile, max_ms / 1000)
        except Exception as e:
            problem = str(e) or type(e).__name__
            complain(f"{wav.name} could not be measured: {problem}")
            continue
        measured += 1
        say(f"{wav.name} against the click at {tempo:g} a minute, {source} ({rate} Hz, {clock(duration)} long)")
        for result in results:
            span = f"{clock(result['start'])}-{clock(result['end'])}"
            say(f"  {result['label']:<12} {span + ':':<15} {describe(result, max_ms)}")
    if measured:
        say(f"A plus is a click recorded later than its place, a minus earlier. The aim is within "
            f"{AIM_CARD_MS:g} ms with the click on the recording card, {AIM_OTHER_MS:g} ms on another device.")
    return 0 if measured else 1


if __name__ == "__main__":
    raise SystemExit(main())
