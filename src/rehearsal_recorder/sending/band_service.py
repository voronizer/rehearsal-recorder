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

A take someone in the band deleted in the service is, here, a take taken
out with Remove from the band service: it stays on this computer, nothing of
it goes, and its cloud button sends it again. РЭХА learns of it from the
service's answer to a change, and by asking which takes the service has
when it starts and then every hour, which also finds a take put back there
with Restore, and one deleted there for good.

Songs go both ways (service_songs.py): РЭХА's changes to them go before any
take, and the check reads the band's changes there first.
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
from rehearsal_recorder.sending.service_songs import ServiceSongs
from rehearsal_recorder.store.names import shown_from_name, shown_name, take_name

# The service's part size (R2 wants every part but the last the same size).
PART_BYTES = 10 * 1024 * 1024
# A take whose files are not made yet comes to about this much of its WAVs,
# its FLAC and MP3 together, which is what is left to send of it.
MADE_PER_WAV_BYTE = 0.7
NO_KEY = "No band service key"
# True when the page took the question; false when it has no way to ask
# (not loaded yet, or broken), and the window closes.
CLOSING_JS = "window.__rehaClosing ? (window.__rehaClosing(), true) : false"
# A take's line while a take records, and while a take, a backing track or
# the click plays: its sending waits (Api._sound_busy).
RECORDING_STEP = "A take is recording: carries on after it"
PLAYING_STEP = "Sound is playing: carries on when it stops"
# A take's line while the band's tempo through it is counted, as the
# player's Master lane says it.
COUNTING_STEP = "Counting the tempo"
# What a band service is and how to run one, for Settings › Folders.
SERVICE_HELP_URL = "https://reha.stream/band-service"
# What a service from 0.24.0 on tells an older РЭХА (service/worker/signin/
# guards.ts). Takes it turned down with it go again once this one starts.
UPDATE_REHA = "Update РЭХА to send takes here"
# What a take's details carry only when РЭХА changed its song since it last
# sent them: otherwise the service keeps the take's song and name, so a ★
# does not undo a move made there. The song's tempo is the song's, sent with
# it (service_songs.py), and is kept here only to see that it moved.
SONG_FIELDS = ("song", "song_id", "name")


def staging_root():
    """Where the files made for the band service wait until they are up:
    beside the settings, out of the recordings folder and the cloud folder."""
    from rehearsal_recorder import api as apimod  # its path, as the suites set it

    return Path(apimod.CONFIG_PATH).with_name("band-service")


class _Changed(Exception):
    """The take changed under the sending (it went, was cropped or renamed,
    or the key went): the pass stops, and the next one sends it as it is
    now."""


class _Paused(Exception):
    """A take started recording, or something started playing: the pass
    stops at its next file, part or block of a file being made, and carries
    on from there once the sound has stopped. Its argument is why, as
    Api._sound_busy says it."""


def _sources(take):
    """The files a take is made from, as it names them."""
    return [x.get("file") for x in (take.get("tracks") or []) + (take.get("notes") or [])]


