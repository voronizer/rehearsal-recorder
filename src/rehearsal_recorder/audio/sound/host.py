"""
The sound process's side of the link (link.py has the main process's).

`main` is what the second process runs. It makes the objects the main
process asks for, by kind, from KINDS, and runs what is asked of them:
each object's calls one after another on a thread of its own, so a Play is
never overtaken by the seek asked after it, and a slow stop holds up nothing
else; what the screen reads (attributes, and QUICK methods) on a pool of
four threads beside them, as the screen's thread did beside the others
before.

What it answers is pickled with the objects it made in it as references
(the main process gets a stand-in for each); what it is sent, the other way.
An AudioClock sent from the main process becomes one here that tells the
main process's of every mark; a function sent becomes one that tells the
main process to call it, with no answer.

Pickle is safe here: the pipe is the one multiprocessing made between this
process and the РЭХА that started it, and nothing else writes to it.

The process watches the pipe and its parent: when either goes, every
recorder lets its files go, closed, and the process ends. The take is then
recovered as after a crash.
"""

import importlib
import io
import logging
import multiprocessing
import multiprocessing.connection
import os
import pickle
import queue
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from rehearsal_recorder.midi.clock import AudioClock

log = logging.getLogger(__name__)

# Methods the screen asks several times a second: they run beside the
# object's other calls, not after them.
QUICK = frozenset({
    "state", "output_problem", "problem", "is_active", "get_levels",
    "upcoming", "count_state", "skips", "fell_asleep", "heard_sec",
    "fault", "record", "backing_record",
})

# How often a clock's newest frame is told to the main process at most: its
# kept marks (one a second) go at once.
LATEST_EVERY_SEC = 0.05

# How long an object's thread waits for a call before it lets go of itself
# (the object is still there; the next call starts it again).
IDLE_SEC = 30.0


def _classes():
    """{kind: what makes it}: every object the main process may ask for."""
    from rehearsal_recorder.audio.backing_source import BackingSource, Sources
    from rehearsal_recorder.audio.capture import AudioRecorder
    from rehearsal_recorder.audio.click_output import ClickOutput, SilentOutput
    from rehearsal_recorder.audio.click_source import ClickSource, following
    from rehearsal_recorder.audio.monitor import LevelMonitor
    from rehearsal_recorder.audio.player import TakePlayer
    from rehearsal_recorder.audio.probe import InterfaceCheck
    from rehearsal_recorder.audio.take_click import TakeBacking, TakeClick

    return {
        "TakePlayer": TakePlayer,
        "AudioRecorder": AudioRecorder,
        "LevelMonitor": LevelMonitor,
        "ClickOutput": ClickOutput,
        "SilentOutput": SilentOutput,
        "ClickSource": ClickSource,
        "BackingSource": BackingSource,
        "Sources": Sources,
        "TakeClick": TakeClick,
        "TakeBacking": TakeBacking,
        "InterfaceCheck": InterfaceCheck,
        # A click that keeps to a backing track's bars (backing.py).
        "FollowingClick": following,
    }


_KINDS = None


def kinds():
    global _KINDS
    if _KINDS is None:
        _KINDS = _classes()
    return _KINDS


def make(kind, args, kw):
    """A `kind` made here."""
    try:
        what = kinds()[kind]
    except KeyError:
        raise ValueError(f"No sound object of kind {kind!r}") from None
    return what(*args, **kw)


def _device_list():
    """The device list as plain data: what the main process reads instead
    of PortAudio (view.py)."""
    from rehearsal_recorder.audio.devices import sd

    devices = [dict(d) for d in sd.query_devices()]
    hostapis = [dict(h) for h in sd.query_hostapis()]
    try:
        default = [int(i) for i in sd.default.device]
    except Exception:  # noqa: BLE001 - no default is a default of none
        default = [-1, -1]
    return {"devices": devices, "hostapis": hostapis, "default": default}


def _rescan():
    from rehearsal_recorder.audio.devices import rescan

    trouble = rescan()
    return trouble, _device_list()


def _check(which, kw):
    from rehearsal_recorder.audio.devices import AUDIO_THREAD, sd

    check = getattr(sd, f"check_{which}_settings")
    return AUDIO_THREAD.run(lambda: check(**kw))


def _microphone(device):
    """The input opened and closed again: on a Mac, the system's question
    for the microphone comes now, not at the first take."""
    from rehearsal_recorder.audio.devices import sd

    try:
        with sd.InputStream(device=device, channels=1):
            time.sleep(0.5)
    except Exception:  # noqa: BLE001 - the question comes at the first take instead
        pass


