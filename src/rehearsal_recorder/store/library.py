"""
Everything api.py reads or writes about rehearsals and takes.

Each method is one transaction, so a change is all there or not at all, and
two threads never see each other's half-made edit. What comes back is plain
dicts in the shapes the interface has always been sent — absolute paths
included — so nothing past this module knows the data moved into a database.

Folders are passed in and handed back as absolute paths. Inside, a rehearsal
is its folder relative to the recordings folder, a take's files are relative
to the rehearsal folder, and a cloud copy is relative to the cloud folder;
see models.py for why.
"""

from pathlib import Path

from sqlalchemy import Integer, cast, func, select, update
from sqlalchemy.orm import selectinload, sessionmaker

from rehearsal_recorder.store.db import MIGRATIONS, open_engine
from rehearsal_recorder.store.models import (
    CloudCopy, Label, Marker, Rehearsal, Song, Take, TakeFile, Track,
)
from rehearsal_recorder.store.names import UNNAMED_TAKE, legacy_song, split_go, take_name

# The colours a label can have, by name, in the order Settings offers them.
# What each looks like is a CSS variable per theme (--label-grey … in
# ui/src/index.css); LABEL_COLOURS in ui/src/lib/labels.ts is this same list.
LABEL_COLOURS = ("grey", "red", "amber", "green", "teal", "blue", "violet", "pink")
LABEL_NAME_MAX = 40


class LabelRefused(ValueError):
    """A change to the labels that cannot be made. The message says why, to
    the person, as it is."""


def as_marker(value):
    """
    A marker as it is kept: a spot rounded to 0.01 s, its label's id, and a
    note of at most 200 characters. The id is None when none came with it;
    the library gives such a mark the first label, as it does one whose label
    is not there (Library._labelled). The earliest versions stored a bare
    number, which still comes in through old session.json files.
    """
    if isinstance(value, dict):
        at = round(float(value.get("at", 0.0)), 2)
        label_id = value.get("label_id")
        note = str(value.get("note", "")).strip()[:200]
    else:
        at = round(float(value), 2)
        label_id, note = None, ""
    if isinstance(label_id, bool) or not isinstance(label_id, int):
        label_id = None
    return {"at": at, "label_id": label_id, "note": note}


def _relative(path, root):
    """`path` relative to `root`, with forward slashes; ValueError when it is
    not inside."""
    return Path(path).resolve().relative_to(Path(root).resolve()).as_posix()


_WITH_TAKES = (
    selectinload(Rehearsal.tracks),
    selectinload(Rehearsal.takes).selectinload(Take.song),
    selectinload(Rehearsal.takes).selectinload(Take.files),
    selectinload(Rehearsal.takes).selectinload(Take.markers),
    selectinload(Rehearsal.takes).selectinload(Take.cloud_copy),
)

# A take read as a go at its song (goes_of, goes_before), and their order:
# the newest rehearsal first, the order played within one.
_AS_GO = (
    selectinload(Take.rehearsal), selectinload(Take.song),
    selectinload(Take.files), selectinload(Take.markers),
    selectinload(Take.cloud_copy),
)
_GO_ORDER = (Rehearsal.created_at.desc(), Rehearsal.id, Take.take_number)


