"""labels: a mark's label is the band's own name and colour

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-05

What a mark could be called was four kinds fixed in the code. They are rows
now (docs/superpowers/specs/2026-10-04-labels-design.md): a name, a colour
and a place in the list, which the band changes in Settings. The four kinds
become the first four labels, ids 1 to 4 in their old order and colours, and
every mark points at its kind's label, so each looks as it did. The importer
reads the kinds an old session.json still names through these same ids.

`marker` is changed in place, as 0002 changed `take`: the label column
added, filled from `kind`, and `kind` dropped. Batch mode would rebuild the
table, a copy, DROP TABLE and a rename (docs/development.md), for no gain.
`label` is AUTOINCREMENT: an id deleted is never given to a new label, so
neither the importer's map nor an id the interface still holds can land on
a label made since.
"""
import sqlite3
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (id, name, colour, position, the kind it was) — frozen as they are today.
# What the code calls a label later is no business of a migration's.
STARTING = (
    (1, "Note", "grey", 0, "note"),
    (2, "Keep this", "green", 1, "good"),
    (3, "Went wrong", "red", 2, "issue"),
    (4, "Do again", "amber", 3, "redo"),
)


def upgrade() -> None:
    if sqlite3.sqlite_version_info < (3, 35, 5):
        raise RuntimeError(
            f"Updating the history needs SQLite 3.35.5 or newer; this Python "
            f"has {sqlite3.sqlite_version}"
        )
    op.create_table(
        "label",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("colour", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sqlite_autoincrement=True,
    )
    bind = op.get_bind()
    bind.execute(
        sa.text("INSERT INTO label (id, name, colour, position) "
                "VALUES (:id, :name, :colour, :position)"),
        [{"id": i, "name": name, "colour": colour, "position": position}
         for i, name, colour, position, _ in STARTING],
    )
    op.execute("ALTER TABLE marker ADD COLUMN label_id INTEGER REFERENCES label (id)")
    op.create_index(op.f("ix_marker_label_id"), "marker", ["label_id"], unique=False)
    # A kind the code never wrote reads as a plain note, as as_marker read it.
    cases = " ".join(f"WHEN '{kind}' THEN {i}" for i, _, _, _, kind in STARTING)
    op.execute(f"UPDATE marker SET label_id = CASE kind {cases} ELSE 1 END")
    op.execute("ALTER TABLE marker DROP COLUMN kind")


def downgrade() -> None:
    raise NotImplementedError(
        "Labels the band made have no kind to go back to. The copy made "
        "before migrating, library.sqlite.bak-<the revision it was at>, is "
        "the history before them."
    )
