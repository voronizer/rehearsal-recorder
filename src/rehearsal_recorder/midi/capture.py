"""
One take's notes on disk: written as they are played, a .mid at Stop, and the
same .mid for a take whose app died first (spec F3, F5 and F7).

Nothing is kept in memory for the length of a take. Each event is a line
added to its track's `<name>.midraw` as it arrives, a few KB at a time and at
each flush, so an app that dies loses what the audio loses and no more: the
seconds since the last flush. The file is text, a line to a thing, and times
stay as the computer's own nanoseconds, the clock a port's thread stamped them
with:

    t <ns>          first: when the take began
    s <hex>         a message of the state the port was in then (F6), one a line
    n <ns> <hex>    an event: when it arrived, and its bytes
    g <ns>          the port went at this moment (F7), the last it was heard

Where on the audio a note belongs is worked out at the end, from the clock's
marks (midi/clock.py), because a line fitted through all of a take's marks is
better than any line through the marks so far. The kept marks go to `take.clock`
while the take is played, once in a while, so that a take that never got to its
end can be placed the way it would have been. `stop` and `finish_draft` read
the same files with the same code, and give the same .mid, up to the clock's
latest mark, which `stop` has and a file made a second ago does not.

What a .mid begins and ends with is decided there too, from the .midraw alone
(midi/state.py). The state at the take's start is the `s` lines with whatever
the port said before the take's first sample. Keys struck before then, and the
note-offs of keys that were held long before, are left out (F6). What is still
held when the take ends, or its port goes, is let go at that moment, and what
the port said while it was gone was not heard (F7). A key struck twice before
it is let go is let go twice: it is the strikes that are counted, not the keys.

A .mid is written under another name and moved into place, so a crash while it
is written never leaves half a file where a whole one is looked for. Until it is
whole its .midraw stays.

`MidiRecorder` is driven by two threads at once, the rig's writer (`feed`) and
its watcher (`present`, `gone`, `flush`), and has a lock of its own around each
call. The lock is never held while waiting for the disk to be sure (the fsync of
a flush) or while a .mid is made (the long part of `stop`), so neither stops the
other thread's calls. A disk that refuses a write is an OSError out of the call
that met it, and the recorder goes on: what the disk did not take stays in the
buffer for the next write, and a write it took only in part never leaves a
fragment for the next line to join (`_Sink`). Past a megabyte waiting the disk
has been refusing for good, and new lines are dropped: `NotesDropped`, an
OSError of its own so that a line lost can be told from one that waits, and one
line in the log for the file.
"""

import json
import logging
import math
import operator
import os
import re
import threading
import time
from pathlib import Path

from rehearsal_recorder.audio.capture import TAKE_RECORD, AudioRecorder
from rehearsal_recorder.midi.clock import MARK_EVERY_SEC, fit, load, save_line
from rehearsal_recorder.midi.smf import read_events, write_mid
from rehearsal_recorder.midi.state import PortState

# The app's log keeps ERROR and above (app.py). What the spec says goes there is
# logged at ERROR: lines being dropped, and a .mid that could not be made. What
# is said below that stays out of it.
log = logging.getLogger(__name__)

MIDRAW_SUFFIX = ".midraw"
CLOCK_FILE = "take.clock"
MID_SUFFIX = ".mid"
PART_SUFFIX = ".part"  # after .mid: a .mid that is being written

_MARK_EVERY_NS = int(MARK_EVERY_SEC * 1e9)

# What is waiting to be written goes to the file in one write at this size. A
# disk that has refused for a long time is not fed for ever: past this much
# waiting, a new line is not kept, and the call that met it raises.
_CHUNK = 8 * 1024
_WAITING_MAX = 1024 * 1024

# The lines of a .midraw. A time is an ns, which has at most 19 digits (clock.py
# has the same rule for the same reason), and a message is whole bytes in hex.
_T = re.compile(r"t (-?[0-9]{1,19})")
_S = re.compile(r"s ((?:[0-9a-fA-F]{2})+)")
_N = re.compile(r"n (-?[0-9]{1,19}) ((?:[0-9a-fA-F]{2})+)")
_G = re.compile(r"g (-?[0-9]{1,19})")


