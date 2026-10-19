"""metronome: songs and takes keep a tempo and a time signature

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-19

A song has a tempo and a time signature, for the metronome to click at when
the song is picked, and a take has the ones it was recorded at, with whether
it was recorded to the click (docs/superpowers/specs/
2026-10-09-metronome-design.md, Part 1). The tempo counts clicks a minute:
quarters in 4/4, 3/4 and 2/4, eighths in 6/8. Nothing was ever recorded to a
click before this, so every song and take starts with none, and no take is a
click take.

The columns are added in place, as 0003, 0006 and 0007's `take_file` add
theirs. Batch mode rebuilds a table with a copy, DROP TABLE and a rename, and
with foreign keys on, the DROP TABLE of `take` deletes every marker, file and
cloud copy pointing at it, and that of `song` deletes its old names and takes
every take out of its song, through their ON DELETE rules.

Going back drops the columns and nothing else. Every take keeps its files and
its place in its song; an app from before the metronome does not know their
tempo.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE song ADD COLUMN tempo INTEGER")
    op.execute("ALTER TABLE song ADD COLUMN signature VARCHAR")
    op.execute("ALTER TABLE take ADD COLUMN tempo INTEGER")
    op.execute("ALTER TABLE take ADD COLUMN signature VARCHAR")
    op.execute("ALTER TABLE take ADD COLUMN click BOOLEAN NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE take DROP COLUMN click")
    op.execute("ALTER TABLE take DROP COLUMN signature")
    op.execute("ALTER TABLE take DROP COLUMN tempo")
    op.execute("ALTER TABLE song DROP COLUMN signature")
    op.execute("ALTER TABLE song DROP COLUMN tempo")
