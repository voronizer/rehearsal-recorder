"""
Every Python suite, one command:

    python tests/run_all.py

Seventeen of them, because they answer different questions and need different
things to be true:

    test_control_api.py shared control API and JSON bridge without MIDI.

    test_controller_browse.py generation-bound song and take selection.

    test_controller_diagnostics.py opt-in local rotating controller trace.

    test_controller_extensions.py simulated controller through real transport:
                       rehearsal lifecycle, bound take deletion and Undo.

    test_controller_recovery.py song navigation, playback/record transitions
                       and transient failures without a permanent error latch.

    test_controller.py dedicated controller protocol, exclusive ownership,
                       instrument isolation and disconnected-command rejection.

    test_transport.py  shared UI/controller commands, automatic keep, overlap
                       rejection, confirmed state and failed-save recovery.

    test_engine.py     the audio itself — mixing, seeking, disk safety,
                       crash recovery (a crashed take's notes included), both
                       bit depths, compression, the notes going to the
                       cloud with the original tracks, the notes the player
                       is sent for a take (take_notes), the MIDI ports
                       before a take (the check, Start, Finish, Under the
                       hood), a take with notes (Start, Stop, Keep and
                       Recover, through the Api on a fake port system), and
                       a take's notes following its files (renamed, merged,
                       deleted and cropped with the audio, a take of nothing
                       but notes too). No browser, no sound card: PortAudio
                       is stubbed and the samples are inspected directly.

    test_platform.py   the places macOS, Windows and Linux differ. Only one
                       of them is here, so the code is driven into each shape
                       on purpose — no recycle bin, no encoder, Windows
                       naming rules.

    test_store.py      the history database — schema, migrations, and the move of
                       old session.json files into it.

    test_ports.py      midi/ports.py, the one module that talks to the MIDI
                       library, against a stand-in for the library that has
                       the real one's quirks. The other suites block the
                       library; this one puts the stand-in in its place.
                       And midi/winrt_ports.py, the controller's ports on
                       Windows, against a stand-in for pywinrt.

    test_midi.py       recording notes beside the audio. So far: what stops
                       Start (no track that records sound, a track with no
                       port, two on one port), that the card check then
                       holds only the tracks that record audio, which saved
                       port is found again after a replug, the order a
                       device's ports are listed in, the .mid file (what
                       one can hold, written with mido and read back, names
                       in UTF-8, a DAW's own ticks and tempo read right), and
                       what a port has set and holds (the state a take starts
                       with, the keys and pedals let go at its end), and the
                       audio's own clock (a note placed on its sample, drift
                       included), and one take's notes on disk (a .midraw
                       written as they are played, the .mid made at Stop or
                       after a crash, a disk that refuses a write or takes it
                       in part, a recorder two threads drive), and the
                       rehearsal's ports on a fake port system (a port that
                       waits, comes, goes, is held by another app or goes
                       quiet, the same notes on two ports, a port kept open
                       with what it set through a rename or a re-pick and on
                       a system that opens a port once, a track starting from
                       its port's state while the port is away, a pedal let
                       up when its port goes, a take fed through the rig's
                       own threads), and a take's .mid read back as the notes
                       the player draws (a drum grid or a piano roll, a roll on
                       one note paired oldest first), and a .mid cropped (the
                       state before the start at tick 0, a key held across
                       either end left out or let go, ticks that do not
                       drift), and tools/midi_alignment.py, the hand check
                       of how far the notes are from their audio, run on
                       a folder of WAVs and .mid files made here (clicks
                       and drum hits, hard, soft, slow, ringing and over
                       a rumble, 3 ms late or early, a take of two windows,
                       16, 24 and 32-bit float).
                       Later tasks add to it. No port is opened: the library
                       is blocked and the rules are plain functions. Pads
                       that tap are in it too: the rig's note-ons counted as
                       taps only after Tap, from the instruments' ports and
                       not the controller's, ending after a pause.

    test_tempo.py      counting a song's tempo from a take (audio/tempo.py,
                       numpy only), on synthetic takes: 4/4, 3/4, 6/8 and a
                       drift, a drums .mid before the WAV and the WAV before
                       the tracks mixed, silence and short takes giving none.

    test_drift.py      where the band drifted: the beat tracker and each
                       bar's tempo (audio/tempo.py, audio/drift.py) on
                       synthetic takes with a known tempo in every bar
                       (drums with bleed, a .mid, the mix, 3/4, 6/8, a
                       ballad, a click take after its count-in, a stop),
                       the sources by the take's icons, and Api.take_drift:
                       the aim, 32 answers kept, Record stopping a count;
                       the count in a second process, and the app counting
                       when that process fails.

    test_click.py      the metronome's click: its tempos and accents, every
                       click of an hour on its frame, the three sounds and
                       clicks mixed into a stream's blocks, a WAV that
                       carries its tempo (read back by libsndfile), the
                       clocks that place a click on another device than the
                       recording card over an hour of drift, a crop snapped
                       to a click take's bars, the click in the streams, and
                       tools/click_alignment.py, the hand check of how far a
                       take's recorded clicks are from their places, run on
                       WAVs made here (2 ms late, 6/8, a take of two windows,
                       a WAV that carries no tempo).

    test_backing.py    a song's backing track: the file read in every format
                       the app takes and refused in the others, copied into
                       the library, made ready at the app's rate (a tone's
                       pitch and level kept, nothing aliased), counted on
                       synthetic drums (the tempo and bar 1 after a lead-in
                       or a pickup, pads with no beat), and written into a
                       take as its Backing track.

    test_sending.py    sending takes to a band service (sending/band_service.py)
                       against a fake service that checks every request
                       against service/openapi.json: a take sent part by
                       part, MP3s before FLAC, a part whose answer never
                       came, a close in the middle, no internet, a lost
                       upload, a refusal and Retry, a rename, a crop, a
                       deletion and its Undo, the close dialog, disconnect.
                       Needs openapi-core 0.23.1.

The interface's tests are in ui/, beside the code they test: `npm test` and
`npm run test:e2e` there. See tests/README.md.

They are plain scripts rather than pytest modules, and that is deliberate:
test_engine stubs the `sounddevice` module before importing anything that
needs a sound card, which has to happen at import time and fights with how
pytest collects. Each exits non-zero on failure, which is all CI needs.

They run side by side, each in its own process: they share nothing (each
points the app at temporary folders of its own), and one after another took
75 s in a four-core container where side by side took 50, the time of
test_engine alone (on CI's Mac, 145 s and 64). Each suite's output is
printed whole as it finishes, so the log reads one suite at a time, as
before. A suite still running after LIMIT seconds has hung: it is stopped
and what it wrote so far is printed, which shows where it stuck.
"""

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent
SUITES = ("test_control_api.py", "test_controller_browse.py", "test_controller_diagnostics.py", "test_controller_extensions.py", "test_controller_recovery.py", "test_controller.py", "test_transport.py", "test_engine.py", "test_platform.py", "test_store.py", "test_ports.py",
          "test_midi.py", "test_click.py", "test_tempo.py", "test_drift.py", "test_backing.py",
          "test_sending.py")