class NotesDropped(OSError):
    """
    A line that was not kept: the disk has refused writes for so long that a
    megabyte of lines is waiting for it. Any other OSError out of `feed`,
    `gone`, `present` or `flush` is a write the disk refused, with the line
    still waiting to be written when it takes it.
    """


class _Sink:
    """
    A file that lines are added to, buffered here and not by Python's own
    buffered writer, so that a disk that refuses leaves nothing but whole lines.

    The lines wait in `waiting` and go to the file together. A write the disk
    takes in part is counted (`written`) and the rest waits for the next try,
    so a line is always finished before the one after it begins. A write that
    fails with an error may have been taken in part, with no word of how much
    (Windows does that); the file is then cut back to `written` before the next
    try, which writes what was not counted again.
    """

    def __init__(self, path):
        self.path = path
        self.raw = open(path, "wb", buffering=0)
        self.waiting = bytearray()
        self.written = 0  # bytes the disk has said it has taken
        self.dirty = False  # a write failed: the file may hold more than `written`
        self.dropping = False  # lines have been dropped, and the log has said so

    def queue(self, data):
        """Adds lines to what waits, which is all it does: it raises only
        NotesDropped, and then nothing was added. Lines are dropped when a
        megabyte waits and the disk will not take it, said once in the log."""
        if len(self.waiting) >= _WAITING_MAX:
            try:
                self.drain()
            except OSError:
                pass
            if len(self.waiting) >= _WAITING_MAX:
                if not self.dropping:
                    self.dropping = True
                    log.error("%s: the disk has refused writes for so long that new lines are being dropped",
                              self.path.name)
                raise NotesDropped(f"{self.path.name}: the disk has refused writes for too long")
        self.waiting += data

    def write(self, data):
        """`queue`, and the lines to the file once a few KB wait. An OSError out
        of the second half is a refusal with the lines already queued."""
        self.queue(data)
        if len(self.waiting) >= _CHUNK:
            self.drain()

    def drain(self):
        """Everything that waits to the file, to the OS and not yet to the disk."""
        try:
            if self.dirty:
                self.raw.seek(self.written)
                self.raw.truncate(self.written)
                self.dirty = False
            while self.waiting:
                # None, from a file that cannot take it now, is nothing taken.
                taken = self.raw.write(self.waiting) or 0
                if taken <= 0:
                    raise OSError("the disk took nothing")
                self.written += taken
                del self.waiting[:taken]
        except OSError:
            self.dirty = True
            raise

    def fileno(self):
        return self.raw.fileno()

    def close(self):
        try:
            self.drain()
        finally:
            self.raw.close()


def note_stems(names):
    """
    The name each notes track's files have, `{track name: stem}`, for `names`
    in the band's order: the audio's own `safe_name`, and where two tracks
    make one (also on a disk that ignores case: "Keys" and "keys") the later
    ones are " (2)", " (3)". A name met again is the same track.

    The one source of these names: a notes file is `<stem>.midraw` and
    `<stem>.mid`, and take.json says `stem` for it before the recorder exists.
    """
    taken, stems = set(), {}
    for name in names:
        if name in stems:
            continue
        base = AudioRecorder.safe_name(name)
        stem, count = base, 1
        while stem.casefold() in taken:
            count += 1
            stem = f"{base} ({count})"
        taken.add(stem.casefold())
        stems[name] = stem
    return stems


class _Track:
    __slots__ = ("name", "port", "stem", "path", "sink", "made", "here")

    def __init__(self, name, port, stem, path):
        self.name = name
        self.port = port
        self.stem = stem
        self.path = path
        self.sink = None  # the open .midraw, None until the port appears and again once closed
        self.made = False  # the port has appeared: there is a file, open or closed
        self.here = False  # the port is there now


