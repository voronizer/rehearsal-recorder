"""service by hand: a take sent to the band service by hand says so

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-02

A take someone in the band deleted in the band service stays in its Trash
when РЭХА sends a change of it, and comes out only when it is sent by hand:
the cloud button, Send starred, Retry. `by_hand` keeps that a take was sent
so, until its details have gone.

Added in place, as 0012 adds its column.

Going back drops the column; an app from before sends no `by_hand`, so a
take the band deleted stays in the service's Trash whatever it sends.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE service_copy ADD COLUMN by_hand BOOLEAN NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE service_copy DROP COLUMN by_hand")
