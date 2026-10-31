"""
The band service, one of the places `sending` sends takes to: a site the
band runs for itself (service/ in this repository), where everyone listens
to the takes, stars them and writes about them.

A take goes up in two steps. First its MP3s, waveforms and notes, after
which the band can listen to it; then its FLAC files, the originals to
download. Each file goes in parts of 10 MiB, and every part that arrived
is written down, with the files made for it, so a sending cut short (the app
closed, the lid shut, no internet) goes on later from where it stopped:
nothing is made twice, and no part is sent twice but the one whose answer
never came. That one goes again under the same number, and the service
keeps the later.

What changes in РЭХА after a take went up follows it: its details go again
(a rename, a ★, a mark), or its files too (a crop, as a new generation). A
take deleted in РЭХА goes to the service's trash once its Undo has passed.
"""

import math
import shutil
import sys
import threading
import time
import uuid
from pathlib import Path

from rehearsal_recorder.sending import false_start, service_files
from rehearsal_recorder.sending.service_client import (
    NOT_A_KEY, Gone, Offline, Refused, ServiceClient, address_of, parse_key,
)
from rehearsal_recorder.store.names import take_name

# The service's part size (R2 wants every part but the last the same size).
PART_BYTES = 10 * 1024 * 1024
# A take whose files are not made yet comes to about this much of its WAVs,
# its FLAC and MP3 together, which is what is left to send of it.
MADE_PER_WAV_BYTE = 0.7
NO_KEY = "No band service key"
CLOSING_JS = "window.__rehaClosing && window.__rehaClosing()"
# What a band service is and how to run one, for Settings › Folders.
SERVICE_HELP_URL = "https://reha.stream/band-service"


def staging_root():
    """Where the files made for the band service wait until they are up:
    beside the settings, out of the recordings folder and the cloud folder."""
    from rehearsal_recorder import api as apimod  # its path, as the suites set it

    return Path(apimod.CONFIG_PATH).with_name("band-service")


class _Changed(Exception):
    """The take changed under the sending (it went, or was cropped): the
    pass stops, and the next one sends it as it is now."""