class MidiRecorder:
    """
    The notes of one take, a track to a file.

    `tracks` is every track of the take that takes notes, [{"name", "port"}],
    in the band's order. `states` is, for each of them by name, a copy of the
    port's PortState from the moment the take began, which its file begins with
    (F6); a track with none begins with nothing. `anchor` is the take's
    AudioClock, whose marks place the notes at `stop` and are saved as they are
    made.

    A track gets its file when its port first appears (`present`) and keeps it
    for good: a port that goes (`gone`) and returns is the same file. A port
    that never appears has no file and no .mid (F5), one that appears and says
    nothing has a .mid with only its names.

    Times are `time.perf_counter_ns()`, what the port's thread stamps its events
    with. `stop` and `abandon` are for after the writer has passed the take's
    end: nothing is taken once either has been called.
    """

    def __init__(self, out_dir, anchor, tracks, states):
        self._lock = threading.Lock()
        # Held by the stop that is making the .mid files: a second stop waits for it.
        self._finishing = threading.Lock()
        self._dir = Path(out_dir)
        self._anchor = anchor
        self._states = states or {}
        self._tracks = []
        self._by_name = {}
        stems = note_stems([track["name"] for track in tracks])
        for track in tracks:
            name = track["name"]
            if name in self._by_name:
                continue
            stem = stems[name]
            port = track.get("port")
            kept = _Track(name, str(port) if port is not None else "", stem,
                          self._dir / f"{stem}{MIDRAW_SUFFIX}")
            self._tracks.append(kept)
            self._by_name[name] = kept
        # take.clock: opened with the first mark to write, `_clock_frame` the
        # newest frame written, `_clock_at` the event time of the last look.
        self._clock_sink = None
        self._clock_frame = -1
        self._clock_at = None
        self._ended = False
        self._result = []

    def present(self, name, ns):
        """A port is there at `ns`: the first time, its file is made and begins
        with the state it was in; later, it is heard again."""
        with self._lock:
            track = self._by_name.get(name)
            if self._ended or track is None:
                return
            if not track.made:
                self._create(track, ns)
            track.here = True
            self._save_marks(ns)

    def feed(self, name, ns, data):
        """One message from a port, as it sent it. A port that is not there, a
        track this take does not have, and anything that is not bytes are not
        heard."""
        with self._lock:
            track = self._by_name.get(name)
            if self._ended or track is None or not track.here:
                return
            # Nothing else is turned into bytes: bytes(5) is five zeros (as in state.py).
            if not isinstance(data, (bytes, bytearray, memoryview, list, tuple)):
                return
            try:
                raw = bytes(data)
                ns = int(ns)
            except (TypeError, ValueError, OverflowError):
                return
            if not raw:
                return
            track.sink.write(f"n {ns} {raw.hex()}\n".encode("ascii"))
            self._save_marks(ns)

    def gone(self, name, ns):
        """A port is gone, and `ns` is the last time it was heard: whatever it
        held is let go there (F7). Nothing is heard from it until `present`.

        A disk that refuses the line loses the place it was let go at, and what
        was held through the gap is let go at the end instead: one that refuses
        this refuses the next lines too."""
        with self._lock:
            track = self._by_name.get(name)
            if self._ended or track is None or not track.here:
                return
            # Gone first, so that a disk that refuses the line does not leave a
            # port that is not there taking events.
            track.here = False
            track.sink.write(f"g {int(ns)}\n".encode("ascii"))
            self._save_marks(ns)

    def flush(self):
        """Everything to disk, the .midraw files and take.clock: with the
        audio's own flush, every 30 seconds. The marks not yet in take.clock go
        first, whenever the last was. All are tried, and the first error comes
        out when they have been.

        The lines go to the OS under the lock; the wait for the disk, which can
        be long, is outside it, on copies of the descriptors."""
        error, copies = None, []
        with self._lock:
            if self._ended:
                return
            try:
                self._save_marks(time.perf_counter_ns(), force=True)
            except OSError as e:
                error = e
            for sink in self._open_sinks():
                try:
                    sink.drain()
                except OSError as e:
                    error = error or e
                try:
                    copies.append(os.dup(sink.fileno()))
                except OSError as e:
                    error = error or e
        for fd in copies:
            try:
                os.fsync(fd)
            except OSError as e:
                error = error or e
            finally:
                try:
                    os.close(fd)
                except OSError:
                    pass
        if error is not None:
            raise error

    def stop(self, duration_sec):
        """
        The take is over, `duration_sec` of audio long: every .midraw becomes
        its .mid, and the .midraw files and take.clock are removed. Returns
        [{"name", "file", "port"}] for each track whose port appeared, in the
        band's order.

        It does not raise for a .mid it cannot make: that track is left out of
        the answer, said in the log, and its .midraw (and take.clock) stay
        where a recovery can find them.

        The recorder is over at once, and the .mid files are made without the
        lock, so the other thread's calls are not held up (they are ignored). A
        second stop waits for the first and gives its answer.
        """
        with self._finishing:
            with self._lock:
                first = not self._ended
                if first:
                    self._ended = True
                    marks = self._anchor.marks()
                    self._close()
            if not first:
                return [dict(note) for note in self._result]
            made, unfinished = [], False
            for track in self._tracks:
                if not track.made:
                    continue
                mid = self._dir / f"{track.stem}{MID_SUFFIX}"
                try:
                    _make_mid(track.path, mid, track.name, track.port, marks,
                              self._anchor.samplerate, duration_sec)
                except Exception as e:
                    log.error("%s: its notes could not be made into a .mid, and are kept as %s: %r",
                              track.name, track.path.name, e)
                    unfinished = True
                    continue
                made.append({"name": track.name, "file": str(mid), "port": track.port})
            if not unfinished:
                _forget_clock(self._dir)
            self._result = made
            return [dict(note) for note in made]

    def abandon(self):
        """Lets go of the files without finishing the take: what closing the
        window mid-take does. They stay as a crash would leave them, with the
        marks made so far, and the drafts finish them (`finish_draft`)."""
        with self._lock:
            if self._ended:
                return
            self._ended = True
            try:
                self._save_marks(time.perf_counter_ns(), force=True)
            except OSError as e:
                log.warning("take.clock: the last marks could not be saved: %r", e)
            self._close()

    def _create(self, track, ns):
        """Makes a track's .midraw with its first lines, which reach the OS at
        once: the file is never found without them. The take began when the
        clock says; a clock not started yet leaves this moment as the best
        there is."""
        started = self._anchor.started_ns
        state = self._states.get(track.name)
        if state is None:
            state = PortState()
        head = [f"t {started if started is not None else int(ns)}\n"]
        head += [f"s {message.hex()}\n" for message in state.start_messages()]
        sink = _Sink(track.path)
        try:
            sink.write("".join(head).encode("ascii"))
            sink.drain()
        except BaseException:
            # Not a file that is half begun: the next `present` makes it again.
            try:
                sink.raw.close()
            except OSError:
                pass
            try:
                track.path.unlink()
            except OSError:
                pass
            raise
        track.sink = sink
        track.made = True

    def _save_marks(self, ns, force=False):
        """The clock's new marks to take.clock, at most once in MARK_EVERY_SEC
        of event time: one comparison for the events in between, which come by
        the thousand, and a copy of the marks for the one that does not. Only
        the marks newer than the last written go in, and never the clock's
        latest, which is a mark of its own and not one of the kept ones the fit
        of `stop` and of a recovery both mean to be through (the last kept mark
        goes in with the next look). A time as far before the last look as
        after it is far enough too, so that one stray time cannot hold the
        marks back for good."""
        if not force and self._clock_at is not None and -_MARK_EVERY_NS < ns - self._clock_at < _MARK_EVERY_NS:
            return
        self._clock_at = ns
        new = []
        for mark in reversed(self._anchor.marks()[:-1]):
            if mark[1] <= self._clock_frame:
                break
            new.append(mark)
        if not new:
            return
        new.reverse()
        if self._clock_sink is None:
            self._clock_sink = _Sink(self._dir / CLOCK_FILE)
        self._clock_sink.queue("".join(map(save_line, new)).encode("ascii"))
        # Counted as written once they are waiting in the sink, which is all that
        # `queue` does: when the drain below fails they are still there, and
        # queued again at the next look they would be there twice.
        self._clock_frame = new[-1][1]
        # To the OS now, a line a second, so that an app that dies has them; the
        # disk gets them with the rest at the next flush.
        self._clock_sink.drain()

    def _open_sinks(self):
        sinks = [track.sink for track in self._tracks if track.sink is not None]
        if self._clock_sink is not None:
            sinks.append(self._clock_sink)
        return sinks

    def _close(self):
        for sink in self._open_sinks():
            try:
                sink.close()
            except OSError as e:
                # Closed all the same; the file has what reached the disk.
                log.warning("%s: closing it failed: %r", sink.path.name, e)
        for track in self._tracks:
            track.sink = None
            track.here = False
        self._clock_sink = None


