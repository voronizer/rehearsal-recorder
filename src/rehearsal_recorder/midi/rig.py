"""
The rehearsal's MIDI ports: open for as long as the rehearsal is, counted for
the setup screen, watched as they come and go, and handed to each take.

A port is opened when the rehearsal starts and not when a take does, because
what was set before the take belongs in it: the pedal already down, the sound
already picked (spec F6). So between takes the rig keeps each track's PortState
and counts what its port sends, for the meters, and during a take it also hands
every event to the take's MidiRecorder.

A track whose port is not there is not an error (D7). It waits, and the port is
opened when it is plugged in, during a take too: the observer says the list
changed (P4) and the rig also reads the list every fourth tick, in case it did
not. A port another app holds (P5), and one that two identical devices make it
impossible to tell (P1), wait the same way, each with its own word for the
screen. A device behind an interface's MIDI in that is switched off leaves its
port there; if it has been sending active sensing, its silence says it went
(F7), and its held notes are let go when it was last heard.

Three kinds of thread meet here:

  - each open port's own, which calls `on_event`. That notes when the port was
    last heard and puts the event on one queue, and does nothing else, so a
    hi-hat pedal's stream of positions or a burst of SysEx never holds up the
    next event;
  - the writer, which takes the queue in order: the track's PortState, the
    counts, the loudest note, the same notes on two ports (P8), and the take's
    recorder. A port's coming and going reaches the recorder on the same queue,
    as markers, so a port's events that were already waiting are written before
    it is said to be gone, and none of them is lost for arriving after;
  - the watcher, every TICK_SEC: a port that has gone quiet, the list of ports,
    each port's clock, and the recorder's flush with the audio's.

`threads=False` runs neither the writer nor the watcher, and whoever made the
rig calls `drain()` and `tick()`: the suites do, with a clock of their own.

Locks. `_manage` is held by whatever opens or closes ports (use, refresh, a
tick's look, begin_take, the end of a take, release), so they happen one at a
time and the markers they put on the queue are in the order the ports changed.
`_lock` guards the rig's own state and is only ever held briefly: never while a
port is opened or closed, never while the recorder is called. The writer takes
`_lock` alone, so nothing it waits for waits for a port. The order is `_manage`,
then `_lock`, then a PortState's own lock; the recorder's lock is taken by its
own calls only, and the recorder calls nothing here.

It imports neither the MIDI library nor mido: the ports come from ports.py (or
fake_midi.py), and the files from capture.py.
"""

import logging
import queue
import sys
import threading
import time
from collections import deque

from rehearsal_recorder.audio.capture import FLUSH_INTERVAL_SEC
from rehearsal_recorder.midi.capture import MidiRecorder
from rehearsal_recorder.midi.identity import find_port, in_order
from rehearsal_recorder.midi.ports import PortBusy
from rehearsal_recorder.midi.rules import port_of, records_notes
from rehearsal_recorder.midi.state import PortState

log = logging.getLogger(__name__)

# A device that has been sending active sensing and then says nothing for longer
# than this has gone: the MIDI standard's own 300 ms (F7). A TD-17 sends it every
# 250 ms, and only a device that has sent it is held to it.
SENSING_TIMEOUT_SEC = 0.3

# How often the watcher looks for a port gone quiet. Every fourth look it also
# reads the list of ports, in case the observer missed a change, and measures
# each port's clock against Python's again.
TICK_SEC = 0.25
_LOOK_EVERY = 4

# P8: the same note at the same velocity on two tracks' ports within ECHO_MS,
# ECHO_HITS times, is one instrument plugged in twice. Each track remembers its
# last _ECHO_KEPT note-ons for it, so a chord that arrives interleaved on the two
# ports is still matched note for note.
ECHO_MS = 5
ECHO_HITS = 4
_ECHO_KEPT = 16

# How long the end of a take waits for the writer to reach it, and shutdown for a
# thread to stop, before going on without it.
_END_PATIENCE_SEC = 10
_JOIN_SEC = 5

_NS = 1_000_000_000
_SENSING = 0xFE
_STOP = object()  # on the queue: the writer's thread ends


