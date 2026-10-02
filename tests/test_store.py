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
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

from rehearsal_recorder.store import db  # noqa: E402
from rehearsal_recorder.store.importer import import_all  # noqa: E402
from rehearsal_recorder.store.library import Library  # noqa: E402
from rehearsal_recorder.store.models import Base  # noqa: E402
from rehearsal_recorder.store.names import legacy_song, split_go, take_name  # noqa: E402

# The newest migration the app ships. The test-only migrations below sit on
# top of it, so they keep working as real ones are added.
HEAD = ScriptDirectory.from_config(db.alembic_config()).get_current_head()

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


def migrations_up_to(tmp, revision):
    """The app's migrations as far as `revision`, in a folder of their own:
    what an app from before the later ones would bring a database to."""
    folder = tmp / f"migrations-to-{revision}"
    if folder.exists():
        shutil.rmtree(folder)
    shutil.copytree(db.MIGRATIONS, folder, ignore=shutil.ignore_patterns("__pycache__"))
    for f in (folder / "versions").glob("*.py"):
        if f.name[:4] > revision:
            f.unlink()
    return folder


SECOND = '''
revision = "9002"
down_revision = "{down}"
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

    ok("it is at the newest migration", db.current_revision(engine) == HEAD)
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

    broken = migrations_with(tmp, "9002_broken.py", SECOND.format(
        down=HEAD,
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
       (old / f"library.sqlite.bak-{HEAD}").exists())
    engine = db.make_engine(db.database_path(old))
    ok("it is still at the revision it was", db.current_revision(engine) == HEAD)
    with engine.connect() as c:
        columns = [col["name"] for col in inspect(c).get_columns("rehearsal")]
        rows = c.execute(text("SELECT folder FROM rehearsal")).scalars().all()
    engine.dispose()
    ok("the half-done ALTER was rolled back", "venue" not in columns)
    ok("and so was the half-done DELETE", rows == ["Jam"])

    working = migrations_with(tmp, "9002_venue.py", SECOND.format(down=HEAD, extra=""))
    engine = db.open_engine(old, working)
    ok("a working migration moves it on", db.current_revision(engine) == "9002")
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
       renamed["name"] == "Polyn 1"
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
    ok("cp1252 text is read as cp1252", r["name"] == "Café" and first["name"] == "Café 1")
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

    print("\n[8] What a take is called, and what an old name meant")
    ok("a take is called by its song and its go, the first go too",
       take_name("Polyn", 1, 4) == "Polyn 1" and take_name("Polyn", 3, 4) == "Polyn 3")
    ok("a title ending in a number keeps it", take_name("Song 2", 2, 1) == "Song 2 2")
    ok("a take with no song is called by its own number",
       take_name(None, None, 7) == "Take 7")
    ok("a trailing number is split off", split_go(" Polyn 3 ") == ("Polyn", 3))
    ok("a name without one has none", split_go("Polyn") == ("Polyn", None))
    ok("a bare number is a name, not a go", split_go("1999") == ("1999", None))
    ok("old names: a trailing number was the go, the rest the song",
       legacy_song("Polyn 3") == "Polyn" and legacy_song("Polyn") == "Polyn"
       and legacy_song("Полынь 2") == "Полынь")
    ok("old names: the app's own names are no song",
       legacy_song("Take 4") is None and legacy_song("Recovered take 2") is None
       and legacy_song("  ") is None and legacy_song(None) is None)
    ok("old names: what the rule cannot know stays as it reads",
       legacy_song("Опус 5") == "Опус")

    print("\n[9] Old names become songs (migration 0002)")
    rec9 = tmp / "Songs"
    rec9.mkdir()
    db.open_engine(rec9, migrations_up_to(tmp, "0001")).dispose()
    old_names = {
        # rehearsal: (created_at, take names in order)
        "Old": ("2026-01-10T19:00:00",
                ["polyn", "Take 2", "Recovered take 3", "", "Song 2", "polyn", "Опус 5"]),
        "Mid": ("2026-02-10T19:00:00", ["Polyn", "Polyn 3", "Song", "ПОЛЫНЬ"]),
        "New": ("2026-03-10T19:00:00", ["Полынь 2"]),
    }
    engine = db.make_engine(db.database_path(rec9))
    with engine.begin() as c:
        for folder, (created_at, names) in old_names.items():
            rid = c.execute(text(
                "INSERT INTO rehearsal (folder, name, created_at, samplerate, bit_depth) "
                "VALUES (:f, :f, :c, 48000, 24)"), {"f": folder, "c": created_at}).lastrowid
            for number, old in enumerate(names, start=1):
                tid = c.execute(text(
                    "INSERT INTO take (rehearsal_id, take_number, name, duration_sec, "
                    "cloud_skip, cloud_send) VALUES (:r, :n, :name, 1.0, 0, 0)"),
                    {"r": rid, "n": number, "name": old}).lastrowid
                c.execute(text("INSERT INTO take_file (take_id, position, name, file) "
                               "VALUES (:t, 0, 'Gtr', :f)"),
                          {"t": tid, "f": f"{number:02d} - {old}/Gtr.wav"})
                c.execute(text("INSERT INTO marker (take_id, at, kind, note) "
                               "VALUES (:t, 1.0, 'good', '')"), {"t": tid})
                c.execute(text("INSERT INTO cloud_copy (take_id, mix, source) "
                               "VALUES (:t, :m, '{}')"),
                          {"t": tid, "m": f"{folder}/{number:02d} - {old}.wav"})
    engine.dispose()

    engine = db.open_engine(rec9)
    ok("an old database is moved on to the newest migration",
       db.current_revision(engine) == HEAD)
    ok("after it was copied aside", (rec9 / "library.sqlite.bak-0001").exists())
    with engine.connect() as c:
        drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
        columns = {col["name"] for col in inspect(c).get_columns("take")}
        counts = {t: c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                  for t in ("take", "take_file", "marker", "cloud_copy")}
        titles = sorted(c.execute(text("SELECT title FROM song")).scalars().all())
    engine.dispose()
    ok("and it is then what models.py describes", drift == [])
    ok("a take's name is not stored any more",
       "name" not in columns and {"song_id", "go"} <= columns)
    ok("every take keeps its files, its marks and its cloud copy",
       counts == {"take": 12, "take_file": 12, "marker": 12, "cloud_copy": 12})
    ok("one song per title, whatever the case or the script",
       titles == ["Polyn", "Song", "Опус", "Полынь"])

    lib = Library(rec9)

    def names_of(folder):
        return [(t["name"], t["song"], t["go"]) for t in lib.rehearsal(rec9 / folder)["takes"]]

    ok("the app's own names are no song, a recovered take's and an empty one included",
       names_of("Old")[1:4] == [("Take 2", None, None), ("Take 3", None, None),
                                ("Take 4", None, None)])
    ok("a song is spelled as the newest rehearsal first spells it",
       names_of("Old")[0] == ("Polyn 1", "Polyn", 1)
       and names_of("Mid")[3] == ("Полынь 1", "Полынь", 1)
       and names_of("New") == [("Полынь 2", "Полынь", 2)])
    ok("goes are numbered across rehearsals in the order played, gaps closed",
       [names_of("Old")[0][2], names_of("Old")[5][2],
        names_of("Mid")[0][2], names_of("Mid")[1][2]] == [1, 2, 3, 4])
    ok("two takes of one name in a rehearsal get a go each",
       names_of("Old")[5] == ("Polyn 2", "Polyn", 2))
    ok("an old name with a trailing number is a go at the song without it",
       names_of("Old")[4] == ("Song 1", "Song", 1) and names_of("Mid")[2] == ("Song 2", "Song", 2))
    ok("even with no such song anywhere: what the rule cannot know stays as it reads",
       names_of("Old")[6] == ("Опус 1", "Опус", 1))
    lib.close()

    try:
        db.open_engine(rec9, migrations_up_to(tmp, "0001")).dispose()
        refused = None
    except db.LibraryUnavailable as e:
        refused = str(e)
    ok("an app from before songs refuses the database, as any older app would",
       refused == db.NEWER_DATABASE)

    print("\n[10] Naming a take: a go at a song, numbered across the library")
    rec10 = tmp / "Naming"
    rec10.mkdir()
    lib = Library(rec10)
    jam = rec10 / "Jam"
    lib.create_rehearsal(jam, "Jam", "2026-10-01T19:00:00", 48000, 24, [])

    def add(number, name, folder=jam):
        t = lib.add_take(folder, {"take_number": number, "name": name, "tracks": []})
        return t["name"], t["song"], t["go"]

    def rename(number, name):
        t = lib.update_take(jam, number, name=name)
        return t["name"], t["song"], t["go"]

    def song_titles():
        e = db.make_engine(db.database_path(rec10))
        with e.connect() as c:
            found = sorted(c.execute(text("SELECT title FROM song")).scalars().all())
        e.dispose()
        return found

    ok("a new title is a new song, at go 1", add(1, "Polyn") == ("Polyn 1", "Polyn", 1))
    ok("the same title in another case is the same song, at its next go",
       add(2, "polyn") == ("Polyn 2", "Polyn", 2))
    ok("a number typed after the title names the song; the go is the app's",
       add(3, "Polyn 7") == ("Polyn 3", "Polyn", 3))
    ok("Take N is no song, and is called by the take's own number",
       add(4, "Take 9") == ("Take 4", None, None))
    ok("so is an empty name", add(5, "  ") == ("Take 5", None, None))
    ok("a title ending in a number is a song of its own when no shorter one exists",
       add(6, "Song 2") == ("Song 2 1", "Song 2", 1)
       and add(7, "Song 2") == ("Song 2 2", "Song 2", 2))
    ok("Cyrillic is compared case-blind too",
       add(8, "Полынь") == ("Полынь 1", "Полынь", 1)
       and add(9, "ПОЛЫНЬ 4") == ("Полынь 2", "Полынь", 2))
    ok("one row per song", song_titles() == ["Polyn", "Song 2", "Полынь"])

    before = song_titles()
    ok("asking what a name would be writes nothing",
       lib.resolve_name(jam, "Vesna", 10) == {"song": "Vesna", "go": 1, "name": "Vesna 1"}
       and lib.resolve_name(jam, "polyn", 10) == {"song": "Polyn", "go": 4, "name": "Polyn 4"}
       and lib.resolve_name(jam, "", 10) == {"song": None, "go": None, "name": "Take 10"}
       and song_titles() == before)

    other = rec10 / "Other"
    lib.create_rehearsal(other, "Other", "2026-10-02T19:00:00", 48000, 24, [])
    ok("goes run on across rehearsals", add(1, "Polyn", other) == ("Polyn 4", "Polyn", 4))
    ok("the next go of every song, in one look",
       lib.next_goes() == {"Polyn": 5, "Song 2": 3, "Полынь": 3})

    ok("renamed to the song it already has, a take keeps its go",
       rename(3, "Polyn") == ("Polyn 3", "Polyn", 3))
    ok("renamed to another song, it is that song's next go",
       rename(4, "polyn") == ("Polyn 5", "Polyn", 5))
    ok("renamed to a new title, it is a new song", rename(9, "Vesna") == ("Vesna 1", "Vesna", 1))
    ok("a case-only rename of a song's only take respells the song",
       rename(8, "ПОЛЫНЬ") == ("ПОЛЫНЬ 1", "ПОЛЫНЬ", 1))
    ok("but not a song that other takes are goes at",
       rename(1, "POLYN") == ("Polyn 1", "Polyn", 1))
    ok("a song left with no takes is gone",
       rename(9, "Take 9") == ("Take 9", None, None) and "Vesna" not in song_titles())
    lib.delete_take(jam, 2)
    ok("deleting a go does not renumber the rest", lib.take(jam, 3)["name"] == "Polyn 3")
    lib.delete_take(jam, 8)
    ok("deleting a song's last take deletes the song", "ПОЛЫНЬ" not in song_titles())
    lib.forget_rehearsal(jam)
    lib.forget_rehearsal(other)
    ok("forgetting rehearsals forgets the songs only they had", song_titles() == [])

    lib.create_rehearsal(rec10 / "Kept", "Kept", "2026-10-03T19:00:00", 48000, 24, [])
    add(1, "Polyn", rec10 / "Kept")
    old_jam = rec10 / "Old jam - 2020-01-01 10-00"
    old_jam.mkdir()
    (old_jam / "session.json").write_text(json.dumps({
        "name": "Old jam", "created_at": "2020-01-01T10:00:00", "samplerate": 48000,
        "tracks": [], "takes": [
            {"take_number": n, "name": name, "tracks": []}
            for n, name in enumerate(
                ["polyn", "Polyn 3", "Recovered take 3", "zima", "Zima 2", "Опус 5"], start=1)],
    }), encoding="utf-8")
    import_all(lib, None)
    ok("an imported rehearsal is read by the old rule, its goes numbered after the "
       "ones already there, even though it is older",
       [(t["name"], t["song"], t["go"]) for t in lib.rehearsal(old_jam)["takes"]] == [
           ("Polyn 2", "Polyn", 2), ("Polyn 3", "Polyn", 3), ("Take 3", None, None),
           ("zima 1", "zima", 1), ("zima 2", "zima", 2), ("Опус 1", "Опус", 1)])
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
