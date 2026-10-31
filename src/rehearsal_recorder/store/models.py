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

from rehearsal_recorder.midi.rules import AUDIO


class Base(DeclarativeBase):
    pass


# The kinds of a take's file (TakeFile.kind), as stored: the words never
# change.
AUDIO_FILE = "audio"
NOTES_FILE = "midi"
# The WAV the app wrote from the song's backing track (migration 0009): opened
# as audio, as a track is, and drawn as the Backing track.
BACKING_FILE = "backing"


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
    # The set it was played by, copied when it started (migration 0006):
    # the set's name and its song titles in order, None when played freely.
    # A copy, not a link, so changing or deleting the set later leaves what
    # this evening was meant to be.
    set_name: Mapped[str | None] = mapped_column(String, nullable=True)
    set_songs: Mapped[list | None] = mapped_column(JSON, nullable=True)

    tracks: Mapped[list["Track"]] = relationship(
        back_populates="rehearsal", cascade="all, delete-orphan",
        passive_deletes=True, order_by="Track.position",
    )
    takes: Mapped[list["Take"]] = relationship(
        back_populates="rehearsal", cascade="all, delete-orphan",
        passive_deletes=True, order_by="Take.take_number",
    )


class Song(Base):
    """
    What takes are goes at. A take's name is not stored but follows from its
    song and its go (names.take_name), so a title is spelled one way
    everywhere. Titles are unique case-blind. library.py enforces that, as
    SQLite's lower() folds only ASCII and would let "Полынь" and "полынь"
    both in.
    """

    __tablename__ = "song"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String)
    # The highest go this song has ever given. The next go is one past it,
    # so a number is never given twice, even after its take is deleted; and
    # a song is kept when its last take goes, so its count is kept too.
    last_go: Mapped[int] = mapped_column(Integer, default=0)
    # The tempo the metronome has for the song, in its own count (eighths a
    # minute in 6/8), and its signature: "4/4", "3/4", "2/4" or "6/8". Both or
    # neither, None until a click take or the band gives the song one
    # (migration 0008). Library.set_song_tempo says what they may be.
    tempo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    signature: Mapped[str | None] = mapped_column(String, nullable=True)
    # Its backing track (migration 0009): the app's copy of the file, relative
    # to the recordings folder, and the file's name as it was added, which
    # screens show; both None for a song with none. Bar 1 is seconds into the
    # file, to a hundredth; the tempo is what was counted from the file, in
    # the song's own count, None for a file with no steady beat. `heard` is
    # whether a take's Backing track is heard when a take of the song opens:
    # muted the first time, then as the band last left it.
    backing_file: Mapped[str | None] = mapped_column(String, nullable=True)
    backing_name: Mapped[str | None] = mapped_column(String, nullable=True)
    backing_first_bar: Mapped[float | None] = mapped_column(Float, nullable=True)
    backing_tempo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    backing_heard: Mapped[bool] = mapped_column(Boolean, default=False)


