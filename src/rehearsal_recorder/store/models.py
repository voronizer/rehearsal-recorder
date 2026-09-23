"""
What the app remembers about rehearsals, as tables.

The schema is owned by the migrations in migrations/versions: these classes
say what the code expects, and tests/test_store.py fails when the two drift
apart. Changing a column here means writing the migration for it — see
docs/development.md.

Paths are never stored absolute. A rehearsal's folder is relative to the
recordings folder, a take's files to the rehearsal folder, and a cloud copy
to the cloud folder, so moving any of the three moves what points into it.
"""

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Rehearsal(Base):
    __tablename__ = "rehearsal"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Relative to the recordings folder, with forward slashes.
    folder: Mapped[str] = mapped_column(String, unique=True)
    name: Mapped[str] = mapped_column(String)
    # ISO, "2026-09-18T19:00:00" — sorts as text, as it always has.
    created_at: Mapped[str] = mapped_column(String)
    samplerate: Mapped[int] = mapped_column(Integer)
    bit_depth: Mapped[int] = mapped_column(Integer)

    tracks: Mapped[list["Track"]] = relationship(
        back_populates="rehearsal", cascade="all, delete-orphan",
        passive_deletes=True, order_by="Track.position",
    )
    takes: Mapped[list["Take"]] = relationship(
        back_populates="rehearsal", cascade="all, delete-orphan",
        passive_deletes=True, order_by="Take.take_number",
    )


class Track(Base):
    """One input as the rehearsal was set up: its name and which channel."""

    __tablename__ = "track"

    id: Mapped[int] = mapped_column(primary_key=True)
    rehearsal_id: Mapped[int] = mapped_column(
        ForeignKey("rehearsal.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    channel: Mapped[int] = mapped_column(Integer)

    rehearsal: Mapped[Rehearsal] = relationship(back_populates="tracks")


class Take(Base):
    __tablename__ = "take"
    __table_args__ = (UniqueConstraint("rehearsal_id", "take_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rehearsal_id: Mapped[int] = mapped_column(
        ForeignKey("rehearsal.id", ondelete="CASCADE"), index=True
    )
    take_number: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    duration_sec: Mapped[float] = mapped_column(Float, default=0.0)
    # This take's own answer on the review screen — see Api.keep_take.
    cloud_skip: Mapped[bool] = mapped_column(Boolean, default=False)
    cloud_send: Mapped[bool] = mapped_column(Boolean, default=False)
    # Why the last copy to the cloud folder failed, until one succeeds.
    cloud_error: Mapped[str | None] = mapped_column(String, nullable=True)

    rehearsal: Mapped[Rehearsal] = relationship(back_populates="takes")
    files: Mapped[list["TakeFile"]] = relationship(
        back_populates="take", cascade="all, delete-orphan",
        passive_deletes=True, order_by="TakeFile.position",
    )
    markers: Mapped[list["Marker"]] = relationship(
        back_populates="take", cascade="all, delete-orphan",
        passive_deletes=True, order_by="Marker.at",
    )
    cloud_copy: Mapped["CloudCopy | None"] = relationship(
        back_populates="take", cascade="all, delete-orphan",
        passive_deletes=True, uselist=False,
    )


class TakeFile(Base):
    """One track of a take on disk."""

    __tablename__ = "take_file"

    id: Mapped[int] = mapped_column(primary_key=True)
    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    # Relative to the rehearsal folder: "01 - Verse riff/Guitar 1.wav".
    file: Mapped[str] = mapped_column(String)

    take: Mapped[Take] = relationship(back_populates="files")


class Marker(Base):
    __tablename__ = "marker"

    id: Mapped[int] = mapped_column(primary_key=True)
    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), index=True
    )
    # Seconds into the take, rounded to 0.01 — see library.as_marker.
    at: Mapped[float] = mapped_column(Float)
    kind: Mapped[str] = mapped_column(String, default="note")
    note: Mapped[str] = mapped_column(String, default="")

    take: Mapped[Take] = relationship(back_populates="markers")


class CloudCopy(Base):
    """What of a take is in the cloud folder. No row: nothing is."""

    __tablename__ = "cloud_copy"

    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), primary_key=True
    )
    # Both relative to the cloud folder.
    mix: Mapped[str | None] = mapped_column(String, nullable=True)
    mix_format: Mapped[str | None] = mapped_column(String, nullable=True)
    gain: Mapped[float | None] = mapped_column(Float, nullable=True)
    tracks: Mapped[str | None] = mapped_column(String, nullable=True)
    tracks_format: Mapped[str | None] = mapped_column(String, nullable=True)
    # What the copy was made from — cloud.source_of.
    source: Mapped[dict] = mapped_column(JSON, default=dict)

    take: Mapped[Take] = relationship(back_populates="cloud_copy")
