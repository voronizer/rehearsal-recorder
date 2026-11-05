"""
Songs kept the same in РЭХА and the band service
(docs/superpowers/specs/2026-11-05-song-sync-design.md). A song has one
number, which the service gives. Its title, tempo and signature change on
either side; files go only from РЭХА to the service.

Three values say who changed what, with no clocks: what РЭХА has now, what
the service has, and what the two last agreed on (models.ServiceSong). Only
РЭХА's differs from the agreed one: the change is РЭХА's and goes there.
Only the service's: РЭХА takes it. Both: РЭХА's change was made with no
internet and has not reached the service yet; it goes now, reaches the
service later, and wins.

РЭХА's own changes go at once (push), before any take, since a take
carries its song's number. The check (when РЭХА starts, when a rehearsal
starts, and every hour) also reads the service's songs and does here what
the band did there: a rename, a tempo, a new song, a song deleted, a take
moved to another song. Each is a line in the list of background work, and a
check that brought any shows one notice (`news`).
"""

import sys
import threading

from rehearsal_recorder.sending.service_client import Refused
from rehearsal_recorder.store.library import SongRefused

# The lines' kind in the list: the band service's.
KIND = "service"


def _meter(tempo, signature):
    """“132 bpm · 4/4”, “198 ♪ · 6/8”, as РЭХА writes a tempo (format.ts)."""
    if tempo is None:
        return "no tempo"
    return f"{tempo} {'♪' if signature == '6/8' else 'bpm'} · {signature}"


def _tempo(value):
    return None if value is None else int(round(float(value)))


def news_text(names, songs):
    """The notice for a check that brought changes: “Ivan changed 4 songs
    in the band service”; two people are “Ivan and Vik”, more (or nobody
    named) “The band”."""
    who = list(dict.fromkeys(n for n in names if n))
    said = who[0] if len(who) == 1 else f"{who[0]} and {who[1]}" if len(who) == 2 else "The band"
    return f"{said} changed {songs} {'song' if songs == 1 else 'songs'} in the band service"


def _by(name, done, alone):
    """“Ivan renamed it in the band service”, or “Renamed in the band
    service” when the service does not say who."""
    return f"{name} {done} in the band service" if name else f"{alone} in the band service"