class Library:
    def __init__(self, recordings_dir, cloud_dir=lambda: None, migrations=MIGRATIONS):
        """
        cloud_dir: a function returning the cloud folder from the settings, or
        None. Asked on every read, because the setting changes while the app
        runs.
        """
        self.recordings_dir = Path(recordings_dir)
        self._cloud_dir = cloud_dir
        self._engine = open_engine(self.recordings_dir, migrations)
        self._session = sessionmaker(self._engine, expire_on_commit=False)

    def close(self):
        """Lets go of the file, which Windows needs before it can be moved."""
        self._engine.dispose()

    # ---------- paths ----------

    def key(self, folder):
        """How a rehearsal folder is stored. ValueError outside the
        recordings folder."""
        return _relative(folder, self.recordings_dir)

    def _folder(self, key):
        return self.recordings_dir / Path(key)

    def _find(self, db, folder, *options):
        try:
            key = self.key(folder)
        except ValueError:
            return None
        return db.scalars(
            select(Rehearsal).where(Rehearsal.folder == key).options(*options)
        ).one_or_none()

    def _find_take(self, db, folder, take_number, *options):
        rehearsal = self._find(db, folder)
        if rehearsal is None:
            return None
        return db.scalars(
            select(Take)
            .where(Take.rehearsal_id == rehearsal.id, Take.take_number == take_number)
            .options(*options)
        ).one_or_none()

    # ---------- shapes ----------
    #
    # Built in two steps. Inside the transaction, only what is in the rows is
    # copied out (_take_data, _rehearsal_data); what needs the disk or the
    # settings — whether the folder is there, where the cloud folder is — is
    # added after it has closed (_take_out, _rehearsal_out). A transaction
    # holds the database's write lock from its first statement, and a slow
    # drive or a network folder answering is_dir() must not hold up every
    # other thread's write for as long as it takes.

    @staticmethod
    def _copy_data(copy):
        if copy is None:
            return None
        return {
            "mix": copy.mix,
            "mix_format": copy.mix_format,
            "gain": copy.gain,
            "tracks": copy.tracks,
            "tracks_format": copy.tracks_format,
            "source": dict(copy.source or {}),
        }

    @staticmethod
    def _cloud_dict(copy, cloud):
        if copy is None or cloud is None:
            return {}
        out = {}
        if copy["mix"]:
            out["mix"] = str(Path(cloud) / copy["mix"])
            if copy["mix_format"] is not None:
                out["mix_format"] = copy["mix_format"]
            if copy["gain"] is not None:
                out["gain"] = copy["gain"]
        if copy["tracks"]:
            out["tracks"] = str(Path(cloud) / copy["tracks"])
            if copy["tracks_format"] is not None:
                out["tracks_format"] = copy["tracks_format"]
        out["source"] = copy["source"]
        return out

    def _take_data(self, folder, take):
        """The take as the interface gets it, but with "cloud" still the raw
        row; _take_out finishes it."""
        title = take.song.title if take.song is not None else None
        out = {
            "take_number": take.take_number,
            # Not stored: it follows from the song and the go (D3).
            "name": take_name(title, take.go, take.take_number),
            "song": title,
            "go": take.go if title is not None else None,
            "starred": take.starred,
            "duration_sec": take.duration_sec,
            "tracks": [
                {"name": f.name, "file": str(folder / Path(f.file))} for f in take.files
            ],
            "markers": [
                {"at": m.at, "label_id": m.label_id, "note": m.note} for m in take.markers
            ],
            "cloud": self._copy_data(take.cloud_copy),
            "cloud_skip": take.cloud_skip,
            "cloud_send": take.cloud_send,
        }
        if take.cloud_error:
            out["cloud_error"] = take.cloud_error
        return out

    def _take_out(self, data, cloud):
        if data is None:
            return None
        data["cloud"] = self._cloud_dict(data["cloud"], cloud)
        return data

    def _rehearsal_data(self, rehearsal):
        folder = self._folder(rehearsal.folder)
        return {
            "folder": str(folder),
            "name": rehearsal.name,
            "created_at": rehearsal.created_at,
            "samplerate": rehearsal.samplerate,
            "bit_depth": rehearsal.bit_depth,
            "tracks": [{"name": t.name, "channel": t.channel} for t in rehearsal.tracks],
            "takes": [self._take_data(folder, t) for t in rehearsal.takes],
        }

    def _rehearsal_out(self, data, cloud):
        for take in data["takes"]:
            self._take_out(take, cloud)
        data["missing"] = not Path(data["folder"]).is_dir()
        return data

    @staticmethod
    def _files(folder, tracks):
        """[{"name", "file": absolute}] → rows relative to the rehearsal."""
        return [
            TakeFile(position=i, name=t["name"], file=_relative(t["file"], folder))
            for i, t in enumerate(tracks)
        ]

    @staticmethod
    def _labelled(db, markers):
        """Markers as kept (as_marker), each on a label there is. One that came
        with none, or whose label is gone, gets the first: a mark always has
        a label (spec D4)."""
        ids = db.scalars(select(Label.id).order_by(Label.position, Label.id)).all()
        known = set(ids)
        kept = [as_marker(m) for m in markers]
        for m in kept:
            if m["label_id"] not in known:
                m["label_id"] = ids[0]
        return kept

    # ---------- songs ----------
    #
    # A take is a go at a song or at nothing, and its name follows from the
    # two (names.take_name). What was typed or clicked becomes a song and a
    # go here, in the transaction that writes the take, by _resolve. Titles
    # are unique case-blind, which SQLite cannot enforce for Cyrillic (its
    # lower() folds only ASCII), so it is enforced here: a title is looked up
    # casefolded before a song is made. A song is never deleted with its
    # takes: one with none keeps its title and its count of goes given
    # (Song.last_go), so a number is never given twice.

    @staticmethod
    def _songs_by_key(db):
        return {s.title.casefold(): s for s in db.scalars(select(Song))}

    @staticmethod
    def _has_other_takes(db, song_id, take_id):
        return db.scalars(
            select(Take.id).where(Take.song_id == song_id, Take.id != take_id).limit(1)
        ).first() is not None

    def _resolve(self, db, rehearsal_id, name, take_number):
        """
        What take `take_number` of a rehearsal is a go at when the name field
        holds `name`: (song, title, go). `song` is the Song row when there is
        one already; `title` is None for no song, and a new song's title
        otherwise. In order:

        1. Nothing, or "Take N", is no song.
        2. A song whose title is the whole text, compared casefolded, is that
           song.
        3. A song whose title is the text less a trailing number is that
           song: a number typed out of habit ("Polyn 3") is dropped.
        4. Anything else is a new song with exactly that title — "Opus 5" is
           a title of its own unless a song called "Opus" exists.

        The go is the app's: one past the song's count of goes given
        (Song.last_go), so a number is never given twice, even after its take
        is deleted. A take already a go at the song keeps its go ("Polyn 2"
        renamed to Polyn stays Polyn 2); and when it is the song's only take,
        a name differing from the title only in case respells the song.
        """
        name = (name or "").strip()
        if not name or UNNAMED_TAKE.match(name):
            return None, None, None
        current = None
        if rehearsal_id is not None:
            current = db.scalars(select(Take).where(
                Take.rehearsal_id == rehearsal_id, Take.take_number == take_number
            )).one_or_none()
        songs = self._songs_by_key(db)
        song = songs.get(name.casefold())
        if song is None:
            base, number = split_go(name)
            if number is not None:
                song = songs.get(base.casefold())
        if song is None:
            return None, name, 1
        title = song.title
        if current is not None and current.song_id == song.id:
            if (name != title and name.casefold() == title.casefold()
                    and not self._has_other_takes(db, song.id, current.id)):
                title = name
            return song, title, current.go
        return song, title, (song.last_go or 0) + 1

    @staticmethod
    def _song_row(db, song, title, go):
        """The Song a take resolved to (_resolve): made if it is new,
        respelled if _resolve said so, and its count moved on to `go`. None
        for no song."""
        if title is None:
            return None
        if song is None:
            song = Song(title=title, last_go=0)
            db.add(song)
        elif song.title != title:
            song.title = title
        song.last_go = max(song.last_go or 0, go)
        return song

    def resolve_name(self, folder, name, take_number):
        """
        What take `take_number` of the rehearsal in `folder` would be if the
        name field held `name`, by the rule add_take and update_take follow
        (_resolve), without writing anything: {"song": title or None, "go":
        int or None, "name": the plain-text name}. Used to name a take's
        folder before the take is written, and the next take before it is
        recorded.
        """
        take_number = int(take_number)
        with self._session() as db:
            rehearsal = self._find(db, folder)
            _, title, go = self._resolve(
                db, None if rehearsal is None else rehearsal.id, name, take_number)
        return {"song": title, "go": go, "name": take_name(title, go, take_number)}

    def song_id(self, title):
        """The id of the song titled `title`, compared casefolded as titles
        are, or None when no song has it."""
        with self._session() as db:
            song = self._songs_by_key(db).get((title or "").casefold())
            return None if song is None else song.id

    def next_goes(self):
        """{title: the go the next take of that song would be}, for every
        song: one past its count of goes given, as _resolve counts it. One
        query, for the songs offered under a take's name."""
        with self._session() as db:
            rows = db.execute(select(Song.title, Song.last_go)).all()
        return {title: (last or 0) + 1 for title, last in rows}

    def songs(self):
        """
        Every song with a go, for History's Songs view, and the takes with no
        song as one more row: {"songs": [{"id", "title", "goes",
        "rehearsals", "first_played", "last_played", "starred"}],
        "not_named": {"takes", "rehearsals", "last_played"} or None}.

        One query, grouped by song, and no folder looked at: a rehearsal on a
        drive that is not plugged in is counted like any other. A song whose
        every go was deleted has no takes to group, so it is not listed.
        """
        with self._session() as db:
            rows = db.execute(
                select(
                    Take.song_id,
                    Song.title,
                    func.count(Take.id),
                    func.count(Take.rehearsal_id.distinct()),
                    func.min(Rehearsal.created_at),
                    func.max(Rehearsal.created_at),
                    func.sum(cast(Take.starred, Integer)),
                )
                .join(Rehearsal, Take.rehearsal_id == Rehearsal.id)
                .outerjoin(Song, Take.song_id == Song.id)
                .group_by(Take.song_id)
            ).all()
        songs, not_named = [], None
        for song_id, title, goes, rehearsals, first, last, starred in rows:
            if song_id is None:
                not_named = {"takes": goes, "rehearsals": rehearsals, "last_played": last}
                continue
            songs.append({"id": song_id, "title": title, "goes": goes,
                          "rehearsals": rehearsals, "first_played": first,
                          "last_played": last, "starred": starred or 0})
        songs.sort(key=lambda s: (s["title"].casefold(), s["id"]))
        return {"songs": songs, "not_named": not_named}

    def goes_of(self, song_id):
        """
        A song's goes, from every rehearsal, for its page: {"id", "title",
        "goes": [{"folder", "rehearsal", "created_at", "missing", "take"}]},
        the newest rehearsal first and the order played within one. None for
        an id no song has. `song_id` None is the takes with no song.

        "missing" is the rehearsal's folder not being on disk; the go is
        still listed, and History greys it out.
        """
        with self._session() as db:
            song = None if song_id is None else db.get(Song, song_id)
            if song_id is not None and song is None:
                return None
            title = None if song is None else song.title
            goes = self._goes(db, Take.song_id.is_(None) if song_id is None
                              else Take.song_id == song_id)
        cloud = self._cloud_dir()
        there = {}
        for go in goes:
            self._take_out(go["take"], cloud)
            if go["folder"] not in there:
                there[go["folder"]] = Path(go["folder"]).is_dir()
            go["missing"] = not there[go["folder"]]
        return {"id": song_id, "title": title, "goes": goes}

    def marks_of(self, label_id):
        """
        Every mark with the label, from every rehearsal, for History's Marks
        view: [{"folder", "rehearsal", "created_at", "missing", "take_number",
        "name", "song", "duration_sec", "at", "note"}], the newest rehearsal
        first, then the order played, then the moment. None for an id no
        label has.

        Only what a row shows, in one query: a label can have thousands of
        marks, and reading each one's whole take (its files, its other marks)
        took ten times as long. The take is read when it is played or opened.
        "missing" is as goes_of has it, each folder looked at once.
        """
        with self._session() as db:
            if db.get(Label, label_id) is None:
                return None
            rows = db.execute(
                select(Rehearsal.folder, Rehearsal.name, Rehearsal.created_at,
                       Take.take_number, Song.title, Take.go, Take.duration_sec,
                       Marker.at, Marker.note)
                .join(Take, Marker.take_id == Take.id)
                .join(Rehearsal, Take.rehearsal_id == Rehearsal.id)
                .outerjoin(Song, Take.song_id == Song.id)
                .where(Marker.label_id == label_id)
                .order_by(*_GO_ORDER, Marker.at, Marker.id)
            ).all()
        there, out = {}, []
        for key, rehearsal, created_at, number, title, go, duration, at, note in rows:
            if key not in there:
                folder = self._folder(key)
                there[key] = (str(folder), not folder.is_dir())
            folder, missing = there[key]
            out.append({"folder": folder, "rehearsal": rehearsal, "created_at": created_at,
                        "missing": missing, "take_number": number,
                        "name": take_name(title, go, number), "song": title,
                        "duration_sec": duration, "at": at, "note": note})
        return out

    def goes_before(self, song_id, folder):
        """
        goes_of for the rehearsal screen's card, which asks on every refresh
        while the rehearsal in `folder` is on: only goes from rehearsals on
        disk other than that one, and of those only the ones the card picks
        from, so none "missing". They are the last go of each of the three
        newest such rehearsals, and the later ★ go of the newest such
        rehearsal with one. None for an id no song has.
        """
        live = Path(folder)
        with self._session() as db:
            song = db.get(Song, song_id)
            if song is None:
                return None
            title = song.title
            rows = db.execute(
                select(Take.id, Take.starred, Rehearsal.folder)
                .join(Rehearsal, Take.rehearsal_id == Rehearsal.id)
                .where(Take.song_id == song_id)
                .order_by(*_GO_ORDER)
            ).all()
            last, starred, there = {}, None, {}
            for take_id, star, key in rows:
                if key not in there:
                    if len(last) == 3 and starred is not None:
                        break
                    path = self._folder(key)
                    there[key] = path != live and path.is_dir()
                if not there[key]:
                    continue
                if key in last or len(last) < 3:
                    last[key] = take_id
                if star and (starred is None or starred[0] == key):
                    starred = (key, take_id)
            wanted = set(last.values()) | ({starred[1]} if starred else set())
            goes = self._goes(db, Take.id.in_(wanted))
        cloud = self._cloud_dir()
        for go in goes:
            self._take_out(go["take"], cloud)
            go["missing"] = False
        return {"id": song_id, "title": title, "goes": goes}

    def _goes(self, db, which):
        """The takes `which` picks, as goes in goes_of's shape less "missing"."""
        takes = db.scalars(
            select(Take)
            .join(Rehearsal, Take.rehearsal_id == Rehearsal.id)
            .where(which)
            .options(*_AS_GO)
            .order_by(*_GO_ORDER)
        ).all()
        goes = []
        for take in takes:
            folder = self._folder(take.rehearsal.folder)
            goes.append({"folder": str(folder), "rehearsal": take.rehearsal.name,
                         "created_at": take.rehearsal.created_at,
                         "take": self._take_data(folder, take)})
        return goes

    # ---------- rehearsals ----------

    def rehearsals(self):
        """Every rehearsal, newest first, each with its takes."""
        with self._session() as db:
            rows = db.scalars(
                select(Rehearsal).options(*_WITH_TAKES).order_by(Rehearsal.created_at.desc())
            ).all()
            data = [self._rehearsal_data(r) for r in rows]
        cloud = self._cloud_dir()
        return [self._rehearsal_out(d, cloud) for d in data]

    def rehearsal(self, folder):
        with self._session() as db:
            row = self._find(db, folder, *_WITH_TAKES)
            data = None if row is None else self._rehearsal_data(row)
        return None if data is None else self._rehearsal_out(data, self._cloud_dir())

    def has(self, folder):
        with self._session() as db:
            return self._find(db, folder) is not None

    def create_rehearsal(self, folder, name, created_at, samplerate, bit_depth, tracks):
        with self._session.begin() as db:
            db.add(Rehearsal(
                folder=self.key(folder),
                name=name,
                created_at=created_at,
                samplerate=int(samplerate),
                bit_depth=int(bit_depth),
                tracks=[
                    Track(position=i, name=t["name"], channel=int(t["channel"]))
                    for i, t in enumerate(tracks)
                ],
            ))

    def import_rehearsal(self, folder, *, name, created_at, samplerate, bit_depth,
                         tracks, takes, cloud, cloud_errors, cloud_dir):
        """
        A whole rehearsal at once, for the importer: all of it goes in or none
        of it does. takes as for add_take, their names read by the old rule
        (names.legacy_song); cloud: {take_number: shared} as for
        set_cloud_copy, relative to cloud_dir; cloud_errors: {take_number:
        message}.
        """
        folder = Path(folder)
        with self._session.begin() as db:
            songs = self._songs_by_key(db)
            counted = {}

            def go_at(name):
                # Old names by the old rule, as migration 0002 read the
                # database's own. A song already in the library keeps its
                # title, and its goes go on from its count, however old
                # this rehearsal is: a number, once given, is kept. A new
                # song is spelled as this rehearsal first spells it.
                title = legacy_song(name)
                if title is None:
                    return None, None
                key = title.casefold()
                if key not in songs:
                    songs[key] = Song(title=title, last_go=0)
                if key not in counted:
                    counted[key] = songs[key].last_go or 0
                counted[key] += 1
                songs[key].last_go = counted[key]
                return songs[key], counted[key]

            placed = {int(t["take_number"]): go_at(t.get("name"))
                      for t in sorted(takes, key=lambda t: int(t["take_number"]))}
            db.add(Rehearsal(
                folder=self.key(folder),
                name=name,
                created_at=created_at,
                samplerate=int(samplerate),
                bit_depth=int(bit_depth),
                tracks=[
                    Track(position=i, name=t["name"], channel=int(t["channel"]))
                    for i, t in enumerate(tracks)
                ],
                takes=[
                    Take(
                        take_number=int(t["take_number"]),
                        song=placed[int(t["take_number"])][0],
                        go=placed[int(t["take_number"])][1],
                        duration_sec=float(t.get("duration_sec") or 0.0),
                        cloud_skip=bool(t.get("cloud_skip")),
                        cloud_send=bool(t.get("cloud_send")),
                        cloud_error=cloud_errors.get(int(t["take_number"])),
                        files=self._files(folder, t.get("tracks", [])),
                        markers=[Marker(**m) for m in self._labelled(db, t.get("markers", []))],
                        cloud_copy=self._cloud_row(cloud.get(int(t["take_number"])), cloud_dir),
                    )
                    for t in takes
                ],
            ))

    def move_rehearsal(self, folder, new_folder, name=None):
        """The folder was renamed on disk (or found again elsewhere): point the
        rehearsal at it. Its takes' files are relative to it, so they follow."""
        with self._session.begin() as db:
            row = self._find(db, folder)
            if row is None:
                return False
            row.folder = self.key(new_folder)
            if name is not None:
                row.name = name
            return True

    def forget_rehearsal(self, folder):
        """Drops the rehearsal and everything under it from the database. The
        folder on disk is not touched."""
        with self._session.begin() as db:
            row = self._find(db, folder)
            if row is None:
                return False
            db.delete(row)
            return True

    # ---------- takes ----------

    def take(self, folder, take_number):
        with self._session() as db:
            row = self._find_take(
                db, folder, take_number,
                selectinload(Take.song), selectinload(Take.files),
                selectinload(Take.markers), selectinload(Take.cloud_copy),
            )
            data = None if row is None else self._take_data(Path(folder), row)
        return self._take_out(data, self._cloud_dir())

    def add_take(self, folder, take):
        """
        take: {"take_number", "name" (what the name field held — see _resolve), "duration_sec", "tracks": [{"name",
        "file": absolute}], "markers"?, "cloud_skip"?, "cloud_send"?}.
        Returns the take as it is now kept, or None without the rehearsal.
        """
        folder = Path(folder)
        with self._session.begin() as db:
            rehearsal = self._find(db, folder)
            if rehearsal is None:
                return None
            number = int(take["take_number"])
            song, title, go = self._resolve(db, rehearsal.id, take.get("name"), number)
            row = Take(
                rehearsal_id=rehearsal.id,
                take_number=number,
                song=self._song_row(db, song, title, go),
                go=go,
                duration_sec=float(take.get("duration_sec") or 0.0),
                cloud_skip=bool(take.get("cloud_skip")),
                cloud_send=bool(take.get("cloud_send")),
                files=self._files(folder, take.get("tracks", [])),
                markers=[Marker(**m) for m in self._labelled(db, take.get("markers", []))],
            )
            db.add(row)
            db.flush()
            db.refresh(row)
            data = self._take_data(folder, row)
        return self._take_out(data, self._cloud_dir())

    def update_take(self, folder, take_number, *, name=None, duration_sec=None,
                    tracks=None, markers=None):
        """Changes what is given and leaves the rest. name: what the name field
        held, made a song and a go as add_take makes it (_resolve), so the name
        the take ends up with can differ. tracks: the take's files at their new
        absolute paths. Returns the take, or None."""
        folder = Path(folder)
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number)
            if row is None:
                return None
            if name is not None:
                song, title, go = self._resolve(db, row.rehearsal_id, name, take_number)
                row.song = self._song_row(db, song, title, go)
                row.go = go
            if duration_sec is not None:
                row.duration_sec = float(duration_sec)
            if tracks is not None:
                row.files = self._files(folder, tracks)
            if markers is not None:
                row.markers = [Marker(**m) for m in self._labelled(db, markers)]
            db.flush()
            db.refresh(row)
            data = self._take_data(folder, row)
        return self._take_out(data, self._cloud_dir())

    def edit_markers(self, folder, take_number, fn):
        """fn(markers) -> markers, read and written in one transaction.
        Returns the markers as kept, or None without the take."""
        folder = Path(folder)
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number, selectinload(Take.markers))
            if row is None:
                return None
            current = [{"at": m.at, "label_id": m.label_id, "note": m.note}
                       for m in row.markers]
            kept = sorted(self._labelled(db, fn(current)), key=lambda m: m["at"])
            row.markers = [Marker(**m) for m in kept]
            return kept

    def set_starred(self, folder, take_number, starred):
        """Puts ★ on the take, or takes it off. Returns the take, or None
        without it. Nothing else about the take changes."""
        folder = Path(folder)
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number)
            if row is None:
                return None
            row.starred = bool(starred)
            db.flush()
            db.refresh(row)
            data = self._take_data(folder, row)
        return self._take_out(data, self._cloud_dir())

    def delete_take(self, folder, take_number):
        """Returns how many takes the rehearsal has left, or None."""
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number)
            if row is None:
                return None
            rehearsal_id = row.rehearsal_id
            db.delete(row)
            db.flush()
            return len(db.scalars(select(Take.id).where(Take.rehearsal_id == rehearsal_id)).all())

    # ---------- the cloud ----------

    def set_cloud_copy(self, folder, take_number, shared, cloud_dir):
        """
        What of a take is now in the cloud folder, from share_take — its paths
        absolute, inside `cloud_dir`, the folder they were written into. A copy
        that succeeded settles whatever went wrong last time, so the error is
        cleared. shared=None: nothing of it is there any more.

        Only the take's cloud fields are written, so a rename that landed while
        the copy was being made is kept.
        """
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number, selectinload(Take.cloud_copy))
            if row is None:
                return False
            row.cloud_error = None
            row.cloud_copy = self._cloud_row(shared, cloud_dir)
            return True

    @staticmethod
    def _cloud_row(shared, cloud_dir):
        if not shared:
            return None
        if not shared.get("mix") and not shared.get("tracks"):
            return None
        return CloudCopy(
            mix=_relative(shared["mix"], cloud_dir) if shared.get("mix") else None,
            mix_format=shared.get("mix_format"),
            gain=shared.get("gain"),
            tracks=_relative(shared["tracks"], cloud_dir) if shared.get("tracks") else None,
            tracks_format=shared.get("tracks_format"),
            source=dict(shared.get("source") or {}),
        )

    def set_cloud_error(self, folder, take_number, message):
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number)
            if row is None:
                return False
            row.cloud_error = message
            return True

    # ---------- labels ----------
    #
    # What a mark can be called: a name and a colour each, in an order the
    # band sets in Settings. Places run from 0 with no gaps; the first label
    # is what a mark gets when it has none. Each change is one transaction
    # and returns every label as labels() gives them.

    def labels(self):
        """[{"id", "name", "colour", "marks", "rehearsals", "last_marked"}] in
        their order: how many marks have the label, in every rehearsal; in how
        many rehearsals; and the newest of those rehearsals' created_at, None
        with no marks."""
        with self._session() as db:
            rows = db.execute(
                select(Label, func.count(Marker.id),
                       func.count(Take.rehearsal_id.distinct()),
                       func.max(Rehearsal.created_at))
                .outerjoin(Marker, Marker.label_id == Label.id)
                .outerjoin(Take, Marker.take_id == Take.id)
                .outerjoin(Rehearsal, Take.rehearsal_id == Rehearsal.id)
                .group_by(Label.id)
                .order_by(Label.position, Label.id)
            ).all()
            return [{"id": label.id, "name": label.name, "colour": label.colour,
                     "marks": marks, "rehearsals": rehearsals, "last_marked": last}
                    for label, marks, rehearsals, last in rows]

    @staticmethod
    def _ordered_labels(db):
        return list(db.scalars(select(Label).order_by(Label.position, Label.id)))

    @staticmethod
    def _label_in(labels, label_id):
        label = next((lb for lb in labels if lb.id == label_id), None)
        if label is None:
            raise LabelRefused("Label not found")
        return label

    @staticmethod
    def _label_name(labels, name, label_id=None):
        """`name` as a label is called: trimmed and cut at LABEL_NAME_MAX.
        Refused empty, or when another label has it, compared by casefold as
        song titles are — SQLite's lower() folds only ASCII."""
        name = str(name or "").strip()[:LABEL_NAME_MAX].strip()
        if not name:
            raise LabelRefused("A label needs a name")
        for other in labels:
            if other.id != label_id and other.name.casefold() == name.casefold():
                raise LabelRefused(f"There is already a label called {other.name}")
        return name

    @staticmethod
    def _label_colour(colour):
        if colour not in LABEL_COLOURS:
            raise LabelRefused("Pick a colour from the palette")
        return colour

    @staticmethod
    def _renumber(labels):
        for position, label in enumerate(labels):
            label.position = position

    def add_label(self, name, colour):
        """A new label at the end of the list."""
        with self._session.begin() as db:
            labels = self._ordered_labels(db)
            db.add(Label(name=self._label_name(labels, name),
                         colour=self._label_colour(colour),
                         position=len(labels)))
        return self.labels()

    def rename_label(self, label_id, name):
        with self._session.begin() as db:
            labels = self._ordered_labels(db)
            label = self._label_in(labels, label_id)
            label.name = self._label_name(labels, name, label.id)
        return self.labels()

    def recolour_label(self, label_id, colour):
        with self._session.begin() as db:
            label = self._label_in(self._ordered_labels(db), label_id)
            label.colour = self._label_colour(colour)
        return self.labels()

    def move_label(self, label_id, position):
        """Puts the label at `position` in the list, the rest closing up
        around it; a place past the end is the end."""
        with self._session.begin() as db:
            labels = self._ordered_labels(db)
            label = self._label_in(labels, label_id)
            labels.remove(label)
            labels.insert(max(0, min(int(position), len(labels))), label)
            self._renumber(labels)
        return self.labels()

    def delete_label(self, label_id, marks_to=None):
        """
        Deletes the label. Its marks, if it has any, get label `marks_to`
        first, in the same transaction, so a failure part way moves none of
        them. Refused for the last label, and for one in use with no other
        label named for its marks.
        """
        with self._session.begin() as db:
            labels = self._ordered_labels(db)
            label = self._label_in(labels, label_id)
            if len(labels) == 1:
                raise LabelRefused("The last label cannot be deleted: every mark needs one")
            used = db.scalar(select(func.count(Marker.id)).where(Marker.label_id == label.id))
            if used:
                if marks_to is None:
                    raise LabelRefused(f"Say which label the marks of {label.name} get")
                target = next((lb for lb in labels
                               if lb.id == marks_to and lb.id != label.id), None)
                if target is None:
                    raise LabelRefused("Their marks need another label to go to")
                db.execute(update(Marker).where(Marker.label_id == label.id)
                           .values(label_id=target.id))
            labels.remove(label)
            db.delete(label)
            self._renumber(labels)
        return self.labels()