def _portaudio_version():
    from rehearsal_recorder.audio.devices import sd

    return sd.get_portaudio_version()[1]


def _rtmixer_version():
    from rehearsal_recorder.audio.ring import _rtmixer

    return _rtmixer().__version__


def _function(name):
    from rehearsal_recorder.audio import devices

    table = {
        "devices.list": _device_list,
        "devices.rescan": _rescan,
        "devices.check_input_settings": lambda **kw: _check("input", kw),
        "devices.check_output_settings": lambda **kw: _check("output", kw),
        "devices.recording_formats": devices.recording_formats,
        "devices.usable_output": devices.usable_output,
        "microphone": _microphone,
        "portaudio_version": _portaudio_version,
        "rtmixer_version": _rtmixer_version,
    }
    try:
        return table[name]
    except KeyError:
        raise ValueError(f"No sound function {name!r}") from None


def run_function(name, args, kw):
    return _function(name)(*args, **kw)


# ---------- what crosses the pipe ----------


def portable(e):
    """An exception the main process can unpickle without sounddevice."""
    from rehearsal_recorder.audio.sound import PortAudioError

    module = type(e).__module__ or ""
    if module.split(".")[0] in ("sounddevice", "_sounddevice", "rtmixer", "_rtmixer", "cffi"):
        out = PortAudioError(*e.args)
    else:
        out = e
    try:
        pickle.loads(pickle.dumps(out))
    except Exception:  # noqa: BLE001 - one that will not travel goes as words
        out = RuntimeError(f"{type(e).__name__}: {e}")
    out.remote_traceback = "".join(traceback.format_exception(type(e), e, e.__traceback__))
    return out


class ForwardedClock(AudioClock):
    """An AudioClock the main process sent: marked here, by the recorder,
    and every mark told to the main process's own, which the take's notes
    read."""

    def __init__(self, samplerate, cid, emit):
        self._emit = None
        super().__init__(samplerate)
        self._cid = cid
        self._latest_told = 0.0
        self._emit = emit

    def __setattr__(self, name, value):
        object.__setattr__(self, name, value)
        if name in ("latency_sec", "started_ns") and self.__dict__.get("_emit") is not None:
            self._emit("clock", (self._cid, "set", (name, value)))

    def _keep(self, mark):
        super()._keep(mark)
        self._emit("clock", (self._cid, "keep", (mark,)))

    def mark_latest(self, ns, frame):
        super().mark_latest(ns, frame)
        now = time.monotonic()
        if now - self._latest_told >= LATEST_EVERY_SEC:
            self._latest_told = now
            self._emit("clock", (self._cid, "latest", (ns, frame)))


class _Pickler(pickle.Pickler):
    def __init__(self, file, host):
        super().__init__(file, protocol=pickle.HIGHEST_PROTOCOL)
        self.host = host

    def persistent_id(self, obj):
        host = self.host
        if isinstance(obj, ForwardedClock):
            return ("clock", obj._cid)
        if type(obj) in host.made_types:
            return ("ref", host.ref(obj), obj.kind)
        return None


class _Unpickler(pickle.Unpickler):
    def __init__(self, file, host):
        super().__init__(file)
        self.host = host

    def persistent_load(self, pid):
        host = self.host
        tag = pid[0]
        if tag == "ref":
            try:
                return host.objects[pid[1]]
            except KeyError:
                raise LookupError(f"sound object #{pid[1]} is gone") from None
        if tag == "clock":
            return host.clock(pid[1], pid[2])
        if tag == "cb":
            return host.callback(pid[1])
        if tag == "sd":
            from rehearsal_recorder.audio.devices import sd

            return sd
        raise pickle.UnpicklingError(f"unknown reference {tag!r}")


# ---------- the process ----------


class _Serial:
    """One object's calls, one after another, on a thread of its own."""

    def __init__(self, name):
        self.name = name
        self.jobs = queue.SimpleQueue()
        self.thread = None
        self.lock = threading.Lock()

    def put(self, job):
        self.jobs.put(job)
        with self.lock:
            if self.thread is None or not self.thread.is_alive():
                self.thread = threading.Thread(target=self._run, name=self.name, daemon=True)
                self.thread.start()

    def _run(self):
        while True:
            try:
                job = self.jobs.get(timeout=IDLE_SEC)
            except queue.Empty:
                with self.lock:
                    if self.jobs.empty():
                        self.thread = None
                        return
                continue
            if job is None:
                return
            job()


