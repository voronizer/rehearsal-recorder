"""
Multi-channel capture with continuous crash-safe writing.

Nothing is buffered in memory for long: every block goes straight to disk as
raw PCM (one file per track), and every 30 seconds those files are force-
flushed (flush + fsync). If the app dies or the interface is unplugged, at
most the last ~30 seconds are lost instead of the whole take.

On stop() the raw files are wrapped into proper .wav files. That is why a
take interrupted by a crash leaves .raw files behind — see audio/drafts.py,
which turns them back into playable takes.

A laptop that goes to sleep in the middle of a take (a closed lid, the
battery, Sleep from the menu: the app keeps it awake otherwise, see
platform_support.KeepAwake) ends the take where it slept. Everything up to
that moment is kept; whatever the card delivers after waking is dropped, so
the take does not jump from before the sleep to after it. The take hears it
from the system when the system says so (platform_support.SleepWatch), and
sees it for itself when it does not: see `_seen`.

The card's inputs come through rtmixer (audio/ring.py, and the spec
docs/superpowers/specs/2026-11-04-sound-process-design.md): its C callback
copies them into a ring, and a thread here takes them out every 2 ms and
writes them, so nothing Python is busy with makes the card wait. rtmixer hands
them over as float32; they are written as the 16 or 24 bits the take asked for,
the very samples the card sent.

A take recorded to the metronome's click (audio/take_click.py) starts its files
at the first click of its count-in, and Stop records on to the next quarter, so
the files hold whole quarters (metronome spec, Part 3). One stopped before its
first click was chosen keeps all its audio, as a take with no click. When the
click is on the recording card, the take's stream has outputs as well as inputs:
they play from a ring of their own, kept a second ahead, started at the same
moment as the recording's, so a frame played is heard as the same frame is
captured. On another device, the recorder only tells the click where the take
is. Either way the click's troubles are its own: they never stop the take, nor
show in `problem`. A card that will not open its outputs with its inputs
records from its inputs alone, its click to no output and its grid kept.

A song's backing track rides the take the same way (backing-track spec, Parts 3
and 4), on the recording card or on another device, through the take's click
(TakeClick.backing). At Stop it fades out, and the take keeps it as a track of
its own, Backing.wav, written from the file as it was placed: the band's
volume and switch change only what was heard.
"""

import json
import logging
import math
import os
import threading
import time
from pathlib import Path

import numpy as np
from rehearsal_recorder.activity import Stages
from rehearsal_recorder.audio import heartbeat
from rehearsal_recorder.audio.backing_file import write_take_track
from rehearsal_recorder.audio.devices import (
    STREAM_LOCK,
    DriverNotAnswering,
    close_stream,
    input_latency,
    open_stream,
    output_latency,
    sd,
)
from rehearsal_recorder.audio.format import (
    bytes_per_sample,
    capture_dtype,
    full_scale,
    normalize_depth,
    pack24,
)
from rehearsal_recorder.audio.ring import RingInput, RingMarks, RingOutput
from rehearsal_recorder.audio.wavfile import WavWriter
from rehearsal_recorder.midi.clock import AudioClock

log = logging.getLogger(__name__)

FLUSH_INTERVAL_SEC = 30

# How much of a raw file is copied at a time: small enough that an hour of
# 24-bit audio is not read into memory whole, large enough that the copy is
# not slowed down by the number of pieces.
COPY_BYTES = 4 * 1024 * 1024

# A take whose card has gone quiet — see audio/heartbeat.py for how that is
# told, and why it has to be.
STALLED = (
    "Recording stopped: no sound has come from the audio interface for "
    f"{heartbeat.SILENCE_SEC:.0f} seconds. It was unplugged, switched off or "
    "stopped answering. Everything captured up to that point has been saved."
)

# A take that went this long without a sign of life was frozen, and a whole
# app is frozen by the laptop going to sleep. Blocks come about every 21 ms
# and the take's own tick every TICK_SEC, so this is no hiccup.
SLEPT_GAP_SEC = 10.0
TICK_SEC = 1.0

