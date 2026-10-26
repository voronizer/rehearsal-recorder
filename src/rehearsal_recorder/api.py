"""
The Python side of the bridge between the window (pywebview) and the audio layer.

Model: one "rehearsal" (start_rehearsal) lives as long as the app is open and
holds several "takes" (start_take / stop_take / keep_take / discard_take).
Until a take is saved it is written into the rehearsal's own drafts folder,
inside the rehearsal's folder rather than somewhere in a system temp directory
— so it is visible and findable if something goes wrong. Saving moves the
files into a permanent take folder inside the same rehearsal; discarding
deletes them.

What is known about the rehearsals and their takes lives in the recordings
folder's database (store/, library.sqlite); the audio stays in the folders.

The recordings folder is configurable (Settings). It belongs to this
computer: the database in it is written while the app runs, and a sync
client or a network share cannot be trusted with that. Sharing takes is what
the separate cloud folder is for — only the takes worth keeping go there.
"""

import collections
import copy
import functools
import json
import logging
import math
import os
import re
import shutil
import sys
import threading
import time
import wave
from datetime import datetime
from pathlib import Path, PurePosixPath

import sounddevice as sd

from rehearsal_recorder import __version__
from rehearsal_recorder.audio.capture import TAKE_RECORD, AudioRecorder
from rehearsal_recorder.audio.drafts import (
    DRAFTS_DIR,
    describe,
    draft_dirs,
    finalize,
    has_audio,
    wav_frames,
)
from rehearsal_recorder.audio.drafts import icons as draft_icons
from rehearsal_recorder.audio.encode import (
    CLOUD_FORMATS_INFO,
    available as encoder_available,
    encode,
    extension,
    missing_encoder_hint,
    normalize_format,
)
from rehearsal_recorder.audio.format import (
    DEFAULT_DEPTH,
    LEGACY_DEPTH,
    SUPPORTED_DEPTHS,
    bytes_per_sample,
    normalize_depth,
)
from rehearsal_recorder.audio.crop import crop_wav
from rehearsal_recorder.audio.mixdown import mixdown
from rehearsal_recorder.audio.devices import (
    STREAM_LOCK,
    _is_asio,
    channels_available,
    device_identity,
    recording_formats,
    rescan,
    saved_device,
)
from rehearsal_recorder.audio import drift as driftmod
from rehearsal_recorder.audio import tempo as tempomod
from rehearsal_recorder.audio.click import (
    SIGNATURE_RULE, SIGNATURES, clamp_tempo, click_frame, per_quarter, snap_region,
)
from rehearsal_recorder.audio.take_click import whole
from rehearsal_recorder.audio.wavfile import read_acid
from rehearsal_recorder.metronome import ANOTHER_ASIO, Metronome
from rehearsal_recorder.backing import Backing
from rehearsal_recorder.audio.monitor import LevelMonitor
from rehearsal_recorder.audio.player import TakePlayer
from rehearsal_recorder.audio.waveform import DEFAULT_BUCKETS, wav_peaks
from rehearsal_recorder.midi.notes import read_notes
from rehearsal_recorder import activity as activitymod
from rehearsal_recorder import cloud as cloudmod
from rehearsal_recorder import holding
from rehearsal_recorder.names_pass import NamesPass
from rehearsal_recorder import layouts
from rehearsal_recorder import updates
from rehearsal_recorder.mediaserver import AppServer
from rehearsal_recorder.midi import ports as midiports
from rehearsal_recorder.midi.capture import CLOCK_FILE, MID_SUFFIX, MIDRAW_SUFFIX, note_stems
from rehearsal_recorder.midi.clock import AudioClock
from rehearsal_recorder.midi.rig import MidiRig
from rehearsal_recorder.midi.controller import Controller
from rehearsal_recorder.midi import bluetooth_setup
from rehearsal_recorder.midi.identity import find_port, controller_feedback
from rehearsal_recorder.midi.rules import (
    lane_after,
    notes_problem,
    place_in,
    port_of,
    records_audio,
    records_notes,
)
from rehearsal_recorder.midi.smf import NO_METER, crop_mid, meter_of
from rehearsal_recorder.store.db import LibraryUnavailable
from rehearsal_recorder.store.importer import import_all, read_text
from rehearsal_recorder.store.library import (
    REHEARSAL_GONE, TAKE_GONE, LabelRefused, Library, SetRefused, SongRefused, as_marker,
    as_tempo, paths_overlap,
)
from rehearsal_recorder.store.db import DB_NAME
from rehearsal_recorder.transport import Transport, serialised
from rehearsal_recorder.control import ControlAPI
from rehearsal_recorder import diagnostics
from rehearsal_recorder.audio.probe import InterfaceCheck, plan_for, tracks_for
from rehearsal_recorder.platform_support import (
    CONFIG_PATH,
    CRASH_LOG,
    FALLBACK_TRASH,
    KeepAwake,
    SleepWatch,
    app_root,
    battery_percent,
    describe_path_limit,
    move_to_trash,
    open_in_file_manager,
    reveal_in_file_manager,
    safe_filename,
    trash_kind,
    trash_name,
)

RECORDINGS_ROOT = Path.home() / "RehearsalRecordings"
# Where Under the hood sends someone to see whether there is a newer version.
RELEASES_URL = "https://github.com/voronizer/rehearsal-recorder/releases"
UI_DIR = app_root() / "ui" / "dist"

# Warn below this much recording time left.
LOW_SPACE_MINUTES = 15

# A region shorter than this is a slip of the mouse, not an intention.
MIN_CROP_SEC = 1.0

# What a fresh install records at until Settings says otherwise.
DEFAULT_SAMPLERATE = 44100

# The MIDI system of this machine, asked once when the app starts, and whether
# the rig that holds the rehearsal's ports runs its own threads. The suites
# replace both: they have no port to open, and drive the rig themselves.
open_midi_system = midiports.open_system
MIDI_THREADS = True

# Tap on a song's page, outside a rehearsal: the band's ports are opened for
# the pads' hits and given back once this long has passed with none (spec
# Part 11), looked at this often. The suites shorten both.
TAP_QUIET_SEC = 2.0
TAP_POLL_SEC = 0.1

log = logging.getLogger(__name__)

# The drift lines kept in memory (take_drift): enough for the takes of an
# evening opened again, and nothing on disk.
DRIFTS_KEPT = 32

# How much of each part of a problem the page sends (log_problem) is kept: a
# few KB holds a whole stack, and the page decides what it sends.
PAGE_PROBLEM_CHARS = 4000


def _page_problem_text(value):
    """One part of a problem the page sent, as text no longer than
    PAGE_PROBLEM_CHARS. Whatever the bridge handed over: None, a number, a
    list, or something with no words of its own."""
    if value is None:
        return ""
    try:
        text = value if isinstance(value, str) else str(value)
    except Exception:  # noqa: BLE001
        text = f"<{type(value).__name__}>"
    if len(text) > PAGE_PROBLEM_CHARS:
        text = f"{text[:PAGE_PROBLEM_CHARS]}... ({len(text) - PAGE_PROBLEM_CHARS} more characters)"
    return text


# What a cloud copy is called while it is still being written. The worker is
# killed at interpreter exit, possibly mid-copy, and nothing is recorded on
# the take until the copy has succeeded — so a file left under its real name
# would be a plausible-looking truncated take that no record points at, that
# nothing ever cleans up, and that the sync client uploads. Under this name it
# is obviously unfinished instead.
WRITING_PREFIX = ".writing-"


def _safe_name(name):
    """Legal on macOS, Windows and Linux alike — see platform_support.py."""
    return safe_filename(name or "", fallback="Untitled")


def _writing_path(path):
    """Where a copy is written before it is moved onto its real name."""
    path = Path(path)
    return path.with_name(WRITING_PREFIX + path.name)


def _cloud_subfolder(cloud, folder):
    """Where one rehearsal's copies go inside the cloud folder: a folder named
    after it, so the cloud folder does not become a heap of takes."""
    return Path(cloud) / _safe_name(Path(folder).name)


# How a rehearsal's folder is named, and so its folder in the cloud: "Tuesday
# jam - 2026-09-22 19-00", with " (2)" after it when two rehearsals shared a
# name and a minute. The sweep of emptied folders touches nothing else.
_REHEARSAL_DIR_NAME = re.compile(r"^.+ - \d{4}-\d{2}-\d{2} \d{2}-\d{2}( \(\d+\))?$")


def _shape_of(shared):
    """What a take has in the cloud folder: "mix", "tracks", "both" or None."""
    shared = shared or {}
    parts = {k for k in ("mix", "tracks") if shared.get(k)}
    return _shape_from(parts)


def _shape_from(parts):
    if parts == {"mix", "tracks"}:
        return "both"
    return next(iter(parts), None)


def _with(shape, other):
    """Both shapes at once: an automatic copy adds what the setting asks for
    to what is already there, and never takes away what somebody sent."""
    parts = set()
    for s in (shape, other):
        parts |= {"mix", "tracks"} if s == "both" else ({s} if s else set())
    return _shape_from(parts)


def _timestamp_suffix(created_at):
    """'2026-09-18T19:00:00' -> '2026-09-18 19-00' for folder names."""
    try:
        date, clock = created_at.split("T")
        return f"{date} {clock[:5].replace(':', '-')}"
    except Exception:
        return time.strftime("%Y-%m-%d %H-%M")


def _unique_path(path):
    """Adds ' (2)', ' (3)'… if something already sits at that name."""
    if not path.exists():
        return path
    counter = 2
    while True:
        candidate = path.with_name(f"{path.name} ({counter})")
        if not candidate.exists():
            return candidate
        counter += 1


def _free_copy_name(base, lands, taken):
    """
    What a take's copies in the cloud folder are called: `base` ("03 - Polyn"),
    or `base` with " (2)", " (3)"… after it, as _unique_path names a folder,
    the first whose copies (`lands(name)`, relative to the cloud folder) are
    on no path another take names as its copy (`taken`, Library.cloud_paths).
    Compared as the library compares them, paths_overlap, blind to case.

    Within one rehearsal two takes never get one name, their numbers being
    different. Two rehearsals can be filed under one folder name, though (one
    pointed by Locate at a folder named like the other's), and a take nobody
    named in each, "Take 1", would then be written onto the other's copy.
    """
    name, counter = base, 2
    while any(paths_overlap(p, t) for p in lands(name) for t in taken):
        name, counter = f"{base} ({counter})", counter + 1
    return name


def _identities(record):
    """
    What a holding entry's record says it holds, as a list of identities: a
    take {"kind": "take", "rehearsal_id", "take_number"}, a rehearsal
    {"kind": "rehearsal", "rehearsal_id", "folder"}, a draft {"kind":
    "draft", "draft", "rehearsal_id"}. One, or for takes removed together
    a list of them. A rehearsal is known by its id, which a rename does not
    change; "folder" and "draft" are relative to the recordings folder.
    """
    item = (record or {}).get("item") if isinstance(record, dict) else None
    if isinstance(item, list):
        return [i for i in item if isinstance(i, dict)]
    return [item] if isinstance(item, dict) else []


def _same_draft(a, b):
    """Two draft identities are one draft: the same folder name in the same
    rehearsal, wherever a rename has put it; with no rehearsal to go by, the
    same path."""
    rehearsal = a.get("rehearsal_id")
    if rehearsal is not None and rehearsal == b.get("rehearsal_id"):
        return PurePosixPath(a.get("draft") or "").name == PurePosixPath(b.get("draft") or "").name
    return bool(a.get("draft")) and a.get("draft") == b.get("draft")


def _removals_kept(kept):
    """
    The one start problem for removals kept in the holding folder (_end_all),
    each named by its folder with what becomes of it: tried again at the
    next start, or, for one whose record cannot be read, nothing the app can
    ever do, since it cannot tell where it came from.
    """
    where = trash_name()
    if len(kept) == 1:
        said = ["Something that was being removed could not be put back or moved "
                f"to {where}, so it is kept as it is."]
    else:
        said = [f"{len(kept)} things that were being removed could not be put back "
                f"or moved to {where}, so they are kept as they are."]
    for k in kept:
        if k["error"] == holding.UNREADABLE:
            said.append(f"“{k['folder']}”: its record cannot be read, so the app cannot "
                        "tell where it came from. Anything in it you need can be moved "
                        "out of that folder.")
        else:
            said.append(f"“{k['folder']}” ({k['error']}): it will be tried again next time.")
    return " ".join(said)


def _ends(new, was):
    """
    Whether removing `new` ends a waiting entry of `was`, both identities.
    Two entries of one item could each be undone over the other, so the
    older goes on to the Trash first: a take ends its own earlier entries (a
    crop of it among them, which carries the take's identity); a rehearsal
    every entry of it, its takes' and its drafts'; a draft its own.
    """
    kind = new.get("kind")
    if kind == "take":
        return (was.get("kind") == "take" and new.get("rehearsal_id") is not None
                and was.get("rehearsal_id") == new.get("rehearsal_id")
                and was.get("take_number") == new.get("take_number"))
    if kind == "rehearsal":
        rehearsal = new.get("rehearsal_id")
        if rehearsal is not None and was.get("rehearsal_id") == rehearsal:
            return True
        folder = (new.get("folder") or "").rstrip("/")
        draft = was.get("draft") or ""
        return was.get("kind") == "draft" and bool(folder) and draft.startswith(folder + "/")
    if kind == "draft":
        return was.get("kind") == "draft" and _same_draft(new, was)
    return False


def _broken_off(record):
    """Whether an entry's record says an Undo was under way and did not
    finish: its end moves files back into the item's places (_finish_undo,
    _end_uncrop), or for a crop undone sends on what it left."""
    return isinstance(record, dict) and (record.get("rows") == "restoring"
                                         or bool(record.get("undone")))


def _shared_of(takes):
    """What each of these takes has in the cloud folder, for a removal's
    record: [{"mix"?, "tracks"?}], absolute. The copies stay while the Undo
    waits, so Undo has nothing to send again; the end takes them out."""
    return [{k: t["cloud"][k] for k in ("mix", "tracks") if (t.get("cloud") or {}).get(k)}
            for t in takes if _shape_of(t.get("cloud"))]


def _kept_by_crop(mark, start, end):
    """Whether a crop of [start, end] keeps this mark: one on the region's
    edges is kept. Undo of the crop asks the same question (_uncut_marks)."""
    return start <= mark["at"] <= end


def _mark_key(mark):
    label = mark.get("label_id")
    return (round(float(mark["at"]), 2), label if isinstance(label, int) else -1,
            str(mark.get("note") or ""))


def _uncut_marks(record, current):
    """
    A take's marks once its crop is undone, from those it has now: every
    mark the crop dropped, as it was; every mark it kept and moved, as it
    was before (a kept mark changed or deleted since stays as it is now);
    and a mark placed since the crop, at t, back at t + start, where t is in
    the uncut take. `record` is the crop's (crop_take): "markers" before the
    crop, "start" and "end".
    """
    start, end = float(record["start"]), float(record["end"])
    moved = {}
    out = []
    for m in record.get("markers") or []:
        if _kept_by_crop(m, start, end):
            moved.setdefault(_mark_key({**m, "at": m["at"] - start}), []).append(m)
        else:
            out.append(m)
    for m in current:
        was = moved.get(_mark_key(m))
        out.append(was.pop(0) if was else {**m, "at": round(m["at"] + start, 2)})
    return sorted(out, key=lambda m: m["at"])


def _same_marks(a, b):
    """Two lists of marks are the same marks, in any order."""
    return sorted(map(_mark_key, a)) == sorted(map(_mark_key, b))


def _put_back_error(e):
    """What an Undo that could not put something back answers: a place
    taken is said as it is, anything else as what went wrong."""
    return str(e) if isinstance(e, FileExistsError) else f"Could not put it back: {e}"


# What an Undo answers when it went part way and could not be taken back
# either: what is where is recorded, and the next end finishes it
# (_end_uncrop), the notice ending first (end_trash).
FINISHING = "It is being put back; it will be finished when the notice goes."

# What an Undo, delete or discard of an item answers while it is being
# cropped (Api._start_crop).
CROPPING = "Wait until the crop is done."

# What an Undo answers, with "back", once what went is back where it was:
# by its Undo, or by an end that put it back (Api._put_back). Not that it
# has gone to the Trash, which an Undo too late answers (holding.gone_text).
BACK = "It is back where it was."


def _with_icons(files, icon_of):
    """A take's files, each with the icon `icon_of` has for its name, so the
    take keeps it. The Backing track keeps none: its kind says what it is."""
    return [
        {**f, "icon": icon_of[f["name"]]}
        if f.get("kind") != "backing" and icon_of.get(f["name"]) else f
        for f in files
    ]


def _take_dir_name(take_number, name):
    """What a take's folder is called: "03 - Polyn 3"."""
    return f"{int(take_number):02d} - {_safe_name(name)}"


def _dirs_of(take):
    """The folders a take's files are in, its audio's and its notes'. A take of
    nothing but notes has no audio to find its folder by."""
    files = [*take["tracks"], *(take.get("notes") or [])]
    return {Path(f["file"]).parent for f in files if f.get("file")}


def _carries(dir_name, expected):
    """
    Whether a folder named `dir_name` carries the name `expected`: it is
    that name, or that name with " (2)" after it, which _unique_path gives a
    take whose name was taken. Renaming such a folder would only land on
    " (2)" again, on every open.
    """
    return (dir_name == expected
            or re.fullmatch(re.escape(expected) + r" \(\d+\)", dir_name) is not None)


def _songs_of(takes):
    """
    What was played, as [{"name", "takes", "take_numbers"}] in the order
    things were first played. `take_numbers` is which takes they were, for
    the rehearsal's own overview, so the interface is handed the grouping
    rather than working it out again. A take's song is stored with it (see
    store/names.py), so this only counts.

    Takes nobody named are left out. "Take ×4" beside a take count that
    already says four is noise, and a rehearsal where nothing was named is
    better off saying nothing at all.
    """
    songs, by_title = [], {}
    for take in takes:
        title = take.get("song")
        if title is None:
            continue
        if title in by_title:
            by_title[title]["takes"] += 1
            by_title[title]["take_numbers"].append(take.get("take_number"))
        else:
            song = {"name": title, "takes": 1, "take_numbers": [take.get("take_number")]}
            by_title[title] = song
            songs.append(song)
    return songs


def _runs_of(takes):
    """
    The evening as it was played, for the strip history draws of a
    rehearsal: the takes in order, in runs of goes at the same song, as
    [{"song", "takes": [{"duration_sec", "starred"}]}]. A song played, left and
    come back to is two runs, since that is how the evening went. "song" is
    None for takes nobody named; "starred" is a take somebody starred.
    """
    runs = []
    for take in takes:
        song = take.get("song")
        go = {"duration_sec": take.get("duration_sec") or 0,
              "starred": bool(take.get("starred"))}
        if runs and runs[-1]["song"] == song:
            runs[-1]["takes"].append(go)
        else:
            runs.append({"song": song, "takes": [go]})
    return runs


def _go_at(rehearsal, take):
    """A take with the rehearsal it was played at, for playing it from a
    screen that is not that rehearsal's."""
    return {"folder": rehearsal["folder"], "rehearsal": rehearsal["name"],
            "created_at": rehearsal["created_at"], "take": take}


# History's three views (save_history_view), and how its Marks view groups
# a label's marks (save_marks_grouping); the first of each is the default.
HISTORY_VIEWS = ("rehearsals", "songs", "marks")
MARKS_GROUPINGS = ("rehearsal", "song", "list")

# A take shorter than this, with no ★ and no marks, is a false start on the
# rehearsal screen; Settings moves it within these bounds (set_false_start).
FALSE_START_SEC = 30
FALSE_START_MIN = 5
FALSE_START_MAX = 120


def _plays_of(goes):
    """
    What the play button on a song's page plays, from its goes as
    Library.goes_of gives them (newest rehearsal first, the order played
    within one): the newest ★ go, or with none the last go at the newest
    rehearsal. Only rehearsals on disk count, as for last_time's "plays";
    with none, None. In _go_at's shape.
    """
    on_disk = [g for g in goes if not g["missing"]]
    if not on_disk:
        return None
    pick = next((g for g in on_disk if g["take"].get("starred")), None)
    if pick is not None:
        # The newest rehearsal with a ★, and its later ★ go in the evening.
        pick = [g for g in on_disk
                if g["folder"] == pick["folder"] and g["take"].get("starred")][-1]
    else:
        pick = [g for g in on_disk if g["folder"] == on_disk[0]["folder"]][-1]
    return {"folder": pick["folder"], "rehearsal": pick["rehearsal"],
            "created_at": pick["created_at"], "take": pick["take"]}


def _last_attempt(takes, song, before=None):
    """
    How long the latest go at `song` among `takes` ran, as {"song",
    "duration_sec"}, or None when there was none. The recording screen says
    it under its clock — "Vesna took 2:21 last time" — so the band can see
    how far into the song they are, and the screen after a take measures the
    take against it.

    With no go tonight it is `before()`, the go before tonight
    (Api._go_before_tonight, in _go_at's shape), with the day it was played:
    "Took 3:05 on 28 Sep". A function, so it is only looked up when wanted.
    """
    if song is None:
        return None
    goes = [t for t in takes if t.get("song") == song]
    if goes:
        return {"song": song, "duration_sec": goes[-1].get("duration_sec")}
    first = before() if before is not None else None
    if first is not None:
        return {"song": song, "duration_sec": first["take"].get("duration_sec"),
                "created_at": first["created_at"]}
    return None


def _field_text(named):
    """What the name field holds for a take resolved to `named`
    (Library.resolve_name): the song's title, its go shown beside it rather
    than typed into it; or "Take N" for a take nobody named."""
    return named["song"] or named["name"]


def _takes(takes):
    """'1 take', '12 takes': how many a names pass has to look at."""
    return "1 take" if len(takes) == 1 else f"{len(takes)} takes"


def _folder_bytes(folder):
    """
    How much of the disk a folder is using, walked rather than worked out from
    the durations: a take encoded differently, one that never finished, or one
    somebody moved makes any such guess wrong, and this number sits next to a
    Delete button, where wrong is not good enough.

    Only metadata is read, never a file, so this stays cheap enough to run for
    every rehearsal each time History opens. Anything that cannot be measured
    — a file that disappears mid-walk, a folder that cannot be opened — is
    skipped rather than raised: the history list must still come back.
    """
    total = 0
    stack = [str(folder)]
    while stack:
        try:
            with os.scandir(stack.pop()) as entries:
                for entry in entries:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                        elif entry.is_file(follow_symlinks=False):
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        continue
        except OSError:
            continue
    return total


def _write_text(path, text):
    """Always UTF-8. Left to the default, Windows writes cp1252, which has no
    Cyrillic: a take named "Полынь" failed to save with UnicodeEncodeError."""
    Path(path).write_text(text, encoding="utf-8")


def _is_inside(path, root):
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
        return True
    except ValueError:
        return False


def _same_folder(a, b):
    """Whether two paths are one folder on disk.

    Comparing them as text is right only where the filesystem reads them
    that way. A Mac's does not, and neither does Windows: a folder renamed
    "Other" to "other" in Finder is the same folder, while the record still
    spells it the old way. `WindowsPath` happens to ignore case, so text
    comparison holds there by accident; `PosixPath` does not, and on a Mac
    the two names look like two folders. Where both are really on disk the
    filesystem itself is asked, which needs no guess about the platform;
    where one is missing there is nothing to ask, and the text is all there
    is.
    """
    if a == b:
        return True
    try:
        return a.samefile(b)
    except OSError:
        return False


def _folder_within(inner, outer):
    """Whether `outer` holds `inner`, at any depth — asking the filesystem
    the way `_same_folder` does, so a folder above that differs only in case
    still counts."""
    return any(_same_folder(p, outer) for p in inner.parents)


def _copy_detail(what, res):
    """What a finished cloud copy came to, in words: "MP3 of the mix", or
    "MP3 of the mix, WAV of every track" when they came out differently."""
    shared = res.get("cloud") or {}
    mix = (shared.get("mix_format") or "wav").upper()
    tracks = (shared.get("tracks_format") or "wav").upper()
    if what == "mix":
        said = f"{mix} of the mix"
    elif what == "tracks":
        said = f"{tracks} of every track"
    elif mix == tracks:
        said = f"{mix} of the mix and every track"
    else:
        said = f"{mix} of the mix, {tracks} of every track"
    note = f". {res['note']}" if res.get("note") else ""
    return f"{said}{note}"


def _channels_of(tracks):
    """How many channels these tracks write: a stereo track is two, and a
    track that only records MIDI writes none."""
    return sum(2 if t.get("stereo") else 1 for t in tracks if records_audio(t))


def _is_output_choice(channels):
    """A pair of outputs the way cards label them — 1–2, 3–4, 5–6 — or one
    output on its own. 2–3 is refused: no card wires its stereo outs that
    way, and offering it would only double the list."""
    if not isinstance(channels, (list, tuple)):
        return False
    if not all(isinstance(c, int) and not isinstance(c, bool) and c >= 1
               for c in channels):
        return False
    if len(channels) == 1:
        return True
    return (len(channels) == 2 and channels[0] % 2 == 1
            and channels[1] == channels[0] + 1)


def _follows(method):
    """After `method`, which can change what the next take is (a take renamed,
    deleted or put back, songs merged), the metronome's row follows its name."""
    @functools.wraps(method)
    def call(api, *args, **kwargs):
        result = method(api, *args, **kwargs)
        if isinstance(result, dict) and result.get("ok"):
            api._follow_next()
        return result
    return call


class _LiveLibrary:
    """
    The library as the metronome asks it: whichever is open now, as a new
    recordings folder chosen in Settings opens another. With none open, or one
    that cannot answer, a name leads to no song, which the row shows as none.
    """

    def __init__(self, api):
        self._api = api

    def tempo_for(self, name):
        library = self._api._library
        if library is None:
            return {"song": None, "last_take": None}
        try:
            return library.tempo_for(name)
        except Exception:
            log.exception("The metronome could not read the next take's song")
            return {"song": None, "last_take": None}

    def set_song_tempo(self, song_id, tempo, signature):
        return self._api._lib.set_song_tempo(song_id, tempo, signature)


class _TapPorts:
    """
    The band's MIDI ports for Tap on a song's page, whose pads' hits count as
    taps until a pause (spec Part 11). In a rehearsal, or while the signal
    check has them, they are open already. Otherwise Tap opens them through
    the rehearsal's own rig, as the check does, and gives them back after the
    pause: a second rig would miss the controller's port, kept out of the
    rig's, and on Windows a port opens only once. The check and a rehearsal
    take over ports Tap opened, and Tap then leaves them to them.
    """

    def __init__(self, midi, in_rehearsal):
        self._midi = midi
        self._in_rehearsal = in_rehearsal
        self._lock = threading.Lock()
        # Whether Tap opened the ports itself, to give back after the pause
        # (_give_back, on a thread of its own), and whether the check has them.
        self._opened = False
        self._checking = False
        self._watch = None

    def listen(self, tracks):
        """Tap was pressed: the pads' hits count as taps from now until a
        pause, from the ports `tracks` name when none are open. Raises what
        opening them raises, with none of them left open."""
        with self._lock:
            if not self._opened and not self._checking and not self._in_rehearsal():
                try:
                    self._midi.use(tracks)
                except Exception:
                    # Nothing would give back a port left open here.
                    try:
                        self._midi.release()
                    except Exception:
                        log.exception("The ports Tap opened could not be closed")
                    raise
                self._opened = True
            self._midi.listen_taps(TAP_QUIET_SEC)
            if self._opened and (self._watch is None or not self._watch.is_alive()):
                self._watch = threading.Thread(target=self._give_back, name="tap ports", daemon=True)
                self._watch.start()

    def take_over(self, use, checking=False):
        """The signal check (`checking`) or a rehearsal opens its ports with
        `use()`, and has them from now on, whatever Tap opened before."""
        with self._lock:
            self._opened = False
            self._checking = self._checking or checking
            use()

    def check_over(self):
        """The signal check is over."""
        self._checking = False

    def _give_back(self):
        """Waits for the pause that ends Tap's listening, then closes the
        ports Tap opened, unless a rehearsal or the check has them now."""
        while True:
            time.sleep(TAP_POLL_SEC)
            with self._lock:
                if self._midi.listening():
                    continue
                if self._opened and not self._checking and not self._in_rehearsal():
                    try:
                        self._midi.release()
                    except Exception:
                        log.exception("The ports Tap opened could not be closed")
                self._opened = False
                return


