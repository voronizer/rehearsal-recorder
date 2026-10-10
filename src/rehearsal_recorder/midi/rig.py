"""
The rehearsal's MIDI ports: open for as long as the rehearsal is, counted for
the setup screen, watched as they come and go, and handed to each take.

A port is opened when the rehearsal starts and not when a take does, because
what was set before the take belongs in it: the pedal already down, the sound
already picked (spec F6). So between takes the rig keeps each port's PortState
and counts what it sends, for the meters, and during a take it also hands every
event to the take's MidiRecorder.

What is open, and what it has set, belongs to the port and not to the name of
the track it feeds. A port is opened once while any track or the check wants it,
and a track takes notes from it: a track renamed, two tracks that swap ports, a
port picked during the check that the check had open already, all keep the port
open and what it has set. That also matters to a system that lets a port be
opened only once, as classic Windows MIDI does (P5): the rig never asks it for a
port it has open. Two tracks on one port share it (P2 is what stops Start).

A track whose port is not there is not an error (D7). It waits, and the port is
opened when it is plugged in, during a take too: the observer says the list
changed (P4) and the rig also reads the list every fourth tick, in case it did
not. A port another app holds (P5), and one that two identical devices make it
impossible to tell (P1), wait the same way, each with its own word for the
screen. A device behind an interface's MIDI in that is switched off leaves its
port there; if it has been sending active sensing, its silence says it went
(F7). A port that goes, by either way or because nothing wants it any more, lets
go of what it held: in the take, when it was last heard (or now, for one closed
while still there), and in its state, so the next take does not begin with a
pedal down that was let up in this one.

Three kinds of thread meet here:

  - each open port's own, which calls `on_event`. That notes when the port was
    last heard and puts the event on one queue, and does nothing else, so a
    hi-hat pedal's stream of positions or a burst of SysEx never holds up the
    next event;
  - the writer, which takes the queue in order: the port's PortState, the
    counts, the loudest note, the same notes on two ports (P8), and the take's
    recorder. Which tracks a port feeds, and its coming and going, reach the
    writer on the same queue, as markers, so a port's events that were already
    waiting are written for the tracks it fed when they came, before it is
    said to be gone, and none of them is lost for arriving after. So do a
    take's beginning and end, and the counts starting again: an event that
    came before Start is in the state the take begins from, one after it is
    in the take, and a note that came before the counts started again is not
    counted after;
  - the watcher, every TICK_SEC of the rig's clock: a port that has gone quiet,
    the list of ports, each port's clock, and the recorder's flush with the
    audio's.

`threads=False` runs neither the writer nor the watcher, and whoever made the
rig calls `drain()` and `tick()`: the suites do, with a clock of their own.

Locks. `_manage` is held by whatever opens or closes ports or moves a track from
one to another (use, refresh, a tick's look, begin_take, the end of a take,
release), so they happen one at a time and the markers they put on the queue are
in the order things changed. `_lock` guards the rig's own state and is only ever
held briefly: never while a port is opened or closed, never while the recorder
is called. The writer takes `_lock` alone, so nothing it waits for waits for a
port. The order is `_manage`, then `_lock`, then a PortState's own lock; the
recorder's lock is taken by its own calls only, and the recorder calls nothing
here.

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
    A port the rig has open, whichever tracks it feeds: none for one the check
    only counts the notes of (P7).

    `state` is the port's PortState, kept by the rig for the whole rehearsal and
    found again when the port is opened again. `tracks` is the _Tracks that take
    notes from it now, as the rig's lock sees it, which the meters follow; `fed`
    is their names as the writer has reached them on the queue, which the take's
    recorder follows. `heard_ns` is set on the port's own thread as each event
    arrives (a single assignment), so a writer that is behind does not make a
    busy port look quiet. `sensing` and `silent_at` are under the rig's lock:
    whether it has sent active sensing, and the `heard_ns` at which it went
    quiet. `done` is the writer's own: it has passed the port's closing, and
    hears it no more.
    """

    __slots__ = ("info", "port", "state", "tracks", "fed", "heard_ns", "sensing", "silent_at", "done")

    def __init__(self, info, state, now):
        self.info = info
        self.port = None
        self.state = state
        self.tracks = []
        self.fed = []
        self.heard_ns = now
        self.sensing = False
        self.silent_at = None
        self.done = False


