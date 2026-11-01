"""
The cloud folder, one of the places `sending` sends takes to: a folder
the band's Drive or Dropbox syncs, where takes are copied.

Much of it decides whether what is in the cloud folder is still what the
settings and the take say it should be.

A copy is made from six things: which of the mix and the tracks was asked
for, the take's name (the files are named after it), the format, the balance
the mix was rendered with, the folder it was written into, and how long the
take is — and, for a copy of the tracks of a take that has notes, a seventh:
which they are. Recording those next to the copy is what lets a later pass
skip a take that is already right, instead of mixing it again every time
something nudges the queue.

The record is a claim about a file on someone else's disk, so it is only
believed while that file is still there. A sync client that logs out and
re-creates its folder empty leaves every take fingerprinted as published with
nothing behind it, and a fingerprint that cannot be disproved would suppress
its own repair.
"""

import sys
import threading
from pathlib import Path

from rehearsal_recorder.audio.encode import (
    available as encoder_available,
    normalize_format,
)
from rehearsal_recorder.sending import false_start


def source_of(take, what, volumes, fmt, target):
    """What a copy of this take would be made from right now, and where it
    would go. `target` is the name of the rehearsal's subfolder inside the
    cloud folder, not a whole path."""
    names = [t.get("name") for t in take.get("tracks", []) if t.get("name")]
    record = {
        "what": what,
        "name": take.get("name", ""),
        "format": fmt,
        # The rehearsal's subfolder inside the cloud folder, which follows the
        # rehearsal's name — something the rest of this record cannot see.
        # Only the subfolder: pointing the setting at the same cloud folder
        # moved elsewhere finds the copies where they are, and does not make
        # every take look stale. A setting pointed at a different, empty
        # folder is caught by copies_exist instead.
        "dir": str(target) if target is not None else "",
        # Only this take's tracks: moving an unrelated fader must not make
        # every take in the folder look stale.
        "volumes": {n: float(volumes.get(n, 1.0)) for n in names},
        # The odd one out: everything else here is about naming and
        # destination, and a crop changes none of it. share_take reads a
        # take's files outside any transaction and only opens one to write
        # this record, so a copy that started before a crop can finish after
        # it — and without the length, the record it writes still matches the
        # shorter take. The re-publish the crop asked for would then find the
        # take current and skip it, leaving the uncropped version in the cloud
        # folder for good, reported as up to date. Rounded like the markers
        # are, so a re-read of the same take cannot drift.
        "duration_sec": round(float(take.get("duration_sec") or 0), 2),
    }
    # The notes the tracks' copy carries, by name — only for a take that has
    # some, and only for a copy that carries them: the original tracks and
    # Both. A mix is made from the audio and holds no notes, so what a take
    # has of them is nothing it can be stale for. Without the key, what is
    # recorded for a take with no notes, or for a mix, is what it always was
    # and every copy already in a cloud folder still reads as current. A take
    # that gets notes after its tracks were copied reads as changed, and is
    # sent again with them.
    notes = [n.get("name") for n in take.get("notes") or [] if n.get("name")]
    if notes and what != "mix":
        record["notes"] = notes
    return record


def copies_exist(shared):
    """Whether what a record claims to have written is still on disk."""
    for key in ("mix", "tracks"):
        path = shared.get(key)
        if path and not Path(path).exists():
            return False
    return True


def is_current(take, what, volumes, fmt, target):
    """True when the cloud folder already holds this take in this shape."""
    shared = take.get("cloud") or {}
    if not shared:
        return False
    if shared.get("source") != source_of(take, what, volumes, fmt, target):
        return False
    return copies_exist(shared)


def _shape_of(shared):
    """What a take has in the cloud folder: "mix", "tracks", "both" or None."""
    shared = shared or {}
    parts = {k for k in ("mix", "tracks") if shared.get(k)}
    return _shape_from(parts)


def _shape_from(parts):
    if parts == {"mix", "tracks"}:
        return "both"
    return next(iter(parts), None)


def _with(shape, other):
    """Both shapes at once: an automatic copy adds what the setting asks for
    to what is already there, and never takes away what somebody sent."""
    parts = set()
    for s in (shape, other):
        parts |= {"mix", "tracks"} if s == "both" else ({s} if s else set())
    return _shape_from(parts)