class Api:
    def __init__(self, server_port=0, on_step=lambda text: None):
        """
        `on_step(text)` is told each part of starting that can take a while,
        in the words the startup screen shows (app.py).
        """
        self._config_lock = threading.RLock()
        self._transport = Transport(self)
        # Python adapters use controls; the webview exposes only the explicit
        # control_* bridge methods, without traversing the service's internals.
        self._transport._serializable = False
        self._recorder = None
        # The laptop and its screen stay awake while a take records, and a
        # take hears the system going to sleep anyway (platform_support).
        self._awake = KeepAwake()
        self._sleep_watch = SleepWatch(self._laptop_sleeping)
        self._cloud_queue = cloudmod.PublishQueue(
            step=self._publish_step, paused=lambda: self._recorder is not None
        )
        self._recorder_take_number = None
        self._recorder_temp_dir = None
        # The band the take began with, so that Stop reads the tracks it
        # recorded and not the session's as they are by then.
        self._recorder_band = None
        # True while a Stop writes its take's files, the recorder already let
        # go of: no take or check may begin until it is done (stop_take).
        self._stopping = False
        self._session = None
        self._monitor = None
        # The MIDI ports of the signal check and of the rehearsal, kept open
        # between takes so that what an instrument has set is in the next one.
        # No port is opened until a check or a rehearsal asks.
        on_step("Starting MIDI…")
        system, midi_error = open_midi_system()
        self._midi_system = system
        self._controller_system = midiports.open_controller_system(system)
        self._controller = Controller(self._controller_system, self.controls, threads=MIDI_THREADS)
        self._midi = MidiRig(system, midi_error, threads=MIDI_THREADS)
        # Settings › Under the hood's check of the interface; see probe.py.
        self._check = InterfaceCheck()
        self._player = None
        # What the open player was opened with, so a step that has to let go of
        # the files can put back exactly the take that was playing.
        self._open_tracks = None
        self._player_lock = threading.RLock()
        # Long work — cloud copies, crops, a take being saved or recovered —
        # and how far along it is, for the header of every screen.
        self._journal = activitymod.Journal()
        # The journal entry of each take waiting to be copied, by (folder,
        # take number): one however many times it is asked for.
        self._cloud_entries = {}
        self._cloud_lock = threading.Lock()
        self._window = None
        # Renaming a take's files and putting names right do not run over
        # each other's folders.
        self._files_lock = threading.RLock()
        # The takes and drafts being cropped (_start_crop), by identity.
        self._cropping = []
        # The removals whose item is back where it was, by token: an Undo,
        # or an end, put it back (_put_back). Its Undo asked again says so
        # (_too_late), rather than that it has gone to the Trash.
        self._back = set()
        # Takes whose folder or cloud copy no longer carries their name are
        # renamed in the background — see names_pass.py.
        self._names_pass = NamesPass(
            find=self._names_out_of_line, fix=self._put_name_right,
            busy=self._names_must_wait, journal=self._journal,
        )

        self._config = self._read_config()
        # The metronome: the row's tempo, the click between takes, and its
        # settings, kept in this same config (metronome.py). Its two getters
        # take no lock of this side's: see its note on the locks.
        self._metronome = Metronome(
            self._config, self._write_config, lambda: self._player,
            lambda key: saved_device(self._config, key, False), _LiveLibrary(self),
        )
        # A song's backing track around its takes (backing.py): its settings,
        # the row's state, ▶ and what a take plays. In the metronome's locks.
        # The Trash is looked up when it is used, as the suites replace it.
        self._backing = Backing(
            self._config, self._write_config, lambda: self._lib, lambda: self._player,
            self._metronome, lambda: self._recordings_dir, self._next_recording,
            lambda path: move_to_trash(path, self._recordings_dir),
        )
        # Whether the player plays a take's click with it (Master's button):
        # off when the app starts, then as left from one take to the next.
        self._player_click = False
        # Each stopped take's tempo, signature and whether it clicked, by its
        # draft's folder, until it is kept (_meter_of_draft), and the one
        # recording now.
        self._meters = {}
        self._recorder_meter = None
        # The song the take recording now was named for, None for none.
        self._recorder_song_id = None
        # True from Record opening the take's streams until the recorder is
        # kept: a rescan in between would let go of streams the take holds.
        self._starting = False
        # The drift lines counted lately, by their files and aim (take_drift),
        # and a number Record moves on, which stops a count in progress.
        self._drifts = collections.OrderedDict()
        self._drifts_lock = threading.Lock()
        self._drift_round = 0
        # The counts under way, by the same key: a second ask for a take
        # waits for the first's answer (take_drift).
        self._drifts_counting = {}
        # The band's ports for Tap on a song's page, outside a rehearsal.
        self._tap = _TapPorts(self._midi, lambda: self._session is not None)
        # Whether a newer version is out — see updates.py. Asked only once the
        # window is up, and never while a take records.
        self._updates = updates.UpdateChecker(
            __version__,
            enabled=lambda: bool(self._config.get("check_updates", True)),
            busy=lambda: self._recorder is not None,
            state=CONFIG_PATH.with_name("update.json"),
            tag=os.environ.get("REHA_UPDATE_TAG") or None,
        )
        self._microphone_asked = False
        self._recordings_dir = Path(
            self._config.get("recordings_dir") or RECORDINGS_ROOT
        )
        self._recordings_dir.mkdir(parents=True, exist_ok=True)

        # What went wrong while starting, for the interface to say once.
        on_step("Opening your rehearsals…")
        self._library = None
        self._library_error = None
        self._problems = []
        error = self._open_library()
        if error is not None:
            self._library_error = error
            self._problems.append({"name": "LibraryUnavailable", "message": error})

        # Serves both the interface itself and the .wav files — see
        # mediaserver.py for why not file://.
        # The server also answers the calls the interface polls — see
        # mediaserver.py for why those must not go over the pywebview bridge.
        self._server = AppServer(
            UI_DIR, self._recordings_dir, api=self, port=server_port
        )

        # A removal still waiting for its Undo when the app last stopped (it
        # died, or the Trash refused at quit) goes on to the Trash now, with
        # the cloud copies its record names; one the app died in the middle
        # of goes back, or its Undo is finished (see _end). Before the cleanup
        # below, which leaves alone a rehearsal something of which is waiting.
        # One that can do neither is kept, and said once.
        self._end_all(at_start=True)

        # Clear out leftovers from previous runs (rehearsal started, nothing
        # recorded, app closed).
        self.cleanup_empty_rehearsals()
        selected = self._config.get("controller")
        if isinstance(selected, dict) and isinstance(selected.get("input"), dict) and isinstance(selected.get("output"), dict):
            self._midi.reserve_controller(selected["input"])
            self._controller.configure(selected)

    def attach_window(self, window):
        """Needed for native dialogs (folder picker)."""
        self._window = window
        # Only the real app runs the worker. The suites drive run_next
        # themselves, so nothing races them.
        self._cloud_queue.start()
        self._names_pass.start()
        self._sleep_watch.start()
        self._sweep_empty_cloud_dirs_later()

    def shutdown(self):
        """
        The window has closed.

        A take still recording lets go of its card and its files at once,
        rather than recording on while Python shuts down around it; it is left
        as raw files, offered as an unsaved take next time (see
        AudioRecorder.abandon for why it is not finished here). The signal
        check and the player let go of their cards too — on the audio thread,
        while it is still there to do it. Then the publishing worker is stood
        down instead of being killed wherever it happens to be.
        """
        # The controller's own system first: an open of a controller that is
        # off gives up as soon as its system closes (winrt_ports.py), so the
        # controller's thread stops at once and not when the open would have.
        if self._controller_system is not None and self._controller_system is not self._midi_system:
            self._controller_system.close()
        self._controller.close()
        recorder, self._recorder = self._recorder, None
        if recorder is not None:
            try:
                recorder.abandon()
            except Exception as e:
                print(f"[shutdown] letting go of the take: {e}")
        self._awake.release()
        self._sleep_watch.stop()
        self.stop_monitor()
        # A take's notes stay for the drafts, as its audio does; then the
        # ports close, the rig's threads stop and the MIDI system is let go.
        # Each on its own: one that fails does not keep the other from running.
        for let_go in (self._midi.abandon_take, self._midi.shutdown):
            try:
                let_go()
            except Exception as e:
                print(f"[shutdown] letting go of the MIDI ports: {e}")
        # The click between takes stops with the window, its stream closed.
        try:
            self._metronome.close()
        except Exception as e:
            print(f"[shutdown] stopping the click: {e}")
        try:
            self._backing.close()
        except Exception as e:
            print(f"[shutdown] stopping the backing track: {e}")
        self._close_player()
        self._cloud_queue.stop()
        self._names_pass.stop()
        self._updates.stop()
        # A rename the pass had under way finishes before the library closes.
        held = self._files_lock.acquire(timeout=10)
        try:
            # The notice offering Undo closes with the window, so whatever
            # waits for one goes on to the Trash now. Not without the lock:
            # whatever holds it is moving files, and the next start sends
            # them on instead.
            if held:
                self._end_all()
            if self._library is not None:
                self._library.close()
        finally:
            if held:
                self._files_lock.release()

    # ---------- the database ----------

    def _open_library(self, recordings_dir=None):
        """
        The recordings folder's database, opened and brought up to date, with
        any old session.json files moved into it. When it cannot be used — a
        newer app's database, a migration that failed — the reason is kept and
        everything that needs the history says so, rather than the app not
        starting: Settings still work, and another folder can be chosen.
        Returns the error message, or None.
        """
        library, error = self._new_library(recordings_dir or self._recordings_dir)
        if error is None:
            self._install_library(library)
        return error

    def _new_library(self, folder):
        """(the folder's Library, None), or (None, why it cannot be used)."""
        try:
            # The band's icons are given to the takes of a database from
            # before takes kept their own (migration 0010), once, and to an
            # old session.json's brought in after it.
            return Library(Path(folder), cloud_dir=lambda: self._cloud_dir,
                           icons=layouts.icons(self._config.get("tracks"))), None
        except LibraryUnavailable as e:
            logging.getLogger(__name__).error("recordings database: %s", e, exc_info=True)
            return None, str(e)

    def _install_library(self, library):
        """`library` in use from now on, the one before it closed, and any old
        session.json files of its folder moved into it."""
        if getattr(self, "_library", None) is not None:
            self._library.close()
        self._library, self._library_error = library, None
        import_all(library, self._cloud_dir, report=self._report_import_failure)

    def _report_import_failure(self, folder, e):
        """An old session.json that could not be read: it stays where it is
        for the next start, and the interface says so once."""
        logging.getLogger(__name__).error(
            "could not import %s", folder, exc_info=(type(e), e, e.__traceback__)
        )
        self._problems.append({
            "name": type(e).__name__,
            "message": f"Could not read the history of “{Path(folder).name}”: {e}. "
                       "The file was left as it is and will be tried again next time.",
        })

    def startup_problems(self):
        """What went wrong while starting, each said once: returned, then
        forgotten."""
        problems, self._problems = self._problems, []
        return problems

    def log_problem(self, where, name, message, stack=""):
        """
        A problem raised in the page itself, written to the crash log.

        The red bar says every problem's whole error is in crash.log. One a
        call into Python raised is: pywebview logs it. One the page raised (a
        notice's callback that threw, an Undo that failed in the page after
        Python answered) never passed through here, so the page sends it,
        once for each problem it lists or counts. It goes as one ERROR record
        through this module's logger, which the crash log's handler keeps
        (app._arm_crash_log).

        Never raises and answers nothing: each part is made text and cut to
        PAGE_PROBLEM_CHARS, and a failure here is dropped. Writing a problem
        down must not make another.
        """
        try:
            parts = [_page_problem_text(v) for v in (where, name, message, stack)]
            where, name, message, stack = parts
            log.error("problem in the page, in %s: %s: %s%s",
                      where, name, message, f"\n{stack}" if stack else "")
        except Exception:  # noqa: BLE001 - never let logging make a problem
            pass

    @property
    def _lib(self):
        if self._library is None:
            raise LibraryUnavailable(self._library_error or "The recordings database is not open")
        return self._library

    @property
    def ui_url(self):
        return self._server.base_url

    @property
    def ui_available(self):
        return self._server.ui_available

    @property
    def recordings_dir(self):
        return self._recordings_dir

    # ---------- settings ----------

    def _read_config(self):
        # Every read is migrated, so the rest of the app only ever sees
        # `layouts` — see rehearsal_recorder/layouts.py. Migration is
        # idempotent, so a config written by this version passes through it
        # unchanged.
        if not CONFIG_PATH.exists():
            return layouts.migrate({})
        try:
            data = json.loads(read_text(CONFIG_PATH))
            return layouts.migrate(data if isinstance(data, dict) else {})
        except Exception:
            return layouts.migrate({})

    def _write_config(self):
        # Written beside the real file and moved onto it, so an app killed
        # mid-write leaves the old settings rather than half of new ones.
        # os.replace is atomic on every system we ship on.
        with self._config_lock:
            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            writing = CONFIG_PATH.with_name("config.json.writing")
            _write_text(writing, json.dumps(self._config, ensure_ascii=False, indent=2))
            os.replace(writing, CONFIG_PATH)

    def _remember_device(self, key, index):
        """Saves a device choice as its index and what it is. `key` is
        "device" or "output_device"; see audio.devices.saved_device."""
        self._config[f"{key}_index"] = index
        self._config[key] = device_identity(index)

    def get_settings(self):
        return {
            "recordings_dir": str(self._recordings_dir),
            "default_recordings_dir": str(RECORDINGS_ROOT),
            "device_index": saved_device(self._config, "device", True),
            "missing_device": self._missing_device(),
            "samplerate": int(
                self._config.get("samplerate") or DEFAULT_SAMPLERATE
            ),
            "bit_depth": normalize_depth(self._config.get("bit_depth")),
            "supported_bit_depths": list(SUPPORTED_DEPTHS),
            "volumes": self._config.get("volumes", {}),
            # How loud takes play back. The header's slider shows it before
            # any take is open; player_open applies it to the one that opens.
            "master_volume": self._config.get("master_volume", 1.0),
            "theme": self._config.get("theme", "dark"),
            "ui_scale": self._config.get("ui_scale", 1),
            # Settings › Keys: Space and Esc, and the player's keys. Only
            # false turns them off; anything else written by hand reads as on.
            "space_keys": self._config.get("space_keys") is not False,
            "player_keys": self._config.get("player_keys") is not False,
            # Which of History's views it opens on: the one used last.
            "history_view": (self._config.get("history_view")
                             if self._config.get("history_view") in HISTORY_VIEWS
                             else "rehearsals"),
            # How History's Marks view groups a label's marks.
            "marks_grouping": (self._config.get("marks_grouping")
                               if self._config.get("marks_grouping") in MARKS_GROUPINGS
                               else "rehearsal"),
            "output_device_index": saved_device(
                self._config, "output_device", False
            ),
            "output_channels": list(self._output_channels()),
            "cloud_dir": self._config.get("cloud_dir"),
            "cloud_format": normalize_format(self._config.get("cloud_format")),
            "cloud_formats": CLOUD_FORMATS_INFO,
            "auto_publish": bool(self._config.get("auto_publish", False)),
            "auto_publish_what": self._config.get("auto_publish_what") or "mix",
            # The set picked beside Start rehearsal, kept until another is
            # picked; one deleted since reads as none.
            "next_set": self._next_set(),
            # How short a take is to count as a false start (issue #12 step 7).
            "false_start_sec": self._false_start_sec(),
            "check_updates": bool(self._config.get("check_updates", True)),
            "encoder": encoder_available(),
            "encoder_hint": (
                None if encoder_available() else missing_encoder_hint()
            ),
            "trash_kind": trash_kind(),
            "fallback_trash": FALLBACK_TRASH,
            "path_warning": describe_path_limit(self._recordings_dir),
            "server_url": self._server.base_url,
            "config_path": str(CONFIG_PATH),
            "version": __version__,
            # Settings › Metronome and the gear in the row: where the click
            # is heard, its sound, the count-in and the switch.
            **self._metronome.settings(),
            # And the backing track's: where it is heard, its volume, its
            # switch, and whether the row shows it.
            **self._backing.settings(),
        }

    # ---------- Settings › Under the hood ----------

    def _own_files(self):
        """The app's own files, by the key the window asks for them with."""
        return {
            "settings": Path(CONFIG_PATH),
            "history": self._recordings_dir / DB_NAME,
            "crash_log": Path(CRASH_LOG),
        }

    def under_the_hood(self):
        """
        What this copy of the app runs on and where it keeps things, for the
        page a person opens when something has gone wrong: asked of the
        machine now, each part on its own, so one that cannot be answered
        leaves the rest standing.
        """
        apis, devices = [], []
        try:
            with STREAM_LOCK:
                apis = list(sd.query_hostapis())
                devices = list(sd.query_devices())
        except Exception as e:  # noqa: BLE001
            print(f"[hood] audio systems: {e}")

        recording = None
        index = saved_device(self._config, "device", True)
        if index is not None and index < len(devices):
            d = devices[index]
            api = d.get("hostapi", -1)
            recording = {
                "name": d["name"],
                "host_api": apis[api]["name"] if 0 <= api < len(apis) else "",
                "inputs": d.get("max_input_channels", 0),
                "samplerate": int(self._config.get("samplerate") or DEFAULT_SAMPLERATE),
                "bit_depth": normalize_depth(self._config.get("bit_depth")),
            }
        elif self._missing_device():
            gone = self._missing_device()
            recording = {"name": gone["name"], "host_api": gone["host_api"],
                         "inputs": 0, "missing": True,
                         "samplerate": int(self._config.get("samplerate") or DEFAULT_SAMPLERATE),
                         "bit_depth": normalize_depth(self._config.get("bit_depth"))}

        out = saved_device(self._config, "output_device", False)
        playback = (devices[out]["name"] if out is not None and out < len(devices)
                    else "System output")

        files = []
        for key, path in self._own_files().items():
            try:
                stat = path.stat()
                exists, size = True, stat.st_size
                modified = datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")
            except OSError:
                exists, size, modified = False, None, None
            files.append({"key": key, "path": str(path), "exists": exists,
                          "size": size, "modified": modified})

        try:
            import soundfile

            libsndfile = soundfile.__libsndfile_version__
        except Exception:  # noqa: BLE001
            libsndfile = None

        frozen = bool(getattr(sys, "frozen", False))
        return {
            "version": __version__,
            "running_as": "built" if frozen else "source",
            "executable": Path(sys.executable).name,
            "system": diagnostics.system_line(),
            "audio": {
                "engine": diagnostics.engine_line(sd),
                "systems": diagnostics.audio_systems(apis, devices),
                "recording": recording,
                "playback": playback,
            },
            "midi": self._midi.ports(),
            "files": files,
            "deleting": trash_kind(),
            "fallback_trash": FALLBACK_TRASH,
            "libsndfile": libsndfile if encoder_available() else None,
            "server_url": self._server.base_url,
            "releases_url": RELEASES_URL,
        }

    def bug_report(self):
        """The text Copy details puts on the clipboard: the page above, the
        band on the card's inputs, the cloud and the last check, as lines
        that survive being pasted anywhere."""
        hood = self.under_the_hood()
        index = saved_device(self._config, "device", True)
        try:
            max_inputs = sd.query_devices(index)["max_input_channels"] if index is not None else 0
            tracks = tracks_for(self._config, device_identity(index), max_inputs)
        except Exception:  # noqa: BLE001
            # No card to place them on: the inputs are unknown (no "channel"
            # at all), but the mode and the port are the band's own.
            tracks = [{"name": t.get("name", "?"), **{k: t[k] for k in ("mode", "midi_port") if k in t}}
                      for t in self._config.get("tracks", [])]
        if not self._config.get("cloud_dir"):
            cloud = "no cloud folder"
        else:
            fmt = normalize_format(self._config.get("cloud_format")).upper()
            what = {"mix": "the mix", "tracks": "the tracks",
                    "both": "the mix and the tracks"}.get(
                self._config.get("auto_publish_what") or "mix", "the mix")
            cloud = (f"sending on, {what} as {fmt}" if self._config.get("auto_publish")
                     else f"a folder is set, sending is off; copies as {fmt}")
        if hood.get("libsndfile"):
            cloud += f"; compressing through libsndfile {hood['libsndfile']}"
        return {"ok": True,
                "text": diagnostics.report_text(hood, tracks, cloud, self._check.state())}

    def show_file(self, which):
        """Opens the folder one of the app's own files is in, with the file
        picked out. Only those: the window names one by its key."""
        path = self._own_files().get(which)
        if path is None:
            return {"ok": False, "error": "Not one of the app's own files"}
        if not path.exists():
            if not path.parent.is_dir():
                return {"ok": False, "error": "It is not there yet"}
            return reveal_in_file_manager(path.parent)
        return reveal_in_file_manager(path)

    def show_rehearsal_folder(self, folder):
        """Opens a rehearsal's folder in the system's file manager: the
        button in the player's header. Only a rehearsal the library knows,
        since the window names the folder."""
        if not self._lib.has(folder):
            return {"ok": False, "error": "Rehearsal not found"}
        if not Path(folder).is_dir():
            return {"ok": False, "error": "The rehearsal's folder is not on disk"}
        return open_in_file_manager(folder)

    def open_releases(self, latest=False):
        """The releases page, in the browser: the window would open it in
        itself, with no way back. `latest` opens the newest release's own
        page — a fixed address, never one taken from GitHub's answer."""
        import webbrowser

        try:
            webbrowser.open(updates.LATEST_PAGE if latest else RELEASES_URL)
            return {"ok": True}
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": str(e)}

    # ---------- a newer version ----------

    def start_update_checks(self):
        """
        Starts asking whether a newer version is out, once the window is up.
        True when it started.

        Only the built app asks. Run from source, the version is a
        development build's, and the person running it is the one making
        the releases.

        First it reads what the last Restart now did (updates.after_start).
        Just put in place on a Mac, it opens the input for half a second, so
        that macOS asks for the microphone now, with nobody waiting, rather
        than at the first take.

        No parameters: pywebview hands its window to a handler that takes one.
        """
        if not getattr(sys, "frozen", False):
            return False
        came = self._updates.after_start()
        if came["microphone"] and not self._microphone_asked:
            self._microphone_asked = True
            threading.Thread(target=self._ask_for_microphone, name="update-microphone",
                             daemon=True).start()
        self._updates.start()
        return True

    def _ask_for_microphone(self):
        """The input chosen in Settings › Audio, or the system's default,
        opened and closed again. Whatever goes wrong, the take will ask."""
        try:
            with sd.InputStream(device=saved_device(self._config, "device", True), channels=1):
                time.sleep(0.5)
        except Exception:  # noqa: BLE001 — the question comes at the first take instead
            pass

    def update_status(self):
        """{"on": ..., "latest": {"version": ...} or None}, polled over the
        local server like the meters — see mediaserver.POLLABLE.

        The interface asks as soon as it is drawn, which can be before the
        window's loaded event reaches start_update_checks; so the built app
        reads what the last Restart now did here as well (once a run), and
        the first answer can already say "Updated to"."""
        if getattr(sys, "frozen", False):
            self._updates.after_start()
        return self._updates.status()

    def download_update(self):
        """The Download button beside a newer version: fetches its zip into
        Downloads, checks it, and opens the folder with it picked out. How
        far along it is comes back in update_status."""
        return self._updates.start_download()

    def show_update(self):
        """Show in folder, once the newer version's zip is downloaded."""
        return self._updates.show_download()

    def update_now(self):
        """The Update button: gets the newer version ready beside this copy.
        How far along it is comes back in update_status."""
        return self._updates.start_update()

    def restart_to_update(self):
        """
        Restart now: starts the swap, then closes the window as the close
        button would, a moment later so that this answer reaches the
        interface first. The app shuts down as it always does.
        """
        said = self._updates.restart()
        if said.get("ok") and self._window is not None:
            timer = threading.Timer(0.3, self._window.destroy)
            timer.daemon = True
            timer.start()
        return said

    def set_check_updates(self, enabled):
        """The switch in Settings. Switched on, it asks soon rather than
        tomorrow."""
        self._config["check_updates"] = bool(enabled)
        self._write_config()
        if enabled:
            self._updates.wake()
        return {"ok": True, "check_updates": self._config["check_updates"]}

    def start_interface_check(self):
        """
        Checks the recording interface the way --audio-probe does, in the
        background: the settings in force first, and if they do not work,
        one change at a time. Never beside a take, and it takes the card from
        the signal check if that has it — an ASIO card is one program's, and
        one stream's, at a time.
        """
        if self._recorder is not None:
            return {"ok": False, "error": "Stop the take first"}
        if self._check.state().get("running"):
            return {"ok": False, "error": "A check is already running"}
        self.stop_monitor()
        try:
            asked = plan_for(sd, self._config)
        except Exception as e:  # noqa: BLE001
            return {"ok": False, "error": f"Could not ask the interface: {e}"}
        if asked is None:
            return {"ok": False, "error":
                    "Nothing chosen yet: pick an interface in Audio"}
        if not self._check.start(sd, asked):
            return {"ok": False, "error": "A check is already running"}
        return {"ok": True}

    def interface_check(self):
        """What the check has found so far, or its verdict once done."""
        return self._check.state()

    def stop_interface_check(self):
        self._check.stop()
        return {"ok": True}

    def set_recordings_dir(self, path):
        folder = Path(path).expanduser()
        if not folder.is_absolute():
            return {"ok": False, "error": "A full path is required"}
        # The folder in use, chosen again (the picker opens on it): no
        # switch, so nothing ends. Its Undos stay, and its library too, and
        # "same" tells the interface to keep their notices.
        if _same_folder(folder, self._recordings_dir):
            return {"ok": True, "recordings_dir": str(self._recordings_dir),
                    "kept": [], "ended": [], "same": True}
        # The rehearsal in progress is kept in the current folder's database;
        # moving to another one under it would leave its next takes nowhere.
        if self._session is not None:
            return {"ok": False,
                    "error": "Finish the rehearsal before changing the recordings folder"}
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return {"ok": False, "error": f"Could not open the folder: {e}"}
        # Opened before anything else changes: a folder whose database cannot
        # be used leaves the current one in use, exactly as it was.
        library, error = self._new_library(folder)
        if error is not None:
            return {"ok": False, "error": error}

        # What waits for its Undo is in the old folder's _deleting, which no
        # Undo can reach from the new one: it goes on first, against the old
        # folder's library (an entry whose rows were never dropped goes back
        # into it), and only then is the new one put in its place, so no
        # removal on another thread reaches the new library meanwhile. One
        # that stays there is named in the answer ("kept", its folder): no
        # start looks in the old folder again, so nothing else ever would.
        ended = []
        with self._files_lock:
            kept = self._end_all(ended=ended)
            self._install_library(library)
            self._recordings_dir = folder
        self._config["recordings_dir"] = str(folder)
        self._write_config()
        # The server hands files to the player, so it has to look at the new
        # folder right away, without restarting the app.
        self._server.set_media_root(folder)
        self._names_pass.request()
        return {"ok": True, "recordings_dir": str(folder),
                "kept": [k["folder"] for k in kept], "ended": ended}

    def choose_recordings_dir(self):
        if self._window is None:
            return {"ok": False, "error": "No window available"}
        try:
            # Imported here, not at module level, so api.py stays importable
            # (and testable) without pywebview installed.
            import webview

            picked = self._window.create_file_dialog(
                webview.FOLDER_DIALOG, directory=str(self._recordings_dir)
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}
        if not picked:
            return {"ok": False, "cancelled": True}
        return self.set_recordings_dir(picked[0])

    def save_mix(self, volumes):
        """Per-track volume by name, so the balance survives between takes."""
        # A fresh dict rather than an update in place: the stored one may be
        # the very object a mixdown on the publishing thread is reading the
        # balance out of, and changing it under that render would tear it.
        current = dict(self._config.get("volumes", {}))
        current.update(volumes or {})
        self._config["volumes"] = current
        self._write_config()
        # The mix carries the balance, so every copy of this rehearsal's takes
        # is now made from something else.
        self._enqueue_session_takes()
        return {"ok": True}

    def save_master_volume(self, volume):
        """How loud takes play back, kept for the next take and the next run.
        Unlike save_mix, nothing is queued for the cloud: the cloud mix is
        made from the faders alone, and this is only the listening level."""
        self._config["master_volume"] = float(min(1.0, max(0.0, volume)))
        self._write_config()
        return {"ok": True}

    def save_history_view(self, view):
        """History's view, Rehearsals, Songs or Marks, kept for the next time it
        opens, after a restart too. In the config rather than the window's
        localStorage: pywebview forgets that when the app closes."""
        if view not in HISTORY_VIEWS:
            return {"ok": False, "error": "Unknown view"}
        self._config["history_view"] = view
        self._write_config()
        return {"ok": True}

    def _next_set(self):
        chosen = self._config.get("next_set")
        if not isinstance(chosen, int) or self._library is None:
            return None
        # Settings asks this too, and opens whatever the library says: it is
        # where another folder is chosen when this one cannot be read.
        try:
            return chosen if self._lib.set_of(chosen) is not None else None
        except Exception:
            return None

    def save_next_set(self, set_id):
        """The set Start rehearsal plays by, or None to play freely: kept
        across restarts, since a band rehearses for a gig over several
        evenings."""
        self._config["next_set"] = int(set_id) if set_id is not None else None
        self._write_config()
        return {"ok": True}

    def save_marks_grouping(self, grouping):
        """How History's Marks view groups a label's marks, By rehearsal, By
        song or One list: one choice for every label, kept as the view is."""
        if grouping not in MARKS_GROUPINGS:
            return {"ok": False, "error": "Unknown grouping"}
        self._config["marks_grouping"] = grouping
        self._write_config()
        return {"ok": True}

    def save_appearance(self, theme, ui_scale):
        if theme in ("dark", "light", "system"):
            self._config["theme"] = theme
        try:
            scale = float(ui_scale)
        except (TypeError, ValueError):
            return {"ok": False, "error": "Invalid scale"}
        if not 0.5 <= scale <= 3:
            return {"ok": False, "error": "Scale out of range"}
        self._config["ui_scale"] = scale
        self._write_config()
        return {"ok": True}

    def save_keys(self, kind, on):
        """Settings › Keys: Space and Esc ("space") or the player's keys
        ("player") turned on or off, kept as space_keys or player_keys."""
        if kind not in ("space", "player"):
            return {"ok": False, "error": "Unknown keys"}
        self._config[f"{kind}_keys"] = bool(on)
        self._write_config()
        return {"ok": True}

    # ---------- utilities ----------

    def ping(self):
        return {"ok": True, "message": "Python is here"}

    def media_url(self, abs_path):
        return self._server.media_url(abs_path)

    def take_media(self, tracks, buckets=DEFAULT_BUCKETS,
                   start_sec=None, end_sec=None):
        """Everything the player needs about a take in one call: each track's
        address, its length in samples and its waveform.

        start_sec/end_sec narrow the waveform to the part on screen. The
        bridge turns a missing argument into None, so the bucket count falls
        back here rather than being duplicated in the interface.

        The icon beside each track is the one the take keeps for it ("icon",
        as the library gives the take), never the band's as it is now: a
        lineup picked since, or an icon changed, redraws no old take. A track
        the take keeps none for gets none, and is drawn with the neutral one.
        Its Backing track ("kind": "backing") has the backing track's icon
        and says what it is."""
        buckets = buckets or DEFAULT_BUCKETS
        result = []
        for t in tracks:
            if t.get("kind") == "backing":
                icon = {"icon": "backing", "kind": "backing"}
            else:
                icon = {"icon": t["icon"]} if isinstance(t.get("icon"), str) and t["icon"] else {}
            path = Path(t["file"])
            if not path.exists():
                result.append({
                    "name": t["name"],
                    **icon,
                    "url": None,
                    "error": "Track file not found",
                    "frames": 0,
                    "samplerate": 0,
                    "duration_sec": 0,
                    "peaks": [],
                })
                continue

            try:
                peaks, frames, samplerate = wav_peaks(
                    path, buckets, start_sec, end_sec
                )
            except Exception as e:
                peaks, frames, samplerate = [], 0, 0
                print(f"[waveform] {path.name}: {e}")

            result.append({
                "name": t["name"],
                **icon,
                "url": self._server.media_url(path),
                "frames": frames,
                "samplerate": samplerate,
                "duration_sec": (frames / samplerate) if samplerate else 0,
                "peaks": peaks,
            })
        return result

    def take_notes(self, files):
        """The notes of a take for the player: one answer per file, in order,
        each with its "name", from the .mid read back (midi/notes.py). The
        notes of a whole take are sent at once, so zooming asks for nothing
        again.

        Whether the lane is a drum grid is the icon the take keeps for the
        file, as take_media's lanes take theirs; a file with none is judged by
        itself alone.

        Every file is answered on its own and one can never fail the call: one
        that is not there, or has no path, is "Notes file not found"; any other
        trouble (not a .mid, cut short, a folder, a name too long, a drive that
        will not answer) is "Notes file not readable", said in the log. The
        answer carries the file's "name" when it was given one.

        Each answer, an error too, carries that icon, as take_media's does: a
        track that records notes only has no audio lane to take it from, and
        the plate of its notes lane shows it. A track whose port never
        appeared has no file at all, and is asked with a file of None for the
        same reason; with no file of the take to keep an icon, it is given
        the band's, by its name."""
        icon_of = layouts.icons(self._config.get("tracks"))
        result = []
        for f in files:
            if not isinstance(f, dict):
                f = {}
            named = {"name": f["name"]} if "name" in f else {}
            if isinstance(f.get("icon"), str) and f["icon"]:
                named["icon"] = f["icon"]
            # A name that is not text is no member of the band, and cannot be
            # looked up in it without failing the call.
            elif f.get("file") is None and isinstance(f.get("name"), str) and f["name"] in icon_of:
                named["icon"] = icon_of[f["name"]]
            if f.get("file") is None:
                result.append({**named, "error": "Notes file not found"})
                continue
            try:
                path = Path(f["file"])
                if not path.exists():
                    result.append({**named, "error": "Notes file not found"})
                    continue
                notes = read_notes(path, named.get("icon") == "drums")
            except Exception as e:
                # The log, not print: a console that cannot show a name such as
                # "Pałyn" would raise here and fail the call for this very file.
                logging.getLogger(__name__).warning(
                    "notes of %s: %s: %s", Path(str(f["file"])).name, type(e).__name__, e)
                result.append({**named, "error": "Notes file not readable"})
                continue
            result.append({**named, **notes})
        return result

    @staticmethod
    def _host_api_names():
        """
        Index -> name of each audio system PortAudio found.

        This matters on Windows, where one interface shows up once per system
        — MME, DirectSound, WASAPI, WDM-KS, ASIO if the card has a driver —
        and the names alone are identical. The interface groups devices by
        it, so it is reported everywhere; on a Mac there is only one and the
        interface does not show it.
        """
        try:
            return [h["name"] for h in sd.query_hostapis()]
        except Exception:
            return []

    def _describe_devices(self, want_input):
        apis = self._host_api_names()
        key = "max_input_channels" if want_input else "max_output_channels"

        # Under the lock, so the list is never read while a rescan is
        # replacing it.
        with STREAM_LOCK:
            listed = list(sd.query_devices())

        found = []
        for idx, d in enumerate(listed):
            if d.get(key, 0) <= 0:
                continue
            api = apis[d["hostapi"]] if d.get("hostapi", -1) < len(apis) else ""
            found.append({
                "index": idx,
                "name": d["name"],
                "host_api": api,
                "max_input_channels": d.get("max_input_channels", 0),
                "max_output_channels": d.get("max_output_channels", 0),
                "default_samplerate": int(d["default_samplerate"]),
            })
        return found

    def list_input_devices(self):
        return self._describe_devices(want_input=True)

    def set_recording_format(self, device_index, samplerate, bit_depth):
        """
        The interface, rate and depth to record at. These live in Settings
        rather than on the setup screen: they are picked once for the room and
        the card, not argued about at the start of every rehearsal.
        """
        depth = normalize_depth(bit_depth)
        # Settings sends the *resolved* device_index, which is None when the
        # saved card is not plugged in. Recording has no "system input", so
        # None here never means a choice — leave the saved identity alone and
        # only change the rate and depth.
        if device_index is not None:
            self._remember_device("device", device_index)
        self._config["samplerate"] = int(samplerate)
        self._config["bit_depth"] = depth
        self._write_config()
        return {
            "ok": True,
            "device_index": device_index,
            "samplerate": int(samplerate),
            "bit_depth": depth,
        }

    def recording_formats(self, device_index, channel_count):
        """Which rate/depth combinations this input can actually do."""
        try:
            formats, trouble = recording_formats(device_index, int(channel_count))
            if trouble:
                # Into the crash log, where a bug report can reach it. The
                # screen shows a sentence, not this.
                print(f"[devices] {device_index} would not list its rates: {trouble}")
            return {
                "ok": True,
                "formats": formats,
                **({"trouble": trouble} if trouble else {}),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def list_output_devices(self):
        """The devices that can play, each with `click_unavailable` and
        `backing_unavailable`: why the metronome's click or the backing track
        cannot go there, or None. With the recording card on ASIO, no other
        ASIO card can play while it records."""
        found = self._describe_devices(want_input=False)
        recording = (self._session["device_index"] if self._session is not None
                     else saved_device(self._config, "device", True))
        asio = recording is not None and _is_asio(recording)
        for d in found:
            d["click_unavailable"] = (ANOTHER_ASIO if asio and d["host_api"] == "ASIO"
                                      and d["index"] != recording else None)
            d["backing_unavailable"] = d["click_unavailable"]
        return found

    def _next_recording(self):
        """(the device the next take records from, its rate): the
        rehearsal's, else the settings'. The backing track is got ready at
        that rate."""
        session = self._session
        if session is not None:
            return session["device_index"], session["samplerate"]
        return (saved_device(self._config, "device", True),
                int(self._config.get("samplerate") or DEFAULT_SAMPLERATE))

    def _missing_device(self):
        """The saved recording interface when it is not plugged in, as
        {name, host_api}; None when it is, or when nothing was ever chosen.

        Not the same as no choice at all. "No interface chosen" is wrong for
        a desk that was chosen and is simply not switched on yet, and the
        screen can offer to look for it again only if it knows it is
        missing."""
        identity = self._config.get("device")
        if not identity:
            return None
        if saved_device(self._config, "device", True) is not None:
            return None
        return {"name": identity.get("name"), "host_api": identity.get("host_api")}

    @staticmethod
    def _device_names():
        """Every device's name, once each, in the order PortAudio lists them.
        One card is listed once per audio system on Windows; for saying what
        turned up, it is one card."""
        try:
            with STREAM_LOCK:
                return list(dict.fromkeys(d["name"] for d in sd.query_devices()))
        except Exception:
            return []

    def rescan_devices(self):
        """
        Looks for interfaces again: PortAudio lists them once, at start, and a
        card plugged in afterwards is not offered until it is started again.

        Every stream has to be let go first — see audio.devices.rescan. A
        recording refuses the rescan outright; the signal check is stopped;
        the player keeps its take and only has its output closed, then
        reopened where it was.

        Returns which names turned up and which went, for the screen to say.
        """
        # The player's lock before the stream lock, the order player_open
        # takes them in. The other way round, a player opening while this
        # runs would leave each waiting for the other.
        with self._player_lock, STREAM_LOCK:
            # A take whose streams are opening (start_take) is not recording
            # yet, and its streams are as much the rescan's to break.
            if self._recorder is not None or self._starting:
                return {
                    "ok": False,
                    "error": "Not while recording. Stop the take first, then "
                             "look again.",
                }
            # Nor while Stop runs on to the next quarter: a click take's
            # streams stay open for up to two seconds after Stop.
            if self._stopping:
                return {
                    "ok": False,
                    "error": "Not while a take is being saved. Look again "
                             "once it is saved.",
                }
            result = self._rescan_held()
        # Once both locks are let go: where the click's output is is read
        # again, and a click between takes follows the player (metronome.py's
        # note on the locks).
        self._metronome.devices_changed()
        self._resink()
        return result

    def _rescan_held(self):
        """rescan_devices, with the player's lock and STREAM_LOCK held."""
        self.stop_monitor()
        # Look again reads the MIDI ports too, in case the system missed
        # one coming or going.
        self._midi.refresh()

        before = self._device_names()
        # The click between takes lets go of its own stream as the player
        # does of its, before PortAudio is stopped.
        self._metronome.let_go_for_rescan()
        self._backing.let_go_for_rescan()
        if self._player is not None:
            self._player.close_output()
        trouble = rescan()
        if trouble is not None:
            return {"ok": False, "error": trouble}
        after = self._device_names()

        reopened = self._reopen_output()

        result = {
            "ok": True,
            "found": [n for n in after if n not in before],
            "gone": [n for n in before if n not in after],
        }
        if not reopened.get("ok", True):
            result["warning"] = reopened.get("error")
        elif reopened.get("warning"):
            result["warning"] = reopened["warning"]
        return result

    def _input_count(self, device_index):
        if device_index is None:
            return 0
        try:
            return sd.query_devices(device_index).get("max_input_channels", 0)
        except Exception:
            return 0

    def _remember_layout(self, device_index, tracks):
        """Keeps the band, and where each of them is plugged in on this card.

        The band is one list whatever is plugged in; the inputs belong to the
        card. See rehearsal_recorder/layouts.py."""
        self._config["tracks"] = [layouts.band_member(t) for t in tracks]
        self._config["layouts"] = layouts.remember(
            self._config.get("layouts", []),
            device_identity(device_index),
            tracks,
        )

    def load_default_tracks(self, band=None):
        """
        The tracks to start the setup screen with, for the card in force.

        Always an answer, never nothing: which of the four cases applies —
        this card's own layout, another card's names, names with no input
        left over, or the first-run pair — belongs in one place, and that
        place is layouts.for_device().

        `band` is the names, stereo switches and icons to place, when the
        screen already has some: a card that turns up after a rescan takes
        the band as it is on screen, edits and all, rather than the saved one.
        """
        index = saved_device(self._config, "device", True)
        if band is None:
            members = self._config.get("tracks", [])
        else:
            members = [layouts.band_member(t) for t in band]
        answer = self._lineups_answer(index)
        return {
            "device_index": index,
            "samplerate": self._config.get("samplerate"),
            "bit_depth": normalize_depth(self._config.get("bit_depth")),
            "tracks": layouts.for_device(
                members,
                self._config.get("layouts", []),
                device_identity(index),
                self._input_count(index),
            ),
            "lineups": answer["lineups"],
            "lineup": answer["lineup"],
        }

    # ---------- lineups ----------

    def _lineups_answer(self, index):
        """Every lineup laid out on the card the setup screen uses, `index`,
        and the one picked. The screen works out for itself whether the
        tracks on it are still that lineup's. On a first run that card is
        not the saved one yet, so the screen says which it is."""
        return {
            "ok": True,
            "lineups": layouts.laid_out(
                self._config.get("lineups", []),
                device_identity(index),
                self._input_count(index),
            ),
            "lineup": self._config.get("lineup"),
        }

    def _lineup(self, name):
        for lineup in self._config.get("lineups", []):
            if lineup["name"] == name:
                return lineup
        raise layouts.LineupRefused(f"No lineup is called {name}")

    def _keep_lineup(self, lineup, device_index, tracks):
        """The tracks on screen written into `lineup`, and made last time
        too, so the screen opens with what was just saved rather than with
        what was on it the last time someone pressed Start."""
        lineup["tracks"] = [layouts.band_member(t) for t in tracks]
        lineup["layouts"] = layouts.remember(
            lineup["layouts"], device_identity(device_index), tracks)
        self._remember_layout(device_index, tracks)
        self._config["lineup"] = lineup["name"]
        self._write_config()
        return self._lineups_answer(device_index)

    def update_lineup(self, name, device_index, tracks):
        """Update: the tracks on screen over the lineup called `name`."""
        try:
            return self._keep_lineup(self._lineup(name), device_index, tracks)
        except layouts.LineupRefused as e:
            return {"ok": False, "error": str(e)}

    def add_lineup(self, name, device_index, tracks):
        """Save as new: a lineup made of the tracks on screen, picked.

        It starts from last time's inputs on every other card, so where
        each of them plugs in elsewhere is not forgotten."""
        lineups = self._config.setdefault("lineups", [])
        try:
            name = layouts.lineup_name(lineups, name)
        except layouts.LineupRefused as e:
            return {"ok": False, "error": str(e)}
        lineup = {"name": name, "tracks": [],
                  "layouts": copy.deepcopy(self._config.get("layouts", []))}
        lineups.append(lineup)
        return self._keep_lineup(lineup, device_index, tracks)

    def rename_lineup(self, name, new_name, device_index=None):
        """The lineup called `name` called `new_name`. The answer lays the
        lineups out on `device_index`, the card on screen, as Update's does."""
        try:
            lineup = self._lineup(name)
            new_name = layouts.lineup_name(
                self._config["lineups"], new_name, renaming=name)
        except layouts.LineupRefused as e:
            return {"ok": False, "error": str(e)}
        lineup["name"] = new_name
        if self._config.get("lineup") == name:
            self._config["lineup"] = new_name
        self._write_config()
        return self._lineups_answer(device_index)

    def delete_lineup(self, name, device_index=None):
        """The lineup gone. The tracks on screen and last time stay as they
        are; with the picked one gone, none is picked. The answer lays the
        rest out on `device_index`, the card on screen."""
        try:
            lineup = self._lineup(name)
        except layouts.LineupRefused as e:
            return {"ok": False, "error": str(e)}
        self._config["lineups"].remove(lineup)
        if self._config.get("lineup") == name:
            self._config["lineup"] = None
        self._write_config()
        return self._lineups_answer(device_index)

    def save_default_tracks(self, config):
        """Writes last time without starting. The setup screen no longer
        calls it, since lineups replaced Save as template; tests use it to
        set up a band."""
        # device_index says which card this layout belongs to. It does not
        # change the saved recording device: that choice lives in Settings.
        if "tracks" in config:
            self._remember_layout(config.get("device_index"), config["tracks"])
        for key in ("samplerate", "bit_depth"):
            if key in config:
                self._config[key] = config[key]
        self._write_config()
        return {"ok": True}

    # ---------- signal check ----------

    def start_monitor(self, device_index, samplerate, tracks):
        """Opens the inputs without recording, so everyone can confirm they
        land on their own track, and the MIDI ports of the tracks that take
        notes, so everyone can confirm those too."""
        self.stop_monitor()
        if self._recorder is not None:
            return {"ok": False, "error": "Recording in progress"}
        # A check would put the rig on its own ports while a Stop is still
        # ending the take's notes on them.
        if self._stopping or self._transport.saving:
            return {"ok": False, "error": "Still saving the last take"}
        if not tracks:
            return {"ok": False, "error": "No tracks configured"}
        # Only the tracks that record sound reach the card, and as plain
        # audio ones: what stops Start for the notes (no track that records
        # sound, a port not picked, two tracks on one) is Start's to say and
        # never stops the check, which listens to every port that is picked.
        audio = [t for t in tracks if records_audio(t)]
        if audio:
            stray = channels_available(device_index, [{**t, "mode": "audio"} for t in audio])
            if stray:
                return {"ok": False, "error": stray}

            monitor = LevelMonitor(device_index, samplerate, audio)
            try:
                monitor.start()
            except Exception as e:
                return {"ok": False, "error": str(e)}
            self._monitor = monitor
        # The check's ports now, whatever Tap opened before it.
        self._tap.take_over(lambda: self._midi.use(tracks, check=True), checking=True)
        self._midi.reset_counts()
        return {"ok": True}

    def monitor_levels(self):
        if self._monitor is None:
            return {}
        return self._monitor.get_levels()

    def monitor_health(self):
        """
        Polled every couple of seconds while the signal is checked: is the
        card still sending. Only reported — stopping the check is the
        screen's to do, over the bridge, since this is asked over http and
        acts on nothing.
        """
        monitor = self._monitor
        if monitor is None:
            return {"checking": False, "problem": None}
        return {"checking": True, "problem": monitor.problem()}

    def stop_monitor(self, keep_ports=False):
        """Lets go of the card, and of the MIDI ports the check opened unless
        `keep_ports`: Start keeps them, and hands them to the rehearsal. With
        a rehearsal under way they are its ports, not the check's, and they
        stay: leaving the setup screen, or Look again, must not close them
        under a take. Finishing the rehearsal closes them. Never raises: it is
        the first step of closing the app, and of a Start that failed."""
        if self._monitor is not None:
            try:
                self._monitor.stop()
            except Exception as e:
                print(f"[monitor] stop: {e}")
            self._monitor = None
        self._tap.check_over()
        if not keep_ports and self._session is None:
            try:
                self._midi.release()
            except Exception as e:
                # The check is over whether or not a port would close.
                print(f"[monitor] letting go of the MIDI ports: {e}")
        return {"ok": True}

    # ---------- MIDI ports ----------

    def controller_ports(self):
        system = self._controller.system
        return {"bluetooth_setup": bluetooth_setup.available(),
                "system": system.name if system else None,
                "inputs": [p.saved() for p in system.inputs()] if system else [],
                "outputs": [p.saved() for p in system.outputs()] if system else []}

    def open_controller_bluetooth(self):
        return bluetooth_setup.open_picker()

    def controller_state(self):
        return self._controller.status()

    @serialised
    def set_controller(self, selected_input=None, selected_output=None):
        system = self._controller.system
        if self._recorder is not None or self._transport.saving:
            return {"ok": False, "error": "Stop recording before changing the controller"}
        if selected_input is None:
            self._controller.configure(None)
            self._midi.reserve_controller(None)
            self._config.pop("controller", None)
        else:
            if not isinstance(selected_input, dict) or system is None:
                return {"ok": False, "error": "No MIDI controller input available"}
            inp, ambiguous = find_port(selected_input, system.inputs())
            if inp is None or ambiguous:
                return {"ok": False, "error": "The selected controller input cannot be identified. Connect the controller, press Look again and select its input again."}
            outputs = system.outputs()
            if selected_output is None:
                matches = controller_feedback(inp, outputs)
                if len(matches) != 1:
                    return {"ok": False, "error": "Select the controller feedback output"}
                out = matches[0]
            elif isinstance(selected_output, dict):
                out, ambiguous = find_port(selected_output, outputs)
                if out is None or ambiguous:
                    return {"ok": False, "error": "The selected controller feedback output cannot be identified. Press Look again and select its output again."}
            else:
                return {"ok": False, "error": "Invalid feedback output"}
            tracks = (self._session or {}).get("tracks", self._config.get("tracks", []))
            for track in tracks:
                saved = port_of(track)
                if records_notes(track) and saved and find_port(saved, [inp])[0]:
                    return {"ok": False, "error": "Remove this port from instrument tracks before selecting it as a controller"}
            selected = {"input": inp.saved(), "output": out.saved()}
            self._controller.configure(None)
            self._midi.reserve_controller(selected["input"])
            self._controller.configure(selected)
            self._config["controller"] = selected
        self._write_config()
        return {"ok": True, **self.controller_state()}

    def list_midi_ports(self):
        """The MIDI ports there are, for the port pickers: the system, each
        port as it is saved with the notes counted on it since the check
        began, and why there is no system when there is none. Asked over http
        every second or so."""
        return self._midi.ports()

    def midi_activity(self):
        """What each track that takes notes is hearing: its loudest note
        since the last ask, its note count, and whether its port is there.
        Asked over http, by one screen at a time (the loudest note is
        forgotten when it is read)."""
        return self._midi.activity()

    # ---------- disk space and recording health ----------

    def disk_estimate(self, channel_count, samplerate, bit_depth=LEGACY_DEPTH):
        """How much recording time fits in the free space.

        Counted in channels, not tracks: a stereo track writes two of them,
        and an estimate that counted it as one would promise half again as
        much room as there is."""
        try:
            free = shutil.disk_usage(self._recordings_dir).free
        except OSError as e:
            return {"ok": False, "error": str(e)}

        per_sec = max(
            1,
            int(channel_count) * int(samplerate) * bytes_per_sample(bit_depth),
        )
        minutes = free / per_sec / 60
        return {
            "ok": True,
            "free_bytes": free,
            "bytes_per_sec": per_sec,
            "minutes": minutes,
            "low": minutes < LOW_SPACE_MINUTES,
        }

    def recording_health(self):
        """Polled every couple of seconds while recording: is the stream alive,
        is the disk filling up, and how charged is the battery if the laptop
        runs on it."""
        if self._recorder is None:
            return {"recording": False}

        s = self._session
        # The take's Backing track is written at Stop: one more track.
        channel_count = (_channels_of(s["tracks"]) if s else 1) + self._backing.take_channels()
        samplerate = s["samplerate"] if s else 48000
        estimate = self.disk_estimate(
            channel_count, samplerate, s.get("bit_depth", LEGACY_DEPTH) if s else LEGACY_DEPTH
        )

        return {
            "recording": True,
            "error": self._recorder.problem(),
            "active": self._recorder.is_active(),
            "free_bytes": estimate.get("free_bytes"),
            "minutes_left": estimate.get("minutes"),
            "low_space": estimate.get("low", False),
            "battery_percent": self._battery(),
        }

    @staticmethod
    def _battery():
        """The charge while on battery, or None; never a reason for the
        health check not to answer."""
        try:
            return battery_percent()
        except Exception as e:  # noqa: BLE001
            print(f"[battery] {e}")
            return None

    def _laptop_sleeping(self):
        """The system says it is going to sleep (SleepWatch). The take being
        recorded, if there is one, ends where the laptop slept; the screen's
        next health check after waking stops it and says why. Between takes
        nothing is lost, so nothing is said."""
        recorder = self._recorder
        if recorder is not None:
            recorder.fell_asleep(time.time())

    # ---------- rehearsal ----------

    @serialised
    def start_rehearsal(
        self, name, device_index, samplerate, tracks, bit_depth=DEFAULT_DEPTH,
        set_id=None, lineup=None,
    ):
        """`set_id` is the set picked beside Start rehearsal: the rehearsal
        keeps a copy of it as it is now, and its first song is the first
        take. One that is not there any more starts it with none.

        `lineup` is the lineup picked over the tracks. It is kept with last
        time, so the screen opens with it picked; the lineup itself is not
        written."""
        if self._transport.pending_take:
            return {"ok": False, "error": "Recover the failed take first"}
        if not tracks:
            return {"ok": False, "error": "No tracks configured"}
        # The take recording keeps the tracks it began with, notes and all.
        if self._recorder is not None:
            return {"ok": False, "error": "Recording in progress"}
        # Caught before a folder is made for a rehearsal that cannot record.
        # The notes' rules are asked first, in their own words (A1, P3, P2).
        stray = channels_available(device_index, tracks)
        if stray:
            return {"ok": False, "error": stray}
        bit_depth = normalize_depth(bit_depth)
        # The band set this up against this card; a week from now the same
        # card should bring it back without anyone remembering a button.
        self._remember_layout(device_index, tracks)
        picked = {each["name"] for each in self._config.get("lineups", [])}
        self._config["lineup"] = lineup if isinstance(lineup, str) and lineup in picked else None
        # Written now: the screen opens with it next time, after the app is
        # closed.
        self._write_config()
        # Asked first: with no database there is nowhere to keep the takes,
        # and nothing should be created on disk for them.
        library = self._lib

        # The signal check and the recording cannot hold the input at once.
        # Its MIDI ports are kept: the rehearsal takes them over below.
        self.stop_monitor(keep_ports=True)

        try:
            played_by = library.set_of(set_id) if set_id is not None else None

            created_at = time.strftime("%Y-%m-%dT%H:%M:%S")
            folder = _unique_path(
                self._recordings_dir
                / f"{_safe_name(name)} - {_timestamp_suffix(created_at)}"
            )
            folder.mkdir(parents=True, exist_ok=True)

            self._session = {
                "name": name,
                "folder": folder,
                "created_at": created_at,
                "device_index": device_index,
                "samplerate": samplerate,
                "bit_depth": bit_depth,
                "tracks": tracks,
                "take_counter": 0,
                "set": played_by,
            }
            # In the database from the start, so History can read the take list
            # even after a restart.
            try:
                library.create_rehearsal(
                    folder, name, created_at, samplerate, bit_depth, tracks,
                    set_copy=played_by,
                )
            except Exception:
                self._session = None
                raise
        except Exception:
            # The audio check is over and no rehearsal has begun, so the MIDI
            # check is too: its ports were only kept for this Start. A
            # rehearsal already under way keeps its own (stop_monitor).
            self.stop_monitor()
            raise
        # Exactly the ports the final tracks name: one the check had open that
        # they still name stays open as it is; the rest of the check's close.
        # What was played during the check is not the rehearsal's. Tap's
        # listening goes on in them.
        self._tap.take_over(lambda: self._midi.use(tracks))
        self._midi.reset_counts()
        self._follow_next()
        return {"ok": True, "folder": str(folder)}

    def _session_rehearsal(self):
        """The rehearsal in progress as the database has it, or None."""
        if self._session is None:
            return None
        return self._lib.rehearsal(self._session["folder"])

    def _session_takes(self):
        """The takes of the rehearsal in progress, from the database — the one
        copy there is."""
        if self._session is None:
            return []
        r = self._lib.rehearsal(self._session["folder"])
        return r["takes"] if r else []

    # ---------- long work ----------

    def activity(self):
        """What long work is running and how it ended — polled over http by
        the header of every screen. While a take records, the cloud copies
        waiting behind it say so."""
        recording = self._recorder is not None
        entries = self._journal.snapshot()
        if recording:
            for e in entries:
                if e["kind"] == "cloud" and e["state"] == "waiting":
                    e["step"] = "After the take"
        return {"entries": entries, "recording": recording}

    def _journaled(self, kind, title, folder, take_number, work):
        """
        work(progress) as a journal entry, for the operations that run where
        they were started: done when it answers, failed with its own error
        when it answers {"ok": False}, and failed on the way out if it
        raises. Opened only once the operation's own checks have passed, so
        a request refused at the door leaves nothing behind.
        """
        entry = self._journal.begin(kind, title, folder, take_number)
        try:
            result = work(entry.progress)
        except Exception as e:
            entry.fail(str(e))
            raise
        if isinstance(result, dict) and result.get("ok") is False:
            entry.fail(result.get("error") or "It did not work")
        else:
            entry.done()
        return result

    def activity_seen(self):
        self._journal.mark_seen()
        return {"ok": True}

    def clear_activity(self):
        self._journal.clear()
        return {"ok": True}

    def session_state(self):
        if self._session is None:
            return {"active": False}
        s = self._session
        here = self._session_rehearsal()
        takes = here["takes"] if here else []
        coming = self._next_take()
        return {
            "active": True,
            "name": s["name"],
            "folder": str(s["folder"]),
            "tracks": s["tracks"],
            "takes": takes,
            "songs": _songs_of(takes),
            "next_take_number": s["take_counter"] + 1,
            # What the name field holds, and the go shown beside it.
            "next_take_name": _field_text(coming),
            "next_take_go": coming["go"],
            # What it would hold without a title picked, which the rehearsal
            # screen offers to go back to.
            "next_take_default": self.suggest_take_name(chosen=False),
            "last_attempt": _last_attempt(
                takes, coming["song"], lambda: self._go_before_tonight(coming["song"])),
            # The set it is played by, its titles as they are now, or None.
            "set": here["set"] if here else None,
            "recording": self._recorder is not None,
            "cloud_queue": self._cloud_queue.states(s["folder"]),
            # The header's "On disk", measured as History measures a
            # rehearsal. Read when the screen asks, which is after each take.
            "disk_bytes": _folder_bytes(s["folder"]),
        }

    def _go_before_tonight(self, title):
        """The go at the song titled `title` that its first go tonight is
        measured against: its newest ★ go before tonight, else the last go
        of the latest rehearsal that played it (_plays_of), from rehearsals
        on disk. None for no song, one with no go before tonight, or when
        the library cannot answer: the screens that ask must go on without
        it."""
        if not title:
            return None
        try:
            song_id = self._lib.song_id(title)
            if song_id is None:
                return None
            found = self._lib.goes_before(song_id, self._session["folder"])
        except Exception:
            return None
        return None if found is None else _plays_of(found["goes"])

    def _next_take(self, take_number=None, chosen=True):
        """
        What the take being named would be, as {"song", "go", "name"}.

        A new take is usually another go at the same song, so it is the
        previous take's song at its next go. After a take nobody named, it is
        "Take N".

        take_number is the take being named. Left out, it means the take that
        comes next, which is what the rehearsal screen shows before
        recording. Right after a take it must be passed, otherwise the very
        first take would be offered as "Take 2".

        A title picked for the next take on the rehearsal screen comes before
        all of that (see set_next_take_name), resolved as any name is —
        "polyn" is the next go at Polyn — unless `chosen` is False: then this
        is what the take would be without it.
        """
        if self._session is None:
            return {"song": None, "go": None, "name": "Take 1"}
        number = (take_number if take_number is not None
                  else self._session["take_counter"] + 1)
        folder = self._session["folder"]
        picked = self._session.get("next_name")
        if chosen and picked:
            try:
                return self._lib.resolve_name(folder, picked, number)
            except Exception:
                # The library could not say which go it would be. The title
                # picked is still the one to offer, as it was typed.
                return {"song": None, "go": None, "name": picked}
        takes = self._session_takes()
        song = takes[-1].get("song") if takes else None
        played_by = self._session.get("set")
        if not takes and played_by and played_by["songs"]:
            # The evening's first take is the set's first song (R3).
            song = played_by["songs"][0]
        return self._lib.resolve_name(folder, song or "", number)

    def suggest_take_name(self, take_number=None, chosen=True):
        """What the name field holds for the take being named: its song's
        title, or "Take N" — see _next_take."""
        return _field_text(self._next_take(take_number, chosen))

    @serialised
    def set_next_take_name(self, name):
        """
        Names the take recorded next, picked on the rehearsal screen before
        it is: the band has moved on to another song, and the recording
        screen should already say which, and the review screen have nothing
        to retype. Blank goes back to the name it would have had anyway.

        It holds until a take is kept, not merely recorded: a take thrown
        away is usually played again straight after, as the same song.
        """
        if self._session is None:
            return {"ok": False, "error": "No rehearsal in progress"}
        self._session["next_name"] = (name or "").strip() or None
        coming = self._next_take()
        self._follow_next()
        return {"ok": True, "next_take_name": _field_text(coming),
                "next_take_go": coming["go"]}

    def _follow_next(self):
        """The metronome's row follows the next take's name (spec Part 2),
        wherever it changes: a name picked, a take kept, renamed or deleted, a
        rehearsal begun or over. Never raises: the row is the screen's, and
        a library that cannot say leaves it with no song."""
        try:
            name = _field_text(self._next_take()) if self._session is not None else ""
        except Exception:
            log.exception("The next take's name could not be read for the metronome")
            name = ""
        try:
            self._metronome.follow(name)
        except Exception:
            log.exception("The metronome could not follow the next take's name")
        # The backing track's row follows the song the metronome found.
        try:
            self._backing.follow()
        except Exception:
            log.exception("The backing track could not follow the next take's name")

    def song_choices(self, folder=None, take_number=None):
        """
        The songs a take can be named after, so that nobody types a title the
        band has played before: {"here": [...], "other": [...]}, each
        {"song", "go", "also"}: the title, which a pill puts in the name
        field; the go a take would be as that song — one past its highest go
        anywhere in the library, or, for the take being renamed, its own go
        at its own song; and the song's old names, which typed are the song
        too (Library._resolve).

        "here" is what this rehearsal played, in the order it first played
        it, each with "last_take", the number of its latest take. "other" is
        every other song in the library, the most recently played first; the
        interface shows as many as it has room for.

        A song with no takes yet (New song) comes last under "other", as its
        first take would be its first go.

        `folder` is the rehearsal, the one in progress when left out.
        `take_number` is the take being named.
        """
        if folder is None:
            folder = self._session["folder"] if self._session else None
        rehearsal = self._lib.rehearsal(Path(folder)) if folder else None
        takes = rehearsal["takes"] if rehearsal else []
        own = next((t for t in takes if t.get("take_number") == take_number), None)
        nexts = self._lib.next_goes()
        also = self._lib.song_names()
        # What the metronome's row shows when the song is picked.
        tempos = self._lib.song_tempos()

        def go_for(song):
            if own is not None and own.get("song") == song:
                return own["go"]
            return nexts.get(song, 1)

        def tempo_of(song):
            tempo, signature = tempos.get(song, (None, None))
            return {"tempo": tempo, "signature": signature}

        here = [{"song": s["name"], "go": go_for(s["name"]),
                 "also": also.get(s["name"], []), "last_take": max(s["take_numbers"]),
                 **tempo_of(s["name"])}
                for s in _songs_of(takes)]
        seen = {c["song"].casefold() for c in here}
        other = []
        # Newest first, so the first spelling met is the latest one used.
        for r in self._lib.rehearsals():
            if folder and Path(r["folder"]) == Path(folder):
                continue
            for s in _songs_of(r["takes"]):
                key = s["name"].casefold()
                if key not in seen:
                    seen.add(key)
                    other.append({"song": s["name"], "go": go_for(s["name"]),
                                  "also": also.get(s["name"], []), **tempo_of(s["name"])})
        for title in self._lib.song_titles_without_takes():
            if title.casefold() not in seen:
                seen.add(title.casefold())
                other.append({"song": title, "go": go_for(title), "also": also.get(title, []),
                              **tempo_of(title)})
        return {"here": here, "other": other}

    @serialised
    def finish_rehearsal(self):
        if self._transport.pending_take:
            return {"ok": False, "error": "Recover the failed take first"}
        if self._recorder is not None:
            return {"ok": False, "error": "Recording in progress"}
        if self._session is None:
            return {"ok": False, "error": "No rehearsal in progress"}
        folder = Path(self._session["folder"])
        rehearsal = self._lib.rehearsal(folder)
        take_count = len(rehearsal["takes"]) if rehearsal else 0
        self._session = None
        # The click between takes stops with the rehearsal, and the row has
        # no next take to follow.
        self._metronome.stop()
        self._follow_next()
        try:
            self._midi.release()
        except Exception as e:
            # The rehearsal is over whether or not a port would close.
            print(f"[finish] letting go of the MIDI ports: {e}")

        # A rehearsal where nothing was saved should not leave a folder behind.
        # One whose last take or draft waits for its Undo is not empty yet.
        removed = False
        if rehearsal is not None and self._is_empty(rehearsal):
            with self._files_lock:
                if not self._waits(folder, self._waiting_rehearsals()):
                    removed = self._remove_empty(folder)

        return {
            "ok": True,
            "folder": str(folder),
            "take_count": take_count,
            "folder_removed": removed,
        }

    @staticmethod
    def _is_empty(rehearsal):
        """
        A rehearsal that produced nothing: no saved takes and no audio on disk.
        Such a folder can be removed without asking — there is nothing to lose.

        A folder holding a draft (the app died mid-take) is deliberately kept:
        that draft is a real recording, just not accepted yet. Note that a draft
        is raw PCM, not .wav, which is exactly why has_audio() looks for both.
        """
        return not rehearsal["takes"] and not has_audio(Path(rehearsal["folder"]))

    def cleanup_empty_rehearsals(self):
        """Removes rehearsals without a single saved take and without any
        audio (including unfinished drafts), folder and record both."""
        # It runs from __init__, where a database that cannot be opened must
        # not stop the app from starting.
        if self._library is None:
            return {"ok": True, "removed": 0}

        live = Path(self._session["folder"]) if self._session is not None else None
        removed = 0
        # Under the lock that removals hold, so a take deleted meanwhile is
        # either still listed here or already waiting in its entry.
        with self._files_lock:
            waiting = None
            for rehearsal in self._lib.rehearsals():
                folder = Path(rehearsal["folder"])
                if rehearsal["missing"] or folder == live or not self._is_empty(rehearsal):
                    continue
                # Its last take deleted a moment ago, waiting for its Undo:
                # without the rehearsal, Undo would have nowhere to go back.
                if waiting is None:
                    waiting = self._waiting_rehearsals()
                if self._waits(folder, waiting):
                    continue
                if self._remove_empty(folder):
                    removed += 1
        return {"ok": True, "removed": removed}

    def _waiting_rehearsals(self):
        """The ids of the rehearsals something of which waits in the holding
        folder for its Undo: a take or a draft (or a crop of one)."""
        ids = set()
        for token in holding.tokens(self._recordings_dir):
            record = (holding.read(self._recordings_dir, token) or {}).get("record")
            for ident in _identities(record):
                if ident.get("kind") != "rehearsal" and ident.get("rehearsal_id") is not None:
                    ids.add(ident["rehearsal_id"])
        return ids

    def _waits(self, folder, waiting):
        """Whether the rehearsal in `folder` is one of `waiting`."""
        if not waiting:
            return False
        ref = self._lib.rehearsal_ref(folder)
        return ref is not None and ref["id"] in waiting

    def _remove_empty(self, folder):
        """
        The folder, then its record — the record only once the folder is
        really gone, so one that could not be removed is tried again next
        time rather than left on disk with nothing pointing at it. Returns
        whether the folder is gone.

        Only a folder with nothing but empty directories left in it (an
        empty _drafts, say) is removed. A record in the database is no proof
        the app made the folder: "Locate folder…" can point a rehearsal at
        any folder, and one full of someone's mixes and lyrics has no audio
        the app would recognise, yet is anything but empty. A file of any
        kind, or a link, keeps the folder where it is.
        """
        folder = Path(folder)
        if self._holds_anything(folder):
            return False
        shutil.rmtree(folder, ignore_errors=True)
        if folder.exists():
            return False
        self._lib.forget_rehearsal(folder)
        return True

    @staticmethod
    def _holds_anything(folder):
        """Anything in the tree that is not a plain directory. Links are not
        followed, and count: what they point at is not ours to judge.

        os.path.isjunction only exists from Python 3.12, but pyproject.toml
        allows 3.10; on an older Python, getattr leaves it as "not a
        junction" rather than raising. is_symlink() still catches a
        symlink on every supported version, junction or not.
        """
        isjunction = getattr(os.path, "isjunction", None)
        for root, dirs, files in os.walk(folder, followlinks=False):
            if files:
                return True
            for d in dirs:
                sub = Path(root) / d
                if sub.is_symlink() or (isjunction is not None and isjunction(sub)):
                    return True
        return False

    # ---------- take ----------

    @property
    def controls(self) -> ControlAPI:
        """Application-owned control service for Python adapters."""
        return self._transport

    def control_state(self):
        return self.controls.snapshot()

    def control_command(self, action, parameters=None):
        return self.controls.execute(action, parameters, wait=True)

    def control_catalog(self):
        return self.controls.catalog()

    def transport_state(self):
        return self._transport.state()

    def transport_command(self, action):
        return self._transport.command(action)

    @serialised
    def start_take(self):
        if self._transport.pending_take:
            return {"ok": False, "error": "Recover the failed take first"}
        if self._session is None:
            return {"ok": False, "error": "No rehearsal in progress"}
        if self._recorder is not None:
            return {"ok": False, "error": "Already recording"}
        # Asked after the recorder, which a Stop lets go of only once this is
        # set. The rig keeps one take at a time: a take begun now would be
        # the one the old Stop then ends, with the old take's notes unmade.
        if self._stopping:
            return {"ok": False, "error": "Still saving the last take"}

        s = self._session
        # Only the tracks that record sound reach the card: a MIDI track has no
        # input, and the recorder counts channels. A band with none cannot
        # record a take; start_rehearsal refuses it first, in the same words.
        audio = [t for t in s["tracks"] if records_audio(t)]
        if not audio:
            return {"ok": False,
                    "error": notes_problem(s["tracks"]) or "No tracks configured"}
        notes_tracks = [t for t in s["tracks"] if records_notes(t)]
        # The number is used up only once the take is recording: one that is
        # refused or cannot start leaves the count where it was.
        take_number = s["take_counter"] + 1
        temp_dir = s["folder"] / DRAFTS_DIR / f"take {take_number}"

        # The take's tempo, signature and click are the metronome's row as it
        # is now, whoever pressed Record (spec Part 4): its click rides this
        # card's stream when its output is this card, else has its own.
        self._follow_next()
        tempo, signature, _ = self._metronome.take_meter()
        # The song's backing track plays from bar 1 on the first click after
        # the count-in, or from its start with no click; the take keeps it as
        # its Backing track (backing-track spec, Part 3).
        free, song = self._metronome.next_song()
        song_id = None if free or song is None else song["id"]
        backing = None
        try:
            backing = self._backing.take_backing(song_id, s["device_index"], s["samplerate"])
        except Exception:
            log.exception("The take's backing track could not be made, so it records without it")
        click = None
        try:
            click = self._metronome.take_click(s["device_index"], s["samplerate"], backing=backing)
        except Exception:
            log.exception("The take's click could not be made, so it records without one")
        clicks = click is not None and click.clicks
        if clicks:
            tempo, signature = click.tempo, click.signature

        clock, notes = None, []
        if notes_tracks:
            # A signal check run since the last take may have left the rig on
            # other tracks, and stopping it does not put these back. It
            # changes nothing when nothing changed, and this is between takes:
            # never while one records.
            self._notes_step("The MIDI ports could not be put right for the take",
                             self._midi.use, s["tracks"])
            # The notes' files are named by capture.note_stems, here for
            # take.json and in the rig's recorder for the files themselves.
            stems = note_stems([t["name"] for t in notes_tracks])
            clock = AudioClock(s["samplerate"])
            # The track's name too: a draft recovered after a crash is named
            # by it, as its audio is, and not by its file.
            notes = [{"file": stems[t["name"]], "name": t["name"],
                      "port": (port_of(t) or {}).get("name", ""),
                      "icon": t.get("icon") or None}
                     for t in notes_tracks]

        # A click on another device places itself by a clock of the take's
        # audio, which the recorder makes when the notes have not.
        recorder = AudioRecorder(
            s["device_index"],
            s["samplerate"],
            audio,
            temp_dir,
            s.get("bit_depth", LEGACY_DEPTH),
            clock=clock,
            notes=notes,
            click=click,
            meter=(tempo, signature) if click is None and tempo is not None else None,
        )
        # The click between takes stops before the card is opened for the
        # take, which has its own; from here the screen is told of the take's
        # count-in, its first click still to be chosen.
        self._metronome.begin_take(tempo, signature, click)
        self._backing.begin_take(click)
        # Until the recorder is kept, a rescan would let go of the streams it
        # opens: it waits for this, under the lock it holds (rescan_devices).
        with STREAM_LOCK:
            self._starting = True
        try:
            try:
                recorder.start()
            except Exception as e:
                self._metronome.end_take()
                self._backing.end_take()
                return {"ok": False, "error": str(e)}
            s["take_counter"] = take_number

            # Right after the audio has started, with the clock's start set: what
            # arrives before is the state the notes begin from, what arrives
            # after is in the take.
            if notes_tracks:
                self._notes_step("The take's notes could not begin",
                                 self._midi.begin_take, temp_dir, clock)

            self._recorder = recorder
            # A drift line still being counted stops: its reading must not
            # hold up the take's own (drift spec Part 4). A Record that
            # cannot start stops none.
            self._drift_round += 1
        finally:
            self._starting = False
        self._recorder_take_number = take_number
        self._recorder_temp_dir = temp_dir
        self._recorder_band = s["tracks"]
        self._recorder_meter = {"tempo": tempo, "signature": signature if tempo is not None else None,
                                "click": clicks}
        self._recorder_song_id = song_id
        # Held only once the take is really recording; a lock the system
        # refuses is no reason to stop it (KeepAwake never raises, but this
        # must not be the line that ends a take).
        try:
            self._awake.hold()
        except Exception as e:  # noqa: BLE001
            print(f"[awake] {e}")
        return {"ok": True, "take_number": take_number}

    @staticmethod
    def _notes_step(what, call, *args):
        """A step of a take's notes. The notes never cost a take its audio: a
        step that fails is said in the log, at ERROR, which the crash log keeps,
        and the take goes on without them. Returns what the step did, or None."""
        try:
            return call(*args)
        except Exception:
            log.exception("%s", what)
            return None

    def get_levels(self):
        if self._recorder is None:
            return {}
        return self._recorder.get_levels()

    @serialised
    def stop_take(self):
        if self._recorder is None:
            return {"ok": False, "error": "Not recording"}

        recorder = self._recorder
        take_number = self._recorder_take_number
        temp_dir = self._recorder_temp_dir
        band = self._recorder_band or []
        meter = self._recorder_meter or {"tempo": None, "signature": None, "click": False}
        song_id = self._recorder_song_id
        # Set before the recorder is let go of, and cleared once the take's
        # files are written: start_take and start_monitor wait for it.
        self._stopping = True
        self._recorder = None
        self._recorder_take_number = None
        self._recorder_temp_dir = None
        self._recorder_band = None
        self._recorder_meter = None
        self._recorder_song_id = None
        # What Keep gives the take, the controller's Stop and a draft kept
        # later alike (_meter_of_draft). A discarded draft's entry stays: an
        # Undo of the discard puts the draft back, to be kept with it.
        self._meters[self._draft_key(temp_dir)] = meter

        try:
            field = self.suggest_take_name(take_number)
            plain_name = self._next_take(take_number)["name"]
        except Exception:
            # The name comes from the library. A take is not left recording,
            # holding the card, because the library could not answer.
            field = plain_name = f"Take {take_number}"
        try:
            # What ✕ on the review screen puts back: what the field would hold
            # with no title picked before recording.
            default = self.suggest_take_name(take_number, chosen=False)
        except Exception:
            default = f"Take {take_number}"

        def finish(progress):
            try:
                done = recorder.stop(progress=progress)
            except BaseException:
                # The sound did not finish, so the notes do not either: they
                # stay as raw files, as a crash would leave them, for the
                # drafts to finish.
                if any(records_notes(t) for t in band):
                    self._notes_step("The take's notes could not be let go of",
                                     self._midi.abandon_take)
                raise
            return {**done, "notes": self._end_notes(
                recorder, band, temp_dir, done["duration_sec"])}

        # Awake until the take's files are written, whether or not that
        # works: a laptop asleep half-way through would leave them unwritten.
        try:
            result = self._journaled(
                "stop", f"Saving “{plain_name}”", temp_dir, take_number, finish,
            )
        finally:
            self._stopping = False
            self._awake.release()
            self._metronome.end_take()
            self._backing.end_take()
            # As the notes' clock's: the audio callback keeps the click's
            # first fault and says nothing.
            fault = getattr(recorder, "click_fault", None)
            if fault is not None:
                log.error("The take's click failed during the take and went quiet; "
                          "the take recorded on: %s", fault)
            # A take whose first click was never chosen (Stop before the
            # card's first block, or a click output slow to start) is no
            # click take: its files start where they started. Its take.json
            # says so, and so does this, for Keep in this session.
            meter["click"] = meter["click"] and whole(getattr(recorder.click, "first_click_frame", None))
        notes, missing = self._note_lanes(band, result["tracks"], result["notes"])
        # Each with its track's icon, as Keep will keep it, so the review
        # screen draws the take as it was started.
        icon_of = layouts.icons(band)
        notes, missing = _with_icons(notes, icon_of), _with_icons(missing, icon_of)
        # The Backing track last, as the take keeps it; whether it is heard
        # is its song's, as M in the player last left it.
        backing = result.get("backing")
        tracks = (_with_icons(result["tracks"], icon_of)
                  + ([{**backing, "kind": "backing"}] if backing else []))
        return {
            "ok": True,
            "take_number": take_number,
            "temp_dir": str(temp_dir),
            "duration_sec": result["duration_sec"],
            "tracks": tracks,
            "notes": notes,
            "notes_missing": missing,
            "suggested_name": field,
            "default_name": default,
            "song_id": song_id,
            "backing_heard": self._backing_heard(song_id),
            **meter,
        }

    def _backing_heard(self, song_id):
        """Whether a take of the song opens with its Backing track heard;
        False for no song, or a library that cannot say."""
        if song_id is None:
            return False
        try:
            song = self._lib.song(song_id)
        except Exception:
            log.exception("Whether the song's Backing track is heard could not be read")
            return False
        return bool(song and song["backing_heard"])

    def _end_notes(self, recorder, band, temp_dir, duration_sec):
        """
        A take's notes, once its audio has stopped: the .mid files the rig made
        of them, [{"name", "file", "port"}], as long as the audio and no
        longer (a take a sleeping laptop ended stops where it slept). Never
        raises, for the audio is saved by now; a track whose .mid could not be
        made is left out, its .midraw staying in the draft.
        """
        if not any(records_notes(t) for t in band):
            return []
        # The audio callback keeps the first fault of the notes' clock and says
        # nothing, being the audio thread; the spec has it in the app's log.
        fault = getattr(recorder, "clock_fault", None)
        if fault is not None:
            log.error("The clock that places the take's notes failed during the "
                      "take, so they are placed without the audio card's own "
                      "time: %s", fault)
        # A click take's .mid starts at its first click, as its audio does,
        # and says its tempo and signature (spec Part 9); one with a tempo and
        # no click says its tempo; one with none is at 120.
        click = getattr(recorder, "click", None)
        without_click = getattr(recorder, "meter", None)
        head_sec, meter = 0.0, NO_METER
        if click is not None:
            if click.first_click_frame is not None:
                head_sec = click.first_click_frame / recorder.samplerate
            meter = click.meter()
        elif without_click is not None:
            meter = meter_of(*without_click)
        notes = self._notes_step("The take's notes could not be finished",
                                 self._midi.end_take, duration_sec, head_sec, meter) or []

        # AudioRecorder.stop left take.json for the notes to find their ports
        # in: it goes once no notes file is left that a later try would need it
        # for. One that cannot go (Windows, while another program has it open)
        # costs Stop nothing: it is said in the log and goes with the drafts folder.
        # A take with a tempo keeps it: it says the take's grid and tempo, for
        # a crop of the draft and for Keep, and goes with the draft's folder.
        def forget_record():
            if click is None and without_click is None and not any(Path(temp_dir).glob(f"*{MIDRAW_SUFFIX}")):
                (Path(temp_dir) / TAKE_RECORD).unlink(missing_ok=True)

        self._notes_step("The take's record could not be removed", forget_record)
        return notes

    @staticmethod
    def _note_lanes(band, audio, notes):
        """
        A take's notes as the screens get them: each .mid with the audio lane
        it follows, and the tracks that record notes and have no .mid in the
        take (a port that was not there, or a .mid the disk refused). The lane
        is worked out over the audio files the take really has: a track whose
        audio produced none is not followed.

        Each also carries "place", its track's index in the band: two lanes
        that follow the same audio lane, one saved and one missing, are put
        in band order by it, and nothing else says which stood first.
        """
        heard = {t["name"] for t in audio}
        written = {n["name"] for n in notes}
        lanes = [{**n, "after": lane_after(band, heard, n["name"]),
                  **place_in(band, n["name"])} for n in notes]
        missing = [
            {"name": t["name"], "port": (port_of(t) or {}).get("name"),
             "after": lane_after(band, heard, t["name"]), **place_in(band, t["name"])}
            for t in band if records_notes(t) and t["name"] not in written
        ]
        return lanes, missing

    @serialised
    def keep_take(
        self,
        take_number,
        temp_dir,
        custom_name,
        duration_sec,
        tracks,
        markers=None,
        send_to_cloud=None,
        notes=None,
    ):
        """
        tracks: [{"name":.., "file": <path in the drafts folder>}, ...] as
        returned by stop_take(). Moves them into the rehearsal folder and adds
        the take to the saved list.

        notes: the .mid files, as stop_take() returns them in "notes", moved
        beside the WAVs. Any other .mid in the draft goes with them, named as
        its track: an older screen passes none, and a .mid left in the draft
        would be deleted with the drafts folder. A notes file that could not
        become a .mid is never thrown away either: it goes into the take's
        folder as it is (see _move_unmade_notes). Everything moves or nothing
        does (_move_take_files).

        markers: anything marked while listening on the review screen. They
        are passed in rather than saved as they are placed, because until the
        take is kept there is nothing on disk to attach them to.

        send_to_cloud: this take's own answer to "does it go to the cloud
        folder", from the review screen. None follows the setting. False keeps
        it out even with sending on — and out of every later re-send of the
        rehearsal too, or a moved fader would send the false start after all.
        True sends it even with sending off. Kept with the take as
        cloud_skip / cloud_send; sending by hand ignores both.
        """
        if self._session is None:
            return {"ok": False, "error": "No rehearsal in progress"}

        # A crop of this draft still waiting for its Undo (its uncut files)
        # is over once the draft is saved: Undo would put them back into a
        # draft that is no longer there. It goes on to the Trash first. Only
        # a crop: a discard of a draft of that name is another draft's.
        with self._files_lock:
            ident = self._draft_identity(Path(temp_dir))
            if ident is not None and self._being_cropped([ident]):
                return {"ok": False, "error": CROPPING}
            ended = ([] if ident is None
                     else self._end_before([ident], stale=False, reasons={"crop"}))

        s = self._session
        # Named as it will be kept: the song and go the name resolves to, not
        # what was typed — "polyn" for the third go is "Polyn 3".
        named = self._lib.resolve_name(s["folder"], custom_name, take_number)
        take_dir = _unique_path(s["folder"] / _take_dir_name(take_number, named["name"]))
        take_dir.mkdir(parents=True, exist_ok=True)

        # The review screen is still playing these very files.
        self._release_player_in(temp_dir)

        # Read before the files move: take.json can go with a notes file not
        # yet made (_move_unmade_notes).
        meter = self._meter_of_draft(temp_dir)
        notes = self._draft_notes(temp_dir, s["tracks"], notes)
        moved, moved_notes, undo = self._move_take_files(temp_dir, take_dir, tracks, notes)
        # Each with the icon its track had at Start, kept with the take.
        icon_of = layouts.icons(s["tracks"])

        take_info = {
            "take_number": take_number,
            "name": (custom_name or "").strip(),
            "duration_sec": duration_sec,
            "tracks": _with_icons(moved, icon_of),
            "notes": _with_icons(moved_notes, icon_of),
            "markers": [self._as_marker(m) for m in (markers or [])],
            # What the metronome showed at Record, and whether it clicked: a
            # song with no tempo takes a click take's (Library.add_take).
            **meter,
        }
        if send_to_cloud is False:
            take_info["cloud_skip"] = True
        elif send_to_cloud is True:
            take_info["cloud_send"] = True
        kept = self._add_moved_take(s["folder"], take_info, undo, take_dir)
        if kept is None:
            return {"ok": False, "error": "Rehearsal not found", "ended": ended}
        # The name picked for this take is used up; the next one follows on
        # from it. A draft rescued from an earlier take leaves it alone.
        if take_number == s["take_counter"]:
            s.pop("next_name", None)
        self._meters.pop(self._draft_key(temp_dir), None)

        shutil.rmtree(temp_dir, ignore_errors=True)
        self._cleanup_drafts_dir(temp_dir)
        self._enqueue_publish(s["folder"], take_number, take=kept)
        self._retry_failed_publishes()
        self._follow_next()
        return {"ok": True, "take": kept, "ended": ended}

    @staticmethod
    def _draft_key(draft_dir):
        """A draft's folder as _meters knows it, however the path was spelled."""
        return os.path.normcase(os.path.abspath(draft_dir))

    def _meter_of_draft(self, draft_dir):
        """
        A stopped take's {"tempo", "signature", "click"}: as its Stop left
        them, or from its take.json, for a draft rescued after a crash or kept
        after the app started again, or from its WAVs when that has gone
        (_meter_of_wavs). A click take whose first click was never chosen
        keeps its tempo but is no click take: its files start where they
        started; nor is a take with a backing track and no click ("clicks"
        False). Each is None, and "click" False, for what it does not have.
        """
        found = self._meters.get(self._draft_key(draft_dir))
        if found is not None:
            return dict(found)
        try:
            record = json.loads((Path(draft_dir) / TAKE_RECORD).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            record = None
        click = record.get("click") if isinstance(record, dict) else None
        if not isinstance(click, dict):
            return self._meter_of_wavs(draft_dir)
        tempo, signature = as_tempo(click.get("tempo"), click.get("signature"))
        return {"tempo": tempo, "signature": signature,
                "click": (tempo is not None and click.get("clicks") is not False
                          and whole(click.get("first_click_frame")))}

    @staticmethod
    def _meter_of_wavs(draft_dir):
        """
        A draft's meter from its first WAV's acid chunk, which only a click
        take's files carry: for a draft with no take.json to say it, as when
        a crop before Keep put it aside with a notes file not yet made, and
        the app has started again since. None and False for a WAV with none.
        """
        none = {"tempo": None, "signature": None, "click": False}
        wavs = sorted(p for p in Path(draft_dir).glob("*.wav") if not p.name.startswith(WRITING_PREFIX))
        try:
            acid = read_acid(wavs[0]) if wavs else None
        except OSError:
            acid = None
        signature = None if acid is None else f"{acid.num}/{acid.den}"
        if signature not in SIGNATURES:
            return none
        # The chunk says quarters a minute: 99.5 for 6/8 at 199.
        counted = acid.quarter_tempo * per_quarter(signature)
        if not math.isfinite(counted) or abs(counted - round(counted)) > 0.01:
            return none
        tempo, signature = as_tempo(round(counted), signature)
        return {"tempo": tempo, "signature": signature, "click": tempo is not None}

    @classmethod
    def _move_take_files(cls, draft_dir, take_dir, tracks, notes):
        """
        Everything a take keeps from its draft into its folder: the audio, the
        notes, and any notes file not yet a .mid (_move_unmade_notes). It all
        moves or none of it does. A file that will not move (Windows refuses
        one another program holds open) puts back every file moved before it
        and the error goes on: the draft stays whole and listed, to be saved
        again, and no audio is left in a folder the library never hears of.
        Returns the audio and the notes at their new paths, and the (new, old)
        pairs that put them back should the take not be recorded.
        """
        undo = []
        try:
            moved = cls._move_tracks(tracks, take_dir, undo)
            moved_notes = cls._move_tracks(notes, take_dir, undo)
            cls._move_unmade_notes(draft_dir, take_dir, undo)
        except BaseException:
            cls._unmove(undo, take_dir)
            raise
        return moved, moved_notes, undo

    @staticmethod
    def _move_tracks(tracks, take_dir, undo):
        """
        A take's files into its folder: its audio, or its .mid files, being
        anything shaped [{"name", "file"}]; the Backing track keeps its
        "kind". Returns them at their new paths.
        Each move's (new, old) pair goes into `undo` as soon as it is made, so
        one that fails part-way still leaves those before it to be put back.
        """
        moved = []
        for t in tracks:
            src = Path(t["file"])
            dst = take_dir / src.name
            if src.exists():
                shutil.move(str(src), str(dst))
                undo.append((dst, src))
            moved.append({"name": t["name"], "file": str(dst),
                          **({"kind": "backing"} if t.get("kind") == "backing" else {})})
        return moved

    @staticmethod
    def _move_unmade_notes(draft_dir, take_dir, undo):
        """
        A notes file the disk would not let become a .mid (it is still a
        .midraw) goes into the take's folder as it is, with the clock and the
        record that a later try needs to make it, and the drafts folder is
        removed as usual: nothing is deleted unconverted. The take does not
        list it, so its track shows as one with no notes in this take. Each
        move's (new, old) pair goes into `undo` as it is made.
        """
        draft_dir = Path(draft_dir)
        left = sorted(draft_dir.glob(f"*{MIDRAW_SUFFIX}"))
        if left:
            for src in [*left, draft_dir / CLOCK_FILE, draft_dir / TAKE_RECORD]:
                if src.exists():
                    dst = Path(take_dir) / src.name
                    shutil.move(str(src), str(dst))
                    undo.append((dst, src))

    @classmethod
    def _draft_notes(cls, temp_dir, band, notes):
        """
        A draft's notes, as Keep keeps them and Crop cuts them: the .mid files
        `notes` lists, then every other .mid in the draft, found by its file
        and named as the track it belongs to. An older screen passes none, and
        a .mid left in the draft would be deleted with the drafts folder, or
        kept uncut beside audio that was cut.
        """
        notes = list(notes or [])
        listed = {Path(n["file"]).name for n in notes}
        return notes + cls._named_as_tracks(band, [
            {"name": p.stem, "file": str(p)}
            for p in sorted(Path(temp_dir).glob(f"*{MID_SUFFIX}")) if p.name not in listed
        ])

    @staticmethod
    def _named_as_tracks(band, notes):
        """
        Notes found in a draft by their files, whose stems are all a draft
        knows them by, under the names of the tracks they belong to
        ("Synth_Pad" is the track "Synth/Pad"), the way stop_take() names
        them. The stems are capture.note_stems' over the rehearsal's tracks
        that take notes. A note already named otherwise (finalize names it
        from take.json where the record has the name) is left as it is.
        """
        stems = note_stems([t["name"] for t in band if records_notes(t)])
        names = {stem: name for name, stem in stems.items()}
        return [{**n, "name": names.get(n["name"], n["name"])}
                if n["name"] == Path(n["file"]).stem else n
                for n in notes]

    @staticmethod
    def _audio_named_as_tracks(band, tracks):
        """
        The audio found in a draft by its files, under the names of the tracks
        it belongs to ("Keys_Pad" is the track "Keys/Pad"), as
        _named_as_tracks names the notes: a draft with no take.json (Stop
        removes it, and the app was closed on the review screen) knows its
        files by their stems alone, and a Both track's audio and notes come
        back under one name. Audio already named otherwise is left as it is.
        """
        names = {AudioRecorder.safe_name(t["name"]): t["name"] for t in band if records_audio(t)}
        return [{**t, "name": names.get(t["name"], t["name"])}
                if t["name"] == Path(t["file"]).stem else t
                for t in tracks]

    def _add_moved_take(self, folder, take_info, undo, take_dir):
        """
        Records a take whose files were just moved into take_dir. If the
        record cannot be written, the files go back where they came from: a
        take folder nothing points at would never show up anywhere, while
        the draft left in place is still found and can be saved again.
        Returns the take as kept, or None without the rehearsal.
        """
        try:
            kept = self._lib.add_take(folder, take_info)
        except Exception:
            self._unmove(undo, take_dir)
            raise
        if kept is None:
            self._unmove(undo, take_dir)
        return kept

    @staticmethod
    def _unmove(undo, take_dir):
        for dst, src in reversed(undo):
            try:
                src.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(dst), str(src))
            except OSError as e:
                print(f"[keep] could not put {dst} back: {e}")
        try:
            take_dir.rmdir()  # only when it is empty, which is the point
        except OSError:
            pass

    def discard_take(self, temp_dir):
        """
        A take dropped on the review screen and a draft rescued after a crash
        are the same thing on disk — an unfinished take folder — so they leave
        the same way, towards the Trash (discard_draft). This used to be an
        rmtree of whatever path it was handed: the one place in the app where
        a recording was really destroyed, and the one that needed it least,
        because the take was recorded seconds earlier and cannot be played
        again.
        """
        return self.discard_draft(temp_dir)

    def _release_player_in(self, folder):
        """
        Closes the player if what it has open lives in `folder`.

        Tracks are played through a memmap, and Windows will not let a mapped
        file be moved or removed — the same trap crop_take steps around. Here
        it made Save take do nothing at all on Windows: the review screen is
        playing the take it asks about, so its files were always mapped when
        the move came. A player on some other take is left playing.
        """
        with self._player_lock:
            open_tracks = self._open_tracks or []
            closing = any(_is_inside(t["file"], folder) for t in open_tracks)
            if closing:
                self._close_player()
        if closing:
            self._resink()

    @staticmethod
    def _cleanup_drafts_dir(temp_dir):
        """Once a draft is saved or discarded, drop the drafts folder if it is
        now empty."""
        parent = Path(temp_dir).parent
        try:
            if parent.name == DRAFTS_DIR and parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
        except OSError:
            pass

    # ---------- unsaved drafts ----------

    def list_drafts(self):
        """
        Takes that were recorded but never saved — the app was closed or died
        mid-take. Their audio is on disk as raw PCM, and their notes, if they
        had any, as .midraw files (or a .mid, if Stop got that far); here we
        just report them: "tracks" and "notes", by file name.
        """
        found = []
        # By folder name, as they sit on disk.
        for r in sorted(self._lib.rehearsals(), key=lambda r: Path(r["folder"]).name):
            if r["missing"]:
                continue
            folder = Path(r["folder"])
            for take_dir in draft_dirs(folder):
                info = describe(take_dir, r["samplerate"], r["bit_depth"])
                info["rehearsal_folder"] = str(folder)
                info["rehearsal_name"] = r["name"]
                info["created_at"] = r["created_at"]
                found.append(info)
        return found

    @serialised
    def recover_draft(self, draft_dir, name=None):
        """Turns a draft into a normal saved take of its rehearsal."""
        draft_dir = Path(draft_dir)
        if not self._inside_recordings(draft_dir):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        if not draft_dir.is_dir():
            return {"ok": False, "error": "Draft not found"}

        # A crop of this draft still waiting for its Undo is over once the
        # draft is a take, as it is at keep_take: its uncut files go on to
        # the Trash first.
        with self._files_lock:
            ident = self._draft_identity(draft_dir)
            if ident is not None and self._being_cropped([ident]):
                return {"ok": False, "error": CROPPING}
            ended = ([] if ident is None
                     else self._end_before([ident], stale=False, reasons={"crop"}))

        folder = draft_dir.parent.parent
        r = self._lib.rehearsal(folder)
        if r is None:
            return {"ok": False, "error": "Rehearsal not found", "ended": ended}

        def work(progress):
            done = finalize(draft_dir, r["samplerate"], r["bit_depth"],
                            progress=progress)
            if not done["tracks"]:
                return {"ok": False, "error": "Draft has no audio"}
            return done

        result = self._journaled(
            "recover", f"Recovering a take of “{r['name']}”", draft_dir, None, work)
        if result.get("ok") is False:
            return {**result, "ended": ended}

        take_number = max((t["take_number"] for t in r["takes"]), default=0) + 1
        # Its tempo and click, before the files move (as at keep_take), and
        # its tracks' icons: as take.json kept them, none where it says none,
        # and for a draft written before it kept them, last time's.
        meter = self._meter_of_draft(draft_dir)
        icon_of = {**layouts.icons(self._config.get("tracks")), **draft_icons(draft_dir)}
        # A draft rescued with no name is a take nobody named: "Take 5".
        display_name = (name or "").strip()
        named = self._lib.resolve_name(folder, display_name, take_number)
        take_dir = _unique_path(folder / _take_dir_name(take_number, named["name"]))
        take_dir.mkdir(parents=True, exist_ok=True)

        # Its Backing track last, written from take.json as Stop would have.
        backing = result.get("backing")
        moved, moved_notes, undo = self._move_take_files(
            draft_dir, take_dir,
            self._audio_named_as_tracks(r["tracks"], result["tracks"])
            + ([{**backing, "kind": "backing"}] if backing else []),
            self._named_as_tracks(r["tracks"], result["notes"]))
        take_info = {
            "take_number": take_number,
            "name": display_name,
            "duration_sec": result["duration_sec"],
            "tracks": _with_icons(moved, icon_of),
            "notes": _with_icons(moved_notes, icon_of),
            # A rescued take was never listened to, so it has no marks yet.
            "markers": [],
            **meter,
        }
        kept = self._add_moved_take(folder, take_info, undo, take_dir)
        if kept is None:
            return {"ok": False, "error": "Rehearsal not found", "ended": ended}
        self._meters.pop(self._draft_key(draft_dir), None)

        shutil.rmtree(draft_dir, ignore_errors=True)
        self._cleanup_drafts_dir(draft_dir)

        if self._session is not None and Path(self._session["folder"]) == folder:
            self._session["take_counter"] = max(
                self._session["take_counter"], take_number
            )

        # A rescued take is a take. The app dying mid-rehearsal is exactly the
        # case there is no startup sweep for, so this is the only thing that
        # ever sends it.
        self._enqueue_publish(folder, take_number)
        self._follow_next()
        return {"ok": True, "take": kept, "folder": str(folder), "ended": ended}

    @serialised
    def discard_draft(self, draft_dir):
        """
        Moves a draft into the holding folder, where it waits for its Undo
        (undo_trash puts it back at _drafts/take N, in its rehearsal's folder
        as it is by then) or for its notice to end (end_trash sends it to the
        Trash). {"ok": True, "undo": token}, or {"ok": False, "error"} with
        the draft where it was.
        """
        draft_dir = Path(draft_dir)
        if not self._inside_recordings(draft_dir):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        with self._files_lock:
            # Asked before anything ends: a second call for a draft already
            # discarded (a double click) would otherwise end the first one's
            # entry, a draft of the very same name, and take its Undo with it.
            if not draft_dir.exists():
                return {"ok": False, "error": "It is not there any more"}
            ref = self._draft_rehearsal(draft_dir)
            ident = self._draft_identity(draft_dir, ref)
            if ident is not None and self._being_cropped([ident]):
                return {"ok": False, "error": CROPPING}
            ended = self._end_before([ident] if ident is not None else [])
            # And again after: an end moves files.
            if not draft_dir.exists():
                return {"ok": False, "error": "It is not there any more", "ended": ended}
            self._release_player_in(draft_dir)
            record = {"kind": "draft", "reason": "discard", "rows": "none",
                      "item": ident, "rehearsal": ref}
            try:
                token = holding.hold(self._recordings_dir, record, [draft_dir])
            except (OSError, ValueError) as e:
                return {"ok": False, "error": f"Could not remove it: {e}", "ended": ended}
            self._cleanup_drafts_dir(draft_dir)
            return {"ok": True, "undo": token, "ended": ended}

    def _recordings_key(self, path):
        """`path` relative to the recordings folder, with forward slashes, as
        a removal's record names it; None outside it."""
        try:
            return Path(path).resolve().relative_to(self._recordings_dir.resolve()).as_posix()
        except ValueError:
            return None

    def _draft_rehearsal(self, draft_dir):
        """The rehearsal a draft at <rehearsal>/_drafts/<name> belongs to, as
        a record names it (Library.rehearsal_ref), or None."""
        draft_dir = Path(draft_dir)
        if draft_dir.parent.name != DRAFTS_DIR or self._library is None:
            return None
        return self._lib.rehearsal_ref(draft_dir.parent.parent)

    def _draft_identity(self, draft_dir, ref=None):
        """A draft's identity (see _identities), or None for a folder outside
        the recordings folder."""
        key = self._recordings_key(draft_dir)
        if key is None:
            return None
        if ref is None:
            ref = self._draft_rehearsal(draft_dir)
        return {"kind": "draft", "draft": key,
                "rehearsal_id": None if ref is None else ref["id"]}

    # ---------- history ----------

    def list_rehearsals(self):
        """Every rehearsal in the database, newest first. One whose folder is
        not on disk is still listed, as missing — the folder may be on a
        drive that is not plugged in. Folders the database has no record of
        (recorded before there was any history) do not show up."""
        self.cleanup_empty_rehearsals()

        items = []
        for r in self._lib.rehearsals():
            takes = r["takes"]
            items.append({
                "folder": r["folder"],
                "name": r["name"],
                "created_at": r["created_at"],
                "take_count": len(takes),
                "total_duration_sec": sum(t["duration_sec"] for t in takes),
                "songs": _songs_of(takes),
                "runs": _runs_of(takes),
                # Not walked when it is not there to walk.
                "disk_bytes": 0 if r["missing"] else _folder_bytes(r["folder"]),
                # Deleting the rehearsal takes these out of the cloud folder
                # too, and the question before it says so.
                "in_cloud": sum(1 for t in takes if _shape_of(t.get("cloud"))),
                "missing": r["missing"],
                # The set it was played by, None when played freely.
                "set_name": (r.get("set") or {}).get("name"),
            })
        return items

    def get_rehearsal(self, folder):
        r = self._lib.rehearsal(folder)
        if r is None:
            return {"ok": False, "error": "Rehearsal not found"}
        if r["missing"]:
            return {"ok": False, "missing": True,
                    "error": "The rehearsal's folder is not on disk"}
        takes = r["takes"]
        return {
            "ok": True,
            "folder": str(folder),
            "name": r["name"],
            "created_at": r["created_at"],
            "takes": takes,
            "songs": _songs_of(takes),
            "set": r.get("set"),
        }

    def last_time(self):
        """
        What the setup screen says about the rehearsals before this one: the
        last one song by song, and the few before it.

        "last" is the newest rehearsal on disk with a named take in it, with
        its takes as get_rehearsal gives them, so any of them can be played
        from there: a soundcheck recorded after it, or a jam nobody named,
        has nothing to say song by song. With no named take anywhere it is
        the newest rehearsal with takes, and None when there is none.

        "earlier" is the three rehearsals after "last" in the list, as
        history lists them.

        Every song in "last"'s "songs" says what its ▶ plays, as "plays": its
        newest ★ go in a rehearsal on disk, from whichever rehearsal it was
        played at, or with none, its last go in "last". "Newest" is the
        rehearsal's date, then the later take in the evening, never the go
        number, which a take renamed into the song gets afresh.

        Read from the database alone. Nothing here walks a folder for its
        size, which is what makes history's list slow to fill.
        """
        rehearsals = self._lib.rehearsals()
        on_disk = [r for r in rehearsals if not r["missing"] and r["takes"]]
        named = [r for r in on_disk if _songs_of(r["takes"])]
        last = (named or on_disk or [None])[0]

        # Each song's newest ★ go on disk: the rehearsals come newest first,
        # and within one, the later takes are the newer.
        starred = {}
        for r in on_disk:
            for take in reversed(r["takes"]):
                song = take.get("song")
                if song is not None and take.get("starred") and song not in starred:
                    starred[song] = _go_at(r, take)

        def plays(song, r, goes):
            """What a song's ▶ plays: its newest ★ go, or its last go at r."""
            return starred.get(song) or _go_at(r, goes[-1])

        songs = []
        if last is not None:
            for song in _songs_of(last["takes"]):
                goes = [t for t in last["takes"] if t["take_number"] in song["take_numbers"]]
                songs.append({**song, "plays": plays(song["name"], last, goes)})

        earlier = [r for r in rehearsals if r is not last][:3]
        return {
            "last": None if last is None else {
                "folder": last["folder"],
                "name": last["name"],
                "created_at": last["created_at"],
                "takes": last["takes"],
                "songs": songs,
                "runs": _runs_of(last["takes"]),
                "in_cloud": sum(1 for t in last["takes"] if _shape_of(t.get("cloud"))),
            },
            "earlier": [{
                "folder": r["folder"],
                "name": r["name"],
                "created_at": r["created_at"],
                "take_count": len(r["takes"]),
                "total_duration_sec": sum(t["duration_sec"] for t in r["takes"]),
                "missing": r["missing"],
            } for r in earlier],
        }

    def list_songs(self):
        """Every song with a go, and the takes with no song as one row, for
        History's Songs view (Library.songs). From the database, and each
        backing track's file for its length, its channels and whether it is
        there (Backing.describe), read once each time it changes."""
        found = self._lib.songs()
        copies = None
        for song in found["songs"]:
            if song.get("backing") is not None:
                if copies is None:
                    copies = self._lib.backing_files()
                song["backing"] = {**song["backing"], **self._backing.describe(copies.get(song["id"]))}
        return found

    def get_song(self, song_id=None):
        """
        A song's page: {"ok", "id", "title", "also", "plays", "goes"}, its
        goes from every rehearsal and its old names as Library.goes_of gives
        them, and "plays" what its play button plays (_plays_of). `song_id`
        None is the takes with no song.
        """
        found = self._lib.goes_of(song_id)
        if found is None:
            return {"ok": False, "error": "Song not found"}
        if found.get("backing") is not None:
            backing = self._lib.song_backing(song_id)
            found["backing"] = {**found["backing"],
                                **self._backing.describe(None if backing is None else backing["file"])}
        return {"ok": True, **found, "plays": _plays_of(found["goes"])}

    def list_marks(self, label_id):
        """
        History's Marks view: {"ok", "marks"}, every mark with the label from
        every rehearsal, as Library.marks_of gives them. From the database
        alone; no audio file is opened.
        """
        marks = self._lib.marks_of(label_id)
        if marks is None:
            return {"ok": False, "error": "Label not found"}
        return {"ok": True, "marks": marks}

    # ---------- renaming ----------

    def _move_take_dir(self, folder, take_number, take, name):
        """
        A take's folder renamed to carry `name`, so the names still make
        sense browsing the disk. Returns (moved, tracks, notes, error): the
        (old, new) folders when it moved, the take's audio files and its notes
        at their new paths (None when nothing moved), and why it could not be
        moved. Whatever else is in the folder, an unconverted .midraw among it,
        goes with it.
        """
        old_dirs = _dirs_of(take)
        if len(old_dirs) != 1:
            return None, None, None, None
        old_dir = old_dirs.pop()
        target = folder / _take_dir_name(take_number, name)
        # Path itself compares case-insensitively on Windows, so whether
        # the spelling actually changed is asked of plain strings.
        same_spelling = str(target) == str(old_dir)
        same_folder = same_spelling or (
            target.exists() and old_dir.exists() and target.samefile(old_dir)
        )
        if same_folder:
            # The name is unchanged, or changes only in case (a case-blind
            # file system sees the same folder either way). A case-only
            # rename is still a real change to show, so it is made in place;
            # otherwise nothing moves — chasing `_unique_path` here would
            # only push the take into its own "(2)" folder.
            new_dir = old_dir if same_spelling else target
        else:
            new_dir = _unique_path(target)
        if not old_dir.exists() or str(old_dir) == str(new_dir):
            return None, None, None, None
        # Windows will not rename a folder holding a file the player has
        # mapped, and the rehearsal screen is usually playing the very take
        # it offers to rename. The interface reopens the take from its new
        # path afterwards.
        self._release_player_in(old_dir)
        try:
            old_dir.rename(new_dir)
        except OSError as e:
            return None, None, None, str(e)

        def at_new(files):
            return [{**f, "file": str(new_dir / Path(f["file"]).name)} for f in files]

        return (old_dir, new_dir), at_new(take["tracks"]), at_new(take.get("notes") or []), None

    @_follows
    def rename_take(self, folder, take_number, new_name):
        """Renames a take and its folder on disk, keeping paths in sync."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        display_name = (new_name or "").strip()
        if not display_name:
            return {"ok": False, "error": "Name cannot be empty"}

        with self._files_lock:
            take = self._lib.take(folder, take_number)
            if take is None:
                if not self._lib.has(folder):
                    return {"ok": False, "error": "Rehearsal not found"}
                return {"ok": False, "error": "Take not found"}
            # Its folder would move while the crop moves its files.
            if self._take_being_cropped(folder, take_number):
                return {"ok": False, "error": CROPPING}

            # The folder carries the name the take ends up with, which can
            # differ from what was typed: renamed to its own song, a take
            # keeps its go.
            named = self._lib.resolve_name(folder, display_name, take_number)
            moved, new_tracks, new_notes, error = self._move_take_dir(
                folder, take_number, take, named["name"])
            if error is not None:
                print(f"[rename] take folder: {error}")

            try:
                updated = self._lib.update_take(
                    folder, take_number, name=display_name, tracks=new_tracks,
                    notes=new_notes
                )
            except Exception:
                # The folder must not stay renamed under a record that still
                # points at the old one: the take would stop opening.
                if moved:
                    moved[1].rename(moved[0])
                raise
            if updated is None:
                # Deleted while the folder was being renamed.
                if moved:
                    moved[1].rename(moved[0])
                return {"ok": False, "error": "Take not found"}

            # The copies in the cloud folder are named after the take.
            self._rename_take_copies(folder, take_number, updated)
            return {"ok": True, "take": updated}

    @_follows
    def rename_song(self, song_id, title):
        """
        Gives a song another title, from its page in History (Library.rename_song):
        {"ok": True, "title", "goes"}. Its takes' folders and cloud copies
        follow in the background, in a pass of their own under "Renaming Polyn
        to Polin · 12 takes" (names_pass.py). Refused with {"ok": False,
        "error", "into"}, `into` being {"id", "title"} of the song the title
        already belongs to, if that is why: merge_songs into it is what to
        offer instead.
        """
        try:
            done = self._lib.rename_song(song_id, title)
        except SongRefused as e:
            return {"ok": False, "error": str(e), "into": e.into}
        # Not under _files_lock: the pass reads each take afresh before it
        # renames anything, so one running meanwhile only leaves what the
        # next pass puts right.
        if done["takes"]:
            self._names_pass.request_takes(
                done["takes"],
                f"Renaming {done['from']} to {done['title']} · {_takes(done['takes'])}")
        return {"ok": True, "title": done["title"], "goes": len(done["takes"])}

    @_follows
    def merge_songs(self, from_id, into_id, dry_run=False):
        """
        Merges song `from_id` into song `into_id` (Library.merge_songs):
        {"ok": True, "into", "goes", "rehearsals", "first", "last"}, the goes
        moved, from how many rehearsals, and the goes they become. dry_run
        answers the same and changes nothing, for the question asked first.
        Otherwise the files follow as rename_song's do, under "Merging Palyn
        into Pałyn · 2 takes".
        """
        try:
            done = self._lib.merge_songs(from_id, into_id, dry_run=bool(dry_run))
        except SongRefused as e:
            return {"ok": False, "error": str(e)}
        if not dry_run and done["takes"]:
            self._names_pass.request_takes(
                done["takes"],
                f"Merging {done['from']} into {done['into']} · {_takes(done['takes'])}")
        if not dry_run:
            # The merged song's backing track, when the target kept its own.
            for copy in done.get("trash") or []:
                self._backing.trash_copy(copy)
            self._backing.refresh()
        return {"ok": True, **{k: done[k] for k in
                               ("into", "goes", "rehearsals", "first", "last")}}

    def forget_song_name(self, name):
        """Forgets an old name of a song, from its page or from a name field:
        typed again, it is a new song. Answers {"ok": True, "song_id",
        "name"}, the song that had it and the name as it was spelt, for
        remember_song_name."""
        forgot = self._lib.forget_song_name(name)
        if forgot is None:
            return {"ok": False, "error": f"No song was called {str(name or '').strip()}"}
        return {"ok": True, **forgot}

    def remember_song_name(self, song_id, name):
        """Puts back an old name that forget_song_name took, for the Undo of
        its notice (Library.remember_song_name): {"ok": True}, or {"ok":
        False, "error"} when its song is gone, the name is empty or the name
        is another song's now."""
        try:
            self._lib.remember_song_name(song_id, name)
        except SongRefused as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True}

    def rename_rehearsal(self, folder, new_name):
        """Renames a rehearsal and its folder. Its takes' files are kept
        relative to the folder, so they follow it with nothing to rewrite."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        with self._files_lock:
            # Its folder would move while a crop moves files in it.
            ref = self._lib.rehearsal_ref(folder)
            if ref is not None and self._being_cropped(
                    [{"kind": "rehearsal", "folder": self._recordings_key(folder),
                      "rehearsal_id": ref["id"]}]):
                return {"ok": False, "error": CROPPING}
            return self._rename_rehearsal_locked(folder, new_name)

    def _rename_rehearsal_locked(self, folder, new_name):
        r = self._lib.rehearsal(folder)
        if r is None:
            return {"ok": False, "error": "Rehearsal not found"}

        display_name = (new_name or "").strip()
        if not display_name:
            return {"ok": False, "error": "Name cannot be empty"}

        suffix = _timestamp_suffix(r["created_at"])
        original = folder
        new_folder = _unique_path(
            self._recordings_dir / f"{_safe_name(display_name)} - {suffix}"
        )

        if new_folder != original:
            # See rename_take: a take playing from in here holds its files.
            self._release_player_in(original)
            try:
                original.rename(new_folder)
            except OSError as e:
                return {"ok": False, "error": f"Could not rename the folder: {e}"}
            folder = new_folder

        try:
            moved = self._lib.move_rehearsal(original, folder, display_name)
        except Exception:
            # As in rename_take: never leave the folder renamed under a
            # record that still points at the old one.
            if folder != original:
                folder.rename(original)
            raise
        if not moved:
            # Its record went while the folder was being renamed.
            if folder != original:
                folder.rename(original)
            return {"ok": False, "error": "Rehearsal not found"}

        # Only the rehearsal actually being renamed touches the live session —
        # renaming an old one from history must leave it alone.
        if self._session is not None and Path(self._session["folder"]) == original:
            self._session["folder"] = folder
            self._session["name"] = display_name

        # The copies sit in a cloud subfolder named after the rehearsal, so
        # that folder takes the new name too — this rehearsal's or one long
        # finished, however its copies got there.
        if folder != original:
            self._move_rehearsal_copies(original, folder)

        return {
            "ok": True,
            "folder": str(folder),
            "name": display_name,
            "takes": self._lib.rehearsal(folder)["takes"],
        }

    # ---------- stars ----------

    def set_take_star(self, folder, take_number, starred):
        """
        Puts ★ on a take, or takes it off. It is the take's own verdict on
        itself, so it changes no other take: a song can have several, and a
        take with no song can have one. Set, not toggled, so a second click
        that lands before the first one's answer asks for the same thing
        again instead of undoing it. Nothing on disk or in the cloud folder
        follows a star.
        """
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        if not self._lib.has(folder):
            return {"ok": False, "error": "Rehearsal not found"}
        take = self._lib.set_starred(folder, int(take_number), bool(starred))
        if take is None:
            return {"ok": False, "error": "Take not found"}
        return {"ok": True, "take": take}

    # ---------- labels ----------
    #
    # What a mark can be called, made by the band in Settings › Marks. A
    # change answers with every label, so the interface has the new list in
    # the same round trip.

    def list_labels(self):
        """[{id, name, colour, marks, rehearsals, last_marked}] in order (see
        Library.labels); [] while the recordings database cannot be opened:
        that is said once at start, and with no database there is nothing to
        mark."""
        if self._library is None:
            return []
        return self._lib.labels()

    def _labels_changed(self, change):
        try:
            return {"ok": True, "labels": change()}
        except LabelRefused as e:
            return {"ok": False, "error": str(e)}

    def add_label(self, name, colour):
        return self._labels_changed(lambda: self._lib.add_label(name, colour))

    def rename_label(self, label_id, name):
        return self._labels_changed(lambda: self._lib.rename_label(label_id, name))

    def recolour_label(self, label_id, colour):
        return self._labels_changed(lambda: self._lib.recolour_label(label_id, colour))

    def move_label(self, label_id, position):
        return self._labels_changed(lambda: self._lib.move_label(label_id, position))

    def delete_label(self, label_id, marks_to=None):
        """A label in use needs `marks_to`, the label its marks get."""
        return self._labels_changed(lambda: self._lib.delete_label(label_id, marks_to))

    # ---------- sets ----------
    #
    # Songs a rehearsal goes through, in order, made in Settings › Sets or on
    # the start screen. A change answers with every set, as labels do.

    def list_sets(self):
        """[{id, name, songs: [{title, new}]}] in order (see Library.sets);
        [] while the recordings database cannot be opened."""
        if self._library is None:
            return []
        return self._lib.sets()

    def _sets_changed(self, change):
        try:
            return {"ok": True, "sets": change()}
        except SetRefused as e:
            return {"ok": False, "error": str(e)}

    def add_set(self, name, songs):
        return self._sets_changed(lambda: self._lib.add_set(name, songs))

    def update_set(self, set_id, name=None, songs=None):
        """None leaves the name, or the songs, as they are."""
        return self._sets_changed(lambda: self._lib.update_set(set_id, name, songs))

    def delete_set(self, set_id):
        """Rehearsals played by it keep their copy of it."""
        return self._sets_changed(lambda: self._lib.delete_set(set_id))

    # ---------- markers ----------
    #
    # A marker is a spot in a take, its label, and what you wanted to say
    # about it. What one is kept as is the store's rule (library.as_marker,
    # Library._labelled); early versions stored a bare number, which the
    # importer turns into a proper marker.

    _as_marker = staticmethod(as_marker)

    def add_take_marker(self, folder, take_number, seconds, note="", label_id=None):
        """Markers are placed while listening back: 'this bit worked'. With
        no label, the mark gets the first one."""
        fresh = self._as_marker({"at": seconds, "note": note, "label_id": label_id})

        def add(markers):
            kept = [m for m in markers if abs(m["at"] - fresh["at"]) > 0.01]
            return sorted(kept + [fresh], key=lambda m: m["at"])

        return self._update_markers(folder, take_number, add)

    def update_take_marker(self, folder, take_number, seconds, note=None, label_id=None):
        """Edits the marker at this position: its note, its label, or both.
        None leaves that part as it is."""
        target = round(float(seconds), 2)

        def edit(markers):
            for m in markers:
                if abs(m["at"] - target) <= 0.01:
                    if note is not None:
                        m["note"] = str(note).strip()[:200]
                    if label_id is not None:
                        m["label_id"] = label_id
            return markers

        return self._update_markers(folder, take_number, edit)

    def remove_take_marker(self, folder, take_number, seconds):
        def drop(markers):
            target = round(float(seconds), 2)
            return [m for m in markers if abs(m["at"] - target) > 0.01]

        return self._update_markers(folder, take_number, drop)

    def _update_markers(self, folder, take_number, fn):
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        if not self._lib.has(folder):
            return {"ok": False, "error": "Rehearsal not found"}
        markers = self._lib.edit_markers(folder, take_number, fn)
        if markers is None:
            return {"ok": False, "error": "Take not found"}
        return {"ok": True, "markers": markers}

    # ---------- cropping ----------

    @staticmethod
    def _crop_span(duration_sec, start_sec, end_sec):
        """The region to keep, or why it cannot be kept."""
        try:
            start = max(0.0, float(start_sec))
            end = float(end_sec)
        except (TypeError, ValueError):
            return {"error": "That is not a region"}
        if duration_sec:
            end = min(float(duration_sec), end)
        if end - start < MIN_CROP_SEC:
            return {"error":
                    f"A take has to keep at least {MIN_CROP_SEC:g} second"}
        return {"start": start, "end": end}

    @staticmethod
    def _on_grid(tracks, span, tempo, signature):
        """
        A click take's region put on its grid (spec Part 9, snap_region): its
        start back to the bar line at or before it, its end on to the next
        quarter, both inside the take, whose bars run from its files' first
        sample. So the cropped files still start on a bar and hold whole
        quarters. A take whose audio cannot be read is cut as asked.
        """
        rate, frames = None, 0
        for t in tracks:
            try:
                with wave.open(str(t["file"]), "rb") as w:
                    rate = rate or w.getframerate()
                    frames = max(frames, w.getnframes())
            except (OSError, EOFError, wave.Error):
                continue
        if not rate or not whole(tempo) or signature not in SIGNATURES:
            return span
        start, end = snap_region(span["start"], span["end"], tempo, signature, rate, frames)
        return {"start": start / rate, "end": end / rate}

    def _crop_tracks(self, tracks, start_sec, end_sec, progress=None, notes=()):
        """
        Rewrites every track shorter, and every notes file (a .mid) with them,
        and puts the originals aside as one folder named after the take, "…
        (before crop)", beside it: the caller holds that folder for the crop's
        Undo (_hold_uncut), and what reaches the Trash in the end is then a
        recognisable thing rather than eight loose files called Gtr.wav. An
        unconverted .midraw (R40), with the clock and the record that a later
        try would make it from, is timed from the uncropped take's start and
        belongs to the take as it was: it goes aside with the originals and the
        cropped take keeps none. Anything else in the take's folder is not the
        crop's to touch.

        The order matters, because the app can be killed in the middle of it.
        Every new file is written under WRITING_PREFIX first, so nothing is
        replaced until all of them exist; then the originals move aside
        together, the .mid files with the .wav files; then the new files take
        their names. Die between those two and the take folder holds
        obviously-unfinished files with the originals in a folder beside it —
        repairable by hand, which is the most a step that moves files can
        promise. A move that fails while the app is alive is undone instead:
        the take goes back to exactly what it was, because a half-cropped take
        behind the words "could not crop" is a take nobody goes looking at.

        Answers {"ok", "duration_sec", "aside", "home", "moved"}: the folder of
        originals, the take's folder (where the leftovers came from), and each
        original as {"name", "source", "cropped"}, "cropped" false for a
        leftover, which has no cropped file in its place.
        """
        files = [*tracks, *notes]
        take_dir = Path(files[0]["file"]).parent
        written = []
        # What the new files really came out as. Tracks of a take may differ in
        # length, so the take is as long as its longest one — and the region
        # that was asked for is not that length: it is not clamped to the file
        # for a draft, and a legacy take with no stored duration is not clamped
        # at all. A take of nothing but notes has no audio to measure: it is
        # the region.
        kept_sec = 0.0 if tracks else max(0.0, end_sec - start_sec)
        # How far along it is, the tracks weighed by their length.
        stages = activitymod.Stages(
            [(f"Track {i + 1} of {len(tracks)}", wav_frames(t["file"]))
             for i, t in enumerate(tracks)],
            progress or (lambda fraction, step: None),
        )
        for i, t in enumerate(tracks):
            source = Path(t["file"])
            target = _writing_path(source)
            res = crop_wav(source, target, start_sec, end_sec,
                           progress=stages.part(i))
            if not res["ok"]:
                target.unlink(missing_ok=True)
                for w in written:
                    w.unlink(missing_ok=True)
                return {"ok": False, "error": res["error"]}
            written.append(target)
            kept_sec = max(kept_sec, res["frames"] / res["samplerate"])
        for n in notes:
            source = Path(n["file"])
            target = _writing_path(source)
            res = crop_mid(source, target, start_sec, end_sec)
            if not res["ok"]:
                target.unlink(missing_ok=True)
                for w in written:
                    w.unlink(missing_ok=True)
                return {"ok": False, "error": f"{source.name}: {res['error']}"}
            written.append(target)

        # The clock and the record go with a .midraw only when there is one, as
        # _move_unmade_notes has it.
        left = sorted(take_dir.glob(f"*{MIDRAW_SUFFIX}"))
        if left:
            left += [p for p in (take_dir / CLOCK_FILE, take_dir / TAKE_RECORD) if p.exists()]

        aside = _unique_path(take_dir.with_name(f"{take_dir.name} (before crop)"))
        # Every original that reached the aside folder, oldest first. On
        # Windows, renaming a file another process has open raises, and a move
        # that stops half way used to leave some tracks aside, some in place
        # and the take's record pointing at paths that had moved — behind an error
        # message that reads as if nothing had happened.
        moved = []
        try:
            aside.mkdir(parents=True)
            for source in [*(Path(f["file"]) for f in files), *left]:
                # Two files of one name from two folders would meet in one
                # folder, the second over the first.
                if os.path.lexists(aside / source.name):
                    raise FileExistsError(f"two of the take's files are called {source.name}")
                shutil.move(str(source), str(aside / source.name))
                moved.append((aside / source.name, source))
            for f, target in zip(files, written):
                os.replace(target, Path(f["file"]))
        except OSError as e:
            # Backwards, so that an original lands on top of a replacement
            # already made rather than under it. os.replace rather than
            # shutil.move because the aside folder is a sibling of the take —
            # the same filesystem — and only os.replace overwrites on Windows
            # as well. Each step gets its own guard: a rollback that gives up
            # part way is worse than one that does what it can.
            for stored, original in reversed(moved):
                try:
                    os.replace(stored, original)
                except OSError:
                    pass
            for w in written:
                try:
                    w.unlink(missing_ok=True)
                except OSError:
                    pass
            try:
                aside.rmdir()  # only when it is empty, which is the point
            except OSError:
                pass
            return {"ok": False, "error": f"Could not replace the tracks: {e}"}

        cropped = {Path(f["file"]) for f in files}
        return {
            "ok": True,
            "duration_sec": round(kept_sec, 2),
            "aside": aside,
            "home": take_dir,
            "moved": [{"name": stored.name, "source": source, "cropped": source in cropped}
                      for stored, source in moved],
        }

    def _hold_uncut(self, record, done):
        """
        The originals a crop put aside (_crop_tracks) into the holding
        folder, where they wait for the crop's Undo (undo_trash) or for its
        notice to end (end_trash, which sends them to the Trash). The record
        is the caller's, plus where each original came from. Once the crop
        is done, so a hold that fails takes nothing back: the folder of
        originals stays beside the take, and the answer says where.
        Returns (token, None) or (None, why).
        """
        record = {
            **record,
            "kind": "crop",
            "reason": "crop",
            # Nothing of the library's goes with it: the take is still there.
            "rows": "none",
            "home": self._recordings_key(done["home"]),
            "files": [{"name": m["name"], "from": self._recordings_key(m["source"]),
                       "cropped": m["cropped"]} for m in done["moved"]],
        }
        try:
            return holding.hold(self._recordings_dir, record, [done["aside"]]), None
        except (OSError, ValueError) as e:
            log.error("crop: the uncut take could not wait for its Undo, and is in %s: %s",
                      done["aside"], e)
            return None, f"{e}, and is still at {done['aside']}"

    def _start_crop(self, idents, reasons=None, ended=None):
        """
        Before a crop moves anything, under _files_lock: an Undo of the item
        (`idents`) that was broken off is finished first, as it moves the
        item's files (_end_before with `broken`, only those made for one of
        `reasons` when given); then the item is registered as being cropped,
        until _end_crop. Meanwhile its crop's Undo (_uncrop), its delete,
        discard, rename, save (keep_take) or rescue (recover_draft), and a
        delete or rename of its rehearsal, wait ("Wait until the crop is
        done."): the crop moves the take's files outside the lock, and its
        places are empty for a moment.
        An earlier crop's entry ends only once this crop's own is held, so
        that a crop that fails leaves that Undo there. False, with nothing
        registered, when a crop of the item is under way already. The tokens
        of the Undos it finished go into `ended`.
        """
        with self._files_lock:
            done = self._end_before(idents, stale=False, reasons=reasons, broken=True)
            if ended is not None:
                ended += done
            if self._being_cropped(idents):
                return False
            self._cropping.extend(idents)
            return True

    def _end_crop(self, idents):
        """The crop of the item is done (_start_crop), however it went."""
        with self._files_lock:
            for ident in idents:
                self._cropping.remove(ident)

    def _being_cropped(self, idents):
        """Whether a crop of any of these items, or of something they hold
        (a take of a rehearsal), is under way (_start_crop)."""
        with self._files_lock:
            return any(_ends(i, c) for i in idents if i for c in self._cropping)

    @serialised
    def crop_take(self, folder, take_number, start_sec, end_sec):
        """
        Keeps only [start, end) of a saved take. The take keeps its number,
        its name and its folder: from the outside it is the same take, shorter.

        The take as it was waits in the holding folder (_hold_uncut), with a
        record of what the crop changed (its marks before it, the dropped
        ones among them, its length, and the shape of its cloud copy), for
        the crop's Undo (undo_trash) or for its notice to end (end_trash,
        which sends it to the Trash): {"ok": True, "take", "markers_dropped",
        "undo": token}. "undo" is None, and "error" says why and where the
        uncut take is, when it could not be held: the crop is done all the
        same, so that is a warning, not a failure.
        """
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        def what_to_crop():
            take = self._lib.take(folder, take_number)
            if take is None:
                if not self._lib.has(folder):
                    return {"ok": False, "error": "Rehearsal not found"}
                return {"ok": False, "error": "Take not found"}
            tracks = [t for t in take["tracks"] if Path(t.get("file", "")).exists()]
            notes = [n for n in take.get("notes") or [] if Path(n.get("file", "")).exists()]
            if not tracks and not notes:
                return {"ok": False, "error": "The take has no files left on disk"}
            span = self._crop_span(take["duration_sec"], start_sec, end_sec)
            if "error" in span:
                return {"ok": False, "error": span["error"]}
            if take.get("click"):
                span = self._on_grid(tracks, span, take.get("tempo"), take.get("signature"))
            return {"ok": True, "take": take, "tracks": tracks, "notes": notes, "span": span}

        asked = what_to_crop()
        if not asked["ok"]:
            return asked
        ref = self._lib.rehearsal_ref(folder)
        if ref is None:
            return {"ok": False, "error": "Rehearsal not found"}
        ident = {"kind": "take", "rehearsal_id": ref["id"], "take_number": int(take_number)}
        # The tokens of the entries this crop ends, however it goes ("ended").
        ended = []
        if not self._start_crop([ident], ended=ended):
            return {"ok": False, "error": CROPPING, "ended": ended}
        try:
            return {**self._crop_take(folder, take_number, ident, ref, what_to_crop, ended),
                    "ended": ended}
        finally:
            self._end_crop([ident])

    def _crop_take(self, folder, take_number, ident, ref, what_to_crop, ended):
        """crop_take, once the take is registered as being cropped
        (_start_crop). The tokens of the entries it ends go into `ended`."""
        # Read again: the end of a broken-off Undo can have moved its files.
        asked = what_to_crop()
        if not asked["ok"]:
            return asked
        take, tracks, notes, span = asked["take"], asked["tracks"], asked["notes"], asked["span"]
        # What the crop needs of the library, read before any file moves: a
        # library that fails here changes nothing on disk. The copies other
        # takes name are asked for here only as that check: by the time the
        # crop is done they may be others (below).
        try:
            rows = self._lib.take_record(folder, take_number)
            if rows is not None:
                self._lib.cloud_paths(but=rows["take"]["id"])
        except Exception as e:  # noqa: BLE001 - nothing has moved: answered
            log.error("crop: the library could not be read, so nothing was cropped: %s", e)
            return {"ok": False, "error": f"Could not crop: {e}"}
        if rows is None:
            return {"ok": False, "error": "Take not found"}

        # Tracks are played through a memmap, and Windows will not let a
        # mapped file be renamed or removed. macOS will, which is exactly
        # how this would have reached a Windows rehearsal unnoticed.
        playing = self._open_tracks
        self.player_close()

        done = self._journaled(
            "crop", f"Cropping “{take.get('name') or f'Take {take_number}'}”",
            folder, take_number,
            lambda progress: self._crop_tracks(
                tracks, span["start"], span["end"], progress=progress, notes=notes),
        )
        if not done["ok"]:
            # Nothing else will put the player back: the take's tracks are
            # what the interface reopens on, and a failed crop leaves them
            # exactly as they were, so its open effect never re-runs. The
            # transport would go on looking alive over a player Python has
            # closed.
            if playing:
                self._player_open(playing)
            return done

        # The markers are read and rewritten in one transaction, now that the
        # crop is done: it takes seconds, and a marker placed on the take
        # meanwhile must move with the audio rather than be written over by
        # a list read before it existed. The list read there is what Undo
        # puts back, the dropped marks among it.
        dropped = 0
        before = []

        def shift(markers):
            nonlocal dropped
            before[:] = markers
            kept = []
            for m in markers:
                if _kept_by_crop(m, span["start"], span["end"]):
                    kept.append({**m, "at": round(m["at"] - span["start"], 2)})
                else:
                    dropped += 1
            return kept

        # What is in the cloud folder is a copy of a take that no longer
        # exists, so it goes and its record goes with it. The length in
        # the cloud.source_of fingerprint covers the other half of this: a
        # copy already under way can write its record after this line, and
        # a record that still matched the shorter take would suppress its
        # own repair. Undo sends the uncut take back there in this shape.
        had = _shape_of(take.get("cloud"))
        with self._files_lock:
            try:
                found = (self._lib.edit_markers(folder, take_number, shift) is not None
                         and self._lib.update_take(
                             folder, take_number, duration_sec=done["duration_sec"]) is not None)
            except Exception as e:  # noqa: BLE001 - the files are cut: answered
                log.error("crop: the take's record could not follow its crop; "
                          "the uncut take is in %s: %s", done["aside"], e)
                # The tracks are cut and the record is not, so there is no
                # Undo to offer: the uncut take stays beside the take, whole,
                # and the answer names it, as nothing else on screen would.
                # The player opens again, as for a crop that failed.
                if playing:
                    self._player_open(playing)
                return {"ok": False,
                        "error": "The crop is done but its marks could not follow; "
                                 f"the uncut take is in “{done['aside']}”."}
            if not found:
                # Deleted while it was being cropped: there is no take for an
                # Undo to put it back into, so its uncut files go the way a
                # removal's go, on to the Trash now.
                token, _ = self._hold_uncut({"item": ident, "rehearsal": ref}, done)
                if token is not None:
                    gone = self._end(token)
                    if not gone.get("ok"):
                        self._kept(token, gone.get("error"))
                return {"ok": False, "error": "Take not found"}
            # Not a copy another take names now (one that came after it under
            # the same name): that one stays. Asked now, not before the crop:
            # the copy worker runs outside _files_lock, and may have recorded
            # such a copy meanwhile. Should the library not say, the copy
            # stays too: one left behind is the safe way to fail.
            try:
                live = self._lib.cloud_paths(but=rows["take"]["id"])
            except Exception as e:  # noqa: BLE001 - the crop is done all the same
                log.error("crop: the take's old cloud copy is left in the cloud folder, as "
                          "which copies other takes name could not be read: %s", e)
                live = None
            if live is not None:
                self._remove_shared(self._unused(take.get("cloud"), live))
            self._lib.set_cloud_copy(folder, take_number, None, None)
            token, error = self._hold_uncut({
                "item": ident,
                "rehearsal": ref,
                "take_id": rows["take"]["id"],
                "start": span["start"],
                "end": span["end"],
                "markers": before,
                "duration_sec": take["duration_sec"],
                "had": had,
            }, done)
            # The take this crop started from is the one its own entry holds:
            # an earlier crop's uncut take, whose Undo would put back a take
            # this crop did not start from, goes on to the Trash (_ends).
            ended += self._end_before([ident], reasons={"crop"}, exclude={token})

        # A take that was in the cloud goes back there cropped, in the shape
        # it had, whether sending on its own is on or not: the copy follows
        # the take. One that was not is sent only if it is due to be.
        if had:
            self._queue_copy(folder, take_number, had)
        else:
            self._enqueue_publish(folder, take_number)
        self._retry_failed_publishes()
        return {
            "ok": True,
            "take": self._lib.take(folder, take_number),
            "markers_dropped": dropped,
            "undo": token,
            # Where it was cut, which for a click take is on its grid and not
            # quite where it was asked: the notice says where it now starts.
            "start_sec": span["start"],
            "end_sec": span["end"],
            # Present only when the uncut take could not be held: the crop
            # still succeeded, but there is no Undo, and this says where the
            # uncut take is instead.
            **({"error": error} if error else {}),
        }

    @serialised
    def crop_draft(self, temp_dir, tracks, start_sec, end_sec, notes=None):
        """
        The same cut, one folder over. A take that has been stopped is proper
        .wav already — capture wraps the raw PCM on stop — it just has no
        record in the database yet, so there is nothing here to fix up. The
        files keep their paths, so the caller saves the take as it would have.
        `notes` are its .mid files, [{"name", "file"}] like the tracks, cut
        with them and answered the same way. Every other .mid in the draft is
        cut too, as Keep keeps it (_draft_notes), and is not in the answer.

        The draft as it was waits for the crop's Undo as crop_take's take
        does, and is answered the same way: "undo", or None with "error".
        """
        temp_dir = Path(temp_dir)
        if not self._inside_recordings(temp_dir):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        def what_to_crop():
            live = [t for t in (tracks or []) if Path(t.get("file", "")).exists()]
            given = [n for n in (notes or []) if Path(n.get("file", "")).exists()]
            band = self._session["tracks"] if self._session is not None else []
            live_notes = self._draft_notes(temp_dir, band, given)
            if not live and not live_notes:
                return {"ok": False, "error": "The take has no files left on disk"}
            span = self._crop_span(0, start_sec, end_sec)
            if "error" in span:
                return {"ok": False, "error": span["error"]}
            meter = self._meter_of_draft(temp_dir)
            if meter["click"]:
                span = self._on_grid(live, span, meter["tempo"], meter["signature"])
            return {"ok": True, "live": live, "given": given, "live_notes": live_notes,
                    "span": span}

        asked = what_to_crop()
        if not asked["ok"]:
            return asked
        ref = self._draft_rehearsal(temp_dir)
        ident = self._draft_identity(temp_dir, ref)
        idents = [ident] if ident is not None else []
        # As crop_take. Only a crop: a discard of a draft of that name is
        # another draft's (keep_take).
        ended = []
        if not self._start_crop(idents, reasons={"crop"}, ended=ended):
            return {"ok": False, "error": CROPPING, "ended": ended}
        try:
            return {**self._crop_draft(temp_dir, ident, idents, ref, what_to_crop, ended),
                    "ended": ended}
        finally:
            self._end_crop(idents)

    def _crop_draft(self, temp_dir, ident, idents, ref, what_to_crop, ended):
        """crop_draft, once the draft is registered as being cropped
        (_start_crop). The tokens of the entries it ends go into `ended`."""
        asked = what_to_crop()
        if not asked["ok"]:
            return asked
        live, given, live_notes, span = (
            asked["live"], asked["given"], asked["live_notes"], asked["span"])

        playing = self._open_tracks
        self.player_close()
        done = self._journaled(
            "crop", "Cropping the take", temp_dir, None,
            lambda progress: self._crop_tracks(
                live, span["start"], span["end"], progress=progress, notes=live_notes),
        )
        if not done["ok"]:
            # See crop_take: the files the interface would reopen on have not
            # changed, so nothing over there will reopen them.
            if playing:
                self._player_open(playing)
            return done
        with self._files_lock:
            token, error = self._hold_uncut({"item": ident, "rehearsal": ref}, done)
            ended += self._end_before(idents, reasons={"crop"}, exclude={token})
        return {
            "ok": True,
            "tracks": live,
            "notes": given,
            "duration_sec": done["duration_sec"],
            "undo": token,
            "start_sec": span["start"],
            "end_sec": span["end"],
            **({"error": error} if error else {}),
        }

    # ---------- playback ----------

    @serialised
    def player_open(self, tracks, reuse_existing=False):
        return self._player_open(tracks, reuse_existing)

    def _player_open(self, tracks, reuse_existing=False):
        # File operations already own their transaction/file locks. Reacquiring
        # the action gate there would invert the gate -> files -> player order.
        # Calls from the interface arrive on their own threads, so opening and
        # closing a player has to be serialised: a close landing in the middle
        # of an open used to leave a half-built stream behind.
        with self._player_lock:
            if reuse_existing and self._player is not None and self._open_tracks == tracks:
                return {"ok": True, **self._player.state()}
            result = self._open_player(tracks)
        # Once the player's lock is let go, never inside it: a click between
        # takes on this device moves into the new stream, or keeps its own
        # (metronome.py's note on the locks).
        self._resink()
        return result

    def _open_player(self, tracks):
        """_player_open's part with the player's lock held: the one open
        before closed, without moving a click between takes (that comes
        after), and this one opened."""
        self._close_player()
        try:
            player = TakePlayer(tracks)
            index = saved_device(self._config, "output_device", False)
            # A click between takes with a stream of its own there lets go of
            # it first; _resink then carries it on in this one. STREAM_LOCK
            # held throughout, so no ▶ reopens it on the device in between.
            with STREAM_LOCK:
                self._metronome.make_room(index)
                self._backing.make_room(index)
                # Wide enough for the click's and the backing track's
                # outputs, when their device is this one.
                warning = player.open_output(
                    index, self._output_channels(),
                    extra_channels=self._extra_channels(index),
                )
        except Exception as e:
            return {"ok": False, "error": str(e)}

        for name, v in self._config.get("volumes", {}).items():
            player.set_volume(name, v)
        player.set_master(self._config.get("master_volume", 1.0))
        player.set_master_muted(self._transport.playback_muted)
        # A click take plays with its own click when Master's button is on
        # (spec Part 8): made again from its tempo, at the metronome's volume.
        meter = self._take_click_of(tracks)
        try:
            if meter is not None:
                player.set_take_click(*meter, self._metronome.voices(player.samplerate))
            player.set_click_on(self._player_click)
        except Exception:
            # The take plays all the same, without its click.
            log.exception("The take's click could not be set up in the player")

        self._player = player
        self._open_tracks = tracks
        try:
            selected = next((t for t in self._session_takes() if t["tracks"] == tracks), None)
            self._transport.playback_take_number = selected["take_number"] if selected else None
            self._transport.playback_take_name = selected["name"] if selected else None
        except Exception:
            self._transport.playback_take_number = None
        result = {"ok": True, **player.state()}
        if warning:
            result["warning"] = warning
        return result

    def _take_click_of(self, tracks):
        """
        (tempo, signature) of the click take whose files `tracks` are, or None
        for a take that was not recorded to the click: a draft's from its Stop
        or its take.json, a kept take's from the library, found by its first
        file. Never raises: a take whose click cannot be found plays without.
        """
        try:
            first = next(Path(t["file"]) for t in tracks or [] if t.get("file"))
        except StopIteration:
            return None
        try:
            home = first.parent
            if home.parent.name == DRAFTS_DIR:
                meter = self._meter_of_draft(home)
            elif self._recordings_key(home.parent) is None:
                # Files from outside the recordings folder: no take of the library's.
                return None
            else:
                rehearsal = self._library.rehearsal(home.parent) if self._library is not None else None
                meter = next((t for t in (rehearsal or {}).get("takes", [])
                              if any(Path(f["file"]) == first for f in t["tracks"])), None)
        except Exception:
            log.exception("A take's click could not be found, so it plays without one")
            return None
        if not meter or not meter.get("click") or meter.get("tempo") is None:
            return None
        return meter["tempo"], meter["signature"]

    def player_close(self):
        self._close_player()
        # Outside the player's lock: a click between takes in the player's
        # stream goes on in a stream of its own.
        self._resink()
        return {"ok": True}

    def _close_player(self):
        """The player closed, a click between takes left where it is: the
        caller moves it (_resink) once no lock of this side's is held."""
        with self._player_lock:
            player, self._player = self._player, None
            self._open_tracks = None
            self._transport.playback_take_number = None
            self._transport.playback_take_name = None
            if player is not None:
                player.close()

    def _resink(self):
        """A click between takes follows the player opening and closing
        (Metronome.resink), and a backing track it played stops
        (Backing.resink). Never with STREAM_LOCK or the player's lock held.
        One that cannot follow is said in the log; the player is not the
        worse for it."""
        try:
            self._metronome.resink()
        except Exception:
            log.exception("The click between takes could not follow the player")
        try:
            self._backing.resink()
        except Exception:
            log.exception("The backing track between takes could not follow the player")

    def _extra_channels(self, index):
        """The outputs the click and the backing track have of their own on
        device `index`, for a player opening there."""
        return tuple(sorted({*self._metronome.extra_channels(index), *self._backing.extra_channels(index)}))

    def player_set_click(self, on):
        """Master's metronome button: whether a click take plays with its
        click. Off when the app starts, and kept from one take to the next."""
        self._player_click = bool(on)
        with self._player_lock:
            if self._player is not None:
                self._player.set_click_on(self._player_click)
        return {"ok": True}

    def _refresh_take_click(self):
        """The open player's take click made again, at the metronome's
        sound and volume as they are now."""
        with self._player_lock:
            player = self._player
            if player is None:
                return
            meter = self._take_click_of(self._open_tracks)
            try:
                if meter is not None:
                    player.set_take_click(*meter, self._metronome.voices(player.samplerate))
            except Exception:
                # The setting is saved; the take plays on with the click it had.
                log.exception("The take's click could not be made again in the player")

    def player_state(self):
        if self._player is None:
            return {"open": False}
        return {"open": True, "tracks": self._open_tracks, **self._player.state()}

    @serialised
    def player_toggle(self):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        if self._player.state()["playing"]:
            self._player.toggle()
            return {"ok": True, **self._player.state()}
        return self.player_play()

    @serialised
    def player_play(self):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        revived = self._revive_output()
        if revived.get("ok") is False:
            return revived
        self._player.play()
        return {"ok": True, **self._player.state(), **revived}

    def _revive_output(self):
        """
        A player whose output went quiet under it gets one before it plays
        again: the chosen card first, the system output if it is still gone,
        with the usual warning. {} when there was nothing to revive,
        {"reopened": True, "warning"?: ...} when it was done, or the failure.
        """
        with self._player_lock:
            if self._player is None or self._player.output_problem() is None:
                return {}
            reopened = self._reopen_output()
        self._resink()
        if not reopened.get("ok", True):
            return reopened
        return {
            "reopened": True,
            **({"warning": reopened["warning"]} if reopened.get("warning") else {}),
        }

    @serialised
    def player_pause(self):
        if self._player is None:
            return {"ok": True}
        self._player.pause()
        return {"ok": True, **self._player.state()}

    @serialised
    def player_seek(self, seconds):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        self._player.seek(seconds)
        return {"ok": True, **self._player.state()}

    def player_set_loop(self, start_sec, end_sec):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        self._player.set_loop(start_sec, end_sec)
        return {"ok": True, **self._player.state()}

    def player_set_volume(self, name, volume):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        self._player.set_volume(name, volume)
        return {"ok": True}

    def player_set_master(self, volume):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        self._player.set_master(volume)
        return {"ok": True}

    def player_set_muted(self, name, muted):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        self._player.set_muted(name, muted)
        return {"ok": True, **self._player.state()}

    def player_set_solo(self, name):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        self._player.set_solo(name)
        return {"ok": True, **self._player.state()}

    def _output_channels(self):
        """The outputs saved for playback, (1, 2) when nothing usable is."""
        saved = self._config.get("output_channels")
        return tuple(saved) if _is_output_choice(saved) else (1, 2)

    def set_output_device(self, device_index):
        """Switching the output applies immediately, even mid-take.

        The outputs go back to 1–2: which pair is which belongs to one card,
        and 7–8 on the desk means nothing — or something else — on another."""
        self._remember_device("output_device", device_index)
        self._config["output_channels"] = [1, 2]
        self._write_config()
        self._metronome.devices_changed()
        reopened = self._reopen_output()
        self._resink()
        return reopened

    def set_output_channels(self, channels):
        """Which outputs of the playback card the mix comes out of: a pair
        such as [3, 4], or one output on its own, [5]. Counted from 1."""
        if not _is_output_choice(channels):
            return {"ok": False, "error": f"Not a pair of outputs: {channels}"}
        self._config["output_channels"] = list(channels)
        self._write_config()
        reopened = self._reopen_output()
        self._resink()
        return reopened

    def _reopen_output(self):
        """The open player's stream opened again where the settings say now.
        A click between takes it carried is moved by the caller, after
        (_resink): never in here, which a rescan calls with STREAM_LOCK held."""
        with self._player_lock:
            if self._player is None:
                return {"ok": True}

            # Only the stream is reopened. close() would also let go of the
            # take itself, which used to leave the player running on nothing
            # but silence after a device change.
            state = self._player.state()
            try:
                index = saved_device(self._config, "output_device", False)
                # As in _open_player: never a second stream on the click's.
                with STREAM_LOCK:
                    self._metronome.make_room(index)
                    self._backing.make_room(index)
                    warning = self._player.open_output(
                        index, self._output_channels(),
                        extra_channels=self._extra_channels(index),
                    )
            except Exception as e:
                return {"ok": False, "error": str(e)}
            self._player.seek(state["position"])
            if state["playing"]:
                self._player.play()
            return {"ok": True, **({"warning": warning} if warning else {})}

    # ---------- the metronome ----------

    def set_click_device(self, device_index):
        """
        The click's own output (Settings › Metronome), as set_output_device is
        the player's; None puts the click back where the player plays. Its
        outputs go back to 1-2, or 1 on a card that has one: which outputs
        are which belongs to one card. Refused for a card the click cannot
        play through (list_output_devices' `click_unavailable`). A player
        open on that card opens again, wide enough for the click's outputs.
        """
        if device_index is None:
            for key in ("click_device", "click_device_index", "click_channels"):
                self._config.pop(key, None)
        else:
            found = next((d for d in self.list_output_devices() if d["index"] == device_index), None)
            if found is None:
                return {"ok": False, "error": "That device has no outputs to play the click on."}
            if found["click_unavailable"]:
                return {"ok": False, "error": found["click_unavailable"]}
            self._remember_device("click_device", device_index)
            self._config["click_channels"] = [1, 2] if found["max_output_channels"] >= 2 else [1]
        self._write_config()
        return self._click_moved()

    def set_click_channels(self, channels):
        """Which outputs of the click's own device it comes out of: a pair
        such as [3, 4], or one output on its own, [5]. Counted from 1."""
        if not _is_output_choice(channels):
            return {"ok": False, "error": f"Not a pair of outputs: {channels}"}
        saved = self._metronome.set_setting("click_channels", list(channels))
        if not saved.get("ok"):
            return saved
        return self._click_moved()

    def _click_moved(self):
        """The click's or the backing track's output was chosen: where it is
        is read again, a player open on it opens again with its outputs or
        without them, and a click between takes follows. The choice is kept
        whatever the player did, which comes back as a warning."""
        self._metronome.devices_changed()
        reopened = self._reopen_output()
        self._resink()
        warning = reopened.get("warning") if reopened.get("ok", True) else reopened.get("error")
        return {"ok": True, **({"warning": warning} if warning else {})}

    def set_metronome_setting(self, key, value):
        """One of Settings › Metronome's: the sound, the volume, the count-in,
        whether a click take's WAVs carry its tempo, and how far off a bar of
        the drift line turns amber. The click's output and the switch have
        calls of their own."""
        if key not in ("click_sound", "click_volume", "count_in_bars", "tempo_in_wav", "drift_tolerance"):
            return {"ok": False, "error": f"No metronome setting is called {key}"}
        saved = self._metronome.set_setting(key, value)
        if saved.get("ok") and key in ("click_sound", "click_volume"):
            # A take playing back with its click hears the new one too.
            self._refresh_take_click()
        return saved

    def metronome_set(self, tempo, signature):
        """A change in the row: held until the next take's name names another
        song (Metronome.set)."""
        return self._metronome.set(tempo, signature)

    def metronome_save_to_song(self):
        """The row's tempo and signature become the song's, the song the next
        take is named for."""
        try:
            return self._metronome.save_to_song()
        except (SongRefused, LibraryUnavailable) as e:
            return {"ok": False, "error": str(e)}

    def metronome_set_on(self, on):
        """The row's switch, mid-take too: whether Record clicks."""
        return self._metronome.set_on(on)

    @serialised
    def metronome_play(self, tempo=None, signature=None):
        """▶: the click between takes at the row's tempo, until Stop, Record
        or the row being emptied. With a `tempo`, a song page's ▶: that tempo
        in `signature`, checked as the row's is, and the row left as it is.
        A backing track's ▶ stops: one plays at a time."""
        self._backing.stop()
        return self._metronome.play(tempo, signature)

    @serialised
    def metronome_stop(self):
        """■: the click between takes stops. A take's own click is the take's."""
        return self._metronome.stop()

    @serialised
    def metronome_preview(self, sound=None):
        """A bar of the click in `sound`, or the one set, for Settings."""
        return self._metronome.preview(sound=sound)

    def metronome_state(self):
        """What the metronome is doing, for the row and the recording screen,
        and under "backing" the backing track's row (Backing.state): polled,
        and never waits. A backing track's row that cannot say is left out,
        and the metronome's stays."""
        try:
            backing = self._backing.state()
        except Exception:
            log.exception("The backing track's row could not be read")
            backing = {"song": None, "on": False, "volume": 0.0, "row": False, "playing": False,
                       "position_sec": 0, "output_missing": None, "getting_ready": False, "free": False}
        return {**self._metronome.state(), "backing": backing}

    def _take_elapsed(self):
        """
        How far into the take recording now, for the controller's display:
        for a click take from its count-in's end, as the screen's clock counts
        (0:00 when the band comes in, and until then); for one with a backing
        track and no click from where its files start; otherwise from Record.
        """
        recorder = self._recorder
        if recorder is None:
            return 0
        frames, rate = recorder._frames_written, recorder.samplerate
        click = recorder.click
        if click is None:
            return frames / rate
        first = click.first_click_frame
        if first is None:
            return 0
        if not click.clicks:
            return max(0, frames - first) / rate
        return max(0, frames - first - click_frame(click.count_in_clicks, click.tempo, rate)) / rate

    def count_tempo(self, folder, take_number, signature):
        """
        A take's tempo, counted from its files (spec Part 10), as a whole
        number in `signature`'s own count: the drums' .mid when it has one,
        else the drums' WAV (the track the take keeps the drums icon for),
        else every track mixed; never its Backing track, which is the file's
        tempo and not the band's. {"ok": True, "tempo"}, or {"ok": False,
        "error"}.
        """
        if signature not in SIGNATURES:
            return {"ok": False, "error": SIGNATURE_RULE}
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        take = self._lib.take(folder, take_number)
        if take is None:
            return {"ok": False, "error": "Take not found"}
        tracks = [t for t in take["tracks"] if t.get("kind") != "backing"]
        missing = [Path(t["file"]).name for t in tracks if not Path(t["file"]).is_file()]
        if missing or not tracks:
            return {"ok": False,
                    "error": f"Missing from the take's folder: {', '.join(missing)}" if missing
                    else "The take has no files left on disk"}
        drums = [t["file"] for t in tracks if t.get("icon") == "drums"]
        hits = [n["file"] for n in take.get("notes") or []
                if n.get("icon") == "drums" and Path(n["file"]).is_file()]
        try:
            found = tempomod.count(drums_mid=hits[0] if hits else None,
                                   drums_wav=drums[0] if drums else None,
                                   wavs=[t["file"] for t in tracks], signature=signature)
        except (OSError, EOFError, wave.Error, ValueError) as e:
            return {"ok": False, "error": f"Could not read the take: {e}"}
        if found is None:
            return {"ok": False, "error": "This take is too short or too quiet to count a tempo from."}
        return {"ok": True, "tempo": clamp_tempo(found, signature)}

    def take_drift(self, tracks, notes, meter):
        """
        The band's tempo through a take, bar by bar, for the drift line on
        Master (drift spec Parts 1, 2 and 4). `tracks` and `notes` are the
        take's audio and .mid files as the player has them, {"name", "file",
        "icon"};
        `meter` is the take's own {"tempo", "signature", "click", "song"}.

        The aim is the click's tempo on a click take, else the take's tempo,
        else its song's tempo now, else the middle of its own bars. What it
        listens to is found by the icons the take keeps, as take_media finds
        a lane's: the drums' .mid, else the drums' WAVs, else every WAV but a
        backing track's: the take's Backing track, and a track given the
        backing track's icon.

        {"ok": True, "source", "per_bar", "middle", "aim": {"tempo",
        "signature", "from": "click" | "take" | "song" | "middle", "song"},
        "bars"}, or {"ok": False, "why"}: "missing" (a file is not on disk),
        "short", "no-beat", or "recording" when Record stopped it, which the
        player asks again for once it opens. The last 32 answers are kept by
        the files' paths, sizes and times and the aim, so a take opened again
        is not counted again, and a cropped one is; one asked for again while
        it is counted waits for that count. Nothing is stored.
        """
        if self._recorder is not None:
            return {"ok": False, "why": "recording"}
        meter = meter if isinstance(meter, dict) else {}
        wavs = [t for t in tracks or [] if isinstance(t, dict) and t.get("file") and t.get("kind") != "backing"]
        if not wavs or any(not Path(t["file"]).is_file() for t in wavs):
            return {"ok": False, "why": "missing"}
        tempo, signature, source, song = self._drift_aim(meter)
        drums = [t["file"] for t in wavs if t.get("icon") == "drums"]
        hits = [n["file"] for n in notes or [] if isinstance(n, dict) and n.get("file")
                and n.get("icon") == "drums" and Path(n["file"]).is_file()]
        mix = [t["file"] for t in wavs if t.get("icon") != "backing"]
        files = hits[:1] + drums + mix
        try:
            key = (tuple((f, os.stat(f).st_size, os.stat(f).st_mtime_ns) for f in files), tempo, signature, source, song)
        except OSError:
            return {"ok": False, "why": "missing"}
        with self._drifts_lock:
            if key in self._drifts:
                self._drifts.move_to_end(key)
                return self._drifts[key]
            under_way = self._drifts_counting.get(key)
            if under_way is None:
                self._drifts_counting[key] = (threading.Event(), [])
        if under_way is not None:
            # The same take, asked for again while it is counted (opened,
            # left and opened again): the first count's answer, whatever it is.
            done, answer = under_way
            done.wait()
            return answer[0]
        found = {"ok": False, "why": "missing"}
        try:
            found = self._count_drift(hits, drums, mix, tempo, signature, source, song)
            if found.get("why") not in ("recording", "missing"):
                with self._drifts_lock:
                    self._drifts[key] = found
                    while len(self._drifts) > DRIFTS_KEPT:
                        self._drifts.popitem(last=False)
            return found
        finally:
            with self._drifts_lock:
                done, answer = self._drifts_counting.pop(key)
            answer.append(found)
            done.set()

    def _count_drift(self, hits, drums, mix, tempo, signature, source, song):
        """take_drift's count itself: stopped by Record, a file that cannot be
        read is "missing", and a counted take gets its aim."""
        round_ = self._drift_round
        stop = lambda: self._drift_round != round_ or self._recorder is not None
        try:
            found = driftmod.count(drums_mid=hits, drums=drums, mix=mix, tempo=tempo,
                                   signature=signature or "4/4", click=source == "click", stop=stop)
        except tempomod.Cancelled:
            return {"ok": False, "why": "recording"}
        except (OSError, EOFError, wave.Error, ValueError) as e:
            log.warning("The drift of a take could not be counted: %s", e)
            return {"ok": False, "why": "missing"}
        if found["ok"]:
            aim = tempo if tempo is not None else round(found["middle"])
            found = {key_: found[key_] for key_ in ("ok", "source", "per_bar", "middle", "bars")}
            found["aim"] = {"tempo": aim, "signature": signature or "4/4", "from": source, "song": song}
        return found

    def _drift_aim(self, meter):
        """(tempo, signature, where it is from, the song's title) for a take's
        drift line: its click's, its own, its song's now, or none (drift spec
        Part 1). The title is the library's, for a tempo that is the song's."""
        tempo, signature = meter.get("tempo"), meter.get("signature")
        if signature not in SIGNATURES:
            tempo = signature = None
        if isinstance(tempo, bool) or not isinstance(tempo, (int, float)) or tempo <= 0:
            tempo = None
        if tempo is not None:
            return tempo, signature, "click" if meter.get("click") is True else "take", None
        song = meter.get("song")
        if isinstance(song, str) and song:
            try:
                tempos = self._lib.song_tempos()
            except Exception:
                log.exception("The songs' tempos could not be read for a drift line")
                tempos = {}
            title = next((t for t in tempos if t.casefold() == song.casefold()), None)
            own, sig = tempos.get(title, (None, None)) if title else (None, None)
            if own is not None and sig in SIGNATURES:
                return own, sig, "song", title
        return None, None, "middle", None

    @_follows
    def set_song_tempo(self, song_id, tempo, signature):
        """A song's own tempo and signature, from its page; `tempo` None takes
        both away. The row follows when the next take is the song's."""
        try:
            saved = self._lib.set_song_tempo(song_id, tempo, signature)
        except SongRefused as e:
            return {"ok": False, "error": str(e)}
        if saved is None:
            return {"ok": False, "error": "Song not found"}
        return {"ok": True, **saved}

    # ---------- a song's backing track ----------

    def pick_backing_file(self):
        """The file picker for a song's backing track: {"ok", "path",
        "name"}, or {"ok": False, "cancelled": True}. Nothing is added until
        add_backing, so the page can show the name first."""
        if self._window is None:
            return {"ok": False, "error": "No window available"}
        try:
            import webview

            picked = self._window.create_file_dialog(
                webview.OPEN_DIALOG, file_types=("Audio files (*.wav;*.aif;*.aiff;*.flac;*.mp3;*.ogg)",)
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}
        if not picked:
            return {"ok": False, "cancelled": True}
        path = Path(picked[0])
        return {"ok": True, "path": str(path), "name": path.name}

    @serialised
    @_follows
    def add_backing(self, song_id, path):
        """Gives a song the backing track at `path`, or another in place of
        its own (Backing.add): {"ok", "name", "seconds", "channels", "tempo",
        "first_bar"}, or {"ok": False, "error"}. The row follows, as the song
        may have taken the counted tempo."""
        return self._backing.add(song_id, path)

    @serialised
    def remove_backing(self, song_id):
        """Takes a song's backing track away, its copy to the Trash."""
        return self._backing.remove(song_id)

    def set_backing_first_bar(self, song_id, seconds):
        """Where bar 1 of a song's backing track is, in seconds from its
        start: {"ok", "first_bar"} as kept, to a hundredth."""
        return self._backing.set_first_bar(song_id, seconds)

    @_follows
    def set_backing_tempo(self, song_id, tempo, to_song):
        """The tempo the backing track was counted at, halved or doubled;
        with `to_song` the song's tempo too."""
        return self._backing.set_tempo(song_id, tempo, bool(to_song))

    def set_song_backing_heard(self, song_id, heard):
        """Whether a take of the song opens with its Backing track heard, as M
        in the player left it: {"ok", "heard"}."""
        if not isinstance(heard, bool):
            return {"ok": False, "error": "Heard is on or off"}
        saved = self._lib.set_backing_heard(song_id, heard)
        if saved is None:
            return {"ok": False, "error": "Song not found"}
        return {"ok": True, "heard": saved}

    @_follows
    def add_song(self, title):
        """New song: a song with no takes, for a tempo and a backing track
        before its first take. {"ok", "id", "title"}, or {"ok": False,
        "error"} with "into", the song the title is already, when that is
        why."""
        try:
            made = self._lib.add_song(title)
        except SongRefused as e:
            return {"ok": False, "error": str(e), **({"into": e.into} if e.into else {})}
        return {"ok": True, **made}

    def song_backing_peaks(self, song_id, end_sec, buckets):
        """The start of a song's backing track drawn, for setting bar 1:
        {"ok", "peaks"}, a row of `buckets` for each channel."""
        return self._backing.peaks(song_id, end_sec, buckets)

    @serialised
    def backing_play(self, song_id, with_click=False):
        """A song page's ▶: its backing track from the start, and with
        `with_click` the click from bar 1 at the song's tempo beside it. The
        metronome's ▶ stops: one plays at a time."""
        tempo = signature = None
        if with_click:
            song = self._lib.song(song_id)
            if song is None:
                return {"ok": False, "error": "Song not found"}
            tempo, signature = song["tempo"], song["signature"]
        self._metronome.stop()
        return self._backing.play(song_id, tempo, signature)

    @serialised
    def backing_stop(self):
        """■: a backing track's ▶, or Settings' two seconds, stops."""
        return self._backing.stop()

    @serialised
    def backing_preview(self):
        """Two seconds of a backing track from bar 1, for Settings, where it
        is heard now. The metronome's ▶ stops."""
        self._metronome.stop()
        return self._backing.preview()

    def set_backing_device(self, device_index):
        """
        The backing track's own output (Settings › Metronome), as
        set_click_device is the click's; None puts it back where the player
        plays. Its outputs go back to 1-2, or 1 on a card that has one.
        Refused for a card it cannot play through (list_output_devices'
        `backing_unavailable`). What plays of it between takes stops.
        """
        if device_index is None:
            for key in ("backing_device", "backing_device_index", "backing_channels"):
                self._config.pop(key, None)
        else:
            found = next((d for d in self.list_output_devices() if d["index"] == device_index), None)
            if found is None:
                return {"ok": False, "error": "That device has no outputs to play the backing track on."}
            if found["backing_unavailable"]:
                return {"ok": False, "error": found["backing_unavailable"]}
            self._remember_device("backing_device", device_index)
            self._config["backing_channels"] = [1, 2] if found["max_output_channels"] >= 2 else [1]
        self._write_config()
        self._backing.stop()
        return self._click_moved()

    def set_backing_channels(self, channels):
        """Which outputs of the backing track's own device it comes out of:
        a pair such as [3, 4], or one output on its own. Counted from 1."""
        if not _is_output_choice(channels):
            return {"ok": False, "error": f"Not a pair of outputs: {channels}"}
        saved = self._backing.set_setting("backing_channels", list(channels))
        if not saved.get("ok"):
            return saved
        self._backing.stop()
        return self._click_moved()

    def set_backing_setting(self, key, value):
        """The backing track's volume or its switch, mid-take too. Whether
        the row shows it is set by adding one; the output has calls of its
        own."""
        if key not in ("backing_volume", "backing_on"):
            return {"ok": False, "error": f"No backing track setting is called {key}"}
        return self._backing.set_setting(key, value)

    def metronome_tap_listen(self):
        """Tap was pressed: the pads' hits count as taps until a pause, from
        the band's ports, opened for it outside a rehearsal (_TapPorts). Ports
        that will not open are said, for Tap to show, and never raised."""
        try:
            self._tap.listen(self._config.get("tracks") or [])
        except Exception as e:
            log.error("Tap could not open the band's ports: %s", e)
            return {"ok": False, "error": f"The band's MIDI ports could not be opened: {e}"}
        return {"ok": True}

    def metronome_taps(self):
        """The pads' hits since the last asking, as milliseconds ago, oldest
        first (polled)."""
        now = time.perf_counter_ns()
        return {"ms_ago": [round((now - t) / 1e6, 1) for t in self._midi.taps()]}

    # ---------- deleting ----------

    def _inside_recordings(self, path):
        return self._recordings_key(path) is not None

    @_follows
    def delete_take(self, folder, take_number):
        """
        Moves the take into the holding folder and drops its rows, asking
        nothing: {"ok": True, "undo": token, "takes_left"}. The token is what
        the interface's Undo sends back (undo_trash); the take reaches the
        Trash when that notice ends (end_trash), and its copy in the cloud
        folder leaves with it then. {"ok": False, "error"} leaves the take,
        rows and files, as it was.
        """
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        with self._files_lock:
            if self._lib.take(folder, take_number) is None:
                if not self._lib.has(folder):
                    return {"ok": False, "error": "Rehearsal not found"}
                return {"ok": False, "error": "Take not found"}
            if self._take_being_cropped(folder, take_number):
                return {"ok": False, "error": CROPPING}
            held = self._hold_takes(folder, [take_number], "take")
            if held["failed"]:
                return {"ok": False, "error": held["failed"][0]["error"],
                        "ended": held["ended"]}
            return {"ok": True, "undo": held["undo"], "takes_left": held["takes_left"],
                    "ended": held["ended"]}

    @_follows
    def delete_takes(self, folder, take_numbers):
        """Several takes at once, as delete_take deletes one: Clear false
        starts. All of them wait in one holding entry, with one Undo
        ("undo", None when none went). The ones that could not be deleted are
        said, and the rest are deleted all the same."""
        folder = Path(folder)
        numbers = list(dict.fromkeys(take_numbers))
        refused = {}
        found = []
        with self._files_lock:
            for n in numbers:
                if not self._inside_recordings(folder):
                    refused[n] = "Folder is outside the recordings directory"
                elif self._take_being_cropped(folder, n):
                    refused[n] = CROPPING
                elif self._lib.take(folder, n) is not None:
                    found.append(n)
                else:
                    refused[n] = ("Take not found" if self._lib.has(folder)
                                  else "Rehearsal not found")
            held = (self._hold_takes(folder, found, "takes") if found
                    else {"undo": None, "deleted": [], "failed": [], "ended": []})
        refused.update({f["take_number"]: f["error"] for f in held["failed"]})
        return {"ok": True, "deleted": held["deleted"],
                "failed": [{"take_number": n, "error": refused[n]}
                           for n in numbers if n in refused],
                "undo": held["undo"], "ended": held["ended"]}

    def _take_being_cropped(self, folder, take_number):
        """Whether a crop of this take is under way (_start_crop)."""
        ref = self._lib.rehearsal_ref(folder)
        return ref is not None and self._being_cropped(
            [{"kind": "take", "rehearsal_id": ref["id"], "take_number": int(take_number)}])

    def _hold_takes(self, folder, numbers, kind):
        """
        Takes of one rehearsal into one holding entry, then their rows out:
        {"undo", "deleted", "failed", "takes_left", "ended"}. In this order: earlier
        entries of these takes end (_end_before), before anything of them is
        read, since an end can put files of them back; the player lets go of
        their files; the files move; and only then do the rows go, so a take
        whose files will not all move (Windows refuses a folder holding a
        file another program has open) keeps its rows and its files where
        they were, and is said in "failed". The others go all the same.
        """
        ref = self._lib.rehearsal_ref(folder)
        ended = []
        if ref is not None:
            ended = self._end_before([{"kind": "take", "rehearsal_id": ref["id"],
                                       "take_number": int(n)} for n in numbers])
        rehearsal = self._lib.rehearsal(folder) or {"takes": []}
        by_number = {t["take_number"]: t for t in rehearsal["takes"]}
        todo = [n for n in dict.fromkeys(int(n) for n in numbers) if n in by_number]
        failed = []
        while todo:
            others = [t for n, t in by_number.items() if n not in todo]
            paths_of = {n: self._held_paths(folder, by_number[n], others) for n in todo}
            paths = self._outermost([p for n in todo for p in paths_of[n]])
            for path in paths:
                self._release_player_in(path)
            records = [self._lib.take_record(folder, n) for n in todo]
            idents = [{"kind": "take", "rehearsal_id": r["rehearsal"]["id"],
                       "take_number": n} for n, r in zip(todo, records)]
            record = {
                "kind": kind,
                "reason": "delete",
                # Until the rows are dropped (_rows_dropped), an end puts the
                # files back rather than sending them to the Trash.
                "rows": "kept",
                "item": idents if kind == "takes" else idents[0],
                "rehearsal": records[0]["rehearsal"],
                "takes": records,
                "shared": _shared_of(by_number[n] for n in todo),
            }
            try:
                token = holding.hold(self._recordings_dir, record, paths)
            except (OSError, ValueError) as e:
                stuck = self._stuck_take(e, paths_of)
                if stuck is None or len(todo) == 1:
                    failed += [{"take_number": n, "error": f"Could not remove it: {e}"}
                               for n in todo]
                    break
                failed.append({"take_number": stuck, "error": f"Could not remove it: {e}"})
                todo.remove(stuck)
                continue
            try:
                left = self._lib.delete_takes(folder, todo)
            except Exception:
                # The rows are all still there: their files go back to them.
                kept = self._back_or_keep(token, paths)
                if not kept["ok"]:
                    self._kept(token, kept["error"])
                raise
            self._rows_dropped(token, record)
            return {"undo": token, "deleted": todo, "failed": failed, "takes_left": left,
                    "ended": ended}
        return {"undo": None, "deleted": [], "failed": failed, "takes_left": len(by_number),
                "ended": ended}

    def _held_paths(self, folder, take, others):
        """
        What of a take moves into the holding folder: each folder its files
        are in, found from its files rather than its name (the name could
        have been changed by hand, and a take of nothing but notes has no
        audio to find it by). A folder goes whole when it is inside the
        rehearsal's folder and holds nothing of `others`, the rehearsal's
        other takes; otherwise only the take's own files in it go, so a
        folder shared with another take, or the rehearsal's own folder, is
        never carried off with it. Only what is on disk.
        """
        files = [Path(f["file"]) for f in [*take["tracks"], *(take.get("notes") or [])]
                 if f.get("file")]
        theirs = [Path(f["file"]) for t in others
                  for f in [*t["tracks"], *(t.get("notes") or [])] if f.get("file")]
        paths = []
        for d in sorted({f.parent for f in files}):
            if not os.path.lexists(d):
                continue
            whole = (_is_inside(d, folder) and not _same_folder(d, folder)
                     and not any(_is_inside(f, d) for f in theirs))
            if whole:
                paths.append(d)
            else:
                paths += [f for f in files if f.parent == d and os.path.lexists(f)
                          and self._inside_recordings(f)]
        return paths

    @staticmethod
    def _outermost(paths):
        """Each path once, less any inside another: moving the outer one moves
        it already."""
        paths = list(dict.fromkeys(paths))
        return [p for p in paths if not any(q != p and _is_inside(p, q) for q in paths)]

    @staticmethod
    def _stuck_take(error, paths_of):
        """Which take's file or folder would not move, from the error the
        move raised; None when it does not say."""
        where = getattr(error, "filename", None)
        if not where:
            return None
        for n, paths in paths_of.items():
            if any(str(p) == str(where) for p in paths):
                return n
        return None

    def delete_rehearsal(self, folder):
        """
        Moves the whole folder into the holding folder and drops the
        rehearsal's rows, asking nothing: {"ok": True, "undo": token}. Undo
        brings back the folder and every row; when the notice ends, the folder
        goes to the Trash and its takes' copies leave the cloud folder.
        """
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        if not folder.exists():
            return {"ok": False, "error": "Rehearsal folder not found"}
        if self._session is not None and Path(self._session["folder"]) == folder:
            return {"ok": False, "error": "Cannot delete the rehearsal in progress"}
        with self._files_lock:
            ref = self._lib.rehearsal_ref(folder)
            item = {"kind": "rehearsal", "folder": self._recordings_key(folder),
                    "rehearsal_id": None if ref is None else ref["id"]}
            if self._being_cropped([item]):
                return {"ok": False, "error": CROPPING}
            self._release_player_in(folder)
            # Before its rows are read: an end can put a take of it back.
            ended = self._end_before([item])
            rows = self._lib.rehearsal_record(folder)
            takes = (self._lib.rehearsal(folder) or {}).get("takes", [])
            record = {
                "kind": "rehearsal",
                "reason": "delete",
                # A folder the library has no record of has no rows to drop.
                "rows": "kept" if rows is not None else "none",
                "item": item,
                "rehearsal": rows,
                "shared": _shared_of(takes),
            }
            try:
                token = holding.hold(self._recordings_dir, record, [folder])
            except (OSError, ValueError) as e:
                return {"ok": False, "error": f"Could not remove it: {e}", "ended": ended}
            if rows is not None:
                try:
                    self._lib.forget_rehearsal(folder)
                except Exception:
                    kept = self._back_or_keep(token, [folder])
                    if not kept["ok"]:
                        self._kept(token, kept["error"])
                    raise
                self._rows_dropped(token, record)
            return {"ok": True, "undo": token, "ended": ended}

    # ---------- removals waiting for their Undo ----------
    #
    # A take, a rehearsal or a draft removed waits in the holding folder
    # (holding.py) with a record of its rows, and its rows are dropped: every
    # screen stops showing it at once. The interface offers Undo (undo_trash)
    # and says when that notice has ended (end_trash), which sends the item
    # on to the Trash. Python ends entries of its own accord too: all of them
    # at quit, at start (after a crash) and before the recordings folder
    # changes; and before each new removal, any that has waited longer than
    # holding.STALE_SEC (the window was reloaded, say) and any of the same
    # item (_ends). Every end is the Trash, or back where it was.
    #
    # Which of the two is the record's "rows": "kept" from the moment the
    # files start to move until the library has dropped the rows, "dropped"
    # after, "none" for what has no rows (a draft), "restoring" while an Undo
    # puts it back. Only "dropped" and "none" go to the Trash. An entry whose
    # rows were never dropped (a crash between the move and the drop, a move
    # that failed and could not be taken back, a library that refused) goes
    # back where it came from, to the rows that are still there; one whose
    # Undo a crash broke off is finished (_finish_undo). The library is asked
    # too (_rows_there), for a crash between the drop and the record saying
    # so: rows that are gone are gone, whatever the record says.

    def _rows_dropped(self, token, record):
        """The entry's record says its rows are out of the library now, so
        its end is the Trash. Should that not be written, _rows_there finds
        them gone all the same."""
        try:
            holding.update(self._recordings_dir, token, {**record, "rows": "dropped"})
        except OSError as e:
            log.error("removal %s: could not record that its rows were dropped: %s", token, e)

    def _back_or_keep(self, token, places):
        """An entry's items back to `places`, then the entry gone: {"ok":
        True}. When they cannot all go back the entry stays, with whatever is
        still in it and its record, for the next end: {"ok": False,
        "error"}."""
        try:
            holding.put_back(self._recordings_dir, token, places)
        except holding.Gone:
            return {"ok": True}
        except (OSError, ValueError) as e:
            return {"ok": False, "error": f"Could not put it back: {e}"}
        self._put_back(token)
        holding.drop(self._recordings_dir, token)
        return {"ok": True}

    def _put_back(self, token):
        """What a removal took is back where it was, by its Undo or by an
        end: its Undo, asked again, says so (_too_late)."""
        self._back.add(token)

    def _too_late(self, token):
        """What an Undo answers when its entry is not waiting any more:
        {"ok": False, "back": True, "error": BACK} when an Undo or an end
        put what went back where it was (_put_back), and otherwise {"ok":
        False, "gone": True, "error"}, that it has gone on to the Trash, in
        the system's words (holding.gone_text). The interface words each
        itself, from "back" or "gone"."""
        # A token comes from the interface, and may be anything at all.
        if isinstance(token, str) and token in self._back:
            return {"ok": False, "back": True, "error": BACK}
        return {"ok": False, "gone": True, "error": holding.gone_text()}

    def _kept(self, token, error):
        """Says, in the log a windowed build keeps, that an entry stays in the
        holding folder for the next end, and why; returns its folder. Only
        an entry still there: one an end failed on after all may be gone (an
        Undo finished whose rows would not come back, said in its own log
        line), and that one returns None, unsaid."""
        where = self._recordings_dir / holding.HOLDING_DIR / token
        if not where.exists():
            return None
        log.error("removal %s stays in %s for the next end: %s", token, where, error)
        return where

    def _end_before(self, idents, stale=True, reasons=None, exclude=(), broken=False):
        """Ends every waiting entry of the same item as any of `idents`
        (_ends), only those made for one of `reasons` when given, only those
        whose Undo was broken off with `broken` (_broken_off), and with
        `stale` every entry older than STALE_SEC; never one in `exclude`.
        One that cannot end stays for the next end; the removal goes on.
        Returns the tokens it ended, for the caller's answer ("ended"): the
        interface lets their notices go, whose Undo would only say so."""
        now = time.time()
        ended = []
        for token in holding.tokens(self._recordings_dir):
            if token in exclude:
                continue
            data = holding.read(self._recordings_dir, token)
            record = (data or {}).get("record")
            try:
                age = now - float((data or {}).get("time"))
            except (TypeError, ValueError):
                # No record to undo it with: nothing is waiting for it.
                age = holding.STALE_SEC + 1
            same = any(_ends(new, was) for new in idents for was in _identities(record))
            if reasons is not None:
                same = same and isinstance(record, dict) and record.get("reason") in reasons
            if broken:
                same = same and _broken_off(record)
            if (stale and age > holding.STALE_SEC) or same:
                try:
                    result = self._end(token)
                except Exception as e:  # noqa: BLE001 - it waits for the next end
                    result = {"ok": False, "error": str(e)}
                if result.get("ok"):
                    ended.append(token)
                else:
                    self._kept(token, result.get("error"))
        return ended

    def _end(self, token):
        """
        One entry's end: on to the Trash, and then the cloud copies its
        record names out of the cloud folder; or back where it came from,
        when its rows were never dropped (see above). {"ok": True}, also for
        an entry that is not there; {"ok": False, "error"} leaves it, copies
        and all, for the next end: so does a record that cannot be read,
        since whether its rows were dropped cannot be told. Raises
        LibraryUnavailable, the entry left, when what to do needs the library
        and it is not open.
        """
        data = holding.read(self._recordings_dir, token)
        if data is None:
            # Not there, or nothing in it but a record that cannot be read:
            # gone. Anything of the person's in it stays, record and all.
            if holding.drop(self._recordings_dir, token):
                return {"ok": True}
            return {"ok": False, "error": holding.UNREADABLE}
        record = data.get("record")
        record = record if isinstance(record, dict) else {}
        rows = record.get("rows")
        if rows == "restoring":
            if record.get("kind") == "crop":
                return self._end_uncrop(token, data)
            return self._finish_undo(token, data)
        if rows not in ("dropped", "none") and self._rows_there(record) is not False:
            return self._back_or_keep(token, self._places(record, data.get("items") or []))
        if record.get("kind") == "crop" and record.get("undone"):
            # A crop undone, whose end did not get as far as the Trash: the
            # folder the uncut files waited in is empty, and is not sent on
            # in their name; and the cloud step, if it was not done (_uncrop).
            inside = holding.held(self._recordings_dir, token, 0)
            if inside is not None:
                holding.drop_empty(self._recordings_dir, token, inside)
            if isinstance(record.get("cloud"), dict):
                self._uncrop_cloud(token, record)
        shared = [c for c in record.get("shared") or [] if isinstance(c, dict)]
        if shared:
            # Which copies stay is the library's to say: with none open, the
            # entry waits, copies and all.
            self._lib.cloud_paths()
        result = holding.send_on(self._recordings_dir, token, move_to_trash)
        if not result.get("ok"):
            return result
        if shared:
            # Asked again now, not before the files went: the copy worker
            # runs outside _files_lock, and a copy it finished meanwhile may
            # be in that very place.
            live = self._lib.cloud_paths()
            for copy in shared:
                # A take that came after it under the same name
                # (recover_draft gives the next number, and "Take 7" is "Take
                # 7" again) has its own copy in that place now: that one stays.
                self._remove_shared(self._unused(copy, live))
        return {"ok": True}

    def _unused(self, copy, live):
        """Of a take's copies (`copy`: {"mix", "tracks"}, absolute), those no
        take in the library names (`live`, Library.cloud_paths), as
        _remove_shared takes them."""
        copy = copy or {}
        return {"cloud": {k: copy[k] for k in ("mix", "tracks")
                          if copy.get(k) and not self._cloud_in_use(copy[k], live)}}

    def _cloud_in_use(self, path, live):
        """Whether a take in the library names `path` as its copy, or a path
        inside it or around it: `live` is every copy they name, relative to
        the cloud folder (Library.cloud_paths), compared as the library
        compares them (paths_overlap, blind to case). A path outside the
        cloud folder counts as in use: nothing outside it is touched."""
        cloud = self._cloud_dir
        if cloud is None:
            return True
        try:
            rel = Path(path).resolve().relative_to(Path(cloud).resolve())
        except ValueError:
            return True
        return any(paths_overlap(rel, p) for p in live)

    def _rows_there(self, record):
        """Whether the rows a removal's record names are in the library: True
        when all of them are, False when none is, None when it cannot say (a
        record with no rows, or only some of them there)."""
        kind = record.get("kind")
        if kind in ("take", "takes"):
            found = [self._lib.take_there(t) for t in record.get("takes") or []]
        elif kind == "rehearsal" and record.get("rehearsal") is not None:
            found = [self._lib.rehearsal_there(record["rehearsal"])]
        else:
            return None
        if not found:
            return None
        if all(found):
            return True
        return False if not any(found) else None

    def _places(self, record, items):
        """Where each item of an entry goes back to: into its rehearsal's
        folder as it is now, renamed meanwhile or not, and otherwise (a
        rehearsal's own folder, a draft of none) where it came from."""
        ref = record.get("rehearsal") if record.get("kind") != "rehearsal" else None
        folder = self._lib.rehearsal_folder(ref) if ref else None
        if folder is None:
            return [self._recordings_dir / Path(*PurePosixPath(i["from"]).parts) for i in items]
        was = PurePosixPath(ref["folder"])
        return [self._back_in(folder, was, i) for i in items]

    def _end_all(self, at_start=False, ended=None):
        """
        Every entry waiting goes on to the Trash, or back: at quit, at start,
        and before the recordings folder changes. One that fails stays for
        the next end, and the others still go. Returns those that stay, each
        {"folder", "error", "library"}: "library" true when it stayed only
        because the library is not open.

        At start they are said to the person too, as nothing else would ever
        show them: all in one start problem, put first. (First because the
        interface once showed only the last problem said, and the others,
        the library not opening, a history that cannot be read, must not be
        buried by it; it lists them all now, and the order is harmless.)
        Not one that stayed only for want of the library: that is said
        already, by LibraryUnavailable, and goes when the library is back.
        The tokens of those that ended go into `ended`, when given.
        """
        kept = []
        for token in holding.tokens(self._recordings_dir):
            library = False
            try:
                result = self._end(token)
            except LibraryUnavailable as e:
                result, library = {"ok": False, "error": str(e)}, True
            except Exception as e:  # noqa: BLE001 - starting and quitting go on
                result = {"ok": False, "error": str(e)}
            if result.get("ok"):
                if ended is not None:
                    ended.append(token)
                continue
            where = self._kept(token, result.get("error"))
            if where is not None:
                kept.append({"folder": str(where), "error": result.get("error"),
                             "library": library})
        said = [k for k in kept if not k["library"]]
        if at_start and said:
            self._problems.insert(0, {"name": "RemovalKept", "message": _removals_kept(said)})
        return kept

    def end_trash(self, token):
        """
        The Undo's notice has ended: the item goes on to the Trash, or the
        _deleted folder where there is none, and its copies leave the cloud
        folder. {"ok": True}, also when it is no longer waiting (another end
        sent it on, or Undo brought it back); {"ok": False, "error"} when the
        Trash refused, the entry then left for the next start.
        """
        with self._files_lock:
            try:
                result = self._end(token)
            except Exception as e:  # noqa: BLE001 - every failure is answered
                log.error("removal %s could not end now: %s", token, e)
                result = {"ok": False, "error": str(e)}
            if not result.get("ok"):
                self._kept(token, result.get("error"))
            return result

    @serialised
    @_follows
    def undo_trash(self, token):
        """
        Undo: the item back where it came from, and its rows back in the
        library. {"ok": True, "kind"} with what came back: "take" or "takes"
        with "folder" and "take_numbers", "rehearsal" with "folder", "draft"
        with "temp_dir" and "folder", "crop" (the take as it was before its
        crop, _uncrop) with "folder" and "take_numbers" or, for a draft,
        "temp_dir". {"ok": False, "error"} when it cannot come back:
        something else is in its place, its number is taken, or its
        rehearsal is gone; with "gone" when it has gone on to the Trash
        already, or "back" when it is back where it was (_too_late), which
        the interface words itself. Those are asked before
        anything moves, and the entry is left as it was. Should the library
        still refuse once the files are back, the files stay back, as they
        are the person's, and the entry is gone. A crop's Undo that fails on
        the way is taken back, the entry waiting as it was; one that cannot
        be taken back either answers {"ok": False, "error": FINISHING,
        "finishing": True}: the next end finishes it.
        """
        with self._files_lock:
            data = holding.read(self._recordings_dir, token)
            if data is None:
                return self._too_late(token)
            record = data.get("record") or {}
            kind = record.get("kind")
            if kind == "crop":
                try:
                    return self._uncrop(token, data)
                except holding.Gone:
                    return self._too_late(token)
                except holding.Stuck as e:
                    # Part of it moved and would not all go back: the record
                    # says an Undo is under way, and the next end finishes it.
                    self._kept(token, str(e))
                    return {"ok": False, "error": FINISHING, "finishing": True}
                except Exception as e:  # noqa: BLE001 - every failure is answered
                    log.error("removal %s: its crop could not be undone: %s", token, e)
                    return {"ok": False, "error": f"Could not put it back: {e}"}
            if kind not in ("take", "takes", "rehearsal", "draft"):
                return {"ok": False, "error": f"Cannot undo a removal of {kind!r}"}
            items = data.get("items") or []
            try:
                refused = self._undo_refused(record, items)
                if refused is not None:
                    return {"ok": False, "error": refused}
                places = self._places(record, items)
                holding.check_places(self._recordings_dir, token, places)
                return self._finish_undo(token, data, places)
            except holding.Gone:
                return self._too_late(token)
            except FileExistsError as e:
                return {"ok": False, "error": str(e)}
            except (OSError, ValueError) as e:
                return {"ok": False, "error": f"Could not put it back: {e}"}

    def _undo_refused(self, record, items):
        """Why an Undo cannot be done, asked before anything moves, or None.
        Raises holding.Gone when nothing of it is waiting."""
        kind = record.get("kind")
        if kind in ("take", "takes"):
            # Only files need the folder: a take whose files were not on disk
            # (its drive unplugged) held none, and its rows come back all the same.
            folder, why = self._rehearsal_now(record.get("rehearsal"), on_disk=bool(items))
            if why is not None:
                return why
            for take in record.get("takes") or []:
                n = int(take["take"]["take_number"])
                if self._lib.take(folder, n) is not None:
                    return f"Take {n} is taken by another take now."
            return None
        if not items:
            raise holding.Gone()  # nothing of it is waiting: it has gone on
        if kind == "rehearsal":
            place = self._recordings_dir / Path(*PurePosixPath(items[0]["from"]).parts)
            if record.get("rehearsal") is not None and self._lib.has(place):
                return f"Something else is in its place now: {place}"
            return None
        return self._draft_home_now(record, items)[1]

    def _rehearsal_now(self, ref, on_disk=True):
        """(folder, None): the rehearsal a record names (`ref`), where it is
        now; or (None, why) it cannot be gone back into: it is gone, or with
        `on_disk`, its folder is not on disk."""
        folder = self._lib.rehearsal_folder(ref or {})
        if folder is None:
            return None, REHEARSAL_GONE
        if on_disk and not folder.is_dir():
            return None, "The rehearsal's folder is not on disk"
        return folder, None

    def _draft_home_now(self, record, items):
        """(folder, None): the rehearsal folder a draft goes back into, as it
        is now (_draft_home); or (None, why) when it is gone."""
        home = self._draft_home(record, items)
        if home is None or not home.is_dir():
            return None, REHEARSAL_GONE
        return home, None

    def _draft_home(self, record, items):
        """The rehearsal folder a draft goes back into, as it is now; None
        when the rehearsal it was a draft of is gone."""
        ref = record.get("rehearsal")
        if ref is not None:
            return self._lib.rehearsal_folder(ref)
        place = self._recordings_dir / Path(*PurePosixPath(items[0]["from"]).parts)
        return place.parent.parent if place.parent.name == DRAFTS_DIR else place.parent

    def _finish_undo(self, token, data, places=None):
        """
        An Undo, once nothing refuses it: the record says so ("restoring",
        with where each item goes), the items go back, the rows go back, and
        only then is the entry dropped, so a crash at any point leaves a
        record of an Undo under way. Without `places` it is one a crash broke
        off, finished by _end: what is still in the entry goes back where the
        record says, and the rows go back unless they are back already.

        Raises what put_back raises (the record as it was, unless part of it
        is back already: then the next end finishes it). Answers as
        undo_trash does.
        """
        rec = self._recordings_dir
        record = dict(data.get("record") or {})
        items = data.get("items") or []
        resuming = places is None
        if resuming:
            # Where they go now: the rehearsal may have been renamed since.
            places = self._places(record, items)
        else:
            holding.update(rec, token, {**record, "rows": "restoring"})
        try:
            holding.put_back(rec, token, places)
        except holding.Stuck:
            raise  # some of it is back: the next end finishes the Undo
        except OSError:
            if not resuming:
                holding.update(rec, token, record)  # all of it still in the entry
            raise
        self._put_back(token)
        kind = record.get("kind")
        error = None
        restore = not resuming or self._rows_there(record) is False
        try:
            if kind in ("take", "takes") and restore:
                self._lib.restore_takes(record.get("takes") or [])
            elif kind == "rehearsal" and record.get("rehearsal") is not None and restore:
                self._lib.restore_rehearsal(record["rehearsal"])
        except ValueError as e:
            error = str(e)  # the files stay back: they are the person's
        holding.drop(rec, token)
        if error is not None:
            if resuming:
                log.error("removal %s: its files are back, its rows could not be: %s",
                          token, error)
            return {"ok": False, "error": error}
        if kind in ("take", "takes"):
            folder = self._lib.rehearsal_folder(record.get("rehearsal") or {})
            numbers = [int(t["take"]["take_number"]) for t in record.get("takes") or []]
            self._published_again(folder, numbers)
            return {"ok": True, "kind": kind, "folder": str(folder), "take_numbers": numbers}
        if kind == "rehearsal":
            place = places[0] if places else rec / Path(*PurePosixPath(items[0]["from"]).parts)
            numbers = [int(t["take"]["take_number"])
                       for t in (record.get("rehearsal") or {}).get("takes") or []]
            self._published_again(place, numbers)
            return {"ok": True, "kind": "rehearsal", "folder": str(place)}
        place = places[0]
        home = self._draft_home(record, items)
        return {"ok": True, "kind": "draft", "temp_dir": str(place),
                "folder": str(home if home is not None else place.parent.parent)}

    def _published_again(self, folder, numbers):
        """Takes back from an Undo: a copy asked for while they were gone
        discarded itself, so it is asked again; and a song renamed meanwhile
        has its takes' folders follow its name."""
        if folder is None:
            return
        for n in numbers:
            self._enqueue_publish(folder, n)
        self._names_pass.request()

    def _back_in(self, folder, was, item):
        """Where an item that came from a rehearsal then at `was` (relative to
        the recordings folder) goes back to, the rehearsal being at `folder`
        now."""
        source = PurePosixPath(item["from"])
        try:
            return folder / Path(*source.relative_to(was).parts)
        except ValueError:
            return self._recordings_dir / Path(*source.parts)

    # ---------- a crop undone ----------
    #
    # A crop's entry (crop_take, crop_draft) holds the take as it was before
    # it, in one folder, and its Undo is an exchange, done so that the take
    # has one whole version in its places at every step. First it is asked
    # whether each uncut file's place will be free once the cropped file is
    # out of it, nothing moving. Then the record says an Undo is under way
    # ("restoring"), with what the cloud step will be; each cropped file
    # moves into a second folder of the entry and the uncut one takes its
    # place (holding.swap); the take's marks and length go back, and its
    # cloud copy is forgotten, in one transaction; the record says it is done
    # ("undone"), with the cloud step still to do; the cloud step is done
    # (_uncrop_cloud); and only then do the cropped files go on to the Trash.
    # While the take is being cropped again, its Undo waits (_start_crop).
    #
    # In the person's Undo (undo_trash), a failure on the way, of whatever
    # kind, takes it all back to the cropped take, and the entry waits as it
    # was; one that cannot be taken back either is answered FINISHING. A
    # crash on the way leaves the record saying "restoring", and the next end
    # finishes it (_end_uncrop): which file is where says how far it got, and
    # the marks are put back only once (the record's "expect"); or "undone",
    # and the next end does what is left (_end). An end never takes the
    # person's Undo back: one that fails on the way (the library, a file
    # Windows holds) leaves it "restoring", both versions of the take on
    # disk, for the next end. Only a place something else has taken since
    # makes an end put the cropped take back, and end the crop as its own.

    def _uncrop(self, token, data, at_end=False):
        """
        Undo of a crop, or one a crash or a failure broke off, done again
        (its record says "restoring"). {"ok": True, "kind": "crop", "folder",
        "take_numbers"}, or "temp_dir" for a draft's crop. {"ok": False,
        "error"}, whatever went wrong, with the cropped take in its places
        and the entry waiting as it was; or, when a broken-off one cannot
        even be placed (its rehearsal gone, its drive not there) or the take
        is being cropped again (CROPPING), with everything as it is. Raises
        holding.Stuck when a failure could not be taken back either: the
        record then says "restoring", for the next end (undo_trash answers
        FINISHING).

        `at_end` (_end_uncrop): nothing is taken back on a failure in the
        exchange or in the library; it is raised, whatever moved staying
        where it is and the record saying "restoring", for the next end.
        Only a place taken since is taken back, as for the person's Undo.
        """
        rec = self._recordings_dir
        record = dict(data.get("record") or {})
        if record.get("undone"):
            # Done already: the take is back as it was, and only the
            # cropped files wait in the entry.
            self._put_back(token)
            return self._too_late(token)
        if self._being_cropped(_identities(record)):
            # Its places are empty for a moment while the crop moves files.
            return {"ok": False, "error": CROPPING}
        resuming = record.get("rows") == "restoring"
        inside = holding.held(rec, token, 0)
        if inside is None or (not resuming and not inside.is_dir()):
            return self._too_late(token)
        where = self._uncut_places(record, data.get("items") or [])
        if "error" in where:
            return {"ok": False, "error": where["error"]}
        if resuming:
            swaps = record.get("swap") or []
        else:
            known = {f.get("name"): f for f in record.get("files") or []}
            swaps = [{"name": p.name, "cropped": bool((known.get(p.name) or {}).get("cropped"))}
                     for p in sorted(inside.iterdir())]
        pairs = [(s["name"], where["place"](s["name"]), bool(s["cropped"])) for s in swaps]
        # The record as it is while nothing is under way: the crop's own.
        waiting = {k: v for k, v in record.items()
                   if k not in ("swap", "expect", "copy", "aside", "send")}
        waiting["rows"] = "none"
        aside = (holding.held(rec, token, record["aside"])
                 if resuming and isinstance(record.get("aside"), int) else None)

        def taken_back():
            """The cropped take whole in its places again, the second folder
            gone and the record as it was before the Undo. Raises Stuck when
            that cannot be done, the record still saying "restoring"."""
            if aside is not None:
                inside.mkdir(parents=True, exist_ok=True)
                holding.unswap(rec, token, inside, aside, pairs)
                holding.drop_empty(rec, token, aside)
            try:
                holding.update(rec, token, waiting)
            except OSError as e:
                raise holding.Stuck(
                    f"the cropped take is back in its places, but its record could not say so: {e}"
                ) from e

        try:
            holding.check_swap(rec, token, inside,
                               aside or holding.would_add(rec, token, where["cropped"]), pairs)
        except holding.Gone:
            raise
        except (OSError, ValueError) as e:
            if resuming:
                taken_back()
            return {"ok": False, "error": _put_back_error(e)}

        # Windows will not move a file the player has mapped: the cropped
        # take may well be the one open.
        playing = self._open_tracks
        for d in sorted({Path(place).parent for _, place, _ in pairs}):
            self._release_player_in(d)

        def reopened():
            if playing and self._open_tracks is None:
                self._player_open(playing)

        def failed(error):
            """A failure once files may have moved: the cropped take back in
            its places, the player as it was, and the answer."""
            try:
                taken_back()
            finally:
                reopened()
            return {"ok": False, "error": error}

        take = where.get("take")
        if not resuming:
            record = {**waiting, "rows": "restoring", "swap": swaps,
                      "aside": int(holding.would_add(rec, token, where["cropped"]).parent.name)}
            if take is not None:
                # What the marks come back as, written before the library is
                # asked: an Undo finished after a crash finds them there
                # already, and does not shift them twice. And the cloud step,
                # decided now, while what is on its way to the cloud folder
                # can still be told.
                record["expect"] = _uncut_marks(record, take["markers"])
                record["copy"] = {k: take["cloud"][k] for k in ("mix", "tracks")
                                  if (take.get("cloud") or {}).get(k)}
                record["send"] = self._uncrop_send(record, where["folder"], take)
            try:
                holding.update(rec, token, record)
            except Exception as e:  # noqa: BLE001 - nothing has moved: answered
                reopened()
                log.error("removal %s: its crop could not be undone: %s", token, e)
                return {"ok": False, "error": _put_back_error(e)}
        try:
            if aside is None:
                aside = holding.add(rec, token, where["cropped"])
            else:
                # Recorded, but the app may have died before it was made.
                aside.mkdir(parents=True, exist_ok=True)
            holding.swap(rec, token, inside, aside, pairs, take_back=not at_end)
        except holding.Stuck:
            reopened()
            raise
        except OSError as e:
            if at_end:
                # An end never takes the person's Undo back: whatever moved
                # stays moved, the record says "restoring", and the next end
                # goes on from there.
                reopened()
                log.error("removal %s: its crop's Undo could not be finished now, and stays "
                          "under way for the next end: %s", token, e)
                raise
            # Nothing of it moved, or swap took back what had.
            return failed(_put_back_error(e))

        cleared = {}
        if take is not None:
            folder, n = where["folder"], int(record["item"]["take_number"])
            expect = record.get("expect") or []

            def marks(current):
                if _same_marks(current, expect):
                    return current  # back already: an Undo finished again
                return _uncut_marks(record, current)

            try:
                cleared = self._lib.uncrop_take(
                    record.get("rehearsal"), record.get("take_id"), n, marks,
                    float(record.get("duration_sec") or 0.0))["cloud"] or {}
            except Exception as e:
                # Every failure: answered, or at an end left under way.
                if at_end:
                    # As above: the uncut files stay in their places, the
                    # cropped ones in the entry, until the next end.
                    reopened()
                    log.error("removal %s: the take's marks and length would not come back "
                              "now; its crop's Undo stays under way for the next end: %s",
                              token, e)
                    raise
                log.error("removal %s: the take's marks and length would not come back, "
                          "so the cropped take is put back: %s", token, e)
                return failed(f"Could not put it back: {e}")

        # Done: the record says so, with the cloud step still to do, so that
        # an end finds it there should the app die before it is done.
        self._put_back(token)
        done = {**waiting, "undone": True}
        if take is not None:
            send = record.get("send") or {}
            done["cloud"] = {"remove": [c for c in (record.get("copy"), cleared) if c],
                             "send": send.get("what"), "publish": bool(send.get("publish"))}
        try:
            holding.update(rec, token, done)
        except Exception as e:  # noqa: BLE001 - the Undo is done all the same
            # Still "restoring": the next end finishes it again, and finds
            # every file and every mark where this left them.
            log.error("removal %s: could not record that its crop was undone: %s", token, e)
        try:
            holding.drop_empty(rec, token, inside)
            if take is not None:
                self._uncrop_cloud(token, done)
            sent = holding.send_on(rec, token, move_to_trash)
            if not sent.get("ok"):
                # The take is back as it was; the cropped files wait for the
                # next end.
                self._kept(token, sent.get("error"))
        except Exception as e:  # noqa: BLE001 - the Undo is done; the rest waits
            self._kept(token, str(e))
        if take is not None:
            return {"ok": True, "kind": "crop", "folder": str(folder), "take_numbers": [n]}
        return {"ok": True, "kind": "crop", "temp_dir": str(where["temp_dir"])}

    def _uncrop_send(self, record, folder, take):
        """
        How the take as it was goes back to the cloud folder once its crop
        is undone: {"what": the shape to send it in, or None; "publish":
        whether sending on its own is asked instead}. As it was at the crop
        ("had"), unless the person changed that since: a take sent there
        since keeps the shape it has now, and one taken out of there since is
        not sent again. A copy still on its way, or one that failed, is no
        change.
        """
        had = record.get("had")
        now = _shape_of(take.get("cloud"))
        if now is not None:
            return {"what": now, "publish": False}
        coming = int(take["take_number"]) in self._cloud_queue.states(str(folder))
        if coming or take.get("cloud_error") or had is None:
            return {"what": had, "publish": had is None}
        return {"what": None, "publish": False}

    def _uncrop_cloud(self, token, record):
        """
        The cloud step of a crop's Undo, from what its "undone" record
        carries ("cloud"): the cropped take's copies out of the cloud
        folder, but one another take names; and the take as it was sent there
        again (_uncrop_send). Then the record no longer carries it, so it is
        done once. Raises what the library raises, the entry then waiting for
        the next end, step and all.

        Done again after a crash, or after the record could not be written,
        the removal can meet the copy worker's known race (as _end's does):
        a copy of the uncut take written but not yet recorded is not "in
        use", and can go. The same step queues the take again, so that copy
        is made once more.
        """
        step = record.get("cloud") or {}
        live = self._lib.cloud_paths()
        for copy in step.get("remove") or []:
            if isinstance(copy, dict):
                self._remove_shared(self._unused(copy, live))
        folder = self._lib.rehearsal_folder(record.get("rehearsal") or {})
        n = (record.get("item") or {}).get("take_number")
        rows = self._lib.take_record(folder, int(n)) if folder is not None and n is not None else None
        if rows is not None and rows["take"].get("id") == record.get("take_id"):
            if step.get("send"):
                self._queue_copy(folder, int(n), step["send"])
            elif step.get("publish"):
                self._enqueue_publish(folder, int(n))
        try:
            holding.update(self._recordings_dir, token,
                           {k: v for k, v in record.items() if k != "cloud"})
        except OSError as e:
            log.error("removal %s: could not record that its cloud step is done: %s", token, e)

    def _uncut_places(self, record, items):
        """
        Where each file of a crop's entry goes back to, as things are now:
        {"place": name -> path, "cropped": where the cropped files' folder
        is said to come from, beside the take's, and "take", "folder" for a
        saved take or "temp_dir" for a draft}; or {"error"} when it cannot be
        told. A saved take's files keep their names through a rename of the
        take or of its rehearsal, and only their folder moves: each folder the
        crop took files from is found by the take's files that were in it.
        """
        rec = self._recordings_dir
        item = record.get("item") or {}
        ref = record.get("rehearsal")
        files = {f["name"]: f for f in record.get("files") or [] if f.get("name")}
        home = PurePosixPath(record.get("home") or "")

        def source(name):
            return PurePosixPath((files.get(name) or {}).get("from") or (home / name))

        if item.get("kind") == "take":
            folder, why = self._rehearsal_now(ref)
            if why is not None:
                return {"error": why}
            n = int(item["take_number"])
            rows = self._lib.take_record(folder, n)
            if rows is None or rows["take"].get("id") != record.get("take_id"):
                return {"error": TAKE_GONE}
            take = self._lib.take(folder, n)
            now = {}
            for f in [*take["tracks"], *(take.get("notes") or [])]:
                now.setdefault(Path(f["file"]).name, []).append(Path(f["file"]))
            moved_to = {}
            for name, f in files.items():
                if f.get("cropped") and len(now.get(name, [])) == 1:
                    moved_to[source(name).parent] = now[name][0].parent
            was = PurePosixPath(ref["folder"])

            def place(name):
                there = moved_to.get(source(name).parent)
                return (there / name if there is not None
                        else self._back_in(folder, was, {"from": source(name).as_posix()}))

            take_dir = moved_to.get(home) or self._back_in(folder, was, {"from": home.as_posix()})
            return {"place": place, "take": take, "folder": folder,
                    "cropped": take_dir.with_name(f"{take_dir.name} (cropped)")}

        rehearsal, why = self._draft_home_now(record, items)
        if why is not None:
            return {"error": why}

        def back(path):
            if ref is None:
                return rec / Path(*path.parts)
            return self._back_in(rehearsal, PurePosixPath(ref["folder"]), {"from": path.as_posix()})

        temp_dir = back(home)
        if not temp_dir.is_dir():
            return {"error": "It is not there any more"}
        return {"place": lambda name: back(source(name)), "take": None, "temp_dir": temp_dir,
                "cropped": temp_dir.with_name(f"{temp_dir.name} (cropped)")}

    def _end_uncrop(self, token, data):
        """
        The end of a crop's entry whose Undo was broken off, by a crash or by
        a failure that could not be taken back: the Undo is finished, since
        it was asked for (_uncrop with `at_end`). A failure on the way (the
        library, a file that will not move) is not taken back: {"ok": False,
        "error"}, the entry kept "restoring", both versions of the take on
        disk, for the next end. Only when something else has taken one of its
        places since is the cropped take put back whole, and the end is the
        crop's own: the uncut take goes on to the Trash. {"ok": True}
        otherwise. Raises LibraryUnavailable, the entry left as it is, when
        the library is not open.
        """
        try:
            done = self._uncrop(token, data, at_end=True)
        except holding.Gone:
            return {"ok": True}
        except LibraryUnavailable:
            raise
        except Exception as e:  # noqa: BLE001 - it waits for the next end
            return {"ok": False, "error": str(e)}
        if done.get("ok"):
            return {"ok": True}
        after = holding.read(self._recordings_dir, token)
        if after is not None and (after.get("record") or {}).get("rows") == "none":
            return self._end(token)
        return {"ok": False, "error": done.get("error")}

    # ---------- a rehearsal whose folder went missing ----------

    def forget_rehearsal(self, folder):
        """Takes a rehearsal out of History. Only the record: whatever is on
        disk is not touched — this is for a folder that is gone."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        if self._session is not None and Path(self._session["folder"]) == folder:
            return {"ok": False, "error": "Cannot remove the rehearsal in progress"}
        if not self._lib.forget_rehearsal(folder):
            return {"ok": False, "error": "Rehearsal not found"}
        return {"ok": True}

    def locate_rehearsal(self, folder, new_folder):
        """
        Points a rehearsal whose folder went missing at where it is now.

        Only a rehearsal that really is missing, and only onto a folder that
        belongs to no other: once pointed at a folder, the app treats it as
        its own — an empty rehearsal's folder is removed by the cleanup, and
        two rehearsals sharing files would each delete the other's takes.
        """
        folder = Path(folder)
        new_folder = Path(new_folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        live = Path(self._session["folder"]) if self._session is not None else None
        if live is not None and folder == live:
            return {"ok": False, "error": "Cannot relocate the rehearsal in progress"}
        if (not self._inside_recordings(new_folder)
                or new_folder.resolve() == self._recordings_dir.resolve()):
            return {"ok": False, "error": "Pick a folder inside the recordings folder"}
        if not new_folder.is_dir():
            return {"ok": False, "error": "That is not a folder"}

        # Where deleted things go is not a rehearsal's to have either: the
        # next thing sent there would land inside it, and the next cleanup
        # would carry the rehearsal's own files away with it. Nor where they
        # wait for their Undo: that goes to the Trash with its entry.
        target = new_folder.resolve()
        for kept in (FALLBACK_TRASH, holding.HOLDING_DIR):
            place = (self._recordings_dir / kept).resolve()
            if _same_folder(target, place) or _folder_within(target, place):
                return {"ok": False, "error": "That folder is where deleted things go"}

        rehearsals = self._lib.rehearsals()
        me = next((r for r in rehearsals if Path(r["folder"]) == folder), None)
        if me is None:
            return {"ok": False, "error": "Rehearsal not found"}
        if not me["missing"]:
            return {"ok": False, "error": "That rehearsal's folder is not missing"}

        part = {"ok": False, "error": "That folder is part of another rehearsal"}
        if live is not None and _same_folder(target, live.resolve()):
            return part
        if self._lib.has(new_folder):
            return {"ok": False, "error": "That folder is already another rehearsal"}
        others = [Path(r["folder"]).resolve() for r in rehearsals if r is not me]
        if live is not None:
            others.append(live.resolve())
        # The folder itself, anything above it, and anything under it: a
        # rehearsal sharing files with another would have each of them
        # delete the other's takes. Compared through the filesystem rather
        # than by name, so a folder renamed to a different case alone —
        # "Other" to "other", which a Mac and Windows both treat as the same
        # folder — is still recognised as the one the database has.
        if any(_same_folder(o, target) or _folder_within(target, o)
               or _folder_within(o, target) for o in others):
            return part

        if not self._lib.move_rehearsal(folder, new_folder):
            return {"ok": False, "error": "Rehearsal not found"}
        return {"ok": True, "folder": str(new_folder)}

    def choose_rehearsal_folder(self, folder):
        """The folder dialog for locate_rehearsal, opened in the recordings
        folder."""
        if self._window is None:
            return {"ok": False, "error": "No window available"}
        try:
            import webview

            picked = self._window.create_file_dialog(
                webview.FOLDER_DIALOG, directory=str(self._recordings_dir)
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}
        if not picked:
            return {"ok": False, "cancelled": True}
        return self.locate_rehearsal(folder, picked[0])

    # ---------- sharing to the cloud ----------
    #
    # Everything in the recordings folder syncs, or nothing does — that is how
    # Drive and Dropbox work, and a rehearsal is mostly attempts nobody needs.
    # So the cloud folder is a separate place, and takes are put there by hand,
    # after listening, when it is clear which ones are worth it.

    @property
    def _cloud_dir(self):
        path = self._config.get("cloud_dir")
        return Path(path) if path else None

    def _cloud_target(self, folder):
        """Which subfolder of the cloud folder one rehearsal's copies go to,
        or None while there is no cloud folder to put them in. The name, not
        the whole path: that is what a copy's record keeps, so pointing the
        setting at the same folder moved elsewhere does not make every take
        look stale."""
        if self._cloud_dir is None:
            return None
        return _safe_name(Path(folder).name)

    def set_cloud_dir(self, path):
        folder = Path(path).expanduser()
        if not folder.is_absolute():
            return {"ok": False, "error": "A full path is required"}
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return {"ok": False, "error": f"Could not open the folder: {e}"}
        self._config["cloud_dir"] = str(folder)
        self._write_config()
        # Nothing of this rehearsal has ever been copied into a folder chosen
        # a moment ago, whatever the takes still say about the old one.
        self._enqueue_session_takes()
        # Here, not on a thread of its own: a folder was picked a moment ago
        # and the reply waits for it anyway, and a sweep still running when
        # the first copy lands in the folder must not take it back out.
        self._sweep_empty_cloud_dirs()
        return {"ok": True, "cloud_dir": str(folder)}

    def choose_cloud_dir(self):
        if self._window is None:
            return {"ok": False, "error": "No window available"}
        try:
            import webview

            start = self._cloud_dir or Path.home()
            picked = self._window.create_file_dialog(
                webview.FOLDER_DIALOG, directory=str(start)
            )
        except Exception as e:
            return {"ok": False, "error": str(e)}
        if not picked:
            return {"ok": False, "cancelled": True}
        return self.set_cloud_dir(picked[0])

    def set_cloud_format(self, fmt):
        """What the cloud copies are written as — see audio/encode.py."""
        chosen = normalize_format(fmt)
        self._config["cloud_format"] = chosen
        self._write_config()
        # Every copy was written in the old format, which is the whole of what
        # this setting is about.
        self._enqueue_session_takes()
        return {"ok": True, "cloud_format": chosen, "encoder": encoder_available()}

    def set_auto_publish(self, enabled, what=None):
        """
        Whether a saved take goes to the cloud folder on its own, and what of
        it. Turning it on picks up the takes of the rehearsal in progress —
        the ones recorded before the switch was flipped.
        """
        if what is not None and what not in ("mix", "tracks", "both"):
            return {"ok": False, "error": "Unknown share type"}
        self._config["auto_publish"] = bool(enabled)
        if what is not None:
            self._config["auto_publish_what"] = what
        self._write_config()
        self._enqueue_session_takes()
        return {
            "ok": True,
            "auto_publish": self._config["auto_publish"],
            "auto_publish_what": self._config.get("auto_publish_what") or "mix",
        }

    def _false_start_sec(self):
        # The config is a file somebody may edit by hand: a number is held to
        # the range Settings offers, and anything else (true included, which
        # Python counts as 1) is the default.
        value = self._config.get("false_start_sec")
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return FALSE_START_SEC
        return min(FALSE_START_MAX, max(FALSE_START_MIN, int(value)))

    def set_false_start(self, seconds):
        """
        How short a take is to be marked a false start on the rehearsal
        screen, when it has no ★ and no marks either: whole seconds, from 5
        to 120.
        """
        try:
            value = int(seconds)
        except (TypeError, ValueError):
            return {"ok": False, "error": "Not a number of seconds"}
        value = min(FALSE_START_MAX, max(FALSE_START_MIN, value))
        self._config["false_start_sec"] = value
        self._write_config()
        return {"ok": True, "false_start_sec": value}

    def clear_cloud_dir(self):
        # Publishing on its own needs somewhere to publish to. Left on, every
        # take saved afterwards is queued, refused and marked "No cloud folder
        # chosen", and the list reads as failed when nothing went wrong. The
        # invariant belongs here rather than in a greyed-out checkbox.
        self._config.pop("cloud_dir", None)
        self._config["auto_publish"] = False
        self._write_config()
        return {"ok": True}

    def _enqueue_publish(self, folder, take_number, take=None):
        """
        Ask for a take to be copied, if it is to go at all: sending is on and
        the take was not kept with "not this one", or sending is off and it
        was kept with "send this one" (see keep_take).
        """
        if take is None:
            take = self._take_in(folder, take_number) or {}
        # One that is in the cloud already is kept up to date there whatever
        # the setting says: sending on its own decides what goes up, not what
        # becomes of what is there. Only when it is out of date, though —
        # "waiting for the cloud" on a take that is fine there would be noise.
        if not self._copy_due(take):
            there = _shape_of(take.get("cloud"))
            if there is None or self._copy_current(folder, take, there):
                return
        self._queue_copy(folder, take_number, None, take)

    def _copy_current(self, folder, take, what):
        """Whether the cloud folder already holds this take as `what`, made
        the way the settings now say."""
        return cloudmod.is_current(
            take, what, self._config.get("volumes", {}),
            normalize_format(self._config.get("cloud_format")),
            self._cloud_target(folder))

    def _copy_due(self, take):
        """Whether sending on its own sends this take: the setting is on and
        it was not kept with "not this one", or it was kept with "send this
        one" (see keep_take)."""
        if take.get("cloud_skip"):
            return False
        return bool(self._config.get("auto_publish") or take.get("cloud_send"))

    def _queue_copy(self, folder, take_number, what, take=None):
        """The queue and the journal together: one waiting entry per take,
        however many times it is asked for. `what` None is automatic."""
        key = (str(folder), int(take_number))
        with self._cloud_lock:
            if key not in self._cloud_entries:
                take = take or self._take_in(folder, take_number) or {}
                name = take.get("name") or f"Take {take_number}"
                self._cloud_entries[key] = self._journal.begin(
                    "cloud", f"“{name}” → cloud", str(folder), int(take_number),
                    waiting=True)
        self._cloud_queue.enqueue(str(folder), take_number, what)

    def _take_in(self, folder, take_number):
        """A take's record, or None."""
        return self._lib.take(folder, take_number)

    def _enqueue_session_takes(self):
        """
        Every take of the rehearsal in progress.

        What a copy was made from is mostly settings — the balance, the
        format, where the copies go — so "that changed" is true of every take
        ever recorded. Re-publishing all of them because a fader moved would
        be a storm of mixdowns. The rehearsal in progress is the one the
        change was made during; older ones keep what they sent, and the share
        dialog is still there to redo one by hand.
        """
        if self._session is None:
            return
        for t in self._session_takes():
            self._enqueue_publish(self._session["folder"], t["take_number"], take=t)

    def _retry_failed_publishes(self):
        """
        The realistic failure is a sync folder that is briefly not there. The
        next saved take sweeps up whatever the rehearsal could not send while
        it was gone, so the backlog clears itself with no retry loop.
        """
        if self._session is None:
            return
        for t in self._session_takes():
            if t.get("cloud_error"):
                self._enqueue_publish(self._session["folder"], t["take_number"], take=t)

    def _publish_step(self, folder, take_number, what=None):
        """
        One take, on the publishing thread. `what` None is an automatic job:
        it skips a take that is already in the cloud folder in the shape the
        settings ask for, so a burst of requests costs one mixdown, not
        several, and leaves nothing in the journal for it. A job asked for by
        hand copies what it was asked for.
        """
        key = (str(folder), int(take_number))
        with self._cloud_lock:
            entry = self._cloud_entries.pop(key, None)
        try:
            self._publish(folder, take_number, what, entry)
        except Exception as e:
            # Whatever went wrong — the library, writing a failure down — the
            # entry must not be left waiting or running with nothing behind it.
            if entry is not None:
                entry.fail(str(e),
                           retry=what or self._config.get("auto_publish_what") or "mix")
            raise

    def _publish(self, folder, take_number, what, entry):
        take = self._lib.take(folder, take_number)
        if entry is None:
            name = (take or {}).get("name") or f"Take {take_number}"
            entry = self._journal.begin(
                "cloud", f"“{name}” → cloud", str(folder), int(take_number))
        if what is None:
            # Asked again here, not only when queued: the setting or the
            # take's own answer can have changed while it waited.
            there = _shape_of((take or {}).get("cloud"))
            due = take is not None and self._copy_due(take)
            if take is None or (not due and there is None):
                entry.discard()
                return
            # What is there already, and what the setting sends if it sends
            # this take: a take sent by hand as its tracks too keeps them when
            # a new balance or format makes it again, and one the setting does
            # not send is made again as it was, not as the setting would.
            what = (_with(there, self._config.get("auto_publish_what") or "mix")
                    if due else there)
            fmt = normalize_format(self._config.get("cloud_format"))
            target = self._cloud_target(folder)
            if cloudmod.is_current(take, what, self._config.get("volumes", {}),
                                   fmt, target):
                entry.discard()
                return
        entry.start("Starting")
        try:
            res = self._copy_to_cloud(str(folder), take_number, what,
                                      progress=entry.progress)
        except Exception as e:
            # A sync folder that vanishes mid-write raises instead of
            # returning {"ok": False} — that must still land as a recorded,
            # retryable failure, not a silently stalled take.
            res = {"ok": False, "error": str(e)}
        if res.get("ok"):
            entry.done(_copy_detail(what, res))
            return
        error = res.get("error") or "Could not copy the take"
        entry.fail(error, retry=what)
        if take is not None:
            self._record_cloud_error(folder, take_number, error)

    def _record_cloud_error(self, folder, take_number, message):
        """Why a take is not in the cloud folder, kept with the take."""
        self._lib.set_cloud_error(folder, take_number, message)

    def share_take(self, folder, take_number, what="mix"):
        """
        Puts one take on the queue to be copied into the cloud folder, and
        answers at once. what: "mix" (one stereo file), "tracks" (the
        originals) or "both". The copying is _copy_to_cloud, on the
        publishing thread, and reported in the journal — see activity.py.
        What can be refused now is refused now.
        """
        if what not in ("mix", "tracks", "both"):
            return {"ok": False, "error": "Unknown share type"}
        if self._cloud_dir is None:
            return {"ok": False, "error": "No cloud folder chosen", "needs_dir": True}
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        take = self._lib.take(folder, take_number)
        if take is None:
            if not self._lib.has(folder):
                return {"ok": False, "error": "Rehearsal not found"}
            return {"ok": False, "error": "Take not found"}
        if not any(Path(t.get("file", "")).exists() for t in take["tracks"]):
            return {"ok": False, "error": "The take has no files left on disk"}
        self._queue_copy(folder, take_number, what, take)
        return {"ok": True, "queued": True, "take": take}

    def send_starred(self, folder):
        """
        Send starred: every ★ take of a rehearsal with nothing of it in the
        cloud folder and no copy waiting, queued as What gets sent says.
        A take already there is not sent again, even if the setting has
        changed since; its share dialog is there for that. A take that cannot
        be sent (its files gone) is in `failed`, with why.
        """
        if self._cloud_dir is None:
            return {"ok": False, "error": "No cloud folder chosen", "needs_dir": True}
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        rehearsal = self._lib.rehearsal(folder)
        if rehearsal is None:
            return {"ok": False, "error": "Rehearsal not found"}
        what = self._config.get("auto_publish_what") or "mix"
        waiting = self._cloud_queue.states(folder)
        queued, failed = [], []
        for take in rehearsal["takes"]:
            n = take["take_number"]
            if not take.get("starred") or n in waiting or _shape_of(take.get("cloud")):
                continue
            res = self.share_take(folder, n, what)
            if res.get("ok"):
                queued.append(n)
            else:
                failed.append({"take_number": n, "error": res.get("error", "Could not copy")})
        return {"ok": True, "queued": queued, "failed": failed}

    def retry_cloud(self, entry_id):
        """A failed copy, queued again as the one it was."""
        entry = self._journal.find(int(entry_id))
        data = entry.snapshot() if entry else None
        if not data or data["kind"] != "cloud" or data["state"] != "failed":
            return {"ok": False, "error": "Nothing to retry"}
        return self.share_take(data["folder"], data["take_number"],
                               data["retry"] or "mix")

    def _copy_to_cloud(self, folder, take_number, what="mix", progress=None):
        """
        Copies one take into the cloud folder. what: "mix" (one stereo file),
        "tracks" (the originals, with the take's notes as .mid) or "both".
        `progress(fraction, step)`, when given, hears how far along it is,
        weighed in frames of audio.

        Anything shared earlier for this take is replaced, so re-sharing after
        a rename or a new balance leaves one copy, not three.
        """
        if what not in ("mix", "tracks", "both"):
            return {"ok": False, "error": "Unknown share type"}

        cloud = self._cloud_dir
        if cloud is None:
            return {"ok": False, "error": "No cloud folder chosen", "needs_dir": True}
        try:
            cloud.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return {"ok": False, "error": f"Could not open the cloud folder: {e}"}

        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        take = self._lib.take(folder, take_number)
        if take is None:
            if not self._lib.has(folder):
                return {"ok": False, "error": "Rehearsal not found"}
            return {"ok": False, "error": "Take not found"}

        tracks = [t for t in take["tracks"] if Path(t.get("file", "")).exists()]
        if not tracks:
            return {"ok": False, "error": "The take has no files left on disk"}

        # Never onto a copy another take names: an old copy of this take
        # that another take names now stays (_unused), and this copy takes
        # the next free name (_free_copy_name). Copies only.
        others = self._lib.others_cloud_paths(folder, take_number)
        self._remove_shared(self._unused(take.get("cloud"), others))

        # From the folder settled on above, not from the setting again: it can
        # be cleared from the interface while this runs.
        target = _cloud_subfolder(cloud, folder)
        fmt = normalize_format(self._config.get("cloud_format"))
        # The tracks go in a folder of that name, the mix is it with the
        # format's ending, or .wav when the encoder could not compress it.
        base = _free_copy_name(
            self._cloud_base(take_number, take),
            lambda name: [PurePosixPath(target.name, name + end)
                          for end in ("", extension(fmt), ".wav")],
            others)
        shared = {}

        # Taken once, before anything is written. A mixdown is seconds long
        # and a fader can move during it; reading the balance again afterwards
        # would fingerprint the copy with a balance it was never rendered
        # with, and the take would then report itself current for a mix that
        # is wrong — for good, since the fingerprint suppresses its own repair.
        volumes = dict(self._config.get("volumes", {}))
        # What the encoder had to say, for the person (an encode that fell back
        # to WAV); not the take's notes, which are the .mid files below.
        encoder_notes = []

        # How far along it is, in frames of audio: the mixdown reads the
        # longest track twice, its encode once more; each track's copy is its
        # own length. A WAV "encode" is a rename and weighs nothing.
        lengths = [wav_frames(t["file"]) for t in tracks]
        longest = max(lengths, default=0)
        parts = []
        if what in ("mix", "both"):
            parts += [("Mixing", 2 * longest),
                      ("Encoding the mix", 0 if fmt == "wav" else longest)]
        first_track = len(parts)
        if what in ("tracks", "both"):
            parts += [(f"Track {i + 1} of {len(tracks)}", n)
                      for i, n in enumerate(lengths)]
        stages = activitymod.Stages(parts, progress or (lambda fraction, step: None))

        # Every copy is written beside its real name and moved onto it when it
        # is whole, the same way config.json is — see WRITING_PREFIX.
        if what in ("mix", "both"):
            writing = _writing_path(target / f"{base}.wav")
            # A click take's mix carries its tempo as its WAVs do (spec Part
            # 9): none when they carry none, as the setting was at Record.
            acid = None
            if take.get("click"):
                try:
                    acid = read_acid(tracks[0]["file"])
                except OSError:
                    acid = None
            res = mixdown(tracks, writing, volumes, progress=stages.part(0), acid=acid)
            if not res["ok"]:
                writing.unlink(missing_ok=True)
                return res
            packed = encode(res["file"], fmt, progress=stages.part(1))
            if packed.get("note"):
                encoder_notes.append(packed["note"])
            mix = target / f"{base}{extension(packed['format'])}"
            os.replace(packed["file"], mix)
            shared["mix"] = str(mix)
            shared["mix_format"] = packed["format"]
            shared["gain"] = res["gain"]

        if what in ("tracks", "both"):
            dest = target / base
            writing = None
            # What the tracks really came out as: an encode that could not
            # compress leaves the copy a WAV, whatever the setting says.
            came_out = set()
            try:
                dest.mkdir(parents=True, exist_ok=True)
                for k, t in enumerate(tracks):
                    source = Path(t["file"])
                    writing = _writing_path(dest / source.name)
                    shutil.copy2(source, writing)
                    packed = encode(writing, fmt,
                                    progress=stages.part(first_track + k))
                    came_out.add(packed["format"])
                    writing = Path(packed["file"])
                    os.replace(
                        writing,
                        dest / f"{source.stem}{extension(packed['format'])}",
                    )
                    writing = None
                    if packed.get("note") and packed["note"] not in encoder_notes:
                        encoder_notes.append(packed["note"])
                # The take's notes go beside the tracks as they are: a .mid is
                # not audio, so it is never encoded (which would rename it
                # <stem>.wav) and is not part of the mix. One that is not on
                # disk any more is left out, as a missing track is. They weigh
                # nothing in the stages: a few kilobytes beside the audio.
                for row in take.get("notes") or []:
                    mid = Path(row.get("file") or "")
                    if not mid.is_file():
                        continue
                    writing = _writing_path(dest / mid.name)
                    shutil.copy2(mid, writing)
                    os.replace(writing, dest / mid.name)
                    writing = None
            except OSError as e:
                if writing is not None:
                    writing.unlink(missing_ok=True)
                return {"ok": False, "error": f"Could not copy the tracks: {e}"}
            shared["tracks"] = str(dest)
            shared["tracks_format"] = fmt if came_out <= {fmt} else "wav"

        shared["source"] = cloudmod.source_of(
            take, what, volumes, fmt, _safe_name(folder.name)
        )
        # Only the take's cloud fields are written, so a rename that landed
        # while the copy was being made is kept; a copy that succeeded settles
        # whatever went wrong last time.
        if not self._lib.set_cloud_copy(folder, take_number, shared, cloud):
            # Deleted while this was being written. delete_take has been and
            # gone, so nothing else will take out what was just put there for
            # a take that no longer exists.
            self._remove_shared({"cloud": shared})
            return {"ok": False, "error": "Take not found"}

        # The caller gets back the take it asked to share, carrying the result.
        take["cloud"] = shared
        take.pop("cloud_error", None)

        return {
            "ok": True,
            "take": take,
            "cloud": shared,
            **({"note": " ".join(encoder_notes)} if encoder_notes else {}),
        }

    def unshare_take(self, folder, take_number):
        """Removes the cloud copies of a take. The originals are untouched."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        take = self._lib.take(folder, take_number)
        if take is None:
            if not self._lib.has(folder):
                return {"ok": False, "error": "Rehearsal not found"}
            return {"ok": False, "error": "Take not found"}
        # A copy on its way would put back what is removed now the moment it
        # finished — the file in the band's folder, and its record.
        if self._cloud_queue.states(str(folder)).get(int(take_number)):
            return {"ok": False, "error":
                    "This take is still being copied to the cloud. Remove it "
                    "once the copy has finished."}

        # Not a copy another take names too (two rows naming one file, as an
        # older version could leave): that file is the other take's as well.
        others = self._lib.others_cloud_paths(folder, take_number)
        result = self._remove_shared(self._unused(take.get("cloud"), others))
        self._lib.set_cloud_copy(folder, take_number, None, None)
        return {"ok": True, **result}

    def _remove_shared(self, take):
        """
        Deletes whatever this take previously put in the cloud folder. Copies
        go to the Trash rather than straight out, in case the shared file is
        the one somebody is already working from.
        """
        cloud = self._cloud_dir
        removed, trashed = [], True
        for key in ("mix", "tracks"):
            path = (take.get("cloud") or {}).get(key)
            if not path:
                continue
            path = Path(path)
            # Only ever touch things inside the cloud folder.
            if cloud is None or not _is_inside(path, cloud) or not path.exists():
                continue
            res = move_to_trash(path, cloud)
            trashed = trashed and res.get("trashed", False)
            removed.append(str(path))
        # The rehearsal's folder in the cloud, if that was the last of it.
        for parent in {Path(p).parent for p in removed}:
            self._prune_cloud_dir(parent)
        return {"removed": removed, "trashed": trashed if removed else False}

    def _prune_cloud_dir(self, path):
        """
        Takes one rehearsal's folder out of the cloud folder once nothing is
        left in it. Only an empty one, only inside the cloud folder, never the
        cloud folder itself: everything else in there is the band's.
        """
        cloud = self._cloud_dir
        path = Path(path)
        if cloud is None or not _is_inside(path, cloud):
            return
        if path.resolve() == cloud.resolve():
            return
        try:
            path.rmdir()  # which refuses a folder with anything in it
        except OSError:
            pass

    def _sweep_empty_cloud_dirs(self):
        """
        Rehearsal folders in the cloud that earlier versions emptied and left
        behind, when a rename or a new copy moved what was in them elsewhere.
        Only empty folders straight inside the cloud folder that are named the
        way the app names a rehearsal's: nothing else is the app's to remove.
        """
        cloud = self._cloud_dir
        if cloud is None:
            return
        try:
            entries = list(cloud.iterdir())
        except OSError:
            return
        for entry in entries:
            if _REHEARSAL_DIR_NAME.match(entry.name) and entry.is_dir():
                self._prune_cloud_dir(entry)

    def _sweep_empty_cloud_dirs_later(self):
        """The same, off the calling thread: the cloud folder can be a drive
        that answers slowly, and nothing is waiting for this."""
        threading.Thread(target=self._sweep_empty_cloud_dirs, daemon=True).start()

    def _copy_busy(self, folder, take_number=None):
        """Whether a copy of this take — or of any take of this rehearsal —
        is waiting or being made. One in flight has read where it writes to,
        so moving its files under it would leave them where nothing points."""
        states = self._cloud_queue.states(str(folder))
        return bool(states) if take_number is None else int(take_number) in states

    def _cloud_base(self, take_number, take):
        """What a take's copies are called: "03 - Polyn"."""
        return (f"{int(take_number):02d} - "
                f"{_safe_name(take.get('name', '') or f'Take {take_number}')}")

    def _rename_take_copies(self, folder, take_number, take, requeue=True):
        """
        After a take is renamed: its copies in the cloud are renamed to match,
        where they are, rather than mixed again — however they got there, and
        whether or not sending on its own is on. `take` is its record as it
        now is. Copies that cannot be moved (not where the record says, or
        one being made right now) are made again under the new name instead.

        With requeue=False (putting names right in the background) nothing is
        ever queued: what cannot be moved is left for the next open. Returns
        (renamed, error): whether a copy was renamed, and why one could not
        be (an OSError, with the parts already moved put back).
        """
        cloud = self._cloud_dir
        if cloud is None:
            # With no cloud folder there is nothing to move and no telling
            # what was sent; asking for a copy is what records why there is
            # none, and what sends it once the folder is back.
            if requeue:
                self._enqueue_publish(folder, take_number, take=take)
            return False, None
        shared = dict(take.get("cloud") or {})
        shape = _shape_of(shared)
        if shape is None:
            return False, None
        parts = {k: Path(shared[k]) for k in ("mix", "tracks") if shared.get(k)}
        if (self._copy_busy(folder, take_number)
                or not all(p.exists() and _is_inside(p, cloud) for p in parts.values())):
            if requeue:
                self._queue_copy(folder, take_number, shape, take)
            return False, None

        # A copy another take names too is that take's as well, and stays
        # where its row says: this take's copy is made anew instead, which
        # leaves it (_copy_to_cloud). Putting names right queues nothing.
        others = self._lib.others_cloud_paths(folder, take_number)
        if any(self._cloud_in_use(p, others) for p in parts.values()):
            if requeue:
                self._queue_copy(folder, take_number, shape, take)
            return False, None

        def lands(name):
            return {k: p.with_name(name + (p.suffix if k == "mix" else ""))
                    for k, p in parts.items()}

        # Not onto a copy another take names, as a copy made anew is not
        # (_copy_to_cloud): the next free name instead.
        home = Path(cloud).resolve()
        base = _free_copy_name(
            self._cloud_base(take_number, take),
            lambda name: [p.resolve().relative_to(home) for p in lands(name).values()],
            others)
        goes_to = lands(base)
        moved = []
        try:
            for k, p in parts.items():
                # Plain strings: Path compares case-blind on Windows, and a
                # case-only rename is still a rename.
                if str(goes_to[k]) != str(p):
                    p.rename(goes_to[k])
                    moved.append((goes_to[k], p))
        except OSError as e:
            print(f"[cloud] renaming the copies of take {take_number}: {e}")
            for new, old in reversed(moved):
                try:
                    new.rename(old)
                except OSError:
                    pass
            if requeue:
                self._queue_copy(folder, take_number, shape, take)
                return False, None
            return False, str(e)
        shared.update({k: str(p) for k, p in goes_to.items()})
        # Only the name changed. The rest of what the copy was made from —
        # the balance, the format — is still what it was made with.
        shared["source"] = {**(shared.get("source") or {}),
                            "name": take.get("name", "")}
        self._lib.set_cloud_copy(folder, take_number, shared, cloud)
        return bool(moved), None

    def _move_rehearsal_copies(self, old_folder, new_folder):
        """
        After a rehearsal is renamed: its folder in the cloud takes the new
        name, with every copy in it, and each take's record follows. When that
        cannot be done in one move — a copy being made, a copy not where its
        record says, a folder already there under the new name, another
        rehearsal's copies in the same folder — each take
        that was in the cloud is made again in the new folder instead, and the
        old one goes once it is empty.
        """
        cloud = self._cloud_dir
        if cloud is None:
            # As in _rename_take_copies: nothing to move, so ask, and let the
            # copy say why it is not there.
            if self._session is not None and _same_folder(self._session["folder"], new_folder):
                self._enqueue_session_takes()
            return
        takes = [t for t in (self._lib.rehearsal(new_folder) or {}).get("takes", [])
                 if _shape_of(t.get("cloud"))]
        if not takes:
            return
        was, goes_to = _cloud_subfolder(cloud, old_folder), _cloud_subfolder(cloud, new_folder)
        if was == goes_to:
            return

        def paths(take):
            return [Path(v) for k, v in take["cloud"].items() if k in ("mix", "tracks") and v]

        # Not whole when another rehearsal's copies are in it too (one found
        # again by Locate in a folder named like this one's): they would go
        # where their rows do not look. Made again in the new folder instead,
        # which leaves those where they are (_copy_to_cloud).
        movable = (
            not self._copy_busy(new_folder) and not self._copy_busy(old_folder)
            and was.is_dir() and not goes_to.exists()
            and all(p.parent == was and p.exists() for t in takes for p in paths(t))
            and not self._cloud_in_use(was, self._lib.cloud_paths_outside(new_folder))
        )
        if movable:
            try:
                was.rename(goes_to)
            except OSError as e:
                print(f"[cloud] renaming the rehearsal's folder: {e}")
                movable = False
        if not movable:
            for t in takes:
                self._queue_copy(new_folder, t["take_number"], _shape_of(t["cloud"]), t)
            return
        target = self._cloud_target(new_folder)
        for t in takes:
            shared = dict(t["cloud"])
            for k in ("mix", "tracks"):
                if shared.get(k):
                    shared[k] = str(goes_to / Path(shared[k]).name)
            shared["source"] = {**(shared.get("source") or {}), "dir": target}
            self._lib.set_cloud_copy(new_folder, t["take_number"], shared, cloud)
        self._follow_held_copies(cloud, was, goes_to, target)

    def _follow_held_copies(self, cloud, was, goes_to, target):
        """
        The copies of this rehearsal's takes that wait in the holding folder
        for their Undo were in its cloud folder too, and moved with it: their
        records follow them, so the end of the notice takes them out where
        they are, and Undo puts back a record of a copy that is there.
        """
        for token in holding.tokens(self._recordings_dir):
            record = (holding.read(self._recordings_dir, token) or {}).get("record")
            if not isinstance(record, dict):
                continue
            changed = False
            for shared in record.get("shared") or []:
                for k in ("mix", "tracks"):
                    if shared.get(k) and Path(shared[k]).parent == was:
                        shared[k] = str(goes_to / Path(shared[k]).name)
                        changed = True
            for take in record.get("takes") or []:
                copy = take.get("cloud_copy") or {}
                moved = False
                for k in ("mix", "tracks"):
                    if copy.get(k) and (cloud / copy[k]).parent == was:
                        copy[k] = (goes_to / Path(copy[k]).name).relative_to(cloud).as_posix()
                        moved = True
                if moved:
                    copy["source"] = {**(copy.get("source") or {}), "dir": target}
                    changed = True
            if changed:
                holding.update(self._recordings_dir, token, record)

    # ---------- putting names right ----------

    def _out_of_line(self, take):
        """
        What of a take does not carry its name: a subset of {"disk",
        "cloud"}. Only what can be renamed counts: a take whose files are in
        more than one folder, or are not on disk, has no folder to rename.
        """
        wrong = set()
        dirs = _dirs_of(take)
        if len(dirs) == 1:
            d = next(iter(dirs))
            if d.is_dir() and not _carries(d.name, _take_dir_name(take["take_number"], take["name"])):
                wrong.add("disk")
        # The cloud part counts only when every recorded copy is where its
        # record says (a folder not mounted, a copy the band deleted: left,
        # and looked at again next open) and one of them has another name.
        shared = take.get("cloud") or {}
        base = self._cloud_base(take["take_number"], take)
        # " (2)" after it carries it too: the next free name, which a copy
        # takes when another take's has that name (_free_copy_name).
        recorded = [(key, Path(shared[key])) for key in ("mix", "tracks") if shared.get(key)]
        if recorded and all(p.exists() for _, p in recorded) and any(
                not _carries(p.stem if key == "mix" else p.name, base)
                for key, p in recorded):
            wrong.add("cloud")
        return wrong

    def _names_out_of_line(self):
        """Every take on disk whose folder or cloud copy does not carry its
        name, as (folder, take_number, name). The database, plus one
        is_dir() per take."""
        if self._library is None:
            return []
        todo = []
        for r in self._lib.rehearsals():
            if r["missing"]:
                continue
            for t in r["takes"]:
                if self._out_of_line(t):
                    todo.append((r["folder"], t["take_number"], t["name"]))
        return todo

    def _names_must_wait(self):
        """Files in use: a take recording, a copy being made, or a take being
        saved, cropped or recovered. The pass waits for them."""
        if self._recorder is not None or self._cloud_queue.busy():
            return True
        return any(e["state"] == "running" and e["kind"] in ("stop", "crop", "recover")
                   for e in self._journal.snapshot())

    def _playing_from(self, take):
        """Whether the player has this take's files open."""
        with self._player_lock:
            open_tracks = self._open_tracks or []
            return any(_is_inside(o["file"], Path(t["file"]).parent)
                       for o in open_tracks for t in take["tracks"] if t.get("file"))

    def _put_name_right(self, folder, take_number):
        """
        One take's folder and cloud copies renamed to carry its name, as
        rename_take would, but never queuing a copy: what cannot be renamed
        now is left for the next open. A take open in the player is left too,
        rather than closed under whoever is listening.
        """
        folder = Path(folder)
        renamed = False
        with self._files_lock:
            take = self._lib.take(folder, take_number)
            wrong = self._out_of_line(take) if take is not None else set()
            if not wrong:
                return {"renamed": False, "error": None}
            if "disk" in wrong:
                # The player's lock is held from the check to the move, so
                # the take cannot be opened in between.
                with self._player_lock:
                    if self._playing_from(take):
                        return {"renamed": False, "error": None}
                    moved, tracks, notes, error = self._move_take_dir(
                        folder, take_number, take, take["name"])
                if error is not None:
                    return {"renamed": False, "error": error}
                if moved:
                    try:
                        updated = self._lib.update_take(
                            folder, take_number, tracks=tracks, notes=notes)
                    except Exception as e:
                        return self._undo_move(moved, str(e))
                    if updated is None:
                        return self._undo_move(moved, None)
                    take, renamed = updated, True
            if "cloud" in wrong and self._cloud_dir is not None:
                did, error = self._rename_take_copies(
                    folder, take_number, take, requeue=False)
                if error is not None:
                    return {"renamed": renamed, "error": error}
                renamed = renamed or did
            return {"renamed": renamed, "error": None}

    def _undo_move(self, moved, error):
        """A take's folder put back after its record could not follow. When
        that fails too, the error says where the folder is now."""
        try:
            moved[1].rename(moved[0])
        except OSError as e:
            return {"renamed": False, "error": (
                f"the folder is now at {moved[1]} and its record could not be "
                f"updated ({error or 'the take was deleted'}; putting it back: {e})")}
        return {"renamed": False, "error": error}
