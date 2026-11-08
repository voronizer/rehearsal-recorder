"""unnamed goes: a take with no song is counted like a song's takes

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-08

A take nobody named was called by its place in the rehearsal, "Take 7", and
the next rehearsal had a "Take 7" too. Now the takes with no song are
counted across the whole library, as a song's takes are, and a take with no
song is "Take 47" (docs/superpowers/plans/2026-11-08-evening-number.md).

One table, `counter`, with one row: `last_unnamed_go`, the highest go a
take with no song has been given, as Song.last_go is for a song. Every take
with no song gets a go here, in the order played: the oldest rehearsal
first, the order of its takes within one. The count starts at the last.

Only the database changes. Folders and cloud copies whose names come out
differently ("07 - Take 7" is now "07 - Take 47") are renamed afterwards, in
the background (names_pass.py), as after 0002. Those takes in the band
service are marked due, so their new names go there when the app opens; a
take taken out of the service by hand, or one it turned down, is left as
it is, as a rename leaves it (BandService.edited).

Going back drops the table. An app from before reads a take with no song by
its take number again and does not look at its go.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, Sequence[str], None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "counter",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("last_unnamed_go", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
    )
    bind = op.get_bind()
    takes = bind.execute(sa.text(
        "SELECT take.id FROM take "
        "JOIN rehearsal ON rehearsal.id = take.rehearsal_id "
        "WHERE take.song_id IS NULL "
        "ORDER BY rehearsal.created_at, rehearsal.id, take.take_number"
    )).scalars().all()
    if takes:
        bind.execute(
            sa.text("UPDATE take SET go = :go WHERE id = :id"),
            [{"id": take_id, "go": go} for go, take_id in enumerate(takes, start=1)],
        )
        bind.execute(sa.text(
            "UPDATE service_copy SET due = 1 "
            "WHERE removed = 0 AND error IS NULL "
            "AND take_id IN (SELECT id FROM take WHERE song_id IS NULL)"
        ))
    bind.execute(sa.text("INSERT INTO counter (id, last_unnamed_go) VALUES (1, :last)"),
                 {"last": len(takes)})


def downgrade() -> None:
    op.drop_table("counter")