class SongName(Base):
    """
    A title a song had before it was renamed, or the title of a song merged
    into it (docs/superpowers/specs/2026-10-02-rename-and-merge-songs-design.md,
    D6-D8): typed again, it names a go at the song. Spelled as it was. Unique
    case-blind across every song, and never a song's title too, which
    library.py enforces as it does titles.
    """

    __tablename__ = "song_name"

    id: Mapped[int] = mapped_column(primary_key=True)
    song_id: Mapped[int] = mapped_column(
        ForeignKey("song.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String)


class Track(Base):
    """One member of the band as the rehearsal was set up: its name, what it
    records, and which channel and port it was plugged into."""

    __tablename__ = "track"

    id: Mapped[int] = mapped_column(primary_key=True)
    rehearsal_id: Mapped[int] = mapped_column(
        ForeignKey("rehearsal.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    # None for a track that records only MIDI: it is plugged into no input
    # (migration 0007).
    channel: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # "audio", "both" or "midi" — midi/rules.py says what each means.
    mode: Mapped[str] = mapped_column(String, default=AUDIO, server_default=AUDIO)
    # The name of the MIDI port it played into, for a track that records
    # notes.
    midi_port: Mapped[str | None] = mapped_column(String, nullable=True)

    rehearsal: Mapped[Rehearsal] = relationship(back_populates="tracks")


class Take(Base):
    __tablename__ = "take"
    __table_args__ = (UniqueConstraint("rehearsal_id", "take_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rehearsal_id: Mapped[int] = mapped_column(
        ForeignKey("rehearsal.id", ondelete="CASCADE"), index=True
    )
    take_number: Mapped[int] = mapped_column(Integer)
    # What the take is a go at, and which go: both None for a take nobody
    # named. Goes are numbered per song across the whole library and kept,
    # not counted again on every read: deleting Polyn 2 must not turn Polyn 3
    # into another name, and so another folder and another cloud copy.
    #
    # The column is added by ALTER TABLE, which can only declare the foreign
    # key inline, and SQLAlchemy does not read an inline key's ON DELETE back
    # from SQLite. The database does have ON DELETE SET NULL (migration 0002);
    # it is left off here so the two compare equal. Rebuilding `take` to
    # declare it as a table constraint would cascade away its markers, files
    # and cloud copies, and library.py never deletes a song that has takes.
    song_id: Mapped[int | None] = mapped_column(
        ForeignKey("song.id"), index=True, nullable=True
    )
    go: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_sec: Mapped[float] = mapped_column(Float, default=0.0)
    # This take's own answer on the review screen — see Api.keep_take.
    cloud_skip: Mapped[bool] = mapped_column(Boolean, default=False)
    cloud_send: Mapped[bool] = mapped_column(Boolean, default=False)
    # Why the last copy to the cloud folder failed, until one succeeds.
    cloud_error: Mapped[str | None] = mapped_column(String, nullable=True)
    # ★: somebody marked this take as one worth coming back to. The take's
    # own verdict on itself, so a song can have several and a take with no
    # song can have one. Added in place by migration 0003, like song_id.
    starred: Mapped[bool] = mapped_column(Boolean, default=False)
    # What the metronome showed when Record was pressed (migration 0008): the
    # tempo and signature, None when its row was empty. `click` is whether the
    # take was recorded to the click, so its files start on a bar. A take can
    # have a tempo and no click, when the switch was off: its .mid still
    # states the tempo. Added in place, like starred.
    tempo: Mapped[int | None] = mapped_column(Integer, nullable=True)
    signature: Mapped[str | None] = mapped_column(String, nullable=True)
    click: Mapped[bool] = mapped_column(Boolean, default=False)

    rehearsal: Mapped[Rehearsal] = relationship(back_populates="takes")
    song: Mapped["Song | None"] = relationship()
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
    service_copy: Mapped["ServiceCopy | None"] = relationship(
        back_populates="take", cascade="all, delete-orphan",
        passive_deletes=True, uselist=False,
    )
    service_files: Mapped[list["ServiceFile"]] = relationship(
        back_populates="take", cascade="all, delete-orphan",
        passive_deletes=True, order_by="ServiceFile.name",
    )


class TakeFile(Base):
    """One file of a take on disk: a track's WAV, or the notes a MIDI port
    sent while it played."""

    __tablename__ = "take_file"

    id: Mapped[int] = mapped_column(primary_key=True)
    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String)
    # Relative to the rehearsal folder: "01 - Verse riff/Guitar 1.wav".
    file: Mapped[str] = mapped_column(String)
    # "audio" for a WAV, "midi" for a .mid (migration 0007), "backing" for the
    # WAV the app wrote from the song's backing track (0009). Kept apart so
    # that nothing which opens a take's tracks as audio is handed a .mid.
    # Added in place, like song_id on `take`.
    kind: Mapped[str] = mapped_column(String, default=AUDIO_FILE, server_default=AUDIO_FILE)
    # The icon its track had when the take was recorded (migration 0010), so
    # the player draws the take as it was. None for a Backing track, and for
    # a track that had none.
    icon: Mapped[str | None] = mapped_column(String, nullable=True)

    take: Mapped[Take] = relationship(back_populates="files")


class Label(Base):
    """
    What a mark is called and the colour it is drawn in, made by the band in
    Settings (docs/superpowers/specs/2026-10-04-labels-design.md). It does
    nothing else: no code knows a label by its name or its place in the list.
    Names are unique case-blind, which library.py enforces, as SQLite's
    lower() folds only ASCII. An id is never given twice (AUTOINCREMENT, see
    migration 0004).
    """

    __tablename__ = "label"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    # By name, one of library.LABEL_COLOURS. What it looks like is the
    # theme's (--label-red in ui/src/index.css), so a theme can change it
    # without touching the library.
    colour: Mapped[str] = mapped_column(String)
    # From 0, with no gaps: the order of the marker dialog's buttons, and
    # the first is what a new mark gets.
    position: Mapped[int] = mapped_column(Integer)


class SongSet(Base):
    """
    Songs a rehearsal goes through, in order, made by the band in Settings or
    on the start screen (docs/superpowers/specs/2026-10-08-song-sets-design.md).
    The songs are titles, resolved as a typed name is when read, so a song
    renamed or merged away is still found; a title no song has is a song not
    played yet. Names are unique case-blind, which library.py enforces. An id
    is never given twice (AUTOINCREMENT, see migration 0006).
    """

    __tablename__ = "song_set"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    songs: Mapped[list] = mapped_column(JSON)
    # From 0, with no gaps: the order the sets are listed in.
    position: Mapped[int] = mapped_column(Integer)


class Marker(Base):
    __tablename__ = "marker"

    id: Mapped[int] = mapped_column(primary_key=True)
    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), index=True
    )
    # Seconds into the take, rounded to 0.01 — see library.as_marker.
    at: Mapped[float] = mapped_column(Float)
    # Its label. Nullable only because a column added in place cannot be NOT
    # NULL without a default (migration 0004): the code never writes a mark
    # without one (Library._labelled). No ON DELETE: a label with marks is
    # deleted only after they have moved to another, in the same transaction.
    label_id: Mapped[int | None] = mapped_column(
        ForeignKey("label.id"), index=True, nullable=True
    )
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


class ServiceCopy(Base):
    """
    What of a take is in the band service, or on its way there (migration
    0011; sending/band_service.py). No row: it was never sent.
    """

    __tablename__ = "service_copy"

    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), primary_key=True
    )
    # The take's name in the service, made when it is first sent and kept
    # for good: a rename, a crop or a restart never changes it.
    uid: Mapped[str] = mapped_column(String)
    # 1, and one more each time its audio changes (a crop).
    gen: Mapped[int] = mapped_column(Integer, default=1)
    # Seconds the crops since the generation the service shows took off the
    # start, which the service moves the comments back by.
    pending_cut: Mapped[float] = mapped_column(Float, default=0.0)
    # Whether something of it is still to go: its files, or its details.
    due: Mapped[bool] = mapped_column(Boolean, default=False)
    # The details last sent in full (the TakeMeta), None before.
    sent: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # The generation whose MP3s, and whose FLAC files, are all up.
    mp3_gen: Mapped[int | None] = mapped_column(Integer, nullable=True)
    flac_gen: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Why the service turned it down, until it is sent again.
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    # Taken out of the service by hand (it is in the service's trash): the
    # row stays for its uid, so sending it again brings back the same take,
    # comments and all. Nothing about it goes until it is sent again.
    removed: Mapped[bool] = mapped_column(Boolean, default=False)

    take: Mapped[Take] = relationship(back_populates="service_copy")


