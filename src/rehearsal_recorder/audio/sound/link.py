"""
The main process's side of the link to the sound process (host.py has the
other side).

`Link` starts the sound process with multiprocessing's spawn, as tempo
drift's count does (audio/drift.py), and asks it things down a pipe: make
an object (`new`, answered with a remote.Remote), call one of its methods,
read or set an attribute, run a function. Each question waits for its
answer, which is the method's return or what it raised. A question asked
before the sound process is up waits for it, START_PATIENCE_SEC at most.

What the sound process sends besides answers: its log lines, written here
(one writer, so lines never cross); an AudioClock's marks, put straight
into the main process's clock; a function's calls, made on a thread of
their own.

When the sound process ends without being asked to, every question waiting
gets SoundUnavailable, `on_event` handlers hear "sound_stopped", and it is
started again; when that one ends within AGAIN_WITHIN_SEC of the first, it
is left down ("sound_down"), `alive` is False, and every question raises
SoundUnavailable until РЭХА is restarted.

Pickle is safe here: the pipe is the one multiprocessing made between this
process and the sound process it started, and nothing else writes to it.
"""

import collections
import functools
import io
import itertools
import logging
import multiprocessing
import pickle
import queue
import threading
import time
import types
import weakref

from rehearsal_recorder.audio.sound import IsMethod, SoundUnavailable, mapped
from rehearsal_recorder.audio.sound.remote import Remote
from rehearsal_recorder.midi.clock import AudioClock

log = logging.getLogger(__name__)

# How long a question waits for the sound process to start, as tempo
# drift's count does (audio/drift.START_PATIENCE_SEC).
START_PATIENCE_SEC = 30

# How long a question the screen asks waits for its answer before it says
# the sound process is not answering.
QUICK_ANSWER_SEC = 10

# A sound process that ends again within this long of the last is left down.
AGAIN_WITHIN_SEC = 60

# How long a closing app waits for the sound process to end by itself.
QUIT_SEC = 2

STOPPED = "Recording stopped: РЭХА's sound stopped working. The take is kept up to this moment."
DOWN = "РЭХА's sound stopped working. Restart РЭХА to play or record again."
NOT_STARTED = f"РЭХА's sound did not start in {START_PATIENCE_SEC} s. Restart РЭХА to play or record."
NOT_ANSWERING = "РЭХА's sound is not answering."


class _Slot:
    __slots__ = ("event", "ok", "value", "callbacks")

    def __init__(self):
        self.event = threading.Event()
        self.ok = False
        self.value = None
        self.callbacks = ()

    def done(self, ok, value):
        self.ok, self.value = ok, value
        self.event.set()


class _Pickler(pickle.Pickler):
    def __init__(self, file, link):
        super().__init__(file, protocol=pickle.HIGHEST_PROTOCOL)
        self.link = link
        self.callbacks = []

    def persistent_id(self, obj):
        link = self.link
        if isinstance(obj, Remote):
            if obj._gen != link.gen:
                raise SoundUnavailable(STOPPED)
            return ("ref", obj._handle, obj._gen)
        if isinstance(obj, AudioClock):
            return ("clock", link._clock_id(obj), obj.samplerate)
        if obj is _portaudio():
            return ("sd",)
        if isinstance(obj, (types.FunctionType, types.MethodType, functools.partial)):
            cid = link._callback(obj)
            self.callbacks.append(cid)
            return ("cb", cid)
        return mapped.reference(obj)


class _Unpickler(pickle.Unpickler):
    def __init__(self, file, link, gen):
        super().__init__(file)
        self.link = link
        self.gen = gen

    def persistent_load(self, pid):
        tag = pid[0]
        if tag == "ref":
            return self.link._remote_for(pid[1], pid[2], self.gen)
        if tag == "clock":
            return self.link._clocks.get(pid[1])
        if tag == "mapped":
            return mapped.load(pid)
        raise pickle.UnpicklingError(f"unknown reference {tag!r}")


def _portaudio():
    from rehearsal_recorder.audio.devices import sd

    return sd


