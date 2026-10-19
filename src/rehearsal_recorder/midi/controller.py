"""Protocol v1 controller routing, independent of BLE/native/bridge transport."""
import json
import logging
import secrets
import queue
from collections import deque
from rehearsal_recorder.midi.text import display_rows, row_frames
import threading
import time
from rehearsal_recorder.midi.identity import find_port
from rehearsal_recorder.midi.browse import Frame as BrowseFrame, catalog_frames, MAX_SONGS, MAX_TAKES, NONE
from rehearsal_recorder.control import ControlAPI
from rehearsal_recorder.midi.selection import Reference, frames as reference_frames

log = logging.getLogger(__name__)


def trace(event, **fields):
    if log.isEnabledFor(logging.INFO):
        log.info(json.dumps({"t_ns":time.monotonic_ns(), "event":event, **fields},ensure_ascii=True))

ACTIONS = {60:"record_stop", 62:"play_stop", 63:"restart", 64:"previous_take", 65:"seek_back", 66:"next_take", 67:"seek_forward", 68:"previous_song", 69:"next_song", 70:"mute_toggle", 71:"start_rehearsal", 72:"stop_rehearsal", 73:"remove_take", 74:"select_take", 75:"select_song"}

STATES = {"ready": 0, "recording": 1, "playing": 2, "saving": 3, "error": 4, "unavailable": 5, "idle": 6}