class ServiceFile(Base):
    """
    One file made for the band service (an MP3, a FLAC, a waveform or a
    .mid) and how far its upload got: kept until the take's generation is
    all up, so a file is never made twice, and a part that arrived is never
    sent again under another number.
    """

    __tablename__ = "service_file"

    take_id: Mapped[int] = mapped_column(
        ForeignKey("take.id", ondelete="CASCADE"), primary_key=True
    )
    gen: Mapped[int] = mapped_column(Integer, primary_key=True)
    # As the service names it: "1.mp3", "1.flac", "1.peaks", "2.mid".
    name: Mapped[str] = mapped_column(String, primary_key=True)
    # Relative to the band service's own folder beside the settings.
    path: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    # The upload the service gave it, None before it is asked for one.
    upload_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # [[number, etag], ...] of the parts that arrived.
    parts: Mapped[list] = mapped_column(JSON, default=list)
    done: Mapped[bool] = mapped_column(Boolean, default=False)

    take: Mapped[Take] = relationship(back_populates="service_files")


class ServiceDelete(Base):
    """A take to be put in the band service's trash: deleted in РЭХА, or
    removed from the service by hand, and not yet told."""

    __tablename__ = "service_delete"

    uid: Mapped[str] = mapped_column(String, primary_key=True)
    # Its name as it was, for its line in the list of background work.
    name: Mapped[str] = mapped_column(String, default="")
