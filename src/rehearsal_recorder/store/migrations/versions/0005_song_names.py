"""song names: the titles a song had, and the songs merged into it

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-08

A song renamed, or merged into another, keeps the title it left as a way to
name it (docs/superpowers/specs/2026-10-02-rename-and-merge-songs-design.md,
D6-D8): "Palyn" typed after Palyn was merged into Pałyn is Pałyn's next go.
A song can have several, so they are a table of their own. Nothing was ever
renamed before this, so it starts empty.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "song_name",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("song_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["song_id"], ["song.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_song_name_song_id"), "song_name", ["song_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_song_name_song_id"), table_name="song_name")
    op.drop_table("song_name")
