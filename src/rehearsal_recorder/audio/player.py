"""
Take playback, done in Python.

The tracks used to be played by the browser through Web Audio. That made it
impossible to pick an output device: on the web the output is switched with
setSinkId, which this engine does not implement for AudioContext. It also
meant holding the whole take in memory decoded (float32, ~11.5 MB per minute
per track) and maintaining a second, streaming mode for long takes.

This is simpler and more honest: the output device is chosen explicitly, and
tracks are read through memmap — the OS pages in what is needed, so memory
does not grow with take length and seeking is just an index change.

The card is fed by rtmixer from a ring the mixing keeps a second ahead
(audio/ring.py; docs/superpowers/specs/2026-11-04-sound-process-design.md,
Part 2), so nothing else Python does can make it wait. A setting (M, S, a
fader, Master, the click) mixes the second not yet heard again; Play, Pause,
a seek and the loop move the take a block ahead of the card. The playhead and
the meters are those of the block the card plays now, not of the last mixed.

Synchronisation comes for free: every track is mixed into one stream from the
same position, so there is nothing to drift apart.

The metronome's click rides this stream too (metronome spec, Parts 3 and 8). A
click take plays back with its click, made again from its tempo at the take's
own frames, so it follows a seek and a loop; it is under the master volume and
out of the meters. Between takes, the metronome's own click (▶, or a bar
played for a setting) is mixed in here when its output is this stream's
device, on its own outputs, outside the take's mix: the app never opens a
second stream on a device it already holds. The stream is opened wide enough
for both.
"""

import threading

import numpy as np
from rehearsal_recorder.audio import heartbeat
from rehearsal_recorder.audio.click import accent, click_frame, mix_clicks
from rehearsal_recorder.audio.devices import (
    STREAM_LOCK,
    close_stream,
    open_stream,
    output_complaint,
    output_latency,
    usable_output,
    sd,
)
from rehearsal_recorder.audio.format import unpack24
from rehearsal_recorder.audio.ring import BLOCK, RingOutput
from rehearsal_recorder.audio.wavfile import _open_track

BLOCK_FRAMES = BLOCK

# The mix is made at 16-bit scale; the ring is float, full scale 1.
_TO_FLOAT = 1.0 / 32768.0


def channel_label(channels):
    """How the person reads a choice of outputs: "3–4", or "5" for one."""
    return "–".join(str(c) for c in channels)


# How quickly gain follows a change. Switching the coefficient instantly
# clicks, so it is eased towards the target over a few blocks.
GAIN_SMOOTHING = 0.25


class Track:
    def __init__(self, name, path):
        self.name = name
        (
            self.data,
            self.frames,
            self.samplerate,
            self.sample_bytes,
            self.width,
        ) = _open_track(path)
        self.volume = 1.0
        self.muted = False
        # Current smoothed coefficient, so mute/solo does not click.
        self.current_gain = 1.0
        # Loudest sample each of this track's channels contributed to the
        # last block, after its gain — so it is what came out, not what is on
        # disk. One figure per channel, because a stereo pair whose right side
        # died looks like a working one once the two are reduced to the louder
        # of them. Written by the audio thread, read by whoever asks for
        # state(), both under the lock.
        self.levels = [0.0] * self.width
        # Everything is mixed at 16-bit scale, because that is what goes out
        # to the card. A 24-bit sample is 256 times larger for the same
        # loudness, so it is scaled down as it is read — one multiply that
        # rides along with the volume.
        self.scale = 1.0 / 256.0 if self.sample_bytes == 3 else 1.0


