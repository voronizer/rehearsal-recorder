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

from sqlalchemy import select
from sqlalchemy.orm import selectinload, sessionmaker

from rehearsal_recorder.store.db import MIGRATIONS, open_engine
from rehearsal_recorder.store.models import CloudCopy, Marker, Rehearsal, Take, TakeFile, Track

MARKER_KINDS = ("note", "good", "issue", "redo")


def as_marker(value):
    """
    A marker as it is kept: a spot rounded to 0.01 s, one of MARKER_KINDS,
    and a note of at most 200 characters. The earliest versions stored a bare
    number, which still comes in through old session.json files.
    """
    if isinstance(value, dict):
        at = round(float(value.get("at", 0.0)), 2)
        kind = value.get("kind", "note")
        note = str(value.get("note", "")).strip()[:200]
    else:
        at = round(float(value), 2)
        kind, note = "note", ""
    if kind not in MARKER_KINDS:
        kind = "note"
    return {"at": at, "kind": kind, "note": note}


def _relative(path, root):
    """`path` relative to `root`, with forward slashes; ValueError when it is
    not inside."""
    return Path(path).resolve().relative_to(Path(root).resolve()).as_posix()


_WITH_TAKES = (
    selectinload(Rehearsal.tracks),
    selectinload(Rehearsal.takes).selectinload(Take.files),
    selectinload(Rehearsal.takes).selectinload(Take.markers),
    selectinload(Rehearsal.takes).selectinload(Take.cloud_copy),
)


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
        out = {
            "take_number": take.take_number,
            "name": take.name,
            "duration_sec": take.duration_sec,
            "tracks": [
                {"name": f.name, "file": str(folder / Path(f.file))} for f in take.files
            ],
            "markers": [
                {"at": m.at, "kind": m.kind, "note": m.note} for m in take.markers
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
        of it does. takes as for add_take; cloud: {take_number: shared} as for
        set_cloud_copy, relative to cloud_dir; cloud_errors: {take_number:
        message}.
        """
        folder = Path(folder)
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
                takes=[
                    Take(
                        take_number=int(t["take_number"]),
                        name=t["name"],
                        duration_sec=float(t.get("duration_sec") or 0.0),
                        cloud_skip=bool(t.get("cloud_skip")),
                        cloud_send=bool(t.get("cloud_send")),
                        cloud_error=cloud_errors.get(int(t["take_number"])),
                        files=self._files(folder, t.get("tracks", [])),
                        markers=[Marker(**as_marker(m)) for m in t.get("markers", [])],
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
                selectinload(Take.files), selectinload(Take.markers),
                selectinload(Take.cloud_copy),
            )
            data = None if row is None else self._take_data(Path(folder), row)
        return self._take_out(data, self._cloud_dir())

    def add_take(self, folder, take):
        """
        take: {"take_number", "name", "duration_sec", "tracks": [{"name",
        "file": absolute}], "markers"?, "cloud_skip"?, "cloud_send"?}.
        Returns the take as it is now kept, or None without the rehearsal.
        """
        folder = Path(folder)
        with self._session.begin() as db:
            rehearsal = self._find(db, folder)
            if rehearsal is None:
                return None
            row = Take(
                rehearsal_id=rehearsal.id,
                take_number=int(take["take_number"]),
                name=take["name"],
                duration_sec=float(take.get("duration_sec") or 0.0),
                cloud_skip=bool(take.get("cloud_skip")),
                cloud_send=bool(take.get("cloud_send")),
                files=self._files(folder, take.get("tracks", [])),
                markers=[Marker(**as_marker(m)) for m in take.get("markers", [])],
            )
            db.add(row)
            db.flush()
            db.refresh(row)
            data = self._take_data(folder, row)
        return self._take_out(data, self._cloud_dir())

    def update_take(self, folder, take_number, *, name=None, duration_sec=None,
                    tracks=None, markers=None):
        """Changes what is given and leaves the rest. tracks: the take's files
        at their new absolute paths. Returns the take, or None."""
        folder = Path(folder)
        with self._session.begin() as db:
            row = self._find_take(db, folder, take_number)
            if row is None:
                return None
            if name is not None:
                row.name = name
            if duration_sec is not None:
                row.duration_sec = float(duration_sec)
            if tracks is not None:
                row.files = self._files(folder, tracks)
            if markers is not None:
                row.markers = [Marker(**as_marker(m)) for m in markers]
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
            current = [{"at": m.at, "kind": m.kind, "note": m.note} for m in row.markers]
            kept = sorted((as_marker(m) for m in fn(current)), key=lambda m: m["at"])
            row.markers = [Marker(**m) for m in kept]
            return kept

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
