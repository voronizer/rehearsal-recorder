"""song sets: the songs a rehearsal goes through, in order

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-08

A set is a name and song titles in an order, made by the band in Settings
or on the start screen (docs/superpowers/specs/2026-10-08-song-sets-design.md,
D1). A rehearsal started by one keeps a copy of it, as it was then (D7), so
changing or deleting the set later changes nothing in History. Nothing was
ever played by a set before this, so both start empty.
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
    with op.batch_alter_table("rehearsal") as batch:
        batch.add_column(sa.Column("set_name", sa.String(), nullable=True))
        batch.add_column(sa.Column("set_songs", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("rehearsal") as batch:
        batch.drop_column("set_songs")
        batch.drop_column("set_name")
    op.drop_table("song_set")
