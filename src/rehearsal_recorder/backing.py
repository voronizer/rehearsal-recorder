"""
A song's backing track around its takes (backing-track spec, Parts 1, 3, 5,
6 and 8): giving a song one and taking it away, where bar 1 is and what tempo
it was counted at, its settings, what the row is told, ▶ between takes and
two seconds of it for Settings, and the TakeBacking a take plays
(audio/take_click.py).

A song's file is the app's own copy in the Backing tracks folder. What plays
is that copy made ready at the rate the app records at (audio/backing_file),
a cache: made when the file is added, and made again on a thread of its own
when the next take's song has none at the rate its take will record at (the
rate was changed, or the file deleted). The row says so meanwhile, and Record
records without it. When the backing track is heard on another device with a
rate of its own, a ready file at that rate is made too, and the take plays it
as it is.

Where it is heard follows the click's rules (metronome.py `output_target` and
`take_output`): its own device and outputs once one is saved, else where the
player plays; in a take on the recording card it rides the take's stream;
between takes it rides the player's stream when the player holds its device,
else a stream of its own. A song page's ▶ plays the click from bar 1 beside
it, in the same stream when both go to one device.

The locks are the metronome's, in its order: `_sinks`, then STREAM_LOCK, then
`_lock`. `state` is polled and never waits for either. play, preview, stop,
resink, follow, begin_take and close take `_sinks`; make_room and
let_go_for_rescan, called inside the player's and a rescan's locks, do not.
"""

import collections
import glob
import itertools
import logging
import math
import queue
import threading
import time
from pathlib import Path

from rehearsal_recorder.audio import backing_count, backing_file
from rehearsal_recorder.audio.backing_source import FADE_SEC, BackingSource, Sources
from rehearsal_recorder.audio.click import click_frame, tempo_range
from rehearsal_recorder.audio.click_output import ClickOutput, SilentOutput
from rehearsal_recorder.audio.click_source import ClickSource
from rehearsal_recorder.audio.devices import STREAM_LOCK
from rehearsal_recorder.audio.player import channel_label
from rehearsal_recorder.audio.take_click import TakeBacking, whole
from rehearsal_recorder.metronome import _channels, output_target, take_output
from rehearsal_recorder.store.library import SongRefused

log = logging.getLogger(__name__)

DEFAULTS = {"backing_volume": 0.8, "backing_on": True, "backing_row": False}

# How long Settings plays of it when its output is picked.
PREVIEW_SEC = 2.0

# Silence before the file when ▶ plays the click beside it: time for both
# streams to be running before bar 1's click is due.
WITH_CLICK_LEAD_SEC = 0.2

# A ▶ that has played to the file's end is let go of this long after.
END_SLACK_SEC = 1.0

MISSING = "{name} is missing from the Backing tracks folder."
DURING_TAKE = "Not during a take"
NONE = "That song has no backing track"

# ▶ or two seconds for Settings: the backing track's source, whether the row
# shows it (▶), the song's id, the (kind, sink) it plays in: ("player", the
# TakePlayer) or ("own", an output), one for each stream; and its number,
# which its timer goes by.
_Free = collections.namedtuple("_Free", "source shown song_id sinks number")


def _refused(error):
    return {"ok": False, "error": error}


def _checked(key, value):
    """A setting's value as it is kept, or ValueError saying why not."""
    if key == "backing_volume":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 1:
            raise ValueError("The volume is from 0 to 1")
        return float(value)
    if key in ("backing_on", "backing_row"):
        if not isinstance(value, bool):
            raise ValueError("This setting is on or off")
        return value
    if key == "backing_channels":
        return _channels(value)
    raise ValueError(f"No backing track setting is called {key}")