class BandService:
    """
    The band service as a module of `sending`. One worker thread, one take
    at a time, never while a take records or plays. The tables are the
    library's (ServiceCopy, ServiceFile, ServiceDelete); what is only for
    this run is here: the lines in the list of background work, and when a
    take that met no internet is tried again.
    """

    id = "service"
    # A take that met no internet is tried again after this long.
    RETRY_SEC = 30
    # How often РЭХА asks the service which of its takes it has.
    CHECK_SEC = 3600

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
        # When to ask the service which takes it has: at once, the first time.
        self._next_check = 0.0
        # Takes up in the service without the band's tempo through them: sent
        # before РЭХА counted it there. Each gets it on its own, with no line
        # in the list, once nothing else is waiting.
        self._owed = set()
        # (take, generation) whose tempo the service turned down: not sent
        # again in this run, unless the take changes.
        self._drift_refused = set()
        self._active = None
        # The songs: their numbers in the service, and what goes both ways.
        self.songs = ServiceSongs(self)
        # Files are being made, or a take's WAVs read for its tempo: the
        # names pass waits, since it moves folders.
        self.making = False
        self._closing_anyway = False
        self._thread = None
        self._wake = threading.Event()
        self._stopping = False

    @property
    def _lib(self):
        return self.api._lib

    def _keyed(self):
        return parse_key(self.api._config.get("service_key")) is not None

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
        if (self._lib.service_row(folder, take_number) or {}).get("removed"):
            return  # taken out by hand: it goes only when sent by hand
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
        if row is not None and row["removed"]:
            # Taken out: nothing of it goes until it is back. A crop still
            # makes a new generation, so the take goes up as cropped then,
            # with the band's comments moved back by it.
            if cut_start is not None:
                self._lib.change_service_row(row["take_id"], lambda r: {
                    "gen": r["gen"] + 1, "pending_cut": float(r["pending_cut"] or 0) + float(cut_start)})
            return
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
            if not copy or copy.get("removed"):
                continue  # never sent, or in the service's trash already
            columns = record.get("take") or {}
            song = record.get("song") or {}
            title, go = song.get("title"), columns.get("go")
            # One with no song and no go yet was deleted before migration 0015:
            # its take number is its place in the rehearsal, not for reading.
            name = "Take" if title is None and go is None else take_name(title, go, columns.get("take_number"))
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
        self._queue(folder, take_number, take, by_hand=True)
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
        trash, and stops being sent. The take in РЭХА stays as it is, and
        keeps the name the service knows it by: sent again, it comes out of
        the trash with its comments. Its files go again then, since the
        trash may have been emptied meanwhile."""
        folder = Path(folder)
        take, refused = self._take_or_error(folder, take_number)
        if refused:
            return refused
        row = self._lib.service_row(folder, take_number)
        if row is not None and not row["removed"]:
            # The delete first, so the hourly check never reads the take as
            # taken out with no delete on its way and sends it again.
            self._lib.add_service_delete(row["uid"], take["name"])
            self._taken_out(row["take_id"])
            self._to_trash(row["take_id"], row["uid"], take["name"])
        return {"ok": True, "take": self._lib.take(folder, take_number)}

    def _taken_out(self, take_id):
        """The take is out of the service, as Remove from the band service
        leaves it: nothing of it goes until it is sent by hand, and then all
        its files go, since the trash may have been emptied meanwhile. A pass
        sending it stops at its next part. Nothing is asked of the service."""
        with self._lock:
            self._edits[take_id] = self._edits.get(take_id, 0) + 1
            row = self._lib.change_service_row(take_id, lambda r: {
                "removed": True, "due": False, "error": None, "sent": None,
                "mp3_gen": None, "flac_gen": None, "by_hand": False})
            entry = self._entries.pop(take_id, None)
            self._owed.discard(take_id)
        if entry is not None:
            entry.discard()
        if row is None:
            return
        self._lib.drop_service_files(take_id)
        shutil.rmtree(staging_root() / row["uid"], ignore_errors=True)

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
        names = service_files.names(take)

        def up(name, whole):
            return whole or bool((made.get(name) or {}).get("done"))

        files = []
        for t in take["tracks"]:
            i = names["tracks"].get(t["name"])
            mid = names["notes"].get(t["name"])
            files.append({"name": t["name"],
                          "mp3": i is not None and up(f"{i}.mp3", mp3_all),
                          "flac": i is not None and up(f"{i}.flac", flac_all),
                          "mid": None if mid is None else up(mid, mp3_all)})
        return {"ok": True, "files": files}

    # ---------- what is left ----------

    def states(self, folder):
        """What this rehearsal's takes are doing, by take number."""
        return self.on_the_way(folder)[0]

    def on_the_way(self, folder):
        """states(folder), and the take numbers among them whose MP3s are
        up already (the take's "service" "up"), in one reading of the
        rows."""
        out, up = {}, []
        if not self._keyed():
            return out, up
        for row in self._lib.service_rows():
            if row["due"] and Path(row["folder"]) == Path(folder):
                out[row["take_number"]] = "working" if row["take_id"] == self._active else "queued"
                if not row["removed"] and row["mp3_gen"] == row["gen"]:
                    up.append(row["take_number"])
        return out, up

    def left(self):
        """The takes still to send or to put in the trash, and the bytes of
        their files not up yet. A take whose files are not made yet counts
        what its WAVs will come to. Nothing without a key: nothing goes."""
        if not self._keyed():
            return {"takes": 0, "bytes": 0}
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
            threading.Thread(target=self._ask, args=(window,), daemon=True).start()
        return False

    def _ask(self, window):
        """The page asks whether to close; one that cannot (not loaded yet,
        or broken) would leave a window nobody can close, so it closes."""
        try:
            took = window.evaluate_js(CLOSING_JS)
        except Exception:  # noqa: BLE001 - any failure of the page's means it cannot ask
            took = False
        if not took:
            self.close_anyway()

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
        was = config.pop("service_was", None) or address_of(config.get("service_key"))
        if was is not None and was != address_of(key):
            self.forget()  # what it knew is another service's
        config["service_key"] = key
        config["send_to"] = self.id
        self.api._write_config()
        self._wake.set()
        return {"ok": True, "address": address_of(key), **({"unchecked": True} if unchecked else {})}

    def disconnect(self):
        """
        The key forgotten; new takes go to the cloud folder again, and
        nothing goes to the service. What is there stays, and РЭХА keeps
        knowing which takes those are, and what was still on its way: a key
        to the same service carries on from there (a new key after the old
        one was taken off Members). A key to another service forgets it all
        (set_key). The files made for the sending go: they are made again.
        """
        config = self.api._config
        address = address_of(config.pop("service_key", None))
        if address is not None:
            config["service_was"] = address
        config["send_to"] = "cloud"
        self.api._write_config()
        with self._lock:
            entries, self._entries = list(self._entries.values()), {}
            self._later.clear()
            self._refused.clear()
            self._owed.clear()
            self._drift_refused.clear()
        for entry in entries:
            entry.discard()
        self._lib.drop_all_service_files()
        shutil.rmtree(staging_root(), ignore_errors=True)
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
        """A key to another service: everything РЭХА knew of the old one is
        dropped, every line of it, and the files made for it. A pass under
        way stops at its next part, finding its take gone."""
        self._lib.forget_service()
        self.songs.forget()
        with self._lock:
            entries, self._entries = list(self._entries.values()), {}
            self._edits.clear()
            self._later.clear()
            self._refused.clear()
            self._owed.clear()
            self._drift_refused.clear()
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
            name = shown_name(take.get("song"), take.get("go"), take_number)
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
            # The name kept for the line is the stored one (take_name).
            entry = self.api._journal.begin(
                self.id, f"“{shown_from_name(name)}” → band service trash", waiting=True)
            self._entries[key] = entry
            return entry

    def _queue(self, folder, take_number, take=None, by_hand=False):
        """The take on its way. One taken out by hand keeps its uid, and if
        it has not reached the service's trash yet, it is not sent there.
        One sent `by_hand` comes out of the service's trash whoever put it
        there."""
        row = self._lib.add_service_row(folder, take_number, str(uuid.uuid4()),
                                        due=True, error=None, removed=False,
                                        **({"by_hand": True} if by_hand else {}))
        if row is None:
            return None
        self._lib.drop_service_delete(row["uid"])
        with self._lock:
            gone = self._entries.pop(("delete", row["uid"]), None)
        if gone is not None and gone.snapshot()["state"] == "waiting":
            gone.discard()
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
        at once, as waiting, and the takes an older РЭХА was turned away
        with go again."""
        if self._keyed():
            again = self._lib.requeue_service_refusals(UPDATE_REHA)
            if again:
                print(f"Band service: {again} takes an older РЭХА could not send go again", file=sys.stderr)
            self._tidy()

    def check_soon(self):
        """A rehearsal has started: the service is asked what the band
        changed there, at the next turn."""
        self._next_check = 0.0
        self._wake.set()

    def run_next(self):
        """One take, or one deletion. False when there was nothing to do,
        or not now: while a take records or anything plays, or before a take
        that met no internet is due to be tried again."""
        if self.api._sound_busy() or self.api._library is None or not self._keyed():
            return False
        self._tidy()
        now = time.monotonic()
        if now >= self._next_check:
            self._next_check = now + self.CHECK_SEC
            self._compare()
            return True
        # A song goes before any take: a take carries its song's number.
        if self._later.get("songs", 0) <= now and self.songs.owed() is not None:
            self._push_songs()
        for d in self._deletes():
            if self._later.get(("delete", d["uid"]), 0) <= now:
                return self._delete(d)
        rows = self._lib.service_rows()
        # The take saved by the last Stop waits while it is held (Api._held):
        # the band may still throw it away. The takes after it go meanwhile.
        # Asked after the rows are read: Stop holds a take before saving it
        # adds its row, so a row read here was held already if it is to be.
        held = self.api._held()
        for row in rows:
            if (row["due"] and self._later.get(row["take_id"], 0) <= now
                    and not self._is_held(row, held)):
                return self._send_take(row)
        for row in rows:
            if row["take_id"] in self._owed and self._later.get(("drift", row["take_id"]), 0) <= now:
                return self._catch_up(row)
        return False

    @staticmethod
    def _is_held(row, held):
        """Whether a row is of the take held after Stop: `held` is what
        Api._held answered."""
        return (held is not None and Path(row["folder"]) == held[0]
                and row["take_number"] == held[1])

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

    def wake(self):
        self._wake.set()

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

    def _push_songs(self):
        """РЭХА's changes to its songs, to the service; a take goes after
        them in the same turn. No internet tries
        again soon; a service that turned it down (one from before songs had
        numbers, say) is asked again in an hour."""
        try:
            self.songs.push(self._client())
        except Offline:
            self._later["songs"] = time.monotonic() + self.RETRY_SEC
        except (Refused, Gone) as e:
            print(f"Band service: songs could not go: {e}", file=sys.stderr)
            self._later["songs"] = time.monotonic() + self.CHECK_SEC

    def _compare(self):
        """
        The songs first (service_songs.py), then the takes.

        Which of its takes the service has, against what РЭХА holds of them.
        A take the band deleted there, or the service deleted for good, is
        taken out here. A take РЭХА had taken out that is back there (someone
        pressed Restore) is sent again: only what of it is not up goes, and
        its changes follow from then on. A take the service has without the
        MP3s РЭХА sent has them sent again. A take whose delete has not
        reached the service yet is left as it is. No internet asks again soon; a
        service that turned the question down is asked again in an hour.
        """
        try:
            self.songs.check(self._client())
        except Offline:
            self._next_check = time.monotonic() + self.RETRY_SEC
            return
        except (Refused, Gone) as e:
            # A service from before songs had numbers: the takes all the same.
            print(f"Band service: the songs could not be checked: {e}", file=sys.stderr)
        try:
            listed = self._client().takes()
        except Offline:
            self._next_check = time.monotonic() + self.RETRY_SEC
            return
        except (Refused, Gone):
            return
        there = {t["uid"]: t for t in listed}
        # The rows first, then the deletes: Remove from the band service
        # writes its delete down before a row can read as taken out.
        rows = self._lib.service_rows()
        on_the_way = {d["uid"] for d in self._lib.service_deletes()}
        for row in rows:
            if row["uid"] in on_the_way:
                continue
            t = there.get(row["uid"])
            if t is None or t.get("trashed"):
                # Gone for good there only once it was ever up: one on its
                # first way has not reached the service yet. One just sent
                # by hand comes out of the trash with its details.
                if not row["removed"] and not row["by_hand"] and (t is not None or row["mp3_gen"] is not None):
                    self._taken_out(row["take_id"])
            elif row["removed"] or (row["mp3_gen"] or 0) > (t.get("mp3_gen") or 0):
                # Back in the service, or there without the MP3s РЭХА sent:
                # what of it is not up goes (again).
                if row["take_id"] == self._active:
                    continue  # a pass is sending it now, and knows better
                with self._lock:
                    self._edits[row["take_id"]] = self._edits.get(row["take_id"], 0) + 1
                    self._lib.change_service_row(row["take_id"], lambda r, t=t: {
                        "removed": False, "due": True, "error": None,
                        "mp3_gen": t.get("mp3_gen"), "flac_gen": t.get("flac_gen")})
                self._line(row["take_id"], row["folder"], row["take_number"])
            elif ("drift_gen" in t and t.get("drift_gen") != row["gen"] and t.get("mp3_gen") == row["gen"]
                  and not row["due"] and (row["take_id"], row["gen"]) not in self._drift_refused):
                # Up from before РЭХА sent the band's tempo, or its count
                # could not read the files last time. A service that does
                # not say which it has is not asked to keep it.
                self._owed.add(row["take_id"])

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
        except _Paused as e:
            entry.start(PLAYING_STEP if e.args and e.args[0] == "playing" else RECORDING_STEP)
        except Offline as e:
            entry.start(e.step)
            self._later[take_id] = time.monotonic() + self.RETRY_SEC
        except (Refused, service_files.CannotMake, OSError) as e:
            words = getattr(e, "words", None) or str(e)
            self._lib.change_service_row(take_id, lambda r: {"due": False, "error": words})
            with self._lock:
                self._entries.pop(take_id, None)
            entry.fail(words, retry=self.id)
        except Exception as e:  # noqa: BLE001 - one take's fault must not stop the takes after it
            words = f"Could not send it: {e}"
            self._lib.change_service_row(take_id, lambda r: {"due": False, "error": words})
            with self._lock:
                self._entries.pop(take_id, None)
            entry.fail(words, retry=self.id)
        finally:
            with self._lock:
                self._active = None
        return True

    def _check(self, take_id, gen):
        """The key is there, no take is recording and nothing plays, and the
        take is still there, at the generation being sent and not taken out."""
        if not self._keyed():
            raise _Changed()
        busy = self.api._sound_busy()
        if busy:
            raise _Paused(busy)
        row = self._lib.service_row_of(take_id)
        if row is None or row["gen"] != gen or row["removed"]:
            raise _Changed()
        return row

    def _moved(self, take_id, take):
        """A file the take named is not on disk. If the take names other
        files now (a rename moved its folder), the pass stops and the next
        one reads it again; otherwise the file is gone, and that stands."""
        row = self._lib.service_row_of(take_id)
        now = None if row is None else self._lib.take(row["folder"], row["take_number"])
        if now is None or _sources(now) != _sources(take):
            raise _Changed()

    def _send(self, row, entry, edits):
        lib = self.api._lib
        take_id, uid, gen = row["take_id"], row["uid"], row["gen"]
        folder, number = row["folder"], row["take_number"]
        take = lib.take(folder, number)
        if take is None:
            raise _Changed()
        client = self._client()
        entry.start("Sending the details")
        cut = float(row["pending_cut"] or 0)
        meta = self._details(take, folder, gen, cut)
        answer = client.put_take(uid, {**self._put(meta, row["sent"]), "by_hand": bool(row["by_hand"])})
        if row["by_hand"]:
            lib.change_service_row(take_id, lambda r: {"by_hand": False})
        if isinstance(answer, dict) and answer.get("in_trash"):
            # Someone in the band deleted it there: taken out here too.
            self._taken_out(take_id)
            raise _Changed()
        sent_before = row["sent"] or {}
        if row["sent"] is None or any(sent_before.get(k) != meta.get(k) for k in ("song", "name")):
            # The service has its song and name now. Kept at once, not with
            # the rest once the files are up: a take the band moves to
            # another song while its FLAC still goes stays moved when this
            # goes again after a pause, a ★ or a dropped connection.
            lib.change_service_row(take_id, lambda r: {} if r["removed"] else {
                "sent": {**(r["sent"] or {}), "song": meta.get("song"), "name": meta.get("name")}})

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
        # Counted again for a new click, song or song's tempo: what the line
        # is measured against has moved.
        moved = any(sent_before.get(k) != meta.get(k) for k in ("meter", "song", "tempo"))
        if isinstance(answer, dict) and "drift_gen" in answer and (answer["drift_gen"] != gen or moved):
            try:
                self._send_drift(client, take_id, uid, gen, folder, number, entry)
            except (_Changed, _Paused, Offline):
                raise
            except Exception as e:  # noqa: BLE001 - the band can play the take all the same
                print(f"The tempo of a take could not be sent to the band service: {e}", file=sys.stderr)
        self._owed.discard(take_id)

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

    def _put(self, meta, sent):
        """What of the take's details goes: all of them, but its song and
        name only when they differ from what was last sent (and the first
        time), with the song's number when it has one."""
        out = {k: v for k, v in meta.items() if k != "tempo"}
        if sent is not None and all(sent.get(k) == meta.get(k) for k in ("song", "name")):
            for k in SONG_FIELDS:
                out.pop(k, None)
            return out
        number = self.songs.number_of(meta.get("song"))
        if number is not None:
            out["song_id"] = number
        return out

    def _details(self, take, folder, gen, cut):
        """The take's details as the service takes them (service_files.meta)."""
        lib = self.api._lib
        ref = lib.rehearsal_ref(folder) or {}
        rehearsal = {"id": ref.get("id"), "created_at": ref.get("created_at", ""),
                     "name": (lib.rehearsal(folder) or {}).get("name", "")}
        # The song's tempo as it is now: the band service keeps it for the song.
        tempo = lib.song_tempos().get(take.get("song") or "", (None, None))[0]
        return service_files.meta(take, rehearsal, lib.labels(), self.api._config.get("volumes", {}), gen, cut, tempo)

    def _send_drift(self, client, take_id, uid, gen, folder, number, entry=None):
        """
        The band's tempo through the take, for the line along Master's lane
        in the service: counted here as the player counts it (Api.take_drift,
        which keeps its last answers, so a take just played is not counted
        again). It goes once the take's files are up, so the band hears the
        take without waiting for the count. Record stops the count, and the
        take waits for the pass after the recording. A count that could not
        read the files sends nothing. One the service turns down is left out
        for the rest of the run.
        """
        self._check(take_id, gen)
        take = self._lib.take(folder, number)
        if take is None:
            raise _Changed()
        if entry is not None:
            entry.start(COUNTING_STEP)
        self.making = True
        try:
            answer = self.api.take_drift(take.get("tracks"), take.get("notes"), {
                "tempo": take.get("tempo"), "signature": take.get("signature"),
                "click": take.get("click") is True, "song": take.get("song")})
        finally:
            self.making = False
        if isinstance(answer, dict) and answer.get("why") == "recording":
            raise _Paused("recording")
        kept = service_files.drift(answer)
        if kept is None:
            return
        # A crop while it was counted: the count is the old files'.
        self._check(take_id, gen)
        try:
            client.put_drift(uid, gen, kept)
        except Refused as e:
            self._drift_refused.add((take_id, gen))
            print(f"The band service turned down the tempo of a take: {e.words}", file=sys.stderr)

    def _catch_up(self, row):
        """
        A take that went up before РЭХА sent the band's tempo gets it now.
        Its details go first, once: as they were last sent, with its click
        and its notes' icons added, so the levels the band hears it at in the
        service stay as they were. No line in the list: nothing the band
        waits for is held up, and nothing they would need to do comes of it.
        No internet tries again later. A take taken out, changed or due again
        meanwhile is left to its own pass. A count that could not read the
        files sends nothing, and the next look at the service, an hour on,
        brings the take back here.
        """
        take_id, gen = row["take_id"], row["gen"]
        try:
            row = self._check(take_id, gen)
            if (row["due"] or row["error"] or row["mp3_gen"] != gen
                    or row["uid"] in {d["uid"] for d in self._lib.service_deletes()}):
                raise _Changed()
            take = self._lib.take(row["folder"], row["take_number"])
            if take is None:
                raise _Changed()
            client = self._client()
            sent = row["sent"]
            if sent is not None and "meter" not in sent:
                fresh = self._details(take, row["folder"], gen, 0)
                # Nothing to move: the service shows this generation already.
                details = {**sent, "cut_start": 0, "meter": fresh["meter"], "notes": fresh["notes"]}
                # Its song and name as they were: left out, so a move made there stays.
                put = {k: v for k, v in details.items() if k not in (*SONG_FIELDS, "tempo")}
                answer = client.put_take(row["uid"], {**put, "by_hand": False})
                self._lib.change_service_row(take_id, lambda r: {"sent": details} if r["gen"] == gen else {})
                if isinstance(answer, dict) and answer.get("in_trash"):
                    self._taken_out(take_id)
                    raise _Changed()
            self._send_drift(client, take_id, row["uid"], gen, row["folder"], row["take_number"])
            self._owed.discard(take_id)
        except _Paused:
            pass  # once the sound has stopped
        except Offline:
            self._later[("drift", take_id)] = time.monotonic() + self.RETRY_SEC
        except _Changed:
            self._owed.discard(take_id)
        except Exception as e:  # noqa: BLE001 - one take's tempo must not stop the takes after it
            print(f"The tempo of a take could not be sent to the band service: {e}", file=sys.stderr)
            self._owed.discard(take_id)
        return True

    def _make(self, take_id, uid, gen, take, kinds, entry):
        """The files of these kinds, made once: one made already, for an
        upload cut short, is the one sent."""
        made = self._lib.service_files(take_id, gen)
        for name, f in list(made.items()):
            if not f["done"] and not (staging_root() / f["path"]).exists():
                # Gone from the disk before it was all up: made again.
                self._lib.drop_service_file(take_id, gen, name)
                del made[name]
        todo = [i for i in service_files.plan(take, kinds) if i["name"] not in made]
        if todo:
            entry.start("Making the files")
        self.making = True
        try:
            for item in todo:
                self._check(take_id, gen)
                path = staging_root() / uid / str(gen) / item["name"]
                try:
                    service_files.make(item, path, stop=self.api._sound_busy)
                except service_files.Stopped:
                    # Play pressed while an MP3 or FLAC was being made: it
                    # is made again from its start next time.
                    raise _Paused(self.api._sound_busy() or "playing") from None
                except (service_files.CannotMake, OSError):
                    self._moved(take_id, take)
                    raise
                self._lib.add_service_file(take_id, gen, item["name"], f"{uid}/{gen}/{item['name']}",
                                           path.stat().st_size)
        finally:
            self.making = False
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
                try:
                    fh = open(path, "rb")
                except FileNotFoundError:
                    # Gone from the disk meanwhile: made again next time.
                    self._lib.drop_service_file(take_id, gen, name)
                    raise _Changed() from None
                with fh:
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

