"""song sets: the songs a rehearsal goes through, in order

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-08

A set is a name and song titles in an order, made by the band in Settings
or on the start screen (docs/superpowers/specs/2026-10-08-song-sets-design.md,
D1). A rehearsal started by one keeps a copy of it, as it was then (D7), so
changing or deleting the set later changes nothing in History. Nothing was
ever played by a set before this, so both start empty.

The rehearsal's columns are added in place, as 0003 adds take's: batch mode
rebuilds a table with DROP TABLE, and with foreign keys on that deletes
every take of every rehearsal, through ON DELETE CASCADE.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "song_set",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("songs", sa.JSON(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )
    op.execute("ALTER TABLE rehearsal ADD COLUMN set_name VARCHAR")
    op.execute("ALTER TABLE rehearsal ADD COLUMN set_songs JSON")


def downgrade() -> None:
    op.execute("ALTER TABLE rehearsal DROP COLUMN set_songs")
    op.execute("ALTER TABLE rehearsal DROP COLUMN set_name")
    op.drop_table("song_set")
