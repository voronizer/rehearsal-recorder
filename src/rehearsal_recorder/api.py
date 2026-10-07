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

import json
import logging
import os
import re
import shutil
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import sounddevice as sd

from rehearsal_recorder import __version__
from rehearsal_recorder.audio.capture import AudioRecorder
from rehearsal_recorder.audio.drafts import (
    DRAFTS_DIR,
    describe,
    draft_dirs,
    finalize,
    has_audio,
    wav_frames,
)
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
    channels_available,
    device_identity,
    recording_formats,
    rescan,
    saved_device,
)
from rehearsal_recorder.audio.monitor import LevelMonitor
from rehearsal_recorder.audio.player import TakePlayer
from rehearsal_recorder.audio.waveform import DEFAULT_BUCKETS, wav_peaks
from rehearsal_recorder import activity as activitymod
from rehearsal_recorder import cloud as cloudmod
from rehearsal_recorder.names_pass import NamesPass
from rehearsal_recorder import layouts
from rehearsal_recorder import updates
from rehearsal_recorder.mediaserver import AppServer
from rehearsal_recorder.store.db import LibraryUnavailable
from rehearsal_recorder.store.importer import import_all, read_text
from rehearsal_recorder.store.library import LabelRefused, Library, as_marker
from rehearsal_recorder.store.db import DB_NAME
from rehearsal_recorder import diagnostics
from rehearsal_recorder.audio.probe import InterfaceCheck, plan_for, tracks_for
from rehearsal_recorder.platform_support import (
    CRASH_LOG,
    FALLBACK_TRASH,
    app_root,
    describe_path_limit,
    move_to_trash,
    open_in_file_manager,
    reveal_in_file_manager,
    safe_filename,
    trash_kind,
)

CONFIG_PATH = Path.home() / ".rehearsal-recorder" / "config.json"
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


def _take_dir_name(take_number, name):
    """What a take's folder is called: "03 - Polyn 3"."""
    return f"{int(take_number):02d} - {_safe_name(name)}"


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


# History's two views (save_history_view).
HISTORY_VIEWS = ("rehearsals", "songs")


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


def _last_attempt(takes, song):
    """
    How long the latest go at `song` among `takes` ran, as {"song",
    "duration_sec"}, or None when there was none. The recording screen says
    it under its clock — "Vesna took 2:21 last time" — so the band can see
    how far into the song they are.
    """
    if song is None:
        return None
    goes = [t for t in takes if t.get("song") == song]
    if not goes:
        return None
    return {"song": song, "duration_sec": goes[-1].get("duration_sec")}


def _field_text(named):
    """What the name field holds for a take resolved to `named`
    (Library.resolve_name): the song's title, its go shown beside it rather
    than typed into it; or "Take N" for a take nobody named."""
    return named["song"] or named["name"]


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
    note = f" — {res['note']}" if res.get("note") else ""
    return f"{said}{note}"


def _channels_of(tracks):
    """How many channels these tracks write: a stereo track is two."""
    return sum(2 if t.get("stereo") else 1 for t in tracks)


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