class TakePlayer:

    # What the sound process calls this kind (audio/sound/host.py).
    kind = "TakePlayer"

    def __init__(self, tracks):
        """tracks: [{"name":.., "file":..}] — the tracks of one take.

        No audio device is opened here; that lives in open_output() so mixing,
        seeking and looping can be tested without a sound card."""
        if not tracks:
            raise ValueError("No tracks")

        self.tracks = [Track(t["name"], t["file"]) for t in tracks]
        self.samplerate = self.tracks[0].samplerate
        self.total_frames = max(t.frames for t in self.tracks)

        self._lock = threading.Lock()
        self.last_status = None
        # What one listening cost, for skips(): the frames mixed while the
        # take played (each once, however often a block is mixed again: up to
        # `_counted`), the ring's dry runs counted at the last look, and
        # since the last ask: the dry runs and the least the ring held, kept
        # here so a ring let go of (close_output) takes none of them with it.
        self._heard = 0
        self._counted = 0
        self._dry_told = 0
        self._dry_since = 0
        self._least_frames = None
        self._pos = 0
        self._playing = False
        self._loop = None  # (start_frame, end_frame)
        self._loop_asked = None
        self._soloed = None
        self._finished = False
        # How loud the whole mix comes out, after every track's own fader —
        # the knob on the speaker rather than the balance of the band. The
        # faders make the cloud mix too; this only makes listening louder or
        # quieter, so the tracks' meters are read before it.
        self.master = 1.0
        self.master_muted = False
        self._master_gain = 1.0
        # Loudest sample of the last block of the whole mix, after the master
        # and before the clip — so a sum of tracks that goes past full scale
        # reads as past it, although no single track does.
        self.master_level = 0.0

        # The mix is always stereo. Where it goes on the card is separate: the
        # stream is opened as wide as the highest output asked for, and
        # `_route` names the columns (0-based) the mix is written into.
        self._out_channels = 2
        self._stream_channels = 2
        self._route = (0, 1)
        self._stream = None
        # The ring the stream plays (audio/ring.RingOutput), and whether the
        # take plays as the last Play, Pause or end of the take left it: the
        # card hears that a block or two later, the buttons show it at once.
        self._ring = None
        self._meant = None
        # The device the stream is open on (None: the system's), and how
        # late what it writes is heard, for the click between takes.
        self.output_device = None
        self._latency = 0.0
        # Whether the output is still asking for sound, and what to call it
        # if it stops: see problem.
        self._heartbeat = heartbeat.Heartbeat()
        self._output_name = None
        # Why playback stopped by itself — the output went quiet under it —
        # or None. Cleared only by opening an output again.
        self.problem = None

        # Buffers are allocated once and reused. Allocating inside an audio
        # callback means calling malloc on the realtime thread every 21 ms —
        # it is the one thing in this app that touches the allocator from a
        # thread we do not control, and it buys nothing.
        self._mix = None
        self._scratch = None
        self._out16 = None
        # Only needed when a take has 24-bit tracks: the bytes unpacked into
        # numbers, once per block.
        self._i32 = None

        # The take's own click (Part 8): (tempo, signature, voices) for a click
        # take, None for one without; whether it is heard; its block, at 0..1
        # before the master; where in the take the last block ended, so a
        # click begun there runs on and one cut by a seek is not heard half;
        # and the clicks of one block, reused.
        self._take_click = None
        self._click_on = False
        self._clicks = None
        self._click_until = None
        self._click_starts = []
        # The click between takes (a ClickSource) when it rides this stream,
        # and a song's backing track (a BackingSource) the same; their block,
        # as wide as the stream, and the stream's frames so far.
        self._free_click = None
        self._free_backing = None
        self._free = None

    def open_output(self, device_index=None, channels=(1, 2), extra_channels=()):
        """
        Opens the output. Returns a complaint when the chosen device could not
        be used and the system one was taken instead — the take still plays,
        the person just needs to know it is coming out somewhere else.

        `channels` is where on the card the mix comes out, counted from 1 the
        way the card's own labels count: a pair such as (3, 4), or one output
        on its own, (5,). The system output is always 1–2 — which of its
        channels are which is the system's business, not ours.

        `extra_channels`: the metronome's click's outputs, when its output is
        this same device, so the stream reaches them too. Outputs the card
        does not have are left out.
        """
        index, complaint = usable_output(device_index, self.samplerate)
        channels = tuple(channels) if index is not None else (1, 2)
        extra = ()

        if index is not None:
            info = sd.query_devices(index)
            if max(channels) > info.get("max_output_channels", 2):
                complaint = (
                    f"“{info.get('name', 'The chosen device')}” has no output "
                    f"{channel_label(channels)}, so it plays through 1–2."
                )
                channels = (1, 2)
            extra = tuple(c for c in extra_channels if c <= info.get("max_output_channels", 2))
        elif device_index is None:
            extra = tuple(c for c in extra_channels if c <= 2)

        with STREAM_LOCK:
            self.close_output()
            try:
                self._start_output(index, channels, extra)
            except Exception as e:
                # The chosen card refused at the moment of opening. An ASIO
                # card is never asked beforehand — the asking costs a full
                # load of the driver and cannot answer better than this — so
                # this is where its refusal arrives, and the take is worth
                # more than the card it comes out of.
                if index is None:
                    raise
                name = sd.query_devices(index).get("name", "The chosen device")
                complaint = output_complaint(name, e, self.samplerate)
                self._start_output(None, (1, 2))
        return complaint

    def _start_output(self, index, channels, extra=()):
        """The stream itself, once the device and the outputs are settled."""
        import rtmixer  # the sound process's alone

        self._route = tuple(c - 1 for c in channels)
        self._stream_channels = max((*channels, *extra))
        self._free = np.zeros((BLOCK_FRAMES, self._stream_channels), dtype=np.float32)
        self._latency = output_latency(sd, index)
        self._stream = open_stream(
            rtmixer.Mixer,
            device=index,
            channels=self._stream_channels,
            samplerate=self.samplerate,
            blocksize=BLOCK_FRAMES,
            # Without it, what is played can be heard seconds later — see
            # output_latency.
            latency=self._latency,
        )
        self.output_device = index
        said = getattr(self._stream, "latency", None)
        if isinstance(said, (int, float)) and 0 < said < 1:
            self._latency = float(said)
        self._ring = RingOutput(self._stream, self._stream_channels, self.samplerate,
                                self._ring_fill, self._ring_state, self._ring_restore,
                                heartbeat=self._heartbeat)
        self._dry_told = 0
        self._ring.start()
        try:
            self._output_name = (
                sd.query_devices(index)["name"] if index is not None else None
            )
        except Exception:
            self._output_name = None
        self.problem = None

    def output_problem(self):
        """problem, with the output asked afresh — for a play that must not
        start into a dead stream just because nobody polled while paused."""
        self._check_output()
        return self.problem

    def _check_output(self):
        """
        Pauses the take when its output has gone quiet, and says why. An
        output card unplugged mid-take takes the stream with it — ASIO
        without a word — and playback would otherwise sit there, "playing",
        with the cursor frozen. The dead stream is left for the next play to
        replace: this is asked from the state poll, which opens and closes
        nothing. Asked without the lock: the pause is a move of the ring's,
        whose thread takes the ring's lock before this one's.
        """
        if self.problem is None and self._heartbeat.silent():
            where = (
                f"“{self._output_name}”" if self._output_name
                else "the system output"
            )
            self.problem = (
                f"Playback stopped: nothing has gone out through {where} for "
                f"{heartbeat.SILENCE_SEC:.0f} seconds. It was unplugged, "
                "switched off or stopped answering. Press play to try it again."
            )
            self._meant = False
            self._apply(self._pause)

    # ---------- audio ----------

    def _effective_gain(self, track):
        if track.muted:
            return 0.0
        if self._soloed is not None and self._soloed != track.name:
            return 0.0
        return track.volume

    def _ensure_buffers(self, frames):
        if self._mix is not None and self._mix.shape[0] >= frames:
            return
        self._mix = np.zeros((frames, self._out_channels), dtype=np.float32)
        # Two columns wide, so a stereo track's sides can be kept apart on
        # the way through. A mono track uses the first.
        self._scratch = np.zeros((frames, 2), dtype=np.float32)
        self._out16 = np.zeros((frames, self._out_channels), dtype=np.int16)
        self._i32 = np.zeros(frames * 2, dtype=np.int32)
        self._clicks = np.zeros((frames, self._out_channels), dtype=np.float32)

    def _mix_take_click(self, click, at, n):
        """
        The take's click for the `n` frames of the take from the current
        position, into its block from `at`: click k at the take's frame
        click_frame(k), the first click of the count-in being its first frame.
        A click begun before them sounds on only when the last block ended
        where these begin; after a seek or round a loop it is not heard half.
        """
        tempo, signature, voices = click
        pos, rate = self._pos, self.samplerate
        length = len(voices.of(0))
        begin = pos - length if pos == self._click_until else pos
        starts = self._click_starts
        starts.clear()
        k = max(0, begin * tempo // (60 * rate))
        while True:
            frame = click_frame(k, tempo, rate)
            if frame >= pos + n:
                break
            if frame >= begin:
                starts.append((frame, accent(signature, k)))
            k += 1
        self._click_until = pos + n
        if starts:
            mix_clicks(self._clicks[at:at + n], pos, starts, voices, (0, 1))

    def _render(self, frames):
        """
        Produces one block of audio. Kept separate from the callback so that
        mixing, seeking and looping can be verified without a sound card.

        Returns a view on a reused buffer: the caller copies it into the
        device's own buffer straight away and never holds on to it.
        """
        self._ensure_buffers(frames)
        out = self._mix[:frames]
        out.fill(0.0)
        result = self._out16[:frames]

        if not self._playing:
            result.fill(0)
            for track in self.tracks:
                track.levels = [0.0] * track.width
            # Turned down while paused, the take must start quiet, not ease
            # down from where it was over the first few blocks.
            self._master_gain = 0.0 if self.master_muted else self.master
            self.master_level = 0.0
            self._click_until = None
            return result

        click = self._take_click if self._click_on else None
        if click is not None:
            clicks = self._clicks[:frames]
            clicks.fill(0.0)

        # Cleared once per block rather than per segment: one block can cross
        # a loop point and come back, and the meter wants the loudest of the
        # whole block, not of whichever piece happened to be written last.
        for track in self.tracks:
            track.levels = [0.0] * track.width

        written = 0
        while written < frames:
            if self._loop is not None:
                seg_start, seg_end = self._loop
                if self._pos < seg_start or self._pos >= seg_end:
                    self._pos = seg_start
            else:
                seg_end = self.total_frames

            available = seg_end - self._pos
            if available <= 0:
                if self._loop is not None:
                    self._pos = self._loop[0]
                    continue
                # Take finished: stop and rewind to the start.
                self._playing = False
                self._finished = True
                self._pos = 0
                break

            n = min(frames - written, available)
            if click is not None:
                self._mix_take_click(click, written, n)

            for track in self.tracks:
                target = self._effective_gain(track)
                track.current_gain += (target - track.current_gain) * GAIN_SMOOTHING
                gain = track.current_gain
                if gain < 1e-4:
                    continue

                end = min(self._pos + n, track.frames)
                if end <= self._pos:
                    continue
                length = end - self._pos
                width = track.width
                seg = self._scratch[:length, :width]
                if track.sample_bytes == 3:
                    whole = self._i32[:length * width]
                    unpack24(
                        track.data[self._pos:end].reshape(-1, 3),
                        whole,
                    )
                    np.copyto(seg, whole.reshape(length, width), casting="unsafe")
                else:
                    np.copyto(seg, track.data[self._pos:end], casting="unsafe")
                seg *= gain * track.scale
                # Two reductions and a compare per channel. np.abs(seg).max()
                # would say the same thing and allocate an array to say it, on
                # the one thread in this app that has a deadline.
                for c in range(width):
                    col = seg[:, c]
                    loudest = max(float(col.max()), -float(col.min()))
                    if loudest > track.levels[c]:
                        track.levels[c] = loudest
                # A stereo track keeps its sides; a mono one reaches both.
                out[written:written + length, 0] += seg[:, 0]
                out[written:written + length, 1] += seg[:, width - 1]

            self._pos += n
            written += n

        target_master = 0.0 if self.master_muted else self.master
        self._master_gain += (target_master - self._master_gain) * GAIN_SMOOTHING
        if abs(target_master - self._master_gain) < 1e-4:
            self._master_gain = target_master
        if self._master_gain != 1.0:
            out *= self._master_gain
        self.master_level = max(float(out.max()), -float(out.min()))
        if click is not None:
            # After the meter, under the master: the take turned down turns
            # its click down, and muted, it is silent.
            clicks *= 32767.0 * self._master_gain
            out += clicks

        np.clip(out, -32768, 32767, out=out)
        np.copyto(result, out, casting="unsafe")
        return result

    def _ring_fill(self, out, frame, now_ns, lead_sec):
        """
        One block of the ring (audio/ring.RingOutput): the take's mix on its
        route, then the click or backing track between takes on theirs.
        Returns what the screen shows while the card plays it: where in the
        take it began, whether it played, the meters it made, and whether the
        take had finished by its end.
        """
        frames = len(out)
        with self._lock:
            place, playing = self._pos, self._playing
            if playing and frame >= self._counted:
                self._heard += frames
                self._counted = frame + frames
            self._render(frames)
            mix = self._mix[:frames]
            if len(self._route) == 2:
                np.multiply(mix[:, 0], _TO_FLOAT, out=out[:, self._route[0]])
                np.multiply(mix[:, 1], _TO_FLOAT, out=out[:, self._route[1]])
            else:
                # One output on its own takes the left side, which is the
                # whole mix: every track goes to both sides equally, so left
                # and right are the same samples. If tracks ever get a pan,
                # this has to become the average of the two.
                np.multiply(mix[:, 0], _TO_FLOAT, out=out[:, self._route[0]])
            shown = (place, playing, self.master_level, [t.levels for t in self.tracks],
                     self._finished)
        for free in (self._free_click, self._free_backing):
            if free is not None:
                self._add_free(free, out, frame, now_ns, lead_sec)
        return shown

    def _ring_state(self):
        """What the mixing has moved on since a block began (RingOutput's
        `state`): where the take is, the eased gains, the click, whether it
        plays, the loop, and the free click's and backing track's own."""
        with self._lock:
            free = tuple((f, f.keep()) if f is not None and hasattr(f, "keep") else None
                         for f in (self._free_click, self._free_backing))
            return (self._pos, tuple(t.current_gain for t in self.tracks), self._master_gain,
                    self._click_until, self._playing, self._finished, self._loop, free)

    def _ring_restore(self, state):
        with self._lock:
            (self._pos, gains, self._master_gain, self._click_until, self._playing,
             self._finished, self._loop, free) = state
            for track, gain in zip(self.tracks, gains):
                track.current_gain = gain
            # Put back only into the source that is still there: one put in
            # since starts where it is.
            for kept, now in zip(free, (self._free_click, self._free_backing)):
                if kept is not None and kept[0] is now:
                    now.put_back(kept[1])

    def _add_free(self, source, out, frame, now_ns, lead_sec):
        """
        The click or the backing track between takes, onto what the take put
        out: on its own outputs, at its own volume, outside the master and the
        meters. Outputs this stream does not reach are left out.
        """
        frames = len(out)
        block = self._free
        if block is None or block.shape[0] < frames or block.shape[1] != out.shape[1]:
            block = self._free = np.zeros((frames, out.shape[1]), dtype=np.float32)
        block = block[:frames]
        block.fill(0.0)
        source.render(block, frame, now_ns, lead_sec)
        for c in source.route:
            if c < out.shape[1]:
                column = out[:, c]
                column += block[:, c]
                np.clip(column, -1.0, 1.0, out=column)

    def _apply(self, edit):
        """A move of the take (Play, Pause, a seek, the loop): a block ahead
        of the card when it plays, at once when nothing does."""
        ring = self._ring
        if ring is not None:
            ring.move(edit)
        else:
            edit()

    def _changed(self):
        """A setting changed: what the card has not played yet is mixed again."""
        ring = self._ring
        if ring is not None:
            ring.change()

    def _heard_block(self):
        """What the screen shows of the block the card plays now, and the
        frame: (shown, frame), or (None, None) before the ring plays. Until
        the card has played up to the last move (a seek, Play), the block
        that move landed on: the playhead goes where it was sent at once."""
        ring = self._ring
        if ring is None:
            return None, None
        frame = ring.heard()
        if ring.action is not None and (frame is None or frame < ring.base):
            # Nothing of the ring heard yet: its first block is next.
            frame = ring.base
        if not ring.settled():
            landed = ring.landed
            if landed is not None and (frame is None or landed > frame):
                return ring.shown(landed), landed
        return ring.shown(frame), frame

    # ---------- transport ----------

    @property
    def playing(self):
        """Whether the take plays now: what the sending waits for
        (Api._sound_busy). Read without the lock, as one value."""
        return self._heard_playing()

    def _heard_playing(self):
        """Whether the take plays: as the last Play or Pause left it until
        the card has played that far, then as the card plays it."""
        ring = self._ring
        shown, _ = self._heard_block()
        if ring is None or shown is None:
            return self._playing
        meant = self._meant
        if meant is not None:
            if not ring.settled():
                return meant
            self._meant = None
        return shown[1]

    def skips(self):
        """
        What the listening since the last ask cost, and the count starts
        again: (seconds played, times the ring ran dry since, the least the
        ring held since in seconds or None). A ring that ran dry is what is
        heard as a skip; the least it held says how near it came.
        """
        self._fold(self._ring)
        with self._lock:
            least = None if self._least_frames is None else self._least_frames / self.samplerate
            out = (self._heard / self.samplerate, self._dry_since, least)
            self._heard = 0
            self._dry_since = 0
            self._least_frames = None
        return out

    def _fold(self, ring):
        """`ring`'s counts since the last look, added to what skips() says
        next."""
        if ring is None:
            return
        dry = ring.counts["ran_dry"]
        lowest, ring.counts["lowest_reserve_frames"] = ring.counts["lowest_reserve_frames"], None
        with self._lock:
            self._dry_since += max(0, dry - self._dry_told)
            self._dry_told = dry
            if lowest is not None and (self._least_frames is None or lowest < self._least_frames):
                self._least_frames = lowest

    def _play(self):
        with self._lock:
            if self._pos >= self.total_frames:
                self._pos = 0
            self._finished = False
            self._playing = True

    def _pause(self):
        with self._lock:
            self._playing = False

    def play(self):
        self._meant = True
        self._apply(self._play)

    def pause(self):
        self._meant = False
        self._apply(self._pause)

    def toggle(self):
        playing = self._heard_playing()
        if playing:
            self.pause()
        else:
            self.play()

    def seek(self, seconds):
        def edit():
            with self._lock:
                frame = int(max(0.0, seconds) * self.samplerate)
                self._pos = min(frame, self.total_frames)
                self._finished = False
        self._apply(edit)

    def set_loop(self, start_sec, end_sec):
        loop = None
        if start_sec is not None and end_sec is not None:
            a = int(max(0.0, start_sec) * self.samplerate)
            b = int(min(end_sec, self.total_frames / self.samplerate) * self.samplerate)
            if b - a >= int(0.2 * self.samplerate):
                loop = (a, b)
        # What the screen shows at once; the card hears it from a block on.
        self._loop_asked = loop

        def edit():
            with self._lock:
                self._loop = loop
                if loop is not None and not (loop[0] <= self._pos < loop[1]):
                    self._pos = loop[0]
        self._apply(edit)

    # ---------- mix ----------

    def set_volume(self, name, volume):
        with self._lock:
            for t in self.tracks:
                if t.name == name:
                    t.volume = float(min(1.0, max(0.0, volume)))
        self._changed()

    # M and S on one track take each other off, so both are never lit and
    # what plays is what the buttons show.

    def set_muted(self, name, muted):
        with self._lock:
            for t in self.tracks:
                if t.name == name:
                    t.muted = bool(muted)
            if muted and self._soloed == name:
                self._soloed = None
        self._changed()

    def set_solo(self, name):
        with self._lock:
            self._soloed = name
            for t in self.tracks:
                if t.name == name:
                    t.muted = False
        self._changed()

    def set_master_muted(self, muted):
        with self._lock:
            self.master_muted = bool(muted)
            if self.master_muted and not self._playing:
                self._master_gain = 0.0
        self._changed()

    def set_master(self, volume):
        with self._lock:
            self.master = float(min(1.0, max(0.0, volume)))
        self._changed()

    # ---------- the click ----------

    @property
    def route(self):
        """The outputs the take comes out of, counted from 0."""
        return self._route

    def holds(self, device_index):
        """Whether this player's stream is open on `device_index` (None: the
        system's), so a click there rides it."""
        return self._stream is not None and self.output_device == device_index

    def play_free_click(self, source):
        """The click between takes into this stream, on its route; None
        takes it out."""
        old, self._free_click = self._free_click, source
        self._swapped(old, source)

    def _swapped(self, old, new):
        """A source between takes put in or taken out. Put in, it is mixed in
        from a block ahead of the card, and told to say when it changes. One
        taken out that has played all it will is heard out from the ring (a
        bar for a setting, its last clicks); one taken out before that (■)
        is mixed out from a block ahead of the card."""
        tell = self._changed
        if old is not None and getattr(old, "changed", None) == tell:
            old.changed = None
        if new is not None and hasattr(new, "keep"):
            new.changed = tell
        if new is None and old is not None and getattr(old, "done", False):
            return
        self._changed()

    @property
    def free_click(self):
        """The click between takes this stream plays, None for none: closing
        the output lets go of it."""
        return self._free_click

    def play_free_backing(self, source):
        """A song's backing track between takes (a BackingSource) into this
        stream, on its route; None takes it out."""
        old, self._free_backing = self._free_backing, source
        self._swapped(old, source)

    @property
    def free_backing(self):
        """The backing track this stream plays between takes, None for none:
        closing the output lets go of it, as of the click."""
        return self._free_backing

    def set_take_click(self, tempo, signature, voices):
        """The take's click (Part 8): its tempo and signature, and `voices`
        at this take's rate and the metronome's volume; None for a take that
        was not recorded to the click."""
        with self._lock:
            self._take_click = None if voices is None or not tempo else (tempo, signature, voices)
            self._click_until = None
        self._changed()

    def set_click_on(self, on):
        """Master's metronome button: whether the take's click is heard."""
        with self._lock:
            self._click_on = bool(on)
            self._click_until = None
        self._changed()

    # ---------- state ----------

    def state(self):
        self._check_output()
        playing = self._heard_playing()
        shown, frame = self._heard_block()
        with self._lock:
            if shown is None:
                # No ring playing (no output open): the mixing's own.
                pos, levels = self._pos, [t.levels for t in self.tracks]
                master_level, finished = self.master_level, self._finished
            else:
                place, was, master_level, levels, finished = shown
                pos = min(place + frame % BLOCK, self.total_frames) if was else place
            return {
                "problem": self.problem,
                "playing": playing,
                "position": pos / self.samplerate,
                "duration": self.total_frames / self.samplerate,
                # A Play pressed after the end is not the end any more.
                "finished": bool(finished) and not playing,
                # 0..1 per channel of each track, as it came out of the block
                # the card plays now. The interface polls this several times a
                # second, which is what the meters beside the faders are made
                # of. A list even for a mono track, so one shape serves both.
                #
                # Nothing while paused, straight away: a pause answers before
                # the card has played up to it, and is the last thing the
                # interface asks until play, so the meters would stand still
                # at the last level.
                "levels": {
                    t.name: [
                        round(min(1.0, v / 32768.0), 3) if playing else 0.0
                        for v in kept
                    ]
                    for t, kept in zip(self.tracks, levels)
                },
                "master_level": (
                    round(min(1.0, master_level / 32768.0), 3)
                    if playing else 0.0
                ),
                "loop": (
                    {
                        "a": self._loop_asked[0] / self.samplerate,
                        "b": self._loop_asked[1] / self.samplerate,
                    }
                    if self._loop_asked
                    else None
                ),
                "soloed": self._soloed,
                "muted": [t.name for t in self.tracks if t.muted],
                "volumes": {t.name: t.volume for t in self.tracks},
                "master": self.master,
                "master_muted": self.master_muted,
                "click": self._click_on,
            }

    def close_output(self):
        """
        Closes just the stream, keeping the take loaded — this is what
        switching the playback device needs.

        The reference is taken out first and under the lock: two closes can
        arrive at once (the interface closing a player while a device change
        reopens it), and the old code could pass its `is not None` check and
        then find the stream gone, which is where
        "'NoneType' object has no attribute 'close'" came from.
        """
        ring, self._ring = self._ring, None
        if ring is not None:
            ring.stop()
            self._fold(ring)
        self._meant = None
        self._heartbeat.stop()
        self._free_click = None
        self._free_backing = None
        with STREAM_LOCK:
            stream, self._stream = self._stream, None
            if stream is None:
                return
            try:
                close_stream(stream)
            except Exception as e:
                print(f"[player] close: {e}")

    def close(self):
        """Closes the stream and lets go of the audio."""
        self.close_output()
        with self._lock:
            for t in self.tracks:
                t.data = None
            self.tracks = []