class Backing:
    """
    `config` is the app's settings and `write_config()` saves them.
    `library()` is the open Library, or raises. `player_getter()` is the open
    TakePlayer or None. `metronome` is the app's: the next take's song, the
    device list, and the click a song page's ▶ plays. `recordings_dir()` is
    the recordings folder and `recording()` the device the next take records
    from and its rate, (index or None, samplerate). `trash(path)` sends a file
    to the Trash.
    """

    def __init__(self, config, write_config, library, player_getter, metronome, recordings_dir,
                 recording, trash):
        self._config = config
        self._write_config = write_config
        self._library = library
        self._player = player_getter
        self._metronome = metronome
        self._recordings_dir = recordings_dir
        self._recording = recording
        self._trash = trash
        self._lock = threading.Lock()
        self._sinks = threading.Lock()
        self._free = None
        # ▶ and the two seconds, numbered for their timers: a timer holds the
        # number, not the source, so a file stopped is let go of at once and
        # Windows can move it to the Trash.
        self._plays = itertools.count(1)
        # While a take records: True, and its TakeClick (None for a take with
        # neither click nor backing track) and TakeBacking (None for none).
        self._taking = False
        self._take_click = None
        self._take = None
        # (song id, its song_backing or None) for the next take's song, read
        # when it changes or the song's backing track does, each change
        # counted so a read it came in the middle of is not kept; and the
        # song id follow last found, None for none.
        self._next = None
        self._changes = 0
        self._followed = None
        # Ready files: (copy, rate) waiting to be made or being made, and
        # those that could not be, tried again only when their song is
        # picked again or Record asks for it; and those the row found
        # missing with nothing making them, asked for on a thread. One maker
        # at a time, here or on the thread.
        self._queued = set()
        self._failed = set()
        self._asked = set()
        self._making = threading.Lock()
        self._jobs = queue.Queue()
        self._worker = None
        # (path, mtime, size) of a copy -> (seconds, channels).
        self._described = {}
        # The library last looked at for songs with backing tracks while the
        # row had never been shown.
        self._row_looked = None

    # ---------- settings ----------

    def _setting(self, key):
        try:
            return _checked(key, self._config.get(key, DEFAULTS[key]))
        except ValueError:
            return DEFAULTS[key]

    def _channels(self):
        try:
            return _channels(self._config.get("backing_channels"))
        except ValueError:
            return None

    def _saved(self):
        """Whether a device of its own is saved: until one is, it goes where
        the player plays."""
        return self._config.get("backing_device") is not None or self._config.get("backing_device_index") is not None

    def _target(self, wait=True):
        """(its device, its outputs or None, a missing device's name or None),
        as output_target says; (None, None, None) before the device list is
        read."""
        found = self._metronome.devices(wait)
        if found is None:
            return None, None, None
        return output_target(self._config, "backing_device", found[3], found[1], self._channels())

    def settings(self):
        """For Settings and the gear: its device's index now, the name of one
        saved and not plugged in ("" for one saved with no name), its outputs,
        and the rest."""
        return {"backing_device_index": self._metronome.devices()[3] if self._saved() else None,
                "backing_device_missing": self._target()[2],
                "backing_channels": self._channels(),
                **{key: self._setting(key) for key in DEFAULTS}}

    def set_setting(self, key, value):
        """Checks one setting and saves it. The volume and the switch are
        heard at once in a take, the volume in ▶ too: what the take keeps is
        the file, whatever either says."""
        try:
            value = _checked(key, value)
        except ValueError as e:
            return _refused(str(e))
        self._config[key] = value
        self._write_config()
        click, free = self._take_click, self._free
        if key == "backing_volume":
            if click is not None:
                click.set_backing_volume(value)
            if free is not None:
                free.source.set_volume(value)
        if key == "backing_on" and click is not None:
            click.set_backing_on(value)
        return {"ok": True}

    def extra_channels(self, device_index):
        """Its outputs, when a device of its own is saved and it is
        `device_index`: the player opening there opens wide enough for them."""
        if not self._saved() or self._metronome.devices()[3] != device_index:
            return ()
        return tuple(self._channels() or ())

    def _label(self, name):
        """How the row names an output that is not there: the device and its
        outputs, "X18 5–6"."""
        channels = self._channels() if self._saved() else None
        if not channels:
            return name
        return f"{name} {channel_label(channels)}".strip()

    # ---------- a song's file ----------

    def describe(self, copy):
        """{"seconds", "channels", "missing"} of a song's copy, read from the
        file once for each time it changes; seconds and channels None for one
        that is not there or cannot be read."""
        if copy is None:
            return {"seconds": None, "channels": None, "missing": True}
        try:
            stat = Path(copy).stat()
        except OSError:
            return {"seconds": None, "channels": None, "missing": True}
        key = (str(copy), stat.st_mtime_ns, stat.st_size)
        found = self._described.get(key)
        if found is None:
            try:
                seconds, channels = backing_file.probe(copy)
                found = (round(seconds, 3), channels)
            except backing_file.BackingError as e:
                log.warning("A song's backing track could not be read: %s: %s", copy, e)
                found = (None, None)
            self._described[key] = found
        return {"seconds": found[0], "channels": found[1], "missing": False}

    def _folder(self):
        return Path(self._recordings_dir()) / backing_file.FOLDER

    def _ready(self, copy, rate):
        """The copy's ready file at `rate` when it is there, newer than the
        copy and not being made; else None."""
        ready = backing_file.ready_path(copy, rate)
        with self._lock:
            if (Path(copy), rate) in self._queued:
                return None
        try:
            if ready.stat().st_mtime < Path(copy).stat().st_mtime:
                return None
        except OSError:
            return None
        return ready

    def _make(self, copy, rate):
        """The copy's ready file at `rate`, made now unless it is there. One
        at a time: what the thread is making is waited for. BackingError or
        OSError for one that cannot be made, which the row then says nothing
        of getting ready."""
        job = (Path(copy), rate)
        with self._making:
            try:
                ready = backing_file.make_ready(copy, rate)
            except (backing_file.BackingError, OSError):
                with self._lock:
                    self._failed.add(job)
                raise
            finally:
                with self._lock:
                    self._queued.discard(job)
        return ready

    def _rate(self):
        return int(self._recording()[1])

    def _rates(self):
        """The rates the next take plays a song's file at: the recording's,
        and its output's own when it is heard on another device than the
        recording card, whose stream plays a file at its own rate as it is
        (take_output). With no recording card chosen nothing says which
        that is."""
        device_index, rate = self._recording()
        rates = [int(rate)]
        if device_index is None:
            return rates
        device, channels, missing = self._target()
        if missing is not None:
            return rates
        here = device if device is not None else self._metronome.devices()[2]
        if here is not None and here == device_index:
            return rates
        other = ClickOutput(device, channels or (1, 2)).samplerate
        if other not in rates:
            rates.append(other)
        return rates

    def ready_for(self, song_id):
        """The song's file made ready on a thread of its own, at the rate the
        next take records at and at its output's own, unless it is already.
        One that could not be made is tried again: a disk that was full may
        have room now."""
        try:
            backing = self._library().song_backing(song_id)
        except Exception:
            log.exception("The next take's backing track could not be read")
            return
        if backing is None:
            return
        copy = Path(backing["file"])
        if not copy.exists():
            return
        jobs = []
        with self._lock:
            for rate in self._rates():
                job = (copy, rate)
                if job in self._queued:
                    continue
                self._failed.discard(job)
                jobs.append(job)
        jobs = [job for job in jobs if self._ready(*job) is None]
        if not jobs:
            return
        with self._lock:
            self._queued.update(jobs)
            if self._worker is None or not self._worker.is_alive():
                self._worker = threading.Thread(target=self._work, name="backing track ready", daemon=True)
                self._worker.start()
        self._jobs.put(jobs)

    def _ask_ready(self, song_id, job):
        """A ready file the row found missing that nothing is making (deleted
        by hand): asked for on a thread, so the poll never waits, and so the
        row's "getting ready" is true."""
        with self._lock:
            if job in self._asked:
                return
            self._asked.add(job)

        def ask():
            try:
                self.ready_for(song_id)
            finally:
                with self._lock:
                    self._asked.discard(job)

        threading.Thread(target=ask, name="backing track asked ready", daemon=True).start()

    def _work(self):
        while True:
            jobs = self._jobs.get()
            if jobs is None:
                return
            for copy, rate in jobs:
                try:
                    self._make(copy, rate)
                except Exception:
                    log.exception("A backing track could not be made ready at %s Hz: %s", rate, copy)

    def trash_copy(self, copy):
        """A copy nobody keeps now to the Trash, with every ready file made of
        it. What will not go is said in the log."""
        copy = Path(copy)
        readies = sorted(copy.parent.glob(glob.escape(copy.name) + " (ready *).wav"))
        for path in [copy, *readies]:
            if not path.exists():
                continue
            try:
                moved = self._trash(path)
            except Exception as e:
                moved = {"ok": False, "error": str(e)}
            if not moved.get("ok"):
                log.warning("A backing track's file could not go to the Trash: %s: %s", path, moved.get("error"))
        with self._lock:
            self._failed = {job for job in self._failed if job[0] != copy}

    def _taken(self):
        with self._lock:
            return self._taking

    def add(self, song_id, path):
        """
        Gives a song the file at `path`, or another in place of the one it
        had: copied, made ready, counted in the song's signature, the song's
        tempo set to the count when it had none. The copy it had goes to the
        Trash. {"ok", "name", "seconds", "channels", "tempo", "first_bar"},
        or {"ok": False, "error"} with nothing changed.
        """
        if self._taken():
            return _refused(DURING_TAKE)
        library = self._library()
        song = library.song(song_id)
        if song is None:
            return _refused("Song not found")
        try:
            seconds, channels = backing_file.probe(path)
        except backing_file.BackingError as e:
            return _refused(str(e))
        self.stop()
        name = Path(path).name
        copy = None
        try:
            copy = backing_file.import_copy(path, self._folder())
            ready = self._make(copy, self._rate())
            found = backing_count.count(ready, song["signature"])
            old = library.set_song_backing(song_id, copy, name, found["first_bar"], found["tempo"])
        except (backing_file.BackingError, OSError, SongRefused) as e:
            if copy is not None:
                self._unmake(copy)
            return _refused(str(e))
        if old is not None:
            self.trash_copy(old)
        if song["tempo"] is None and found["tempo"] is not None:
            library.set_song_tempo(song_id, found["tempo"], song["signature"] or "4/4")
        if not self._setting("backing_row"):
            self._config["backing_row"] = True
            self._write_config()
        self.refresh()
        self.ready_for(song_id)
        return {"ok": True, "name": name, "seconds": round(seconds, 3), "channels": channels,
                "tempo": found["tempo"], "first_bar": found["first_bar"]}

    @staticmethod
    def _unmake(copy):
        """A copy made for a file that then would not go in, and its ready
        files: deleted, as nobody ever had them."""
        copy = Path(copy)
        for path in [copy, *copy.parent.glob(glob.escape(copy.name) + " (ready *).wav")]:
            path.unlink(missing_ok=True)

    def remove(self, song_id):
        """Takes a song's backing track away, its copy to the Trash."""
        if self._taken():
            return _refused(DURING_TAKE)
        self.stop()
        old = self._library().clear_song_backing(song_id)
        if old is None:
            return _refused(NONE)
        self.trash_copy(old)
        self.refresh()
        return {"ok": True}

    def set_first_bar(self, song_id, seconds):
        """Where bar 1 is, to a hundredth of a second, from the file's start
        to its end."""
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds):
            return _refused("Bar 1 is a number of seconds")
        library = self._library()
        backing = library.song_backing(song_id)
        if backing is None:
            return _refused(NONE)
        value = max(0.0, float(seconds))
        length = self.describe(backing["file"])["seconds"]
        if length is not None:
            value = min(value, math.floor(length * 100) / 100)
        saved = library.set_backing_first_bar(song_id, value)
        self.refresh()
        return {"ok": True, "first_bar": saved["first_bar"]}

    def set_tempo(self, song_id, tempo, to_song):
        """The tempo the file was counted at, halved or doubled, and with
        `to_song` the song's tempo too: in the song's signature, 4/4 with
        none, a whole number the metronome keeps."""
        library = self._library()
        song = library.song(song_id)
        if song is None or library.song_backing(song_id) is None:
            return _refused(NONE)
        signature = song["signature"] or "4/4"
        low, high = tempo_range(signature)
        if not whole(tempo) or not low <= tempo <= high:
            return _refused(f"A tempo in {signature} is a whole number from {low} to {high}")
        library.set_backing_tempo(song_id, tempo)
        if to_song:
            library.set_song_tempo(song_id, tempo, signature)
        self.refresh()
        return {"ok": True, "tempo": tempo}

    def peaks(self, song_id, end_sec, buckets):
        """The start of the file drawn, from 0 to `end_sec`: a row of
        `buckets` peaks for each channel."""
        if (isinstance(end_sec, bool) or not isinstance(end_sec, (int, float)) or not 0 < end_sec < 36000
                or not whole(buckets) or not 0 < buckets <= 10000):
            return _refused("A picture is of some seconds, in some buckets")
        backing = self._library().song_backing(song_id)
        if backing is None:
            return _refused(NONE)
        if not Path(backing["file"]).exists():
            return _refused(MISSING.format(name=backing["name"]))
        try:
            ready = self._make(backing["file"], self._rate())
        except (backing_file.BackingError, OSError) as e:
            return _refused(str(e))
        return {"ok": True, "peaks": backing_file.peaks(ready, end_sec, buckets)}

    # ---------- the next take ----------

    def _next_backing(self, song_id):
        """The next take's song's song_backing, read once each time it
        changes (refresh)."""
        with self._lock:
            cached, changes = self._next, self._changes
        if cached is not None and cached[0] == song_id:
            return cached[1]
        try:
            backing = self._library().song_backing(song_id)
        except Exception:
            log.exception("The next take's backing track could not be read")
            backing = None
        with self._lock:
            if self._changes == changes:
                self._next = (song_id, backing)
        return backing

    def refresh(self):
        """A song's backing track changed: the row reads it again."""
        with self._lock:
            self._next = None
            self._changes += 1

    def follow(self):
        """The next take's name changed (the metronome followed it): ▶ stops
        when it leads to another song, and the song's file is got ready."""
        free, song = self._metronome.next_song()
        song_id = None if free or song is None else song["id"]
        if song_id != self._followed:
            self._followed = song_id
            self.refresh()
            playing = self._free
            if playing is not None and playing.shown:
                self.stop()
        if song_id is not None:
            self.ready_for(song_id)

    def take_backing(self, song_id, device_index, samplerate):
        """
        The backing track a take of song `song_id` (None: a free take) plays,
        recorded from `device_index` at `samplerate`: a TakeBacking, or None
        for none. None too while its file is not ready at that rate (it is got
        ready meanwhile), when its copy is gone, when the switch is off, and
        when its output is not plugged in: nobody would hear it.
        """
        if song_id is None or not self._setting("backing_on"):
            return None
        backing = self._library().song_backing(song_id)
        if backing is None:
            return None
        copy = Path(backing["file"])
        if not copy.exists():
            return None
        ready = self._ready(copy, int(samplerate))
        if ready is None:
            self.ready_for(song_id)
            return None
        device, channels, missing = self._target()
        if missing is not None:
            return None
        here = device if device is not None else self._metronome.devices(wait=False)[2]
        output, route = take_output(device, channels, None, here, device_index, samplerate,
                                    "It has no outputs to play on.")
        played = None
        if output is not None and output.samplerate != int(samplerate):
            played = self._ready(copy, output.samplerate)
        try:
            return TakeBacking(ready, backing["first_bar"], route=route, output=output,
                               volume=self._setting("backing_volume"), played=played)
        except (OSError, ValueError):
            log.exception("The take's backing track could not be opened, so it records without it")
            return None

    def begin_take(self, click):
        """A take records with `click` (its TakeClick or None): ▶ stops."""
        self.stop()
        with self._lock:
            self._taking = True
            self._take_click = click
            self._take = None if click is None else click.backing

    def take_channels(self):
        """The channels the take's Backing track will write, 0 with none:
        the disk line counts them as one more track's."""
        with self._lock:
            take = self._take if self._taking else None
        return 0 if take is None else take.opened[4]

    def end_take(self):
        with self._lock:
            self._taking = False
            self._take_click = None
            self._take = None

    # ---------- ▶ and Settings' two seconds ----------

    def play(self, song_id, tempo=None, signature=None):
        """▶: the song's file from its start, until ■, Record, another song
        or the file's end. With a `tempo`, the click from bar 1 beside it."""
        if self._taken():
            return _refused(DURING_TAKE)
        backing = self._library().song_backing(song_id)
        if backing is None:
            return _refused(NONE)
        return self._play(backing, song_id, shown=True, tempo=tempo, signature=signature)

    def preview(self):
        """Two seconds from bar 1, for Settings, of the next take's song's
        backing track or else any song's; not shown in the row. While ▶
        plays, that is what is heard."""
        if self._taken():
            return _refused(DURING_TAKE)
        free = self._free
        if free is not None and free.shown:
            return {"ok": True}
        library = self._library()
        chosen, song_id = None, None
        free_name, song = self._metronome.next_song()
        if not free_name and song is not None:
            chosen, song_id = library.song_backing(song["id"]), song["id"]
        if chosen is None or not Path(chosen["file"]).exists():
            chosen = None
            for other, copy in sorted(library.backing_files().items()):
                if copy.exists():
                    chosen, song_id = library.song_backing(other), other
                    break
        if chosen is None:
            return _refused("No song has a backing track yet")
        return self._play(chosen, song_id, shown=False)

    def _play(self, backing, song_id, shown, tempo=None, signature=None):
        copy = Path(backing["file"])
        if not copy.exists():
            return _refused(MISSING.format(name=backing["name"]))
        try:
            opened = backing_file.open_ready(self._make(copy, self._rate()))
        except (backing_file.BackingError, OSError, ValueError) as e:
            return _refused(str(e))
        file_rate = opened[2]
        first_bar = backing["first_bar"]
        if shown:
            lead = WITH_CLICK_LEAD_SEC if tempo is not None else 0.0
            start, seconds = -round(lead * file_rate), lead + opened[1] / file_rate
            click = None if tempo is None else (tempo, signature or "4/4", first_bar + lead)
        else:
            start, seconds, click = round(first_bar * file_rate), PREVIEW_SEC, None
        with self._sinks:
            free = self._start_held(opened, start, shown, song_id, click)
        if shown:
            timer = threading.Timer(seconds + END_SLACK_SEC, self._reap, args=(free.number,))
        else:
            timer = threading.Timer(PREVIEW_SEC, self._fade_and_reap, args=(free.number,))
        timer.daemon = True
        timer.start()
        return {"ok": True}

    def _where(self, target, own):
        """Where a part between takes plays, from (device, outputs, missing):
        ("player", the player, its route), ("own", the device, its outputs)
        or ("missing", the name, None). `own`: whether the part has a device
        of its own saved; one that has not rides the player's outputs."""
        device, channels, missing = target
        if missing is not None:
            return "missing", missing, None
        player = self._player()
        if player is not None and player.holds(device):
            route = tuple(c - 1 for c in channels) if own and channels else player.route
            return "player", player, route
        return "own", device, tuple(channels or (1, 2))

    def _start_held(self, opened, start, shown, song_id, click=None):
        """
        ▶ or Settings' two seconds in place of what played, with `_sinks`
        held: the file from its frame `start`; with `click` (tempo, signature,
        seconds into the stream of bar 1's click) the click beside it, where
        the click goes. What goes to one device plays in one stream there.
        """
        with STREAM_LOCK:
            self._stop_free()
            places = [self._where(self._target(), self._saved())]
            if click is not None:
                places.append(self._where(self._metronome.click_target(), self._metronome.click_saved()))
            wanted = {}
            for kind, device, channels in places:
                if kind == "own":
                    wanted.setdefault(device, set()).update(channels)
            outputs = {device: ClickOutput(device, sorted(channels)) for device, channels in wanted.items()}
            sinks = []
            for kind, where, route in places:
                if kind == "player":
                    sinks.append(("player", where, route))
                elif kind == "own":
                    output = outputs[where]
                    sinks.append(("own", output, tuple(c - 1 for c in route)))
                else:
                    output = SilentOutput(self._label(where))
                    sinks.append(("own", output, output.route))
            kind, sink, route = sinks[0]
            source = BackingSource(opened, route, self._setting("backing_volume"), start=start,
                                   samplerate=sink.samplerate)
            parts = [(kind, sink, source)]
            if click is not None:
                parts.append(self._click_part(source, sink, sinks[1], click))
            streams = {}
            for kind, sink, part in parts:
                streams.setdefault(id(sink), (kind, sink, []))[2].append(part)
            played = []
            for kind, sink, group in streams.values():
                one = group[0] if len(group) == 1 else Sources(*group)
                if kind == "player":
                    sink.play_free_backing(one)
                else:
                    try:
                        sink.start(one)
                    except Exception:
                        # Counted by the computer's clock instead, so the row
                        # still shows how far it is and says why it is not heard.
                        sink = SilentOutput(sink.name, sink.problem(), sink.samplerate)
                        sink.start(one)
                played.append((kind, sink))
            free = _Free(source, shown, song_id, tuple(played), next(self._plays))
            with self._lock:
                self._free = free
        return free

    def _click_part(self, backing, backing_sink, where, click):
        """The click from bar 1 of `backing`, a BackingSource playing in
        `backing_sink`, on `where`, (kind, sink, route): in the same stream on
        the frames that play the file, else through both streams' clocks, as
        a take's click on another device is placed."""
        kind, sink, route = where
        tempo, signature, bar_one = click
        rate = backing.samplerate
        same = sink is backing_sink

        def place(k):
            origin = backing.origin
            if origin is None:
                return None
            frame = origin + round(bar_one * rate) + click_frame(k, tempo, rate)
            if same:
                return frame
            at = backing.clock.ns_at(frame)
            return None if at is None else source.clock.frame_at(at)

        source = ClickSource(tempo, signature, self._metronome.voices(sink.samplerate), route, place=place)
        return kind, sink, source

    def stop(self):
        """■: ▶ or Settings' two seconds stop."""
        with self._sinks:
            self._stop_free()
        return {"ok": True}

    def _stop_free(self):
        with STREAM_LOCK:
            with self._lock:
                free, self._free = self._free, None
            if free is None:
                return
            for kind, sink in free.sinks:
                if kind == "player":
                    sink.play_free_backing(None)
                else:
                    sink.stop()
        if free.source.fault is not None:
            log.error("The backing track between takes failed and went quiet: %s", free.source.fault)

    def _playing(self, number):
        free = self._free
        return free if free is not None and free.number == number else None

    def _reap(self, number):
        """▶ `number` played to the file's end, or Settings' two seconds are
        over: let go of it, unless something else plays in its place."""
        with self._sinks, STREAM_LOCK:
            if self._playing(number) is not None:
                self._stop_free()

    def _fade_and_reap(self, number):
        free = self._playing(number)
        if free is not None:
            free.source.fade_out()
            del free
            time.sleep(FADE_SEC + 0.05)
        self._reap(number)

    def let_go_for_rescan(self):
        """For a rescan, inside its locks: what plays between takes stops."""
        self._stop_free()

    def make_room(self, device_index):
        """The player is about to open on `device_index`: what plays between
        takes in a stream of its own there stops, as the app never opens a
        second stream on a device it holds. Inside the player's locks."""
        with STREAM_LOCK:
            free = self._free
            if free is not None and any(isinstance(sink, ClickOutput) and sink.device_index == device_index
                                        for kind, sink in free.sinks if kind == "own"):
                self._stop_free()

    def resink(self):
        """The player opened or closed: what played in its stream stops, as
        when the screen is left."""
        with self._sinks, STREAM_LOCK:
            free = self._free
            if free is None:
                return
            player = self._player()
            for kind, sink in free.sinks:
                if kind == "player" and (sink is not player or sink.free_backing is None):
                    self._stop_free()
                    return

    def close(self):
        """The app is closing."""
        self.stop()
        self._jobs.put(None)

    # ---------- for the screen ----------

    def state(self):
        """The row's state (BackingState): polled, and never waits."""
        free_name, song = self._metronome.next_song()
        with self._lock:
            taking, take, free = self._taking, self._take, self._free
        if free is not None:
            for _, sink in free.sinks:
                if isinstance(sink, SilentOutput):
                    sink.pump()
        shown, getting_ready = None, False
        if not free_name and song is not None:
            backing = self._next_backing(song["id"])
            if backing is not None:
                described = self.describe(backing["file"])
                shown = {"name": backing["name"], "first_bar": backing["first_bar"], "tempo": backing["tempo"],
                         **described, "song_id": song["id"], "title": song["title"]}
                if not described["missing"] and not taking:
                    rate = int(self._rate())
                    job = (Path(backing["file"]), rate)
                    with self._lock:
                        failed, queued = job in self._failed, job in self._queued
                    getting_ready = not failed and (queued or self._ready(backing["file"], rate) is None)
                    if getting_ready and not queued:
                        self._ask_ready(song["id"], job)
        playing, position = False, 0
        if taking:
            if take is not None:
                playing = True
                position = take.source.position_sec or 0
        elif free is not None and free.shown and not free.source.done:
            playing = True
            position = free.source.position_sec or 0
        return {"song": shown, "on": self._setting("backing_on"), "volume": self._setting("backing_volume"),
                "row": self._setting("backing_row") or self._row_from_library(), "playing": playing,
                "position_sec": max(0, round(position, 2)),
                "output_missing": self._output_problem(taking, take, free),
                "getting_ready": getting_ready, "free": bool(free_name)}

    def _row_from_library(self):
        """Whether the row shows for a recordings folder whose songs already
        have backing tracks, added on another computer: as if one had just
        been added here, and from then on. Each folder is looked at once."""
        try:
            library = self._library()
        except Exception:
            return False
        if library is self._row_looked:
            return False
        self._row_looked = library
        try:
            found = bool(library.backing_files())
        except Exception:
            log.exception("The songs' backing tracks could not be read")
            return False
        if found:
            self._config["backing_row"] = True
            self._write_config()
        return found

    def _output_problem(self, taking, take, free):
        """How the row names its output when it cannot play there, else None."""
        if taking and take is not None:
            problem = take.problem()
            return None if problem is None else self._label(take.output.name)
        missing = self._target(wait=False)[2]
        if missing is not None:
            return self._label(missing)
        if free is not None:
            for kind, sink in free.sinks:
                if kind == "own" and sink.problem() is not None:
                    return self._label(sink.name) if not isinstance(sink, SilentOutput) else sink.name
        return None
