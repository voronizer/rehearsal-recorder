"""
The metronome (metronome spec, Parts 2, 3, 5 and 6): the row's tempo and
signature, the click between takes, the bar a setting plays, its settings,
and what the screen is told.

The row follows the next take's name (Part 2). A name that leads to a song
puts the song's tempo in the row, or empties it for a song without one; an
empty name or "Take N" empties it. A change made in the row is held until
the name leads somewhere else: a keystroke in the same song's name keeps it.
A row not held follows its song's tempo when the song is given one. An
emptied row is not held: there is nothing to save, and a song's tempo is taken
away on its page.
A free take and a title no song has yet are both "no song", so a tempo set
for one holds through the other.

The click between takes (▶) plays the row's tempo, and follows it; a song's
page has a ▶ of its own, at the tempo it asks for, which leaves the row as
it is. That click and a bar played for a setting go where the click's output
is: into the player's stream when the player holds that device, else a
stream of their own (audio/click_output.py), or nowhere when the device is
not plugged in, still counted so the beat flashes. A take's click is made
here (`take_click`) and played by the recorder.

The settings live in the app's config, saved through the function the app
saves it with: there is no file of the metronome's own.

`state` is polled; it never waits for a stream to open or close, and never
asks PortAudio anything: where the click's output is comes from the device
list as last read, under the lock a rescan holds, and is read again at most
every DEVICES_FRESH_SEC there, or at once when the app asks for the click or
tells it the devices changed. One lock keeps the row, held only for a few
assignments; another keeps the click's streams, so ▶, Stop and a bar's end
never open and close at once.

The locks are taken in one order: `_sinks`, then the app's STREAM_LOCK, then
`_lock`. The click's own stream is opened and kept in `_free`, and taken out
of it and closed, in one hold of STREAM_LOCK, so a rescan (which holds
STREAM_LOCK while PortAudio is torn down and started again) finds it there
and lets it go (`let_go_for_rescan`), or comes before it is opened. Hence:

- play, preview, stop, resink, begin_take, close, and set and follow (which
  stop ▶ when the row empties) take `_sinks`: never call them with
  STREAM_LOCK held, for a play() on another thread holds `_sinks` and waits
  for STREAM_LOCK. let_go_for_rescan takes no `_sinks` and is the one to call
  inside a rescan's locks; state never waits for either.
- `device_lookup` and `player_getter` are called with STREAM_LOCK held, so
  they must never take the Api's `_player_lock`, which rescan_devices takes
  before STREAM_LOCK.
"""

import collections
import logging
import threading
import time

import sounddevice as sd

from rehearsal_recorder.audio.click import SIGNATURE_RULE, SIGNATURES, SOUNDS, Voices, per_bar, tempo_range
from rehearsal_recorder.audio.click_output import ClickOutput, SilentOutput
from rehearsal_recorder.audio.click_source import ClickSource
from rehearsal_recorder.audio.devices import STREAM_LOCK
from rehearsal_recorder.audio.take_click import TakeClick, whole
from rehearsal_recorder.store.names import UNNAMED_TAKE

log = logging.getLogger(__name__)

DEFAULTS = {"click_sound": "click", "click_volume": 0.7, "count_in_bars": 1,
            "tempo_in_wav": True, "metronome_on": True}

# The bar a setting plays when the row has no tempo.
PREVIEW_TEMPO = 120

# A bar played for a setting is let go this long after its last click, if
# nothing asked for the state in between.
PREVIEW_SLACK_SEC = 1.0

# How far ahead the screen is told of the clicks.
UPCOMING_SEC = 1.5

# How old the device list's word on the click's output may be when the screen
# asks: the list is read again no more often than this from a poll.
DEVICES_FRESH_SEC = 2.0

# The click between takes: its source, "player" or "own", the player or
# output it plays in, whether the screen shows it (▶) or not (a bar played
# for a setting), and whether it plays a tempo of its own (a song page's ▶)
# rather than the row's, which it then does not follow.
_Free = collections.namedtuple("_Free", "source kind sink shown fixed")