def finish_draft(take_dir, duration_sec, samplerate=None):
    """
    Makes a .mid of every .midraw in a take's folder that the app never got to
    finish, and removes the .midraw files and take.clock. Returns
    [{"name", "file", "port"}], the name being the file's: a draft knows no other.
    A .mid that is already there with no .midraw beside it, which `stop` made
    before the app died, is one of the take's notes as it is (nothing is done to
    it) and is in the answer too, with its port from take.json, else the device
    name in the file, else its name. A `.mid.part` is what a conversion that was
    cut short left, and is removed.

    The samplerate and the ports' names come from take.json, which the audio
    wrote when the take began (the caller deletes it after this); `samplerate`
    stands in when it has none. With no samplerate at all the clock's marks are
    not used and the notes are placed by when the take began. A port take.json
    does not name is called what its file is.

    `duration_sec` is the audio's length. A take with no audio frames, 0 or
    None, keeps every event and lets go at the last of them, which is better
    than a take with no notes: that audio file was lost with everything else.
    """
    take_dir = Path(take_dir)
    try:
        record = json.loads((take_dir / TAKE_RECORD).read_text("utf-8"))
        if not isinstance(record, dict):
            record = {}
    except (OSError, ValueError):
        record = {}
    rate = next((r for r in (record.get("samplerate"), samplerate)
                 if isinstance(r, (int, float)) and not isinstance(r, bool) and math.isfinite(r) and r > 0), None)
    ports = {}
    notes = record.get("notes")
    for entry in notes if isinstance(notes, list) else []:
        if isinstance(entry, dict) and isinstance(entry.get("file"), str) and isinstance(entry.get("port"), str):
            ports.setdefault(entry["file"], entry["port"])
    marks = load(take_dir / CLOCK_FILE) if rate else []

    for leftover in take_dir.glob(f"*{MID_SUFFIX}{PART_SUFFIX}"):
        try:
            leftover.unlink()
        except OSError as e:
            log.warning("%s could not be removed: %r", leftover.name, e)

    raws = sorted(take_dir.glob(f"*{MIDRAW_SUFFIX}"))
    found, unfinished = [], False
    for raw in raws:
        port = ports.get(raw.stem) or raw.stem
        mid = raw.with_suffix(MID_SUFFIX)
        try:
            _make_mid(raw, mid, raw.stem, port, marks, rate, duration_sec)
        except Exception as e:
            log.error("%s: its notes could not be made into a .mid, and are kept: %r", raw.name, e)
            unfinished = True
            continue
        found.append({"name": raw.stem, "file": str(mid), "port": port})
    unconverted = {raw.stem for raw in raws}
    for mid in take_dir.glob(f"*{MID_SUFFIX}"):
        if mid.stem not in unconverted:
            found.append({"name": mid.stem, "file": str(mid),
                          "port": ports.get(mid.stem) or _device_name(mid) or mid.stem})
    found.sort(key=operator.itemgetter("name"))
    if not unfinished:
        _forget_clock(take_dir)
    return found