class ServiceSongs:
    """The songs' side of the band service's sending (band_service.py), on
    its worker thread."""

    def __init__(self, service):
        self.service = service
        self._lock = threading.Lock()
        # The notice of the last check that brought changes: {"id", "text"}.
        self.news = None
        self._news_id = 0
        # What was owed when a push left it owed (a merge whose song has no
        # number, say): not tried again until it changes, or the next check.
        self._stuck = None

    @property
    def _api(self):
        return self.service.api

    @property
    def _lib(self):
        return self.service.api._lib

    def forget(self):
        """A key to another service: nothing of the old one is owed or said."""
        with self._lock:
            self.news = None
            self._stuck = None

    # ---------- what РЭХА owes the service ----------

    def owed(self):
        """What РЭХА changed in its songs that the service has not had, as
        something to compare: the merges, the songs with no number, and the
        songs whose title or tempo is not what was agreed. None for nothing,
        and for what a push already left owed."""
        lib = self._lib
        merges = tuple((m["from_sid"], m["into_song_id"]) for m in lib.service_song_merges())
        new = tuple((s["id"], s["title"]) for s in lib.songs_without_number())
        changed = tuple((r["song_id"], r["now"]["title"], r["now"]["tempo"], r["now"]["signature"])
                        for r in lib.service_songs() if self._mine(r))
        owed = (merges, new, changed)
        if not any(owed) or owed == self._stuck:
            return None
        return owed

    @staticmethod
    def _mine(r):
        """Whether РЭХА changed the song since the two sides agreed."""
        now = r["now"]
        return now["title"] != r["title"] or (now["tempo"], now["signature"]) != (r["tempo"], r["signature"])

    def push(self, client):
        """РЭХА's changes to the service: numbers for the songs that have
        none (the first time, every song at once), the merges, then each
        song's title and tempo. Offline and Refused for the whole call are
        the caller's."""
        before = self.owed()
        self._number(client)
        self._merges(client)
        for r in self._lib.service_songs():
            if self._mine(r):
                self._send_change(client, r, None)
        if before is not None and self.owed() == before:
            self._stuck = before

    def _number(self, client):
        lib = self._lib
        todo = lib.songs_without_number()
        if not todo:
            return
        if not lib.service_songs():
            # The first time with this service: songs are matched by their
            # titles, and pairs that came apart after a rename here are
            # joined by the titles they had.
            ids = client.link_songs([{"title": s["title"], "old_names": s["also"],
                                      "tempo": s["tempo"], "signature": s["signature"]} for s in todo])
            for s, sid in zip(todo, ids):
                lib.link_service_song(s["id"], sid, s["title"], s["tempo"], s["signature"])
            print(f"Band service: songs linked: {len(todo)}", file=sys.stderr)
            return
        for s in todo:
            sid = client.add_song(s["title"], s["tempo"], s["signature"])
            lib.link_service_song(s["id"], sid, s["title"], s["tempo"], s["signature"])

    def _merges(self, client):
        lib = self._lib
        numbers = {r["song_id"]: r["sid"] for r in lib.service_songs()}
        for m in lib.service_song_merges():
            into = numbers.get(m["into_song_id"])
            if into is None:
                continue  # its song gets a number first
            try:
                client.merge_song(m["from_sid"], into)
            except Refused as e:
                # The song it went into is gone there, say: nothing to merge into.
                print(f"Band service: a merge was turned down: {e.words}", file=sys.stderr)
            lib.drop_service_song_merge(m["id"])

    def _send_change(self, client, r, there):
        """The song's title and tempo where РЭХА changed them, in one call.
        `there` is the service's song when the check read it, None between
        checks. A title another song has there is put back here, and its line
        says why."""
        now = r["now"]
        fields = {}
        if now["title"] != r["title"]:
            fields["title"] = now["title"]
        if (now["tempo"], now["signature"]) != (r["tempo"], r["signature"]):
            fields.update(tempo=now["tempo"], signature=now["signature"])
        if not fields:
            return
        if there is not None:
            # Changed on both sides since they agreed: РЭХА's goes, as the later.
            lost = []
            if "title" in fields and there.get("title") != r["title"]:
                lost.append("title")
            if "tempo" in fields and (_tempo(there.get("tempo")), there.get("signature")) != (r["tempo"], r["signature"]):
                lost.append("tempo")
            if lost:
                print(f"Band service: {now['title']}: РЭХА's {' and '.join(lost)} replaces the band service's",
                      file=sys.stderr)
        try:
            client.change_song(r["sid"], **fields)
        except Refused as e:
            if e.status == 404:
                # Gone from the service for good: a number again at the next turn.
                self._lib.unlink_service_song(r["song_id"])
                return
            if "title" in fields and e.status == 409:
                self._title_back(r, e.words)
                return
            print(f"Band service: a change to {now['title']} was turned down: {e.words}", file=sys.stderr)
            # Not sent again and again: the service keeps what it has.
            self._lib.agree_service_song(r["song_id"], **fields)
            return
        self._lib.agree_service_song(r["song_id"], **fields)

    def _title_back(self, r, words):
        """A rename the service turned down, since another song there has
        the title: the song gets its title back here, and the line says why
        (round 3, Q19)."""
        tried = r["now"]["title"]
        print(f"Band service: renaming {r['title']} to {tried} was turned down: {words}", file=sys.stderr)
        done = self._api._rename_song(r["song_id"], r["title"])
        if not done.get("ok"):
            print(f"Band service: {tried} could not have its title back: {done.get('error')}", file=sys.stderr)
            return
        self._api._journal.begin(KIND, f"Renaming {r['title']} to {tried}").fail(words)

    # ---------- the check ----------

    def check(self, client):
        """РЭХА's changes go, then the service's are done here: songs
        deleted there, renamed, given a tempo, new, and takes moved. Offline
        and Refused for the whole call are the caller's."""
        with self._lock:
            self._stuck = None
        self._number(client)
        self._merges(client)
        listed = client.songs()
        there = {s["id"]: s for s in listed["songs"]}
        done = []  # (who, song key) for each change the band made there
        for r in self._lib.service_songs():
            s = there.get(r["sid"])
            if s is None or s.get("trashed"):
                self._gone(r, s, done)
                continue
            self._send_change(client, r, s)
            self._take_change(r, s, done)
        self._new_songs(there, done)
        self._moves(listed["moved"], done)
        if done:
            # The metronome's row follows a song renamed or given a tempo.
            self._api._follow_next()
            with self._lock:
                self._news_id += 1
                self.news = {"id": self._news_id,
                             "text": news_text([w for w, _ in done], len({k for _, k in done}))}
        print(f"Band service: songs checked, changes from the band service: {len(done)}", file=sys.stderr)

    def _gone(self, r, s, done):
        """A song in the service's Trash, or gone from it: with no takes on
        this computer it goes here too, its backing track to the Trash; with
        takes it stays, and a take sent again brings it back there."""
        if r["now"]["takes"]:
            if s is None:
                self._lib.unlink_service_song(r["song_id"])
            return
        try:
            removed = self._lib.remove_song(r["song_id"])
        except SongRefused:
            return  # a take came meanwhile
        if removed is None:
            return
        backing = self._api._backing
        if removed["backing"] is not None:
            backing.trash_copy(removed["backing"])
            backing.refresh()
        who = s.get("trashed_by") if s else None
        self._line(removed["title"], _by(who, "deleted it", "Deleted"))
        done.append((who, ("song", r["sid"])))

    def _take_change(self, r, s, done):
        """What the band changed there that РЭХА did not change here."""
        now = r["now"]
        if s["title"] != r["title"] and now["title"] == r["title"]:
            self._rename_here(r, s, done)
        tempo, signature = _tempo(s.get("tempo")), s.get("signature")
        if (tempo, signature) != (r["tempo"], r["signature"]) and (now["tempo"], now["signature"]) == (r["tempo"], r["signature"]):
            saved = self._api.set_song_tempo(r["song_id"], tempo, signature)
            if not saved.get("ok"):
                print(f"Band service: the tempo of {now['title']} could not be set: {saved.get('error')}",
                      file=sys.stderr)
                return
            self._lib.agree_service_song(r["song_id"], tempo=tempo, signature=signature)
            title = s["title"] if s["title"] != r["title"] else now["title"]
            self._line(f"{title}: {_meter(tempo, signature)}",
                       _by(s.get("meter_by"), "changed the tempo", "Tempo changed"))
            done.append((s.get("meter_by"), ("song", r["sid"])))

    def _rename_here(self, r, s, done):
        """The band renamed the song there: renamed here as Rename song does,
        its takes and folders after it. A title that is another song's old
        name here is forgotten there first."""
        title, who = s["title"], s.get("title_by")
        said = _by(who, "renamed it", "Renamed")
        got = self._api._rename_song(r["song_id"], title, said=said)
        into = got.get("into")
        if not got.get("ok") and into and into["title"].casefold() != title.casefold():
            self._lib.forget_song_name(title)
            got = self._api._rename_song(r["song_id"], title, said=said)
        if not got.get("ok"):
            print(f"Band service: {r['title']} could not be renamed {title}: {got.get('error')}", file=sys.stderr)
            return
        self._lib.agree_service_song(r["song_id"], title=title)
        if not got.get("goes"):
            # With takes, the names pass has the line.
            self._line(f"Renaming {r['title']} to {title}", said)
        done.append((who, ("song", r["sid"])))

    def _new_songs(self, there, done):
        """Songs made in the service: made here as New song makes one. A
        song here with that title and no number is the same song."""
        lib = self._lib
        numbered = {r["sid"]: r["song_id"] for r in lib.service_songs()}
        for s in there.values():
            if s["id"] in numbered or s.get("trashed"):
                continue
            tempo, signature = _tempo(s.get("tempo")), s.get("signature")
            same = lib.song_id(s["title"])
            if same is not None:
                if same in numbered.values():
                    print(f"Band service: {s['title']} has another number here", file=sys.stderr)
                    continue
                lib.link_service_song(same, s["id"], s["title"], tempo, signature)
                # Its tempo is РЭХА's when it has one (it goes next), the service's otherwise.
                mine = lib.song(same) or {}
                if mine.get("tempo") is None and tempo is not None:
                    self._api.set_song_tempo(same, tempo, signature)
                continue
            lib.forget_song_name(s["title"])
            made = self._api.add_song(s["title"])
            if not made.get("ok"):
                print(f"Band service: {s['title']} could not be made here: {made.get('error')}", file=sys.stderr)
                continue
            if tempo is not None:
                self._api.set_song_tempo(made["id"], tempo, signature)
            lib.link_service_song(made["id"], s["id"], s["title"], tempo, signature)
            numbered[s["id"]] = made["id"]
            self._line(s["title"], f"New song from {s['made_by']} in the band service" if s.get("made_by")
                       else "New song in the band service")
            done.append((s.get("made_by"), ("song", s["id"])))

    def _moves(self, moved, done):
        """Takes the band moved to another song there: renamed here as Rename
        take renames them, the song's next number and folder, and then sent
        with their new song and name, which ends the wait there. One being
        cropped waits for the next check."""
        lib = self._lib
        titles = {r["sid"]: r["now"]["title"] for r in lib.service_songs()}
        for m in moved:
            title = titles.get(m.get("song_id"))
            row = lib.service_row_by_uid(m["uid"])
            if title is None or row is None or row["removed"]:
                continue
            take = lib.take(row["folder"], row["take_number"])
            if take is None:
                continue
            if (take.get("song") or "").casefold() == title.casefold():
                # Its song here already: its song and name go again, so the
                # service knows РЭХА has numbered it.
                lib.change_service_row(row["take_id"], lambda c: {"sent": {**(c["sent"] or {}), "song": None}})
                self.service.edited(row["folder"], row["take_number"])
                continue
            got = self._api.rename_take(row["folder"], row["take_number"], title)
            if not got.get("ok"):
                print(f"Band service: {take['name']} could not move to {title}: {got.get('error')}", file=sys.stderr)
                continue
            self._line(f"{take['name']} → {got['take']['name']}", _by(m.get("by"), "moved it", "Moved"))
            done.append((m.get("by"), ("song", m.get("song_id"))))

    def _line(self, title, detail):
        """A change the band made there, done, as a line in the list."""
        self._api._journal.begin(KIND, title).done(detail)

    # ---------- what a take carries ----------

    def number_of(self, title):
        """The number of the song titled `title` in the service, or None for
        no song, or one with no number yet."""
        if not title:
            return None
        key = title.casefold()
        for r in self._lib.service_songs():
            if r["now"]["title"].casefold() == key:
                return r["sid"]
        return None
