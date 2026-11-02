"""take shape: a take keeps its wave, as the lists draw it

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-02

A take's row in a list is drawn as its wave, as the band service draws it
(audio/waveform.take_shape): 120 values made from every track's file, which
takes reading them all. So it is made once and kept here. Every take starts
with none, and gets it the first time it is shown.

Added in place, as 0008 adds its columns, for the reason given there: a
rebuilt `take` would take its markers, files and copies with it.

Going back drops the column; an app from before draws its bars as before.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE take ADD COLUMN shape JSON")


def downgrade() -> None:
    op.execute("ALTER TABLE take DROP COLUMN shape")