def _copy_detail(what, res):
    """What a finished cloud copy came to, in words: "MP3 of the mix", or
    "MP3 of the mix, WAV of every track" when they came out differently."""
    shared = res.get("cloud") or {}
    mix = (shared.get("mix_format") or "wav").upper()
    tracks = (shared.get("tracks_format") or "wav").upper()
    if what == "mix":
        said = f"{mix} of the mix"
    elif what == "tracks":
        said = f"{tracks} of every track"
    elif mix == tracks:
        said = f"{mix} of the mix and every track"
    else:
        said = f"{mix} of the mix, {tracks} of every track"
    note = f". {res['note']}" if res.get("note") else ""
    return f"{said}{note}"


class PublishQueue:
    """
    Takes waiting to be copied into the cloud folder.

    One worker and one job at a time, so two takes are never mixed at once,
    and no job is started while `paused()` is true — the audio callback is not
    something to start competing with, for a copy that can just as well happen
    in the gap before the next take. The check is per job, not during one: a
    copy already under way runs to the end.

    The loop body is `run_next`, which the tests call directly. The thread is
    only started by the real app, so a test never races it.
    """

    def __init__(self, step, paused):
        self._step = step
        self._paused = paused
        # [folder, take_number, what]: what is None for an automatic job,
        # "mix"/"tracks"/"both" for one asked for by hand.
        self._jobs = []
        self._active = None
        self._rerun_active = False
        self._rerun_what = None
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._thread = None
        self._stopping = False

    def enqueue(self, folder, take_number, what=None):
        """
        One take, once however often it is asked for. `what` is None for an
        automatic job, or what to copy for one asked for by hand — which
        replaces what a waiting automatic job would have done, being the
        more specific of the two.
        """
        folder, take_number = str(folder), int(take_number)
        with self._lock:
            for job in self._jobs:
                if job[0] == folder and job[1] == take_number:
                    if what is not None:
                        job[2] = what
                    break
            else:
                if (self._active is not None
                        and self._active[:2] == [folder, take_number]):
                    # A request to re-publish the job currently in flight: arm
                    # it to run again after this one finishes.
                    self._rerun_active = True
                    if what is not None:
                        self._rerun_what = what
                else:
                    self._jobs.append([folder, take_number, what])
        self._wake.set()

    def states(self, folder):
        """What this rehearsal's takes are doing, by take number."""
        folder = str(folder)
        with self._lock:
            out = {n: "queued" for f, n, _ in self._jobs if f == folder}
            if self._active is not None and self._active[0] == folder:
                out[self._active[1]] = "working"
        return out

    def busy(self):
        """Whether a copy is being made right now."""
        with self._lock:
            return self._active is not None

    def run_next(self):
        """One job. False when there was nothing to do, or not now."""
        if self._paused():
            return False
        with self._lock:
            if not self._jobs:
                return False
            self._active = self._jobs.pop(0)
        try:
            self._step(*self._active)
        finally:
            with self._lock:
                if self._rerun_active:
                    folder, take_number, what = self._active
                    if self._rerun_what is not None:
                        what = self._rerun_what
                    self._jobs.append([folder, take_number, what])
                    self._rerun_active = False
                    self._rerun_what = None
                self._active = None
        return True

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self, timeout=2.0):
        """
        Asks the worker to stop and waits a moment for it.

        Only between jobs: a copy already in flight is left to finish, and if
        it takes longer than the wait the process exits on top of it anyway.
        Which is why the copies are staged under a temporary name — that, not
        this, is what keeps a half-written file out of the band's folder.
        """
        self._stopping = True
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout)

    def _loop(self):
        while not self._stopping:
            try:
                ran = self.run_next()
            except Exception as e:  # a dead worker is worse than a loud one
                print(f"Cloud publishing failed: {e}", file=sys.stderr)
                ran = False
            if not ran:
                self._wake.wait(0.5)
                self._wake.clear()


