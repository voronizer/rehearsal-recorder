"""take icons: a take keeps the icon of each of its tracks

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-26

A take keeps the icon each of its tracks had when it was recorded
(docs/superpowers/specs/2026-10-26-lineups-design.md, Part 3). Before this
the player drew an old take with the band's icons as they are now, by the
track's name, so picking another lineup or changing an icon redrew every take
before it. The icon goes on `take_file`, one per WAV and .mid, rather than on
the rehearsal's tracks, so a take moved to another rehearsal keeps its own.
A Backing track keeps none: its kind already says what it is.

Takes recorded before this are given the band's icons once, here, by name.
The migration cannot read config.json, so the app hands the band's icons in
(store/db.py, `icons` in the config's attributes); with none handed in, as
from Alembic's command line, every file starts with no icon. After this the
takes keep what they were given. The column is added in place, as 0008 adds
its own.

Going back drops the column, and an app from before this draws the icons
from the band again.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE take_file ADD COLUMN icon VARCHAR")
    config = op.get_context().config
    icons = (config.attributes.get("icons") if config is not None else None) or {}
    for name, icon in icons.items():
        op.get_bind().execute(
            sa.text("UPDATE take_file SET icon = :icon WHERE name = :name AND kind != 'backing'"),
            {"icon": icon, "name": name},
        )


def downgrade() -> None:
    op.execute("ALTER TABLE take_file DROP COLUMN icon")
