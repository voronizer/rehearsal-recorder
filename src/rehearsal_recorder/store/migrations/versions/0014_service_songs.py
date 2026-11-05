"""service songs: each song's number in the band service

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-05

Songs are kept the same in РЭХА and the band service
(docs/superpowers/specs/2026-11-05-song-sync-design.md): a song has one
number, given by the service, and a title, tempo and signature that change
on either side. Two tables: `service_song`, each song's number and what the
two sides last agreed on for it; and `service_song_merge`, songs merged in
РЭХА that the service has not been told of yet. A song's rows go with it.

Going back drops the two tables; an app from before sends a take's song by
its title, as it did.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: Union[str, Sequence[str], None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "service_song",
        sa.Column("song_id", sa.Integer(), nullable=False),
        sa.Column("sid", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("tempo", sa.Integer(), nullable=True),
        sa.Column("signature", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["song_id"], ["song.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("song_id"),
        sa.UniqueConstraint("sid"),
    )
    op.create_table(
        "service_song_merge",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("from_sid", sa.Integer(), nullable=False),
        sa.Column("into_song_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["into_song_id"], ["song.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("service_song_merge")
    op.drop_table("service_song")
