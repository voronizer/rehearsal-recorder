"""
A take's click: its count-in and its clicks to Stop, on the take's own grid
(metronome spec, Parts 3 and 9).

The grid is in the recording's frames. The first click of the count-in is
`first_click_frame`, an input frame chosen a moment after the take's stream
starts, and click k is `click_frame(k)` after it. The take's files start there
and end on a quarter (`end_frame`), so in a DAW the take's bars are the
project's.

Two ways to be heard:

- On the recording card (`duplex`, no `output`): the take's stream has outputs
  as well as inputs, and the recorder's callback hands each block's output to
  `on_duplex_block` before it writes the inputs. What is written there comes
  back into the inputs a round trip later, so the click of input frame s is
  written at output frame s less the round trip, and a beat played on it lands
  on s.
- On another device (`output`, an audio/click_output.ClickOutput): that
  device's stream renders the click, each placed by two clocks. The recording's
  (midi/clock.AudioClock, marked by the recorder) says when, on the computer's
  clock, input frame s is captured; the output's says which of its frames is
  heard then. The recorder's callback calls `on_input` with every block, and
  the first click is chosen at the first block after the output's first, so the
  whole count-in is heard however late the output starts. An output that is not
  there (or stops) changes nothing in the take: its grid stands, and the screen
  still hears when each click falls.

The callbacks take no lock and allocate nothing: what other threads read is in
single attributes, set once.
"""

import time

from rehearsal_recorder.audio.click import (
    SIGNATURES, Voices, click_frame, per_bar, per_quarter, quarter_tempo, tempo_range)
from rehearsal_recorder.audio.click_output import SilentOutput
from rehearsal_recorder.audio.click_source import ClickSource
from rehearsal_recorder.audio.click_timing import lead_of, round_trip_frames
from rehearsal_recorder.audio.wavfile import Acid
from rehearsal_recorder.midi.smf import meter_of

# How long after the first block of another device's output the first click
# comes, at the least: time for its stream to have it in a block, through two
# clocks. An output heard long after it is written (Bluetooth) has it later,
# after the block it may be writing as the click is chosen, in steps of
# LATER_STEP_SEC and no more than LATEST_SEC on.
OTHER_DEVICE_LEAD_SEC = 0.2
LATER_STEP_SEC = 0.05
LATEST_SEC = 2.0

# How long a take waits for another device's output to start before it
# chooses its first click anyway: the output is then taken for one that is not
# there, and the take's grid starts as it would.
OUTPUT_WAIT_SEC = 3.0


def acid_of(tempo, signature):
    """What a click take's WAVs carry of its tempo: an Acid."""
    num, den = (int(n) for n in signature.split("/"))
    return Acid(float(quarter_tempo(tempo, signature)), num, den)


def whole(value):
    """Whether `value` is a whole number: an int that is no bool."""
    return isinstance(value, int) and not isinstance(value, bool)


def cut_of(click):
    """
    Where a take's files are cut, from the `click` of its take.json: (the frame
    they start at, how many frames they hold or None for all, the Acid they
    carry or None). (0, None, None) for a take with no click, or one whose
    first click was never chosen: its files are as they were captured. What
    is not a number the app writes is taken for none, as a take.json read
    after a crash is whatever the disk kept.
    """
    if not isinstance(click, dict):
        return 0, None, None
    first = click.get("first_click_frame")
    if not whole(first) or first < 0:
        return 0, None, None
    end = click.get("end_frame")
    frames = end - first if whole(end) and end >= first else None
    tempo, signature = click.get("tempo"), click.get("signature")
    acid = None
    if (click.get("wav_tempo") is True and whole(tempo) and signature in SIGNATURES
            and tempo_range(signature)[0] <= tempo <= tempo_range(signature)[1]):
        acid = acid_of(tempo, signature)
    return first, frames, acid