class _Port:
    """
    A port the rig has open. `track` is the _Track it feeds, or None for a port
    the check only counts the notes of (P7).

    `heard_ns` is set on the port's own thread as each event arrives (a single
    assignment), so a writer that is behind does not make a busy port look
    quiet. `sensing` and `silent_at` are under the rig's lock: whether it has
    sent active sensing, and the `heard_ns` at which it went quiet. `done` is
    the writer's own: it has passed the port's closing, and hears it no more.
    """

    __slots__ = ("track", "info", "port", "heard_ns", "sensing", "silent_at", "done")

    def __init__(self, track, info, now):
        self.track = track
        self.info = info
        self.port = None
        self.heard_ns = now
        self.sensing = False
        self.silent_at = None
        self.done = False


class _Track:
    """
    A track that takes notes, as the last `use` gave it. It keeps its PortState
    for the whole rehearsal, and a track whose saved port changes is a new
    _Track: the old port's state is not the new one's.
    """

    __slots__ = ("name", "saved", "index", "state", "status", "found", "port",
                 "notes", "vel", "echo", "recent")

    def __init__(self, name, saved):
        self.name = name
        self.saved = saved  # the saved port (rules.port_of), None when none is picked
        self.index = 0  # its place in the band, for P8's "the later card"
        self.state = PortState()
        self.status = "none"  # what the screen says when no port is open
        self.found = None  # the PortInfo its saved port is now, if one
        self.port = None  # the _Port open for it
        self.notes = 0
        self.vel = 0  # the loudest note-on since activity() last read it
        self.echo = None  # the track whose notes this one also gets (P8)
        self.recent = deque(maxlen=_ECHO_KEPT)  # (ns, note, velocity) for P8


class _Take:
    """One take's recorder, and what the writer has told it."""

    __slots__ = ("recorder", "here", "flush_at", "said")

    def __init__(self, recorder, flush_at):
        self.recorder = recorder
        # Track name -> the _Port it is present through, as far as the recorder
        # has been told. The writer's alone.
        self.here = {}
        self.flush_at = flush_at
        self.said = False  # a disk that refused has been said in the log


