"""songs: a take is a go at a song

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-02

Songs were worked out from take names on every read. They are stored now; a
take points at its song with a go number, and its name follows from the two.
This reads the old names by the rule they were written under
(names.legacy_song), numbers the goes of each song afresh across the library
in the order they were played (every rehearsal had its own "Polyn 1"), and
drops the column. Only the database changes: folders and cloud copies whose
names come out differently are renamed afterwards, in the background
(names_pass.py), so a failure here leaves every file where it was.

`take` is altered in place, not in batch mode. Batch mode rebuilds a table:
a copy, DROP TABLE and a rename. With foreign keys on, that DROP TABLE
deletes every marker, track file and cloud copy pointing at a take, through
their ON DELETE CASCADE.
"""
import sqlite3
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from rehearsal_recorder.store.names import legacy_song

revision: str = "0002"
down_revision: Union[str, Sequence[str], None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if sqlite3.sqlite_version_info < (3, 35, 5):
        raise RuntimeError(
            f"Updating the history needs SQLite 3.35.5 or newer; this Python "
            f"has {sqlite3.sqlite_version}"
        )
    op.create_table(
        "song",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("ALTER TABLE take ADD COLUMN song_id INTEGER "
               "REFERENCES song (id) ON DELETE SET NULL")
    op.execute("ALTER TABLE take ADD COLUMN go INTEGER")
    op.create_index(op.f("ix_take_song_id"), "take", ["song_id"], unique=False)

    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT take.id, take.name, rehearsal.created_at, rehearsal.id FROM take "
        "JOIN rehearsal ON rehearsal.id = take.rehearsal_id "
        "ORDER BY rehearsal.created_at, rehearsal.id, take.take_number"
    )).all()
    # Oldest first, so each song's goes are numbered in the order played. A
    # song is spelled as the newest rehearsal's first go at it spells it —
    # how song_choices spelled it before — so a later rehearsal's spelling
    # replaces an earlier one's, and within a rehearsal the first one stays.
    titles, counted, goes = {}, {}, []
    for take_id, name, created_at, rehearsal_id in rows:
        title = legacy_song(name)
        if title is None:
            continue
        key = title.casefold()
        played = (created_at, rehearsal_id)
        if key not in titles or titles[key][0] < played:
            titles[key] = (played, title)
        counted[key] = counted.get(key, 0) + 1
        goes.append({"id": take_id, "key": key, "go": counted[key]})
    ids = {
        key: bind.execute(sa.text("INSERT INTO song (title) VALUES (:title)"),
                          {"title": title}).lastrowid
        for key, (_, title) in titles.items()
    }
    if goes:
        bind.execute(
            sa.text("UPDATE take SET song_id = :song, go = :go WHERE id = :id"),
            [{"id": g["id"], "song": ids[g["key"]], "go": g["go"]} for g in goes],
        )
    op.execute("ALTER TABLE take DROP COLUMN name")


def downgrade() -> None:
    raise NotImplementedError(
        "The history cannot be taken back to before songs were stored. The "
        "copy made before migrating, library.sqlite.bak-0001, is that history."
    )