class Controller:
    def __init__(self, system, transport: ControlAPI, threads=True):
        self.system, self.transport = system, transport
        self.selected = None
        self.input = self.output = None
        self.handshake = False
        self.token = None
        self.held = set()
        self.last = None
        self.link = 0
        self.epoch = 0
        self.error = None
        self.last_action = None
        self._action_sequence = 0
        self._browse = BrowseFrame()
        self._browse_frames = deque()
        self._browse_identity = None
        self._browse_tag = 0
        self._browse_values = None
        self._overflow = threading.Event()
        self._events = queue.Queue(maxsize=128)
        self._actions = queue.Queue(maxsize=1)
        self._volume_ops = deque()
        self._volume_dirty_at = None
        self._active = False
        self._clear_mute = False
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._threads = []
        self.remote_capabilities = 0
        self._selection_serial = secrets.randbits(32) or 1
        self._selection_identity = None
        self._selection_tag = 0
        self._target = Reference()
        self._text_rows = None
        self._text_frames = deque()
        self._heartbeat = 0
        self._sent_at = 0
        self._traced_state = None
        self._threads_enabled = threads

    def start(self):
        if self._threads or not self._threads_enabled:
            return
        for name, target in (("controller-midi", self._run), ("controller-actions", self._work)):
            thread = threading.Thread(name=name, target=target, daemon=True)
            self._threads.append(thread)
            thread.start()

    def configure(self, selected):
        with self._lock:
            self._disconnect()
            self.selected = selected
            self.error = None
        self.start()

    def _disconnect(self):
        # Clearing may have to wait for a save's gate; the action worker retries.
        self._clear_mute = True
        self._release_mute()
        trace("disconnect", epoch=self.epoch)
        self.link += 1
        self.epoch += 1
        self.handshake = False
        self.token = self.last = None
        self._volume_ops.clear()
        self.remote_capabilities = 0
        self._browse = BrowseFrame()
        self._browse_frames.clear()
        self._browse_identity = None
        self._browse_tag=0
        self._selection_identity = None
        self._selection_tag = 0
        self._target = Reference()
        self._text_frames.clear()
        self._text_rows = None
        self.held.clear()
        for port in (self.input, self.output):
            if port:
                port.close()
        self.input = self.output = None

    def receive(self, epoch, data):
        # Port callback: bounded queue only, never application work.
        try:
            self._events.put_nowait((epoch, bytes(data)))
        except queue.Full:
            self.error = "Controller input overflow; reconnect required"
            # Mark this epoch invalid; subsequent commands need a fresh HELLO.
            self._overflow.set()

    def _send(self, cc, value):
        if self.output:
            self.output.send(bytes((0xBF, cc, value)))

    def _state(self):
        return self.transport.snapshot()

    def _catalog(self):
        catalog = self.transport.catalog()
        if catalog is None: return None
        songs, takes = catalog["songs"], catalog["takes"]
        # Keep the selected item addressable even beyond the device's wire limit.
        def bounded(items, selected, limit):
            window = list(items[:limit])
            if selected in items and selected not in window:
                window[-1] = selected
            return tuple(window)
        songs = bounded(songs, catalog["selected_song"], MAX_SONGS)
        takes = bounded(takes, catalog["selected_take"], MAX_TAKES)
        song_index = songs.index(catalog["selected_song"]) if catalog["selected_song"] in songs else NONE
        take_index = takes.index(catalog["selected_take"]) if catalog["selected_take"] in takes else NONE
        return {"identity": catalog["identity"], "values": (songs, takes, song_index, take_index)}

    def snapshot(self, status_token=None):
        if self.handshake and self.output:
            state = self._state()
            if state["state"] != self._traced_state:
                self._traced_state = state["state"]
                trace("state",state=state["state"],epoch=self.epoch)
            extension = self.remote_capabilities & 4
            caps = 31 | (32 if extension else 0) | (64 if extension and self.remote_capabilities & 2 else 0)
            wire_state = state["state"]
            if wire_state == "idle" and not extension: wire_state = "unavailable"
            browse_enabled = bool(self.remote_capabilities & 8)
            self._send(117, 1)
            self._send(110, (1 if browse_enabled else 0) | (2 if self.remote_capabilities & 16 else 0))
            self._send(112, caps)
            self._send(20, round(state.get("master_volume", 1.0) * 127))
            self._send(22, 127 if state.get("playback_muted", False) else 0)
            self._send(119, STATES[wire_state])
            if self.remote_capabilities & 16:
                self._send(114, status_token if status_token is not None else self.last[0] if self.last else 127)
                readiness = "busy" if self._active else state.get("readiness", "ready")
                self._send(115, {"ready": 0, "idle": 0, "busy": 1, "attention": 2}[readiness])
            self._send(118, self._heartbeat)
            self._heartbeat = (self._heartbeat + 1) & 127
            identity = state.get("selection_reference")
            if identity != self._selection_identity:
                self._selection_identity = identity
                self._selection_serial = (self._selection_serial+1)&0xffffffff or 1
                self._selection_tag = self._selection_serial if identity else 0
            if self.remote_capabilities & 1 and not self._text_frames:
                rows = display_rows(state)
                signature = (rows, self._selection_tag if caps & 64 else None)
                if signature != self._text_rows:
                    self._text_rows = signature
                    # Invalidate old deletion authority before changing text, and
                    # publish the new reference only after both rows commit.
                    if caps & 64: self._text_frames.extend(reference_frames(0))
                    for index, row in enumerate(rows): self._text_frames.extend(row_frames(index,row))
                    if caps & 64: self._text_frames.extend(reference_frames(self._selection_tag))

            if browse_enabled:
                catalog=self._catalog()
                identity=catalog["identity"] if catalog else None
                if identity!=self._browse_identity or not self._browse_tag:
                    self._browse_identity=identity
                    self._selection_serial=(self._selection_serial+1)&0xffffffff or 1
                    self._browse_tag=self._selection_serial
                    self._browse_values=catalog["values"] if catalog else ((),(),16383,16383)
                    self._browse_frames=deque(catalog_frames(self._browse_tag,self._browse_values))

    def ack(self, token, result):
        trace("ack",token=token,result=result)
        self._send(114, token)
        self._send(116, result)

    def tick(self):
        with self._lock:
            if not self.selected or self.system is None:
                return
            try:
                if self._overflow.is_set():
                    self._overflow.clear()
                    self._disconnect()
                if self.input and (not self.input.connected() or not self.output.connected()):
                    self._disconnect()
                if not self.input:
                    info, ambiguous = find_port(self.selected["input"], self.system.inputs())
                    out, out_ambiguous = find_port(self.selected["output"], self.system.outputs())
                    if ambiguous or out_ambiguous:
                        self.error = "Several MIDI ports match this controller. Choose its input and feedback output in Controls."
                        return
                    if info is None or out is None:
                        return
                    self.output = self.system.open_output(out)
                    epoch = self.link
                    try:
                        self.input = self.system.open(info, lambda ns, data: self.receive(epoch, data))
                    except Exception:
                        self._disconnect()
                        raise
                    self.error = None
                    trace("ports_open",input=info.name,output=out.name,epoch=self.epoch)
                while True:
                    try:
                        epoch, data = self._events.get_nowait()
                    except queue.Empty:
                        break
                    if epoch == self.link:
                        self._message(data)
                if time.monotonic() - self._sent_at >= 1:
                    self.snapshot()
                    self._sent_at = time.monotonic()
                for _ in range(min(4,len(self._text_frames))):
                    cc, value = self._text_frames.popleft()
                    self._send(cc,value)
                for _ in range(min(8,len(self._browse_frames))):
                    cc,value=self._browse_frames.popleft()
                    self._send(cc,value)
            except Exception as exc:
                self.error = str(exc)
                self._disconnect()

    def _message(self, data):
        if len(data) != 3 or data[0] not in (0xBF, 0x9F, 0x8F) or any(b > 127 for b in data[1:]):
            return
        status, key, value = data
        if status == 0xBF and key == 117:
            # New link epoch: discard queued old commands, not a running save.
            self.epoch += 1
            self.handshake = value == 1
            trace("hello",version=value,epoch=self.epoch)
            self.token = self.last = None
            self.held.clear()
            self._volume_ops.clear()
            self.remote_capabilities = 0
            self._text_frames.clear()
            self._text_rows = None
            self._browse=BrowseFrame()
            self._browse_frames.clear()
            self._browse_identity=None
            self._browse_tag=0
            self._selection_identity = None
            self._selection_tag = 0
            self._target = Reference()
            self.error = None if self.handshake else "Unsupported controller protocol"
            self.snapshot()
        elif status == 0xBF and key == 111 and self.handshake:
            self.remote_capabilities = value
            trace("remote_capabilities",value=value)
            self.snapshot()
        elif status == 0xBF and key == 115 and value == 127 and self.handshake:
            # Echo the query token even if its original command never arrived.
            # This refresh never changes epochs or replays an action.
            query_token, self.token = self.token, None
            self.snapshot(status_token=query_token)
        elif status == 0xBF and 104 <= key <= 109 and self.handshake:
            self._target.receive(key, value)
        elif status == 0xBF and key==89 and self.handshake and self.remote_capabilities & 8:
            self._browse_identity=None
            self._browse_tag=0
            self._browse_frames.clear()
            self.snapshot()
        elif status == 0xBF and 90 <= key <= 93 and self.handshake:
            self._browse.receive(key,value)
        elif status == 0xBF and key == 113 and self.handshake:
            self.token = value
        elif status == 0xBF and key in (20, 21) and self.handshake:
            if key == 21 and value == 64:
                return
            self._merge_volume(self.epoch, "absolute" if key == 20 else "relative",
                               value if key == 20 else value - 64)
        elif status in (0x8F, 0x9F) and key in ACTIONS:
            if status == 0x8F or value == 0:
                self.held.discard(key)
                return
            if key in self.held:
                self.token = None
                self._target = Reference()
                self._browse.consume()
                return
            if not self.handshake or self.token is None:
                return
            self.held.add(key)
            token, self.token = self.token, None
            requested_tag, self._target = self._target.value, Reference()
            browse_request=self._browse.consume()
            if self.last and self.last[:2] == (token, key):
                self.ack(token, self.last[2])
                return
            if self.last and self.last[0] == token:
                self.ack(token, 4)
                return
            state = self._state()
            target = self._selection_identity if key == 73 else None
            target_ok = key != 73 or (self.remote_capabilities & 2 and requested_tag == self._selection_tag and target is not None and target == state.get("selection_reference"))
            if key in (74,75):
                latest=self._catalog()
                valid_browse=bool(self.remote_capabilities & 8 and browse_request and
                    browse_request[0]==key-70 and browse_request[1]==self._browse_tag and latest and
                    latest["identity"]==self._browse_identity and
                    browse_request[2]<len(latest["values"][0 if key==75 else 1]))
                target = ({"catalog": self._browse_identity,
                           "song" if key == 75 else "take": latest["values"][0 if key == 75 else 1][browse_request[2]]}
                          if valid_browse else None)
                target_ok=valid_browse
            self._target = Reference()
            # Protocol eligibility is adapter-specific; recorder state rules
            # are checked by the shared API when the action executes.
            rejected = (2 if self._active else
                        3 if not target_ok or (key in (71,72,73) and not self.remote_capabilities & 4) else None)
            if rejected:
                self.last = (token, key, rejected)
                self.ack(token, rejected)
                return
            self._active = True
            trace("command",token=token,note=key,state=state["state"],target_take=state.get("playback_take_number") if target and key==73 else None)
            self.last = (token, key, 1)
            self._actions.put_nowait((self.epoch, token, key, target))

    def _merge_volume(self, epoch, kind, value):
        if kind == "absolute":
            self._volume_ops.clear()
        elif self._volume_ops and self._volume_ops[-1][1] == "relative":
            previous = self._volume_ops.pop()
            value += previous[2]
        self._volume_ops.append((epoch, kind, value))

    def _release_mute(self):
        if not self._clear_mute:
            return
        try:
            if not self._state().get("playback_muted"):
                self._clear_mute = False
            elif self.transport.execute("mute_toggle").get("ok"):
                self._clear_mute = False
        except Exception:
            log.exception("Could not clear controller playback mute")

    def run_action(self):
        self._release_mute()
        try:
            epoch, token, key, target = self._actions.get_nowait()
        except queue.Empty:
            with self._lock:
                operations = list(self._volume_ops)
                self._volume_ops.clear()
            operations = [op for op in operations if op[0] == self.epoch]
            if operations:
                epoch = operations[0][0]
                with self._lock:
                    if epoch != self.epoch: return
                    result = self.transport.execute("volume_operations", {
                        "operations": [("set" if kind == "absolute" else "adjust", value / 127)
                                       for _, kind, value in operations], "resolution": 127})
                if result.get("ok"):
                    self._volume_dirty_at = time.monotonic()
                    with self._lock:
                        if epoch == self.epoch: self.snapshot()
                elif result.get("result") == "busy":
                    with self._lock:
                        if epoch == self.epoch:
                            newer = list(self._volume_ops)
                            self._volume_ops.clear()
                            for operation in operations + newer:
                                self._merge_volume(*operation)
            if self._volume_dirty_at and time.monotonic() - self._volume_dirty_at > 0.5:
                self.transport.flush_settings()
                self._volume_dirty_at = None
            return
        released = False
        try:
            with self._lock:
                if epoch != self.epoch or self._stop.is_set():
                    return
            sent_ack = False
            started = time.monotonic()
            def accepted():
                nonlocal sent_ack
                with self._lock:
                    if epoch == self.epoch and self.output and key in (60,62,71,72):
                        try:
                            self.ack(token, 1)
                            sent_ack = True
                        except Exception as exc:
                            self.error = f"Controller feedback failed: {exc}"
                            log.exception("Could not acknowledge accepted controller action")
            parameters = {"target": target} if key in (73, 74, 75) else {}
            result = self.transport.execute(ACTIONS[key], parameters, on_accept=accepted)
            with self._lock:
                self._active = False
                released = True
                self._action_sequence += 1
                self.last_action = {"sequence":self._action_sequence, "note": key, "action": ACTIONS[key], "token": token, "ok": result.get("ok"), "error": result.get("error"), "undo": result.get("undo"), "duration_ms": round((time.monotonic()-started)*1000)}
                trace("result",**self.last_action)
                if epoch == self.epoch and self.output:
                    if not result.get("ok"):
                        code = 2 if result.get("result") == "busy" else 3 if result.get("result") == "unavailable" else 4
                        if self.last and self.last[:2] == (token, key):
                            self.last = (token, key, code)
                        self.ack(token, code)
                    elif not sent_ack:
                        self.ack(token, 1)
                    self.snapshot()
        finally:
            with self._lock:
                # Completion above already released admission. Never overwrite
                # a newer command's ownership after it entered the queue.
                if not released:
                    self._active = False

    def status(self):
        return {"enabled": bool(self.selected), "selected": self.selected,
                "port_open": self.input is not None, "synchronized": self.handshake,
                "error": self.error, "last_action": self.last_action, "remote_capabilities":self.remote_capabilities, "selection_tag":self._selection_tag, "browse":{"tag":self._browse_tag,"songs":len(self._browse_values[0]) if self._browse_values else 0,"takes":len(self._browse_values[1]) if self._browse_values else 0,"queued":len(self._browse_frames)}}

    def _run(self):
        while not self._stop.wait(0.05):
            self.tick()

    def _work(self):
        while not self._stop.wait(0.01):
            try:
                self.run_action()
            except Exception as exc:
                self.error = f"Controller action worker: {exc}"
                if self._volume_dirty_at: self._volume_dirty_at = time.monotonic()


    def close(self):
        self._stop.set()
        for thread in self._threads:
            thread.join()
        if self._volume_dirty_at:
            try: self.transport.flush_settings()
            except Exception as exc: self.error = str(exc)
        with self._lock:
            self._disconnect()