# A click take's tick comes this often until take.json has its first click,
# so a take that dies in its first moments is still cut on its grid.
CLICK_TICK_SEC = 0.05

# Stop on a click take records on to the next quarter: never longer than this
# (a quarter at 30 a minute is 2 s), and not at all once the card has gone
# quiet for RUN_ON_QUIET_SEC.
RUN_ON_SEC = 2.0
RUN_ON_QUIET_SEC = 0.5

# Why a click on the recording card is not heard when the card would not open
# its outputs with its inputs.
OUTPUTS_REFUSED = "Its outputs would not open with its inputs."

# A take with its click on the recording card starts playing and recording
# this long after the stream says it is now: time for both rings to be asked
# before either begins, so they begin together.
START_AHEAD_SEC = 0.1


def slept_notice(at):
    """What the screen says once the laptop wakes, `at` being when it fell
    asleep, in the 24-hour form the rest of the app uses."""
    when = time.strftime("%H:%M", time.localtime(at))
    return (
        f"The laptop went to sleep at {when}, so the take ends there. "
        "Everything up to that moment is saved."
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
# channel of twice the length. It also says which tracks are recording notes
# and from which port, since a .midraw holds nothing but their events.
TAKE_RECORD = "take.json"


def _stream_latency(stream, asked):
    """The input latency an open stream says it has, in seconds; `asked`, the
    latency it was opened with, for a stream that gives none or something that
    is not a number (a duplex stream's is a pair)."""
    latency = getattr(stream, "latency", None)
    if isinstance(latency, (int, float)) and math.isfinite(latency) and latency > 0:
        return float(latency)
    return asked


def _device_name(index):
    """A device's name, for the screen to say which; "" when PortAudio cannot
    say, and the screen says it without one."""
    try:
        with STREAM_LOCK:
            return sd.query_devices(index)["name"]
    except Exception:
        return ""


def _duplex_latency(stream, asked):
    """A stream with inputs and outputs: its (input, output) latencies, each
    as it says it, or as `asked` where it says nothing usable."""
    latency = getattr(stream, "latency", None)
    if not isinstance(latency, (tuple, list)) or len(latency) != 2:
        return asked
    return tuple(
        float(said) if isinstance(said, (int, float)) and math.isfinite(said) and said > 0 else fallback
        for said, fallback in zip(latency, asked)
    )


class AudioRecorder:

    # What the sound process calls this kind (audio/sound/host.py).
    kind = "AudioRecorder"

    def __init__(self, device_index, samplerate, tracks, out_dir, bit_depth=16,
                 clock=None, notes=(), click=None, meter=None):
        """
        tracks: list of {"name": str, "channel": int, "stereo": bool};
                channel is 1-based, the way it is shown in the interface
                (channel 1 = first input). A stereo track takes that input
                and the next one, and is written as one two-channel file.
        out_dir: where this take's files are written.
        bit_depth: 16 or 24 — see audio/format.py for what that costs and buys.
        clock: an AudioClock (midi/clock.py) when the take has notes to place
               on this audio. The ring's reads mark it (audio/ring.RingMarks),
               and start() tells it when the take began and how late the
               stream says it is.
        notes: [{"file": str, "port": str}], the tracks recording notes beside
               this audio; written into the take's record, so that after a
               crash the notes can be told from the sound.
        click: a TakeClick (audio/take_click.py) for a take recorded to the
               metronome, or with a backing track. Duplex, the stream is
               opened with its outputs too; what is heard on another device
               has its own, placed by `clock`, which is made here when the
               take has none for notes. Its backing track is named here,
               "Backing" unless a band track has that name.
        meter: (tempo, signature) of a take with a tempo and no click (the
               metronome's switch off). take.json keeps it as the take's
               click, never on and with no first click, so its .mid states
               the tempo and a draft rescued after a crash still has it.
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
        self.click = click
        self.meter = meter if click is None else None
        if click is not None and click.elsewhere and clock is None:
            clock = AudioClock(samplerate)
        if click is not None and click.backing is not None:
            click.backing.name = backing_name(tracks)
        self._clock = clock
        self._notes = [dict(n) for n in notes]
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)

        # Why the notes' clock failed, if it did: repr() of the first error
        # marking it raised, the take carrying on without it (the notes lose
        # the drift correction, the audio loses nothing). The app reads it
        # when the take stops and writes it to the log there.
        self.clock_fault = None
        # The same for the click: what it raised first, the take going on.
        # Stop adds what the click's own rendering kept (ClickSource.fault),
        # so the app has one place to read it from.
        self.click_fault = None
        # The first click as take.json last said it, and the stream's own
        # (input, output) latency while it has outputs, None until it says.
        self._click_written = None
        self._duplex_latency = None

        self._stream = None
        # The rings: the inputs' (RingInput), and the click's on the
        # recording card (RingOutput) when it is there; the marks the inputs'
        # reads make on the notes' clock.
        self._input = None
        self._output = None
        self._marks = None
        # Input frame s comes back on the card's play frame s plus this (see
        # _card_fill), and the play action it was measured for.
        self._trip = 0
        self._trip_for = None
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

        # When the take last saw itself running (wall clock), and whether the
        # laptop has slept since it started — see _seen.
        self._seen_wall = None
        self._asleep = False
        self._tick_thread = None

        # One figure per channel: a stereo pair whose right microphone died
        # looks exactly like a working one if the two are reduced to their
        # louder half, and the signal check exists to catch precisely that.
        self._levels = {t["name"]: [0.0] * self._width[t["name"]] for t in tracks}
        self._levels_lock = threading.Lock()

        # The inputs as whole numbers, made from rtmixer's floats (see
        # _whole), grown to the largest read.
        self._ints = np.zeros((BLOCK_FRAMES, self._max_channel), dtype=self._dtype)
        self._floats = np.zeros((BLOCK_FRAMES, self._max_channel), dtype=np.float32)
        # One contiguous scratch buffer per track, allocated once and grown
        # only for a read longer than a block.
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
        self._logged = False

        # Why the recording stopped on its own — almost always an unplugged
        # interface. The interface polls this and can stop the take, keeping
        # whatever was recorded so far.
        self.error = None
        self._stopping = False
        self._result = {"duration_sec": 0.0, "tracks": [], "backing": None}

    @staticmethod
    def safe_name(name):
        return safe_name(name)

    def _finished(self):
        """PortAudio calls this when the stream stops. If we did not ask for
        the stop, the device went away, unless the laptop slept: a driver
        can end its stream on waking, before the tick or the screen's poll
        has noticed the sleep."""
        if not self._stopping and self.error is None and not self._slept():
            self.error = (
                "Recording stopped: the audio interface stopped responding. "
                "Everything captured up to that point has been saved."
            )

    def problem(self):
        """
        Why this take is not recording, or None. What the health check asks.

        As well as a stream that ended on its own (see _finished), a card
        that has gone silent is called stopped, since an unplugged ASIO card
        never ends its stream. A take that has seen no sign of life for
        SLEPT_GAP_SEC slept, and that is asked first: after waking, the card
        may not come back, and it would otherwise be called unplugged. Once
        said, either stays said.
        """
        if self.error is None and not self._stopping:
            if not self._slept() and self._heartbeat.silent():
                self.error = STALLED
        return self.error

    def _slept(self):
        """Whether the take has seen no sign of life for SLEPT_GAP_SEC, which
        means the laptop slept (see _seen); if so, it fell asleep then."""
        seen = self._seen_wall
        if seen is not None and time.time() - seen > SLEPT_GAP_SEC:
            self.fell_asleep(seen)
            return True
        return False

    def fell_asleep(self, at):
        """
        The laptop went to sleep at `at` (time.time()). From now on nothing
        more is written, so the take ends there, and the take says why,
        unless it already had something to say, or is being stopped anyway.
        """
        self._asleep = True
        if self.error is None and not self._stopping:
            self.error = slept_notice(at)

    def _seen(self, now):
        """
        A sign of life at `now`: each block, and the take's own tick.

        The system says it is going to sleep, but Microsoft does not promise
        that a desktop app hears it on a laptop with Modern Standby, so the
        take watches for itself. Nothing in a sleeping laptop runs, so two
        signs of life more than SLEPT_GAP_SEC apart mean it slept between
        them, at the first. The wall clock, because it counts the time
        asleep; whether the heartbeat's clock does differs between systems.
        And the tick, on its own thread, because the card may not come back
        after waking, and because the screen's poll can be rare (a hidden
        window's timers are slowed): a card that goes silent while the tick
        goes on was unplugged, not put to sleep.
        """
        seen = self._seen_wall
        if seen is not None and now - seen > SLEPT_GAP_SEC:
            self.fell_asleep(seen)
        self._seen_wall = now

    def is_active(self):
        return bool(self._stream is not None and self._stream.active)

    def _arrived(self, block, first_frame, arrival_ns):
        """
        The input ring's thread has frames for the take: `block`, float32
        frames by inputs, from the stream's `first_frame`, arrived at
        `arrival_ns` (None for silence in place of frames the ring could not
        take). Inside the heartbeat (RingInput), as a callback was.
        """
        self._seen(time.time())
        frames = len(block)
        # Once a stop is under way the files may be closing. After a sleep
        # the take has ended where the laptop slept.
        if frames == 0 or self._stopping or self._asleep:
            return
        marks = self._marks
        if marks is not None:
            # A fault in the notes' clock must not cost the audio: the notes
            # would be placed from when the take started, and the take goes on.
            try:
                window = None if self._input is None else self._input.window_ns
                marks.read(first_frame, frames, arrival_ns, window)
            except Exception as e:
                if self.clock_fault is None:
                    self.clock_fault = repr(e)
        click = self.click
        if click is not None and click.elsewhere:
            # A click or a backing track on another device: where the take
            # is, by the clock just marked.
            try:
                click.on_input(self._frames_written, self._clock)
            except Exception as e:
                if self.click_fault is None:
                    self.click_fault = repr(e)
        self._take_block(self._whole(block), frames)

    def _whole(self, block):
        """rtmixer's floats as the whole numbers the take writes: what the
        card sent, sample for sample. PortAudio made each float from them by
        dividing by 2 to the bits less one, which a float32 holds exactly to
        24 bits, so multiplying back gives them again."""
        frames = len(block)
        if len(self._ints) < frames:
            self._ints = np.zeros((frames, self._max_channel), dtype=self._dtype)
            self._floats = np.zeros((frames, self._max_channel), dtype=np.float32)
        floats, ints = self._floats[:frames], self._ints[:frames]
        if self.bit_depth == 24:
            np.multiply(block, np.float32(1 << 23), out=floats)
            np.rint(floats, out=floats)
            np.clip(floats, -(1 << 23), (1 << 23) - 1, out=floats)
            np.copyto(ints, floats, casting="unsafe")
            # In the top three bytes, as the 32-bit samples pack24 takes.
            np.left_shift(ints, 8, out=ints)
        else:
            np.multiply(block, np.float32(1 << 15), out=floats)
            np.rint(floats, out=floats)
            np.clip(floats, -(1 << 15), (1 << 15) - 1, out=floats)
            np.copyto(ints, floats, casting="unsafe")
        return ints

    def _card_fill(self, out, frame, now_ns, lead_sec):
        """A block of the recording card's outputs: the click's and the
        backing track's alone, silent but for them."""
        self._measure_trip()
        try:
            self.click.fill_card(out, frame, now_ns, lead_sec, self._trip)
        except Exception as e:
            if self.click_fault is None:
                self.click_fault = repr(e)

    def _measure_trip(self):
        """
        Where an input frame comes back on the card's outputs, once both
        rings have begun: by the stream's clock, the play ring's frame 0 is
        heard at its start and the record ring's frame 0 captured at its
        own, so the frames differ by the time between the two. Nothing when
        they began together, as asked; a ring begun again after running dry
        is measured again. A change mixes the click again from the guard.
        """
        output, record = self._output, self._input
        play = None if output is None else output.action
        if play is None or play is self._trip_for or record is None:
            return
        began, recorded = play.actual_time, record.started_time
        if began <= 0 or recorded is None:
            return
        self._trip_for = play
        trip = int(round((began - recorded) * self.samplerate)) - output.base
        if trip != self._trip:
            self._trip = trip
            output.change()

    def _card_state(self):
        return tuple((source, source.keep()) for source in self.click.card_sources
                     if hasattr(source, "keep"))

    def _card_restore(self, state):
        for source, kept in state:
            source.put_back(kept)

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

    def _tick_loop(self):
        # Not the flush thread: an fsync on a slow disk can take seconds.
        while not self._stop_flush.wait(CLICK_TICK_SEC if self._click_pending() else TICK_SEC):
            self._seen(time.time())
            self._note_click()

    def _click_pending(self):
        """Whether take.json has yet to say the first click the take chose,
        or the take has yet to choose it."""
        click = self.click
        return click is not None and (click.first_click_frame is None
                                      or self._click_written != click.first_click_frame)

    def _note_click(self):
        """take.json again, once the take has chosen its first click: a take
        the app does not live to finish is recovered cut on its grid."""
        if self._click_pending() and self.click.first_click_frame is not None:
            self._write_record()

    def start(self):
        self._write_record()
        click = self.click
        try:
            for track in self.tracks:
                path = self.out_dir / f"{self.safe_name(track['name'])}{RAW_SUFFIX}"
                self._raw_files[track["name"]] = open(path, "wb")

            latency = input_latency(sd, self.device_index)
            if click is not None and click.duplex:
                try:
                    self._open_duplex(latency)
                except DriverNotAnswering:
                    raise
                except Exception as e:
                    # Record still records (spec Part 4): from the inputs
                    # alone, the click to no output, counted by the take's
                    # clock, so the take keeps its grid and the screen still
                    # lights the beat.
                    print(f"[audio] the click's outputs did not open: {e}")
                    self._close_rings()
                    click.without_outputs(_device_name(self.device_index), OUTPUTS_REFUSED)
                    if self._clock is None:
                        self._clock = AudioClock(self.samplerate)
            if self._stream is None:
                self._open_input(latency)
            if click is not None:
                # The streams on other devices after the take's: PortAudio
                # opens one ASIO stream at a time, and the take is the one that
                # must open. The take waits for them to play before it chooses
                # its first click (TakeClick.on_input).
                click.start()
        except BaseException:
            if click is not None:
                click.stop()
            self._close_rings()
            self._discard_files()
            raise
        self._seen_wall = time.time()

        self._stop_flush.clear()
        self._flush_thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._flush_thread.start()
        self._tick_thread = threading.Thread(target=self._tick_loop, daemon=True)
        self._tick_thread.start()

    def _open_duplex(self, latency):
        """The take's stream with the card's outputs too, which carry the
        click on the card's own clock: never a second stream on a card the
        take holds. The click's ring is mixed a second ahead first, then
        both rings are asked to begin at one moment, START_AHEAD_SEC on."""
        import rtmixer  # the sound process's alone

        asked = (latency, output_latency(sd, self.device_index))
        with STREAM_LOCK:
            if self._clock is not None:
                self._clock.started_ns = time.perf_counter_ns()
                self._clock.latency_sec = latency
            self._stream = open_stream(
                rtmixer.MixerAndRecorder,
                device=(self.device_index, self.device_index),
                channels=(self._max_channel, self.click.width),
                samplerate=self.samplerate,
                blocksize=BLOCK_FRAMES,
                latency=asked,
                finished_callback=self._finished,
            )
        self._duplex_latency = _duplex_latency(self._stream, asked)
        said = self._duplex_latency[0]
        click = self.click
        self._output = RingOutput(self._stream, click.width, self.samplerate, self._card_fill,
                                  self._card_state, self._card_restore)
        for source in click.card_sources:
            if hasattr(source, "keep"):
                source.changed = self._output.change
        click.card_heard = self._output.heard
        self._start_input(said, ready=lambda: self._output.start(
            when=lambda: self._stream.time + START_AHEAD_SEC))

    def _open_input(self, latency):
        """The take's stream, inputs only."""
        import rtmixer  # the sound process's alone

        with STREAM_LOCK:
            if self._clock is not None:
                # The clock has the latency that was asked for until the
                # stream says what it is.
                self._clock.started_ns = time.perf_counter_ns()
                self._clock.latency_sec = latency
            self._stream = open_stream(
                rtmixer.Recorder,
                device=self.device_index,
                channels=self._max_channel,
                samplerate=self.samplerate,
                blocksize=BLOCK_FRAMES,
                latency=latency,
                finished_callback=self._finished,
            )
        self._start_input(_stream_latency(self._stream, latency))

    def _start_input(self, said, ready=None):
        """The inputs' ring, recording from the moment the outputs' ring was
        asked to begin when `ready()` starts one, at once when there is none.
        `said`: the input latency the stream says it has."""
        if self._clock is not None:
            self._clock.latency_sec = said
            self._marks = RingMarks(self._clock, self.samplerate, said)
        self._input = RingInput(self._stream, self._max_channel, self.samplerate, self._arrived,
                                heartbeat=self._heartbeat)
        at = 0
        if ready is not None:
            ready()
            at = self._output.requested
        self._input.start(at=at)

    def _close_rings(self):
        """The rings stopped and the stream they were on closed, for a start
        that did not get through. Never raises."""
        for ring in (self._output, self._input):
            if ring is not None:
                try:
                    ring.stop() if ring is self._output else ring.stop(drain=False)
                except Exception as e:
                    print(f"[audio] ring: {e}")
        self._output = self._input = self._marks = None
        if self.click is not None:
            self.click.card_heard = None
        with STREAM_LOCK:
            stream, self._stream = self._stream, None
            if stream is not None:
                try:
                    close_stream(stream)
                except Exception as e:
                    print(f"[audio] close: {e}")

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
        format, how wide each track is, which track each file is (a file's
        name is not always its track's: "Synth/Pad" is Synth_Pad.raw), each
        track's icon, which the take keeps, and which tracks are notes. Best
        effort — a take that cannot write this is still worth recording."""
        record = {
            "samplerate": self.samplerate,
            "bit_depth": self.bit_depth,
            "tracks": [
                {"file": self.safe_name(t["name"]),
                 "name": t["name"],
                 "channels": self._width[t["name"]],
                 "icon": t.get("icon") or None}
                for t in self.tracks
            ],
            "notes": self._notes,
        }
        click = self.click
        if click is not None:
            # The take's grid: its tempo, and where its files start and end
            # (spec Part 1). Written again as each is known, so it is written
            # beside the file and moved onto it: a crash mid-write leaves the
            # one before. With it, the backing track, once the take knows
            # where it starts and that it was heard, for a draft recovered
            # after a crash to write its Backing track.
            record["click"] = click.record()
            if click.backing is not None:
                record["backing"] = click.backing_record()
        elif self.meter is not None:
            tempo, signature = self.meter
            record["click"] = {"tempo": tempo, "signature": signature, "on": False, "wav_tempo": False,
                               "first_click_frame": None, "end_frame": None}
        path = self.out_dir / TAKE_RECORD
        try:
            if click is None:
                path.write_text(json.dumps(record), encoding="utf-8")
            else:
                writing = path.with_name(TAKE_RECORD + ".writing")
                writing.write_text(json.dumps(record), encoding="utf-8")
                os.replace(writing, path)
                self._click_written = record["click"]["first_click_frame"]
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
        click = self.click
        # Only a take with its first click has a quarter to run on to.
        if click is not None and click.first_click_frame is not None:
            self._run_on(click)
        self._let_go()
        if click is not None:
            click.stop()
            self._click_done(click)
            if click.end_frame is None or click.end_frame <= click.first_click_frame:
                # Stopped before its first click, a block after Stop chose one
                # too late, or the card gone before the first click was
                # captured: no grid, as take.json then says (cut_of), and all
                # the audio there is, rather than none.
                click.first_click_frame = None
                click.end_frame = None
            self._write_record()

        # A click take's files run from its first click to its end_frame; one
        # with no first click keeps all its audio, as a take with no click.
        head, frames, acid = 0, None, None
        if click is not None and click.first_click_frame is not None:
            head = click.first_click_frame
            frames = max(0, click.end_frame - head)
            acid = click.acid()
            duration = frames / self.samplerate
        else:
            duration = self._frames_written / self.samplerate

        raws = [self.out_dir / f"{self.safe_name(t['name'])}{RAW_SUFFIX}"
                for t in self.tracks]
        # The Backing track is written last, weighed by the bytes it will be.
        heard = None
        if click is not None and click.first_click_frame is not None:
            heard = click.backing_record()
        parts = [(f"Track {i + 1} of {len(raws)}", p.stat().st_size if p.exists() else 0)
                 for i, p in enumerate(raws)]
        if heard is not None:
            parts.append(("Backing track", frames * click.backing.opened[4] * self._sample_bytes))
        stages = Stages(parts, progress or (lambda fraction, step: None))
        finalized = []
        for i, track in enumerate(self.tracks):
            raw_path = raws[i]
            wav_path = self.out_dir / f"{self.safe_name(track['name'])}.wav"
            raw_to_wav(raw_path, wav_path, self.samplerate, self.bit_depth,
                       channels=self._width[track["name"]],
                       progress=stages.part(i), head_frames=head, frames=frames,
                       acid=acid)
            raw_path.unlink(missing_ok=True)
            finalized.append({
                "name": track["name"],
                "file": str(wav_path),
                **({"stereo": True} if self._width[track["name"]] == 2 else {}),
            })

        backing = None
        if heard is not None:
            backing = self._write_backing(heard, click, frames, stages.part(len(raws)))

        # The record has done its job: every wav now carries its own header.
        # Left behind it would ride along into the saved take. A take with
        # notes keeps it a little longer: the .mid files are made after this,
        # and it says which port each came from (midi/capture.finish_draft).
        # The app removes it once no notes file is left that needs it. A click
        # take keeps it too: it says the take's grid, for its .mid files and
        # for a crop of the draft; one with a tempo and no click, for its tempo.
        if not self._notes and click is None and self.meter is None:
            (self.out_dir / TAKE_RECORD).unlink(missing_ok=True)

        self._result = {"duration_sec": duration, "tracks": finalized, "backing": backing}
        return self._result

    def _write_backing(self, record, click, frames, progress):
        """The take's Backing track, as it was heard (`record`, as
        backing_record gives it): {"name", "file"}, or None for a disk that
        would not take it (the take's own tracks are written by then)."""
        path = self.out_dir / f"{self.safe_name(record['name'])}.wav"
        try:
            write_take_track(click.backing.opened, record["from_frame"], frames, path,
                             self.samplerate, self._sample_bytes, progress)
        except OSError as e:
            print(f"[audio] Backing track not written: {e}")
            path.unlink(missing_ok=True)
            return None
        return {"name": record["name"], "file": str(path)}

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
        if self.click is not None:
            self.click.stop()
            self._click_done(self.click)
            self._note_click()

    def _click_done(self, click):
        """The click has played its last: what went wrong in its rendering, if
        nothing went wrong here first, joins click_fault."""
        if self.click_fault is None:
            self.click_fault = click.fault()

    def _run_on(self, click):
        """
        Stop on a click take: the take goes on to the next quarter, so its
        files hold whole quarters (spec Part 3), unless the card has gone or
        the laptop slept, when it ends where it ends. Its backing track fades
        out, and the stream stays open until the fade is heard, which moves
        no end. Waits for the card's blocks, at most RUN_ON_SEC.
        """
        click.fade_backing()
        target = click.stop_frame(self._frames_written)
        deadline = time.monotonic() + RUN_ON_SEC
        seen, quiet_since = self._frames_written, time.monotonic()
        while ((self._frames_written < target or not click.backing_faded())
               and self.error is None and not self._asleep):
            now = time.monotonic()
            if self._stream is None or now > deadline or now - quiet_since > RUN_ON_QUIET_SEC:
                break
            if self._frames_written != seen:
                seen, quiet_since = self._frames_written, now
            time.sleep(0.005)
        click.end_frame = min(target, self._frames_written)

    def _let_go(self):
        """The stream closed and every byte on disk — what stopping and
        abandoning have in common. What the input ring holds is written
        first; then the rings let go, and the stream closes."""
        self._stop_flush.set()
        for thread in (self._flush_thread, self._tick_thread):
            if thread is not None:
                thread.join(timeout=2)

        recording = self._input
        if recording is not None:
            try:
                recording.stop(drain=True)
            except Exception as e:
                print(f"[audio] ring: {e}")
        # Mark the stop as ours, otherwise finished_callback would report it
        # as a vanished interface.
        self._stopping = True
        playing = self._output
        if playing is not None:
            try:
                playing.stop()
            except Exception as e:
                print(f"[audio] ring: {e}")
        if self.click is not None:
            self.click.card_heard = None
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
        self._log_take()

    def _log_take(self):
        """One line in the log for the take: how much it recorded, how full
        the input ring got, and whether it ever filled."""
        recording = self._input
        if recording is None or self._logged:
            return
        self._logged = True
        counts = recording.counts
        rate = float(self.samplerate)
        log.info(
            "take: %d frames recorded (%.1f s); input ring at most %.2f s full of %.2f s; "
            "filled %d times, %.2f s lost",
            self._frames_written, self._frames_written / rate, counts["fullest_frames"] / rate,
            recording.size / rate, counts["overflowed"], counts["lost_frames"] / rate)


def safe_name(name):
    """A track's name as its file's: what a file name cannot hold becomes _."""
    keep = "".join(c if c.isalnum() or c in " -_()" else "_" for c in name)
    return keep.strip() or "track"


def backing_name(tracks):
    """The take's Backing track's name: "Backing", or "Backing (2)" and on
    when a band track's file would have that name, in any case, as Windows
    and macOS compare file names."""
    taken = {safe_name(t["name"]).casefold() for t in tracks}
    name, n = "Backing", 2
    while safe_name(name).casefold() in taken:
        name, n = f"Backing ({n})", n + 1
    return name


def raw_to_wav(raw_path, wav_path, samplerate, bit_depth=16, channels=1,
               progress=None, head_frames=0, frames=None, acid=None):
    """
    Wrap a raw PCM file into a .wav with a proper header.

    The raw file already holds the final bytes, in their final order, so this
    only adds the header — which is why a take interrupted by a crash can
    still be rescued, stereo or not. Copied a piece at a time: it used to be
    read whole, some 500 MB for an hour of one 24-bit track.

    A click take's files start at its first click and end on a quarter
    (metronome spec, Part 3), so only frames [head_frames, head_frames +
    frames) are copied: from `head_frames` to the end when `frames` is None,
    and no more than the raw file holds. `acid` (audio/wavfile.Acid) is the
    take's tempo, for the file to carry.
    """
    width = bytes_per_sample(bit_depth) * channels
    # A take cut off mid-frame would otherwise produce a wav whose length does
    # not divide evenly, which some players refuse outright. A stereo file cut
    # between its two channels is the same problem, one sample further in.
    whole = os.path.getsize(raw_path) // width
    first = min(head_frames, whole)
    last = whole if frames is None else min(whole, first + frames)
    usable = (last - first) * width
    with open(raw_path, "rb") as rf, WavWriter(wav_path, samplerate, channels,
                                               bytes_per_sample(bit_depth), acid) as wf:
        rf.seek(first * width)
        left = usable
        while left > 0:
            piece = rf.read(min(left, COPY_BYTES))
            if not piece:
                break
            wf.write(piece)
            left -= len(piece)
            if progress is not None:
                progress((usable - left) / usable)
    if progress is not None:
        progress(1.0)