class MidiRig:
    """
    The ports of a rehearsal's tracks that take notes, and of the setup screen's
    check. `system` is a ports.PortSystem (or tests/fake_midi.py's), or None
    when there is no MIDI here, with `error` the reason open_system gave.
    `now_ns` is the rig's clock for its ticks, a quiet port's timeout and when a
    port appeared; an event's time is the one its port gives.
    """

    def __init__(self, system, error=None, threads=True, now_ns=time.perf_counter_ns):
        self._system = system
        self._error = error
        self._now = now_ns
        self._lock = threading.Lock()
        self._manage = threading.RLock()
        self._queue = queue.SimpleQueue()
        self._tracks = {}  # name -> _Track, in the band's order
        self._ports = []  # the ports as last read
        self._counted = {}  # PortInfo -> note-ons heard on it, for the picker (P7)
        self._checking = {}  # PortInfo -> _Port open only to count (P7)
        self._check = False
        self._echoes = {}  # (first track, later track) -> times the same note came on both
        self._take = None
        self._ticks = 0
        self._changed = False  # the observer said the list changed
        self._closed = False
        self._failure = None
        self._wake = threading.Event()
        self._stopping = threading.Event()
        self._writer = self._watcher = None
        if system is not None:
            try:
                system.watch(self._on_change)
            except Exception:
                self._failed("watching the MIDI ports")
            self._ports = self._list()
        if threads:
            self._writer = threading.Thread(target=self._write, name="midi-rig writer", daemon=True)
            self._watcher = threading.Thread(target=self._watch, name="midi-rig watcher", daemon=True)
            self._writer.start()
            self._watcher.start()

    # What the app asks.

    def ports(self) -> dict:
        """
        The ports for the picker, a device's playing port first
        (identity.in_order), each as it is saved with the note-ons it has sent
        since the counts last started again, which only a port that is open says
        anything about: a track's, or one the check opened (P7).
        """
        with self._lock:
            listed = list(self._ports)
            counted = dict(self._counted)
        return {"system": self._system.name if self._system is not None else None,
                "ports": [{**info.saved(), "notes": counted.get(info, 0)} for info in in_order(listed)],
                "error": self._error}

    def use(self, tracks, check=False) -> None:
        """
        These are the band's tracks now. Every track that takes notes gets its
        port opened if it is there; one already open for the same track and the
        same saved port stays open, and every other port is closed. With `check`
        the other ports of each picked port's device are opened too, only to
        count their notes, so the picker can show which of a keyboard's ports is
        being played (P7). Raises nothing for a port: one missing, in use or
        alike shows so in `activity`.
        """
        with self._manage:
            if self._closed:
                return
            listing = self._list()
            with self._lock:
                old, new = self._tracks, {}
                for given in tracks or ():
                    if not isinstance(given, dict) or not records_notes(given):
                        continue
                    name = given.get("name")
                    if not isinstance(name, str) or name in new:
                        continue
                    saved = port_of(given)
                    track = old.get(name)
                    if track is None or track.saved != saved:
                        track = _Track(name, saved)
                    track.index = len(new)
                    new[name] = track
                leaving = [t.port for t in old.values() if new.get(t.name) is not t and t.port is not None]
                self._tracks = new
                self._check = bool(check)
                # An echo between tracks that are not both still here, as they were, is forgotten.
                kept = {name for name, track in new.items() if old.get(name) is track}
                self._echoes = {pair: hits for pair, hits in self._echoes.items()
                                if pair[0] in kept and pair[1] in kept}
                for track in new.values():
                    if track.echo is not None and (track.echo, track.name) not in self._echoes:
                        track.echo = None
            for port in leaving:
                self._close(port)
            self._settle(listing)

    def refresh(self) -> None:
        """Reads the list of ports again, as Look again on the setup screen asks."""
        with self._manage:
            if not self._closed:
                self._look()

    def reset_counts(self) -> None:
        """The notes counted, the loudest and the same notes twice start again."""
        with self._lock:
            self._zero()

    def activity(self) -> dict:
        """
        Each track that takes notes: `vel`, the loudest note-on since the last
        call, 0 to 1; `notes`, the note-ons since the counts last started again;
        `state`, "ok" (open and heard as there), "missing" (not plugged in, or
        gone quiet), "in_use" (another app holds it), "ambiguous" (two ports it
        could be) or "none" (no port picked); `connected`, whether it is "ok";
        and `echo`, the track whose notes it gets too, when it does (P8).
        """
        with self._lock:
            out = {}
            for track in self._tracks.values():
                port = track.port
                if port is not None:
                    state = "missing" if port.silent_at is not None else "ok"
                else:
                    state = track.status
                entry = {"vel": track.vel / 127, "notes": track.notes, "connected": state == "ok", "state": state}
                if track.echo is not None:
                    entry["echo"] = track.echo
                track.vel = 0
                out[track.name] = entry
            return out

    def begin_take(self, out_dir, anchor) -> None:
        """
        A take has started, its audio on `anchor` (its AudioClock, already
        started). Its recorder gets every track that takes notes, each starting
        from a copy of its port's state as it is now (F6), and every port open and
        heard as there is present from now. The check's other ports close, and
        the counts start again.
        """
        with self._manage:
            if self._closed:
                return
            if self._take is not None:
                self.abandon_take()
            with self._lock:
                self._check = False
                checking = list(self._checking.values())
            for port in checking:
                self._close(port)
            now = self._now()
            with self._lock:
                self._zero()
                tracks = list(self._tracks.values())
                # The copies and the take begin under the one lock the writer
                # holds for each event, so an event is either in a copy or in
                # the take, and never neither.
                recorder = MidiRecorder(out_dir, anchor,
                                        [{"name": t.name, "port": t.saved["name"] if t.saved else ""}
                                         for t in tracks],
                                        {t.name: t.state.copy() for t in tracks})
                self._take = _Take(recorder, now + int(FLUSH_INTERVAL_SEC * _NS))
                for track in tracks:
                    if track.port is not None and track.port.silent_at is None:
                        self._queue.put((None, "present", track.port, now))

    def end_take(self, duration_sec) -> list[dict]:
        """
        The take has stopped, `duration_sec` of audio long. Once the writer has
        written everything that arrived before now, each port's notes become its
        .mid: [{"name", "file", "port"}] (MidiRecorder.stop), or [] if that
        fails, which is said in the log. The ports stay open.
        """
        take = self._end()
        if take is None:
            return []
        try:
            return take.recorder.stop(duration_sec)
        except Exception as e:
            log.error("The take's notes could not be finished: %r", e)
            return []

    def abandon_take(self) -> None:
        """The take is dropped as a crash would leave it, for the drafts to finish."""
        take = self._end()
        if take is not None:
            try:
                take.recorder.abandon()
            except Exception as e:
                log.error("The take's notes could not be let go of: %r", e)

    def release(self) -> None:
        """The rehearsal is over: every port closes and the tracks are forgotten.
        A take still recording is abandoned."""
        with self._manage:
            self._release()

    def shutdown(self) -> None:
        """The app is closing: release, the two threads stopped, the system closed."""
        with self._manage:
            if self._closed:
                return
            self._release()
            self._closed = True
            with self._lock:
                self._ports = []
        self._stopping.set()
        self._wake.set()
        if self._writer is not None:
            self._queue.put(_STOP)
        for thread in (self._writer, self._watcher):
            if thread is not None and thread is not threading.current_thread():
                thread.join(_JOIN_SEC)
        if self._writer is None:
            self.drain()
        if self._system is not None:
            try:
                self._system.close()
            except Exception:
                self._failed("closing the MIDI system")

    # The writer.

    def drain(self) -> None:
        """
        Everything on the queue, in order. The writer's thread does this as the
        queue fills; a rig made with threads=False is drained by its caller. One
        thread at a time: the order is the point.
        """
        while True:
            try:
                item = self._queue.get_nowait()
            except queue.Empty:
                return
            if item is not _STOP:
                self._take_item(item)

    def _write(self):
        """The writer's thread: drain, waiting on the queue between items."""
        while True:
            item = self._queue.get()
            if item is _STOP:
                return
            self._take_item(item)

    def _take_item(self, item):
        try:
            if item[0] is None:
                self._marker(item)
            else:
                self._event(*item)
        except Exception:
            self._failed("the MIDI writer")

    def _event(self, port, ns, data):
        """One message from a port, in the order the ports sent them."""
        if port.done or not data:
            return
        status = data[0]
        note_on = 0x90 <= status <= 0x9F and len(data) == 3 and data[1] < 0x80 and 0 < data[2] < 0x80
        track = port.track
        with self._lock:
            if note_on:
                self._counted[port.info] = self._counted.get(port.info, 0) + 1
            if track is None:
                return
            if port.silent_at is not None and ns > port.silent_at:
                port.silent_at = None  # heard again
            if status == _SENSING:
                port.sensing = True
            else:
                track.state.feed(data)
            take = self._take
            if note_on:
                track.notes += 1
                track.vel = max(track.vel, data[2])
                if take is None:
                    self._echo(track, ns, data[1], data[2])
            if take is None:
                return
            here = take.here.get(track.name)
            # A port not yet present is made so by its first event, unless it is
            # quiet: its marker may be behind the event on the queue (an event
            # that was waiting when the take began, or one from a port that has
            # just opened), or it went quiet and has just been heard again. A
            # port that has been closed since is still heard up to its closing
            # (`done`, above), wherever the track's port is now.
            if here is not port and (here is not None or port.silent_at is not None):
                return
        if here is None and not self._present(take, port, ns):
            return
        # Active sensing says the port is alive, and a .mid leaves it out (F2).
        if status != _SENSING:
            self._tell(take, take.recorder.feed, track.name, ns, data)

    def _marker(self, item):
        """A port that came or went, or the take's end, in its place among the events."""
        kind = item[1]
        if kind == "end":
            _, _, take, done = item
            with self._lock:
                if self._take is take:
                    self._take = None
            done.set()
            return
        _, _, port, ns = item
        if kind == "closed":
            port.done = True
        with self._lock:
            take = self._take
            if take is None or port.track is None:
                return
            name = port.track.name
            here = take.here.get(name)
            if kind == "present":
                go = here is None and not port.done and port.silent_at is None
            elif kind == "closed":
                go = here is port
            else:  # "silent": unless it was heard again since
                go = here is port and port.silent_at == ns
        if not go:
            return
        if kind == "present":
            self._present(take, port, ns)
        else:
            del take.here[name]
            self._tell(take, take.recorder.gone, name, ns)

    def _present(self, take, port, ns):
        if not self._tell(take, take.recorder.present, port.track.name, ns):
            return False  # tried again with the port's next event
        take.here[port.track.name] = port
        return True

    def _tell(self, take, call, *args):
        """
        A call to the take's recorder. A disk that refuses (an OSError, a
        NotesDropped among them) is said once a take, and the writer goes on:
        the audio take goes on whatever happens to its notes. True if the call
        went through.
        """
        try:
            call(*args)
            return True
        except OSError as e:
            with self._lock:
                said, take.said = take.said, True
            if not said:
                log.error("The take's notes could not all be written, and the take goes on: %r", e)
            return False

    def _echo(self, track, ns, note, velocity):
        """P8, under the lock, for a note-on between takes."""
        window = ECHO_MS * 1_000_000
        for other in self._tracks.values():
            if other is track or other.port is None:
                continue
            for i, (at, n, v) in enumerate(other.recent):
                if n == note and v == velocity and -window <= ns - at <= window:
                    # Each note matches once, and the card that comes later in
                    # the band names the first, whichever port is faster.
                    del other.recent[i]
                    first, later = (other, track) if other.index < track.index else (track, other)
                    pair = (first.name, later.name)
                    hits = min(self._echoes.get(pair, 0) + 1, ECHO_HITS)
                    self._echoes[pair] = hits
                    if hits >= ECHO_HITS:
                        later.echo = first.name
                    break
        track.recent.append((ns, note, velocity))

    # The watcher.

    def tick(self) -> None:
        """
        What the watcher does every TICK_SEC: a port that has sent active
        sensing and then nothing for more than SENSING_TIMEOUT_SEC is gone,
        held notes let go when it was last heard (F7); every fourth tick, and
        whenever the observer has said so, the list of ports is read again and
        every waiting track looks for its port; every fourth tick each port's
        clock is measured again; and the take's notes go to disk with the
        audio's flush, every FLUSH_INTERVAL_SEC.
        """
        flush = None
        with self._manage:
            if self._closed:
                return
            now = self._now()
            self._ticks += 1
            looking = self._ticks % _LOOK_EVERY == 0
            limit = int(SENSING_TIMEOUT_SEC * _NS)
            quiet = []
            with self._lock:
                for track in self._tracks.values():
                    port = track.port
                    if port is None or not port.sensing or port.silent_at is not None:
                        continue
                    # Read once: the port's thread may set it again meanwhile, and
                    # the silence is the one this time says. An event newer than
                    # it, still on the queue, ends the silence (`_event`).
                    heard = port.heard_ns
                    if now - heard > limit:
                        port.silent_at = heard
                        self._queue.put((None, "silent", port, heard))
                        quiet.append(track)
                take = self._take
                if take is not None and now >= take.flush_at:
                    take.flush_at = now + int(FLUSH_INTERVAL_SEC * _NS)
                    flush = take
            for track in quiet:
                log.info("%s: %s has stopped saying it is there", track.name, track.port.info.name)
            if looking or self._changed:
                self._look()
            if looking:
                self._resync()
        # Outside `_manage`: a flush waits for the disk, and Stop must not wait for it.
        if flush is not None:
            self._tell(flush, flush.recorder.flush)

    def _watch(self):
        due = time.monotonic() + TICK_SEC
        while not self._stopping.is_set():
            woke = self._wake.wait(max(0.0, due - time.monotonic()))
            if self._stopping.is_set():
                return
            if woke:
                self._wake.clear()
                if self._changed:
                    try:
                        self.refresh()
                    except Exception:
                        self._failed("the MIDI watcher")
            if time.monotonic() >= due:
                try:
                    self.tick()
                except Exception:
                    self._failed("the MIDI watcher")
                due += TICK_SEC
                if due < time.monotonic():
                    due = time.monotonic() + TICK_SEC

    def _on_change(self):
        """The system's observer, on its own thread: a look is asked for, nothing more."""
        self._changed = True
        self._wake.set()

    # Opening and closing, under `_manage`.

    def _look(self):
        self._changed = False
        self._settle(self._list())

    def _list(self):
        if self._system is None:
            return []
        try:
            return list(self._system.inputs())
        except Exception:
            self._failed("listing the MIDI ports")
            with self._lock:
                return list(self._ports)

    def _settle(self, listing):
        """Every track's port, and the check's, as the list of ports now says."""
        with self._lock:
            self._ports = listing
            tracks = list(self._tracks.values())
        for track in tracks:
            self._settle_track(track, listing)
        self._settle_checks(listing)

    def _settle_track(self, track, listing):
        found, ambiguous = None, False
        if self._system is not None and track.saved is not None:
            found, ambiguous = find_port(track.saved, listing)
        port = track.port
        # A port that went is a new one to the OS when it comes back, so one
        # that is no longer connected is closed even if its name is listed again.
        if port is not None and (port.info != found or not self._connected(port)):
            self._close(port)
            port = None
        if track.saved is None:
            status = "none"
        elif ambiguous:
            status = "ambiguous"
        elif found is None:
            status = "missing"
        elif port is None:
            port = self._open(track, found)
            status = "ok" if port is not None else "in_use"
        else:
            status = "ok"
        with self._lock:
            before = track.status
            track.found = found
            track.status = status
        if status != before:
            where = (found.name if found is not None else
                     track.saved["name"] if track.saved is not None else "no port")
            log.info("%s: %s, %s", track.name, where, status)

    def _settle_checks(self, listing):
        """P7: the other ports of the devices whose port a track picked, while checking."""
        with self._lock:
            wanted = []
            if self._check and self._take is None:
                picked = {t.found for t in self._tracks.values() if t.found is not None}
                devices = {info.device for info in picked if info.device}
                for info in listing:
                    if info.device in devices and info not in picked and info not in wanted:
                        wanted.append(info)
            open_now = list(self._checking.values())
        for port in open_now:
            if port.info not in wanted or not self._connected(port):
                self._close(port)
        for info in wanted:
            with self._lock:
                there = info in self._checking
            if not there:
                self._open(None, info)

    def _open(self, track, info):
        """A port opened for a track, or (track None) only to count; None if the OS
        would not."""
        now = self._now()
        port = _Port(track, info, now)
        try:
            port.port = self._system.open(info, self._listener(port))
        except PortBusy:
            return None
        except Exception:
            self._failed(f"opening the MIDI port {info.name}")
            return None
        with self._lock:
            if track is None:
                self._checking[info] = port
            else:
                track.port = port
                if self._take is not None:
                    self._queue.put((None, "present", port, now))
        return port

    def _listener(self, port):
        put = self._queue.put

        def on_event(ns, data):
            # On the port's own thread: when it was heard, and the queue. Nothing else.
            port.heard_ns = ns
            put((port, ns, data))

        return on_event

    def _close(self, port):
        """
        Stops listening to a port, and puts its end on the queue after whatever
        it said while it closed. A port closed while still connected (the band
        changed, the rehearsal ended) lets go of its notes now; one that is no
        longer connected went when it was last heard.
        """
        with self._lock:
            track = port.track
            if track is not None:
                if track.port is port:
                    track.port = None
            elif self._checking.get(port.info) is port:
                del self._checking[port.info]
        connected = self._connected(port)
        try:
            port.port.close()
        except Exception:
            self._failed(f"closing the MIDI port {port.info.name}")
        self._queue.put((None, "closed", port, self._now() if connected else port.heard_ns))

    def _connected(self, port):
        try:
            return bool(port.port.connected())
        except Exception:
            return False

    def _resync(self):
        with self._lock:
            ports = [t.port for t in self._tracks.values() if t.port is not None]
            ports += list(self._checking.values())
        for port in ports:
            try:
                port.port.resync()
            except Exception:
                self._failed(f"the clock of MIDI port {port.info.name}")

    def _end(self):
        """
        The take, once the writer has passed everything that was on the queue
        when it was asked; None when there is no take. The recorder is no longer
        the rig's, and is not touched by it again.
        """
        with self._manage:
            with self._lock:
                take = self._take
            if take is None:
                return None
            done = threading.Event()
            self._queue.put((None, "end", take, done))
            if self._writer is not None and self._writer.is_alive():
                if not done.wait(_END_PATIENCE_SEC):
                    log.error("The MIDI writer did not reach the end of the take in time")
            else:
                self.drain()
            with self._lock:
                if self._take is take:
                    self._take = None
            return take

    def _release(self):
        self.abandon_take()
        with self._lock:
            ports = [t.port for t in self._tracks.values() if t.port is not None]
            ports += list(self._checking.values())
            self._tracks = {}
            self._check = False
            self._zero()
        for port in ports:
            self._close(port)

    def _zero(self):
        """The counts start again. Under the lock."""
        self._counted = {}
        self._echoes = {}
        for track in self._tracks.values():
            track.notes = 0
            track.vel = 0
            track.echo = None
            track.recent.clear()

    def _failed(self, what):
        """
        Something nothing here expected, said in the log with its traceback, as
        the app's log keeps errors. Said once while it repeats, so one that
        comes back with every event or every tick does not fill the log.
        """
        failure = (what, repr(sys.exc_info()[1]))
        if failure != self._failure:
            self._failure = failure
            log.exception("%s", what)
