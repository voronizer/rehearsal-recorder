"""
The database the history lives in: its schema, its migrations, and the move
of every old session.json into it.

No sound card and no browser — only files in a temporary folder. The
migrations are exercised for real, on SQLite, the way the app runs them at
start; a chain of test-only migrations stands in for the ones later versions
will add, so the backup and the rollback are checked before there is a
second real migration to need them.
"""

import json
import shutil
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
# The sources live under src/, so put that on the path rather than the
# repository root. This means the suites run from a clone without the
# package having been installed first.
sys.path.insert(0, str(PROJECT / "src"))

# Nothing here plays sound, but the package imports the audio layer.
_sd = types.ModuleType("sounddevice")
_sd.query_devices = lambda *a, **k: []
_sd.query_hostapis = lambda: []
_sd.OutputStream = _sd.InputStream = None
sys.modules.setdefault("sounddevice", _sd)

from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.runtime.migration import MigrationContext  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

from rehearsal_recorder.store import db  # noqa: E402
from rehearsal_recorder.store.importer import import_all  # noqa: E402
from rehearsal_recorder.store.library import Library  # noqa: E402
from rehearsal_recorder.store.models import Base  # noqa: E402

problems = []


def ok(label, cond):
    print(("  ok   " if cond else "  FAIL ") + label)
    if not cond:
        problems.append(label)


def migrations_with(tmp, name, body):
    """The app's migrations plus one more, in a folder of their own."""
    folder = tmp / "migrations"
    if folder.exists():
        shutil.rmtree(folder)
    shutil.copytree(db.MIGRATIONS, folder, ignore=shutil.ignore_patterns("__pycache__"))
    (folder / "versions" / name).write_text(body, encoding="utf-8")
    return folder


SECOND = '''
revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade():
    with op.batch_alter_table("rehearsal") as batch:
        batch.add_column(sa.Column("venue", sa.String(), nullable=True))
{extra}

def downgrade():
    pass
'''