class TakeClick:
    """
    The click of one take at `tempo` and `signature`, after `count_in_bars`
    bars of count-in, in `voices` (audio/click.Voices, at the recording's
    rate) on the outputs in `route` (0-based). `on`: whether it is heard to
    begin with (the row's switch). `wav_tempo`: whether the take's WAVs carry
    its tempo. `lead_sec`: how long after the take's first block its first
    click comes, on the recording card. `output`: the click's own output, on
    another device than the recording card; None rides the take's stream.
    `samplerate`: the recording's, if not the voices'.
    """

    def __init__(self, tempo, signature, count_in_bars, voices, route, on=True, wav_tempo=True,
                 lead_sec=0.1, output=None, samplerate=None):
        self.tempo = tempo
        self.signature = signature
        self.count_in_clicks = count_in_bars * per_bar(signature)
        self.route = tuple(route)
        self.width = max(self.route) + 1
        self.wav_tempo = bool(wav_tempo)
        self.lead_sec = lead_sec
        self.output = output
        self.samplerate = int(samplerate or voices.samplerate)
        self.first_click_frame = None
        self.end_frame = None
        self._round_trip = None
        self._in_clock = None
        if output is not None and output.samplerate != voices.samplerate:
            voices = Voices(voices.sound, output.samplerate, voices.volume)
        self.source = ClickSource(tempo, signature, voices, self.route, place=self._place, heard=self._heard)
        self.source.set_on(on)
        self._on = bool(on)

    @property
    def duplex(self):
        """Whether the click rides the take's own stream."""
        return self.output is None

    # ---------- the take's own stream ----------

    def on_duplex_block(self, outdata, frames_done, frames, time_info, latency, now_ns=None):
        """
        The take's stream, with outputs, has a block: `frames_done` frames
        were written before it, and its output `outdata` (zeroed) is the same
        frames on the output's side. `latency` is the stream's own (input,
        output) latency, what is believed where the driver's times are not;
        None until the stream says it, as its first blocks can come before
        it is open. The first block whose round trip is known, the driver's
        or from the stream's own latencies (never the ones asked for),
        chooses the first click: `lead_sec` on, and a round trip after, since
        it comes back into the inputs that much later.
        """
        if self.first_click_frame is None:
            trip = round_trip_frames(time_info, None if latency is None else latency[0] + latency[1],
                                     self.samplerate)
            if trip is None:
                return
            self._round_trip = trip
            self.first_click_frame = frames_done + round(self.lead_sec * self.samplerate) + trip
        lead = lead_of(time_info, None if latency is None else latency[1])
        if lead is not None:
            self.source.render(outdata, frames_done, time.perf_counter_ns() if now_ns is None else now_ns, lead)

    def without_outputs(self, name, reason):
        """
        The take's stream would not open with outputs: the click goes to
        none, `name` with `reason` saying why. It is placed by the
        recording's clock as on another device, so the take keeps its grid
        and the screen still lights each click.
        """
        self.output = SilentOutput(name, reason, self.samplerate)

    # ---------- another device ----------

    def start(self):
        """Opens the click's own output, if it has one. Never raises: a click
        that cannot be heard is the take's to carry on without."""
        if self.output is None:
            return
        try:
            self.output.start(self.source)
        except Exception as e:
            print(f"[click] the click's output did not open: {e}")

    def stop(self):
        if self.output is not None:
            self.output.stop()

    def problem(self):
        """Why the click is not being heard, or None (the click's alone: the
        recording's are the recorder's)."""
        return None if self.output is None else self.output.problem()

    def on_input(self, frames_done, clock):
        """
        The recording's block from frame `frames_done` is in, and `clock` (an
        AudioClock) is marked with it. The first block after the output's
        first, or after the wait for one, chooses the first click: heard no
        sooner than the output's block after the one it may be writing now.
        """
        if self.first_click_frame is not None:
            return
        source = self.source
        if not (source.started or self.output.problem() is not None
                or frames_done >= OUTPUT_WAIT_SEC * self.samplerate):
            return
        first = frames_done + round(OTHER_DEVICE_LEAD_SEC * self.samplerate)
        written = source.written
        if written is not None:
            due = source.clock.ns_at(written[0] + written[1])
            step = round(LATER_STEP_SEC * self.samplerate)
            latest = frames_done + round(LATEST_SEC * self.samplerate)
            while due is not None and first < latest and clock.ns_at(first) < due:
                first += step
        self._in_clock = clock
        self.first_click_frame = first

    # ---------- where each click goes ----------

    def _place(self, k):
        """The frame of the stream that plays the click that click k goes on."""
        first = self.first_click_frame
        if first is None:
            return None
        frame = first + click_frame(k, self.tempo, self.samplerate)
        if self.output is None:
            return frame - self._round_trip
        at = self._in_clock.ns_at(frame)
        return self.source.clock.frame_at(at)

    def _heard(self, k):
        """When click k is heard, on the computer's clock: as its input frame
        is captured, for that is what the click is placed for."""
        first = self.first_click_frame
        if first is None:
            return None
        frame = first + click_frame(k, self.tempo, self.samplerate)
        if self.output is None:
            return self.source.clock.ns_at(frame - self._round_trip)
        clock = self._in_clock
        return None if clock is None else clock.ns_at(frame)

    # ---------- for the take ----------

    def set_on(self, on):
        """The row's switch during the take: silent or heard, still counting."""
        self._on = bool(on)
        self.source.set_on(on)

    def stop_frame(self, frames_done):
        """
        Where the take's files end when Stop comes after `frames_done` frames:
        on the next quarter from the first click (the next click in x/4, the
        next even one in 6/8), and a quarter at least. Kept as `end_frame`. A
        take stopped before it chose its first click has no grid to end on:
        it ends where it is, its first click still None, and keeps all its
        audio, as a take with no click (cut_of).
        """
        if self.first_click_frame is None:
            return frames_done
        first = self.first_click_frame
        clicks = per_quarter(self.signature)
        minute = 60 * self.samplerate
        q = max(1, -(-(frames_done - first) * self.tempo // (minute * clicks)))
        if q > 1 and click_frame((q - 1) * clicks, self.tempo, self.samplerate) >= frames_done - first:
            q -= 1
        self.end_frame = first + click_frame(q * clicks, self.tempo, self.samplerate)
        return self.end_frame

    def record(self):
        """The take's click as take.json keeps it."""
        return {"tempo": self.tempo, "signature": self.signature, "on": self._on,
                "wav_tempo": self.wav_tempo, "first_click_frame": self.first_click_frame,
                "end_frame": self.end_frame}

    def acid(self):
        """What the take's WAVs carry of its tempo; None with the setting off."""
        return acid_of(self.tempo, self.signature) if self.wav_tempo else None

    def meter(self):
        """What its .mid files state of it (smf.meter_of)."""
        return meter_of(self.tempo, self.signature)

    def count_state(self, now_ns):
        """(the count-in click heard last, 1-based, 0 outside the count-in; ms
        since the count-in ended, None before the first click is chosen)."""
        return self.source.count_state(now_ns, self.count_in_clicks)

    def upcoming(self, now_ns, within_sec=1.5):
        return self.source.upcoming(now_ns, within_sec)