def _device_name(path):
    """The device name a .mid says it came from, "" if it says none or is not a
    file that can be read."""
    try:
        return read_events(path)[0]["device_name"]
    except Exception:
        return ""


def _forget_clock(folder):
    try:
        (Path(folder) / CLOCK_FILE).unlink(missing_ok=True)
    except OSError as e:
        log.warning("%s could not be removed: %r", CLOCK_FILE, e)


def _make_mid(raw_path, mid_path, track_name, port_name, marks, samplerate, duration_sec):
    """A .midraw as the .mid beside it, and the .midraw removed once the .mid is
    whole and on disk. Raises for what it cannot do; nothing then is left of the
    .mid, and the .midraw is as it was."""
    start, events = _place(_read(raw_path), marks, samplerate, duration_sec)
    part = mid_path.with_name(mid_path.name + PART_SUFFIX)
    try:
        write_mid(part, track_name=track_name, port_name=port_name, start=start, events=events)
        with open(part, "r+b") as f:
            os.fsync(f.fileno())
        os.replace(part, mid_path)
    except BaseException:
        try:
            part.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    try:
        raw_path.unlink(missing_ok=True)
    except OSError as e:
        log.warning("%s could not be removed: %r", raw_path.name, e)


def _read(path):
    """
    A .midraw as (when the take began or None, the start messages, the items),
    an item being (ns, bytes) for an event and (ns, None) for the port going.
    The items are in time order.

    Only a line that ends in its newline is a line: the last of a file whose app
    died is cut anywhere, and "n 12 90" cut from "n 12 9040" is an event, the
    wrong one. A line that is not one of the four, or whose time or bytes do
    not read, is passed over, wherever it is; the first `t` wins and the lines
    need not be in any order.
    """
    lines = Path(path).read_bytes().decode("ascii", "replace").split("\n")
    lines.pop()  # what follows the last newline: nothing, or a line cut short
    started, start, items = None, [], []
    for line in lines:
        if line.endswith("\r"):
            line = line[:-1]
        kind = line[:1]
        if kind == "n":
            found = _N.fullmatch(line)
            if found:
                items.append((int(found[1]), bytes.fromhex(found[2])))
        elif kind == "g":
            found = _G.fullmatch(line)
            if found:
                items.append((int(found[1]), None))
        elif kind == "s":
            found = _S.fullmatch(line)
            if found:
                start.append(bytes.fromhex(found[1]))
        elif kind == "t":
            found = _T.fullmatch(line)
            if found and started is None:
                started = int(found[1])
    # Arrival order is time order for a port, but the writer and the watcher are
    # two threads. Stable, so what is on one ns keeps the order it was written in.
    items.sort(key=operator.itemgetter(0))
    return started, start, items


