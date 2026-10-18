"""Shared transport integration: real WAV/library work with a fake sound card."""
import tempfile
import threading
from pathlib import Path

# Reuse the engine suite's fake sounddevice and isolated Api factory. Importing
# the module does not run its suite or touch the user's recording library.
from test_engine import fresh_api, np, SR


def main():
    with tempfile.TemporaryDirectory() as folder:
        mod, api = fresh_api(Path(folder))
        try:
            assert api.transport_state()["state"] == "unavailable"
            assert api.start_rehearsal("Transport", 0, SR, [{"name": "Guitar", "channel": 1}])["ok"]
            api.set_next_take_name("Song")
            assert api.transport_command("play_stop")["result"] == "unavailable"
            started = api.transport_command("start")
            assert started["ok"] and started["take_name"] == "Song"
            assert api.transport_state()["state"] == "recording"
            assert api.transport_command("play_stop")["result"] == "busy"
            assert not api.finish_rehearsal()["ok"]
            api._recorder._callback(np.full((512, 1), 1000, dtype=np.int32), 512, None, None)
            original_keep = api.keep_take
            entered, release = threading.Event(), threading.Event()
            def slow_keep(*args, **kwargs):
                entered.set()
                assert release.wait(5)
                return original_keep(*args, **kwargs)
            api.keep_take = slow_keep
            replies = []
            worker = threading.Thread(target=lambda: replies.append(api.transport_command("stop_keep")))
            worker.start()
            assert entered.wait(5)
            assert api._recorder is None
            assert api.transport_state()["state"] == "saving"
            # Remote toggles fail fast while GUI calls wait for the same gate.
            assert api.transport_command("record_stop")["result"] == "busy"
            gui_done = threading.Event()
            gui = threading.Thread(target=lambda: (api.player_pause(), gui_done.set()))
            gui.start()
            assert not gui_done.wait(0.05)
            release.set()
            worker.join(5)
            gui.join(5)
            assert gui_done.is_set()
            assert not worker.is_alive() and replies[0]["ok"]
            api.keep_take = original_keep
            takes = api._session_takes()
            assert len(takes) == 1 and takes[0]["song"] == "Song"
            assert Path(takes[0]["tracks"][0]["file"]).exists()
            assert not api.transport_command("stop_keep")["ok"]
            assert len(api._session_takes()) == 1
            assert api.transport_state()["state"] == "ready"
            assert api.transport_command("play_stop")["ok"]
            assert api.transport_state()["state"] == "playing"
            api.player_seek(0.005)
            assert api.transport_command("play_stop")["ok"]
            assert api.player_state()["position"] == 0
            assert api.transport_state()["state"] == "ready"

            # UI playback is also reflected in shared confirmed state.
            assert api.player_play()["ok"]
            assert api.transport_state()["state"] == "playing"
            assert api.transport_command("record_stop")["ok"]
            # Record releases the output stream, not merely its play flag.
            assert not api.player_state()["open"]
            api._recorder._callback(np.full((512, 1), 2000, dtype=np.int32), 512, None, None)
            api.keep_take = lambda *args, **kwargs: {"ok": False, "error": "Disk refused save"}
            failed = api.transport_command("stop_keep")
            assert not failed["ok"] and api.transport_state()["state"] == "error"
            draft = api.transport_state()["pending_take"]
            assert Path(draft["tracks"][0]["file"]).exists()
            assert len(api._session_takes()) == 1
            assert not api.transport_command("start")["ok"]
            api.keep_take = original_keep
            assert api.transport_command("retry_save")["ok"]
            assert len(api._session_takes()) == 2
            assert api.transport_state()["state"] == "ready"
            assert api.transport_state()["pending_take"] is None
            assert not api.transport_command("retry_save")["ok"]
            assert len(api._session_takes()) == 2

            # An exception in finalisation retains the raw draft for recovery.
            assert api.transport_command("start")["ok"]
            raw = Path(api._recorder_temp_dir)
            api._recorder._callback(np.full((512, 1), 3000, dtype=np.int32), 512, None, None)
            original_stop = api._recorder.stop
            def broken_stop(*args, **kwargs):
                api._recorder = None
                raise OSError("Cannot finalise")
            recorder = api._recorder
            recorder.stop = broken_stop
            assert not api.transport_command("stop_keep")["ok"]
            assert api.transport_state()["state"] == "error" and raw.exists()
            recorder.stop = original_stop
            recorder.abandon()
            assert api.recover_draft(str(raw))["ok"]
            assert api.transport_state()["state"] == "ready"
            assert len(api._session_takes()) == 3
            print("Shared transport: all checks passed.")
        finally:
            api.shutdown()


if __name__ == "__main__":
    main()