class _ToMain(logging.Handler):
    """The process's log lines, sent to the main process to be written."""

    def __init__(self, host):
        super().__init__(logging.DEBUG)
        self.host = host

    def emit(self, record):
        try:
            exc = record.exc_text
            if record.exc_info and not exc:
                exc = logging.Formatter().formatException(record.exc_info)
            self.host.event("log", {
                "name": record.name, "levelno": record.levelno, "levelname": record.levelname,
                "msg": record.getMessage(), "args": None, "exc_text": exc,
                "created": record.created, "msecs": record.msecs,
                "threadName": f"sound:{record.threadName}", "processName": "sound",
                "pathname": record.pathname, "filename": record.filename,
                "module": record.module, "lineno": record.lineno, "funcName": record.funcName,
            })
        except Exception:  # noqa: BLE001 - a line that cannot go is let go
            pass


class Host:
    def __init__(self, conn):
        self.conn = conn
        self.send_lock = threading.Lock()
        self.objects = {}  # handle -> object
        self.handles = {}  # id(object) -> handle
        self.sent = {}  # handle -> references sent
        self.serials = {}  # handle -> _Serial
        self.clocks = {}  # cid -> ForwardedClock
        self.next = 1
        self.lock = threading.Lock()
        self.made_types = {cls for cls in kinds().values() if isinstance(cls, type)}
        self.quick = ThreadPoolExecutor(max_workers=4, thread_name_prefix="sound-quick")
        self.making = _Serial("sound-new")
        self.functions = _Serial("sound-functions")
        self.ending = threading.Event()

    # what goes to the main process

    def send(self, msg):
        buf = io.BytesIO()
        _Pickler(buf, self).dump(msg)
        data = buf.getvalue()
        with self.send_lock:
            self.conn.send_bytes(data)

    def event(self, name, payload):
        try:
            self.send(("event", name, payload))
        except Exception:  # noqa: BLE001 - the pipe is going; the reader sees it
            pass

    def answer(self, rid, fn):
        try:
            value, ok = fn(), True
        except BaseException as e:  # noqa: BLE001 - the caller gets it
            value, ok = portable(e), False
        try:
            self.send(("answer", rid, ok, value))
        except (OSError, EOFError):
            return
        except Exception as e:  # noqa: BLE001 - an answer that cannot be pickled
            self.send(("answer", rid, False, portable(e)))

    # references

    def ref(self, obj):
        with self.lock:
            handle = self.handles.get(id(obj))
            if handle is None or self.objects.get(handle) is not obj:
                handle = self.next
                self.next += 1
                self.objects[handle] = obj
                self.handles[id(obj)] = handle
            self.sent[handle] = self.sent.get(handle, 0) + 1
            return handle

    def forget(self, handle, count):
        with self.lock:
            if self.sent.get(handle) != count:
                return  # sent again since: the main process holds it still
            obj = self.objects.pop(handle, None)
            self.sent.pop(handle, None)
            if obj is not None and self.handles.get(id(obj)) == handle:
                del self.handles[id(obj)]
            serial = self.serials.pop(handle, None)
        if serial is not None:
            serial.put(None)

    def clock(self, cid, samplerate):
        with self.lock:
            clock = self.clocks.get(cid)
            if clock is None:
                clock = self.clocks[cid] = ForwardedClock(samplerate, cid, self.event)
            return clock

    def callback(self, cid):
        def told(*args, **kw):
            self.event("callback", (cid, args, kw))

        return told

    def serial(self, handle):
        with self.lock:
            serial = self.serials.get(handle)
            if serial is None:
                serial = self.serials[handle] = _Serial(f"sound-{handle}")
            return serial

    # the pipe

    def loads(self, data):
        return _Unpickler(io.BytesIO(data), self).load()

    def run(self):
        while not self.ending.is_set():
            try:
                data = self.conn.recv_bytes()
            except (EOFError, OSError):
                break
            try:
                msg = self.loads(data)
            except Exception as e:  # noqa: BLE001 - one that cannot be read
                rid = _rid_of(data)
                if rid is not None:
                    self.send(("answer", rid, False, portable(e)))
                continue
            if msg[0] == "quit":
                break
            self.dispatch(msg)
        self.end()

    def dispatch(self, msg):
        tag = msg[0]
        if tag == "new":
            _, rid, kind, args, kw = msg
            self.making.put(lambda: self.answer(rid, lambda: make(kind, args, kw)))
        elif tag == "call":
            _, rid, handle, name, args, kw = msg
            obj = self.objects.get(handle)
            job = lambda: self.answer(rid, lambda: _call(obj, handle, name, args, kw))  # noqa: E731
            if name in QUICK:
                self.quick.submit(job)
            else:
                self.serial(handle).put(job)
        elif tag == "get":
            _, rid, handle, name = msg
            obj = self.objects.get(handle)
            self.quick.submit(lambda: self.answer(rid, lambda: _get(obj, handle, name)))
        elif tag == "set":
            _, rid, handle, name, value = msg
            obj = self.objects.get(handle)
            self.serial(handle).put(lambda: self.answer(rid, lambda: _set(obj, handle, name, value)))
        elif tag == "fn":
            _, rid, name, args, kw = msg
            self.functions.put(lambda: self.answer(rid, lambda: run_function(name, args, kw)))
        elif tag == "forget":
            _, handle, count = msg
            self.forget(handle, count)

    def end(self):
        """The pipe or the parent went: recordings let go of their files,
        closed, and the process ends."""
        if self.ending.is_set():
            return
        self.ending.set()
        abandon_all(list(self.objects.values()))
        os._exit(0)


