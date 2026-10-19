"""
The metronome (metronome spec, Parts 2, 3, 5 and 6): the row's tempo and
signature, the click between takes, the bar a setting plays, its settings,
and what the screen is told.

The row follows the next take's name (Part 2). A name that leads to a song
puts the song's tempo in the row, or empties it for a song without one; an
empty name or "Take N" empties it. A change made in the row is held until
the name leads somewhere else: a keystroke in the same song's name keeps it.
A free take and a title no song has yet are both "no song", so a tempo set
for one holds through the other.

The click between takes (▶) and a bar played for a setting go where the
click's output is: into the player's stream when the player holds that
device, else a stream of their own (audio/click_output.py), or nowhere when
the device is not plugged in, still counted so the beat flashes. A take's
click is made here (`take_click`) and played by the recorder.

The settings live in the app's config, saved through the function the app
saves it with: there is no file of the metronome's own.

`state` is polled; it never waits for a stream to open or close. One lock
keeps the row, held only for a few assignments; another keeps the click's
streams, so ▶, Stop and a bar's end never open and close at once.
"""

import collections
import threading
import time

import sounddevice as sd

from rehearsal_recorder.audio.click import SIGNATURES, SOUNDS, Voices, per_bar, tempo_range
from rehearsal_recorder.audio.click_output import ClickOutput, SilentOutput
from rehearsal_recorder.audio.click_source import ClickSource
from rehearsal_recorder.audio.take_click import TakeClick
from rehearsal_recorder.store.names import UNNAMED_TAKE

DEFAULTS = {"click_sound": "click", "click_volume": 0.7, "count_in_bars": 1,
            "tempo_in_wav": True, "metronome_on": True}

# The bar a setting plays when the row has no tempo.
PREVIEW_TEMPO = 120

# A bar played for a setting is let go this long after its last click, if
# nothing asked for the state in between.
PREVIEW_SLACK_SEC = 1.0

# How far ahead the screen is told of the clicks.
UPCOMING_SEC = 1.5

# The click between takes: its source, "player" or "own", the player or
# output it plays in, and whether the screen shows it (▶) or not (a bar
# played for a setting).
_Free = collections.namedtuple("_Free", "source kind sink shown")


