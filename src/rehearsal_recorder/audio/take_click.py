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

A song's backing track (backing-track spec, Parts 3 and 4) is placed on the same
grid (`TakeBacking`): its bar 1 on the first click after the count-in. It is
heard either way the click is, and the two need not be heard the same way: the
backing track can go to the band's speakers on another device while the click
is on the recording card. One device's output carries both in one stream. The
first click then waits for every output the take has. A take with a backing
track and no click (`clicks` False) has no count-in: its files start where the
backing track's first frame is heard, and end where Stop comes.

The callbacks take no lock: what other threads read is in single attributes,
set once.
"""

import math
import time
from pathlib import Path

from rehearsal_recorder.audio.backing_file import open_ready
from rehearsal_recorder.audio.backing_source import BackingSource, Sources
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


class TakeBacking:
    """
    A take's backing track: `file`, the song's file ready at the recording's
    rate (backing_file.make_ready), its bar 1 `first_bar` seconds in. Heard on
    the recording card's outputs in `route` (0-based), or on `output`, another
    device's (a ClickOutput, or a SilentOutput when it is not there), on that
    output's route unless `route` names others. `volume` and `on`: the row's.
    `played`: the file ready at the output's rate, when that is not the
    recording's.

    The take (TakeClick) sets where in the file it starts (`from_frame`, a
    frame of `file`, before its start when the count-in is longer than the
    lead-in) and makes its `source`. The recorder names it (`name`): "Backing",
    or "Backing (2)" beside a band track of that name. `heard`, once the first
    frame is chosen: whether its output was there then. One that was not is
    not heard, so the take keeps no Backing track (spec Part 3).
    """

    def __init__(self, file, first_bar, route=None, output=None, volume=0.8, on=True, played=None):
        self.file = Path(file)
        self.first_bar = float(first_bar)
        self.opened = open_ready(file)
        self.played = self.opened if played is None else open_ready(played)
        self.output = output
        self.route = tuple(output.route if route is None else route)
        self.volume = float(volume)
        self.on = bool(on)
        self.name = "Backing"
        self.from_frame = None
        self.source = None
        self.heard = None

    def problem(self):
        """Why its output is not playing it, or None."""
        return None if self.output is None else self.output.problem()


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

    `backing`: the take's TakeBacking, or None. `clicks` False: a take with a
    backing track and no click (the song has no tempo, or the metronome is
    off). Nothing is clicked and there is no count-in; `tempo` and `signature`
    are the song's, None for none, for its notes; `voices` may be None and
    `route` empty.
    """

    def __init__(self, tempo, signature, count_in_bars, voices, route, on=True, wav_tempo=True,
                 lead_sec=0.1, output=None, samplerate=None, clicks=True, backing=None):
        self.tempo = tempo
        self.signature = signature
        self.clicks = bool(clicks)
        self.count_in_clicks = count_in_bars * per_bar(signature) if self.clicks else 0
        self.route = tuple(route)
        self.wav_tempo = bool(wav_tempo) and self.clicks
        self.lead_sec = lead_sec
        self.output = output
        self.backing = backing
        self.samplerate = int(samplerate or (voices.samplerate if voices is not None else backing.opened[2]))
        self.first_click_frame = None
        self.end_frame = None
        self._round_trip = None
        self._in_clock = None
        self._on = bool(on) and self.clicks
        self.source = None
        if self.clicks:
            if output is not None and output.samplerate != voices.samplerate:
                voices = Voices(voices.sound, output.samplerate, voices.volume)
            self.source = ClickSource(tempo, signature, voices, self.route, place=self._place, heard=self._heard)
            self.source.set_on(on)
        if backing is not None:
            backing.from_frame = (round(backing.first_bar * self.samplerate)
                                  - click_frame(self.count_in_clicks, tempo, self.samplerate)
                                  if self.clicks else 0)
            self._backing_source()
        self._settle()

    def _backing_source(self):
        """The backing track's source, for the stream it plays in."""
        b = self.backing
        here = b.output is None
        scale = b.played[2] / self.samplerate
        b.source = BackingSource(b.played, b.route, b.volume, place=self._backing_place, follow=not here,
                                 floor=math.ceil(max(0, b.from_frame) * scale),
                                 samplerate=self.samplerate if here else b.output.samplerate)
        b.source.set_on(b.on)

    def _settle(self):
        """Which sources the take's own stream plays and which play on other
        devices, as (output, source); and how wide the take's outputs are."""
        parts = []
        if self.clicks:
            parts.append((self.output, self.source))
        if self.backing is not None:
            parts.append((self.backing.output, self.backing.source))
        self._card = tuple(source for output, source in parts if output is None)
        self._elsewhere = tuple((output, source) for output, source in parts if output is not None)
        widest = [c for source in self._card for c in source.route] or list(self.route)
        self.width = max(widest) + 1 if widest else 0

    @property
    def duplex(self):
        """Whether the take's own stream has outputs to play: the click, the
        backing track or both on the recording card."""
        return bool(self._card)

    @property
    def elsewhere(self):
        """The (output, source) of each part heard on another device than
        the recording card; empty when none is."""
        return self._elsewhere

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
        it comes back into the inputs that much later. A take with a part on
        another device chooses it in `on_input` instead, once that output has
        started too.
        """
        if self._round_trip is None:
            trip = round_trip_frames(time_info, None if latency is None else latency[0] + latency[1],
                                     self.samplerate)
            if trip is None:
                return
            self._round_trip = trip
            if not self._elsewhere:
                self._choose(frames_done + round(self.lead_sec * self.samplerate) + trip)
        lead = lead_of(time_info, None if latency is None else latency[1])
        if lead is not None:
            now = time.perf_counter_ns() if now_ns is None else now_ns
            for source in self._card:
                source.render(outdata, frames_done, now, lead)

    def without_outputs(self, name, reason):
        """
        The take's stream would not open with outputs: what was to be heard
        on them goes to none, `name` with `reason` saying why. The click is
        placed by the recording's clock as on another device, so the take
        keeps its grid and the screen still lights each click. The backing
        track is not heard, so the take keeps no Backing track.
        """
        if self.clicks and self.output is None:
            self.output = SilentOutput(name, reason, self.samplerate)
        if self.backing is not None and self.backing.output is None:
            self.backing.output = SilentOutput(name, reason, self.samplerate)
            self._backing_source()
        self._settle()

    # ---------- another device ----------

    def start(self):
        """Opens the outputs on other devices, one stream on each: the click
        and the backing track on one device share it. Never raises: what
        cannot be heard is the take's to carry on without."""
        streams = {}
        for output, source in self._elsewhere:
            streams.setdefault(id(output), (output, []))[1].append(source)
        for output, sources in streams.values():
            try:
                output.start(sources[0] if len(sources) == 1 else Sources(*sources))
            except Exception as e:
                print(f"[click] an output on another device did not open: {e}")

    def stop(self):
        stopped = set()
        for output, _ in self._elsewhere:
            if id(output) not in stopped:
                stopped.add(id(output))
                output.stop()

    def problem(self):
        """Why the click is not being heard, or None (the click's alone: the
        recording's are the recorder's, the backing track's its own)."""
        return None if self.output is None else self.output.problem()

    def on_input(self, frames_done, clock):
        """
        The recording's block from frame `frames_done` is in, and `clock` (an
        AudioClock) is marked with it. The first block after the first of
        every output on another device, or after the wait for them, chooses
        the first click: heard no sooner than each output's block after the
        one it may be writing now, and on the recording card no sooner than
        the round trip lets it be.
        """
        if self.first_click_frame is not None:
            return
        if self._card and self._round_trip is None:
            return
        rate = self.samplerate
        if frames_done < OUTPUT_WAIT_SEC * rate:
            for output, source in self._elsewhere:
                if not (source.started or output.problem() is not None):
                    return
        first = frames_done + round(OTHER_DEVICE_LEAD_SEC * rate)
        if self._card:
            first = max(first, frames_done + round(self.lead_sec * rate) + self._round_trip)
        step = round(LATER_STEP_SEC * rate)
        latest = frames_done + round(LATEST_SEC * rate)
        for _, source in self._elsewhere:
            written = source.written
            if written is None:
                continue
            due = source.clock.ns_at(written[0] + written[1])
            while due is not None and first < latest and clock.ns_at(first) < due:
                first += step
        self._in_clock = clock
        self._choose(first)

    def _choose(self, first):
        """The first click is `first`. Whether the backing track is heard is
        settled first, so whoever sees the frame sees that too."""
        if self.backing is not None:
            self.backing.heard = self.backing.problem() is None
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

    def _backing_place(self, o):
        """The frame of the backing track's file the stream's frame `o` plays:
        on the recording card the input frame it comes back on, a round trip
        later; on another device the input frame captured as it is heard,
        through both clocks. None before the first frame is chosen."""
        first = self.first_click_frame
        if first is None:
            return None
        b = self.backing
        if b.output is None:
            return b.from_frame + o + self._round_trip - first
        clock = self._in_clock
        at = b.source.clock.ns_at(o)
        if clock is None or at is None:
            return None
        frame = clock.frame_at(at)
        if frame is None:
            return None
        return (b.from_frame + frame - first) * b.played[2] / self.samplerate

    # ---------- for the take ----------

    def set_on(self, on):
        """The row's switch during the take: silent or heard, still counting."""
        if self.source is not None:
            self._on = bool(on)
            self.source.set_on(on)

    def set_backing_on(self, on):
        """The backing track's switch during the take: what is heard, never
        what the take keeps."""
        if self.backing is not None:
            self.backing.on = bool(on)
            self.backing.source.set_on(on)

    def set_backing_volume(self, volume):
        if self.backing is not None:
            self.backing.volume = float(volume)
            self.backing.source.set_volume(volume)

    def fade_backing(self):
        """Stop: the backing track fades out over 20 ms."""
        if self.backing is not None:
            self.backing.source.fade_out()

    def backing_faded(self):
        """Whether the fade at Stop has been heard, or never will be: no
        backing track, one that never played, or its output gone."""
        b = self.backing
        if b is None:
            return True
        source = b.source
        return source.done or not source.started or b.problem() is not None

    def backing_record(self):
        """The take's backing track as take.json keeps it, {"file", "from_frame",
        "name"}; None when it has none, or its first frame is not chosen yet,
        or its output was not there when it was."""
        b = self.backing
        if b is None or self.first_click_frame is None or not b.heard:
            return None
        return {"file": str(b.file), "from_frame": b.from_frame, "name": b.name}

    def fault(self):
        """repr() of the first error the take's sources kept, or None."""
        for source in (self.source, None if self.backing is None else self.backing.source):
            if source is not None and source.fault is not None:
                return source.fault
        return None

    def stop_frame(self, frames_done):
        """
        Where the take's files end when Stop comes after `frames_done` frames:
        on the next quarter from the first click (the next click in x/4, the
        next even one in 6/8), and a quarter at least; with no click, where
        Stop came. Kept as `end_frame`. A take stopped before it chose its
        first click has no grid to end on: it ends where it is, its first
        click still None, and keeps all its audio, as a take with no click
        (cut_of).
        """
        if self.first_click_frame is None:
            return frames_done
        if not self.clicks:
            self.end_frame = frames_done
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
        """The take's click as take.json keeps it; "clicks" False for a take
        with a backing track and no click."""
        record = {"tempo": self.tempo, "signature": self.signature, "on": self._on,
                  "wav_tempo": self.wav_tempo, "first_click_frame": self.first_click_frame,
                  "end_frame": self.end_frame}
        if not self.clicks:
            record["clicks"] = False
        return record

    def acid(self):
        """What the take's WAVs carry of its tempo; None with the setting off,
        and with no click."""
        return acid_of(self.tempo, self.signature) if self.wav_tempo else None

    def meter(self):
        """What its .mid files state of it (smf.meter_of)."""
        return meter_of(self.tempo, self.signature)

    def count_state(self, now_ns):
        """(the count-in click heard last, 1-based, 0 outside the count-in; ms
        since the count-in ended, None before the first click is chosen)."""
        if self.source is None:
            return 0, None
        return self.source.count_state(now_ns, self.count_in_clicks)

    def upcoming(self, now_ns, within_sec=1.5):
        if self.source is None:
            return []
        return self.source.upcoming(now_ns, within_sec)