def _place(raw, marks, samplerate, duration_sec):
    """
    What `write_mid` is given for a read .midraw: (the start messages, the
    events as (seconds on the audio, bytes)).

    - Seconds are the clock's line through `marks` (clock.fit), or, with none,
      from when the take began. A file with no first line is counted from its
      first event.
    - What the port said before the audio's first sample is not an event: it
      goes into the state the file begins with (F6). A key struck then is not
      written, nor is its release, nor that of any key the take did not strike
      itself: held long before, or held through a gap.
    - The rest, up to `duration_sec`, are kept. The strikes of each key are
      counted (a key struck again while down is let go once for each strike, as
      a DAW counts them), and a running state that starts where the file starts
      follows the pedals. At a moment the port went the strikes not let go are,
      in the order the keys were first pressed, and then the pedals that are
      down; at the end the same (F7). `duration_sec` of 0 or None has no end:
      everything is kept and the end is the last event.
    """
    started, start_messages, items = raw
    if started is None and items:
        started = items[0][0]
    seconds = fit(marks if samplerate else [], samplerate or 1, started)
    try:
        end = float(duration_sec)
    except (TypeError, ValueError):
        end = 0.0
    end = end if math.isfinite(end) and end > 0 else None

    when = [seconds(ns) for ns, _ in items]
    state = PortState()
    for message in start_messages:
        state.feed(message)
    for (_, data), sec in zip(items, when):
        if data is not None and sec < 0:
            state.feed(data)
    start = state.start_messages()

    running = PortState()
    for message in start:
        running.feed(message)
    struck = {}  # (channel, key) -> strikes of it not yet let go, the keys in the order first pressed
    out = []
    last = 0.0

    def let_go(at):
        for (channel, key), strikes in struck.items():
            for _ in range(strikes):
                message = bytes((0x80 | channel, key, 0))
                out.append((at, message))
                running.feed(message)
        struck.clear()
        for message in running.releases():
            if message[0] & 0xF0 == 0xB0:  # the pedals: the keys were just let go
                out.append((at, message))
                running.feed(message)

    for (_, data), sec in zip(items, when):
        if end is not None and sec >= end:
            continue
        if data is None:
            # A port that went before the take began went at its start.
            last = max(sec, last)
            let_go(last)
            continue
        if sec < 0:
            continue
        status = data[0]
        if 0x80 <= status < 0xA0 and len(data) == 3 and data[1] < 0x80 and data[2] < 0x80:
            key = (status & 0x0F, data[1])
            if status >= 0x90 and data[2]:
                struck[key] = struck.get(key, 0) + 1
            elif key in struck:
                if struck[key] > 1:
                    struck[key] -= 1
                else:
                    del struck[key]
            else:
                continue  # the release of a key this file never struck
        running.feed(data)
        out.append((sec, data))
        last = max(last, sec)
    let_go(end if end is not None else last)
    return start, out
