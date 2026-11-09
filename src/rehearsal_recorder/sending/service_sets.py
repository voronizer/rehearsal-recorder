"""
Sets kept the same in РЭХА and the band service
(docs/superpowers/specs/2026-11-09-gig-sets-design.md), as songs are
(service_songs.py). A set has one number, which the service gives. Its name
and its songs, in their order, change on either side. A song's typed length
lives in the service only.

The same three values as for songs say who changed what (models.ServiceSet):
what РЭХА has now, what the service has, and what the two last agreed on.
Only РЭХА's differs from the agreed one: the change goes there. Only the
service's: РЭХА takes it. Both: РЭХА's was made with no internet; it goes
now and wins. A set's songs are compared as the service's numbers. A song
in the service's Trash is left out of its sets there, and one with no
number is not there at all; here either keeps its place in the set, and
neither side's list is read as changed for it.

РЭХА's own changes go at once (push), after the songs and before any take.
A set names its songs by their numbers, so a title in a set that is no song
yet (a song nobody has played) is made a song first, as New song makes one.
The check, after the songs' and before the takes', also reads the service's
sets and does here what the band did there: a new set, a rename, songs
added, taken out or moved, a set deleted, or back from the Trash. Each is a
line in the list of background work, and the check's notice counts the
sets with the songs (BandService._tell).
"""

import sys
import threading

from rehearsal_recorder.sending.service_client import Refused
from rehearsal_recorder.sending.service_songs import ANSWERS, KIND, _by
from rehearsal_recorder.store.library import LABEL_NAME_MAX, SetRefused

# A name the service turns down, being another set's there, is tried with
# 2, 3 … after it, at most this many times a turn.
TRIES = 10


def free_name(name, taken):
    """`name`, or “name 2”, “name 3” …: the first not in `taken` (names
    casefolded), cut to fit a set's name, as New set names a new set
    (SetsSettings.tsx freeName)."""
    if name.casefold() not in taken:
        return name
    n = 2
    while True:
        tail = f" {n}"
        candidate = name[:LABEL_NAME_MAX - len(tail)].rstrip() + tail
        if candidate.casefold() not in taken:
            return candidate
        n += 1


def _merge(entries, wanted, titles, shown):
    """The songs the band put in a set there, `wanted` (numbers, in its
    order), as the set here: a song the service leaves out of its sets (in
    its Trash, or with no number) keeps its place among the others, as the
    service keeps one in its Trash (service/worker/sets/store.ts). [(title,
    number or None)]."""
    queue, out = list(wanted), []
    for title, sid in entries:
        if sid is None or sid not in shown:
            out.append((title, sid))
        elif queue:
            x = queue.pop(0)
            out.append((titles[x], x))
    out.extend((titles[x], x) for x in queue)
    return out