def _whole(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _channels(value):
    """Outputs as the card labels them, a pair such as (3, 4) or one on its
    own; None for none."""
    if value is None:
        return None
    if (isinstance(value, (list, tuple)) and len(value) in (1, 2)
            and all(_whole(c) and c >= 1 for c in value)
            and (len(value) == 1 or value[1] == value[0] + 1)):
        return list(value)
    raise ValueError("The click's outputs are a pair, such as 3-4, or one output")


def _checked(key, value):
    """A setting's value as it is kept, or ValueError saying why not."""
    if key == "click_sound":
        if value not in SOUNDS:
            raise ValueError("The sound is Click, Woodblock or Hi-hat")
        return value
    if key == "click_volume":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
            raise ValueError("The volume is from 0 to 1")
        return float(value)
    if key == "count_in_bars":
        if not _whole(value) or value not in (0, 1, 2):
            raise ValueError("The count-in is none, 1 bar or 2 bars")
        return value
    if key in ("tempo_in_wav", "metronome_on"):
        if not isinstance(value, bool):
            raise ValueError("This setting is on or off")
        return value
    if key == "click_channels":
        return _channels(value)
    raise ValueError(f"No metronome setting is called {key}")


def _outputs(index):
    """How many outputs a device has; 0 when it says nothing."""
    try:
        return int(sd.query_devices(index).get("max_output_channels", 0))
    except Exception:
        return 0


def _refused(error):
    return {"ok": False, "error": error}


class Metronome:
    """
    `config` is the app's settings and `write_config()` saves them.
    `player_getter()` is the open TakePlayer or None. `device_lookup(key)` is
    the index a saved device means now ("click_device", "output_device"), None
    when it is not plugged in or none is saved. `library` gives a name's song
    (Library.tempo_for, set_song_tempo); None for none.
    """

    def __init__(self, config, write_config, player_getter, device_lookup, library):
        self._config = config
        self._write_config = write_config
        self._player = player_getter
        self._lookup = device_lookup
        self._library = library
        self._lock = threading.Lock()
        self._sinks = threading.Lock()
        # The row: what the name leads to (a song's id, None for no song),
        # the song and its newest take, whether the name is a free take's,
        # and the tempo and signature shown.
        self._key = None
        self._song = None
        self._last_take = None
        self._free_name = True
        self._tempo = None
        self._signature = "4/4"
        # (tempo, signature, TakeClick or None) while a take records.
        self._take = None
        self._free = None

    # ---------- settings ----------

    def _setting(self, key):
        """A setting as saved, or its default for one missing or not one of its values."""
        try:
            return _checked(key, self._config.get(key, DEFAULTS[key]))
        except ValueError:
            return DEFAULTS[key]

    def _click_channels(self):
        try:
            return _channels(self._config.get("click_channels"))
        except ValueError:
            return None

    def settings(self):
        """The settings, for Settings and the gear."""
        return {"click_device_index": self._lookup("click_device"),
                "click_channels": self._click_channels(),
                **{key: self._setting(key) for key in DEFAULTS}}

    def set_setting(self, key, value):
        """Checks one setting and saves it. A new sound or volume is heard from
        the next click of one running; the switch is set_on's."""
        try:
            value = _checked(key, value)
        except ValueError as e:
            return _refused(str(e))
        self._config[key] = value
        self._write_config()
        if key in ("click_sound", "click_volume"):
            free = self._free
            if free is not None:
                free.source.set_voices(self._voices(free.source.samplerate))
        if key == "metronome_on":
            take = self._take
            if take is not None and take[2] is not None:
                take[2].set_on(value)
        return {"ok": True}

    def set_on(self, on):
        """The row's switch: whether Record clicks. During a take it silences
        the click and brings it back on the beat."""
        return self.set_setting("metronome_on", on)

    def _voices(self, samplerate, sound=None):
        return Voices(sound or self._setting("click_sound"), samplerate, self._setting("click_volume"))

    # ---------- the row ----------

    def follow(self, name):
        """The next take's name is now `name`: the row takes what goes with it."""
        name = (name or "").strip()
        free = not name or bool(UNNAMED_TAKE.match(name))
        found = None
        if not free and self._library is not None:
            found = self._library.tempo_for(name)
        song = (found or {}).get("song")
        with self._lock:
            self._free_name = free
            self._song = song
            self._last_take = (found or {}).get("last_take")
            key = None if song is None else song["id"]
            if key == self._key:
                return
            self._key = key
            self._tempo = None if song is None else song["tempo"]
            self._signature = (song or {}).get("signature") or "4/4"
        self._row_changed()

    def set(self, tempo, signature):
        """A change in the row, held until the name leads somewhere else.
        `tempo` None empties the row."""
        if signature not in SIGNATURES:
            return _refused("The time signature is one of 4/4, 3/4, 2/4 and 6/8")
        if tempo is not None:
            low, high = tempo_range(signature)
            if not _whole(tempo) or not low <= tempo <= high:
                return _refused(f"A tempo in {signature} is a whole number from {low} to {high}")
        with self._lock:
            if self._take is not None:
                return _refused("The tempo cannot change during a take")
            self._tempo, self._signature = tempo, signature
        self._row_changed()
        return {"ok": True}

    def save_to_song(self):
        """Gives the song the name leads to the row's tempo and signature."""
        with self._lock:
            song, tempo, signature = self._song, self._tempo, self._signature
        if song is None:
            return _refused("No song to save the tempo to: the next take's name is not one")
        if tempo is None or self._library is None:
            return _refused("No tempo to save")
        saved = self._library.set_song_tempo(song["id"], tempo, signature)
        if saved is None:
            return _refused("That song is no longer in the library")
        with self._lock:
            if self._key == song["id"]:
                self._song = saved
        return {"ok": True, "song": saved}

    def take_meter(self):
        """What Record takes: (tempo or None, signature, whether it clicks)."""
        with self._lock:
            tempo, signature = self._tempo, self._signature
        return tempo, signature, self._setting("metronome_on")

    def _held(self):
        song = self._song
        if song is None:
            return False
        row = (self._tempo, None if self._tempo is None else self._signature)
        return row != (song["tempo"], song["signature"])

    def _case(self):
        if self._free_name:
            return "free"
        song = self._song
        return "song" if song is not None and song["tempo"] is not None else "song_without"

    def _row_changed(self):
        """A ▶ click follows the row: retimed from its next click, or stopped
        when the row is emptied."""
        free = self._free
        if free is None or not free.shown:
            return
        with self._lock:
            tempo, signature = self._tempo, self._signature
        if tempo is None:
            self.stop()
        else:
            free.source.retime(tempo, signature)

    # ---------- where the click goes ----------

    def _saved(self):
        """Whether a click device is saved: until one is, the click goes where
        the player plays."""
        return self._config.get("click_device") is not None or self._config.get("click_device_index") is not None

    def _target(self):
        """
        (the device the click goes to, its outputs as the card counts them or
        None for none of its own, the name of a saved device that is not
        plugged in or None). With no click device saved: the player's device
        and outputs.
        """
        if not self._saved():
            try:
                channels = _channels(self._config.get("output_channels"))
            except ValueError:
                channels = None
            return self._lookup("output_device"), channels, None
        index = self._lookup("click_device")
        if index is None:
            identity = self._config.get("click_device")
            name = identity.get("name") if isinstance(identity, dict) else None
            return None, None, name or "the click's output"
        return index, self._click_channels(), None

    def extra_channels(self, device_index):
        """The click's outputs, when its device is `device_index`: the player
        opening there opens its stream wide enough for them."""
        index = self._lookup("click_device")
        if index is None or index != device_index:
            return ()
        return tuple(self._click_channels() or ())

    def _sink(self):
        """("player", the player, route) or ("own", an output, route)."""
        device, channels, missing = self._target()
        if missing is not None:
            silent = SilentOutput(missing)
            return "own", silent, silent.route
        player = self._player()
        if player is not None and player.holds(device):
            # The player's own outputs, as it opened them, unless the click
            # has outputs of its own there.
            own = channels is not None and self._saved()
            return "player", player, tuple(c - 1 for c in channels) if own else player.route
        output = ClickOutput(device, channels or (1, 2))
        return "own", output, output.route

    def click_sink(self):
        """Where the click between takes plays: ("player", the TakePlayer)
        when the player holds the click's device, else ("own", its output)."""
        kind, sink, _ = self._sink()
        return kind, sink

    def take_click(self, device_index, samplerate):
        """
        The click for a take recorded from `device_index` at `samplerate`, or
        None for a take without one (no tempo, or the switch off). On the
        recording card it rides the take's stream; elsewhere it has its own,
        or none when its device is not plugged in, and the take keeps its grid.
        """
        tempo, signature, on = self.take_meter()
        if tempo is None or not on:
            return None
        device, channels, missing = self._target()
        output, route = None, None
        if missing is not None:
            output = SilentOutput(missing, samplerate=int(samplerate))
        elif device is not None and device == device_index:
            outputs = _outputs(device)
            channels = channels or [1, 2]
            if max(channels) > outputs:
                channels = [1, 2] if outputs >= 2 else [1]
            if outputs < 1:
                # A card that says it has none: the take records as it would,
                # its click to no output, rather than not at all.
                output = SilentOutput("the recording card", "It has no outputs to click on.", int(samplerate))
            else:
                route = tuple(c - 1 for c in channels)
        else:
            output = ClickOutput(device, channels or (1, 2))
        return TakeClick(tempo, signature, self._setting("count_in_bars"),
                         self._voices(int(samplerate)), route or output.route,
                         wav_tempo=self._setting("tempo_in_wav"), output=output, samplerate=samplerate)

    # ---------- a take ----------

    def begin_take(self, tempo, signature, click=None):
        """A take records at `tempo` (None for none) with `click` (its
        TakeClick, or None). The click between takes stops first."""
        self.stop()
        with self._lock:
            self._take = (tempo, signature, click)

    def end_take(self):
        with self._lock:
            self._take = None

    # ---------- the click between takes ----------

    def play(self):
        """▶: the click at the row's tempo, until Stop, Record or the row is emptied."""
        with self._lock:
            if self._take is not None:
                return _refused("The take has its own click")
            tempo, signature = self._tempo, self._signature
        if tempo is None:
            return _refused("No tempo to play: type or tap one")
        self._start(tempo, signature, shown=True)
        return {"ok": True}

    def preview(self, bars=1, sound=None):
        """A bar or two of the click, for a setting: at the row's tempo, or
        120 with none, in `sound` or the one set. Not shown on the screen."""
        if sound is not None and sound not in SOUNDS:
            return _refused("The sound is Click, Woodblock or Hi-hat")
        if not _whole(bars) or bars < 1:
            return _refused("A preview is a bar or more")
        with self._lock:
            if self._take is not None:
                return _refused("Not during a take")
            tempo, signature = self._tempo, self._signature
        if tempo is None:
            tempo = PREVIEW_TEMPO
        free = self._start(tempo, signature, shown=False, bars=bars, sound=sound)
        timer = threading.Timer(bars * per_bar(signature) * 60 / tempo + PREVIEW_SLACK_SEC,
                                self._reap, args=(free,))
        timer.daemon = True
        timer.start()
        return {"ok": True}

    def _start(self, tempo, signature, shown, bars=None, sound=None, start_k=0):
        with self._sinks:
            self._stop_free()
            kind, sink, route = self._sink()
            source = ClickSource(tempo, signature, self._voices(sink.samplerate, sound), route,
                                 bars=bars, start_k=start_k)
            if kind == "player":
                sink.play_free_click(source)
            else:
                try:
                    sink.start(source)
                except Exception:
                    # Counted by the computer's clock instead, so the beat
                    # still flashes and the screen says why nothing is heard.
                    sink = SilentOutput(sink.name, sink.problem())
                    sink.start(source)
            free = _Free(source, kind, sink, shown)
            with self._lock:
                self._free = free
        return free

    def stop(self):
        """■: the click between takes stops."""
        with self._sinks:
            self._stop_free()
        return {"ok": True}

    def _stop_free(self):
        """Lets go of the click between takes. With `_sinks` held."""
        with self._lock:
            free, self._free = self._free, None
        if free is None:
            return
        if free.kind == "player":
            free.sink.play_free_click(None)
        else:
            free.sink.stop()

    def _reap(self, free, wait=True):
        """A bar played for a setting is over: let it go, unless something else
        has taken its place."""
        if not self._sinks.acquire(blocking=wait):
            return
        try:
            if self._free is free:
                self._stop_free()
        finally:
            self._sinks.release()

    def resink(self):
        """The player opened or closed: a ▶ click goes on in the stream that
        now has its device, in its place in the bar; a bar for a setting stops."""
        free = self._free
        if free is None:
            return
        if not free.shown:
            self._reap(free)
            return
        kind, sink, route = self._sink()
        if kind == free.kind and route == free.source.route and (
                sink is free.sink if kind == "player"
                else type(sink) is type(free.sink) and sink.device_index == free.sink.device_index):
            return
        source = free.source
        self._start(source.tempo, source.signature, shown=True, start_k=source.next_in_bar)

    def close(self):
        """The app is closing."""
        self.stop()

    # ---------- for the screen ----------

    def output_problem(self):
        """The click's output's name when it cannot play, else None."""
        take = self._take
        if take is not None:
            click = take[2]
            if click is not None and click.problem() is not None:
                return click.output.name
            return None
        missing = self._target()[2]
        if missing is not None:
            return missing
        free = self._free
        if free is not None and free.kind == "own" and free.sink.problem() is not None:
            return free.sink.name
        return None

    def state(self):
        """The metronome_state shape (see the plan's common rules)."""
        now = time.perf_counter_ns()
        free = self._free
        if free is not None:
            if isinstance(free.sink, SilentOutput):
                free.sink.pump(now)
            # A bar for a setting, played: let go of here unless that closes a
            # stream, which its timer does.
            if free.source.done and not isinstance(free.sink, ClickOutput):
                self._reap(free, wait=False)
                free = self._free
        on = self._setting("metronome_on")
        with self._lock:
            take = self._take
            tempo, signature = self._tempo, self._signature
            row = {"on": on, "case": self._case(), "song": self._song, "held": self._held(),
                   "last_take": self._last_take}
        phase, upcoming, count, since = "idle", [], 0, None
        if take is not None:
            tempo, signature, click = take
            phase = "take"
            if click is not None:
                count, since = click.count_state(now)
                if since is None or since < 0:
                    phase = "count"
                if on:
                    upcoming = click.upcoming(now, UPCOMING_SEC)
        elif free is not None and free.shown:
            phase = "preview"
            upcoming = free.source.upcoming(now, UPCOMING_SEC)
        return {"phase": phase, "tempo": tempo, "signature": signature, "per_bar": per_bar(signature),
                **row, "upcoming": upcoming, "count": count, "since_count_in_ms": since,
                "output_missing": self.output_problem()}
