"""stars: a take can be starred

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-04

★ is a take's own verdict on itself (docs/superpowers/specs/
2026-10-02-stars-design.md): a column on `take`, false for every take there
is. Nothing is starred here. A take with a good mark was starred by nobody,
and its marks stay where they are.

Added in place, as 0002 changed `take`. Batch mode rebuilds a table: a copy,
DROP TABLE and a rename. With foreign keys on, that DROP TABLE deletes every
marker, track file and cloud copy pointing at a take, through their ON
DELETE CASCADE.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE take ADD COLUMN starred BOOLEAN NOT NULL DEFAULT 0")


def downgrade() -> None:
    op.execute("ALTER TABLE take DROP COLUMN starred")
