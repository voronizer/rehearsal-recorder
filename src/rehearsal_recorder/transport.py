"""Shared application transport; no MIDI or UI dependencies.

Calls run on the caller's worker thread. GUI calls wait at a reentrant gate;
remote calls fail fast rather than queuing stale toggles.
State reads never wait for audio finalisation or library writes.
"""
from functools import wraps
import threading
import hashlib
import json
import math
import copy
import logging
from pathlib import Path
from collections import deque
from .control import ControlAPI

log = logging.getLogger(__name__)


def serialised(method):
    @wraps(method)
    def call(api, *args, **kwargs):
        def work():
            result = method(api, *args, **kwargs)
            if method.__name__ in ("keep_take", "recover_draft", "discard_draft") and result.get("ok"):
                index = 1 if method.__name__ == "keep_take" else 0
                key = "temp_dir" if method.__name__ == "keep_take" else "draft_dir"
                path = kwargs.get(key, args[index] if len(args) > index else None)
                api._transport.saved(path)
            return result
        return api._transport.run(work, wait=True)
    return call


class Transport(ControlAPI):
    def __init__(self, api):
        self.api = api
        self._gate = threading.RLock()
        self._busy = False
        self._saving = False
        self.error = None
        self.last_error = None
        self.pending_take = None
        self.failed_take_path = None
        self.playback_take_name = None
        self.playback_take_number = None
        self.recording_name = None
        self.recording_go = None
        self._keep_name = None
        self.playback_muted = False
        self._updates_lock = threading.RLock()
        self._revision = 0
        self._snapshot_signature = None
        self._sequence = 0
        self._events = deque(maxlen=64)

    def run(self, work, *, wait=False):
        # GUI calls wait; remote toggles must never execute later unexpectedly.
        # Lock order is action gate, file lock, player lock, stream lock.
        if not self._gate.acquire(blocking=wait):
            return {"ok": False, "result": "busy", "error": "Still saving, or busy with another command"}
        outer = not self._busy
        if outer:
            self._busy = True
        try:
            return work()
        finally:
            if outer:
                self._busy = False
            self._gate.release()

    @property
    def saving(self):
        return self._saving

    def saved(self, path):
        if self.failed_take_path == str(path):
            self.failed_take_path = None
            self.error = None
        if self.pending_take and self.pending_take["temp_dir"] == str(path):
            self.pending_take = None
            self.recording_name = self.recording_go = self._keep_name = None
            self.error = None
        elif self.pending_take is None and self.failed_take_path is None:
            self.recording_name = self.recording_go = self._keep_name = None
            self.error = None

    def _selected_take(self):
        api = self.api
        if api._session is None or api._library_error:
            return None
        all_takes = api._session_takes()
        selected = next((t for t in all_takes if t["take_number"] == self.playback_take_number), None)
        if selected is not None: return selected
        song = api._next_take()["song"]
        takes = [t for t in all_takes if t.get("song") == song]
        return takes[-1] if takes else None

    def state(self):
        api = self.api
        selected = self._selected_take()
        player = api.player_state()
        owns_player = bool(selected and player.get("open") and api._open_tracks == selected["tracks"])
        # State polling never waits for work and cannot clear an error while
        # another thread is publishing the unfinished take associated with it.
        if self._gate.acquire(blocking=False):
            try:
                if self.error and not self.pending_take and not (self.failed_take_path and Path(self.failed_take_path).exists()):
                    self.error = None
                    self.failed_take_path = None
            finally:
                self._gate.release()
        next_name = (api._next_take()["song"] or api.suggest_take_name()) if api._session and not api._library_error else None
        if self._saving or api._stopping:
            state = "saving"
        elif api._recorder is not None:
            state = "recording"
        elif self.pending_take and not self.error:
            state = "unavailable"
        elif self.error:
            state = "error"
        elif owns_player and player.get("playing"):
            state = "playing"
        elif api._session is None or api._library_error:
            state = "unavailable"
        else:
            state = "ready"
        # A click take's from its count-in's end, as the screen's clock counts.
        elapsed = api._take_elapsed() if api._recorder else player.get("position", 0) if owns_player else 0
        return {"elapsed": elapsed, "state": state, "busy": self._busy, "rehearsal_active": api._session is not None,
                "error": self.error, "pending_take": self.pending_take,
                "take_number": api._recorder_take_number,
                "take_name": self.recording_name, "take_go": self.recording_go,
                "playback_take_number": selected["take_number"] if selected else 0,
                "playback_take_name": (selected.get("song") or selected.get("name")) if selected else None,
                "playback_open": owns_player,
                "master_volume": player.get("master", self.api._config.get("master_volume", 1.0)),
                "playback_muted": self.playback_muted,
                "next_take_name": next_name,
                "last_error": self.last_error}

    def snapshot(self):
        state = copy.deepcopy(self.state())
        if (self.api._session is None and not self.api._library_error and
                not self.pending_take and not self.error and state["state"] == "unavailable"):
            state["state"] = "idle"
        state["readiness"] = ("busy" if self._busy or state["state"] == "saving" else
                              "attention" if state["state"] in ("error", "unavailable") else
                              "idle" if state["state"] == "idle" else "ready")
        state["selection_reference"] = self.selection_reference()
        # Playback position changes do not invalidate selection or UI metadata.
        signature = json.dumps({k:v for k,v in state.items() if k not in ("elapsed", "busy")},
                               sort_keys=True, default=str)
        with self._updates_lock:
            if signature != self._snapshot_signature:
                self._revision += 1
                self._snapshot_signature = signature
            state["revision"] = self._revision
            state["action_sequence"] = self._sequence
            state["events"] = [dict(e) for e in self._events]
        return state

    def controller_state(self):
        """Compatibility alias for callers of the original transport API."""
        return self.snapshot()

    @staticmethod
    def _identity(value):
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    def selection_reference(self):
        api = self.api
        selected = self._selected_take()
        if selected is None or api._session is None:
            return None
        folder = str(api._session["folder"])
        record = api._lib.take_record(folder, selected["take_number"])
        if record is None: return None
        return self._identity((folder, selected["take_number"], record["rehearsal"]["id"],
                record["rehearsal"]["created_at"], record["take"]["id"],
                tuple(t["file"] for t in selected["tracks"])))

    def _record_action(self, action, result):
        with self._updates_lock:
            self._sequence += 1
            event = {"sequence": self._sequence, "action": action,
                     "ok": bool(result.get("ok")), "error": result.get("error"),
                     "result": result.get("result"), "undo": result.get("undo")}
            self._events.append(event)

    def flush_settings(self):
        self.api._write_config()

    def _song_order(self):
        api=self.api
        choices=api.song_choices()
        order=[s for s in (api._session.get("set") or {}).get("songs",[]) if isinstance(s,str)]
        order += [s["song"] for group in ("here","other") for s in choices[group]]
        current=api._next_take()["song"]
        if current:order.append(current)
        return list(dict.fromkeys(order))

    def catalog(self):
        api = self.api
        if api._session is None or api._library_error or self.pending_take or self.error:
            return None
        songs = tuple(self._song_order())
        song = api._next_take()["song"]
        takes = [t for t in api._session_takes() if t.get("song") == song]
        numbers = tuple(t["take_number"] for t in takes)
        selected = self._selected_take()
        selected_number = selected["take_number"] if selected else None
        identity = self._identity((str(api._session["folder"]), song, songs,
                    tuple((t["take_number"], tuple(x["file"] for x in t["tracks"])) for t in takes),
                    selected_number))
        return {"identity": identity, "songs": songs, "takes": numbers,
                "selected_song": song, "selected_take": selected_number}

    def _select(self, action, target):
        # State may have changed since an adapter accepted/queued the request.
        if self.api._recorder is not None or self.pending_take or self._saving:
            return {"ok": False, "result": "busy", "error": "Finish the take first"}
        current = self.catalog()
        if not isinstance(target, dict) or not current or target.get("catalog") != current["identity"]:
            return {"ok": False, "result": "unavailable", "error": "Selection list changed; browse again"}
        if action == "select_take" and type(target.get("take")) is int and target["take"] in current["takes"]:
            take = next(t for t in self.api._session_takes() if t["take_number"] == target["take"])
            return self.api.player_open(take["tracks"])
        if action == "select_song" and target.get("song") in current["songs"]:
            if target["song"] == current["selected_song"]:
                return {"ok": True, "unchanged": True}
            paused = self.api.player_pause()
            if not paused.get("ok"): return paused
            self.api.player_close()
            return self.api.set_next_take_name(target["song"])
        return {"ok": False, "result": "unavailable", "error": "Invalid selection"}

    def _start_rehearsal(self, parameters):
        api = self.api
        if api._session is not None:
            return {"ok": False, "result": "unavailable", "error": "A rehearsal is already open"}
        if self.pending_take or self.error or api._library_error:
            return {"ok": False, "result": "unavailable", "error": "Resolve recorder recovery/library errors first"}
        if parameters:
            required = {"name", "device_index", "samplerate", "tracks"}
            if not required <= parameters.keys() or parameters.keys() - (required | {"bit_depth", "set_id", "lineup"}):
                return {"ok": False, "result": "unavailable", "error": "Invalid rehearsal setup"}
            return api.start_rehearsal(**parameters)
        settings, layout = api.get_settings(), api.load_default_tracks()
        if settings.get("missing_device") or settings.get("device_index") is None:
            return {"ok": False, "result": "unavailable", "error": "Choose an available input device in the recorder"}
        result = api.start_rehearsal("Rehearsal", settings["device_index"], settings["samplerate"],
                                     layout["tracks"], settings["bit_depth"], set_id=settings.get("next_set"),
                                     lineup=layout.get("lineup"))
        if not result.get("ok"): result.setdefault("result","unavailable")
        return result

    def _stop_rehearsal(self):
        if self.api._recorder is not None or self.pending_take or self.error or self.api.player_state().get("playing"):
            return {"ok": False, "result": "busy", "error": "Stop playback/recording and recover drafts first"}
        # The click between takes stops with the rehearsal.
        self.api._metronome.stop()
        self.api.player_close()
        return self.api.finish_rehearsal()

    def _remove_selected(self, target):
        api = self.api
        if not target or api._recorder is not None or self.pending_take or self.error or api.player_state().get("playing"):
            return {"ok": False, "result": "unavailable", "error": "Take removal is unavailable"}
        with api._files_lock:
            if target != self.selection_reference():
                return {"ok": False, "result": "unavailable", "error": "Take selection changed; confirm it again"}
            selected = self._selected_take()
            api.player_close()
            return api.delete_take(str(api._session["folder"]), selected["take_number"])

    def command(self, action, on_accept=None, target_reference=None, browse_target=None):
        """Compatibility entry point; adapters use execute()."""
        parameters = {"target": browse_target if browse_target is not None else target_reference}
        return self.execute(action, parameters, on_accept)

    def _check_action(self, action):
        if action in ("set_volume", "adjust_volume", "volume_operations", "mute_toggle"):
            return None
        state = self.state()["state"]
        busy = state == "saving" or (state == "recording" and action not in ("record_stop", "stop_keep", "stop_review"))
        unavailable = ((state in ("error", "unavailable") and action not in ("retry_save", "start_rehearsal")) or
                       (action in ("stop_keep", "stop_review") and state != "recording") or
                       (action in ("stop_rehearsal", "remove_take") and state != "ready"))
        if busy or unavailable:
            if state == "saving":
                message = "Wait for the take to finish saving, then try again"
            elif state == "recording":
                message = "Stop the recording before changing songs or playing a take"
            elif self.pending_take or self.error:
                message = "Check the unsaved take in the recorder before continuing"
            else:
                message = "Open a rehearsal and select a saved take before using this command"
            return {"ok": False, "result": "busy" if busy else "unavailable", "error": message}
        return None

    def execute(self, action, parameters=None, on_accept=None, *, wait=False):
        if not isinstance(action, str):
            return {"ok": False, "result": "unavailable", "error": "Expected an action name"}
        if parameters is not None and not isinstance(parameters, dict):
            return {"ok": False, "result": "unavailable", "error": "Expected command parameters"}
        parameters = parameters or {}
        def work():
            saving_action = action in ("stop_keep", "stop_review", "retry_save") or (action == "record_stop" and self.api._recorder is not None)
            failed_path = self.api._recorder_temp_dir or (self.pending_take or {}).get("temp_dir")
            try:
                rejected = self._check_action(action)
                if rejected:
                    self._record_action(action, rejected)
                    return {**rejected, "transport": self.state()}
                if on_accept:
                    try:
                        on_accept()
                    except Exception:
                        # Admission feedback cannot cancel an accepted audio action.
                        log.exception("Control admission feedback failed")
                if action == "start_rehearsal":
                    result = self._start_rehearsal(parameters)
                elif action == "stop_rehearsal":
                    result = self._stop_rehearsal()
                elif action in ("select_take","select_song"):
                    result = self._select(action, parameters.get("target"))
                elif action == "remove_take":
                    result = self._remove_selected(parameters.get("target"))
                elif action == "start":
                    result = self._start()
                elif action == "stop_review":
                    self._saving = True
                    try:
                        result = self.api.stop_take()
                        if result.get("ok"):
                            self.pending_take = result
                    finally:
                        self._saving = False
                elif action == "stop_keep":
                    result = self._stop_keep()
                elif action == "record_stop":
                    result = self._stop_keep() if self.api._recorder is not None else self._start()
                elif action == "play_stop":
                    result = self._play_stop()
                elif action in ("restart", "seek_back", "seek_forward", "previous_take", "next_take", "previous_song", "next_song"):
                    result = self._navigate(action)
                elif action == "mute_toggle":
                    self.playback_muted = not self.playback_muted
                    if self.api._player is not None:
                        self.api._player.set_master_muted(self.playback_muted)
                    result = {"ok": True}
                elif action in ("set_volume", "adjust_volume", "volume_operations"):
                    result = self._volume(action, parameters)
                elif action == "retry_save":
                    result = self._save_pending()
                else:
                    return {"ok": False, "result": "unavailable", "error": "Unknown transport action"}
                if result.get("ok"):
                    if action not in ("set_volume", "adjust_volume", "volume_operations", "mute_toggle"):
                        self.error = None
                        self.last_error = None
                elif result.get("result") not in ("busy", "unavailable"):
                    self.last_error = result.get("error") or "Transport action failed"
                    if saving_action:
                        self.failed_take_path = str(failed_path) if failed_path else None
                        self.error = self.last_error
                if action not in ("set_volume", "adjust_volume", "volume_operations"):
                    self._record_action(action, result)
                return {**result, "transport": self.state()}
            except Exception as exc:
                self.last_error = str(exc) or type(exc).__name__
                if saving_action:
                    self.failed_take_path = str(failed_path) if failed_path else None
                    self.error = self.last_error
                result = {"ok": False, "result": "error", "error": self.last_error}
                self._record_action(action, result)
                return {**result, "transport": self.state()}
        return self.run(work, wait=wait)

    def _start(self):
        api = self.api
        if api._recorder is not None:
            return {"ok": False, "result": "busy", "error": "Already recording"}
        if self.pending_take or self.error:
            return {"ok": False, "result": "unavailable", "error": "Recover the failed take before recording again"}
        if api._session is None:
            return {"ok": False, "result": "unavailable", "error": "No rehearsal in progress"}
        coming = api._next_take()
        name = api.suggest_take_name()
        previous_tracks = copy.deepcopy(api._open_tracks)
        previous_position = api.player_state().get("position", 0)
        paused = api.player_pause()
        if paused.get("ok") is False:
            return paused
        # The click between takes stops before the recorder opens the card,
        # whose take has a click of its own; it is not moved into a stream
        # of its own as the player closes.
        api._metronome.stop()
        # A paused player still owns its output stream. Release it before
        # opening the recorder, especially on exclusive/single-stream cards.
        api.player_close()
        try:
            result = api.start_take()
        except Exception:
            if previous_tracks:
                api.player_open(previous_tracks)
                api.player_seek(previous_position)
            raise
        if not result.get("ok") and previous_tracks:
            reopened = api.player_open(previous_tracks)
            if reopened.get("ok"):
                api.player_seek(previous_position)
            else:
                result["playback_error"] = reopened.get("error")
        if result.get("ok"):
            self.recording_name, self.recording_go = name, coming["go"]
            self._keep_name = name
            result = {**result, "take_name": name, "take_go": coming["go"]}
        return result

    def _stop_keep(self):
        if self.api._recorder is None:
            return {"ok": False, "result": "unavailable", "error": "Not recording"}
        self._saving = True
        try:
            stopped = self.api.stop_take()
            if not stopped.get("ok"):
                return stopped
            self.pending_take = stopped
            if self._keep_name is None:
                self._keep_name = stopped.get("suggested_name", "")
            return self._save_pending()
        finally:
            self._saving = False

    def _save_pending(self):
        # The take's tempo, signature and click are not passed: keep_take
        # reads them by the draft's folder, as Stop left them.
        take = self.pending_take
        if take is None:
            return {"ok": False, "result": "unavailable", "error": "No finalised take to save; check Unsaved takes"}
        self._saving = True
        try:
            result = self.api.keep_take(
                take["take_number"], take["temp_dir"], self._keep_name or "",
                take["duration_sec"], take["tracks"], notes=take.get("notes"))
            if result.get("ok"):
                self.pending_take = None
                self.recording_name = self.recording_go = self._keep_name = None
            return result
        finally:
            self._saving = False

    def _play_stop(self):
        api = self.api
        if api._recorder is not None:
            return {"ok": False, "result": "busy", "error": "Recording in progress"}
        if self.pending_take or self.error:
            return {"ok": False, "result": "unavailable", "error": "Recover the failed take first"}
        if api._session is None:
            return {"ok": False, "result": "unavailable", "error": "No rehearsal in progress"}
        take = self._selected_take()
        player = api.player_state()
        if take and api._open_tracks == take["tracks"] and player.get("playing"):
            paused = api.player_pause()
            if not paused.get("ok"):
                return paused
            return api.player_seek(0)
        if api._session is None:
            return {"ok": False, "result": "unavailable", "error": "No rehearsal in progress"}
        take = self._selected_take()
        if take is None:
            return {"ok": False, "result": "unavailable", "error": "No kept take for the selected song"}
        opened = api.player_open(take["tracks"], reuse_existing=True)
        if not opened.get("ok"):
            return opened
        return api.player_play()


    def _volume(self, action, parameters):
        current = (self.api._player.state()["master"] if self.api._player is not None
                   else self.api._config.get("master_volume", 1.0))
        operations = parameters.get("operations", ()) if action == "volume_operations" else [
            ("set" if action == "set_volume" else "adjust", parameters.get("level" if action == "set_volume" else "delta"))]
        resolution = parameters.get("resolution")
        if resolution is not None and (type(resolution) is not int or not 1 <= resolution <= 1000000):
            return {"ok": False, "result": "unavailable", "error": "Invalid volume resolution"}
        if not isinstance(operations, (list, tuple)) or len(operations) > 128:
            return {"ok": False, "result": "unavailable", "error": "Invalid volume operations"}
        value = round(current * resolution) / resolution if resolution else current
        for operation in operations:
            if not isinstance(operation, (tuple, list)) or len(operation) != 2:
                return {"ok": False, "result": "unavailable", "error": "Invalid volume operation"}
            kind, amount = operation
            if kind not in ("set", "adjust") or type(amount) not in (int, float) or not math.isfinite(amount):
                return {"ok": False, "result": "unavailable", "error": "Invalid volume operation"}
            if kind == "set" and not 0 <= amount <= 1:
                return {"ok": False, "result": "unavailable", "error": "Invalid volume level"}
            value = max(0.0, min(1.0, amount if kind == "set" else value + amount))
            if resolution: value = round(value * resolution) / resolution
        self.api._config["master_volume"] = value
        if self.api._player is not None:
            self.api.player_set_master(value)
        return {"ok": True}

    def _navigate(self, action):
        api = self.api
        if api._recorder is not None or self.pending_take:
            return {"ok": False, "result": "busy", "error": "Finish the take first"}
        if api._session is None:
            return {"ok": False, "result": "unavailable", "error": "No rehearsal in progress"}
        if action in ("restart", "seek_back", "seek_forward"):
            player = api.player_state()
            if not player.get("open"):
                take = self._selected_take() if action == "restart" else None
                if take is None:
                    return {"ok": False, "result": "unavailable", "error": "No take open"}
                opened = api.player_open(take["tracks"])
                if not opened.get("ok"): return opened
                player = api.player_state()
            delta = -1 if action == "seek_back" else 1
            at = 0 if action == "restart" else player["position"] + delta
            return api.player_seek(max(0, min(player["duration"], at)))
        if action.endswith("song"):
            choices = api.song_choices()
            order = [s for s in (api._session.get("set") or {}).get("songs", []) if isinstance(s,str)]
            order += [s["song"] for group in ("here", "other") for s in choices[group]]
            order = list(dict.fromkeys(order))
            current = api._next_take()["song"]
            at = order.index(current) if current in order else -1
            to = at + (-1 if action == "previous_song" else 1)
            if not 0 <= to < len(order):
                return {"ok": False, "result": "unavailable", "error": "No song in that direction"}
            paused = api.player_pause()
            if not paused.get("ok"): return paused
            api.player_close()
            return api.set_next_take_name(order[to])
        # TAKE stays within the song chosen for the next recording. Songs
        # without takes stay at T0 rather than borrowing another song's take.
        song = api._next_take()["song"]
        takes = [take for take in api._session_takes() if take.get("song") == song]
        if not takes:
            return {"ok": True, "unchanged": True}
        numbers = [t["take_number"] for t in takes]
        selected = self._selected_take()
        current = selected["take_number"] if selected else None
        if current in numbers:
            to = numbers.index(current) + (-1 if action == "previous_take" else 1)
        else:
            to = len(takes) - 1
        if not 0 <= to < len(takes):
            return {"ok": True, "unchanged": True}
        return api.player_open(takes[to]["tracks"])
