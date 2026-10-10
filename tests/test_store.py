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
# No suite opens a real MIDI port. With None in sys.modules, importing the
# library raises ImportError, which midi/ports.open_system() answers as "MIDI is
# not available" — whatever is plugged into the machine running them.
sys.modules["pylibremidi"] = None

from alembic import command  # noqa: E402
from alembic.autogenerate import compare_metadata  # noqa: E402
from alembic.runtime.migration import MigrationContext  # noqa: E402
from alembic.script import ScriptDirectory  # noqa: E402
from sqlalchemy import inspect, text  # noqa: E402

from rehearsal_recorder.store import db  # noqa: E402
from rehearsal_recorder.store.importer import import_all  # noqa: E402
from rehearsal_recorder.store.library import (  # noqa: E402
    LabelRefused, Library, SetRefused, SongRefused,
)
from rehearsal_recorder.store.models import Base  # noqa: E402
from rehearsal_recorder.store.names import legacy_song, split_go, take_name  # noqa: E402

# The newest migration the app ships. The test-only migrations below sit on
# top of it, so they keep working as real ones are added.
HEAD = ScriptDirectory.from_config(db.alembic_config()).get_current_head()

problems = []


def ok(label, cond):
    # Labels stay in what a Windows console's code page (cp1252) can
    # print: CI runs these there, and print() fails on anything else,
    # such as "★" or "▶", taking the whole suite down with it.
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
        "markers": [{"at": 1.234, "label_id": 99, "note": " hi "}, 0.5],
        "cloud_skip": True,
    })
    ok("a take comes back with absolute paths",
       take["tracks"] == [{"name": "Gtr", "file": str(jam / "01 - Полынь" / "Gtr.wav")}])
    ok("markers come back normalised and in order, on a label that is there",
       take["markers"] == [{"at": 0.5, "label_id": 1, "note": ""},
                           {"at": 1.23, "label_id": 1, "note": "hi"}])
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

    kept = lib.edit_markers(jam, 1, lambda ms: ms + [{"at": 2.0, "label_id": 2, "note": ""}])
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
       moved["tracks"] == [{"name": "Gtr", "channel": 1, "mode": "audio", "midi_port": None},
                           {"name": "Vox", "channel": 2, "mode": "audio", "midi_port": None}])

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
       first["markers"] == [{"at": 3.14, "label_id": 1, "note": ""}])
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
        song_ref = [fk for fk in c.execute(text("PRAGMA foreign_key_list(take)")).mappings()
                    if fk["table"] == "song"]
    engine.dispose()
    ok("and it is then what models.py describes", drift == [])
    # models.py cannot say it (reflection does not see ON DELETE), so look.
    ok("a take whose song goes is left without one, not deleted (ON DELETE SET NULL)",
       len(song_ref) == 1 and song_ref[0]["on_delete"] == "SET NULL")
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
    ok("each song's count starts at its highest go",
       lib.next_goes() == {"Polyn": 5, "Song": 3, "Опус": 2, "Полынь": 3})
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
    ok("a song left with no takes keeps its count: its next go is not 1 again",
       rename(9, "Take 9") == ("Take 9", None, None)
       and lib.resolve_name(jam, "vesna", 20) == {"song": "Vesna", "go": 2, "name": "Vesna 2"})
    lib.delete_take(jam, 2)
    ok("deleting a go does not renumber the rest", lib.take(jam, 3)["name"] == "Polyn 3")
    lib.delete_take(jam, 4)
    ok("deleting the latest go does not give its number out again",
       lib.resolve_name(jam, "Polyn", 20)["go"] == 6)
    lib.delete_take(jam, 8)
    ok("a song whose takes are all gone is kept, and carries on from its count",
       "ПОЛЫНЬ" in song_titles() and lib.resolve_name(jam, "полынь", 20)["go"] == 3)
    lib.forget_rehearsal(jam)
    lib.forget_rehearsal(other)
    ok("forgetting rehearsals keeps every song and its count",
       song_titles() == ["Polyn", "Song 2", "Vesna", "ПОЛЫНЬ"]
       and lib.next_goes() == {"Polyn": 6, "Song 2": 3, "Vesna": 2, "ПОЛЫНЬ": 3})

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
    ok("an imported rehearsal is read by the old rule, its goes carrying on from "
       "each song's count, even though it is older",
       [(t["name"], t["song"], t["go"]) for t in lib.rehearsal(old_jam)["takes"]] == [
           ("Polyn 7", "Polyn", 7), ("Polyn 8", "Polyn", 8), ("Take 3", None, None),
           ("zima 1", "zima", 1), ("zima 2", "zima", 2), ("Опус 1", "Опус", 1)])
    lib.close()

    print("\n[11] Stars (migration 0003)")
    rec11 = tmp / "Stars"
    rec11.mkdir()
    db.open_engine(rec11, migrations_up_to(tmp, "0002")).dispose()
    engine = db.make_engine(db.database_path(rec11))
    with engine.begin() as c:
        rid = c.execute(text(
            "INSERT INTO rehearsal (folder, name, created_at, samplerate, bit_depth) "
            "VALUES ('Jam', 'Jam', '2026-09-01T19:00:00', 48000, 24)")).lastrowid
        sid = c.execute(text(
            "INSERT INTO song (title, last_go) VALUES ('Polyn', 2)")).lastrowid
        for number, go in ((1, 1), (2, 2), (3, None)):
            tid = c.execute(text(
                "INSERT INTO take (rehearsal_id, take_number, song_id, go, duration_sec, "
                "cloud_skip, cloud_send) VALUES (:r, :n, :s, :g, 1.0, 0, 0)"),
                {"r": rid, "n": number, "s": sid if go else None, "g": go}).lastrowid
            c.execute(text("INSERT INTO take_file (take_id, position, name, file) "
                           "VALUES (:t, 0, 'Gtr', :f)"),
                      {"t": tid, "f": f"{number:02d}/Gtr.wav"})
            c.execute(text("INSERT INTO marker (take_id, at, kind, note) "
                           "VALUES (:t, 1.0, 'good', '')"), {"t": tid})
            c.execute(text("INSERT INTO cloud_copy (take_id, mix, source) "
                           "VALUES (:t, :m, '{}')"), {"t": tid, "m": f"Jam/{number:02d}.wav"})
    engine.dispose()

    engine = db.open_engine(rec11)
    ok("a database at 0002 is moved on to the newest migration",
       db.current_revision(engine) == HEAD)
    ok("after it was copied aside", (rec11 / "library.sqlite.bak-0002").exists())
    with engine.connect() as c:
        drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
        counts = {t: c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                  for t in ("take", "take_file", "marker", "cloud_copy")}
        starred = c.execute(text(
            "SELECT starred FROM take ORDER BY take_number")).scalars().all()
    engine.dispose()
    ok("and it is then what models.py describes", drift == [])
    ok("every take keeps its files, its marks and its cloud copy",
       counts == {"take": 3, "take_file": 3, "marker": 3, "cloud_copy": 3})
    ok("nothing is starred for it, good marks or not", starred == [0, 0, 0])

    lib = Library(rec11)
    jam = rec11 / "Jam"

    def stars(folder):
        return [t["starred"] for t in lib.rehearsal(folder)["takes"]]

    ok("every take says whether it is starred", stars(jam) == [False, False, False])
    one = lib.set_starred(jam, 1, True)
    two = lib.set_starred(jam, 2, True)
    ok("a star goes on a take, and a song can have several",
       one["starred"] and two["starred"] and stars(jam) == [True, True, False])
    ok("a take with no song can have one", lib.set_starred(jam, 3, True)["starred"])
    ok("and it comes off, touching no other take",
       lib.set_starred(jam, 2, False)["starred"] is False
       and stars(jam) == [True, False, True])
    ok("set twice is still set, not toggled back",
       lib.set_starred(jam, 1, True)["starred"] and stars(jam)[0] is True)
    ok("a take that is not there is None", lib.set_starred(jam, 9, True) is None)
    renamed = lib.update_take(jam, 1, name="Take 1")
    ok("the star stays with its take through a rename, to no song at all",
       renamed["song"] is None and renamed["starred"])
    ok("and the take keeps its marks",
       lib.take(jam, 1)["markers"] == [{"at": 1.0, "label_id": 2, "note": ""}])
    lib.delete_take(jam, 3)
    ok("a deleted take takes its star with it",
       [(t["take_number"], t["starred"]) for t in lib.rehearsal(jam)["takes"]]
       == [(1, True), (2, False)])
    lib.close()

    print("\n[12] Labels (migration 0004)")
    rec12 = tmp / "Labels"
    rec12.mkdir()
    db.open_engine(rec12, migrations_up_to(tmp, "0003")).dispose()
    engine = db.make_engine(db.database_path(rec12))
    with engine.begin() as c:
        rid = c.execute(text(
            "INSERT INTO rehearsal (folder, name, created_at, samplerate, bit_depth) "
            "VALUES ('Jam', 'Jam', '2026-09-01T19:00:00', 48000, 24)")).lastrowid
        for number, kind in ((1, "note"), (2, "good"), (3, "issue"), (4, "redo")):
            tid = c.execute(text(
                "INSERT INTO take (rehearsal_id, take_number, duration_sec, cloud_skip, "
                "cloud_send, starred) VALUES (:r, :n, 10.0, 0, 0, 0)"),
                {"r": rid, "n": number}).lastrowid
            c.execute(text("INSERT INTO take_file (take_id, position, name, file) "
                           "VALUES (:t, 0, 'Gtr', :f)"),
                      {"t": tid, "f": f"{number:02d}/Gtr.wav"})
            c.execute(text("INSERT INTO marker (take_id, at, kind, note) "
                           "VALUES (:t, 1.0, :k, :n)"),
                      {"t": tid, "k": kind, "n": f"a {kind} mark"})
            c.execute(text("INSERT INTO cloud_copy (take_id, mix, source) "
                           "VALUES (:t, :m, '{}')"), {"t": tid, "m": f"Jam/{number:02d}.wav"})
    engine.dispose()

    engine = db.open_engine(rec12)
    ok("a database at 0003 is moved on to the newest migration",
       db.current_revision(engine) == HEAD)
    ok("after it was copied aside", (rec12 / "library.sqlite.bak-0003").exists())
    with engine.connect() as c:
        drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
        counts = {t: c.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
                  for t in ("take", "take_file", "marker", "cloud_copy")}
        labels12 = [tuple(r) for r in c.execute(text(
            "SELECT id, name, colour, position FROM label ORDER BY position"))]
        marks12 = [tuple(r) for r in c.execute(text(
            "SELECT take.take_number, marker.label_id, marker.note FROM marker "
            "JOIN take ON take.id = marker.take_id ORDER BY take.take_number"))]
        columns = [col["name"] for col in inspect(c).get_columns("marker")]
    engine.dispose()
    ok("and it is then what models.py describes", drift == [])
    ok("every take keeps its files, its marks and its cloud copy",
       counts == {"take": 4, "take_file": 4, "marker": 4, "cloud_copy": 4})
    ok("the four kinds are the first four labels, in their order and colours",
       labels12 == [(1, "Note", "grey", 0), (2, "Keep this", "green", 1),
                    (3, "Went wrong", "red", 2), (4, "Do again", "amber", 3)])
    ok("every mark is on its kind's label, its comment kept",
       marks12 == [(1, 1, "a note mark"), (2, 2, "a good mark"),
                   (3, 3, "a issue mark"), (4, 4, "a redo mark")])
    ok("and the kind column is gone", "kind" not in columns and "label_id" in columns)

    lib = Library(rec12)
    jam = rec12 / "Jam"

    def order12():
        return [lb["id"] for lb in lib.labels()]

    def positions12():
        with lib._engine.connect() as c:
            return c.execute(text("SELECT position FROM label ORDER BY position")).scalars().all()

    def refused(fn, *args):
        try:
            fn(*args)
        except LabelRefused as e:
            return str(e)
        return None

    ok("the labels come in order, each with how many marks have it",
       [(lb["id"], lb["name"], lb["colour"], lb["marks"]) for lb in lib.labels()]
       == [(1, "Note", "grey", 1), (2, "Keep this", "green", 1),
           (3, "Went wrong", "red", 1), (4, "Do again", "amber", 1)])
    ok("a take's marks carry their label",
       lib.take(jam, 2)["markers"] == [{"at": 1.0, "label_id": 2, "note": "a good mark"}])

    added = lib.add_label("Solo", "violet")
    ok("a label is added at the end, with no marks yet",
       [lb["name"] for lb in added] == ["Note", "Keep this", "Went wrong", "Do again", "Solo"]
       and added[-1]["colour"] == "violet" and added[-1]["marks"] == 0)
    solo = added[-1]["id"]
    long12 = lib.add_label("  " + "x" * 50 + "  ", "blue")[-1]
    ok("a name is trimmed and cut at 40 characters", long12["name"] == "x" * 40)
    ok("a label no mark has is deleted at once",
       long12["id"] not in [lb["id"] for lb in lib.delete_label(long12["id"])])

    ok("an empty name is refused",
       refused(lib.add_label, "   ", "grey") == "A label needs a name")
    ok("a name another label has is refused, whatever its case",
       refused(lib.add_label, "keep THIS", "grey") == "There is already a label called Keep this")
    russian = lib.add_label("Соло", "pink")[-1]["id"]
    ok("Cyrillic included",
       refused(lib.add_label, "соло", "grey") == "There is already a label called Соло")
    ok("a colour not in the palette is refused",
       refused(lib.add_label, "Tempo", "orange") == "Pick a colour from the palette")

    ok("a label is renamed",
       next(lb for lb in lib.rename_label(solo, "Riff") if lb["id"] == solo)["name"] == "Riff")
    ok("into another case of its own name too",
       next(lb for lb in lib.rename_label(solo, "RIFF") if lb["id"] == solo)["name"] == "RIFF")
    ok("but not into another label's name",
       refused(lib.rename_label, solo, "note") == "There is already a label called Note")
    ok("nor into nothing", refused(lib.rename_label, solo, " ") == "A label needs a name")
    ok("a label that is not there is not found",
       refused(lib.rename_label, 99, "X") == "Label not found")
    lib.rename_label(3, "Wrong")
    ok("a rename leaves the marks where they are",
       lib.take(jam, 3)["markers"] == [{"at": 1.0, "label_id": 3, "note": "a issue mark"}])

    ok("a label is recoloured, and two may share a colour",
       [lb["colour"] for lb in lib.recolour_label(3, "pink") if lb["id"] in (3, russian)]
       == ["pink", "pink"])
    ok("only into the palette's colours",
       refused(lib.recolour_label, 3, "#ff0000") == "Pick a colour from the palette")

    lib.move_label(4, 0)
    ok("a label moves to another place, the rest closing up",
       order12() == [4, 1, 2, 3, solo, russian])
    lib.move_label(4, 99)
    ok("a place past the end is the end", order12() == [1, 2, 3, solo, russian, 4])
    lib.move_label(2, 0)
    ok("and the places stay 0, 1, 2 with no gaps",
       order12() == [2, 1, 3, solo, russian, 4] and positions12() == [0, 1, 2, 3, 4, 5])

    ok("a label in use is not deleted without saying where its marks go",
       refused(lib.delete_label, 4) == "Say which label the marks of Do again get")
    ok("nor onto itself",
       refused(lib.delete_label, 4, 4) == "Their marks need another label to go to")
    ok("nor onto a label that is not there",
       refused(lib.delete_label, 4, 99) == "Their marks need another label to go to")
    after12 = lib.delete_label(4, 3)
    ok("deleted, its marks go to the label chosen",
       4 not in [lb["id"] for lb in after12]
       and lib.take(jam, 4)["markers"] == [{"at": 1.0, "label_id": 3, "note": "a redo mark"}]
       and next(lb for lb in after12 if lb["id"] == 3)["marks"] == 2
       and positions12() == [0, 1, 2, 3, 4])

    # A delete that fails after its marks were moved must move none of them.
    # It is the trigger's own error that must stop it: a refusal before the
    # marks were touched would leave them in place too, and prove nothing.
    with lib._engine.begin() as c:
        c.execute(text("CREATE TRIGGER keep_labels BEFORE DELETE ON label "
                       "BEGIN SELECT RAISE(ABORT, 'kept'); END"))
    try:
        lib.delete_label(3, 1)
        failed12 = None
    except Exception as e:
        failed12 = str(getattr(e, "orig", e))
    with lib._engine.begin() as c:
        c.execute(text("DROP TRIGGER keep_labels"))
    ok("moving the marks and deleting the label are one transaction",
       failed12 == "kept" and 3 in order12()
       and lib.take(jam, 3)["markers"][0]["label_id"] == 3
       and lib.take(jam, 4)["markers"][0]["label_id"] == 3)

    lib.delete_label(russian)
    tempo = lib.add_label("Tempo", "blue")[-1]["id"]
    ok("an id is never given to a second label", tempo > russian)

    kept12 = lib.edit_markers(jam, 1, lambda ms: ms + [
        {"at": 2.0, "note": "no label"}, {"at": 3.0, "label_id": 99, "note": ""}])
    ok("a mark with no label, or one that is not there, gets the first label",
       [m["label_id"] for m in kept12] == [1, 2, 2])

    old12 = rec12 / "Old - 2026-08-01 19-00"
    old12.mkdir()
    (old12 / "session.json").write_text(json.dumps({
        "name": "Old", "created_at": "2026-08-01T19:00:00", "samplerate": 48000,
        "tracks": [{"name": "Gtr", "channel": 1}],
        "takes": [{"take_number": 1, "name": "Take 1", "duration_sec": 10.0, "tracks": [],
                   "markers": [{"at": 1.0, "kind": "issue", "note": "late"},
                               {"at": 2.0, "note": "plain"}, 3.0,
                               {"at": 4.0, "kind": "redo", "note": "again"},
                               {"at": 5.0, "kind": "nonsense", "note": ""}]}],
    }), encoding="utf-8")
    import_all(lib, None)
    ok("an old session.json's marks get the label their kind became, or the plain one",
       [(m["at"], m["label_id"]) for m in lib.take(old12, 1)["markers"]]
       == [(1.0, 3), (2.0, 1), (3.0, 1), (4.0, 2), (5.0, 1)])
    ok("and a kind whose label is gone gets the first label, not one made since",
       lib.take(old12, 1)["markers"][3]["label_id"] != tempo)

    first12 = order12()[0]
    for lb in lib.labels()[1:]:
        lib.delete_label(lb["id"], first12)
    ok("the last label is not deleted",
       refused(lib.delete_label, first12)
       == "The last label cannot be deleted: every mark needs one"
       and order12() == [first12])
    lib.close()

    print("\n[13] Renaming and merging songs (migration 0005)")
    rec13 = tmp / "Renaming"
    rec13.mkdir()
    db.open_engine(rec13, migrations_up_to(tmp, "0004")).dispose()
    engine = db.open_engine(rec13)
    ok("a database at 0004 is moved on to the newest migration",
       db.current_revision(engine) == HEAD)
    with engine.connect() as c:
        drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
        tables13 = inspect(c).get_table_names()
    engine.dispose()
    ok("and it is then what models.py describes, with a table of old names",
       drift == [] and "song_name" in tables13)

    lib = Library(rec13)

    def night13(name, created, titles, stars=()):
        folder = rec13 / name
        lib.create_rehearsal(folder, name, created, 48000, 24, [])
        for n, title in enumerate(titles, start=1):
            lib.add_take(folder, {"take_number": n, "name": title, "tracks": []})
            if n in stars:
                lib.set_starred(folder, n, True)
        return folder

    def names13(folder):
        return [t["name"] for t in lib.rehearsal(folder)["takes"]]

    def starred13(folder):
        return [t["take_number"] for t in lib.rehearsal(folder)["takes"] if t["starred"]]

    def refused13(fn, *args):
        try:
            fn(*args)
        except SongRefused as e:
            return str(e), e.into
        return None

    def counts13(answer):
        return {k: answer[k] for k in ("from", "into", "goes", "rehearsals", "first", "last")}

    one13 = night13("One", "2026-09-01T19:00:00", ["Pałyn"] * 4 + ["Polyn"])
    two13 = night13("Two", "2026-09-08T19:00:00", ["Pałyn"] * 3 + ["Polyn", "Polyn"], stars=(3,))
    three13 = night13("Three", "2026-09-15T19:00:00", ["Palyn", "Palyn", "Viasna"], stars=(2,))
    polyn13 = lib.song_id("Polyn")

    renamed13 = lib.rename_song(polyn13, "Polin")
    ok("a song renamed: every go carries the new title and keeps its number",
       names13(one13)[4] == "Polin 1" and names13(two13)[3:] == ["Polin 2", "Polin 3"])
    ok("it says which takes changed, oldest first, with their names now",
       renamed13 == {"from": "Polyn", "title": "Polin", "takes": [
           (str(one13), 5, "Polin 1"), (str(two13), 4, "Polin 2"), (str(two13), 5, "Polin 3")]})
    ok("and the title it left is remembered", lib.song_names() == {"Polin": ["Polyn"]})
    ok("typed again, the old title is the song at its next go, alone or with a number",
       lib.resolve_name(three13, "polyn", 9) == {"song": "Polin", "go": 4, "name": "Polin 4"}
       and lib.resolve_name(three13, "Polyn 9", 9) == {"song": "Polin", "go": 4, "name": "Polin 4"})
    lib.rename_song(polyn13, "polin")
    ok("a case-only rename respells the song and remembers nothing more",
       names13(one13)[4] == "polin 1" and lib.song_names() == {"polin": ["Polyn"]})
    ok("the same title again changes nothing", lib.rename_song(polyn13, "polin")["takes"] == [])

    viasna13 = lib.song_id("Viasna")
    ok("an empty title is refused",
       refused13(lib.rename_song, polyn13, "  ") == ("A song needs a title", None))
    ok("so is Take N, what a take with no song is called",
       refused13(lib.rename_song, polyn13, "Take 4")
       == ("Take 4 is what a take with no song is called", None))
    ok("another song's title is refused, naming the song to merge into",
       refused13(lib.rename_song, polyn13, "viasna")
       == ("There is already a song called Viasna", {"id": viasna13, "title": "Viasna"}))
    ok("so is another song's old name",
       refused13(lib.rename_song, viasna13, "POLYN")
       == ("POLYN is polin now", {"id": polyn13, "title": "polin"}))
    ok("a song that is not there is not found",
       refused13(lib.rename_song, 999, "X") == ("Song not found", None))

    target13 = lib.song_id("Pałyn")
    palyn13 = lib.song_id("Palyn")
    asked13 = lib.merge_songs(palyn13, target13, dry_run=True)
    ok("a dry run counts what a merge would do",
       counts13(asked13) == {"from": "Palyn", "into": "Pałyn", "goes": 2, "rehearsals": 1,
                             "first": 8, "last": 9})
    ok("and changes nothing",
       names13(three13)[:2] == ["Palyn 1", "Palyn 2"] and lib.song_id("Palyn") == palyn13
       and lib.song_names() == {"polin": ["Polyn"]})
    merged13 = lib.merge_songs(palyn13, target13)
    ok("merged goes are numbered after the song's own, in the order played",
       names13(three13)[:2] == ["Pałyn 8", "Pałyn 9"]
       and names13(one13)[:4] == ["Pałyn 1", "Pałyn 2", "Pałyn 3", "Pałyn 4"]
       and names13(two13)[:3] == ["Pałyn 5", "Pałyn 6", "Pałyn 7"])
    ok("it says what it did, and which takes changed",
       counts13(merged13) == counts13(asked13)
       and merged13["takes"] == [(str(three13), 1, "Pałyn 8"), (str(three13), 2, "Pałyn 9")])
    ok("every star stays on its take", starred13(two13) == [3] and starred13(three13) == [2])
    ok("the song merged away is gone, and its title is the other's old name",
       lib.song_id("Palyn") is None and lib.song_names() == {"Pałyn": ["Palyn"], "polin": ["Polyn"]})
    ok("typed again, it is the next go of the song it went to",
       lib.resolve_name(three13, "palyn", 9) == {"song": "Pałyn", "go": 10, "name": "Pałyn 10"})
    ok("a song is not merged into itself",
       refused13(lib.merge_songs, target13, target13)
       == ("A song cannot be merged into itself", None))
    ok("nor into a song that is not there",
       refused13(lib.merge_songs, target13, 999) == ("Song not found", None))

    lib.merge_songs(polyn13, target13)
    ok("old names follow a merge: the merged song's title and its own old names",
       lib.song_names() == {"Pałyn": ["Palyn", "polin", "Polyn"]}
       and names13(one13)[4] == "Pałyn 10" and names13(two13)[3:] == ["Pałyn 11", "Pałyn 12"])
    lib.rename_song(target13, "Palyn")
    ok("renamed back to an old name, the song takes it as its title and remembers the one it had",
       lib.song_names() == {"Palyn": ["Pałyn", "polin", "Polyn"]}
       and names13(three13)[:2] == ["Palyn 8", "Palyn 9"]
       and lib.resolve_name(three13, "Pałyn", 9)["song"] == "Palyn")
    summary13 = next(s for s in lib.songs()["songs"] if s["title"] == "Palyn")
    ok("the songs and a song's page carry its old names",
       summary13["also"] == ["Pałyn", "polin", "Polyn"]
       and lib.goes_of(target13)["also"] == ["Pałyn", "polin", "Polyn"]
       and next(s for s in lib.songs()["songs"] if s["title"] == "Viasna")["also"] == [])

    old13 = rec13 / "Old - 2020-01-01 10-00"
    old13.mkdir()
    (old13 / "session.json").write_text(json.dumps({
        "name": "Old", "created_at": "2020-01-01T10:00:00", "samplerate": 48000,
        "tracks": [], "takes": [{"take_number": n, "name": name, "tracks": []}
                                for n, name in enumerate(["polyn", "Polyn 2"], start=1)],
    }), encoding="utf-8")
    import_all(lib, None)
    ok("an old rehearsal imported names its takes through old names too",
       names13(old13) == ["Palyn 13", "Palyn 14"])

    ok("an old name is forgotten", lib.forget_song_name("POLIN") is True)
    ok("typed again, it is then a new song",
       lib.resolve_name(three13, "polin", 9) == {"song": "polin", "go": 1, "name": "polin 1"}
       and lib.song_names() == {"Palyn": ["Pałyn", "Polyn"]})
    ok("a name no song was called is not forgotten twice",
       lib.forget_song_name("polin") is False)
    lib.close()

    print("\n[14] Sets (migration 0006)")
    rec14 = tmp / "Sets"
    rec14.mkdir()
    db.open_engine(rec14, migrations_up_to(tmp, "0005")).dispose()
    engine = db.open_engine(rec14)
    ok("a database at 0005 is moved on to the newest migration",
       db.current_revision(engine) == HEAD)
    with engine.connect() as c:
        drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
        tables14 = inspect(c).get_table_names()
        rehearsal_cols14 = {col["name"] for col in inspect(c).get_columns("rehearsal")}
    engine.dispose()
    ok("and it is then what models.py describes, with a table of sets",
       drift == [] and "song_set" in tables14)
    ok("and a rehearsal can keep a copy of its set",
       {"set_name", "set_songs"} <= rehearsal_cols14)

    lib = Library(rec14)

    def night14(name, created, titles, set_copy=None):
        folder = rec14 / name
        lib.create_rehearsal(folder, name, created, 48000, 24, [], set_copy=set_copy)
        for n, title in enumerate(titles, start=1):
            lib.add_take(folder, {"take_number": n, "name": title, "tracks": []})
        return folder

    def refused14(fn, *args, **kwargs):
        try:
            fn(*args, **kwargs)
        except SetRefused as e:
            return str(e)
        return None

    def songs14(answer, set_id):
        found = next((s for s in answer if s["id"] == set_id), None)
        return None if found is None else [(x["title"], x["new"]) for x in found["songs"]]

    night14("Monday", "2026-09-01T19:00:00", ["Polyn", "Vesna", "Doroga"])
    ok("there are no sets to begin with", lib.sets() == [])
    sets14 = lib.add_set(" Gig ", ["Polyn", "vesna", "Polyn", " ", "Novaja"])
    gig14 = sets14[0]["id"]
    ok("a set is a name and songs in order, by their titles",
       len(sets14) == 1 and sets14[0]["name"] == "Gig"
       and songs14(sets14, gig14) == [("Polyn", False), ("Vesna", False), ("Novaja", True)])
    ok("a set with the same name in another case is refused",
       refused14(lib.add_set, "gig", []) == "There is already a set called Gig")
    ok("a set needs a name", refused14(lib.add_set, "  ", ["Polyn"]) == "A set needs a name")
    ok("a long name is cut as a label's is",
       lib.add_set("x" * 60, [])[-1]["name"] == "x" * 40)
    long14 = lib.sets()[-1]["id"]
    ok("sets come back in the order they were made",
       [s["name"] for s in lib.sets()] == ["Gig", "x" * 40])

    sets14 = lib.update_set(gig14, name="Gig on the 25th")
    ok("a set is renamed and keeps its songs",
       sets14[0]["name"] == "Gig on the 25th"
       and songs14(sets14, gig14) == [("Polyn", False), ("Vesna", False), ("Novaja", True)])
    sets14 = lib.update_set(gig14, songs=["Doroga", "Polyn", "Doroga"])
    ok("its songs are replaced and keep their name",
       sets14[0]["name"] == "Gig on the 25th"
       and songs14(sets14, gig14) == [("Doroga", False), ("Polyn", False)])
    ok("a rename to another set's name is refused",
       refused14(lib.update_set, gig14, name="X" * 40) == f"There is already a set called {'x' * 40}")
    ok("a set that is not there is refused",
       refused14(lib.update_set, 999, name="Nope") == "Set not found")

    polyn14 = lib.song_id("Polyn")
    lib.rename_song(polyn14, "Palyn")
    ok("a song renamed after shows under its new title",
       songs14(lib.sets(), gig14) == [("Doroga", False), ("Palyn", False)])
    lib.merge_songs(lib.song_id("Doroga"), lib.song_id("Vesna"))
    ok("a song merged away shows as the song it went into",
       songs14(lib.sets(), gig14) == [("Vesna", False), ("Palyn", False)])
    lib.update_set(gig14, songs=["Vesna", "Palyn", "Novaja"])

    copy14 = lib.set_of(gig14)
    ok("a set's copy is its name and titles", copy14 == {
        "name": "Gig on the 25th", "songs": ["Vesna", "Palyn", "Novaja"]})
    ok("a set that is not there has no copy", lib.set_of(999) is None)
    tue14 = night14("Tuesday", "2026-09-02T19:00:00", ["Palyn"], set_copy=copy14)
    ok("a rehearsal keeps the copy of its set",
       lib.rehearsal(tue14)["set"] == {"name": "Gig on the 25th", "songs": [
           {"title": "Vesna", "new": False}, {"title": "Palyn", "new": False},
           {"title": "Novaja", "new": True}]})
    lib.update_set(gig14, name="Another gig", songs=["Vesna"])
    ok("changing the set later leaves the rehearsal's copy",
       lib.rehearsal(tue14)["set"]["name"] == "Gig on the 25th"
       and len(lib.rehearsal(tue14)["set"]["songs"]) == 3)
    ok("a rehearsal played freely has no set",
       lib.rehearsal(rec14 / "Monday")["set"] is None)
    ok("every rehearsal says its set in the list",
       {r["name"]: (r["set"] or {}).get("name") for r in lib.rehearsals()}
       == {"Monday": None, "Tuesday": "Gig on the 25th"})

    sets14 = lib.delete_set(gig14)
    ok("a set is deleted", [s["id"] for s in sets14] == [long14])
    ok("deleting it leaves the rehearsal's copy",
       lib.rehearsal(tue14)["set"]["name"] == "Gig on the 25th")
    ok("a set that is not there cannot be deleted",
       refused14(lib.delete_set, gig14) == "Set not found")
    lib.delete_set(long14)
    fresh14 = lib.add_set("Fresh", [])
    ok("an id is never given twice", fresh14[0]["id"] > long14)
    ok("positions close up", [s["name"] for s in fresh14] == ["Fresh"])

    # Two songs of one set merged into each other are one song, in it once.
    night14("Wednesday", "2026-09-03T19:00:00", ["Sonca", "Dym", "Opus"])
    twins14 = lib.add_set("Twins", ["Sonca", "Vesna", "Dym"])
    twin14 = next(s["id"] for s in twins14 if s["name"] == "Twins")
    twin_copy14 = lib.set_of(twin14)
    thu14 = night14("Thursday", "2026-09-04T19:00:00", [], set_copy=twin_copy14)
    lib.merge_songs(lib.song_id("Sonca"), lib.song_id("Dym"))
    ok("two songs of a set merged into one are in it once, where the first was",
       songs14(lib.sets(), twin14) == [("Dym", False), ("Vesna", False)])
    ok("and in a rehearsal's copy of it too",
       [s["title"] for s in lib.rehearsal(thu14)["set"]["songs"]] == ["Dym", "Vesna"])
    # A title with a go after it is the song, as typed in a name field.
    opus14 = lib.add_set("Opus night", ["Opus 5", "Opus 9 live"])
    opus_id14 = next(s["id"] for s in opus14 if s["name"] == "Opus night")
    ok("a set's title with a go after it is the song, as a typed name is",
       songs14(lib.sets(), opus_id14) == [("Opus", False), ("Opus 9 live", True)])
    lib.close()

    print("\n[15] Migration 0006 keeps every take, down and up again")
    rec15 = tmp / "Sets down"
    rec15.mkdir()
    lib = Library(rec15)
    folder15 = rec15 / "Monday"
    lib.create_rehearsal(folder15, "Monday", "2026-09-01T19:00:00", 48000, 24, [])
    for n, title in enumerate(["Polyn", "Vesna"], start=1):
        lib.add_take(folder15, {"take_number": n, "name": title, "tracks": []})
    lib.close()

    def counts15():
        engine = db.make_engine(db.database_path(rec15))
        with engine.connect() as c:
            out = (c.execute(text("SELECT count(*) FROM rehearsal")).scalar(),
                   c.execute(text("SELECT count(*) FROM take")).scalar())
        engine.dispose()
        return out

    engine = db.make_engine(db.database_path(rec15))
    with engine.begin() as c:
        command.downgrade(db.alembic_config(c), "0005")
    engine.dispose()
    ok("going back to 0005 keeps every rehearsal and take", counts15() == (1, 2))
    db.open_engine(rec15).dispose()
    ok("and coming back to the newest keeps them too", counts15() == (1, 2))

    print("\n[16] MIDI tracks and notes files (migration 0007)")
    # A track records audio, both or MIDI (docs/superpowers/specs/
    # 2026-10-08-midi-recording-design.md, Part 1). A .mid is a take_file of
    # its own kind, kept apart from the WAVs, so nothing that plays or mixes a
    # take's `tracks` ever opens one.
    rec16 = tmp / "Midi"
    rec16.mkdir()
    db.open_engine(rec16, migrations_up_to(tmp, "0006")).dispose()
    engine = db.make_engine(db.database_path(rec16))
    with engine.begin() as c:
        rid = c.execute(text(
            "INSERT INTO rehearsal (folder, name, created_at, samplerate, bit_depth) "
            "VALUES ('Jam', 'Jam', '2026-09-01T19:00:00', 48000, 24)")).lastrowid
        for position, (name, channel) in enumerate((("Gtr", 1), ("Bass", 2))):
            c.execute(text("INSERT INTO track (rehearsal_id, position, name, channel) "
                           "VALUES (:r, :p, :n, :c)"),
                      {"r": rid, "p": position, "n": name, "c": channel})
        tid = c.execute(text(
            "INSERT INTO take (rehearsal_id, take_number, duration_sec, cloud_skip, cloud_send) "
            "VALUES (:r, 1, 4.0, 0, 0)"), {"r": rid}).lastrowid
        for position, name in enumerate(("Gtr", "Bass")):
            c.execute(text("INSERT INTO take_file (take_id, position, name, file) "
                           "VALUES (:t, :p, :n, :f)"),
                      {"t": tid, "p": position, "n": name, "f": f"01/{name}.wav"})
        c.execute(text("INSERT INTO marker (take_id, at, label_id, note) "
                       "VALUES (:t, 1.5, 2, 'keep')"), {"t": tid})
        c.execute(text("INSERT INTO cloud_copy (take_id, mix, source) "
                       "VALUES (:t, 'Jam/01.wav', '{}')"), {"t": tid})
    engine.dispose()

    def rows16(sql):
        engine = db.make_engine(db.database_path(rec16))
        with engine.connect() as c:
            out = [tuple(r) for r in c.execute(text(sql)).all()]
        engine.dispose()
        return out

    def shape16():
        """What models.py is compared with, and the index `track` must keep,
        read from the file as it is now."""
        engine = db.make_engine(db.database_path(rec16))
        with engine.connect() as c:
            drift = compare_metadata(MigrationContext.configure(c), Base.metadata)
            indexes = {i["name"] for i in inspect(c).get_indexes("track")}
        engine.dispose()
        return drift, indexes

    def files16(number):
        return rows16(
            "SELECT f.kind, f.name, f.position FROM take_file f JOIN take t ON t.id = f.take_id "
            "JOIN rehearsal r ON r.id = t.rehearsal_id "
            f"WHERE r.folder = 'Tuesday' AND t.take_number = {number} ORDER BY f.position")

    print("  a library from before")
    engine = db.open_engine(rec16)
    ok("a database at 0006 is moved on to the newest migration",
       db.current_revision(engine) == HEAD)
    ok("after it was copied aside", (rec16 / "library.sqlite.bak-0006").exists())
    engine.dispose()
    drift16, indexes16 = shape16()
    ok("and it is then what models.py describes", drift16 == [])
    ok("a track keeps its place under its rehearsal", "ix_track_rehearsal_id" in indexes16)
    ok("every track reads as audio, on the input it had",
       rows16("SELECT name, channel, mode, midi_port FROM track ORDER BY position")
       == [("Gtr", 1, "audio", None), ("Bass", 2, "audio", None)])
    ok("every file reads as audio",
       rows16("SELECT name, kind FROM take_file ORDER BY position")
       == [("Gtr", "audio"), ("Bass", "audio")])
    ok("the take, both files, the marker and the cloud copy are all still there",
       rows16("SELECT (SELECT COUNT(*) FROM take), (SELECT COUNT(*) FROM take_file), "
              "(SELECT COUNT(*) FROM marker), (SELECT COUNT(*) FROM cloud_copy)")
       == [(1, 2, 1, 1)])
    lib = Library(rec16)
    old16 = lib.rehearsal(rec16 / "Jam")
    ok("the library reads the tracks as audio, with a port for none",
       old16["tracks"] == [{"name": "Gtr", "channel": 1, "mode": "audio", "midi_port": None},
                           {"name": "Bass", "channel": 2, "mode": "audio", "midi_port": None}])
    ok("and the take as it was, with no notes and none missing",
       [t["name"] for t in old16["takes"][0]["tracks"]] == ["Gtr", "Bass"]
       and old16["takes"][0]["notes"] == [] and old16["takes"][0]["notes_missing"] == []
       and old16["takes"][0]["markers"] == [{"at": 1.5, "label_id": 2, "note": "keep"}])

    print("  notes files beside the audio")
    night16 = rec16 / "Tuesday"
    band16 = [
        {"name": "Drums", "channel": 1, "mode": "both", "midi_port": {"name": "TD-17"}},
        {"name": "Bass", "channel": 3},
        {"name": "Keys", "channel": None, "mode": "midi",
         "midi_port": {"name": "Launchkey Mini MK3"}},
    ]
    lib.create_rehearsal(night16, "Tuesday", "2026-09-02T19:00:00", 48000, 24, band16)
    ok("a rehearsal keeps each track's mode and the name of its port, in band order",
       lib.rehearsal(night16)["tracks"] == [
           {"name": "Drums", "channel": 1, "mode": "both", "midi_port": "TD-17"},
           {"name": "Bass", "channel": 3, "mode": "audio", "midi_port": None},
           {"name": "Keys", "channel": None, "mode": "midi", "midi_port": "Launchkey Mini MK3"}])

    def made16(tracks, how="create"):
        """Whether a rehearsal with these tracks was made. Only what the store
        raises for a track with no input (int() of a channel that is None or
        not there) counts as refused; one that is made is forgotten again."""
        folder = rec16 / "Refused"
        try:
            if how == "create":
                lib.create_rehearsal(folder, "Refused", "2026-09-03T19:00:00", 48000, 24, tracks)
            else:
                lib.import_rehearsal(folder, name="Refused", created_at="2026-09-03T19:00:00",
                                     samplerate=48000, bit_depth=24, tracks=tracks, takes=[],
                                     cloud={}, cloud_errors={}, cloud_dir=None)
        except (KeyError, TypeError):
            return False
        lib.forget_rehearsal(folder)
        return True

    ok("the same helper makes a band whose one track records only MIDI, with no input",
       made16([{"name": "Keys", "channel": None, "mode": "midi",
                "midi_port": {"name": "Launchkey Mini MK3"}}]) is True
       and made16([{"name": "Keys", "mode": "midi"}], "import") is True)

    ok("a track that records audio needs an input, as it always did",
       made16([{"name": "Gtr", "channel": None}]) is False
       and made16([{"name": "Gtr"}]) is False
       and made16([{"name": "Drums", "mode": "both", "channel": None,
                    "midi_port": {"name": "TD-17"}}]) is False)
    ok("and so does one that is imported",
       made16([{"name": "Gtr", "channel": None}], "import") is False
       and made16([{"name": "Drums", "mode": "both"}], "import") is False)
    ok("none of them left a rehearsal behind", lib.has(rec16 / "Refused") is False)
    here16 = night16 / "01 - Polyn 1"
    wavs16 = [{"name": "Drums", "file": str(here16 / "Drums.wav")},
              {"name": "Bass", "file": str(here16 / "Bass.wav")}]
    mid16 = {"name": "Drums", "file": str(here16 / "Drums.mid")}
    take16 = lib.add_take(night16, {"take_number": 1, "name": "Polyn", "duration_sec": 4.0,
                                    "tracks": wavs16, "notes": [mid16],
                                    "markers": [{"at": 1.0, "label_id": 1, "note": ""}]})
    ok("a take's tracks are its audio files and nothing else",
       [t["name"] for t in take16["tracks"]] == ["Drums", "Bass"]
       and all(t["file"].endswith(".wav") for t in take16["tracks"]))
    ok("its notes files are a list of their own, each with its port and the lane it follows",
       take16["notes"] == [{"name": "Drums", "file": str(here16 / "Drums.mid"),
                            "port": "TD-17", "after": "Drums", "place": 0}])
    ok("a notes track with no .mid in the take is missing, and follows the lane before it",
       take16["notes_missing"] == [{"name": "Keys", "port": "Launchkey Mini MK3",
                                    "after": "Bass", "place": 2}])
    ok("each notes file and each missing track carries its track's place in the band",
       [n.get("place") for n in take16["notes"]] == [0]
       and [m.get("place") for m in take16["notes_missing"]] == [2])
    ok("the rows are kept in one sequence, audio then notes",
       files16(1) == [("audio", "Drums", 0), ("audio", "Bass", 1), ("midi", "Drums", 2)])
    ok("reading the take again, or the whole rehearsal, says the same",
       lib.take(night16, 1) == take16 and lib.rehearsal(night16)["takes"][0] == take16)
    polyn16 = lib.goes_of(lib.song_id("Polyn"))["goes"][0]["take"]
    ok("and so does the song's page",
       polyn16["notes"] == take16["notes"] and polyn16["notes_missing"] == take16["notes_missing"])

    quiet16 = lib.add_take(night16, {"take_number": 2, "name": "Vesna", "tracks": [
        {"name": "Bass", "file": str(night16 / "02" / "Bass.wav")}]})
    ok("a take with no notes lists none, and every notes track as missing",
       quiet16["notes"] == [] and quiet16["notes_missing"] == [
           {"name": "Drums", "port": "TD-17", "after": None, "place": 0},
           {"name": "Keys", "port": "Launchkey Mini MK3", "after": "Bass", "place": 2}])
    lonely16 = lib.add_take(night16, {"take_number": 3, "name": "Doroga", "tracks": [],
                                      "notes": [{"name": "Keys", "file": str(night16 / "03" / "Keys.mid")}]})
    ok("a take with notes and no audio puts the lane first when no audio lane is before it",
       lonely16["tracks"] == [] and lonely16["notes"] == [
           {"name": "Keys", "file": str(night16 / "03" / "Keys.mid"),
            "port": "Launchkey Mini MK3", "after": None, "place": 2}]
       and [m["name"] for m in lonely16["notes_missing"]] == ["Drums"])
    ok("a missing track keeps its place whatever came before it, and a lane that goes first too",
       [m.get("place") for m in quiet16["notes_missing"]] == [0, 2]
       and [n.get("place") for n in lonely16["notes"]] == [2]
       and [m.get("place") for m in lonely16["notes_missing"]] == [0])
    plain16 = lib.add_take(night16, {"take_number": 4, "name": "Sonca", "tracks": [
        {"name": "Bass", "file": str(night16 / "04" / "Bass.wav")}]})
    ok("a take added the old way, with no notes key, is audio and nothing else",
       [t["name"] for t in plain16["tracks"]] == ["Bass"] and plain16["notes"] == []
       and files16(4) == [("audio", "Bass", 0)])

    print("  moving only what was moved")
    # Review Focus 1: renaming a take moves its files, and the audio and the
    # notes are moved by separate calls, each leaving the other kind alone.
    moved16 = night16 / "01 - Vesna 3"
    to_wav16 = [{"name": t["name"], "file": str(moved16 / Path(t["file"]).name)}
                for t in take16["tracks"]]
    after_audio16 = lib.update_take(night16, 1, tracks=to_wav16)
    ok("new paths for the audio leave the notes as they were",
       [t["file"] for t in after_audio16["tracks"]]
       == [str(moved16 / "Drums.wav"), str(moved16 / "Bass.wav")]
       and after_audio16["notes"] == take16["notes"]
       and after_audio16["notes_missing"] == take16["notes_missing"])
    after_notes16 = lib.update_take(night16, 1, notes=[
        {"name": "Drums", "file": str(moved16 / "Drums.mid")}])
    ok("new paths for the notes move only the notes",
       after_notes16["notes"] == [{"name": "Drums", "file": str(moved16 / "Drums.mid"),
                                   "port": "TD-17", "after": "Drums", "place": 0}]
       and after_notes16["tracks"] == after_audio16["tracks"])
    ok("and the rows are still one sequence",
       files16(1) == [("audio", "Drums", 0), ("audio", "Bass", 1), ("midi", "Drums", 2)])
    ok("a change that gives neither leaves both",
       lib.update_take(night16, 1, duration_sec=5.0)["notes"] == after_notes16["notes"]
       and lib.take(night16, 1)["tracks"] == after_audio16["tracks"])
    ok("an empty list of notes takes them away, and the track is missing again",
       lib.update_take(night16, 1, notes=[])["notes"] == []
       and [m["name"] for m in lib.take(night16, 1)["notes_missing"]] == ["Drums", "Keys"])
    lib.update_take(night16, 1, notes=after_notes16["notes"])
    no_audio16 = lib.update_take(night16, 1, tracks=[])
    ok("an empty list of audio takes the audio away and leaves the notes, now with no lane before",
       no_audio16["tracks"] == []
       and no_audio16["notes"] == [{"name": "Drums", "file": str(moved16 / "Drums.mid"),
                                    "port": "TD-17", "after": None, "place": 0}]
       and files16(1) == [("midi", "Drums", 0)])
    lib.update_take(night16, 1, tracks=to_wav16)
    ok("and the audio put back goes before the notes again",
       files16(1) == [("audio", "Drums", 0), ("audio", "Bass", 1), ("midi", "Drums", 2)]
       and lib.take(night16, 1)["notes"] == after_notes16["notes"])

    print("  an imported rehearsal")
    imp16 = rec16 / "Imported"
    lib.import_rehearsal(
        imp16, name="Imported", created_at="2026-08-01T19:00:00", samplerate=48000, bit_depth=24,
        tracks=[{"name": "Gtr", "channel": 1},
                {"name": "Keys", "channel": None, "mode": "midi", "midi_port": "Launchkey Mini MK3"}],
        takes=[{"take_number": 1, "name": "Take 1",
                "tracks": [{"name": "Gtr", "file": str(imp16 / "01" / "Gtr.wav")}]},
               {"take_number": 2, "name": "Take 2",
                "tracks": [{"name": "Gtr", "file": str(imp16 / "02" / "Gtr.wav")}],
                "notes": [{"name": "Keys", "file": str(imp16 / "02" / "Keys.mid")}]}],
        cloud={}, cloud_errors={}, cloud_dir=None)
    imported16 = lib.rehearsal(imp16)
    ok("an imported rehearsal keeps modes and ports too",
       imported16["tracks"] == [
           {"name": "Gtr", "channel": 1, "mode": "audio", "midi_port": None},
           {"name": "Keys", "channel": None, "mode": "midi", "midi_port": "Launchkey Mini MK3"}])
    ok("its takes are audio, with the notes track missing from one that has none",
       imported16["takes"][0]["notes"] == [] and imported16["takes"][0]["notes_missing"]
       == [{"name": "Keys", "port": "Launchkey Mini MK3", "after": "Gtr", "place": 1}])
    ok("an imported rehearsal's lanes carry their place in its band",
       [m.get("place") for m in imported16["takes"][0]["notes_missing"]] == [1]
       and [n.get("place") for n in imported16["takes"][1]["notes"]] == [1])
    ok("and the notes of one that has them kept apart",
       [t["name"] for t in imported16["takes"][1]["tracks"]] == ["Gtr"]
       and imported16["takes"][1]["notes"] == [{"name": "Keys", "file": str(imp16 / "02" / "Keys.mid"),
                                                "port": "Launchkey Mini MK3", "after": "Gtr", "place": 1}]
       and imported16["takes"][1]["notes_missing"] == [])

    print("  what goes with a take or a rehearsal")
    ok("a take's notes rows are there to be deleted",
       rows16("SELECT COUNT(*) FROM take_file WHERE file = '03/Keys.mid'") == [(1,)])
    ok("deleting the take deletes them with it",
       lib.delete_take(night16, 3) == 3
       and rows16("SELECT COUNT(*) FROM take_file WHERE file = '03/Keys.mid'") == [(0,)])
    ok("a rehearsal's MIDI tracks are there to be forgotten",
       rows16("SELECT COUNT(*) FROM track WHERE rehearsal_id = "
              "(SELECT id FROM rehearsal WHERE folder = 'Imported')") == [(2,)])
    ok("forgetting the rehearsal forgets them with it, as the rebuilt table still cascades",
       lib.forget_rehearsal(imp16) is True
       and rows16("SELECT COUNT(*) FROM track WHERE rehearsal_id NOT IN "
                  "(SELECT id FROM rehearsal)") == [(0,)]
       and rows16("SELECT COUNT(*) FROM track") == [(5,)])
    lib.set_cloud_copy(night16, 1, {"mix": str(rec16 / "cloud" / "a.wav"), "source": {}},
                       rec16 / "cloud")
    lib.close()

    print("  down to 0006 and up again")
    # What an app from before MIDI keeps: every rehearsal, take, audio file,
    # mark and cloud copy, and the tracks that had an input.
    kept16 = rows16(
        "SELECT (SELECT COUNT(*) FROM rehearsal), (SELECT COUNT(*) FROM take), "
        "(SELECT COUNT(*) FROM take_file WHERE kind = 'audio'), (SELECT COUNT(*) FROM marker), "
        "(SELECT COUNT(*) FROM cloud_copy), (SELECT COUNT(*) FROM track WHERE channel IS NOT NULL)")
    ok("there is a notes file and a MIDI track to lose, and the rest to keep",
       kept16 == [(2, 4, 6, 2, 2, 4)]
       and rows16("SELECT COUNT(*) FROM take_file WHERE kind = 'midi'") == [(1,)]
       and rows16("SELECT COUNT(*) FROM track WHERE channel IS NULL") == [(1,)])
    engine = db.make_engine(db.database_path(rec16))
    with engine.begin() as c:
        command.downgrade(db.alembic_config(c), "0006")
    engine.dispose()
    ok("going back to 0006 keeps every rehearsal, take, audio file, marker and cloud copy",
       rows16("SELECT (SELECT COUNT(*) FROM rehearsal), (SELECT COUNT(*) FROM take), "
              "(SELECT COUNT(*) FROM take_file), (SELECT COUNT(*) FROM marker), "
              "(SELECT COUNT(*) FROM cloud_copy), (SELECT COUNT(*) FROM track)") == kept16)
    ok("no .mid is left for an old app to read as a track",
       rows16("SELECT COUNT(*) FROM take_file WHERE file LIKE '%.mid'") == [(0,)])
    ok("a track that only recorded MIDI is gone and the others are tracks as before",
       rows16("SELECT name FROM track ORDER BY rehearsal_id, position")
       == [("Gtr",), ("Bass",), ("Drums",), ("Bass",)])
    ok("the tables are 0006's again, an input on every track",
       rows16("SELECT name, \"notnull\" FROM pragma_table_info('track') ORDER BY cid")
       == [("id", 1), ("rehearsal_id", 1), ("position", 1), ("name", 1), ("channel", 1)]
       and [r[0] for r in rows16("SELECT name FROM pragma_table_info('take_file') ORDER BY cid")]
       == ["id", "take_id", "position", "name", "file"])
    db.open_engine(rec16).dispose()
    drift16, indexes16 = shape16()
    ok("coming back to the newest is what models.py describes again, the index back",
       drift16 == [] and "ix_track_rehearsal_id" in indexes16)
    ok("coming back to the newest keeps them, all reading as audio",
       rows16("SELECT (SELECT COUNT(*) FROM rehearsal), (SELECT COUNT(*) FROM take), "
              "(SELECT COUNT(*) FROM take_file WHERE kind = 'audio'), (SELECT COUNT(*) FROM marker), "
              "(SELECT COUNT(*) FROM cloud_copy), (SELECT COUNT(*) FROM track WHERE mode = 'audio')")
       == kept16)
    lib = Library(rec16)
    back16 = lib.take(night16, 1)
    ok("and the library reads what is left as audio, with no notes anywhere",
       [t["name"] for t in back16["tracks"]] == ["Drums", "Bass"]
       and back16["notes"] == [] and back16["notes_missing"] == []
       and [t["mode"] for t in lib.rehearsal(night16)["tracks"]] == ["audio", "audio"])
    ok("and the track table rebuilt again still cascades from its rehearsal",
       rows16("SELECT COUNT(*) FROM track") == [(4,)]
       and lib.forget_rehearsal(night16) is True
       and rows16("SELECT COUNT(*) FROM track") == [(2,)]
       and rows16("SELECT COUNT(*) FROM track WHERE rehearsal_id NOT IN "
                  "(SELECT id FROM rehearsal)") == [(0,)])
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
