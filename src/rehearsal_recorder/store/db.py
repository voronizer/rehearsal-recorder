"""
Opening a recordings folder's database, and bringing its schema up to date.

The database sits in the recordings folder itself, as library.sqlite, so the
history travels with the recordings. Every connection turns on foreign keys
(SQLite leaves them off, and without them a deleted take would leave its
markers behind), WAL (the publishing thread writes while the interface
reads), and a busy timeout (two writers meeting wait instead of failing).

The schema is Alembic's: `open_engine` upgrades to the newest migration this
app ships, after copying the file aside, and refuses a database a newer app
has already moved past — it cannot know what that one means by its tables.
"""

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError
from sqlalchemy import create_engine, event
from sqlalchemy.engine import URL

DB_NAME = "library.sqlite"
MIGRATIONS = Path(__file__).resolve().parent / "migrations"

NEWER_DATABASE = (
    "This recordings folder was opened by a newer version of Rehearsal "
    "Recorder — update the app to use it."
)


class LibraryUnavailable(Exception):
    """The recordings folder's database cannot be used. The message is said
    to the person as it is."""


def database_path(recordings_dir):
    return Path(recordings_dir) / DB_NAME


def alembic_config(connection=None, migrations=MIGRATIONS):
    """Alembic's settings, built in code: the app has no alembic.ini of its
    own, and the migrations are found next to this file wherever the package
    was installed or bundled. `migrations` is another folder only in tests."""
    cfg = Config()
    cfg.set_main_option("script_location", str(migrations))
    if connection is not None:
        cfg.attributes["connection"] = connection
    return cfg


def make_engine(path):
    engine = create_engine(URL.create("sqlite", database=str(path)))

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record):
        # The driver's own transaction handling is switched off and SQLAlchemy
        # emits BEGIN itself (the "begin" hook below). Left to the driver, a
        # CREATE or ALTER runs outside any transaction, and a migration that
        # fails half way would leave half a schema behind. BEGIN IMMEDIATE
        # (not deferred) takes the write lock when the transaction starts, so
        # a second writer waits (busy_timeout) instead of failing with
        # SQLITE_BUSY_SNAPSHOT on a stale snapshot; the transactions are short
        # (no file work inside one), so serialising them is cheap.
        dbapi_connection.isolation_level = None
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    @event.listens_for(engine, "begin")
    def _on_begin(connection):
        connection.exec_driver_sql("BEGIN IMMEDIATE")

    return engine


def current_revision(engine):
    with engine.connect() as connection:
        return MigrationContext.configure(connection).get_current_revision()


def _backup(path, revision):
    """A copy of the database as it was before migrating, through SQLite's own
    backup so whatever is still in the WAL is in the copy too."""
    target = path.with_name(f"{path.name}.bak-{revision}")
    source = sqlite3.connect(str(path))
    try:
        copy = sqlite3.connect(str(target))
        try:
            source.backup(copy)
        finally:
            copy.close()
    finally:
        source.close()
    return target


def open_engine(recordings_dir, migrations=MIGRATIONS):
    """
    The recordings folder's database, created if there is none and upgraded
    to the newest schema. Raises LibraryUnavailable when it cannot be used;
    the file is then exactly as it was found.
    """
    path = database_path(recordings_dir)
    engine = make_engine(path)
    try:
        script = ScriptDirectory.from_config(alembic_config(migrations=migrations))
        head = script.get_current_head()
        current = current_revision(engine)
        if current is not None:
            try:
                script.get_revision(current)
            except CommandError:
                raise LibraryUnavailable(NEWER_DATABASE) from None
        if current != head:
            if current is not None:
                _backup(path, current)
            with engine.begin() as connection:
                command.upgrade(alembic_config(connection, migrations), "head")
    except LibraryUnavailable:
        engine.dispose()
        raise
    except Exception as e:
        engine.dispose()
        raise LibraryUnavailable(
            f"Could not open the recordings database ({path}): {e}"
        ) from e
    return engine