class _Track:
    """
    A track that takes notes, as the last `use` gave it, by its name: its port
    as saved, what the screen says of it, and its meters.
    """

    __slots__ = ("name", "saved", "index", "status", "port", "notes", "vel", "echo", "recent")

    def __init__(self, name):
        self.name = name
        self.saved = None  # the saved port (rules.port_of), None when none is picked
        self.index = 0  # its place in the band, for P8's "the later card"
        self.status = "none"  # what the screen says when no port is open for it
        self.port = None  # the _Port it takes notes from
        self.notes = 0
        self.vel = 0  # the loudest note-on since activity() last read it
        self.echo = None  # the track whose notes this one also gets (P8)
        self.recent = deque(maxlen=_ECHO_KEPT)  # (ns, note, velocity) for P8


class _Take:
    """
    One take: what it begins from, its recorder once the writer has begun it,
    and what the writer has told that recorder.
    """

    __slots__ = ("out_dir", "anchor", "tracks", "ports", "recorder", "begun", "here", "flush_at", "said", "over")

    def __init__(self, out_dir, anchor, tracks, ports, begun, flush_at):
        self.out_dir = out_dir
        self.anchor = anchor
        # (name, saved port's name, the _Port it takes notes from or None, the
        # kept PortState it begins from or None), in the band's order.
        self.tracks = tracks
        self.ports = ports  # the _Ports that tracks took notes from as it began
        # Made by the writer when it reaches the take's beginning on the queue,
        # set under the rig's lock; None until then, and for good if it never does.
        self.recorder = None
        # When it began on the rig's clock: the ports there then are present
        # from then.
        self.begun = begun
        # Track name -> the _Port it is present through, as far as the recorder
        # has been told. The writer's alone.
        self.here = {}
        self.flush_at = flush_at
        self.said = False  # a disk that refused has been said in the log
        self.over = False  # ended: a writer that has not begun it yet never will


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
        self._live = {}  # PortInfo -> _Port, every port open
        self._states = {}  # PortInfo -> PortState, every port opened this rehearsal
        self._ports = []  # the ports as last read
        self._counted = {}  # PortInfo -> note-ons heard on it, for the picker (P7)
        self._check = False
        self._echoes = {}  # (first track, later track) -> times the same note came on both
        self._take = None  # the take begun and not yet ended, as the app sees it
        self._writing = None  # the take the writer feeds: between its beginning and its end on the queue
        self._zeroing = 0  # times the counts started again that the writer has not yet reached
        self._ticks = 0
        self._changed = False  # the observer said the list changed
        self._closed = False
        self._failures = {}  # what failed -> how, as last said in the log
        self._failures_lock = threading.Lock()
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
        These are the band's tracks now. Every track that takes notes takes them
        from its port, opened if it is there and not open already; a port no
        track and no check wants any more is closed. With `check` the other ports
        of each picked port's device are opened too, only to count their notes,
        so the picker can show which of a keyboard's ports is being played (P7).
        Raises nothing for a port: one missing, in use or alike shows so in
        `activity`.
        """
        with self._manage:
            if self._closed:
                return
            listing = self._list()
            with self._lock:
                old, new, moved = self._tracks, {}, set()
                for given in tracks or ():
                    if not isinstance(given, dict) or not records_notes(given):
                        continue
                    name = given.get("name")
                    if not isinstance(name, str) or name in new:
                        continue
                    track = old.get(name) or _Track(name)
                    saved = port_of(given)
                    if name not in old or track.saved != saved:
                        moved.add(name)
                        track.saved = saved
                        track.echo = None
                        track.recent.clear()
                    track.index = len(new)
                    new[name] = track
                self._tracks = new
                self._check = bool(check)
                # An echo between tracks that are not both still here, on the
                # ports they had, is forgotten.
                self._echoes = {pair: hits for pair, hits in self._echoes.items()
                                if all(name in new and name not in moved for name in pair)}
                for track in new.values():
                    if track.echo is not None and (track.echo, track.name) not in self._echoes:
                        track.echo = None
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
        from a copy of the state of the port its saved port names (F6), and
        every track whose port is open and heard as there is present from now.
        The copies are made by the writer when it reaches the take's beginning
        on the queue, so every event that arrived before Start is in them and
        every one after goes to the take; this does not wait for that. A track
        whose port is not open, or is quiet, begins with what the port held let
        go (F7). The check's other ports close, and the counts start again. A
        take still recording is abandoned first, as abandon_take would: its
        notes stay for the drafts.
        """
        with self._manage:
            if self._closed:
                return
            if self._take is not None:
                self.abandon_take()
            with self._lock:
                self._check = False
                counting = [port for port in self._live.values() if not port.tracks]
            for port in counting:
                self._close(port)
            now = self._now()
            with self._lock:
                self._zero()
                tracks = []
                for track in self._tracks.values():
                    # The state is the port's, and the port is the one the
                    # track's saved port names: the one it takes notes from,
                    # else the one kept this rehearsal that the saved port
                    # finds (two alike are neither), else none heard yet.
                    port, kept = track.port, None
                    if port is not None:
                        kept = port.state
                    elif track.saved is not None:
                        info, _ = find_port(track.saved, list(self._states))
                        kept = self._states.get(info) if info is not None else None
                    tracks.append((track.name, track.saved["name"] if track.saved else "", port, kept))
                ports = [port for port in self._live.values() if port.tracks]
                take = _Take(out_dir, anchor, tracks, ports, now, now + int(FLUSH_INTERVAL_SEC * _NS))
                self._take = take
                # After every marker for the band as it is now, and after every
                # event that came before.
                self._queue.put((None, "begin", take, None, now))

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
        if take.recorder is None:
            log.error("The take's notes were never begun: the MIDI writer did not reach its start")
            return []
        try:
            return take.recorder.stop(duration_sec)
        except Exception as e:
            log.error("The take's notes could not be finished: %r", e)
            return []

    def abandon_take(self) -> None:
        """
        The take is dropped as a crash would leave it: once the writer has
        written what arrived before now, its .midraw files stay where they are,
        for the drafts to finish.
        """
        take = self._end()
        if take is not None and take.recorder is not None:
            try:
                take.recorder.abandon()
            except Exception as e:
                log.error("The take's notes could not be let go of: %r", e)

    def release(self) -> None:
        """The rehearsal is over: every port closes, and the tracks, what the ports
        had set and the counts are forgotten. A take still recording is abandoned."""
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
        else:
            self._fine("the MIDI writer")

    def _event(self, port, ns, data):
        """One message from a port, in the order the ports sent them."""
        if port.done or not data:
            return
        status = data[0]
        note_on = 0x90 <= status <= 0x9F and len(data) == 3 and data[1] < 0x80 and 0 < data[2] < 0x80
        with self._lock:
            if port.silent_at is not None and ns > port.silent_at:
                port.silent_at = None  # heard again
            if status == _SENSING:
                port.sensing = True
            else:
                port.state.feed(data)
            take = self._writing
            # A note that arrived before the counts last started again, and
            # that the writer reaches after, is not counted.
            if note_on and not self._zeroing:
                # Once for the port, whichever tracks it feeds.
                self._counted[port.info] = self._counted.get(port.info, 0) + 1
                for track in port.tracks:
                    track.notes += 1
                    track.vel = max(track.vel, data[2])
                    if take is None:
                        self._echo(track, ns, data[1], data[2])
            if take is None:
                return
            # A track the port feeds that is not yet present is made so by the
            # port's first event, unless the port is quiet: it went quiet and
            # has just been heard again, or a present that the disk refused is
            # tried again.
            names = [name for name in port.fed
                     if take.here.get(name) is port or (take.here.get(name) is None and port.silent_at is None)]
        for name in names:
            if take.here.get(name) is None and not self._present(take, port, name, ns):
                continue
            # Active sensing says the port is alive, and a .mid leaves it out (F2).
            if status != _SENSING:
                self._tell(take, take.recorder.feed, name, ns, data)

    def _marker(self, item):
        """
        A port that a track began or stopped taking notes from, that closed or
        that went quiet; a take's beginning or end; the counts started again:
        each in its place among the events.
        """
        _, kind, port, name, ns = item
        if kind == "begin":
            self._begin(port, ns)
            return
        if kind == "end":
            take, done = port, name
            with self._lock:
                if self._writing is take:
                    self._writing = None
            done.set()
            return
        if kind == "zeroed":
            with self._lock:
                self._zeroing -= 1
            return
        present, gone, state = [], [], None
        with self._lock:
            if kind == "closed":
                port.done = True
                self._let_go(port)
            elif kind == "silent":
                if port.silent_at != ns:
                    return  # heard again since
                self._let_go(port)
            elif kind == "attach" and name not in port.fed:
                port.fed.append(name)
            elif kind == "detach" and name in port.fed:
                port.fed.remove(name)
            take = self._writing
            if take is not None:
                if kind == "attach":
                    if not port.done and port.silent_at is None and take.here.get(name) is None:
                        present = [name]
                        # What the port said before this marker, in the order it
                        # said it: the program a keyboard says as it is plugged in
                        # came before the track was put on it, and was not fed.
                        state = port.state.copy()
                elif kind == "detach":
                    gone = [name] if take.here.get(name) is port else []
                else:
                    gone = [n for n in port.fed if take.here.get(n) is port]
            if kind == "closed":
                port.fed = []
        for n in present:
            self._present(take, port, n, ns, state)
        for n in gone:
            del take.here[n]
            self._tell(take, take.recorder.gone, n, ns)

    def _begin(self, take, ns):
        """
        The take's beginning, reached on the queue: every event that came before
        it is in the ports' states, so the copies the recorder begins from are
        made now, and every event after it goes to the take. A port that was
        quiet at Start, by when it was last heard, is not there: its track
        begins with what the port held let go (F7), even when the watcher saw
        the silence only after Start and its marker is still behind this one.
        A port open and heard at Start is there, though it may have gone quiet
        since: the marker that says so comes after this one.
        """
        with self._lock:
            if take.over:
                return
            states = {}
            for name, _, port, kept in take.tracks:
                if kept is None:
                    continue
                state = kept.copy()
                if port is None or not self._there(port, take):
                    for message in state.releases():
                        state.feed(message)
                states[name] = state
        recorder = MidiRecorder(take.out_dir, take.anchor,
                                [{"name": name, "port": saved} for name, saved, _, _ in take.tracks], states)
        with self._lock:
            if take.over:
                return
            take.recorder = recorder
            self._writing = take
            present = [(port, name) for port in take.ports if self._there(port, take) for name in port.fed]
        for port, name in present:
            if take.here.get(name) is None:
                self._present(take, port, name, ns)

    @staticmethod
    def _there(port, take):
        """Whether a port was there as a take began. Under the lock."""
        return not port.done and (port.silent_at is None or port.silent_at > take.begun)

    def _let_go(self, port):
        """A port that went lets go of what it held, in its state as in the take
        (F7): the next take does not begin with a pedal down. Under the lock."""
        for message in port.state.releases():
            port.state.feed(message)

    def _present(self, take, port, name, ns, state=None):
        if not self._tell(take, take.recorder.present, name, ns, state):
            return False  # tried again with the port's next event
        take.here[name] = port
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
        """P8, under the lock, for a note-on between takes. Two tracks on one port
        get the same notes because they are on one port, which P2 says."""
        window = ECHO_MS * 1_000_000
        for other in self._tracks.values():
            if other is track or other.port is None or other.port is track.port:
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
                for port in self._live.values():
                    if not port.sensing or port.silent_at is not None:
                        continue
                    # Read once: the port's thread may set it again meanwhile, and
                    # the silence is the one this time says. An event newer than
                    # it, still on the queue, ends the silence (`_event`).
                    heard = port.heard_ns
                    if now - heard > limit:
                        port.silent_at = heard
                        self._queue.put((None, "silent", port, None, heard))
                        quiet.append(port.info.name)
                take = self._take
                if take is not None and take.recorder is not None and now >= take.flush_at:
                    take.flush_at = now + int(FLUSH_INTERVAL_SEC * _NS)
                    flush = take
            for name in quiet:
                log.info("%s has stopped saying it is there", name)
            if looking or self._changed:
                self._look()
            if looking:
                self._resync()
        # Outside `_manage`: a flush waits for the disk, and Stop must not wait for it.
        if flush is not None:
            self._tell(flush, flush.recorder.flush)

    def _watch(self):
        """The watcher's thread: a tick every TICK_SEC of the rig's clock, and a
        look at once when the observer says the list changed."""
        step = int(TICK_SEC * _NS)
        due = self._now() + step
        while not self._stopping.is_set():
            wait = min(TICK_SEC, max(0.0, (due - self._now()) / _NS))
            woke = self._wake.wait(wait)
            if self._stopping.is_set():
                return
            if woke:
                self._wake.clear()
                if self._changed:
                    try:
                        self.refresh()
                    except Exception:
                        self._failed("the MIDI watcher")
                    else:
                        self._fine("the MIDI watcher")
            now = self._now()
            if now >= due:
                try:
                    self.tick()
                except Exception:
                    self._failed("the MIDI watcher")
                else:
                    self._fine("the MIDI watcher")
                due += step
                if due <= now:
                    due = now + step

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
            listing = list(self._system.inputs())
        except Exception:
            self._failed("listing the MIDI ports")
            with self._lock:
                return list(self._ports)
        self._fine("listing the MIDI ports")
        return listing

    def _settle(self, listing):
        """
        Every port as the list of ports now says, and every track on its port.
        In this order: what each track's saved port is now; the ports nobody
        wants any more, or that went, closed; the ports wanted and not open,
        opened; and each track moved to the port it is on. Closing first is what
        lets a system that opens a port once give a track the port the check had,
        and a port a track keeps is never closed to be opened again.
        """
        now = self._now()
        with self._lock:
            self._ports = listing
            tracks = list(self._tracks.values())
            checking = self._check and self._take is None
        found, statuses, wanted = {}, {}, []
        for track in tracks:
            info, ambiguous = None, False
            if self._system is not None and track.saved is not None:
                info, ambiguous = find_port(track.saved, listing)
            found[track.name] = info
            statuses[track.name] = ("none" if track.saved is None else "ambiguous" if ambiguous
                                    else "missing" if info is None else None)
            if info is not None and info not in wanted:
                wanted.append(info)
        if checking:
            devices = {info.device for info in wanted if info.device}
            for info in listing:
                if info.device in devices and info not in wanted:
                    wanted.append(info)

        with self._lock:
            live = list(self._live.values())
        for port in live:
            if port.info not in wanted or not self._connected(port):
                self._close(port)
        for info in wanted:
            with self._lock:
                there = info in self._live
            if not there:
                self._open(info)

        said = []
        with self._lock:
            for port in self._live.values():
                for track in list(port.tracks):
                    if self._tracks.get(track.name) is not track or found.get(track.name) != port.info:
                        # Moved, renamed or gone from the band, from a port still
                        # there: it lets go now.
                        port.tracks.remove(track)
                        track.port = None
                        self._queue.put((None, "detach", port, track.name, now))
            for track in tracks:
                info = found[track.name]
                port = self._live.get(info) if info is not None else None
                if port is not None and track.port is not port:
                    track.port = port
                    port.tracks.append(track)
                    port.tracks.sort(key=lambda t: t.index)
                    self._queue.put((None, "attach", port, track.name, now))
                status = statuses[track.name] or ("ok" if port is not None else "in_use")
                if status != track.status:
                    said.append((track.name, info.name if info is not None else
                                 track.saved["name"] if track.saved is not None else "no port", status))
                track.status = status
        for name, where, status in said:
            log.info("%s: %s, %s", name, where, status)

    def _open(self, info):
        """A port opened, with the state it had if it was open before in this
        rehearsal; None if the OS would not."""
        now = self._now()
        with self._lock:
            state = self._states.get(info)
            if state is None:
                state = self._states[info] = PortState()
        port = _Port(info, state, now)
        try:
            port.port = self._system.open(info, self._listener(port))
        except PortBusy:
            return None
        except Exception:
            self._failed(f"opening the MIDI port {info.name}")
            return None
        self._fine(f"opening the MIDI port {info.name}")
        with self._lock:
            self._live[info] = port
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
        changed, the rehearsal ended) lets go of what it held now; one that is
        no longer connected went when it was last heard.
        """
        with self._lock:
            if self._live.get(port.info) is port:
                del self._live[port.info]
            for track in port.tracks:
                track.port = None
            port.tracks = []
        connected = self._connected(port)
        try:
            port.port.close()
        except Exception:
            self._failed(f"closing the MIDI port {port.info.name}")
        else:
            self._fine(f"closing the MIDI port {port.info.name}")
        self._queue.put((None, "closed", port, None, self._now() if connected else port.heard_ns))

    def _connected(self, port):
        try:
            return bool(port.port.connected())
        except Exception:
            return False

    def _resync(self):
        with self._lock:
            ports = list(self._live.values())
        for port in ports:
            try:
                port.port.resync()
            except Exception:
                self._failed(f"the clock of MIDI port {port.info.name}")
            else:
                self._fine(f"the clock of MIDI port {port.info.name}")

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
            self._queue.put((None, "end", take, done, None))
            if self._writer is not None and self._writer.is_alive():
                if not done.wait(_END_PATIENCE_SEC):
                    log.error("The MIDI writer did not reach the end of the take in time")
            else:
                self.drain()
            with self._lock:
                take.over = True
                if self._take is take:
                    self._take = None
                if self._writing is take:
                    self._writing = None
            return take

    def _release(self):
        self.abandon_take()
        with self._lock:
            ports = list(self._live.values())
            self._tracks = {}
            self._check = False
            self._zero()
        for port in ports:
            self._close(port)
        with self._lock:
            self._states = {}
        with self._failures_lock:
            self._failures = {}

    def _zero(self):
        """
        The counts start again. Under the lock. The note-ons already on the
        queue are not counted: the writer counts nothing until it reaches the
        marker put here.
        """
        self._zeroing += 1
        self._queue.put((None, "zeroed", None, None, None))
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
        the app's log keeps errors. Each kind of failure is said once while it
        keeps coming back the same way, so one that comes back with every event
        or every tick does not fill the log, nor two that take turns. Once the
        same thing has worked (`_fine`), or the rehearsal is over, it is said
        again the next time.
        """
        how = repr(sys.exc_info()[1])
        with self._failures_lock:
            if self._failures.get(what) == how:
                return
            self._failures[what] = how
        log.exception("%s", what)

    def _fine(self, what):
        """What `_failed` was told of has worked: the next failure is said."""
        # Read without the lock first: this runs with every event, and is
        # almost always nothing to do.
        if what in self._failures:
            with self._failures_lock:
                self._failures.pop(what, None)