def _channels(value):
    """Outputs as the card labels them, a pair such as (3, 4) or one on its
    own; None for none."""
    if value is None:
        return None
    if (isinstance(value, (list, tuple)) and len(value) in (1, 2)
            and all(whole(c) and c >= 1 for c in value)
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
        if not whole(value) or value not in (0, 1, 2):
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
        with STREAM_LOCK:
            return int(sd.query_devices(index).get("max_output_channels", 0))
    except Exception:
        return 0


def _name(index):
    """A device's name; "" when it says none, and the screen says it without one."""
    try:
        with STREAM_LOCK:
            name = sd.query_devices(index).get("name")
    except Exception:
        return ""
    return name if isinstance(name, str) else ""


def _system_output():
    """The index of the system's output device, None when it says none. With
    STREAM_LOCK held."""
    try:
        info = sd.query_devices(kind="output")
    except Exception:
        return None
    index = info.get("index") if isinstance(info, dict) else None
    return index if whole(index) else None


def _refused(error):
    return {"ok": False, "error": error}


def _refusal(tempo, signature):
    """Why the metronome cannot take `tempo` in `signature`, or None: a
    signature not one of the four, or a tempo that is not a whole number in
    its range. `tempo` None passes, as an empty row."""
    if signature not in SIGNATURES:
        return _refused(SIGNATURE_RULE)
    if tempo is not None:
        low, high = tempo_range(signature)
        if not whole(tempo) or not low <= tempo <= high:
            return _refused(f"A tempo in {signature} is a whole number from {low} to {high}")
    return None


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
        # (when it was read, by time.monotonic(); the click device's index,
        # the player's output device's, the system output's), each None for
        # none, as the device list last said: see _devices.
        self._found = None

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
        return {"click_device_index": self._devices()[0],
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
                free.source.set_voices(self.voices(free.source.samplerate))
        if key == "metronome_on":
            take = self._take
            if take is not None and take[2] is not None:
                take[2].set_on(value)
        return {"ok": True}

    def set_on(self, on):
        """The row's switch: whether Record clicks. During a take it silences
        the click and brings it back on the beat."""
        return self.set_setting("metronome_on", on)

    def voices(self, samplerate, sound=None):
        """The click's sounds at `samplerate`, in `sound` or the one set, at
        the volume set: for a take played back with its click too."""
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
            held = self._held()
            was = self._song
            self._free_name = free
            self._song = song
            self._last_take = (found or {}).get("last_take")
            key = None if song is None else song["id"]
            if key == self._key:
                # The same song, its tempo given since (its first click take
                # kept, or its page): a row not held takes it. A change held
                # in the row stays.
                if (song is None or held or was is None
                        or (song["tempo"], song["signature"]) == (was["tempo"], was["signature"])):
                    return
            self._key = key
            self._tempo = None if song is None else song["tempo"]
            self._signature = (song or {}).get("signature") or "4/4"
        self._row_changed()

    def set(self, tempo, signature):
        """A change in the row, held until the name leads somewhere else.
        `tempo` None empties the row."""
        refused = _refusal(tempo, signature)
        if refused is not None:
            return refused
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
        """Whether the row has a tempo of its own for the song: one that is
        not the song's, which Save to song saves."""
        song = self._song
        if song is None or self._tempo is None:
            return False
        return (self._tempo, self._signature) != (song["tempo"], song["signature"])

    def _case(self):
        if self._free_name:
            return "free"
        song = self._song
        return "song" if song is not None and song["tempo"] is not None else "song_without"

    def _row_changed(self):
        """A ▶ click follows the row: retimed from its next click, or stopped
        when the row is emptied."""
        free = self._free
        if free is None or not free.shown or free.fixed:
            return
        with self._lock:
            tempo, signature = self._tempo, self._signature
        if tempo is None:
            self.stop()
        else:
            free.source.retime(tempo, signature)

    # ---------- where the click goes ----------

    def _devices(self, wait=True):
        """
        (the click device's index, the player's output device's, the system
        output's), each None for none, as the device list says. Read under the
        lock a rescan holds while it rebuilds the list. With `wait`, read now;
        without, as last read, and read again when older than
        DEVICES_FRESH_SEC unless the lock is busy; None if never read.
        """
        found = self._found
        if not wait and found is not None and time.monotonic() - found[0] < DEVICES_FRESH_SEC:
            return found[1]
        if not STREAM_LOCK.acquire(blocking=wait):
            return None if found is None else found[1]
        try:
            read = (self._lookup("click_device"), self._lookup("output_device"), _system_output())
        finally:
            STREAM_LOCK.release()
        self._found = (time.monotonic(), read)
        return read

    def devices_changed(self):
        """The device list was rebuilt (a rescan), or the click's device or
        the player's chosen: where they are is read again. Only their indices
        are kept; their outputs and identities are read from the settings
        each time."""
        self._devices()

    def _saved(self):
        """Whether a click device is saved: until one is, the click goes where
        the player plays."""
        return self._config.get("click_device") is not None or self._config.get("click_device_index") is not None

    def _target(self, wait=True):
        """
        (the device the click goes to, its outputs as the card counts them or
        None for none of its own, the name of a saved device that is not
        plugged in ("" for one with no name) or None). With no click device
        saved: the player's device and outputs. `wait` as in _devices;
        (None, None, None) while the device list has not been read.
        """
        found = self._devices(wait)
        if found is None:
            return None, None, None
        index, output_index, _ = found
        if not self._saved():
            try:
                channels = _channels(self._config.get("output_channels"))
            except ValueError:
                channels = None
            return output_index, channels, None
        if index is None:
            # "" when it was saved with no name: the screen says it without one.
            identity = self._config.get("click_device")
            name = identity.get("name") if isinstance(identity, dict) else None
            return None, None, name if isinstance(name, str) else ""
        return index, self._click_channels(), None

    def extra_channels(self, device_index):
        """The click's outputs, when its device is `device_index`: the player
        opening there opens its stream wide enough for them."""
        index = self._devices()[0]
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
        # The system output is a device too: when it is the recording card,
        # the click rides the take's stream there as well.
        here = device if device is not None else self._devices(wait=False)[2]
        output, route = None, None
        if missing is not None:
            output = SilentOutput(missing, samplerate=int(samplerate))
        elif here is not None and here == device_index:
            outputs = _outputs(here)
            channels = channels or [1, 2]
            if max(channels) > outputs:
                channels = [1, 2] if outputs >= 2 else [1]
            if outputs < 1:
                # A card that says it has none: the take records as it would,
                # its click to no output, rather than not at all.
                output = SilentOutput(_name(here), "It has no outputs to click on.", int(samplerate))
            else:
                route = tuple(c - 1 for c in channels)
        else:
            output = ClickOutput(device, channels or (1, 2))
        return TakeClick(tempo, signature, self._setting("count_in_bars"),
                         self.voices(int(samplerate)), route or output.route,
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

    def play(self, tempo=None, signature=None):
        """▶: the click at the row's tempo, until Stop, Record or the row is
        emptied. With a `tempo`, a song page's ▶: the click at that tempo and
        `signature`, until Stop or Record, and the row left as it is."""
        with self._lock:
            if self._take is not None:
                return _refused("The take has its own click")
            fixed = tempo is not None
            if not fixed:
                tempo, signature = self._tempo, self._signature
        if fixed:
            refused = _refusal(tempo, signature)
            if refused is not None:
                return refused
        elif tempo is None:
            return _refused("No tempo to play: type or tap one")
        with self._sinks:
            free = self._free
            if fixed and free is not None and free.shown and free.fixed:
                # A change on the song's page while its click plays: on from
                # the next click, as the row's ▶ follows the row, not from a
                # bar's first.
                free.source.retime(tempo, signature)
            else:
                self._start_held(tempo, signature, shown=True, fixed=fixed)
        return {"ok": True}

    def preview(self, bars=1, sound=None):
        """A bar or two of the click, for a setting: at the row's tempo, or
        120 with none, in `sound` or the one set. Not shown on the screen."""
        if sound is not None and sound not in SOUNDS:
            return _refused("The sound is Click, Woodblock or Hi-hat")
        if not whole(bars) or bars < 1:
            return _refused("A preview is a bar or more")
        with self._lock:
            if self._take is not None:
                return _refused("Not during a take")
            tempo, signature = self._tempo, self._signature
        if tempo is None:
            tempo = PREVIEW_TEMPO
        with self._sinks:
            if self._free is not None and self._free.shown:
                # ▶ plays: that is the bar to hear, in the sound and at the
                # volume set_setting has just given it. A bar here would stop it.
                return {"ok": True}
            free = self._start_held(tempo, signature, shown=False, bars=bars, sound=sound)
        timer = threading.Timer(bars * per_bar(signature) * 60 / tempo + PREVIEW_SLACK_SEC,
                                self._reap, args=(free,))
        timer.daemon = True
        timer.start()
        return {"ok": True}

    def _start_held(self, tempo, signature, shown, bars=None, sound=None, start_k=0, fixed=False):
        """A click between takes in place of the one there was, with `_sinks`
        held: shown (▶) or a bar for a setting, `bars` long or until Stop,
        from click `start_k` of its bar."""
        # Where it goes, its stream opened and kept in _free, in one hold
        # of STREAM_LOCK: see the module's note on the locks.
        with STREAM_LOCK:
            self._stop_free()
            kind, sink, route = self._sink()
            source = ClickSource(tempo, signature, self.voices(sink.samplerate, sound), route,
                                 bars=bars, start_k=start_k)
            if kind == "player":
                sink.play_free_click(source)
            else:
                try:
                    sink.start(source)
                except Exception:
                    # Counted by the computer's clock instead, at the rate
                    # the source was made for, so the beat still flashes
                    # on time and the screen says why nothing is heard.
                    sink = SilentOutput(sink.name, sink.problem(), sink.samplerate)
                    sink.start(source)
            free = _Free(source, kind, sink, shown, fixed)
            with self._lock:
                self._free = free
        return free

    def stop(self):
        """■: the click between takes stops."""
        with self._sinks:
            self._stop_free()
        return {"ok": True}

    def let_go_for_rescan(self):
        """
        For a rescan, called inside its locks (the Api's _player_lock and
        STREAM_LOCK): the click between takes stops, its own stream closed
        before PortAudio is torn down. It takes no `_sinks`, so a play() on
        another thread, waiting for STREAM_LOCK, cannot hold it up; that
        play() opens its stream once the rescan is over.
        """
        self._stop_free()

    def _stop_free(self):
        """Lets go of the click between takes: taken out of _free and its
        stream closed in one hold of STREAM_LOCK."""
        with STREAM_LOCK:
            with self._lock:
                free, self._free = self._free, None
            if free is None:
                return
            if free.kind == "player":
                free.sink.play_free_click(None)
            else:
                free.sink.stop()
        if free.source.fault is not None:
            log.error("The click between takes failed and went quiet: %s", free.source.fault)

    def _reap(self, free, wait=True):
        """A bar played for a setting is over: let it go, unless something else
        has taken its place. Without `wait`, not now if either lock is busy."""
        if not self._sinks.acquire(blocking=wait):
            return
        try:
            if not STREAM_LOCK.acquire(blocking=wait):
                return
            try:
                if self._free is free:
                    self._stop_free()
            finally:
                STREAM_LOCK.release()
        finally:
            self._sinks.release()

    def resink(self):
        """The player opened or closed: a ▶ click goes on in the stream that
        now has its device, in its place in the bar; a bar for a setting stops."""
        self.devices_changed()
        # Looked at and moved in one hold of both locks, so a ■, a take or a
        # rescan in between cannot be undone by bringing the click back.
        with self._sinks, STREAM_LOCK:
            with self._lock:
                free, taking = self._free, self._take is not None
            if free is None or taking:
                return
            if not free.shown:
                self._stop_free()
                return
            kind, sink, route = self._sink()
            # The same player still playing it, or a stream of its own on the
            # same device: nothing to move. A player that closed and opened its
            # output again has let go of it.
            if kind == free.kind and route == free.source.route and (
                    sink is free.sink and sink.free_click is free.source if kind == "player"
                    else type(sink) is type(free.sink) and sink.device_index == free.sink.device_index):
                return
            source = free.source
            self._start_held(source.tempo, source.signature, shown=True, start_k=source.next_in_bar,
                             fixed=free.fixed)

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
        missing = self._target(wait=False)[2]
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
            if free.fixed:
                # A song page's ▶: the tempo heard, the row's left as it is.
                tempo, signature = free.source.tempo, free.source.signature
            upcoming = free.source.upcoming(now, UPCOMING_SEC)
        return {"phase": phase, "tempo": tempo, "signature": signature, "per_bar": per_bar(signature),
                **row, "upcoming": upcoming, "count": count, "since_count_in_ms": since,
                "output_missing": self.output_problem()}