# Four times the longest any suite has taken (test_engine, 145 s on CI's Mac).
LIMIT = 600


def run(suite):
    """One suite, its output and its errors kept together, as it wrote them."""
    try:
        return subprocess.run(
            [sys.executable, str(HERE / suite)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=LIMIT,
            # Each line as it is written, so a hung suite's last lines are
            # caught too, and an error lands among them where it happened.
            env={**os.environ, "PYTHONUNBUFFERED": "1"},
        )
    except subprocess.TimeoutExpired as hung:
        stopped = f"\n{suite} still running after {LIMIT} s: stopped.\n".encode()
        return subprocess.CompletedProcess(hung.cmd, 1, (hung.output or b"") + stopped)


def main():
    failed = []
    with ThreadPoolExecutor(len(SUITES)) as pool:
        runs = {pool.submit(run, suite): suite for suite in SUITES}
        for done in as_completed(runs):
            suite, result = runs[done], done.result()
            print(f"\n{'=' * 60}\n{suite}\n{'=' * 60}", flush=True)
            # The bytes as the suite wrote them: decoded and encoded again,
            # a character the console cannot show would fail here instead.
            sys.stdout.buffer.write(result.stdout)
            sys.stdout.buffer.flush()
            if result.returncode != 0:
                failed.append(suite)

    print(f"\n{'=' * 60}")
    if failed:
        print("FAILED: " + ", ".join(failed))
        return 1
    print("All suites passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