class CloudFolder:
    """
    The cloud folder as a place to send takes to: a module of `sending`.

    It holds the queue and the journal entries of the copies waiting, and
    reaches the rest of the app through `api`: the library, the settings,
    the journal, and the copying itself (`Api._copy_to_cloud`), which the
    renames, crops and deletions use for the copies already there too.

    Everything here is sharing to the cloud as it was before the band
    service: everything in the recordings folder syncs, or nothing does —
    that is how Drive and Dropbox work, and a rehearsal is mostly attempts
    nobody needs. So the cloud folder is a separate place, and takes are put
    there by hand, after listening, when it is clear which ones are worth it.
    """

    id = "cloud"

    def __init__(self, api):
        self.api = api
        self.queue = PublishQueue(
            step=self._publish_step, paused=lambda: api._recorder is not None
        )
        # The journal entry of each take waiting to be copied, by (folder,
        # take number): one however many times it is asked for.
        self.entries = {}
        self._lock = threading.Lock()

    # ---------- the settings ----------

    def set_dir(self, path):
        api = self.api
        folder = Path(path).expanduser()
        if not folder.is_absolute():
            return {"ok": False, "error": "A full path is required"}
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return {"ok": False, "error": f"Could not open the folder: {e}"}
        api._config["cloud_dir"] = str(folder)
        api._write_config()
        # Nothing of this rehearsal has ever been copied into a folder chosen
        # a moment ago, whatever the takes still say about the old one.
        self._enqueue_session_takes()
        # Here, not on a thread of its own: a folder was picked a moment ago
        # and the reply waits for it anyway, and a sweep still running when
        # the first copy lands in the folder must not take it back out.
        api._sweep_empty_cloud_dirs()
        return {"ok": True, "cloud_dir": str(folder)}

    def choose_dir(self):
        api = self.api
        if api._window is None:
            return {"ok": False, "error": "No window available"}
        try:
            import webview

            start = api._cloud_dir or Path.home()
            picked = api._window.create_file_dialog(
                webview.FOLDER_DIALOG, directory=str(start)
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}
        if not picked:
            return {"ok": False, "cancelled": True}
        return self.set_dir(picked[0])

    def set_format(self, fmt):
        """What the cloud copies are written as — see audio/encode.py."""
        api = self.api
        chosen = normalize_format(fmt)
        api._config["cloud_format"] = chosen
        api._write_config()
        # Every copy was written in the old format, which is the whole of what
        # this setting is about.
        self._enqueue_session_takes()
        return {"ok": True, "cloud_format": chosen, "encoder": encoder_available()}

    def set_auto(self, enabled, what=None):
        """
        Whether a saved take goes to the cloud folder on its own, and what of
        it. Turning it on picks up the takes of the rehearsal in progress —
        the ones recorded before the switch was flipped.
        """
        api = self.api
        if what is not None and what not in ("mix", "tracks", "both"):
            return {"ok": False, "error": "Unknown share type"}
        api._config["auto_publish"] = bool(enabled)
        if what is not None:
            api._config["auto_publish_what"] = what
        api._write_config()
        self._enqueue_session_takes()
        return {
            "ok": True,
            "auto_publish": api._config["auto_publish"],
            "auto_publish_what": api._config.get("auto_publish_what") or "mix",
        }

    def clear_dir(self):
        # Publishing on its own needs somewhere to publish to. Left on, every
        # take saved afterwards is queued, refused and marked "No cloud folder
        # chosen", and the list reads as failed when nothing went wrong. The
        # invariant belongs here rather than in a greyed-out checkbox.
        api = self.api
        api._config.pop("cloud_dir", None)
        api._config["auto_publish"] = False
        api._write_config()
        return {"ok": True}

    # ---------- what happens to a take ----------

    def saved(self, folder, take_number, take=None):
        """
        Ask for a take to be copied, if it is to go at all: sending is on and
        the take was not kept with "not this one", or sending is off and it
        was kept with "send this one" (see keep_take).
        """
        if take is None:
            take = self._take_in(folder, take_number) or {}
        # One that is in the cloud already is kept up to date there whatever
        # the setting says: sending on its own decides what goes up, not what
        # becomes of what is there. Only when it is out of date, though —
        # "waiting for the cloud" on a take that is fine there would be noise.
        if not self._copy_due(take):
            there = _shape_of(take.get("cloud"))
            if there is None or self._copy_current(folder, take, there):
                return
        self._queue_copy(folder, take_number, None, take)

    def edited(self, folder, take_number, cut_start=None):
        """
        A take of the rehearsal in progress is asked about again: a false
        start given a ★ or a mark is not one any more, and goes on its own.
        Older rehearsals keep what they sent, as they do when the balance or
        the format changes. Nothing else to do here: a copy carries no name,
        ★ or marks of its own, and a rename and a crop already look after
        the copies where they happen (a crop, `cut_start` not None, sends
        its copy in the shape it had).
        """
        if cut_start is not None:
            return
        session = self.api._session
        if session is None or Path(session["folder"]) != Path(folder):
            return
        take = self._take_in(folder, take_number) or {}
        if _shape_of(take.get("cloud")) is not None:
            return  # there already, and kept so where it changes
        self.saved(folder, take_number, take)

    def deleted(self, records):
        """Nothing to do: deleting a take already takes its copies out of the
        cloud folder where it happens."""

    def _copy_current(self, folder, take, what):
        """Whether the cloud folder already holds this take as `what`, made
        the way the settings now say."""
        config = self.api._config
        return is_current(
            take, what, config.get("volumes", {}),
            normalize_format(config.get("cloud_format")),
            self.api._cloud_target(folder))

    def _copy_due(self, take):
        """Whether sending on its own sends this take: it was kept with "send
        this one" (see keep_take), or the setting is on, it was not kept with
        "not this one" and it is not a false start. Never while the switch in
        Settings › Folders picks another place: the copies already here are
        still kept up to date, and nothing new comes."""
        api = self.api
        if api._sending.chosen().id != self.id:
            return False
        if take.get("cloud_skip"):
            return False
        if take.get("cloud_send"):
            return True
        return (bool(api._config.get("auto_publish"))
                and not false_start(take, api._false_start_sec()))

    def _queue_copy(self, folder, take_number, what, take=None):
        """The queue and the journal together: one waiting entry per take,
        however many times it is asked for. `what` None is automatic."""
        key = (str(folder), int(take_number))
        with self._lock:
            if key not in self.entries:
                take = take or self._take_in(folder, take_number) or {}
                name = take.get("name") or f"Take {take_number}"
                self.entries[key] = self.api._journal.begin(
                    "cloud", f"“{name}” → cloud", str(folder), int(take_number),
                    waiting=True)
        self.queue.enqueue(str(folder), take_number, what)

    def _take_in(self, folder, take_number):
        """A take's record, or None."""
        return self.api._lib.take(folder, take_number)

    def _enqueue_session_takes(self):
        """
        Every take of the rehearsal in progress.

        What a copy was made from is mostly settings — the balance, the
        format, where the copies go — so "that changed" is true of every take
        ever recorded. Re-publishing all of them because a fader moved would
        be a storm of mixdowns. The rehearsal in progress is the one the
        change was made during; older ones keep what they sent, and the share
        dialog is still there to redo one by hand.
        """
        api = self.api
        if api._session is None:
            return
        for t in api._session_takes():
            self.saved(api._session["folder"], t["take_number"], take=t)

    def _retry_failed_publishes(self):
        """
        The realistic failure is a sync folder that is briefly not there. The
        next saved take sweeps up whatever the rehearsal could not send while
        it was gone, so the backlog clears itself with no retry loop.
        """
        api = self.api
        if api._session is None:
            return
        for t in api._session_takes():
            if t.get("cloud_error"):
                self.saved(api._session["folder"], t["take_number"], take=t)

    # ---------- the copying, on the publishing thread ----------

    def _publish_step(self, folder, take_number, what=None):
        """
        One take, on the publishing thread. `what` None is an automatic job:
        it skips a take that is already in the cloud folder in the shape the
        settings ask for, so a burst of requests costs one mixdown, not
        several, and leaves nothing in the journal for it. A job asked for by
        hand copies what it was asked for.
        """
        key = (str(folder), int(take_number))
        with self._lock:
            entry = self.entries.pop(key, None)
        try:
            self._publish(folder, take_number, what, entry)
        except Exception as e:
            # Whatever went wrong — the library, writing a failure down — the
            # entry must not be left waiting or running with nothing behind it.
            if entry is not None:
                entry.fail(str(e),
                           retry=what or self.api._config.get("auto_publish_what") or "mix")
            raise

    def _publish(self, folder, take_number, what, entry):
        api = self.api
        take = api._lib.take(folder, take_number)
        if entry is None:
            name = (take or {}).get("name") or f"Take {take_number}"
            entry = api._journal.begin(
                "cloud", f"“{name}” → cloud", str(folder), int(take_number))
        if what is None:
            # Asked again here, not only when queued: the setting or the
            # take's own answer can have changed while it waited.
            there = _shape_of((take or {}).get("cloud"))
            due = take is not None and self._copy_due(take)
            if take is None or (not due and there is None):
                entry.discard()
                return
            # What is there already, and what the setting sends if it sends
            # this take: a take sent by hand as its tracks too keeps them when
            # a new balance or format makes it again, and one the setting does
            # not send is made again as it was, not as the setting would.
            what = (_with(there, api._config.get("auto_publish_what") or "mix")
                    if due else there)
            fmt = normalize_format(api._config.get("cloud_format"))
            target = api._cloud_target(folder)
            if is_current(take, what, api._config.get("volumes", {}),
                          fmt, target):
                entry.discard()
                return
        entry.start("Starting")
        try:
            res = api._copy_to_cloud(str(folder), take_number, what,
                                     progress=entry.progress)
        except Exception as e:
            # A sync folder that vanishes mid-write raises instead of
            # returning {"ok": False} — that must still land as a recorded,
            # retryable failure, not a silently stalled take.
            res = {"ok": False, "error": str(e)}
        if res.get("ok"):
            entry.done(_copy_detail(what, res))
            return
        error = res.get("error") or "Could not copy the take"
        entry.fail(error, retry=what)
        if take is not None:
            self._record_cloud_error(folder, take_number, error)

    def _record_cloud_error(self, folder, take_number, message):
        """Why a take is not in the cloud folder, kept with the take."""
        self.api._lib.set_cloud_error(folder, take_number, message)

    # ---------- what the buttons ask for ----------

    def send(self, folder, take_number, what="mix"):
        """
        Puts one take on the queue to be copied into the cloud folder, and
        answers at once. what: "mix" (one stereo file), "tracks" (the
        originals) or "both". The copying is _copy_to_cloud, on the
        publishing thread, and reported in the journal — see activity.py.
        What can be refused now is refused now.
        """
        api = self.api
        if what not in ("mix", "tracks", "both"):
            return {"ok": False, "error": "Unknown share type"}
        if api._cloud_dir is None:
            return {"ok": False, "error": "No cloud folder chosen", "needs_dir": True}
        folder = Path(folder)
        if not api._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        take = api._lib.take(folder, take_number)
        if take is None:
            if not api._lib.has(folder):
                return {"ok": False, "error": "Rehearsal not found"}
            return {"ok": False, "error": "Take not found"}
        if not any(Path(t.get("file", "")).exists() for t in take["tracks"]):
            return {"ok": False, "error": "The take has no files left on disk"}
        self._queue_copy(folder, take_number, what, take)
        return {"ok": True, "queued": True, "take": take}

    def send_starred(self, folder):
        """
        Send starred: every ★ take of a rehearsal with nothing of it in the
        cloud folder and no copy waiting, queued as What gets sent says.
        A take already there is not sent again, even if the setting has
        changed since; its share dialog is there for that. A take that cannot
        be sent (its files gone) is in `failed`, with why.
        """
        api = self.api
        if api._cloud_dir is None:
            return {"ok": False, "error": "No cloud folder chosen", "needs_dir": True}
        folder = Path(folder)
        if not api._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        rehearsal = api._lib.rehearsal(folder)
        if rehearsal is None:
            return {"ok": False, "error": "Rehearsal not found"}
        what = api._config.get("auto_publish_what") or "mix"
        waiting = self.queue.states(folder)
        queued, failed = [], []
        for take in rehearsal["takes"]:
            n = take["take_number"]
            if not take.get("starred") or n in waiting or _shape_of(take.get("cloud")):
                continue
            res = self.send(folder, n, what)
            if res.get("ok"):
                queued.append(n)
            else:
                failed.append({"take_number": n, "error": res.get("error", "Could not copy")})
        return {"ok": True, "queued": queued, "failed": failed}

    def retry(self, entry_id):
        """A failed copy, queued again as the one it was."""
        entry = self.api._journal.find(int(entry_id))
        data = entry.snapshot() if entry else None
        if not data or data["kind"] != "cloud" or data["state"] != "failed":
            return {"ok": False, "error": "Nothing to retry"}
        return self.send(data["folder"], data["take_number"],
                         data["retry"] or "mix")

    def remove(self, folder, take_number):
        """Removes the cloud copies of a take. The originals are untouched."""
        api = self.api
        folder = Path(folder)
        if not api._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        take = api._lib.take(folder, take_number)
        if take is None:
            if not api._lib.has(folder):
                return {"ok": False, "error": "Rehearsal not found"}
            return {"ok": False, "error": "Take not found"}
        # A copy on its way would put back what is removed now the moment it
        # finished — the file in the band's folder, and its record.
        if self.queue.states(str(folder)).get(int(take_number)):
            return {"ok": False, "error":
                    "This take is still being copied to the cloud. Remove it "
                    "once the copy has finished."}

        # Not a copy another take names too (two rows naming one file, as an
        # older version could leave): that file is the other take's as well.
        others = api._lib.others_cloud_paths(folder, take_number)
        result = api._remove_shared(api._unused(take.get("cloud"), others))
        api._lib.set_cloud_copy(folder, take_number, None, None)
        return {"ok": True, **result}

    # ---------- the worker ----------

    def states(self, folder):
        """What this rehearsal's takes are doing, by take number."""
        return self.queue.states(folder)

    def left(self):
        """What is still to go up: nothing to count for a folder on this
        computer, which the band's sync client sends on its own."""
        return {"takes": 0, "bytes": 0}

    def start(self):
        self.queue.start()

    def stop(self, timeout=2.0):
        self.queue.stop(timeout)