class BandService:
    """
    The band service as a module of `sending`. One worker thread, one take
    at a time, never while a take records. The tables are the library's
    (ServiceCopy, ServiceFile, ServiceDelete); what is only for this run is
    here: the lines in the list of background work, and when a take that met
    no internet is tried again.
    """

    id = "service"
    # A take that met no internet is tried again after this long.
    RETRY_SEC = 30

    def __init__(self, api, client_factory=ServiceClient):
        self.api = api
        self._client_factory = client_factory
        self._lock = threading.RLock()
        # The line of each take waiting or going, by its take's id, and of
        # each take going to the trash, by ("delete", uid).
        self._entries = {}
        # How many times each take changed, so a pass that ends knows
        # whether it sent the take as it is now.
        self._edits = {}
        # When a take that met no internet may be tried again.
        self._later = {}
        # Deletions the service turned down: not tried again in this run.
        self._refused = set()
        self._active = None
        self._closing_anyway = False
        self._thread = None
        self._wake = threading.Event()
        self._stopping = False

    @property
    def _lib(self):
        return self.api._lib

    def _client(self):
        parsed = parse_key(self.api._config.get("service_key"))
        if parsed is None:
            raise Refused(NO_KEY)
        return self._client_factory(*parsed)

    # ---------- what happens to a take ----------

    def _to_go(self, take):
        """Whether sending on its own sends this take: the switch picks the
        service, and the take was kept with "send this one", or the setting
        is on, it was not kept with "not this one", and it is not a false
        start."""
        api = self.api
        if api._sending.chosen().id != self.id:
            return False
        if take.get("cloud_skip"):
            return False
        if take.get("cloud_send"):
            return True
        return (bool(api._config.get("service_auto_publish"))
                and not false_start(take, api._false_start_sec()))

    def saved(self, folder, take_number, take=None):
        """A take saved, or recovered: it goes if it is to. One already in
        the service is kept up to date by `edited`."""
        if take is None:
            take = self._lib.take(folder, take_number)
        if not take or take.get("service") is not None or not self._to_go(take):
            return
        self._queue(folder, take_number, take)

    def edited(self, folder, take_number, cut_start=None):
        """
        Something about a take changed. One in the service has its details
        sent again; a crop (`cut_start`, what it took off the start, 0.0
        when it cut only the end) makes its audio a new generation, whose
        files go too. One not in the service goes only if it is a false
        start of the rehearsal in progress given a ★ or a mark.
        """
        row = self._lib.service_row(folder, take_number)
        if row is None:
            session = self.api._session
            if session is not None and Path(session["folder"]) == Path(folder):
                self.saved(folder, take_number)
            return

        def change(r):
            # A take the service turned down waits for Retry, as it was.
            out = {"due": r["due"] or r["error"] is None}
            if cut_start is not None:
                out["gen"] = r["gen"] + 1
                out["pending_cut"] = float(r["pending_cut"] or 0) + float(cut_start)
            return out

        with self._lock:
            self._edits[row["take_id"]] = self._edits.get(row["take_id"], 0) + 1
            row = self._lib.change_service_row(row["take_id"], change)
        if row is not None and row["due"]:
            self._line(row["take_id"], folder, take_number)
            self._wake.set()

    def deleted(self, records):
        """Takes whose removal's Undo has passed (a take's record, as
        Library.take_record has it): the service puts them in its trash."""
        for record in records:
            copy = record.get("service_copy")
            if not copy:
                continue
            columns = record.get("take") or {}
            song = record.get("song") or {}
            name = take_name(song.get("title"), columns.get("go"), columns.get("take_number"))
            self._to_trash(columns.get("id"), copy["uid"], name)

    def _to_trash(self, take_id, uid, name):
        self._lib.add_service_delete(uid, name)
        shutil.rmtree(staging_root() / uid, ignore_errors=True)
        with self._lock:
            entry = self._entries.pop(take_id, None)
        if entry is not None:
            entry.discard()
        self._delete_line(uid, name)
        self._wake.set()

    # ---------- what the buttons ask for ----------

    def _take_or_error(self, folder, take_number):
        api = self.api
        if not api._inside_recordings(folder):
            return None, {"ok": False, "error": "Folder is outside the recordings directory"}
        take = self._lib.take(folder, take_number)
        if take is None:
            if not self._lib.has(folder):
                return None, {"ok": False, "error": "Rehearsal not found"}
            return None, {"ok": False, "error": "Take not found"}
        return take, None

    def send(self, folder, take_number, what=None):
        """One take on its way to the service, at once. `what` is the cloud
        folder's: the service always gets every track as MP3 and FLAC."""
        if parse_key(self.api._config.get("service_key")) is None:
            return {"ok": False, "error": NO_KEY}
        folder = Path(folder)
        take, refused = self._take_or_error(folder, take_number)
        if refused:
            return refused
        if not any(Path(t.get("file", "")).exists() for t in take["tracks"]):
            return {"ok": False, "error": "The take has no files left on disk"}
        self._queue(folder, take_number, take)
        return {"ok": True, "queued": True, "take": self._lib.take(folder, take_number)}

    def send_starred(self, folder):
        """Every ★ take of a rehearsal that was never sent to the service."""
        if parse_key(self.api._config.get("service_key")) is None:
            return {"ok": False, "error": NO_KEY}
        folder = Path(folder)
        if not self.api._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        rehearsal = self._lib.rehearsal(folder)
        if rehearsal is None:
            return {"ok": False, "error": "Rehearsal not found"}
        queued, failed = [], []
        for take in rehearsal["takes"]:
            if not take.get("starred") or take.get("service") is not None:
                continue
            n = take["take_number"]
            res = self.send(folder, n)
            if res.get("ok"):
                queued.append(n)
            else:
                failed.append({"take_number": n, "error": res.get("error", "Could not send")})
        return {"ok": True, "queued": queued, "failed": failed}

    def remove(self, folder, take_number):
        """Remove from the band service: the take goes to the service's
        trash, and stops being sent. The take in РЭХА stays as it is."""
        folder = Path(folder)
        take, refused = self._take_or_error(folder, take_number)
        if refused:
            return refused
        row = self._lib.drop_service_row(take_service_id(self._lib, folder, take_number))
        if row is not None:
            self._to_trash(row["take_id"], row["uid"], take["name"])
        return {"ok": True, "take": self._lib.take(folder, take_number)}

    def retry(self, entry_id):
        """A take the service turned down, sent again."""
        entry = self.api._journal.find(int(entry_id))
        data = entry.snapshot() if entry else None
        if not data or data["kind"] != self.id or data["state"] != "failed":
            return {"ok": False, "error": "Nothing to retry"}
        return self.send(data["folder"], data["take_number"])

    def take_files(self, folder, take_number):
        """What of a take is up, for its dialog: each track with whether its
        MP3 and its FLAC are there, and its .mid where it has notes (None
        where it has none)."""
        take, refused = self._take_or_error(Path(folder), take_number)
        if refused:
            return refused
        row = self._lib.service_row(folder, take_number) or {}
        gen = row.get("gen")
        made = self._lib.service_files(row["take_id"], gen) if row else {}
        mp3_all = row.get("mp3_gen") == gen and gen is not None
        flac_all = row.get("flac_gen") == gen and gen is not None
        notes = {n["name"]: f"{len(take['tracks']) + i}.mid"
                 for i, n in enumerate(take.get("notes") or [], 1)}
        files = []
        for i, t in enumerate(take["tracks"], 1):
            def up(name, whole):
                return whole or bool((made.get(name) or {}).get("done"))
            mid = notes.get(t["name"])
            files.append({"name": t["name"], "mp3": up(f"{i}.mp3", mp3_all),
                          "flac": up(f"{i}.flac", flac_all),
                          "mid": None if mid is None else up(mid, mp3_all)})
        return {"ok": True, "files": files}

    # ---------- what is left ----------

    def states(self, folder):
        """What this rehearsal's takes are doing, by take number."""
        out = {}
        for row in self._lib.service_rows():
            if row["due"] and Path(row["folder"]) == Path(folder):
                out[row["take_number"]] = "working" if row["take_id"] == self._active else "queued"
        return out

    def left(self):
        """The takes still to send or to put in the trash, and the bytes of
        their files not up yet. A take whose files are not made yet counts
        what its WAVs will come to."""
        takes, size = len(self._deletes()), 0
        for row in self._lib.service_rows():
            if not row["due"]:
                continue
            takes += 1
            made = self._lib.service_files(row["take_id"], row["gen"])
            if made:
                for f in made.values():
                    if not f["done"]:
                        size += max(0, f["size"] - len(f["parts"] or []) * PART_BYTES)
            elif row["mp3_gen"] != row["gen"] or row["flac_gen"] != row["gen"]:
                take = self._lib.take(row["folder"], row["take_number"]) or {}
                wavs = sum(Path(t["file"]).stat().st_size for t in take.get("tracks") or []
                           if t.get("file") and Path(t["file"]).exists())
                size += int(wavs * MADE_PER_WAV_BYTE)
        return {"takes": takes, "bytes": size}

    def _deletes(self):
        return [d for d in self._lib.service_deletes() if d["uid"] not in self._refused]

    # ---------- closing the window ----------

    def window_closing(self, left):
        """
        pywebview asks before the window closes: True lets it. With takes
        still to send, and Close anyway not pressed, the window stays and
        the interface asks (window.__rehaClosing), from a thread of its own:
        nothing here waits on the window from inside its own handler.
        """
        if self._closing_anyway or not left["takes"]:
            return True
        window = self.api._window
        if window is not None:
            threading.Thread(target=window.evaluate_js, args=(CLOSING_JS,), daemon=True).start()
        return False

    def close_anyway(self):
        self._closing_anyway = True
        window = self.api._window
        if window is not None:
            threading.Thread(target=window.destroy, daemon=True).start()
        return {"ok": True}

    # ---------- the key and the settings ----------

    def settings(self):
        """What Settings › Folders shows of the service: where it is, and
        whether takes go there on their own. None with no key."""
        config = self.api._config
        address = address_of(config.get("service_key"))
        if address is None:
            return None
        return {"address": address, "auto_publish": bool(config.get("service_auto_publish"))}

    def set_key(self, key):
        """
        The key the band's owner copied from the service's Members page.
        Kept, and new takes go to the service from then on, once the service
        says it knows it, or when there is no internet to ask: {"ok": True,
        "address"}, with "unchecked": True then. Turned down with {"ok":
        False, "error"}, and nothing kept.
        """
        key = (key or "").strip()
        parsed = parse_key(key)
        if parsed is None:
            return {"ok": False, "error": NOT_A_KEY}
        unchecked = False
        try:
            self._client_factory(*parsed).hello()
        except Offline:
            unchecked = True
        except (Refused, Gone) as e:
            return {"ok": False, "error": getattr(e, "words", None) or str(e)}
        config = self.api._config
        config["service_key"] = key
        config["send_to"] = self.id
        self.api._write_config()
        return {"ok": True, "address": address_of(key), **({"unchecked": True} if unchecked else {})}

    def disconnect(self):
        """The key forgotten, and with it everything still to send there;
        new takes go to the cloud folder again. What is in the service stays
        there."""
        self.forget()
        config = self.api._config
        config.pop("service_key", None)
        config["send_to"] = "cloud"
        self.api._write_config()
        return {"ok": True}

    def set_auto(self, on):
        """Whether a saved take goes to the service on its own. Turning it
        on picks up the takes of the rehearsal in progress, as the cloud
        folder's does."""
        self.api._config["service_auto_publish"] = bool(on)
        self.api._write_config()
        session = self.api._session
        if on and session is not None:
            for take in (self._lib.rehearsal(session["folder"]) or {}).get("takes") or []:
                self.saved(session["folder"], take["take_number"], take=take)
        return {"ok": True, "auto_publish": bool(on)}

    def forget(self):
        """Disconnect: everything still to send, and every line of it, is
        dropped, and the files made for it. A pass under way stops at its
        next part, finding its take gone."""
        self._lib.forget_service()
        with self._lock:
            entries, self._entries = list(self._entries.values()), {}
            self._edits.clear()
            self._later.clear()
            self._refused.clear()
        for entry in entries:
            entry.discard()
        shutil.rmtree(staging_root(), ignore_errors=True)

    # ---------- the lines in the list ----------

    def _line(self, take_id, folder, take_number, take=None):
        """The take's line, one however often it is asked for: waiting until
        the worker starts on it."""
        with self._lock:
            entry = self._entries.get(take_id)
            if entry is not None and entry.snapshot()["state"] in ("waiting", "running"):
                return entry
            if take is None:
                take = self._lib.take(folder, take_number) or {}
            name = take.get("name") or f"Take {take_number}"
            entry = self.api._journal.begin(
                self.id, f"“{name}” → band service", str(folder), int(take_number),
                waiting=True)
            self._entries[take_id] = entry
            return entry

    def _delete_line(self, uid, name):
        with self._lock:
            key = ("delete", uid)
            entry = self._entries.get(key)
            if entry is not None and entry.snapshot()["state"] in ("waiting", "running"):
                return entry
            entry = self.api._journal.begin(
                self.id, f"“{name}” → band service trash", waiting=True)
            self._entries[key] = entry
            return entry

    def _queue(self, folder, take_number, take=None):
        row = self._lib.add_service_row(folder, take_number, str(uuid.uuid4()), due=True, error=None)
        if row is None:
            return None
        self._line(row["take_id"], folder, take_number, take)
        self._wake.set()
        return row

    def _tidy(self):
        """Every take still to send, and every take still to go to the
        trash, has its line; a line whose take has nothing left to send (it
        was deleted meanwhile) goes."""
        due = {r["take_id"]: r for r in self._lib.service_rows() if r["due"]}
        deletes = {d["uid"]: d for d in self._deletes()}
        with self._lock:
            for key, entry in list(self._entries.items()):
                if entry.snapshot()["state"] not in ("waiting", "running"):
                    self._entries.pop(key)
                    continue
                gone = (key[1] not in deletes) if isinstance(key, tuple) else (key not in due)
                if gone and key != self._active:
                    self._entries.pop(key)
                    entry.discard()
        for take_id, row in due.items():
            self._line(take_id, row["folder"], row["take_number"])
        for uid, d in deletes.items():
            self._delete_line(uid, d["name"])

    # ---------- the worker ----------

    def reopen(self):
        """The app has opened: what it still had to send is back in the list
        at once, as waiting."""
        self._tidy()

    def run_next(self):
        """One take, or one deletion. False when there was nothing to do,
        or not now: while a take records, or before a take that met no
        internet is due to be tried again."""
        if self.api._recorder is not None or self.api._library is None:
            return False
        self._tidy()
        now = time.monotonic()
        for d in self._deletes():
            if self._later.get(("delete", d["uid"]), 0) <= now:
                return self._delete(d)
        for row in self._lib.service_rows():
            if row["due"] and self._later.get(row["take_id"], 0) <= now:
                return self._send_take(row)
        return False

    def start(self):
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self, timeout=2.0):
        """Between parts at most: a part on its way is left to arrive, or
        to be sent again next time."""
        self._stopping = True
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout)

    def _loop(self):
        while not self._stopping:
            try:
                ran = self.run_next()
            except Exception as e:  # noqa: BLE001 - a dead worker is worse than a loud one
                print(f"Sending to the band service failed: {e}", file=sys.stderr)
                ran = False
            if not ran:
                self._wake.wait(1.0)
                self._wake.clear()

    def _delete(self, d):
        uid = d["uid"]
        entry = self._delete_line(uid, d["name"])
        entry.start()
        try:
            self._client().delete_take(uid)
        except Offline as e:
            entry.start(e.step)
            self._later[("delete", uid)] = time.monotonic() + self.RETRY_SEC
            return True
        except Refused as e:
            self._refused.add(uid)
            with self._lock:
                self._entries.pop(("delete", uid), None)
            entry.fail(e.words)
            return True
        self._lib.drop_service_delete(uid)
        with self._lock:
            self._entries.pop(("delete", uid), None)
        entry.done("In the band service's trash")
        return True

    def _send_take(self, row):
        take_id = row["take_id"]
        entry = self._line(take_id, row["folder"], row["take_number"])
        with self._lock:
            self._active = take_id
            edits = self._edits.get(take_id, 0)
        try:
            self._send(row, entry, edits)
        except _Changed:
            pass  # looked at again on the next turn, as it is now
        except Offline as e:
            entry.start(e.step)
            self._later[take_id] = time.monotonic() + self.RETRY_SEC
        except (Refused, service_files.CannotMake, OSError) as e:
            words = getattr(e, "words", None) or str(e)
            self._lib.change_service_row(take_id, lambda r: {"due": False, "error": words})
            with self._lock:
                self._entries.pop(take_id, None)
            entry.fail(words, retry=self.id)
        finally:
            with self._lock:
                self._active = None
        return True

    def _check(self, take_id, gen):
        """The take is still there, at the generation being sent."""
        row = self._lib.service_row_of(take_id)
        if row is None or row["gen"] != gen:
            raise _Changed()
        return row

    def _send(self, row, entry, edits):
        lib = self.api._lib
        take_id, uid, gen = row["take_id"], row["uid"], row["gen"]
        folder, number = row["folder"], row["take_number"]
        take = lib.take(folder, number)
        if take is None:
            raise _Changed()
        client = self._client()
        entry.start("Sending the details")
        ref = lib.rehearsal_ref(folder) or {}
        rehearsal = {"id": ref.get("id"), "created_at": ref.get("created_at", ""),
                     "name": (lib.rehearsal(folder) or {}).get("name", "")}
        cut = float(row["pending_cut"] or 0)
        meta = service_files.meta(take, rehearsal, lib.labels(),
                                  self.api._config.get("volumes", {}), gen, cut)
        client.put_take(uid, meta)

        mp3s = len(service_files.plan(take, {"mp3"}))
        if row["mp3_gen"] != gen or row["flac_gen"] != gen:
            # Older generations' files are not sent any more.
            lib.drop_service_files(take_id, keep_gen=gen)
            for old in (staging_root() / uid).glob("*"):
                if old.name != str(gen):
                    shutil.rmtree(old, ignore_errors=True)
        if row["mp3_gen"] != gen:
            files = self._make(take_id, uid, gen, take, {"mp3", "peaks", "mid"}, entry)
            self._phase(client, take_id, uid, gen, files, entry,
                        lambda done: f"MP3s: {min(done, mp3s)} of {mp3s}", ".mp3")
            client.ready(uid, gen, "mp3")
            # The service shows this generation now, its comments moved back
            # by `cut`; a crop that came meanwhile is the next one's.
            lib.change_service_row(take_id, lambda r: {
                "mp3_gen": gen, "pending_cut": float(r["pending_cut"] or 0) - cut})
        if row["flac_gen"] != gen:
            # Read again: a rename meanwhile moved the WAVs.
            take = lib.take(folder, number) or take
            files = self._make(take_id, uid, gen, take, {"flac"}, entry)
            flacs = len(files)
            self._phase(client, take_id, uid, gen, files, entry,
                        lambda done: f"FLAC: {min(done, flacs)} of {flacs}", ".flac")
            client.ready(uid, gen, "flac")
            lib.change_service_row(take_id, lambda r: {"flac_gen": gen})

        with self._lock:
            if self._edits.get(take_id, 0) != edits:
                return  # changed while it went: its details go again
            now = lib.change_service_row(
                take_id, lambda r: {"due": False, "sent": meta, "error": None} if r["gen"] == gen else {})
            self._entries.pop(take_id, None)
        if now is None or now["due"]:
            return
        lib.drop_service_files(take_id)
        shutil.rmtree(staging_root() / uid, ignore_errors=True)
        entry.done("MP3 and FLAC of every track")

    def _make(self, take_id, uid, gen, take, kinds, entry):
        """The files of these kinds, made once: one made already, for an
        upload cut short, is the one sent."""
        made = self._lib.service_files(take_id, gen)
        todo = [i for i in service_files.plan(take, kinds) if i["name"] not in made]
        if todo:
            entry.start("Making the files")
        for item in todo:
            self._check(take_id, gen)
            path = staging_root() / uid / str(gen) / item["name"]
            service_files.make(item, path)
            self._lib.add_service_file(take_id, gen, item["name"], f"{uid}/{gen}/{item['name']}",
                                       path.stat().st_size)
        wanted = {i["name"] for i in service_files.plan(take, kinds)}
        return [f for name, f in sorted(self._lib.service_files(take_id, gen).items(),
                                        key=lambda kv: _order(kv[0]))
                if name in wanted]

    def _phase(self, client, take_id, uid, gen, files, entry, step, counted):
        """Every file of one step, from the first part not up, with the bar
        at the bytes sent over the bytes of the step's files."""
        total = sum(f["size"] for f in files) or 1
        sent = [sum(f["size"] if f["done"] else min(f["size"], len(f["parts"] or []) * PART_BYTES)
                    for f in files)]
        done = [sum(1 for f in files if f["done"] and f["name"].endswith(counted))]

        def report(n):
            sent[0] += n
            entry.progress(sent[0] / total, step(done[0]))

        entry.progress(sent[0] / total, step(done[0]))
        for f in files:
            if f["done"]:
                continue
            self._upload(client, take_id, uid, gen, f, report)
            if f["name"].endswith(counted):
                done[0] += 1
            report(0)

    def _upload(self, client, take_id, uid, gen, f, report):
        """One file: an upload asked for once, each part not up yet sent and
        written down at once, then the upload finished. One the service has
        lost starts again."""
        path = staging_root() / f["path"]
        name = f["name"]
        count = max(1, math.ceil(f["size"] / PART_BYTES))
        for _ in range(3):
            try:
                upload_id = f["upload_id"]
                parts = [list(p) for p in f["parts"] or []]
                if upload_id is None:
                    self._check(take_id, gen)
                    upload_id = client.start_file(uid, gen, name, f["size"])
                    parts = []
                    self._lib.change_service_file(take_id, gen, name, upload_id=upload_id, parts=parts)
                    f.update(upload_id=upload_id, parts=parts)
                have = {n for n, _ in parts}
                with open(path, "rb") as fh:
                    for number in range(1, count + 1):
                        if number in have:
                            continue
                        self._check(take_id, gen)
                        fh.seek((number - 1) * PART_BYTES)
                        data = fh.read(PART_BYTES)
                        etag = client.put_part(uid, upload_id, number, gen, name, data)
                        parts = [*parts, [number, etag]]
                        self._lib.change_service_file(take_id, gen, name, parts=parts)
                        f["parts"] = parts
                        report(len(data))
                client.finish_file(uid, upload_id, gen, name, sorted(parts))
                self._lib.change_service_file(take_id, gen, name, done=True)
                f["done"] = True
                return
            except Gone:
                self._lib.change_service_file(take_id, gen, name, upload_id=None, parts=[])
                f.update(upload_id=None, parts=[])
        raise Refused("The band service keeps losing this file: Retry sends it again")


def _order(name):
    """Files in the order the plan sends them within a step: by position."""
    stem, _, kind = name.partition(".")
    return ({"mp3": 0, "peaks": 1, "mid": 2, "flac": 3}.get(kind, 4), int(stem) if stem.isdigit() else 0)


def take_service_id(lib, folder, take_number):
    row = lib.service_row(folder, take_number)
    return None if row is None else row["take_id"]
