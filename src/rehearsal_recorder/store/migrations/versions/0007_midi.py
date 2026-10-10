"""midi: a track can record notes, kept as .mid files beside the audio

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-09

A track records audio, both or MIDI (docs/superpowers/specs/
2026-10-08-midi-recording-design.md, Part 1). `track` gets the mode and the
name of the port, and a track that records only MIDI has no input, so its
channel may be empty. `take_file` gets a kind: a `.mid` is a row of its own
kind, so everything that opens a take's files as audio can leave the other
kind alone. Every track and every file there is reads as audio.

Two ways of changing a table, for the reason 0003 and 0006 give. Batch mode
rebuilds a table with a copy, DROP TABLE and a rename, and with foreign keys
on, the DROP TABLE of a table other tables point at deletes their rows
through ON DELETE CASCADE. `take` is pointed at by every marker, file and
cloud copy, and is not rebuilt: `take_file` gets its column added in place.
`track` is rebuilt, because the one change SQLite cannot make in place is
dropping NOT NULL from `channel`: nothing has a foreign key to `track` (it
points at `rehearsal`, and only that way), so its DROP TABLE cascades into
nothing.

Going back drops what an app from before MIDI cannot read: the `.mid` rows,
so a notes file is never taken for a track, and the tracks that have no
input. The files stay on disk. A Both track becomes an audio one, as it
recorded the audio.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("track") as batch_op:
        batch_op.alter_column("channel", existing_type=sa.Integer(), nullable=True)
        batch_op.add_column(
            sa.Column("mode", sa.String(), nullable=False, server_default="audio")
        )
        batch_op.add_column(sa.Column("midi_port", sa.String(), nullable=True))
    op.execute("ALTER TABLE take_file ADD COLUMN kind VARCHAR NOT NULL DEFAULT 'audio'")


def downgrade() -> None:
    op.execute("DELETE FROM take_file WHERE kind = 'midi'")
    op.execute("ALTER TABLE take_file DROP COLUMN kind")
    op.execute("DELETE FROM track WHERE channel IS NULL")
    with op.batch_alter_table("track") as batch_op:
        batch_op.drop_column("midi_port")
        batch_op.drop_column("mode")
        batch_op.alter_column("channel", existing_type=sa.Integer(), nullable=False)
