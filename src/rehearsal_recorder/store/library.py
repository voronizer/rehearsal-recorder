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
from sqlalchemy.orm import object_session, selectinload, sessionmaker

from rehearsal_recorder.midi import rules
from rehearsal_recorder.store.db import MIGRATIONS, open_engine
from rehearsal_recorder.store.models import (
    CloudCopy, Label, Marker, Rehearsal, Song, SongName, SongSet, Take, TakeFile, Track,
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


class SetRefused(ValueError):
    """A change to the sets that cannot be made. The message says why, to the
    person, as it is."""


class SongRefused(ValueError):
    """A rename or a merge of songs that cannot be made. The message says
    why, to the person, as it is. `into` is {"id", "title"} of the song the
    title already belongs to, when that is why: merging into it is what the
    person can do instead."""

    def __init__(self, message, into=None):
        super().__init__(message)
        self.into = into


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
    selectinload(Take.rehearsal).selectinload(Rehearsal.tracks), selectinload(Take.song),
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
        row; _take_out finishes it.

        "tracks" is its audio files only, in the order they were kept, and
        "notes" its .mid files, each with its track's port and the audio lane
        it follows in the player (rules.lane_after, over the rehearsal's
        tracks in band order and the lanes this take has). "notes_missing" is
        the tracks that record notes and have no .mid in this take: a port
        that was not there when it was recorded."""
        title = take.song.title if take.song is not None else None
        band = [{"name": t.name, "mode": t.mode, "midi_port": t.midi_port}
                for t in take.rehearsal.tracks]
        ports = {t["name"]: t["midi_port"] for t in band}
        audio = [f for f in take.files if f.kind != "midi"]
        notes = [f for f in take.files if f.kind == "midi"]
        heard = {f.name for f in audio}
        written = {f.name for f in notes}
        out = {
            "take_number": take.take_number,
            # Not stored: it follows from the song and the go (D3).
            "name": take_name(title, take.go, take.take_number),
            "song": title,
            "go": take.go if title is not None else None,
            "starred": take.starred,
            "duration_sec": take.duration_sec,
            "tracks": [{"name": f.name, "file": str(folder / Path(f.file))} for f in audio],
            "notes": [
                {"name": f.name, "file": str(folder / Path(f.file)),
                 "port": ports.get(f.name),
                 "after": rules.lane_after(band, heard, f.name)}
                for f in notes
            ],
            "notes_missing": [
                {"name": t["name"], "port": t["midi_port"],
                 "after": rules.lane_after(band, heard, t["name"])}
                for t in band
                if rules.records_notes(t) and t["name"] not in written
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

    def _rehearsal_data(self, rehearsal, titles=None):
        """`titles` is _titles_of(db), for the set's songs; made here when
        not given, which one rehearsal can afford and a list of them not."""
        folder = self._folder(rehearsal.folder)
        if rehearsal.set_name is None:
            played_by = None
        else:
            if titles is None:
                titles = self._titles_of(object_session(rehearsal))
            played_by = {"name": rehearsal.set_name,
                         "songs": self._songs_of_set(titles, rehearsal.set_songs)}
        return {
            "set": played_by,
            "folder": str(folder),
            "name": rehearsal.name,
            "created_at": rehearsal.created_at,
            "samplerate": rehearsal.samplerate,
            "bit_depth": rehearsal.bit_depth,
            "tracks": [
                {"name": t.name, "channel": t.channel, "mode": t.mode, "midi_port": t.midi_port}
                for t in rehearsal.tracks
            ],
            "takes": [self._take_data(folder, t) for t in rehearsal.takes],
        }

    def _rehearsal_out(self, data, cloud):
        for take in data["takes"]:
            self._take_out(take, cloud)
        data["missing"] = not Path(data["folder"]).is_dir()
        return data

    @staticmethod
    def _files(folder, files, kind, start=0):
        """[{"name", "file": absolute}] → rows of that kind ("audio" or
        "midi") relative to the rehearsal, numbered from `start`."""
        return [
            TakeFile(position=start + i, name=f["name"], kind=kind,
                     file=_relative(f["file"], folder))
            for i, f in enumerate(files)
        ]

    @classmethod
    def _take_files(cls, folder, take):
        """A new take's rows: its "tracks" as audio, then its "notes" as MIDI,
        one sequence of positions."""
        audio = cls._files(folder, take.get("tracks") or [], "audio")
        return audio + cls._files(folder, take.get("notes") or [], "midi", start=len(audio))

    @staticmethod
    def _track_rows(tracks):
        """The band as rows: each with its mode and the name of its port (a
        track that records only audio has none), and the input it was on —
        none for a track that records only MIDI."""
        rows = []
        for i, t in enumerate(tracks):
            mode = rules.mode_of(t)
            port = rules.port_ref(t.get("midi_port"))
            channel = t.get("channel")
            rows.append(Track(
                position=i,
                name=t["name"],
                channel=None if mode == "midi" or channel is None else int(channel),
                mode=mode,
                midi_port=port["name"] if port and mode != "audio" else None,
            ))
        return rows

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
    #
    # A title a song leaves, renamed or merged into another, stays a way to
    # name it: an old name (models.SongName). Old names are unique
    # case-blind too, and never a song's title as well, so a name leads to
    # one song at most.

    @staticmethod
    def _songs_by_key(db):
        return {s.title.casefold(): s for s in db.scalars(select(Song))}

    @staticmethod
    def _names_by_key(db):
        """Every old name, by its casefold: {key: SongName}."""
        return {n.name.casefold(): n for n in db.scalars(select(SongName))}

    @staticmethod
    def _also(db):
        """{song_id: its old names}, each list in case-blind order."""
        out = {}
        for song_id, name in db.execute(select(SongName.song_id, SongName.name)):
            out.setdefault(song_id, []).append(name)
        for names in out.values():
            names.sort(key=str.casefold)
        return out

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
           song; failing that, a song with the whole text as an old name.
        3. The same for the text less a trailing number: a number typed out
           of habit ("Polyn 3") is dropped.
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
        olds = self._names_by_key(db)

        def known(text):
            key = text.casefold()
            if key in songs:
                return songs[key]
            return db.get(Song, olds[key].song_id) if key in olds else None

        song = known(name)
        if song is None:
            base, number = split_go(name)
            if number is not None:
                song = known(base)
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

    def song_names(self):
        """{title: its old names} for every song that has any, each list in
        case-blind order: for the songs offered under a take's name."""
        with self._session() as db:
            also = self._also(db)
            titles = dict(db.execute(select(Song.id, Song.title)).all())
        return {titles[song_id]: names for song_id, names in also.items()}

    def _played(self, db, song_id):
        """A song's takes with their rehearsal's folder, as stored: the
        oldest rehearsal first, the order played within one."""
        return db.execute(
            select(Take, Rehearsal.folder)
            .join(Rehearsal, Take.rehearsal_id == Rehearsal.id)
            .where(Take.song_id == song_id)
            .order_by(Rehearsal.created_at, Rehearsal.id, Take.take_number)
        ).all()

    def _named(self, rows, title, goes):
        """(folder, take_number, name) of each of `rows` (_played), named as
        `title` at the go `goes` gives it: what the files are to follow."""
        return [(str(self._folder(key)), take.take_number,
                 take_name(title, goes(i, take), take.take_number))
                for i, (take, key) in enumerate(rows)]

    @staticmethod
    def _taken(db, title, song_id):
        """Refused when `title` is another song's, by its title or by an old
        name, naming that song (SongRefused.into)."""
        key = title.casefold()
        other = Library._songs_by_key(db).get(key)
        if other is not None and other.id != song_id:
            raise SongRefused(f"There is already a song called {other.title}",
                              {"id": other.id, "title": other.title})
        old = Library._names_by_key(db).get(key)
        if old is not None and old.song_id != song_id:
            owner = db.get(Song, old.song_id)
            raise SongRefused(f"{title} is {owner.title} now",
                              {"id": owner.id, "title": owner.title})

    def rename_song(self, song_id, title):
        """
        Gives a song another title (rename-and-merge-songs spec D1, R2-R5):
        one row changes, and the names of its takes follow from it. The title
        it leaves is remembered as an old name (D6), unless only its case
        changed (R4); an old name of its own taken back as its title is no
        longer one (D7). Refused (SongRefused) for an empty title, for "Take
        N", and for another song's title or old name, which is a merge
        (merge_songs) into the song it names.

        Returns {"from", "title", "takes"}: the takes whose names changed,
        as (folder, take_number, name), the oldest first, for their files to
        follow. None changed when the title is the one it has.
        """
        title = str(title or "").strip()
        with self._session.begin() as db:
            song = db.get(Song, song_id)
            if song is None:
                raise SongRefused("Song not found")
            if not title:
                raise SongRefused("A song needs a title")
            if UNNAMED_TAKE.match(title):
                raise SongRefused(f"{title} is what a take with no song is called")
            self._taken(db, title, song.id)
            old = song.title
            if title == old:
                return {"from": old, "title": title, "takes": []}
            if title.casefold() != old.casefold():
                for name in db.scalars(select(SongName).where(SongName.song_id == song.id)):
                    if name.name.casefold() == title.casefold():
                        db.delete(name)
                db.add(SongName(song_id=song.id, name=old))
            song.title = title
            takes = self._named(self._played(db, song.id), title, lambda _, t: t.go)
        return {"from": old, "title": title, "takes": takes}

    def merge_songs(self, from_id, into_id, dry_run=False):
        """
        Points every take of song `from_id` at song `into_id` (D1, D3),
        numbered on from the goes `into` has given (Song.last_go), the oldest
        rehearsal first and in the order played within one: no name is given
        twice, and the target's own goes keep theirs. Stars stay on their
        takes (D4). The merged song's title and its old names become the
        target's old names (D7), and its row goes. One transaction.

        Returns {"from", "into", "goes", "rehearsals", "first", "last",
        "takes"}: how many goes from how many rehearsals, the first and last
        go they get (None with none), and the takes as rename_song gives
        them. dry_run: the same answer with nothing changed, for the question
        asked first (R3, R6).
        """
        with self._session.begin() as db:
            source, target = db.get(Song, from_id), db.get(Song, into_id)
            if source is None or target is None:
                raise SongRefused("Song not found")
            if source.id == target.id:
                raise SongRefused("A song cannot be merged into itself")
            rows = self._played(db, source.id)
            first = (target.last_go or 0) + 1
            count = len(rows)
            answer = {
                "from": source.title, "into": target.title, "goes": count,
                "rehearsals": len({key for _, key in rows}),
                "first": first if count else None,
                "last": first + count - 1 if count else None,
                "takes": self._named(rows, target.title, lambda i, _: first + i),
            }
            if dry_run:
                return answer
            for i, (take, _) in enumerate(rows):
                take.song = target
                take.go = first + i
            if count:
                target.last_go = first + count - 1
            for name in db.scalars(select(SongName).where(SongName.song_id == source.id)):
                name.song_id = target.id
            db.add(SongName(song_id=target.id, name=source.title))
            # Everything off the song before it goes, so nothing of it is
            # left for the database's ON DELETE to touch.
            db.flush()
            db.delete(source)
        return answer

    def forget_song_name(self, name):
        """Forgets an old name (D8): typed again, it is a new song. False when
        no song had it."""
        key = str(name or "").strip().casefold()
        with self._session.begin() as db:
            found = self._names_by_key(db).get(key)
            if found is None:
                return False
            db.delete(found)
            return True

    def songs(self):
        """
        Every song with a go, for History's Songs view, and the takes with no
        song as one more row: {"songs": [{"id", "title", "goes",
        "rehearsals", "first_played", "last_played", "starred", "also"}],
        "not_named": {"takes", "rehearsals", "last_played"} or None}.

        Two queries, the goes grouped by song and the songs' old names, and no
        folder looked at: a rehearsal on a drive that is not plugged in is
        counted like any other. A song whose every go was deleted has no
        takes to group, so it is not listed.
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
            also = self._also(db)
        songs, not_named = [], None
        for song_id, title, goes, rehearsals, first, last, starred in rows:
            if song_id is None:
                not_named = {"takes": goes, "rehearsals": rehearsals, "last_played": last}
                continue
            songs.append({"id": song_id, "title": title, "goes": goes,
                          "rehearsals": rehearsals, "first_played": first,
                          "last_played": last, "starred": starred or 0,
                          "also": also.get(song_id, [])})
        songs.sort(key=lambda s: (s["title"].casefold(), s["id"]))
        return {"songs": songs, "not_named": not_named}

    def goes_of(self, song_id):
        """
        A song's goes, from every rehearsal, for its page: {"id", "title",
        "also", "goes": [{"folder", "rehearsal", "created_at", "missing",
        "take"}]}, "also" being its old names,
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
            also = [] if song is None else self._also(db).get(song.id, [])
            goes = self._goes(db, Take.song_id.is_(None) if song_id is None
                              else Take.song_id == song_id)
        cloud = self._cloud_dir()
        there = {}
        for go in goes:
            self._take_out(go["take"], cloud)
            if go["folder"] not in there:
                there[go["folder"]] = Path(go["folder"]).is_dir()
            go["missing"] = not there[go["folder"]]
        return {"id": song_id, "title": title, "also": also, "goes": goes}

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
        goes_of for what the first go tonight is measured against, asked on
        every refresh of the rehearsal screen while the rehearsal in
        `folder` is on: only goes from rehearsals on disk other than that
        one, and of those only the ones it can be picked from (api._plays_of),
        so none "missing": the last go of the newest such rehearsal, and the
        later ★ go of the newest such rehearsal with one. None for an id no
        song has.
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
                    if last and starred is not None:
                        break
                    path = self._folder(key)
                    there[key] = path != live and path.is_dir()
                if not there[key]:
                    continue
                if key in last or not last:
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
            titles = self._titles_of(db)
            data = [self._rehearsal_data(r, titles) for r in rows]
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

    def create_rehearsal(self, folder, name, created_at, samplerate, bit_depth, tracks,
                         set_copy=None):
        """`set_copy` is the set it is played by, as set_of gives it, kept on
        the rehearsal as it is now (D7 of the song-sets spec)."""
        with self._session.begin() as db:
            db.add(Rehearsal(
                folder=self.key(folder),
                name=name,
                created_at=created_at,
                samplerate=int(samplerate),
                bit_depth=int(bit_depth),
                set_name=None if set_copy is None else set_copy["name"],
                set_songs=None if set_copy is None else list(set_copy["songs"]),
                tracks=self._track_rows(tracks),
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
            # An old name is the song it leads to, as when typed.
            for key, old in self._names_by_key(db).items():
                songs.setdefault(key, db.get(Song, old.song_id))
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
                # By song, not by spelling: its title and an old name are
                # the same song's goes.
                song = songs[key]
                if song not in counted:
                    counted[song] = song.last_go or 0
                counted[song] += 1
                song.last_go = counted[song]
                return song, counted[song]

            placed = {int(t["take_number"]): go_at(t.get("name"))
                      for t in sorted(takes, key=lambda t: int(t["take_number"]))}
            db.add(Rehearsal(
                folder=self.key(folder),
                name=name,
                created_at=created_at,
                samplerate=int(samplerate),
                bit_depth=int(bit_depth),
                tracks=self._track_rows(tracks),
                takes=[
                    Take(
                        take_number=int(t["take_number"]),
                        song=placed[int(t["take_number"])][0],
                        go=placed[int(t["take_number"])][1],
                        duration_sec=float(t.get("duration_sec") or 0.0),
                        cloud_skip=bool(t.get("cloud_skip")),
                        cloud_send=bool(t.get("cloud_send")),
                        cloud_error=cloud_errors.get(int(t["take_number"])),
                        files=self._take_files(folder, t),
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
        "file": absolute}], "notes"?: [{"name", "file": absolute}], "markers"?, "cloud_skip"?,
        "cloud_send"?}. "tracks" are the audio files and "notes" the .mid files, kept
        as rows of their own kinds.
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
                files=self._take_files(folder, take),
                markers=[Marker(**m) for m in self._labelled(db, take.get("markers", []))],
            )
            db.add(row)
            db.flush()
            db.refresh(row)
            data = self._take_data(folder, row)
        return self._take_out(data, self._cloud_dir())

    def update_take(self, folder, take_number, *, name=None, duration_sec=None,
                    tracks=None, notes=None, markers=None):
        """Changes what is given and leaves the rest. name: what the name field
        held, made a song and a go as add_take makes it (_resolve), so the name
        the take ends up with can differ. tracks: the take's audio files at
        their new absolute paths; notes: its .mid files likewise. Each replaces
        only its own kind, so moving the audio leaves the notes where they were.
        Returns the take, or None."""
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
            if tracks is not None or notes is not None:
                audio = ([f for f in row.files if f.kind != "midi"] if tracks is None
                         else self._files(folder, tracks, "audio"))
                midi = ([f for f in row.files if f.kind == "midi"] if notes is None
                        else self._files(folder, notes, "midi"))
                for position, f in enumerate(audio + midi):
                    f.position = position
                row.files = audio + midi
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

    # ---------- sets ----------
    #
    # Songs a rehearsal goes through, in order: a name and titles each, in an
    # order of their own. A title is resolved when read, through the songs'
    # titles and old names, so a set follows renames and merges; a title no
    # song has is a song not played yet. Each change is one transaction and
    # returns every set as sets() gives them.

    def _titles_of(self, db):
        """A function from a title in a set to {"title", "new"}, as a typed
        name resolves (_resolve): the song's title now, found by its title or
        an old name, compared casefolded, then the same less a trailing
        number ("Opus 5" is Opus when there is a song Opus); the title as it
        is, new, when no song has it."""
        songs = self._songs_by_key(db)
        olds = self._names_by_key(db)
        titles = dict(db.execute(select(Song.id, Song.title)).all())

        def known(text):
            key = text.casefold()
            if key in songs:
                return songs[key].title
            return titles[olds[key].song_id] if key in olds else None

        def resolve(text):
            title = known(text)
            if title is None:
                base, number = split_go(text)
                if number is not None:
                    title = known(base)
            return {"title": text, "new": True} if title is None else {"title": title, "new": False}

        return resolve

    @staticmethod
    def _songs_of_set(titles, stored):
        """A set's stored titles as its songs (`titles` is _titles_of): each
        song once, where it first comes, since two titles can come to name
        one song when the songs are merged (D9)."""
        out, seen = [], set()
        for text in stored or []:
            song = titles(text)
            key = song["title"].casefold()
            if key not in seen:
                seen.add(key)
                out.append(song)
        return out

    def sets(self):
        """[{"id", "name", "songs": [{"title", "new"}]}] in their order."""
        with self._session() as db:
            titles = self._titles_of(db)
            return [{"id": st.id, "name": st.name,
                     "songs": self._songs_of_set(titles, st.songs)}
                    for st in self._ordered_sets(db)]

    def set_of(self, set_id):
        """{"name", "songs"} of the set, the titles as stored, for a
        rehearsal to keep; None when there is no such set."""
        with self._session() as db:
            st = db.get(SongSet, set_id) if set_id is not None else None
            return None if st is None else {"name": st.name, "songs": list(st.songs)}

    @staticmethod
    def _ordered_sets(db):
        return list(db.scalars(select(SongSet).order_by(SongSet.position, SongSet.id)))

    @staticmethod
    def _set_in(sets, set_id):
        found = next((st for st in sets if st.id == set_id), None)
        if found is None:
            raise SetRefused("Set not found")
        return found

    @staticmethod
    def _set_name(sets, name, set_id=None):
        """`name` as a set is called: trimmed and cut as a label's name is.
        Refused empty, or when another set has it, compared by casefold."""
        name = str(name or "").strip()[:LABEL_NAME_MAX].strip()
        if not name:
            raise SetRefused("A set needs a name")
        for other in sets:
            if other.id != set_id and other.name.casefold() == name.casefold():
                raise SetRefused(f"There is already a set called {other.name}")
        return name

    @staticmethod
    def _set_songs(songs):
        """Titles trimmed, empty ones dropped, and each once, at its first
        place, compared casefolded: a song is in a set once (D9)."""
        out, seen = [], set()
        for title in songs or []:
            title = str(title or "").strip()
            if title and title.casefold() not in seen:
                seen.add(title.casefold())
                out.append(title)
        return out

    def add_set(self, name, songs):
        """A new set at the end of the list."""
        with self._session.begin() as db:
            sets = self._ordered_sets(db)
            db.add(SongSet(name=self._set_name(sets, name),
                           songs=self._set_songs(songs), position=len(sets)))
        return self.sets()

    def update_set(self, set_id, name=None, songs=None):
        """Renames the set, or replaces its songs, or both; None leaves that
        part as it is."""
        with self._session.begin() as db:
            sets = self._ordered_sets(db)
            st = self._set_in(sets, set_id)
            if name is not None:
                st.name = self._set_name(sets, name, st.id)
            if songs is not None:
                st.songs = self._set_songs(songs)
        return self.sets()

    def delete_set(self, set_id):
        """Deletes the set. Rehearsals played by it keep their copy."""
        with self._session.begin() as db:
            sets = self._ordered_sets(db)
            st = self._set_in(sets, set_id)
            sets.remove(st)
            db.delete(st)
            for position, other in enumerate(sets):
                other.position = position
        return self.sets()

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
