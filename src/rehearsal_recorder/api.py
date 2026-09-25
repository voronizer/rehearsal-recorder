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
import threading
import time
from pathlib import Path

import sounddevice as sd

from rehearsal_recorder import __version__
from rehearsal_recorder.audio.capture import AudioRecorder
from rehearsal_recorder.audio.drafts import DRAFTS_DIR, describe, draft_dirs, finalize, has_audio
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
    channels_available,
    device_identity,
    recording_formats,
    saved_device,
)
from rehearsal_recorder.audio.monitor import LevelMonitor
from rehearsal_recorder.audio.player import TakePlayer
from rehearsal_recorder.audio.waveform import DEFAULT_BUCKETS, wav_peaks
from rehearsal_recorder import cloud as cloudmod
from rehearsal_recorder import layouts
from rehearsal_recorder.mediaserver import AppServer
from rehearsal_recorder.store import library as librarymod
from rehearsal_recorder.store.db import LibraryUnavailable
from rehearsal_recorder.store.importer import import_all, read_text
from rehearsal_recorder.store.library import Library, as_marker
from rehearsal_recorder.platform_support import (
    FALLBACK_TRASH,
    app_root,
    describe_path_limit,
    move_to_trash,
    safe_filename,
    trash_kind,
)

CONFIG_PATH = Path.home() / ".rehearsal-recorder" / "config.json"
RECORDINGS_ROOT = Path.home() / "RehearsalRecordings"
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


# A take the app named itself, as suggest_take_name writes it.
_UNNAMED_TAKE = re.compile(r"^Take \d+$")
# The attempt number a take name carries: "Polyn 3" -> "Polyn", "3".
_ATTEMPT_NUMBER = re.compile(r"^(.*?)[\s]+(\d+)$")


