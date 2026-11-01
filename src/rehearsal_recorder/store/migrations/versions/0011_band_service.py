"""band service: what of each take is in the band service, or on its way

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-31

The band service (docs/superpowers/specs/2026-10-30-band-service-part-1-design.md)
is a second place takes are sent to, beside the cloud folder. Three tables:
`service_copy`, a row for each take ever sent, with the name the service
knows it by and how far it got (kept when the take is taken out of the
service by hand, so sending it again brings back the same take); `service_file`, each file made for it and
the parts of its upload that arrived, so a take whose sending was cut short
goes on from where it stopped; and `service_delete`, the takes still to be
put in the service's trash. A take's rows go with it.

Going back drops the three tables, and an app from before this sends nothing
to a band service.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "service_copy",
        sa.Column("take_id", sa.Integer(), nullable=False),
        sa.Column("uid", sa.String(), nullable=False),
        sa.Column("gen", sa.Integer(), nullable=False),
        sa.Column("pending_cut", sa.Float(), nullable=False),
        sa.Column("due", sa.Boolean(), nullable=False),
        sa.Column("sent", sa.JSON(), nullable=True),
        sa.Column("mp3_gen", sa.Integer(), nullable=True),
        sa.Column("flac_gen", sa.Integer(), nullable=True),
        sa.Column("error", sa.String(), nullable=True),
        sa.Column("removed", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.ForeignKeyConstraint(["take_id"], ["take.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("take_id"),
    )
    op.create_table(
        "service_file",
        sa.Column("take_id", sa.Integer(), nullable=False),
        sa.Column("gen", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("path", sa.String(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("upload_id", sa.String(), nullable=True),
        sa.Column("parts", sa.JSON(), nullable=False),
        sa.Column("done", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["take_id"], ["take.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("take_id", "gen", "name"),
    )
    op.create_table(
        "service_delete",
        sa.Column("uid", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("uid"),
    )


def downgrade() -> None:
    op.drop_table("service_delete")
    op.drop_table("service_file")
    op.drop_table("service_copy")