class Link:
    def __init__(self, local=False, prepare=None):
        self.local = local
        self.alive = True
        self.gen = 0
        self.devices = None  # the sound process's device list: view.py
        self._handlers = []
        if local:
            return
        self._prepare = prepare
        self._lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._pending = {}
        self._ids = itertools.count(1)
        self._remotes = weakref.WeakValueDictionary()
        self._got = {}
        self._forget = collections.deque()
        self._clocks = weakref.WeakValueDictionary()
        self._clock_ids = weakref.WeakKeyDictionary()
        self._clock_next = itertools.count(1)
        self._callbacks = {}
        self._callback_next = itertools.count(1)
        self._methods = {}
        self._events = queue.SimpleQueue()
        self._closing = False
        self._last_death = None
        self._ready = threading.Event()
        self._conn = None
        self._process = None
        threading.Thread(target=self._dispatch, name="sound-events", daemon=True).start()
        self._spawn(again=False)

    # ---------- events ----------

    def on_event(self, fn):
        """`fn(name, payload)` hears "sound_started", "sound_stopped" and
        "sound_down", on a thread of the link's."""
        self._handlers.append(fn)

    def _emit(self, name, payload):
        if not self.local:
            self._events.put(("emit", name, payload))

    def _dispatch(self):
        while True:
            item = self._events.get()
            try:
                tag = item[0]
                if tag == "emit":
                    for fn in list(self._handlers):
                        fn(item[1], item[2])
                elif tag == "log":
                    record = logging.makeLogRecord(item[1])
                    logging.getLogger(record.name).handle(record)
                elif tag == "callback":
                    cid, args, kw = item[1]
                    fn = self._callbacks.get(cid)
                    if fn is not None:
                        fn(*args, **kw)
                elif tag == "drop":
                    for cid in item[1]:
                        self._callbacks.pop(cid, None)
            except Exception:  # noqa: BLE001 - the next event still goes
                log.exception("An event from РЭХА's sound process failed")

    # ---------- the process ----------

    def _spawn(self, again):
        from rehearsal_recorder.audio.sound import host

        context = multiprocessing.get_context("spawn")
        ours, theirs = context.Pipe()
        process = context.Process(target=host.main, args=(theirs, self._prepare),
                                  name="sound", daemon=True)
        asked = time.perf_counter()
        try:
            process.start()
        except BaseException:
            ours.close()
            raise
        finally:
            theirs.close()
        with self._lock:
            gen = self.gen
            self._conn, self._process = ours, process
        threading.Thread(target=self._read, args=(ours, process, gen, asked, again),
                         name="sound-link", daemon=True).start()

    def _read(self, conn, process, gen, asked, again):
        while True:
            try:
                data = conn.recv_bytes()
            except (EOFError, OSError):
                break
            try:
                msg = _Unpickler(io.BytesIO(data), self, gen).load()
            except Exception:  # noqa: BLE001 - one that cannot be read
                log.exception("Something from РЭХА's sound process could not be read")
                continue
            tag = msg[0]
            if tag == "answer":
                _, rid, ok, value = msg
                with self._lock:
                    slot = self._pending.pop(rid, None)
                if slot is not None:
                    slot.done(ok, value)
            elif tag == "event":
                self._host_event(msg[1], msg[2])
            elif tag == "ready":
                info = msg[1]
                self.devices = info.get("list")
                took = time.perf_counter() - asked
                if info.get("list", {}).get("trouble"):
                    log.error("РЭХА's sound process could not list the devices: %s", info["list"]["trouble"])
                log.info("РЭХА's sound process %s in %.2f s (pid %s)",
                         "started again" if again else "started", took, info.get("pid"))
                with self._lock:
                    if gen == self.gen:
                        self._ready.set()
                self._emit("sound_started", {"took": took, "again": again})
        self._died(gen, process)

    def _host_event(self, name, payload):
        if name == "clock":
            # Here, not on the events thread: a take's answer comes after its
            # marks, and whoever reads the clock after the answer finds them.
            cid, op, args = payload
            clock = self._clocks.get(cid)
            if clock is None:
                return
            if op == "keep":
                clock._keep(args[0])
            elif op == "latest":
                clock.mark_latest(*args)
            elif op == "set":
                setattr(clock, args[0], args[1])
        elif name == "log":
            self._events.put(("log", payload))
        elif name == "callback":
            self._events.put(("callback", payload))

    def _died(self, gen, process):
        with self._lock:
            if gen != self.gen:
                return
            self.gen += 1
            pending, self._pending = self._pending, {}
            self._remotes = weakref.WeakValueDictionary()
            self._got = {}
            self._forget.clear()
            # Whoever waits for the process that died wakes and asks again:
            # for the one started now, or hears that it is left down.
            woken, self._ready = self._ready, threading.Event()
            closing = self._closing
            now = time.monotonic()
            again = not closing and (self._last_death is None or now - self._last_death > AGAIN_WITHIN_SEC)
            if not closing:
                self._last_death = now
                if not again:
                    self.alive = False
        woken.set()
        for slot in pending.values():
            slot.done(False, SoundUnavailable(STOPPED))
        if closing:
            return
        process.join(1)
        log.error("РЭХА's sound process stopped (exit code %s)", process.exitcode)
        self._emit("sound_stopped", {"code": process.exitcode, "again": again})
        if again:
            try:
                self._spawn(again=True)
                return
            except Exception:  # noqa: BLE001 - then it is down
                log.exception("РЭХА's sound process could not be started again")
                with self._lock:
                    self.alive = False
                    woken, self._ready = self._ready, threading.Event()
                woken.set()
        log.error("РЭХА's sound process stopped again within %d s: it is left down until РЭХА is restarted",
                  AGAIN_WITHIN_SEC)
        self._emit("sound_down", {})

    def close(self):
        """The app is closing: the sound process is asked to end, then made to."""
        if self.local:
            return
        with self._lock:
            self._closing = True
            # Asked anything from now on, it says sound is unavailable.
            self.alive = False
            conn, process = self._conn, self._process
        try:
            with self._send_lock:
                conn.send_bytes(pickle.dumps(("quit",)))
        except Exception:  # noqa: BLE001 - it is gone already
            pass
        if process is not None:
            process.join(QUIT_SEC)
            if process.is_alive():
                process.kill()
                process.join(QUIT_SEC)
        log.info("РЭХА's sound process stopped, as the app closed")

    def pid(self):
        process = self._process
        return None if process is None else process.pid

    def wait_started(self, timeout=START_PATIENCE_SEC):
        """Whether the sound process is up, waiting `timeout` at most."""
        deadline = time.monotonic() + timeout
        while True:
            with self._lock:
                alive, ready, gen = self.alive, self._ready, self.gen
            if not alive:
                return False
            if not ready.wait(max(0.0, deadline - time.monotonic())):
                return False
            with self._lock:
                if self.alive and self.gen == gen:
                    return True

    # ---------- references ----------

    def _remote_for(self, handle, kind, gen):
        with self._lock:
            if gen != self.gen:
                return Remote(self, handle, gen, kind)
            self._got[handle] = self._got.get(handle, 0) + 1
            remote = self._remotes.get(handle)
            if remote is None:
                remote = Remote(self, handle, gen, kind)
                self._remotes[handle] = remote
            return remote

    def dropped(self, handle, gen):
        """A stand-in is gone: the object it stood for is let go there, with
        the next question (unless a new stand-in holds it by then)."""
        if gen == self.gen:
            self._forget.append(handle)

    def _clock_id(self, clock):
        with self._lock:
            cid = self._clock_ids.get(clock)
            if cid is None:
                cid = next(self._clock_next)
                self._clock_ids[clock] = cid
                self._clocks[cid] = clock
            return cid

    def _callback(self, fn):
        cid = next(self._callback_next)
        self._callbacks[cid] = fn
        return cid

    # ---------- questions ----------

    def _wait_ready(self):
        deadline = time.monotonic() + START_PATIENCE_SEC
        while True:
            with self._lock:
                alive, ready, gen = self.alive, self._ready, self.gen
            if not alive:
                raise SoundUnavailable(DOWN)
            if ready.wait(max(0.0, deadline - time.monotonic())):
                with self._lock:
                    if not self.alive:
                        raise SoundUnavailable(DOWN)
                    if self.gen == gen:
                        return gen
                continue
            raise SoundUnavailable(NOT_STARTED)

    def _ask(self, build, quick=False, of=None):
        """`build(rid)` sent and its answer waited for. `of`: the generation
        of the stand-in asked, refused if the process is another one now (a
        handle there names another object)."""
        if not self.alive:
            raise SoundUnavailable(DOWN)
        gen = self._wait_ready()
        if of is not None and of != gen:
            raise SoundUnavailable(STOPPED)
        rid = next(self._ids)
        buf = io.BytesIO()
        pickler = _Pickler(buf, self)
        slot = _Slot()
        try:
            pickler.dump(build(rid))
        except BaseException:
            if pickler.callbacks:
                self._events.put(("drop", tuple(pickler.callbacks)))
            raise
        # Kept until the answer, and let go of with a call that goes no
        # further.
        slot.callbacks = tuple(pickler.callbacks)
        try:
            return self._sent_and_answered(rid, gen, buf, slot, quick)
        except BaseException:
            if slot.callbacks and not slot.event.is_set():
                self._events.put(("drop", slot.callbacks))
            raise

    def _sent_and_answered(self, rid, gen, buf, slot, quick):
        with self._lock:
            if gen != self.gen:
                raise SoundUnavailable(STOPPED)
            self._pending[rid] = slot
            conn = self._conn
            forgets = []
            while self._forget:
                handle = self._forget.popleft()
                if handle not in self._remotes:
                    forgets.append(pickle.dumps(("forget", handle, self._got.get(handle, 0))))
        try:
            with self._send_lock:
                for message in forgets:
                    conn.send_bytes(message)
                conn.send_bytes(buf.getvalue())
        except (OSError, EOFError, ValueError):
            with self._lock:
                self._pending.pop(rid, None)
            raise SoundUnavailable(STOPPED) from None
        if not slot.event.wait(QUICK_ANSWER_SEC if quick else None):
            with self._lock:
                self._pending.pop(rid, None)
            raise SoundUnavailable(NOT_ANSWERING)
        if slot.callbacks:
            self._events.put(("drop", slot.callbacks))
        if slot.ok:
            return slot.value
        raise slot.value

    def new(self, kind, *args, **kw):
        """A `kind` (host.kinds) made in the sound process: its stand-in."""
        return self._ask(lambda rid: ("new", rid, kind, args, kw))

    def function(self, name, *args, **kw):
        """`name` (host._function) run in the sound process: its answer."""
        return self._ask(lambda rid: ("fn", rid, name, args, kw))

    def call(self, remote, name, *args, **kw):
        from rehearsal_recorder.audio.sound.host import QUICK

        if remote._gen != self.gen:
            raise SoundUnavailable(STOPPED)
        return self._ask(lambda rid: ("call", rid, remote._handle, name, args, kw), quick=name in QUICK,
                         of=remote._gen)

    def get(self, remote, name):
        known = self._methods.get(remote.kind)
        if known is not None and name in known:
            return functools.partial(self.call, remote, name)
        if remote._gen != self.gen:
            raise SoundUnavailable(STOPPED)
        value = self._ask(lambda rid: ("get", rid, remote._handle, name), quick=True, of=remote._gen)
        if isinstance(value, IsMethod):
            self._methods.setdefault(remote.kind, set()).add(name)
            return functools.partial(self.call, remote, name)
        return value

    def set(self, remote, name, value):
        if remote._gen != self.gen:
            raise SoundUnavailable(STOPPED)
        self._ask(lambda rid: ("set", rid, remote._handle, name, value), of=remote._gen)