def _songs_of(takes):
    """
    What was played, as [{"name", "takes", "take_numbers"}] in the order
    things were first played. `take_numbers` is which takes they were, for the
    rehearsal's own overview — so the interface is handed the grouping rather
    than keeping a second copy of the rule below that could drift from it. Nobody types this in: a take inherits the previous one's name with
    the attempt number bumped (see suggest_take_name), so "Polyn", "Polyn 2"
    and "Polyn 3" are three goes at one song, and dropping that trailing
    number is enough to group them.

    Takes the app named itself are left out. "Take ×4" beside a take count
    that already says four is noise, and a rehearsal where nothing was named
    is better off saying nothing at all.
    """
    songs = []
    by_key = {}
    for take in takes:
        name = (take.get("name") or "").strip()
        if not name or _UNNAMED_TAKE.match(name):
            continue
        attempt = _ATTEMPT_NUMBER.match(name)
        base = attempt.group(1).strip() if attempt else name
        if not base:
            continue
        # Case folded only to group: what shows is the first spelling used.
        key = base.casefold()
        if key in by_key:
            by_key[key]["takes"] += 1
            by_key[key]["take_numbers"].append(take.get("take_number"))
        else:
            song = {"name": base, "takes": 1,
                    "take_numbers": [take.get("take_number")]}
            by_key[key] = song
            songs.append(song)
    return songs


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
        self._player = None
        # What the open player was opened with, so a step that has to let go of
        # the files can put back exactly the take that was playing.
        self._open_tracks = None
        self._player_lock = threading.RLock()
        self._window = None

        self._config = self._read_config()
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

    def shutdown(self):
        """The window has closed: stand the publishing worker down instead of
        leaving it to be killed wherever it happens to be."""
        self._cloud_queue.stop()
        if self._library is not None:
            self._library.close()

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
            "samplerate": int(
                self._config.get("samplerate") or DEFAULT_SAMPLERATE
            ),
            "bit_depth": normalize_depth(self._config.get("bit_depth")),
            "supported_bit_depths": list(SUPPORTED_DEPTHS),
            "volumes": self._config.get("volumes", {}),
            "theme": self._config.get("theme", "dark"),
            "ui_scale": self._config.get("ui_scale", 1),
            "output_device_index": saved_device(
                self._config, "output_device", False
            ),
            "output_channels": list(self._output_channels()),
            "cloud_dir": self._config.get("cloud_dir"),
            "cloud_format": normalize_format(self._config.get("cloud_format")),
            "cloud_formats": CLOUD_FORMATS_INFO,
            "auto_publish": bool(self._config.get("auto_publish", False)),
            "auto_publish_what": self._config.get("auto_publish_what") or "mix",
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
        back here rather than being duplicated in the interface."""
        buckets = buckets or DEFAULT_BUCKETS
        result = []
        for t in tracks:
            path = Path(t["file"])
            if not path.exists():
                result.append({
                    "name": t["name"],
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

        found = []
        for idx, d in enumerate(sd.query_devices()):
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
        self._config["tracks"] = [
            {"name": t["name"], **({"stereo": True} if t.get("stereo") else {})}
            for t in tracks
        ]
        self._config["layouts"] = layouts.remember(
            self._config.get("layouts", []),
            device_identity(device_index),
            tracks,
        )

    def load_default_tracks(self):
        """
        The tracks to start the setup screen with, for the card in force.

        Always an answer, never nothing: which of the four cases applies —
        this card's own layout, another card's names, names with no input
        left over, or the first-run pair — belongs in one place, and that
        place is layouts.for_device().
        """
        index = saved_device(self._config, "device", True)
        return {
            "device_index": index,
            "samplerate": self._config.get("samplerate"),
            "bit_depth": normalize_depth(self._config.get("bit_depth")),
            "tracks": layouts.for_device(
                self._config.get("tracks", []),
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
            "error": self._recorder.error,
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

    def session_state(self):
        if self._session is None:
            return {"active": False}
        s = self._session
        takes = self._session_takes()
        return {
            "active": True,
            "name": s["name"],
            "folder": str(s["folder"]),
            "tracks": s["tracks"],
            "takes": takes,
            "songs": _songs_of(takes),
            "next_take_number": s["take_counter"] + 1,
            "next_take_name": self.suggest_take_name(),
            "recording": self._recorder is not None,
            "cloud_queue": self._cloud_queue.states(s["folder"]),
        }

    def suggest_take_name(self, take_number=None):
        """
        A new take is usually another attempt at the same song, so it inherits
        the previous take's name with the counter bumped: "Polyn" -> "Polyn 2".

        take_number is the take being named. Left out, it means the take that
        comes next — which is what the rehearsal screen shows before recording.
        Right after a take it must be passed, otherwise the very first take
        would be offered as "Take 2".
        """
        if self._session is None:
            return "Take 1"
        takes = self._session_takes()
        number = (
            take_number
            if take_number is not None
            else self._session["take_counter"] + 1
        )
        if not takes:
            return f"Take {number}"

        last = takes[-1].get("name", "").strip()
        if not last:
            return f"Take {number}"

        match = re.match(r"^(.*?)[\s]+(\d+)$", last)
        if match:
            return f"{match.group(1)} {int(match.group(2)) + 1}"
        return f"{last} 2"

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

        result = recorder.stop()
        return {
            "ok": True,
            "take_number": take_number,
            "temp_dir": str(temp_dir),
            "duration_sec": result["duration_sec"],
            "tracks": result["tracks"],
            "suggested_name": self.suggest_take_name(take_number),
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
        display_name = (custom_name or "").strip() or f"Take {take_number}"
        take_dir = _unique_path(
            s["folder"] / f"{take_number:02d} - {_safe_name(display_name)}"
        )
        take_dir.mkdir(parents=True, exist_ok=True)

        # The review screen is still playing these very files.
        self._release_player_in(temp_dir)

        moved, undo = self._move_tracks(tracks, take_dir)

        take_info = {
            "take_number": take_number,
            "name": display_name,
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

        result = finalize(draft_dir, r["samplerate"], r["bit_depth"])
        if not result["tracks"]:
            return {"ok": False, "error": "Draft has no audio"}

        take_number = max((t["take_number"] for t in r["takes"]), default=0) + 1
        display_name = (name or "").strip() or f"Recovered take {take_number}"

        take_dir = _unique_path(
            folder / f"{take_number:02d} - {_safe_name(display_name)}"
        )
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
                # Not walked when it is not there to walk.
                "disk_bytes": 0 if r["missing"] else _folder_bytes(r["folder"]),
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

    # ---------- renaming ----------

    def rename_take(self, folder, take_number, new_name):
        """Renames a take and its folder on disk, keeping paths in sync."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        display_name = (new_name or "").strip()
        if not display_name:
            return {"ok": False, "error": "Name cannot be empty"}

        take = self._lib.take(folder, take_number)
        if take is None:
            if not self._lib.has(folder):
                return {"ok": False, "error": "Rehearsal not found"}
            return {"ok": False, "error": "Take not found"}

        # The take's own folder is named after it, so rename that too — the
        # names should still make sense when browsing the disk directly.
        old_dirs = {
            Path(t["file"]).parent for t in take["tracks"] if t.get("file")
        }
        moved = None
        new_tracks = None
        if len(old_dirs) == 1:
            old_dir = old_dirs.pop()
            new_dir = _unique_path(
                folder / f"{take_number:02d} - {_safe_name(display_name)}"
            )
            if old_dir.exists() and old_dir != new_dir:
                # Windows will not rename a folder holding a file the
                # player has mapped, and the rehearsal screen is usually
                # playing the very take it offers to rename. The interface
                # reopens the take from its new path afterwards.
                self._release_player_in(old_dir)
                try:
                    old_dir.rename(new_dir)
                    moved = (old_dir, new_dir)
                    new_tracks = [
                        {**t, "file": str(new_dir / Path(t["file"]).name)}
                        for t in take["tracks"]
                    ]
                except OSError as e:
                    print(f"[rename] take folder: {e}")

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
        self._enqueue_publish(folder, take_number)
        return {"ok": True, "take": updated}

    def rename_rehearsal(self, folder, new_name):
        """Renames a rehearsal and its folder. Its takes' files are kept
        relative to the folder, so they follow it with nothing to rewrite."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

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

        # The copies sit in a cloud subfolder named after the rehearsal, so a
        # new name is a new destination for all of them.
        if self._session is not None and Path(self._session["folder"]) == folder:
            self._enqueue_session_takes()

        return {
            "ok": True,
            "folder": str(folder),
            "name": display_name,
            "takes": self._lib.rehearsal(folder)["takes"],
        }

    # ---------- markers ----------
    #
    # A marker is a spot in a take plus what you wanted to say about it. What
    # one is kept as is the store's rule (library.as_marker); early versions
    # stored a bare number, which the importer turns into a proper marker.

    MARKER_KINDS = librarymod.MARKER_KINDS
    _as_marker = staticmethod(as_marker)

    def add_take_marker(self, folder, take_number, seconds, note="", kind="note"):
        """Markers are placed while listening back: 'this bit worked'."""
        fresh = self._as_marker({"at": seconds, "note": note, "kind": kind})

        def add(markers):
            kept = [m for m in markers if abs(m["at"] - fresh["at"]) > 0.01]
            return sorted(kept + [fresh], key=lambda m: m["at"])

        return self._update_markers(folder, take_number, add)

    def update_take_marker(self, folder, take_number, seconds, note=None, kind=None):
        """Edits the marker at this position: its note, its kind, or both."""
        target = round(float(seconds), 2)

        def edit(markers):
            for m in markers:
                if abs(m["at"] - target) <= 0.01:
                    if note is not None:
                        m["note"] = str(note).strip()[:200]
                    if kind is not None and kind in Api.MARKER_KINDS:
                        m["kind"] = kind
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

    def _crop_tracks(self, tracks, start_sec, end_sec):
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
        for t in tracks:
            source = Path(t["file"])
            target = _writing_path(source)
            res = crop_wav(source, target, start_sec, end_sec)
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

        done = self._crop_tracks(tracks, span["start"], span["end"])
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
        self._remove_shared(take)
        if (self._lib.edit_markers(folder, take_number, shift) is None
                or self._lib.update_take(
                    folder, take_number, duration_sec=done["duration_sec"]) is None):
            # Deleted while it was being cropped.
            return {"ok": False, "error": "Take not found"}
        self._lib.set_cloud_copy(folder, take_number, None, None)

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
        done = self._crop_tracks(live, span["start"], span["end"])
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
        self._player.toggle()
        return {"ok": True, **self._player.state()}

    def player_play(self):
        if self._player is None:
            return {"ok": False, "error": "No take open"}
        self._player.play()
        return {"ok": True, **self._player.state()}

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
        self._release_player_in(folder)
        result = move_to_trash(folder, self._recordings_dir)
        if result.get("ok"):
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
        if take.get("cloud_skip"):
            return
        if not self._config.get("auto_publish") and not take.get("cloud_send"):
            return
        self._cloud_queue.enqueue(str(folder), take_number)

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

    def _publish_step(self, folder, take_number):
        """
        One take, on the publishing thread. Skips a take that is already in
        the cloud folder in the shape the settings ask for, so a burst of
        requests costs one mixdown, not several.
        """
        what = self._config.get("auto_publish_what") or "mix"
        take = self._lib.take(folder, take_number)
        if take is None:
            return
        # Asked again here, not only when queued: the setting or the take's
        # own answer can have changed while it waited.
        if take.get("cloud_skip"):
            return
        if not self._config.get("auto_publish") and not take.get("cloud_send"):
            return
        fmt = normalize_format(self._config.get("cloud_format"))
        target = self._cloud_target(folder)
        if cloudmod.is_current(take, what, self._config.get("volumes", {}), fmt, target):
            return
        try:
            res = self.share_take(str(folder), take_number, what)
        except Exception as e:
            # A sync folder that vanishes mid-write raises instead of
            # returning {"ok": False} — that must still land as a recorded,
            # retryable failure, not a silently stalled take.
            self._record_cloud_error(folder, take_number, str(e))
            return
        if not res.get("ok"):
            self._record_cloud_error(
                folder, take_number, res.get("error") or "Could not copy the take"
            )

    def _record_cloud_error(self, folder, take_number, message):
        """Why a take is not in the cloud folder, kept with the take."""
        self._lib.set_cloud_error(folder, take_number, message)

    def share_take(self, folder, take_number, what="mix"):
        """
        Copies one take into the cloud folder. what: "mix" (one stereo file),
        "tracks" (the originals) or "both".

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

        # Every copy is written beside its real name and moved onto it when it
        # is whole, the same way config.json is — see WRITING_PREFIX.
        if what in ("mix", "both"):
            writing = _writing_path(target / f"{base}.wav")
            res = mixdown(tracks, writing, volumes)
            if not res["ok"]:
                writing.unlink(missing_ok=True)
                return res
            packed = encode(res["file"], fmt)
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
            try:
                dest.mkdir(parents=True, exist_ok=True)
                for t in tracks:
                    source = Path(t["file"])
                    writing = _writing_path(dest / source.name)
                    shutil.copy2(source, writing)
                    packed = encode(writing, fmt)
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
            shared["tracks_format"] = fmt

        shared["source"] = cloudmod.source_of(
            take, what, volumes, fmt, _safe_name(folder.name)
        )
        # Only the take's cloud fields are written, so a rename that landed
        # while the copy was being made is kept; a copy that succeeded settles
        # whatever went wrong last time.
        if not self._lib.set_cloud_copy(folder, take_number, shared, cloud):
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
        return {"removed": removed, "trashed": trashed if removed else False}