class ServiceSets:
    """The sets' side of the band service's sending (band_service.py), on
    its worker thread."""

    def __init__(self, service):
        self.service = service
        self._lock = threading.Lock()
        # Held while the sending writes to a set what it read of it a moment
        # before, and by Api._sets_changed around a change from the
        # interface: one made meanwhile is neither lost nor taken as agreed.
        self.writing = threading.Lock()
        # What was owed when a push left it owed (a title that cannot be a
        # song, say): not tried again until it changes, or the next check.
        self._stuck = None

    @property
    def _api(self):
        return self.service.api

    @property
    def _lib(self):
        return self.service.api._lib

    def forget(self):
        """A key to another service: nothing of the old one is owed."""
        with self._lock:
            self._stuck = None

    # ---------- a set's songs as numbers ----------

    def _numbers(self):
        """{title casefolded: number} of every song with a number there."""
        return {r["now"]["title"].casefold(): r["sid"] for r in self._lib.service_songs()}

    @staticmethod
    def _entries(st, numbers):
        """A set's songs here (Library.sets), each as (title, its number
        there or None)."""
        return [(x["title"], numbers.get(x["title"].casefold())) for x in st["songs"]]

    @staticmethod
    def _sids(entries):
        return [sid for _, sid in entries if sid is not None]

    def _names_here(self, but=None):
        return {st["name"].casefold() for st in self._lib.sets() if st["id"] != but}

    # ---------- what РЭХА owes the service ----------

    def owed(self):
        """What РЭХА changed in its sets that the service has not had, as
        something to compare: the deletes, the sets with no number, the
        sets whose name or songs are not what was agreed, and the titles in
        sets that are no song yet. None for nothing, and for what a push
        already left owed."""
        lib = self._lib
        numbers = self._numbers()
        rows = lib.service_sets()
        agreed = {r["set_id"]: r for r in rows if r["set_id"] is not None}
        deletes = tuple(r["sid"] for r in rows if r["set_id"] is None)
        new, changed, titles = [], [], []
        for st in lib.sets():
            songs = self._sids(self._entries(st, numbers))
            r = agreed.get(st["id"])
            if r is None:
                new.append((st["id"], st["name"], tuple(songs)))
            elif st["name"] != r["name"] or songs != r["songs"]:
                changed.append((r["sid"], st["name"], tuple(songs)))
            titles.extend(x["title"] for x in st["songs"] if x["new"])
        owed = (deletes, tuple(new), tuple(changed), tuple(titles))
        if not any(owed):
            return None
        with self._lock:
            if owed == self._stuck:
                return None
        return owed

    def push(self, client):
        """РЭХА's changes to the service: songs for the titles that are
        none yet, the deletes, each set's name and songs, then numbers for
        the sets that have none (the first time, every set at once). The
        changes before the new sets: a set renamed here frees its old name
        there for one made here with it. A change turned down for a name
        another set still has there waits until the others have gone, since
        one of them may free it (names passed along with no internet), and
        only then takes a free name. Offline and Refused for the whole call
        are the caller's."""
        before = self.owed()
        self._make_songs(client)
        self._deletes(client)
        numbers = self._numbers()
        here = {st["id"]: st for st in self._lib.sets()}
        waiting = [(r, here[r["set_id"]]) for r in self._lib.service_sets() if r["set_id"] in here]
        while waiting:
            went, still = False, []
            for r, st in waiting:
                done = self._send_change(client, r, st, numbers, wait=True)
                went = went or done == "sent"
                if done == "waits":
                    still.append((r, st))
            waiting = still
            if not went:
                break
        for r, st in waiting:
            self._send_change(client, r, st, numbers, refused={st["name"].casefold()})
        self._number(client, numbers)
        if before is not None and self.owed() == before:
            with self._lock:
                self._stuck = before

    def _make_songs(self, client):
        """A title in a set that is no song yet is made a song, as New song
        makes one, and given its number there, which the set names it by."""
        made, seen = False, set()
        for st in self._lib.sets():
            for x in st["songs"]:
                key = x["title"].casefold()
                if not x["new"] or key in seen:
                    continue
                seen.add(key)
                got = self._api.add_song(x["title"])
                if got.get("ok"):
                    made = True
                else:
                    print(f"Band service: {x['title']} in {st['name']} could not be made a song: {got.get('error')}",
                          file=sys.stderr)
        if made:
            self.service.songs.push(client)

    def _deletes(self, client):
        """Sets deleted here: to the service's Trash. One the service does
        not have is done with too."""
        for r in self._lib.service_sets():
            if r["set_id"] is not None:
                continue
            try:
                client.delete_set(r["sid"])
            except Refused as e:
                if e.status not in ANSWERS:
                    raise  # the key, the version: the delete waits for the next turn
                if e.status != 404:
                    print(f"Band service: deleting {r['name']} was turned down: {e.words}", file=sys.stderr)
                    continue
            self._lib.drop_service_set(r["sid"])

    def _send_change(self, client, r, st, numbers, wait=False, refused=()):
        """The set's name and songs where РЭХА changed them, in one call:
        "sent" when the service took it. A name another set has there is
        turned down: with `wait`, the change "waits" for the push's others;
        otherwise the set here is renamed with 2 after its name (3, … if
        that is taken too), and that goes. `refused`: names (casefolded)
        the service turned down already, which go no more."""
        songs = self._sids(self._entries(st, numbers))
        fields = {}
        if st["name"] != r["name"]:
            fields["name"] = st["name"]
        if songs != r["songs"]:
            fields["songs"] = songs
        if not fields:
            return None
        refused = set(refused)
        for _ in range(TRIES):
            if "name" in fields and fields["name"].casefold() in refused:
                name = free_name(st["name"], self._names_here(st["id"]) | refused)
                if not self._rename_here(st, fields["name"], name):
                    return None
                fields["name"] = name
            try:
                client.change_set(r["sid"], **fields)
            except Refused as e:
                if e.status == 404:
                    # Gone from the service for good: it goes there again, as new.
                    print(f"Band service: {st['name']} is gone from the band service: it goes there again",
                          file=sys.stderr)
                    self._lib.drop_service_set(r["sid"])
                    return None
                if e.status == 409 and "name" in fields:
                    refused.add(fields["name"].casefold())
                    if wait:
                        return "waits"
                    continue
                if e.status not in ANSWERS:
                    raise  # the key, the version: nothing was said about this change
                # Not agreed: each side keeps its own, and the next check tries again.
                print(f"Band service: a change to {st['name']} was turned down: {e.words}", file=sys.stderr)
                return None
            self._lib.agree_service_set(r["sid"], **fields)
            if fields.get("name", st["name"]) != st["name"]:
                # Settings › Sets reads the sets again at this line (useSets).
                self._api._journal.begin(KIND, f"Renaming {r['name']} to {st['name']}").done(
                    f"Named {fields['name']}: the band service already has a set called {st['name']}")
            return "sent"
        print(f"Band service: {st['name']} found no name the band service would take", file=sys.stderr)
        return None

    def _rename_here(self, st, was, name):
        """The set here renamed `name` from `was`, the name the service
        turned down; not when the interface renamed it meanwhile, whose
        name goes at the next push. Whether it was."""
        with self.writing:
            now = next((x for x in self._lib.sets() if x["id"] == st["id"]), None)
            if now is None or now["name"] != was:
                return False
            try:
                self._lib.update_set(st["id"], name=name)
            except SetRefused as e:
                print(f"Band service: {was} could not be renamed {name}: {e}", file=sys.stderr)
                return False
        print(f"Band service: {was} is another set's name there: {name} here", file=sys.stderr)
        return True

    def _number(self, client, numbers):
        """Numbers for the sets that have none: the first time with this
        service, `link` for all of them; then one by one. A name a set has
        there is that set, which takes РЭХА's songs. A number another set
        here had already takes it from that one, which goes there as a set
        of its own next time: the two were one set there."""
        lib = self._lib
        rows = lib.service_sets()
        linked = {r["set_id"] for r in rows}
        todo = [st for st in lib.sets() if st["id"] not in linked]
        if not todo:
            return
        sent = [{"name": st["name"], "songs": self._sids(self._entries(st, numbers))} for st in todo]
        if not rows:
            ids = client.link_sets(sent)
            for st, s, sid in zip(todo, sent, ids):
                lib.link_service_set(st["id"], sid, s["name"], s["songs"])
            print(f"Band service: sets linked: {len(todo)}", file=sys.stderr)
            return
        numbered = {r["sid"]: r["set_id"] for r in rows}
        for st, s in zip(todo, sent):
            sid = client.add_set(s["name"], s["songs"])
            if numbered.get(sid) is not None:
                print(f"Band service: {s['name']} is the set another one here was there", file=sys.stderr)
            lib.link_service_set(st["id"], sid, s["name"], s["songs"])
            numbered[sid] = st["id"]

    # ---------- the check ----------

    def check(self, client):
        """РЭХА's changes go, then the service's are done here: sets deleted
        there, renamed, given other songs, and new. [(who, ("set", number))]
        for each change the band made. Offline and Refused for the whole call
        are the caller's.

        A set РЭХА changed since the two sides agreed that is in the
        service's Trash, or gone from it, stays here: its change reached the
        service after the delete, and wins. It goes there again as a set of
        its own; one in the Trash keeps the change too. What the band
        changed is written here under `writing`, against the sets as they
        are then."""
        with self._lock:
            self._stuck = None
        owed = self.owed()
        mine = {sid for sid, _, _ in owed[2]} if owed else set()
        self.push(client)
        listed = client.sets()["sets"]
        there = {s["id"]: s for s in listed}
        lib = self._lib
        done, again = [], False
        with self.writing:
            numbers = self._numbers()
            titles = {r["sid"]: r["now"]["title"] for r in lib.service_songs()}
            # The songs the band sees in its sets: those with a number here, and
            # not in the service's Trash.
            shown = set(titles) - self.service.songs.in_trash
            here = {st["id"]: st for st in lib.sets()}
            changed, renames = {}, []
            for r in lib.service_sets():
                st = here.get(r["set_id"])
                if st is None:
                    continue  # deleted here: its delete is on its way
                s = there.get(r["sid"])
                if s is None or s.get("trashed"):
                    if r["sid"] in mine or self._mine(r, st, numbers):
                        print(f"Band service: {st['name']} was deleted there and changed here: it goes there again",
                              file=sys.stderr)
                        lib.drop_service_set(r["sid"])
                        again = True
                    else:
                        self._deleted_there(r, st, s, done)
                    continue
                if self._songs_there(r, st, s, numbers, titles, shown):
                    changed[r["sid"]] = (st["id"], s)
                if st["name"] == r["name"] and s["name"] != r["name"]:
                    renames.append((r, st, s))
            for r, st, s in self._renames(renames):
                changed[r["sid"]] = (st["id"], s)
            names = {st["id"]: st["name"] for st in lib.sets()}
            for sid, (set_id, s) in changed.items():
                who = s.get("changed_by")
                self._line(names.get(set_id, s["name"]), _by(who, "changed it", "Changed"))
                done.append((who, ("set", sid)))
            self._new_sets(listed, titles, shown, done)
        if again:
            self._number(client, self._numbers())
        print(f"Band service: sets checked, changes from the band service: {len(done)}", file=sys.stderr)
        return done

    def _mine(self, r, st, numbers):
        """Whether РЭХА changed the set since the two sides agreed."""
        return st["name"] != r["name"] or self._sids(self._entries(st, numbers)) != r["songs"]

    def _deleted_there(self, r, st, s, done):
        """A set in the service's Trash, or gone from it, that РЭХА did not
        change since the two sides agreed: it goes here too. Rehearsals
        played by it keep their copy. Restore there brings it back
        at a check as a set the band made."""
        try:
            self._lib.delete_set(st["id"])
        except SetRefused:
            pass  # deleted here meanwhile
        self._lib.drop_service_set(r["sid"])
        who = s.get("trashed_by") if s else None
        self._line(st["name"], _by(who, "deleted it", "Deleted"))
        done.append((who, ("set", r["sid"])))

    def _songs_there(self, r, st, s, numbers, titles, shown):
        """The band's songs for the set, here, unless РЭХА changed them too:
        then РЭХА's went with the push, and win. Whether they changed."""
        entries = self._entries(st, numbers)
        if self._sids(entries) != r["songs"]:
            return False
        theirs = [x for x in s["songs"] if x in shown]
        if theirs == [x for x in r["songs"] if x in shown]:
            return False
        merged = _merge(entries, theirs, titles, shown)
        try:
            self._lib.update_set(st["id"], songs=[t for t, _ in merged])
        except SetRefused as e:
            print(f"Band service: the songs of {st['name']} could not be changed: {e}", file=sys.stderr)
            return False
        self._lib.agree_service_set(r["sid"], songs=[x for _, x in merged if x is not None])
        return True

    def _renames(self, renames):
        """The band's renames, done here. A name another set here has is
        taken once that set has its new name, so names swapped there are
        swapped here. When none can go, the first steps aside under a free
        name and takes its own after the others; one no set here gives up
        keeps the free name, which then goes there as РЭХА's change. The
        renames done."""
        pending, parked, done = list(renames), [], []
        while pending:
            moved = False
            for item in list(pending):
                r, st, s = item
                if self._rename(st["id"], s["name"]):
                    self._lib.agree_service_set(r["sid"], name=s["name"])
                    pending.remove(item)
                    done.append(item)
                    moved = True
            if not moved:
                item = pending.pop(0)
                r, st, s = item
                self._rename(st["id"], free_name(s["name"], self._names_here(st["id"])))
                self._lib.agree_service_set(r["sid"], name=s["name"])
                parked.append(item)
                done.append(item)
        for r, st, s in parked:
            self._rename(st["id"], s["name"])
        return done

    def _rename(self, set_id, name):
        try:
            self._lib.update_set(set_id, name=name)
            return True
        except SetRefused:
            return False

    def _new_sets(self, listed, titles, shown, done):
        """Sets made in the service, or back from its Trash: made here, in
        the service's order. A set here with the name and no number is that
        set, whose songs go next, as at the first check; a name another set
        here has gets 2 after it, which goes there next."""
        lib = self._lib
        rows = lib.service_sets()
        numbered = {r["sid"] for r in rows}
        linked = {r["set_id"] for r in rows}
        here = {st["name"].casefold(): st for st in lib.sets()}
        for s in listed:
            if s["id"] in numbered or s.get("trashed"):
                continue
            wanted = [x for x in s["songs"] if x in shown]
            same = here.get(s["name"].casefold())
            if same is not None and same["id"] not in linked:
                lib.link_service_set(same["id"], s["id"], s["name"], wanted)
                linked.add(same["id"])
                continue
            name = free_name(s["name"], set(here))
            try:
                made = lib.add_set(name, [titles[x] for x in wanted])
            except SetRefused as e:
                print(f"Band service: {s['name']} could not be made here: {e}", file=sys.stderr)
                continue
            st = next(x for x in made if x["name"].casefold() == name.casefold())
            lib.link_service_set(st["id"], s["id"], s["name"], wanted)
            here[name.casefold()] = st
            linked.add(st["id"])
            who = s.get("made_by")
            self._line(st["name"], f"New set from {who} in the band service" if who else "New set in the band service")
            done.append((who, ("set", s["id"])))

    def _line(self, title, detail):
        """A change the band made there, done, as a line in the list."""
        self._api._journal.begin(KIND, title).done(detail)
