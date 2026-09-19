"""
The Python side of the bridge between the window (pywebview) and the audio layer.

Model: one "rehearsal" (start_rehearsal) lives as long as the app is open and
holds several "takes" (start_take / stop_take / keep_take / discard_take).
Until a take is saved it is written into the rehearsal's own drafts folder,
next to session.json rather than somewhere in a system temp directory — so it
is visible and findable if something goes wrong. Saving moves the files into
a permanent take folder inside the same rehearsal; discarding deletes them.

The recordings folder is configurable (Settings). Point it at a cloud
client's folder and the recordings sync themselves.
"""

import json
import re
import shutil
import threading
import time
from pathlib import Path

import sounddevice as sd

from audio.capture import AudioRecorder
from audio.drafts import DRAFTS_DIR, describe, draft_dirs, finalize, has_audio
from audio.encode import (
    CLOUD_FORMATS_INFO,
    available as encoder_available,
    encode,
    missing_encoder_hint,
    normalize_format,
)
from audio.format import (
    DEFAULT_DEPTH,
    LEGACY_DEPTH,
    SUPPORTED_DEPTHS,
    bytes_per_sample,
    normalize_depth,
)
from audio.mixdown import mixdown
from audio.devices import recording_formats
from audio.monitor import LevelMonitor
from audio.player import TakePlayer
from audio.waveform import DEFAULT_BUCKETS, wav_peaks
from mediaserver import AppServer
from platform_support import (
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

# What a fresh install records at until Settings says otherwise.
DEFAULT_SAMPLERATE = 44100


def _safe_name(name):
    """Legal on macOS, Windows and Linux alike — see platform_support.py."""
    return safe_filename(name or "", fallback="Untitled")


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


def _is_empty_rehearsal(folder):
    """
    A rehearsal that produced nothing: no saved takes and no audio on disk.
    Such a folder can be removed without asking — there is nothing to lose.

    A folder holding a draft (the app died mid-take) is deliberately kept:
    that draft is a real recording, just not accepted yet. Note that a draft
    is raw PCM, not .wav, which is exactly why has_audio() looks for both.
    """
    folder = Path(folder)
    meta_path = folder / "session.json"
    if not meta_path.exists():
        return False
    try:
        meta = json.loads(meta_path.read_text())
    except Exception:
        return False
    if meta.get("takes"):
        return False
    return not has_audio(folder)


def _is_inside(path, root):
    try:
        Path(path).resolve().relative_to(Path(root).resolve())
        return True
    except ValueError:
        return False


class Api:
    def __init__(self, server_port=0):
        self._recorder = None
        self._recorder_take_number = None
        self._recorder_temp_dir = None
        self._session = None
        self._monitor = None
        self._player = None
        self._player_lock = threading.RLock()
        self._window = None

        self._config = self._read_config()
        self._recordings_dir = Path(
            self._config.get("recordings_dir") or RECORDINGS_ROOT
        )
        self._recordings_dir.mkdir(parents=True, exist_ok=True)

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
        if not CONFIG_PATH.exists():
            return {}
        try:
            data = json.loads(CONFIG_PATH.read_text())
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _write_config(self):
        CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_PATH.write_text(json.dumps(self._config, ensure_ascii=False, indent=2))

    def get_settings(self):
        return {
            "recordings_dir": str(self._recordings_dir),
            "default_recordings_dir": str(RECORDINGS_ROOT),
            "device_index": self._config.get("device_index"),
            "samplerate": int(
                self._config.get("samplerate") or DEFAULT_SAMPLERATE
            ),
            "bit_depth": normalize_depth(self._config.get("bit_depth")),
            "supported_bit_depths": list(SUPPORTED_DEPTHS),
            "tracks": self._config.get("tracks", []),
            "volumes": self._config.get("volumes", {}),
            "theme": self._config.get("theme", "dark"),
            "ui_scale": self._config.get("ui_scale", 1),
            "output_device_index": self._config.get("output_device_index"),
            "cloud_dir": self._config.get("cloud_dir"),
            "cloud_format": normalize_format(self._config.get("cloud_format")),
            "cloud_formats": CLOUD_FORMATS_INFO,
            "encoder": encoder_available(),
            "encoder_hint": (
                None if encoder_available() else missing_encoder_hint()
            ),
            "trash_kind": trash_kind(),
            "fallback_trash": FALLBACK_TRASH,
            "path_warning": describe_path_limit(self._recordings_dir),
            "server_url": self._server.base_url,
            "config_path": str(CONFIG_PATH),
        }

    def set_recordings_dir(self, path):
        folder = Path(path).expanduser()
        if not folder.is_absolute():
            return {"ok": False, "error": "A full path is required"}
        try:
            folder.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return {"ok": False, "error": f"Could not open the folder: {e}"}

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
        current = self._config.get("volumes", {})
        current.update(volumes or {})
        self._config["volumes"] = current
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

    def take_media(self, tracks, buckets=DEFAULT_BUCKETS):
        """Everything the player needs about a take in one call: each track's
        address, its length in samples and its waveform."""
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
                peaks, frames, samplerate = wav_peaks(path, buckets)
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
        and the names alone are identical. Without saying which is which, the
        list reads as five copies of the same card. macOS has only CoreAudio,
        so the label is left off there.
        """
        try:
            return [h["name"] for h in sd.query_hostapis()]
        except Exception:
            return []

    def _describe_devices(self, want_input):
        apis = self._host_api_names()
        many = len(apis) > 1
        key = "max_input_channels" if want_input else "max_output_channels"

        found = []
        for idx, d in enumerate(sd.query_devices()):
            if d.get(key, 0) <= 0:
                continue
            api = apis[d["hostapi"]] if d.get("hostapi", -1) < len(apis) else ""
            found.append({
                "index": idx,
                "name": d["name"],
                "host_api": api if many else "",
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
        self._config["device_index"] = device_index
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
            return {
                "ok": True,
                "formats": recording_formats(device_index, int(channel_count)),
            }
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def list_output_devices(self):
        return self._describe_devices(want_input=False)

    def load_default_tracks(self):
        if not self._config.get("tracks"):
            return None
        return {
            "device_index": self._config.get("device_index"),
            "samplerate": self._config.get("samplerate"),
            "bit_depth": normalize_depth(self._config.get("bit_depth")),
            "tracks": self._config.get("tracks", []),
        }

    def save_default_tracks(self, config):
        for key in ("device_index", "samplerate", "bit_depth", "tracks"):
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

    def disk_estimate(self, track_count, samplerate, bit_depth=LEGACY_DEPTH):
        """How much recording time fits in the free space."""
        try:
            free = shutil.disk_usage(self._recordings_dir).free
        except OSError as e:
            return {"ok": False, "error": str(e)}

        per_sec = max(
            1,
            int(track_count) * int(samplerate) * bytes_per_sample(bit_depth),
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
        track_count = len(s["tracks"]) if s else 1
        samplerate = s["samplerate"] if s else 48000
        estimate = self.disk_estimate(
            track_count, samplerate, s.get("bit_depth", LEGACY_DEPTH) if s else LEGACY_DEPTH
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
        bit_depth = normalize_depth(bit_depth)

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
            "takes": [],
        }
        self._save_session_meta()
        return {"ok": True, "folder": str(folder)}

    def _save_session_meta(self):
        """Writes session.json into the rehearsal folder so History can read
        the take list even after a restart."""
        s = self._session
        self._write_meta(
            s["folder"],
            {
                "name": s["name"],
                "created_at": s["created_at"],
                "samplerate": s["samplerate"],
                "bit_depth": s.get("bit_depth", LEGACY_DEPTH),
                "tracks": s["tracks"],
                "takes": s["takes"],
            },
        )

    @staticmethod
    def _write_meta(folder, meta):
        (Path(folder) / "session.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2)
        )

    @staticmethod
    def _read_meta(folder):
        path = Path(folder) / "session.json"
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text())
        except Exception:
            return None

    def session_state(self):
        if self._session is None:
            return {"active": False}
        s = self._session
        return {
            "active": True,
            "name": s["name"],
            "folder": str(s["folder"]),
            "tracks": s["tracks"],
            "takes": s["takes"],
            "next_take_number": s["take_counter"] + 1,
            "next_take_name": self.suggest_take_name(),
            "recording": self._recorder is not None,
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
        takes = self._session["takes"]
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
        take_count = len(self._session["takes"])
        self._session = None

        # A rehearsal where nothing was saved should not leave a folder behind.
        removed = False
        if _is_empty_rehearsal(folder):
            shutil.rmtree(folder, ignore_errors=True)
            removed = True

        return {
            "ok": True,
            "folder": str(folder),
            "take_count": take_count,
            "folder_removed": removed,
        }

    def cleanup_empty_rehearsals(self):
        """Removes rehearsal folders without a single saved take and without
        any audio (including unfinished drafts)."""
        if not self._recordings_dir.exists():
            return {"ok": True, "removed": 0}

        removed = 0
        for folder in list(self._recordings_dir.iterdir()):
            if not folder.is_dir():
                continue
            if self._session is not None and Path(self._session["folder"]) == folder:
                continue
            if _is_empty_rehearsal(folder):
                shutil.rmtree(folder, ignore_errors=True)
                removed += 1
        return {"ok": True, "removed": removed}

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
        self, take_number, temp_dir, custom_name, duration_sec, tracks, markers=None
    ):
        """
        tracks: [{"name":.., "file": <path in the drafts folder>}, ...] as
        returned by stop_take(). Moves them into the rehearsal folder and adds
        the take to the saved list.

        markers: anything marked while listening on the review screen. They
        are passed in rather than saved as they are placed, because until the
        take is kept there is nothing on disk to attach them to.
        """
        if self._session is None:
            return {"ok": False, "error": "No rehearsal in progress"}

        s = self._session
        display_name = (custom_name or "").strip() or f"Take {take_number}"
        take_dir = _unique_path(
            s["folder"] / f"{take_number:02d} - {_safe_name(display_name)}"
        )
        take_dir.mkdir(parents=True, exist_ok=True)

        moved = []
        for t in tracks:
            src = Path(t["file"])
            dst = take_dir / src.name
            if src.exists():
                shutil.move(str(src), str(dst))
            moved.append({"name": t["name"], "file": str(dst)})

        shutil.rmtree(temp_dir, ignore_errors=True)
        self._cleanup_drafts_dir(temp_dir)

        take_info = {
            "take_number": take_number,
            "name": display_name,
            "duration_sec": duration_sec,
            "tracks": moved,
            "markers": [self._as_marker(m) for m in (markers or [])],
        }
        s["takes"].append(take_info)
        self._save_session_meta()
        return {"ok": True, "take": take_info}

    def discard_take(self, temp_dir):
        shutil.rmtree(temp_dir, ignore_errors=True)
        self._cleanup_drafts_dir(temp_dir)
        return {"ok": True}

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
        if not self._recordings_dir.exists():
            return []

        found = []
        for folder in sorted(self._recordings_dir.iterdir()):
            if not folder.is_dir():
                continue
            meta = self._read_meta(folder)
            if meta is None:
                continue
            samplerate = meta.get("samplerate", 48000)
            depth = meta.get("bit_depth", LEGACY_DEPTH)
            for take_dir in draft_dirs(folder):
                info = describe(take_dir, samplerate, depth)
                info["rehearsal_folder"] = str(folder)
                info["rehearsal_name"] = meta.get("name", folder.name)
                info["created_at"] = meta.get("created_at", "")
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
        meta = self._read_meta(folder)
        if meta is None:
            return {"ok": False, "error": "Rehearsal not found"}

        samplerate = meta.get("samplerate", 48000)
        result = finalize(draft_dir, samplerate, meta.get("bit_depth", LEGACY_DEPTH))
        if not result["tracks"]:
            return {"ok": False, "error": "Draft has no audio"}

        takes = meta.get("takes", [])
        take_number = max([t.get("take_number", 0) for t in takes], default=0) + 1
        display_name = (name or "").strip() or f"Recovered take {take_number}"

        take_dir = _unique_path(
            folder / f"{take_number:02d} - {_safe_name(display_name)}"
        )
        take_dir.mkdir(parents=True, exist_ok=True)

        moved = []
        for t in result["tracks"]:
            src = Path(t["file"])
            dst = take_dir / src.name
            if src.exists():
                shutil.move(str(src), str(dst))
            moved.append({"name": t["name"], "file": str(dst)})

        shutil.rmtree(draft_dir, ignore_errors=True)
        self._cleanup_drafts_dir(draft_dir)

        take_info = {
            "take_number": take_number,
            "name": display_name,
            "duration_sec": result["duration_sec"],
            "tracks": moved,
            # A rescued take was never listened to, so it has no marks yet.
            "markers": [],
        }
        takes.append(take_info)
        meta["takes"] = takes
        self._write_meta(folder, meta)

        if self._session is not None and Path(self._session["folder"]) == folder:
            self._session["takes"] = takes
            self._session["take_counter"] = max(
                self._session["take_counter"], take_number
            )

        return {"ok": True, "take": take_info, "folder": str(folder)}

    def discard_draft(self, draft_dir):
        draft_dir = Path(draft_dir)
        if not self._inside_recordings(draft_dir):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        result = move_to_trash(draft_dir, self._recordings_dir)
        self._cleanup_drafts_dir(draft_dir)
        return result

    # ---------- history ----------

    def list_rehearsals(self):
        """All rehearsals on disk (by session.json in each folder), newest
        first. Rehearsals recorded before this feature existed (no
        session.json) do not show up."""
        if not self._recordings_dir.exists():
            return []

        self.cleanup_empty_rehearsals()

        items = []
        for folder in self._recordings_dir.iterdir():
            if not folder.is_dir():
                continue
            meta = self._read_meta(folder)
            if meta is None:
                continue
            takes = meta.get("takes", [])
            items.append({
                "folder": str(folder),
                "name": meta.get("name", folder.name),
                "created_at": meta.get("created_at", ""),
                "take_count": len(takes),
                "total_duration_sec": sum(t.get("duration_sec", 0) for t in takes),
            })

        items.sort(key=lambda x: x["created_at"], reverse=True)
        return items

    def get_rehearsal(self, folder):
        meta = self._read_meta(folder)
        if meta is None:
            return {"ok": False, "error": "Rehearsal not found"}
        takes = meta.get("takes", [])
        for take in takes:
            take["markers"] = self._markers_of(take)
        return {
            "ok": True,
            "folder": str(folder),
            "name": meta.get("name", ""),
            "created_at": meta.get("created_at", ""),
            "takes": takes,
        }

    # ---------- renaming ----------

    def rename_take(self, folder, take_number, new_name):
        """Renames a take and its folder on disk, keeping paths in sync."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        meta = self._read_meta(folder)
        if meta is None:
            return {"ok": False, "error": "Rehearsal not found"}

        display_name = (new_name or "").strip()
        if not display_name:
            return {"ok": False, "error": "Name cannot be empty"}

        takes = meta.get("takes", [])
        take = next((t for t in takes if t.get("take_number") == take_number), None)
        if take is None:
            return {"ok": False, "error": "Take not found"}

        take["name"] = display_name

        # The take's own folder is named after it, so rename that too — the
        # names should still make sense when browsing the disk directly.
        old_dirs = {
            Path(t["file"]).parent for t in take.get("tracks", []) if t.get("file")
        }
        if len(old_dirs) == 1:
            old_dir = old_dirs.pop()
            new_dir = _unique_path(
                folder / f"{take_number:02d} - {_safe_name(display_name)}"
            )
            if old_dir.exists() and old_dir != new_dir:
                try:
                    old_dir.rename(new_dir)
                    for t in take.get("tracks", []):
                        t["file"] = str(new_dir / Path(t["file"]).name)
                except OSError as e:
                    print(f"[rename] take folder: {e}")

        self._write_meta(folder, meta)
        if self._session is not None and Path(self._session["folder"]) == folder:
            self._session["takes"] = takes

        return {"ok": True, "take": take}

    def rename_rehearsal(self, folder, new_name):
        """Renames a rehearsal and its folder, rewriting the stored track paths."""
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}

        meta = self._read_meta(folder)
        if meta is None:
            return {"ok": False, "error": "Rehearsal not found"}

        display_name = (new_name or "").strip()
        if not display_name:
            return {"ok": False, "error": "Name cannot be empty"}

        meta["name"] = display_name
        suffix = _timestamp_suffix(meta.get("created_at", ""))
        original = folder
        new_folder = _unique_path(
            self._recordings_dir / f"{_safe_name(display_name)} - {suffix}"
        )

        if new_folder != original:
            try:
                original.rename(new_folder)
            except OSError as e:
                return {"ok": False, "error": f"Could not rename the folder: {e}"}

            # Stored paths are absolute, so re-point them at the new folder.
            for take in meta.get("takes", []):
                for t in take.get("tracks", []):
                    old = Path(t["file"])
                    try:
                        t["file"] = str(new_folder / old.relative_to(original))
                    except ValueError:
                        pass
            folder = new_folder

        self._write_meta(folder, meta)

        # Only the rehearsal actually being renamed touches the live session —
        # renaming an old one from history must leave it alone.
        if self._session is not None and Path(self._session["folder"]) == original:
            self._session["folder"] = folder
            self._session["name"] = display_name
            self._session["takes"] = meta.get("takes", [])

        return {
            "ok": True,
            "folder": str(folder),
            "name": display_name,
            "takes": meta.get("takes", []),
        }

    # ---------- markers ----------
    #
    # A marker is a spot in a take plus what you wanted to say about it. Early
    # versions stored a bare number, so anything read from disk is normalised
    # first — old rehearsals keep working, they just have empty notes.

    MARKER_KINDS = ("note", "good", "issue", "redo")

    @staticmethod
    def _as_marker(value):
        if isinstance(value, dict):
            at = round(float(value.get("at", 0.0)), 2)
            kind = value.get("kind", "note")
            note = str(value.get("note", "")).strip()[:200]
        else:
            at = round(float(value), 2)
            kind, note = "note", ""
        if kind not in Api.MARKER_KINDS:
            kind = "note"
        return {"at": at, "kind": kind, "note": note}

    @staticmethod
    def _markers_of(take):
        return sorted(
            (Api._as_marker(m) for m in take.get("markers", [])),
            key=lambda m: m["at"],
        )

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

        meta = self._read_meta(folder)
        if meta is None:
            return {"ok": False, "error": "Rehearsal not found"}

        takes = meta.get("takes", [])
        take = next((t for t in takes if t.get("take_number") == take_number), None)
        if take is None:
            return {"ok": False, "error": "Take not found"}

        take["markers"] = fn(self._markers_of(take))
        self._write_meta(folder, meta)

        if self._session is not None and Path(self._session["folder"]) == folder:
            self._session["takes"] = takes

        return {"ok": True, "markers": take["markers"]}

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
                    self._config.get("output_device_index")
                )
            except Exception as e:
                return {"ok": False, "error": str(e)}

            for name, v in self._config.get("volumes", {}).items():
                player.set_volume(name, v)

            self._player = player
            result = {"ok": True, **player.state()}
            if warning:
                result["warning"] = warning
            return result

    def player_close(self):
        with self._player_lock:
            player, self._player = self._player, None
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

    def set_output_device(self, device_index):
        """Switching the output applies immediately, even mid-take."""
        self._config["output_device_index"] = device_index
        self._write_config()

        with self._player_lock:
            if self._player is None:
                return {"ok": True}

            # Only the stream is reopened. close() would also let go of the
            # take itself, which used to leave the player running on nothing
            # but silence after a device change.
            state = self._player.state()
            try:
                warning = self._player.open_output(device_index)
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

        meta = self._read_meta(folder)
        if meta is None:
            return {"ok": False, "error": "Rehearsal not found"}

        takes = meta.get("takes", [])
        target = next((t for t in takes if t.get("take_number") == take_number), None)
        if target is None:
            return {"ok": False, "error": "Take not found"}

        # Find the take folder from its files rather than its name: the name
        # could have been changed by hand.
        take_dirs = {
            str(Path(t["file"]).parent)
            for t in target.get("tracks", [])
            if t.get("file")
        }
        result = {"ok": True, "trashed": False, "location": None}
        for d in take_dirs:
            if Path(d).exists() and self._inside_recordings(d):
                result = move_to_trash(d, self._recordings_dir)

        meta["takes"] = [t for t in takes if t.get("take_number") != take_number]
        self._write_meta(folder, meta)

        if self._session is not None and Path(self._session["folder"]) == folder:
            self._session["takes"] = meta["takes"]

        return {**result, "takes_left": len(meta["takes"])}

    def delete_rehearsal(self, folder):
        folder = Path(folder)
        if not self._inside_recordings(folder):
            return {"ok": False, "error": "Folder is outside the recordings directory"}
        if not folder.exists():
            return {"ok": False, "error": "Rehearsal folder not found"}
        if self._session is not None and Path(self._session["folder"]) == folder:
            return {"ok": False, "error": "Cannot delete the rehearsal in progress"}
        return move_to_trash(folder, self._recordings_dir)


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
        return {"ok": True, "cloud_format": chosen, "encoder": encoder_available()}

    def clear_cloud_dir(self):
        self._config.pop("cloud_dir", None)
        self._write_config()
        return {"ok": True}

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
        meta = self._read_meta(folder)
        if meta is None:
            return {"ok": False, "error": "Rehearsal not found"}
        take = next(
            (t for t in meta.get("takes", []) if t.get("take_number") == take_number),
            None,
        )
        if take is None:
            return {"ok": False, "error": "Take not found"}

        tracks = [t for t in take.get("tracks", []) if Path(t.get("file", "")).exists()]
        if not tracks:
            return {"ok": False, "error": "The take has no files left on disk"}

        self._remove_shared(take)

        target = cloud / _safe_name(folder.name)
        base = f"{take_number:02d} - {_safe_name(take.get('name', '') or f'Take {take_number}')}"
        shared = {}

        fmt = normalize_format(self._config.get("cloud_format"))
        notes = []

        if what in ("mix", "both"):
            res = mixdown(
                tracks, target / f"{base}.wav", self._config.get("volumes", {})
            )
            if not res["ok"]:
                return res
            packed = encode(res["file"], fmt)
            if packed.get("note"):
                notes.append(packed["note"])
            shared["mix"] = packed["file"]
            shared["mix_format"] = packed["format"]
            shared["gain"] = res["gain"]

        if what in ("tracks", "both"):
            dest = target / base
            try:
                dest.mkdir(parents=True, exist_ok=True)
                for t in tracks:
                    copy = dest / Path(t["file"]).name
                    shutil.copy2(t["file"], copy)
                    packed = encode(copy, fmt)
                    if packed.get("note") and packed["note"] not in notes:
                        notes.append(packed["note"])
            except OSError as e:
                return {"ok": False, "error": f"Could not copy the tracks: {e}"}
            shared["tracks"] = str(dest)
            shared["tracks_format"] = fmt

        take["cloud"] = shared
        self._write_meta(folder, meta)
        if self._session is not None and Path(self._session["folder"]) == folder:
            self._session["takes"] = meta.get("takes", [])

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
        meta = self._read_meta(folder)
        if meta is None:
            return {"ok": False, "error": "Rehearsal not found"}
        take = next(
            (t for t in meta.get("takes", []) if t.get("take_number") == take_number),
            None,
        )
        if take is None:
            return {"ok": False, "error": "Take not found"}

        result = self._remove_shared(take)
        take["cloud"] = {}
        self._write_meta(folder, meta)
        if self._session is not None and Path(self._session["folder"]) == folder:
            self._session["takes"] = meta.get("takes", [])
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