def main():
    tmp = Path(tempfile.mkdtemp())

    print("\n[1] A new database is the models, exactly")
    rec = tmp / "Rec"
    rec.mkdir()
    engine = db.open_engine(rec)
    with engine.connect() as c:
        drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
        ok("the migrations build what models.py describes (no drift)", drift == [])
        ok("foreign keys are on",
           c.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1)
        ok("the journal is WAL",
           c.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal")

    # Test that two writers meeting wait for each other (BEGIN IMMEDIATE)
    path = db.database_path(rec)
    e1 = db.make_engine(path)
    e2 = db.make_engine(path)
    c1 = e1.connect()
    t1 = c1.begin()
    c1.execute(text("SELECT COUNT(*) FROM rehearsal"))

    exception_in_thread = [None]

    def writer2():
        try:
            with e2.begin() as c2:
                c2.execute(text("INSERT INTO rehearsal(folder,name,created_at,samplerate,bit_depth) VALUES ('b','B','x',1,1)"))
        except Exception as e:
            exception_in_thread[0] = e

    thread = threading.Thread(target=writer2)
    thread.start()
    time.sleep(0.3)
    c1.execute(text("INSERT INTO rehearsal(folder,name,created_at,samplerate,bit_depth) VALUES ('a','A','x',1,1)"))
    t1.commit()
    c1.close()
    thread.join()

    with e1.begin() as c_final:
        final_rows = c_final.execute(text("SELECT folder FROM rehearsal ORDER BY folder")).scalars().all()
    ok("two writers meeting wait for each other instead of failing",
       exception_in_thread[0] is None and final_rows == ["a", "b"])
    e1.dispose()
    e2.dispose()

    ok("it is at the newest migration", db.current_revision(engine) == "0001")
    ok("it lives in the recordings folder", (rec / "library.sqlite").exists())
    ok("a new database is not backed up", not list(rec.glob("*.bak-*")))
    engine.dispose()

    print("\n[2] A database from a newer app is left alone")
    newer = tmp / "Newer"
    newer.mkdir()
    db.open_engine(newer).dispose()
    engine = db.make_engine(db.database_path(newer))
    with engine.begin() as c:
        c.execute(text("UPDATE alembic_version SET version_num = '9999'"))
    engine.dispose()
    before = db.database_path(newer).read_bytes()
    try:
        db.open_engine(newer).dispose()
        refused = None
    except db.LibraryUnavailable as e:
        refused = str(e)
    ok("it is refused", refused == db.NEWER_DATABASE)
    ok("and not a byte of it changed", db.database_path(newer).read_bytes() == before)

    print("\n[3] Migrating: a backup first, and all or nothing")
    old = tmp / "Old"
    old.mkdir()
    lib = Library(old)
    (old / "Jam").mkdir()
    lib.create_rehearsal(old / "Jam", "Jam", "2026-01-01T10:00:00", 48000, 24, [])
    lib.close()

    broken = migrations_with(tmp, "0002_broken.py", SECOND.format(
        extra='    op.execute("DELETE FROM rehearsal")\n'
              '    raise RuntimeError("the migration broke")\n'))
    try:
        db.open_engine(old, broken).dispose()
        failed = None
    except db.LibraryUnavailable as e:
        failed = str(e)
    ok("a failing migration makes the folder unavailable, saying why",
       failed is not None and "the migration broke" in failed)
    ok("the database was copied aside before it was touched",
       (old / "library.sqlite.bak-0001").exists())
    engine = db.make_engine(db.database_path(old))
    ok("it is still at the revision it was", db.current_revision(engine) == "0001")
    with engine.connect() as c:
        columns = [col["name"] for col in inspect(c).get_columns("rehearsal")]
        rows = c.execute(text("SELECT folder FROM rehearsal")).scalars().all()
    engine.dispose()
    ok("the half-done ALTER was rolled back", "venue" not in columns)
    ok("and so was the half-done DELETE", rows == ["Jam"])

    working = migrations_with(tmp, "0002_venue.py", SECOND.format(extra=""))
    engine = db.open_engine(old, working)
    ok("a working migration moves it on", db.current_revision(engine) == "0002")
    with engine.connect() as c:
        rows = c.execute(text("SELECT folder, venue FROM rehearsal")).all()
    engine.dispose()
    ok("with the data it had", [tuple(r) for r in rows] == [("Jam", None)])

    print("\n[4] The library: what goes in comes out, as the interface expects")
    rec = tmp / "Lib"
    rec.mkdir()
    cloud = tmp / "Cloud"
    cloud_setting = {"dir": cloud}
    lib = Library(rec, cloud_dir=lambda: cloud_setting["dir"])
    jam = rec / "Полынь - 2026-09-23 10-00"
    jam.mkdir()
    lib.create_rehearsal(jam, "Полынь", "2026-09-23T10:00:00", 48000, 24,
                         [{"name": "Gtr", "channel": 1}, {"name": "Vox", "channel": 2}])
    take = lib.add_take(jam, {
        "take_number": 1, "name": "Полынь", "duration_sec": 3.5,
        "tracks": [{"name": "Gtr", "file": str(jam / "01 - Полынь" / "Gtr.wav")}],
        "markers": [{"at": 1.234, "kind": "nonsense", "note": " hi "}, 0.5],
        "cloud_skip": True,
    })
    ok("a take comes back with absolute paths",
       take["tracks"] == [{"name": "Gtr", "file": str(jam / "01 - Полынь" / "Gtr.wav")}])
    ok("markers come back normalised and in order",
       take["markers"] == [{"at": 0.5, "kind": "note", "note": ""},
                           {"at": 1.23, "kind": "note", "note": "hi"}])
    ok("its own cloud answer is kept", take["cloud_skip"] is True and take["cloud_send"] is False)
    ok("nothing is in the cloud yet", take["cloud"] == {} and "cloud_error" not in take)
    try:
        lib.add_take(jam, {"take_number": 1, "name": "again", "tracks": []})
        duplicated = True
    except Exception:
        duplicated = False
    ok("a take number is used once per rehearsal", not duplicated)
    ok("a take of a rehearsal not in the library is refused",
       lib.add_take(rec / "Nowhere", {"take_number": 1, "name": "x"}) is None)

    sub = cloud / jam.name
    shared = {"mix": str(sub / "01 - Полынь.flac"), "mix_format": "flac",
              "gain": 0.7, "source": {"dir": jam.name, "what": "mix"}}
    lib.set_cloud_error(jam, 1, "the folder was gone")
    ok("a failure is kept with the take", lib.take(jam, 1)["cloud_error"] == "the folder was gone")
    lib.set_cloud_copy(jam, 1, shared, cloud)
    got = lib.take(jam, 1)
    ok("a copy comes back as it was recorded", got["cloud"] == shared)
    ok("and it settles the failure", "cloud_error" not in got)
    lib.set_cloud_copy(jam, 1, {"source": {}}, cloud)
    ok("a record of nothing copied must not read as in the cloud",
       lib.take(jam, 1)["cloud"] == {})
    lib.set_cloud_copy(jam, 1, {**shared, "mix": str(sub / "01 - Полынь.mp3"),
                                "mix_format": "mp3"}, cloud)
    ok("a new copy replaces the old one",
       lib.take(jam, 1)["cloud"]["mix"] == str(sub / "01 - Полынь.mp3"))

    moved_cloud = tmp / "Cloud moved"
    cloud_setting["dir"] = moved_cloud
    ok("the cloud folder moving moves the copy with it",
       lib.take(jam, 1)["cloud"]["mix"] == str(moved_cloud / jam.name / "01 - Полынь.mp3"))
    cloud_setting["dir"] = None
    ok("with no cloud folder there is no copy to speak of", lib.take(jam, 1)["cloud"] == {})
    cloud_setting["dir"] = cloud
    ok("and it is back when the folder is", bool(lib.take(jam, 1)["cloud"]))

    kept = lib.edit_markers(jam, 1, lambda ms: ms + [{"at": 2.0, "kind": "good", "note": ""}])
    ok("markers are edited in one step", [m["at"] for m in kept] == [0.5, 1.23, 2.0])
    renamed = lib.update_take(jam, 1, name="Polyn", tracks=[
        {"name": "Gtr", "file": str(jam / "01 - Polyn" / "Gtr.wav")}])
    ok("a rename changes the name and the files",
       renamed["name"] == "Polyn"
       and renamed["tracks"][0]["file"] == str(jam / "01 - Polyn" / "Gtr.wav"))
    ok("and leaves the rest", renamed["duration_sec"] == 3.5 and len(renamed["markers"]) == 3)

    again = rec / "Polyn - 2026-09-23 10-00"
    jam.rename(again)
    lib.move_rehearsal(jam, again, "Polyn")
    moved = lib.rehearsal(again)
    ok("renaming a rehearsal is one change: its files follow",
       moved["name"] == "Polyn"
       and moved["takes"][0]["tracks"][0]["file"] == str(again / "01 - Polyn" / "Gtr.wav"))
    ok("the old folder is not a rehearsal any more", lib.rehearsal(jam) is None)
    ok("its track setup is kept, in order",
       moved["tracks"] == [{"name": "Gtr", "channel": 1}, {"name": "Vox", "channel": 2}])

    print("\n[5] A folder that went missing")
    ok("a folder on disk is not missing", lib.rehearsals()[0]["missing"] is False)
    shutil.rmtree(again)
    listed = lib.rehearsals()
    ok("a folder deleted by hand stays listed, marked",
       len(listed) == 1 and listed[0]["missing"] is True)
    ok("forgetting it drops it", lib.forget_rehearsal(again) and lib.rehearsals() == [])

    print("\n[6] Deleting cascades")
    gone = rec / "Gone"
    gone.mkdir()
    lib.create_rehearsal(gone, "Gone", "2026-09-24T10:00:00", 48000, 24, [])
    for n in (1, 2):
        lib.add_take(gone, {"take_number": n, "name": f"Take {n}", "markers": [1.0],
                            "tracks": [{"name": "Gtr", "file": str(gone / f"0{n}" / "Gtr.wav")}]})
    lib.set_cloud_copy(gone, 1, {"mix": str(cloud / "Gone" / "a.wav"), "source": {}}, cloud)
    ok("deleting a take says how many are left", lib.delete_take(gone, 1) == 1)
    lib.forget_rehearsal(gone)
    engine = db.make_engine(db.database_path(rec))
    with engine.connect() as c:
        left = {t: c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                for t in ("take", "take_file", "marker", "cloud_copy", "track")}
    engine.dispose()
    ok("a forgotten rehearsal leaves nothing behind", set(left.values()) == {0})
    lib.close()

    print("\n[7] Old session.json files move in")
    rec = tmp / "Import"
    rec.mkdir()
    cloud = tmp / "Import cloud"
    cafe = rec / "Café - 2020-01-01 10-00"
    (cafe / "01 - Café").mkdir(parents=True)
    # Written the way an old version on Windows wrote it: cp1252, absolute
    # paths from before the folder was moved, a bare-number marker, and no
    # bit depth (16-bit was all there was).
    (cafe / "session.json").write_bytes(json.dumps({
        "name": "Café",
        "created_at": "2020-01-01T10:00:00",
        "samplerate": 44100,
        "tracks": [{"name": "Gtr", "channel": 1}],
        "takes": [
            {"take_number": 1, "name": "Café", "duration_sec": 2,
             "tracks": [{"name": "Gtr",
                         "file": str(Path("D:/elsewhere/Café/01 - Café/Gtr.wav"))}],
             "markers": [3.14159],
             "cloud": {"mix": str(cloud / cafe.name / "01 - Café.wav"),
                       "mix_format": "wav", "gain": 1.0,
                       "source": {"dir": str(cloud / cafe.name), "what": "mix"}},
             "cloud_error": "it was offline", "cloud_send": True},
            {"take_number": 2, "name": "Take 2", "duration_sec": 1,
             "tracks": [{"name": "Gtr", "file": str(cafe / "02 - Take 2" / "Gtr.wav")}],
             "cloud": {"mix": str(Path("D:/somewhere else/a.wav"))}},
        ],
    }, ensure_ascii=False).encode("cp1252"))
    broken = rec / "Broken"
    broken.mkdir()
    (broken / "session.json").write_text("{not json", encoding="utf-8")

    lib = Library(rec, cloud_dir=lambda: cloud)
    reported = []
    result = import_all(lib, cloud, report=lambda folder, e: reported.append(folder.name))
    ok("the readable one is imported, the broken one is not",
       result == {"imported": 1, "failed": 1})
    ok("the broken one is reported", reported == ["Broken"])
    ok("and left where it was, for next time", (broken / "session.json").exists())
    ok("the imported one's session.json is gone", not (cafe / "session.json").exists())

    r = lib.rehearsal(cafe)
    first, second = r["takes"]
    ok("cp1252 text is read as cp1252", r["name"] == "Café" and first["name"] == "Café")
    ok("no bit depth meant 16", r["bit_depth"] == 16 and r["samplerate"] == 44100)
    ok("a path from before the folder moved is found again",
       first["tracks"][0]["file"] == str(cafe / "01 - Café" / "Gtr.wav"))
    ok("a path inside the folder is kept",
       second["tracks"][0]["file"] == str(cafe / "02 - Take 2" / "Gtr.wav"))
    ok("a bare-number marker becomes a marker",
       first["markers"] == [{"at": 3.14, "kind": "note", "note": ""}])
    ok("the cloud copy comes along, relative to the cloud folder",
       first["cloud"]["mix"] == str(cloud / cafe.name / "01 - Café.wav"))
    ok("its destination is the rehearsal's subfolder now",
       first["cloud"]["source"]["dir"] == cafe.name)
    ok("the take's own answers and errors come along",
       first["cloud_send"] is True and first["cloud_error"] == "it was offline")
    ok("a copy outside the cloud folder is dropped: the take counts as not sent",
       second["cloud"] == {})

    (cafe / "session.json").write_text("{}", encoding="utf-8")
    again = import_all(lib, cloud)
    ok("opening again imports nothing twice",
       again["imported"] == 0 and len(lib.rehearsals()) == 1)
    ok("a session.json left by a crash after the import is just removed",
       not (cafe / "session.json").exists())
    lib.close()

    no_cloud = tmp / "No cloud"
    (no_cloud / "Jam").mkdir(parents=True)
    (no_cloud / "Jam" / "session.json").write_text(json.dumps({
        "name": "Jam", "created_at": "2020-01-01T10:00:00", "samplerate": 48000,
        "bit_depth": 24, "tracks": [],
        "takes": [{"take_number": 1, "name": "Take 1", "tracks": [],
                   "cloud": {"mix": str(tmp / "x" / "a.wav"), "source": {}}}],
    }), encoding="utf-8")
    lib = Library(no_cloud)
    import_all(lib, None)
    lib.close()
    lib = Library(no_cloud, cloud_dir=lambda: tmp / "x")
    ok("with no cloud folder set, an old copy is not kept",
       lib.rehearsal(no_cloud / "Jam")["takes"][0]["cloud"] == {})
    lib.close()

    print()
    if problems:
        print(f"{len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        sys.exit(1)
    print("All store checks passed.")


if __name__ == "__main__":
    main()
