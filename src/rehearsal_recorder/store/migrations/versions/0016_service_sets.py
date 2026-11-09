"""service sets: each set's number in the band service

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-09

Sets are kept the same in РЭХА and the band service
(docs/superpowers/specs/2026-11-09-gig-sets-design.md), as songs are since
0014: a set has one number, given by the service, and a name and songs that
change on either side. One table, `service_set`: each set's number and what
the two sides last agreed on for it, its name and its songs as the
service's numbers. A set deleted here keeps its row, with no set, until the
service has the delete.

Going back drops the table; an app from before keeps its sets to itself,
as it did.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: Union[str, Sequence[str], None] = "0015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "service_set",
        sa.Column("sid", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("set_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("songs", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["set_id"], ["song_set.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("sid"),
        sa.UniqueConstraint("set_id"),
    )


def downgrade() -> None:
    op.drop_table("service_set")