class Api:
    def __init__(self, server_port=0):
        self._recorder = None
        self._cloud_queue = cloudmod.PublishQueue(
            step=self._publish_step, paused=lambda: self._recorder is not None
        )
        self._recorder_take_number = None
        self._recorder_temp_dir = None
        self._session = None
        self._monitor = None
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
        # Takes whose folder or cloud copy no longer carries their name are
        # renamed in the background — see names_pass.py.
        self._names_pass = NamesPass(
            find=self._names_out_of_line, fix=self._put_name_right,
            busy=self._names_must_wait, journal=self._journal,
        )

        self._config = self._read_config()
        # Whether a newer version is out — see updates.py. Asked only once the
        # window is up, and never while a take records.
        self._updates = updates.UpdateChecker(
            __version__,
            enabled=lambda: bool(self._config.get("check_updates", True)),
            busy=lambda: self._recorder is not None,
        )
        self._recordings_dir = Path(
            self._config.get("recordings_dir") or RECORDINGS_ROOT
        )
        self._recordings_dir.mkdir(parents=True, exist_ok=True)

        # What went wrong while starting, for the interface to say once.
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

        # Clear out leftovers from previous runs (rehearsal started, nothing
        # recorded, app closed).
        self.cleanup_empty_rehearsals()

    def attach_window(self, window):
        """Needed for native dialogs (folder picker)."""
        self._window = window
        # Only the real app runs the worker. The suites drive run_next
        # themselves, so nothing races them.
        self._cloud_queue.start()
        self._names_pass.start()
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
        recorder, self._recorder = self._recorder, None
        if recorder is not None:
            try:
                recorder.abandon()
            except Exception as e:
                print(f"[shutdown] letting go of the take: {e}")
        self.stop_monitor()
        self.player_close()
        self._cloud_queue.stop()
        self._names_pass.stop()
        self._updates.stop()
        # A rename the pass had under way finishes before the library closes.
        held = self._files_lock.acquire(timeout=10)
        try:
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
        folder = Path(recordings_dir or self._recordings_dir)
        try:
            library = Library(folder, cloud_dir=lambda: self._cloud_dir)
        except LibraryUnavailable as e:
            logging.getLogger(__name__).error("recordings database: %s", e, exc_info=True)
            return str(e)
        if getattr(self, "_library", None) is not None:
            self._library.close()
        self._library, self._library_error = library, None
        import_all(library, self._cloud_dir, report=self._report_import_failure)
        return None

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
            # Which of History's two views it opens on: the one used last.
            "history_view": (self._config.get("history_view")
                             if self._config.get("history_view") in HISTORY_VIEWS
                             else "rehearsals"),
            "output_device_index": saved_device(
                self._config, "output_device", False
            ),
            "output_channels": list(self._output_channels()),
            "cloud_dir": self._config.get("cloud_dir"),
            "cloud_format": normalize_format(self._config.get("cloud_format")),
            "cloud_formats": CLOUD_FORMATS_INFO,
            "auto_publish": bool(self._config.get("auto_publish", False)),
            "auto_publish_what": self._config.get("auto_publish_what") or "mix",
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
            tracks = [{"name": t.get("name", "?"), "channel": None}
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
        """
        if not getattr(sys, "frozen", False):
            return False
        self._updates.start()
        return True

    def update_status(self):
        """{"on": ..., "latest": {"version": ...} or None}, polled over the
        local server like the meters — see mediaserver.POLLABLE."""
        return self._updates.status()

    def download_update(self):
        """The Download button beside a newer version: fetches its zip into
        Downloads, checks it, and opens the folder with it picked out. How
        far along it is comes back in update_status."""
        return self._updates.start_download()

    def show_update(self):
        """Show in folder, once the newer version's zip is downloaded."""
        return self._updates.show_download()

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
                    "No recording interface is chosen — pick one in Settings › Audio."}
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
        error = self._open_library(folder)
        if error is not None:
            return {"ok": False, "error": error}

        self._recordings_dir = folder
        self._config["recordings_dir"] = str(folder)
        self._write_config()
        # The server hands files to the player, so it has to look at the new
        # folder right away, without restarting the app.
        self._server.set_media_root(folder)
        self._names_pass.request()
        return {"ok": True, "recordings_dir": str(folder)}

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
        """History's view, Rehearsals or Songs, kept for the next time it
        opens, after a restart too. In the config rather than the window's
        localStorage: pywebview forgets that when the app closes."""
        if view not in HISTORY_VIEWS:
            return {"ok": False, "error": "Unknown view"}
        self._config["history_view"] = view
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

        A take knows its tracks only by name and file. The icon beside each
        is the band's, found by that name: an old take whose tracks were
        called something else gets none, and is drawn with the neutral one."""
        buckets = buckets or DEFAULT_BUCKETS
        icon_of = layouts.icons(self._config.get("tracks"))
        result = []
        for t in tracks:
            icon = {"icon": icon_of[t["name"]]} if t["name"] in icon_of else {}
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
        return self._describe_devices(want_input=False)

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
            if self._recorder is not None:
                return {
                    "ok": False,
                    "error": "Not while recording — stop the take first, then "
                             "look again.",
                }
            self.stop_monitor()

            before = self._device_names()
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
        }

    def save_default_tracks(self, config):
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
        land on their own track."""
        self.stop_monitor()
        if self._recorder is not None:
            return {"ok": False, "error": "Recording in progress"}
        if not tracks:
            return {"ok": False, "error": "No tracks configured"}
        stray = channels_available(device_index, tracks)
        if stray:
            return {"ok": False, "error": stray}

        monitor = LevelMonitor(device_index, samplerate, tracks)
        try:
            monitor.start()
        except Exception as e:
            return {"ok": False, "error": str(e)}
        self._monitor = monitor
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

    def stop_monitor(self):
        if self._monitor is not None:
            try:
                self._monitor.stop()
            except Exception as e:
                print(f"[monitor] stop: {e}")
            self._monitor = None
        return {"ok": True}

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
        """Polled every couple of seconds while recording: is the stream alive
        and is the disk filling up."""
        if self._recorder is None:
            return {"recording": False}

        s = self._session
        channel_count = _channels_of(s["tracks"]) if s else 1
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
        }

    # ---------- rehearsal ----------

    def start_rehearsal(
        self, name, device_index, samplerate, tracks, bit_depth=DEFAULT_DEPTH
    ):
        if not tracks:
            return {"ok": False, "error": "No tracks configured"}
        # Caught before a folder is made for a rehearsal that cannot record.
        stray = channels_available(device_index, tracks)
        if stray:
            return {"ok": False, "error": stray}
        bit_depth = normalize_depth(bit_depth)
        # The band set this up against this card; a week from now the same
        # card should bring it back without anyone remembering a button.
        self._remember_layout(device_index, tracks)
        # Asked first: with no database there is nowhere to keep the takes,
        # and nothing should be created on disk for them.
        library = self._lib

        # The signal check and the recording cannot hold the input at once.
        self.stop_monitor()

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
        }
        # In the database from the start, so History can read the take list
        # even after a restart.
        try:
            library.create_rehearsal(
                folder, name, created_at, samplerate, bit_depth, tracks
            )
        except Exception:
            self._session = None
            raise
        return {"ok": True, "folder": str(folder)}

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
        takes = self._session_takes()
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
            "last_attempt": _last_attempt(takes, coming["song"]),
            "recording": self._recorder is not None,
            "cloud_queue": self._cloud_queue.states(s["folder"]),
            # The header's "On disk", measured as History measures a
            # rehearsal. Read when the screen asks, which is after each take.
            "disk_bytes": _folder_bytes(s["folder"]),
        }

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
        return self._lib.resolve_name(folder, song or "", number)

    def suggest_take_name(self, take_number=None, chosen=True):
        """What the name field holds for the take being named: its song's
        title, or "Take N" — see _next_take."""
        return _field_text(self._next_take(take_number, chosen))

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
        return {"ok": True, "next_take_name": _field_text(coming),
                "next_take_go": coming["go"]}

    def song_choices(self, folder=None, take_number=None):
        """
        The songs a take can be named after, so that nobody types a title the
        band has played before: {"here": [...], "other": [...]}, each
        {"song", "go"}: the title, which a pill puts in the name field, and
        the go a take would be as that song — one past its highest go
        anywhere in the library, or, for the take being renamed, its own go
        at its own song.

        "here" is what this rehearsal played, in the order it first played
        it, each with "last_take", the number of its latest take. "other" is
        every other song in the library, the most recently played first; the
        interface shows as many as it has room for.

        `folder` is the rehearsal, the one in progress when left out.
        `take_number` is the take being named.
        """
        if folder is None:
            folder = self._session["folder"] if self._session else None
        rehearsal = self._lib.rehearsal(Path(folder)) if folder else None
        takes = rehearsal["takes"] if rehearsal else []
        own = next((t for t in takes if t.get("take_number") == take_number), None)
        nexts = self._lib.next_goes()

        def go_for(song):
            if own is not None and own.get("song") == song:
                return own["go"]
            return nexts.get(song, 1)

        here = [{"song": s["name"], "go": go_for(s["name"]),
                 "last_take": max(s["take_numbers"])}
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
                    other.append({"song": s["name"], "go": go_for(s["name"])})
        return {"here": here, "other": other}

    def finish_rehearsal(self):
        if self._session is None:
            return {"ok": False, "error": "No rehearsal in progress"}
        folder = Path(self._session["folder"])
        rehearsal = self._lib.rehearsal(folder)
        take_count = len(rehearsal["takes"]) if rehearsal else 0
        self._session = None

        # A rehearsal where nothing was saved should not leave a folder behind.
        removed = False
        if rehearsal is not None and self._is_empty(rehearsal):
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
        for rehearsal in self._lib.rehearsals():
            folder = Path(rehearsal["folder"])
            if rehearsal["missing"] or folder == live:
                continue
            if self._is_empty(rehearsal) and self._remove_empty(folder):
                removed += 1
        return {"ok": True, "removed": removed}

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

    def start_take(self):
        if self._session is None:
            return {"ok": False, "error": "No rehearsal in progress"}
        if self._recorder is not None:
            return {"ok": False, "error": "Already recording"}

        s = self._session
        s["take_counter"] += 1
        take_number = s["take_counter"]
        temp_dir = s["folder"] / DRAFTS_DIR / f"take {take_number}"

        recorder = AudioRecorder(
            s["device_index"],
            s["samplerate"],
            s["tracks"],
            temp_dir,
            s.get("bit_depth", LEGACY_DEPTH),
        )
        try:
            recorder.start()
        except Exception as e:
            s["take_counter"] -= 1
            return {"ok": False, "error": str(e)}

        self._recorder = recorder
        self._recorder_take_number = take_number
        self._recorder_temp_dir = temp_dir
        return {"ok": True, "take_number": take_number}

    def get_levels(self):
        if self._recorder is None:
            return {}
        return self._recorder.get_levels()

    def stop_take(self):
        if self._recorder is None:
            return {"ok": False, "error": "Not recording"}

        recorder = self._recorder
        take_number = self._recorder_take_number
        temp_dir = self._recorder_temp_dir
        self._recorder = None
        self._recorder_take_number = None
        self._recorder_temp_dir = None

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
        result = self._journaled(
            "stop", f"Saving “{plain_name}”", temp_dir, take_number,
            lambda progress: recorder.stop(progress=progress),
        )
        return {
            "ok": True,
            "take_number": take_number,
            "temp_dir": str(temp_dir),
            "duration_sec": result["duration_sec"],
            "tracks": result["tracks"],
            "suggested_name": field,
            "default_name": default,
        }

    def keep_take(
        self,
        take_number,
        temp_dir,
        custom_name,
        duration_sec,
        tracks,
        markers=None,
        send_to_cloud=None,
    ):
        """
        tracks: [{"name":.., "file": <path in the drafts folder>}, ...] as
        returned by stop_take(). Moves them into the rehearsal folder and adds
        the take to the saved list.

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

        s = self._session
        # Named as it will be kept: the song and go the name resolves to, not
        # what was typed — "polyn" for the third go is "Polyn 3".
        named = self._lib.resolve_name(s["folder"], custom_name, take_number)
        take_dir = _unique_path(s["folder"] / _take_dir_name(take_number, named["name"]))
        take_dir.mkdir(parents=True, exist_ok=True)

        # The review screen is still playing these very files.
        self._release_player_in(temp_dir)

        moved, undo = self._move_tracks(tracks, take_dir)

        take_info = {
            "take_number": take_number,
            "name": (custom_name or "").strip(),
            "duration_sec": duration_sec,
            "tracks": moved,
            "markers": [self._as_marker(m) for m in (markers or [])],
        }
        if send_to_cloud is False:
            take_info["cloud_skip"] = True
        elif send_to_cloud is True:
            take_info["cloud_send"] = True
        kept = self._add_moved_take(s["folder"], take_info, undo, take_dir)
        if kept is None:
            return {"ok": False, "error": "Rehearsal not found"}
        # The name picked for this take is used up; the next one follows on
        # from it. A draft rescued from an earlier take leaves it alone.
        if take_number == s["take_counter"]:
            s.pop("next_name", None)

        shutil.rmtree(temp_dir, ignore_errors=True)
        self._cleanup_drafts_dir(temp_dir)
        self._enqueue_publish(s["folder"], take_number, take=kept)
        self._retry_failed_publishes()
        return {"ok": True, "take": kept}

    @staticmethod
    def _move_tracks(tracks, take_dir):
        """
        A take's files into its folder. Returns them at their new paths, and
        the (new, old) pairs that put them back.
        """
        moved, undo = [], []
        for t in tracks:
            src = Path(t["file"])
            dst = take_dir / src.name
            if src.exists():
                shutil.move(str(src), str(dst))
                undo.append((dst, src))
            moved.append({"name": t["name"], "file": str(dst)})
        return moved, undo

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
        the same way, into the Trash. This used to be an rmtree of whatever
        path it was handed: the one place in the app where a recording was
        really destroyed, and the one that needed it least, because the take
        was recorded seconds earlier and cannot be played again.
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
            if any(_is_inside(t["file"], folder) for t in open_tracks):
                self.player_close()

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
        mid-take. Their audio is on disk as raw PCM; here we just report it.
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

    def recover_draft(self, draft_dir, name=None):
        """Turns a draft into a normal saved take of its rehearsal."""
        draft_dir = Path(draft_dir)
        if not self._inside_recordings(draft_dir):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        if not draft_dir.is_dir():
            return {"ok": False, "error": "Draft not found"}

        folder = draft_dir.parent.parent
        r = self._lib.rehearsal(folder)
        if r is None:
            return {"ok": False, "error": "Rehearsal not found"}

        def work(progress):
            done = finalize(draft_dir, r["samplerate"], r["bit_depth"],
                            progress=progress)
            if not done["tracks"]:
                return {"ok": False, "error": "Draft has no audio"}
            return done

        result = self._journaled(
            "recover", f"Recovering “{draft_dir.name}”", draft_dir, None, work)
        if result.get("ok") is False:
            return result

        take_number = max((t["take_number"] for t in r["takes"]), default=0) + 1
        # A draft rescued with no name is a take nobody named: "Take 5".
        display_name = (name or "").strip()
        named = self._lib.resolve_name(folder, display_name, take_number)
        take_dir = _unique_path(folder / _take_dir_name(take_number, named["name"]))
        take_dir.mkdir(parents=True, exist_ok=True)

        moved, undo = self._move_tracks(result["tracks"], take_dir)
        take_info = {
            "take_number": take_number,
            "name": display_name,
            "duration_sec": result["duration_sec"],
            "tracks": moved,
            # A rescued take was never listened to, so it has no marks yet.
            "markers": [],
        }
        kept = self._add_moved_take(folder, take_info, undo, take_dir)
        if kept is None:
            return {"ok": False, "error": "Rehearsal not found"}

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
        return {"ok": True, "take": kept, "folder": str(folder)}

    def discard_draft(self, draft_dir):
        draft_dir = Path(draft_dir)
        if not self._inside_recordings(draft_dir):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        self._release_player_in(draft_dir)
        result = move_to_trash(draft_dir, self._recordings_dir)
        self._cleanup_drafts_dir(draft_dir)
        return result

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
        }

    def last_time(self):
        """
        What the setup screen says about the rehearsals before this one: the
        last one song by song, the songs it left out, and the few before it.

        "last" is the newest rehearsal on disk with a named take in it, with
        its takes as get_rehearsal gives them, so any of them can be played
        from there: a soundcheck recorded after it, or a jam nobody named,
        has nothing to say song by song. With no named take anywhere it is
        the newest rehearsal with takes, and None when there is none.

        "not_played" is every song of an older rehearsal that "last" did not
        play, the latest time it was played first, with how many goes it got
        then and the last of them as "take". Only rehearsals on disk: a song
        whose takes cannot be played is no use here.

        "earlier" is the three rehearsals after "last" in the list, as
        history lists them, and "count" how many there are in all.

        Every song, in "last"'s "songs" and in "not_played", says what its
        ▶ plays, as "plays": its newest ★ go in a rehearsal on disk, from
        whichever rehearsal it was played at, or with none, its last go at
        the rehearsal it is listed under. "Newest" is the rehearsal's date,
        then the later take in the evening, never the go number, which a take
        renamed into the song gets afresh.

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

        played = set()
        not_played = []
        if last is not None:
            played = {s["name"].casefold() for s in _songs_of(last["takes"])}
            # Newest first, so what comes after it in the list is older.
            for r in on_disk[on_disk.index(last) + 1:]:
                for song in _songs_of(r["takes"]):
                    key = song["name"].casefold()
                    if key in played:
                        continue
                    played.add(key)
                    goes = [t for t in r["takes"] if t["take_number"] in song["take_numbers"]]
                    not_played.append({
                        "name": song["name"],
                        "folder": r["folder"],
                        "rehearsal": r["name"],
                        "created_at": r["created_at"],
                        "goes": len(goes),
                        "take": goes[-1],
                        "plays": plays(song["name"], r, goes),
                    })

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
            "not_played": not_played,
            "earlier": [{
                "folder": r["folder"],
                "name": r["name"],
                "created_at": r["created_at"],
                "take_count": len(r["takes"]),
                "total_duration_sec": sum(t["duration_sec"] for t in r["takes"]),
                "missing": r["missing"],
            } for r in earlier],
            "count": len(rehearsals),
        }

    def list_songs(self):
        """Every song with a go, and the takes with no song as one row, for
        History's Songs view (Library.songs). From the database alone."""
        return self._lib.songs()

    def get_song(self, song_id=None):
        """
        A song's page: {"ok", "id", "title", "plays", "goes"}, its goes from
        every rehearsal as Library.goes_of gives them, and "plays" what its
        play button plays (_plays_of). `song_id` None is the takes with no
        song.
        """
        found = self._lib.goes_of(song_id)
        if found is None:
            return {"ok": False, "error": "Song not found"}
        return {"ok": True, **found, "plays": _plays_of(found["goes"])}

    # ---------- renaming ----------

    def _move_take_dir(self, folder, take_number, take, name):
        """
        A take's folder renamed to carry `name`, so the names still make
        sense browsing the disk. Returns (moved, tracks, error): the (old,
        new) folders when it moved, the take's files at their new paths
        (None when nothing moved), and why it could not be moved.
        """
        old_dirs = {Path(t["file"]).parent for t in take["tracks"] if t.get("file")}
        if len(old_dirs) != 1:
            return None, None, None
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
            return None, None, None
        # Windows will not rename a folder holding a file the player has
        # mapped, and the rehearsal screen is usually playing the very take
        # it offers to rename. The interface reopens the take from its new
        # path afterwards.
        self._release_player_in(old_dir)
        try:
            old_dir.rename(new_dir)
        except OSError as e:
            return None, None, str(e)
        return ((old_dir, new_dir),
                [{**t, "file": str(new_dir / Path(t["file"]).name)} for t in take["tracks"]],
                None)

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

            # The folder carries the name the take ends up with, which can
            # differ from what was typed: renamed to its own song, a take
            # keeps its go.
            named = self._lib.resolve_name(folder, display_name, take_number)
            moved, new_tracks, error = self._move_take_dir(
                folder, take_number, take, named["name"])
            if error is not None:
                print(f"[rename] take folder: {error}")

            try:
                updated = self._lib.update_take(
                    folder, take_number, name=display_name, tracks=new_tracks
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

    def rename_rehearsal(self, folder, new_name):
        """Renames a rehearsal and its folder. Its takes' files are kept
        relative to the folder, so they follow it with nothing to rewrite."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        with self._files_lock:
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
        """[{id, name, colour, marks}] in order; [] while the recordings
        database cannot be opened: that is said once at start, and with no
        database there is nothing to mark."""
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

    def _crop_tracks(self, tracks, start_sec, end_sec, progress=None):
        """
        Rewrites every track shorter and puts the originals in the Trash as
        one folder named after the take — what turns up there is then a
        recognisable thing rather than eight loose files called Gtr.wav.

        The order matters, because the app can be killed in the middle of it.
        Every new file is written under WRITING_PREFIX first, so nothing is
        replaced until all of them exist; then the originals move aside
        together; then the new files take their names; then the folder of
        originals goes. Die between those last two and the take folder holds
        obviously-unfinished files with the originals in a folder beside it —
        repairable by hand, which is the most a step that moves files can
        promise. A move that fails while the app is alive is undone instead:
        the take goes back to exactly what it was, because a half-cropped take
        behind the words "could not crop" is a take nobody goes looking at.
        """
        take_dir = Path(tracks[0]["file"]).parent
        written = []
        # What the new files really came out as. Tracks of a take may differ in
        # length, so the take is as long as its longest one — and the region
        # that was asked for is not that length: it is not clamped to the file
        # for a draft, and a legacy take with no stored duration is not clamped
        # at all.
        kept_sec = 0.0
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

        aside = _unique_path(take_dir.with_name(f"{take_dir.name} (before crop)"))
        # Every original that reached the aside folder, oldest first. On
        # Windows, renaming a file another process has open raises, and a move
        # that stops half way used to leave some tracks aside, some in place
        # and the take's record pointing at paths that had moved — behind an error
        # message that reads as if nothing had happened.
        moved = []
        try:
            aside.mkdir(parents=True)
            for t in tracks:
                source = Path(t["file"])
                shutil.move(str(source), str(aside / source.name))
                moved.append((aside / source.name, source))
            for t, target in zip(tracks, written):
                os.replace(target, Path(t["file"]))
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

        # The crop itself is already done — the new files are in place — so
        # this can only report the sweep of the originals, never undo it.
        # When even the _deleted fallback cannot move the aside folder, it is
        # still sitting right where this function put it: that path is the
        # one thing worth keeping, since it is how a person finds the
        # originals back.
        gone = move_to_trash(aside, self._recordings_dir)
        result = {
            "ok": True,
            "duration_sec": round(kept_sec, 2),
            "trashed": bool(gone.get("trashed")),
            "location": gone.get("location") if gone.get("ok") else str(aside),
        }
        if not gone.get("ok"):
            result["error"] = gone.get("error")
        return result

    def crop_take(self, folder, take_number, start_sec, end_sec):
        """
        Keeps only [start, end) of a saved take. The take keeps its number,
        its name and its folder: from the outside it is the same take, shorter.
        """
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

        span = self._crop_span(take["duration_sec"], start_sec, end_sec)
        if "error" in span:
            return {"ok": False, "error": span["error"]}

        # Tracks are played through a memmap, and Windows will not let a
        # mapped file be renamed or removed. macOS will, which is exactly
        # how this would have reached a Windows rehearsal unnoticed.
        playing = self._open_tracks
        self.player_close()

        done = self._journaled(
            "crop", f"Cropping “{take.get('name') or f'Take {take_number}'}”",
            folder, take_number,
            lambda progress: self._crop_tracks(
                tracks, span["start"], span["end"], progress=progress),
        )
        if not done["ok"]:
            # Nothing else will put the player back: the take's tracks are
            # what the interface reopens on, and a failed crop leaves them
            # exactly as they were, so its open effect never re-runs. The
            # transport would go on looking alive over a player Python has
            # closed.
            if playing:
                self.player_open(playing)
            return done

        # The markers are read and rewritten in one transaction, now that the
        # crop is done: it takes seconds, and a marker placed on the take
        # meanwhile must move with the audio rather than be written over by
        # a list read before it existed.
        dropped = 0

        def shift(markers):
            nonlocal dropped
            kept = []
            for m in markers:
                if span["start"] <= m["at"] <= span["end"]:
                    kept.append({**m, "at": round(m["at"] - span["start"], 2)})
                else:
                    dropped += 1
            return kept

        # What is in the cloud folder is a copy of a take that no longer
        # exists, so it goes and its record goes with it. The length in
        # the cloud.source_of fingerprint covers the other half of this: a
        # copy already under way can write its record after this line, and
        # a record that still matched the shorter take would suppress its
        # own repair.
        had = _shape_of(take.get("cloud"))
        self._remove_shared(take)
        if (self._lib.edit_markers(folder, take_number, shift) is None
                or self._lib.update_take(
                    folder, take_number, duration_sec=done["duration_sec"]) is None):
            # Deleted while it was being cropped.
            return {"ok": False, "error": "Take not found"}
        self._lib.set_cloud_copy(folder, take_number, None, None)

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
            "trashed": done["trashed"],
            "location": done["location"],
            "markers_dropped": dropped,
            # Present only when the sweep of the originals itself failed —
            # the crop still succeeded, but this is why "trashed" is False
            # and "location" is not the Trash.
            **({"error": done["error"]} if "error" in done else {}),
        }

    def crop_draft(self, temp_dir, tracks, start_sec, end_sec):
        """
        The same cut, one folder over. A take that has been stopped is proper
        .wav already — capture wraps the raw PCM on stop — it just has no
        record in the database yet, so there is nothing here to fix up. The
        files keep their paths, so the caller saves the take as it would have.
        """
        temp_dir = Path(temp_dir)
        if not self._inside_recordings(temp_dir):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        live = [t for t in (tracks or []) if Path(t.get("file", "")).exists()]
        if not live:
            return {"ok": False, "error": "The take has no files left on disk"}

        span = self._crop_span(0, start_sec, end_sec)
        if "error" in span:
            return {"ok": False, "error": span["error"]}

        playing = self._open_tracks
        self.player_close()
        done = self._journaled(
            "crop", "Cropping the take", temp_dir, None,
            lambda progress: self._crop_tracks(
                live, span["start"], span["end"], progress=progress),
        )
        if not done["ok"]:
            # See crop_take: the files the interface would reopen on have not
            # changed, so nothing over there will reopen them.
            if playing:
                self.player_open(playing)
            return done
        return {
            "ok": True,
            "tracks": live,
            "duration_sec": done["duration_sec"],
            "trashed": done["trashed"],
            "location": done["location"],
            **({"error": done["error"]} if "error" in done else {}),
        }

    # ---------- playback ----------

    def player_open(self, tracks):
        # Calls from the interface arrive on their own threads, so opening and
        # closing a player has to be serialised: a close landing in the middle
        # of an open used to leave a half-built stream behind.
        with self._player_lock:
            self.player_close()
            try:
                player = TakePlayer(tracks)
                warning = player.open_output(
                    saved_device(self._config, "output_device", False),
                    self._output_channels(),
                )
            except Exception as e:
                return {"ok": False, "error": str(e)}

            for name, v in self._config.get("volumes", {}).items():
                player.set_volume(name, v)
            player.set_master(self._config.get("master_volume", 1.0))

            self._player = player
            self._open_tracks = tracks
            result = {"ok": True, **player.state()}
            if warning:
                result["warning"] = warning
            return result

    def player_close(self):
        with self._player_lock:
            player, self._player = self._player, None
            self._open_tracks = None
            if player is not None:
                player.close()
            return {"ok": True}

    def player_state(self):
        if self._player is None:
            return {"open": False}
        return {"open": True, **self._player.state()}

    def player_toggle(self):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        if self._player.state()["playing"]:
            self._player.toggle()
            return {"ok": True, **self._player.state()}
        return self.player_play()

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
        if not reopened.get("ok", True):
            return reopened
        return {
            "reopened": True,
            **({"warning": reopened["warning"]} if reopened.get("warning") else {}),
        }

    def player_pause(self):
        if self._player is None:
            return {"ok": True}
        self._player.pause()
        return {"ok": True, **self._player.state()}

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
        return self._reopen_output()

    def set_output_channels(self, channels):
        """Which outputs of the playback card the mix comes out of: a pair
        such as [3, 4], or one output on its own, [5]. Counted from 1."""
        if not _is_output_choice(channels):
            return {"ok": False, "error": f"Not a pair of outputs: {channels}"}
        self._config["output_channels"] = list(channels)
        self._write_config()
        return self._reopen_output()

    def _reopen_output(self):
        with self._player_lock:
            if self._player is None:
                return {"ok": True}

            # Only the stream is reopened. close() would also let go of the
            # take itself, which used to leave the player running on nothing
            # but silence after a device change.
            state = self._player.state()
            try:
                warning = self._player.open_output(
                    saved_device(self._config, "output_device", False),
                    self._output_channels(),
                )
            except Exception as e:
                return {"ok": False, "error": str(e)}
            self._player.seek(state["position"])
            if state["playing"]:
                self._player.play()
            return {"ok": True, **({"warning": warning} if warning else {})}

    # ---------- deleting ----------

    def _inside_recordings(self, path):
        try:
            Path(path).resolve().relative_to(self._recordings_dir.resolve())
            return True
        except ValueError:
            return False

    def delete_take(self, folder, take_number):
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        with self._files_lock:
            target = self._lib.take(folder, take_number)
            if target is None:
                if not self._lib.has(folder):
                    return {"ok": False, "error": "Rehearsal not found"}
                return {"ok": False, "error": "Take not found"}

            # Find the take folder from its files rather than its name: the name
            # could have been changed by hand.
            take_dirs = {
                str(Path(t["file"]).parent)
                for t in target["tracks"]
                if t.get("file")
            }
            result = {"ok": True, "trashed": False, "location": None}
            for d in take_dirs:
                if Path(d).exists() and self._inside_recordings(d):
                    self._release_player_in(d)
                    result = move_to_trash(d, self._recordings_dir)

            # Its copy in the cloud goes the same way: a take deleted here must
            # not stay in the band's folder looking like one worth keeping. A copy
            # still being made cleans up after itself when it finds the take gone.
            self._remove_shared(target)
            left = self._lib.delete_take(folder, take_number)
            return {**result, "takes_left": left}

    def delete_rehearsal(self, folder):
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        if not folder.exists():
            return {"ok": False, "error": "Rehearsal folder not found"}
        if self._session is not None and Path(self._session["folder"]) == folder:
            return {"ok": False, "error": "Cannot delete the rehearsal in progress"}
        with self._files_lock:
            self._release_player_in(folder)
            result = move_to_trash(folder, self._recordings_dir)
            if result.get("ok"):
                # And its copies in the cloud, take by take — only what the app
                # put there, then the folder they were in once nothing is left.
                for take in (self._lib.rehearsal(folder) or {}).get("takes", []):
                    self._remove_shared(take)
                self._lib.forget_rehearsal(folder)
            return result

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
        # would carry the rehearsal's own files away with it.
        target = new_folder.resolve()
        trash = (self._recordings_dir / FALLBACK_TRASH).resolve()
        if _same_folder(target, trash) or _folder_within(target, trash):
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
        "tracks" (the originals) or "both". `progress(fraction, step)`, when
        given, hears how far along it is, weighed in frames of audio.

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

        self._remove_shared(take)

        # From the folder settled on above, not from the setting again: it can
        # be cleared from the interface while this runs.
        target = _cloud_subfolder(cloud, folder)
        base = f"{take_number:02d} - {_safe_name(take.get('name', '') or f'Take {take_number}')}"
        shared = {}

        fmt = normalize_format(self._config.get("cloud_format"))
        # Taken once, before anything is written. A mixdown is seconds long
        # and a fader can move during it; reading the balance again afterwards
        # would fingerprint the copy with a balance it was never rendered
        # with, and the take would then report itself current for a mix that
        # is wrong — for good, since the fingerprint suppresses its own repair.
        volumes = dict(self._config.get("volumes", {}))
        notes = []

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
            res = mixdown(tracks, writing, volumes, progress=stages.part(0))
            if not res["ok"]:
                writing.unlink(missing_ok=True)
                return res
            packed = encode(res["file"], fmt, progress=stages.part(1))
            if packed.get("note"):
                notes.append(packed["note"])
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
                    if packed.get("note") and packed["note"] not in notes:
                        notes.append(packed["note"])
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
            **({"note": " ".join(notes)} if notes else {}),
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
                    "This take is still being copied to the cloud — remove it "
                    "once the copy has finished."}

        result = self._remove_shared(take)
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
        base = self._cloud_base(take_number, take)
        parts = {k: Path(shared[k]) for k in ("mix", "tracks") if shared.get(k)}
        goes_to = {k: p.with_name(base + (p.suffix if k == "mix" else ""))
                   for k, p in parts.items()}
        if (self._copy_busy(folder, take_number)
                or not all(p.exists() and _is_inside(p, cloud) for p in parts.values())):
            if requeue:
                self._queue_copy(folder, take_number, shape, take)
            return False, None
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
        record says, a folder already there under the new name — each take
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

        movable = (
            not self._copy_busy(new_folder) and not self._copy_busy(old_folder)
            and was.is_dir() and not goes_to.exists()
            and all(p.parent == was and p.exists() for t in takes for p in paths(t))
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

    # ---------- putting names right ----------

    def _out_of_line(self, take):
        """
        What of a take does not carry its name: a subset of {"disk",
        "cloud"}. Only what can be renamed counts: a take whose files are in
        more than one folder, or are not on disk, has no folder to rename.
        """
        wrong = set()
        dirs = {Path(t["file"]).parent for t in take["tracks"] if t.get("file")}
        if len(dirs) == 1:
            d = next(iter(dirs))
            if d.is_dir() and not _carries(d.name, _take_dir_name(take["take_number"], take["name"])):
                wrong.add("disk")
        # The cloud part counts only when every recorded copy is where its
        # record says (a folder not mounted, a copy the band deleted: left,
        # and looked at again next open) and one of them has another name.
        shared = take.get("cloud") or {}
        base = self._cloud_base(take["take_number"], take)
        recorded = [(key, Path(shared[key])) for key in ("mix", "tracks") if shared.get(key)]
        if recorded and all(p.exists() for _, p in recorded) and any(
                (p.stem if key == "mix" else p.name) != base for key, p in recorded):
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
                    moved, tracks, error = self._move_take_dir(
                        folder, take_number, take, take["name"])
                if error is not None:
                    return {"renamed": False, "error": error}
                if moved:
                    try:
                        updated = self._lib.update_take(folder, take_number, tracks=tracks)
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
