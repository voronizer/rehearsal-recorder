"""backing: a song keeps a backing track

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-24

A song can keep one audio file the app plays from Record, a backing track
(docs/superpowers/specs/2026-10-11-backing-track-design.md, Part 1): where
the app's own copy of it is, relative to the recordings folder; the file's
name as it was added, which screens show; where its bar 1 is, in seconds;
the tempo counted from it, None for a file with no steady beat; and whether
the Backing track a take keeps of it is heard when a take of the song opens.
A take's Backing track is a `take_file` of the kind "backing", which needs
no column.

No song had a backing track before this, so every one starts with none and
its Backing track not heard. The columns are added in place, as 0008 adds
its own, for the reason given there.

Going back drops the columns and nothing else. A take's Backing track stays
a file of the take, and an app from before this opens it as one more track.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE song ADD COLUMN backing_file VARCHAR")
    op.execute("ALTER TABLE song ADD COLUMN backing_name VARCHAR")
    op.execute("ALTER TABLE song ADD COLUMN backing_first_bar FLOAT")
    op.execute("ALTER TABLE song ADD COLUMN backing_tempo INTEGER")
    op.execute("ALTER TABLE song ADD COLUMN backing_heard BOOLEAN NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE song DROP COLUMN backing_heard")
    op.execute("ALTER TABLE song DROP COLUMN backing_tempo")
    op.execute("ALTER TABLE song DROP COLUMN backing_first_bar")
    op.execute("ALTER TABLE song DROP COLUMN backing_name")
    op.execute("ALTER TABLE song DROP COLUMN backing_file")