def abandon_all(objects):
    """Every recorder among `objects` lets its files go, closed."""
    for obj in objects:
        if getattr(obj, "kind", None) == "AudioRecorder":
            try:
                obj.abandon()
            except Exception:  # noqa: BLE001 - the next one still closes its files
                pass


class _Tolerant(pickle.Unpickler):
    def persistent_load(self, pid):
        return None


def _rid_of(data):
    """The request number of a message that would not unpickle, for its
    answer: references read as None."""
    try:
        msg = _Tolerant(io.BytesIO(data)).load()
        return msg[1] if msg[0] in ("new", "call", "get", "set", "fn") else None
    except Exception:  # noqa: BLE001
        return None


def _call(obj, handle, name, args, kw):
    if obj is None:
        raise LookupError(f"sound object #{handle} is gone")
    return getattr(obj, name)(*args, **kw)


def _get(obj, handle, name):
    if obj is None:
        raise LookupError(f"sound object #{handle} is gone")
    value = getattr(obj, name)
    if callable(value) and not isinstance(value, type):
        from rehearsal_recorder.audio.sound import IsMethod

        return IsMethod()
    return value


def _set(obj, handle, name, value):
    if obj is None:
        raise LookupError(f"sound object #{handle} is gone")
    setattr(obj, name, value)


def _crash_log():
    """A crash of this process leaves its trace where the app's goes."""
    try:
        import faulthandler

        from rehearsal_recorder.platform_support import CRASH_LOG

        CRASH_LOG.parent.mkdir(parents=True, exist_ok=True)
        out = open(CRASH_LOG, "a", buffering=1, encoding="utf-8")  # noqa: SIM115 - open for the life of the process
        faulthandler.enable(file=out, all_threads=True)
    except Exception:  # noqa: BLE001 - a diagnostic never stops the sound
        pass


def _watch_parent(host):
    parent = multiprocessing.parent_process()
    if parent is None:
        return

    def watch():
        try:
            multiprocessing.connection.wait([parent.sentinel])
        except Exception:  # noqa: BLE001
            return
        host.end()

    threading.Thread(target=watch, name="sound-parent", daemon=True).start()


def main(conn, prepare=None):
    """The sound process."""
    started = time.perf_counter()
    from rehearsal_recorder.audio import sound

    sound.IN_HOST = True
    if prepare:
        module, _, name = prepare.partition(":")
        getattr(importlib.import_module(module), name)()
    _crash_log()
    host = Host(conn)
    ours = logging.getLogger("rehearsal_recorder")
    ours.setLevel(logging.INFO)
    ours.addHandler(_ToMain(host))
    ours.propagate = False
    _watch_parent(host)
    try:
        listed = _device_list()
    except Exception as e:  # noqa: BLE001 - the main process says what failed
        listed = {"devices": [], "hostapis": [], "default": [-1, -1], "trouble": repr(e)}
    host.send(("ready", {"pid": os.getpid(), "took": time.perf_counter() - started, "list": listed,
                         "python": sys.version.split()[0]}))
    host.run()
