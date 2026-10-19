"""Protocol routing against exclusive fake MIDI and temporary real library."""
import tempfile
from pathlib import Path
from test_engine import fresh_api, np, SR
from fake_midi import FakePortSystem
from rehearsal_recorder.midi.ports import PortInfo
from rehearsal_recorder.midi.rig import MidiRig
from rehearsal_recorder.midi.identity import controller_feedback
from rehearsal_recorder.midi.controller import Controller
from rehearsal_recorder.midi.text import ascii_row, row_frames, display_rows


def main():
    with tempfile.TemporaryDirectory() as folder:
        _, api = fresh_api(Path(folder))
        info = PortInfo("Remote", id="123")
        out = PortInfo("Remote", id="456")
        fake = FakePortSystem([info], exclusive=True)
        fake._outputs = [out]
        api._midi.shutdown()
        api._midi_system = fake
        api._midi = MidiRig(fake, threads=False)
        api._controller = Controller(fake, api._transport, threads=False)
        try:
            assert api.set_controller(info.saved())["ok"]
            assert api.list_midi_ports()["ports"] == []
            ctl = api._controller
            ctl.tick()
            assert len(fake.open_ports) == 1
            def send(data):
                assert fake.send("Remote", 0, bytes(data))
                ctl.tick()
            send([0xBF, 117, 1])
            assert bytes([0xBF,112,31]) in fake.feedback
            assert fake.feedback[-2:] == [bytes([0xBF,119,5]), bytes([0xBF,118,0])]
            assert ctl.status()["synchronized"]
            assert ascii_row("Pałyn Žąsis") == "Palyn Zasis"
            assert display_rows({"state":"ready", "playback_take_number":13,
                                 "playback_take_name":"An exceptionally long song name"})[0].startswith("T13 ")
            assert display_rows({"state":"recording", "take_number":4,
                                 "take_name":"A long song"})[0].startswith("T4 ")
            frames = row_frames(0, "REC")
            assert frames[-1] == (103, (3+82+69+67)&127)
            assert api.start_rehearsal("MIDI remote", 0, SR, [{"name":"Guitar", "channel":1}])["ok"]
            send([0xBE,113,1]); send([0x9E,60,127]); ctl.run_action()
            assert api._recorder is None
            def press(token, note=60):
                send([0xBF,113,token]); send([0x9F,note,127]); send([0x8F,note,0]); ctl.run_action()
            press(1)
            assert api._recorder is not None
            assert bytes([0xBF,114,1]) in fake.feedback and bytes([0xBF,116,1]) in fake.feedback
            press(1)
            assert api._recorder is not None and api._session["take_counter"] == 1
            press(2,62)
            assert api._recorder is not None
            assert any(fake.feedback[i:i+2] == [bytes([0xBF,114,2]), bytes([0xBF,116,2])]
                       for i in range(len(fake.feedback)-1))
            api._recorder._callback(np.full((512,1),1000,dtype=np.int32),512,None,None)
            press(3)
            assert api._recorder is None and len(api._session_takes()) == 1
            press(3)
            assert len(api._session_takes()) == 1 and api._recorder is None
            press(4,62)
            assert api.player_state()["playing"]
            opened = api._player
            assert api.player_open(api._open_tracks, reuse_existing=True)["playing"]
            assert api._player is opened
            press(5,62)
            assert not api.player_state()["playing"] and api.player_state()["position"] == 0
            # Queue a command, disconnect before execution: it never starts.
            send([0xBF,113,6]); send([0x9F,60,127])
            fake.pull("Remote"); ctl.tick(); ctl.run_action()
            assert api._recorder is None
            fake.plug(info); ctl.tick()
            send([0xBF,117,1]); press(7)
            assert api._recorder is not None
            assert not api.set_controller(None)["ok"]
            api._recorder._callback(np.full((512,1),1000,dtype=np.int32),512,None,None)
            press(8)
            assert len(api._session_takes()) == 2
            press(10,63)
            assert api.player_state()["position"] == 0
            send([0xBF,20,32]); ctl.run_action()
            assert api._config["master_volume"] == 32/127
            assert api.player_state()["master"] == 32/127
            # Relative turns use the latest host setting, not cached remote position.
            api.player_set_master(0.5) # UI live change before its debounced config save
            send([0xBF,21,66]); ctl.run_action() # +2/127
            assert api._config["master_volume"] == 66/127
            # Coalesced relative movements are applied once per batch.
            send([0xBF,20,127]); send([0xBF,21,65]); send([0xBF,21,61]); ctl.run_action()
            assert api._config["master_volume"] == 125/127
            send([0xBF,21,64]); ctl.run_action() # neutral, no-op
            assert api._config["master_volume"] == 125/127
            press(20,70)
            assert api.transport_state()["playback_muted"] and api.player_state()["master_muted"]
            assert bytes([0xBF,22,127]) in fake.feedback
            press(20,70) # duplicate token must NOT toggle again
            assert api.transport_state()["playback_muted"]
            send([0xBF,21,62]); ctl.run_action() # adjust remembered level while muted
            assert api._config["master_volume"] == 123/127 and api.player_state()["master_muted"]
            tracks = api._open_tracks
            api.player_close(); assert api.player_open(tracks)["master_muted"]
            press(21,70)
            assert not api.transport_state()["playback_muted"]
            assert api.player_state()["master"] == 123/127
            # HELLO invalidates queued pre-handshake volume turns.
            send([0xBF,21,65]); send([0xBF,117,1]); ctl.run_action()
            assert api._config["master_volume"] == 123/127
            api.player_open(api._session_takes()[0]["tracks"])
            press(11,64) # current take 1: clamp silently at first take
            assert ctl.last_action["ok"] is True
            assert api._transport.playback_take_number == 1
            press(12,66)
            assert api._transport.playback_take_number == 2
            press(13,64)
            assert api._transport.playback_take_number == 1
            # Busy volume updates occupy constant memory and retain the latest absolute base.
            original_execute = api._transport.execute
            api._transport.execute = lambda *a, **k: {"ok": False, "result": "busy"}
            try:
                for value in range(1000):
                    send([0xBF, 20, value % 128])
                    send([0xBF, 21, 65])
                    ctl.run_action()
                assert len(ctl._volume_ops) <= 2
                assert not ctl._overflow.is_set() and ctl.handshake
            finally:
                api._transport.execute = original_execute
            ctl.run_action()
            assert api._config['master_volume'] == ((999 % 128) + 1) / 127
            # Lost admission feedback does not prevent recording, and a status
            # query keeps the current epoch and command identity intact.
            original_send = ctl.output.send
            lost = [False]
            def lose_ack(data):
                if data[1] == 114 and not lost[0]:
                    lost[0] = True
                    raise OSError('Test feedback failure')
                return original_send(data)
            ctl.output.send = lose_ack
            press(30, 60)
            assert lost[0] and api._recorder is not None and ctl.last_action['ok']
            press(31, 60)
            send([0xBF, 111, 31])
            epoch = ctl.epoch
            send([0xBF, 113, 55])
            send([0xBF, 115, 127])
            assert ctl.epoch == epoch and bytes([0xBF, 115, 0]) in fake.feedback
            assert bytes([0xBF, 114, 55]) in fake.feedback
            assert ctl.last[0] == 31 and ctl.token is None
            # A disconnected controller cannot leave an invisible global mute.
            press(32, 70)
            assert api._transport.playback_muted
            assert api.set_controller(None)["ok"]
            assert not api._transport.playback_muted
            api._midi.refresh()
            assert api.list_midi_ports()["ports"][0]["name"] == "Remote"
            assert not fake.open_ports
            twins = FakePortSystem([PortInfo("Remote", id="new1"), PortInfo("Remote", id="new2")], exclusive=True)
            rig = MidiRig(twins, threads=False)
            try:
                rig.reserve_controller(info.saved())
                rig.use([{"name":"Keys", "mode":"midi", "midi_port":{"name":"Remote", "id":"new1"}}])
                assert not twins.open_ports and rig.ports()["ports"] == []
                rig.reserve_controller(None)
                assert len(twins.open_ports) == 1
            finally:
                rig.shutdown()
            print("Controller routing: all checks passed.")
        finally:
            api.shutdown()


def automatic_feedback_checks():
    incoming = PortInfo("Reha Probe (Bluetooth MIDI IN)", id="ble-in")
    outgoing = PortInfo("Reha Probe (Bluetooth MIDI OUT)", id="ble-out")
    unrelated = PortInfo("Microsoft GS Wavetable Synth", id="synth")
    assert controller_feedback(incoming, [unrelated, outgoing]) == [outgoing]
    assert controller_feedback(PortInfo("Reha Probe"), [outgoing]) == []
    assert controller_feedback(PortInfo("Other (Bluetooth MIDI IN)"), [outgoing]) == []
    assert controller_feedback(PortInfo("Same"), [PortInfo("Same")]) == [PortInfo("Same")]
    assert controller_feedback(PortInfo(incoming.name, device="A"),
                               [PortInfo(outgoing.name, device="B")]) == []
    with tempfile.TemporaryDirectory() as folder:
        _, api = fresh_api(Path(folder))
        fake = FakePortSystem([incoming], exclusive=True)
        fake._outputs = [unrelated, outgoing]
        api._midi.shutdown()
        api._midi_system = fake
        api._midi = MidiRig(fake, threads=False)
        api._controller = Controller(fake, api._transport, threads=False)
        try:
            # The settings page submits only the input when output is automatic.
            assert api.set_controller(incoming.saved())["ok"]
            assert api._controller.selected["output"] == outgoing.saved()
            assert api.set_controller(None)["ok"]
            fake._outputs.append(PortInfo(outgoing.name, id="second-identical-device"))
            assert not api.set_controller(incoming.saved())["ok"]
            assert api._controller.selected is None
            # Explicit selection still resolves the ambiguity by persistent ID.
            assert api.set_controller(incoming.saved(), outgoing.saved())["ok"]
        finally:
            api.shutdown()
    print("Automatic feedback: native Windows BLE, same-name, mismatch and ambiguity checks passed.")

if __name__ == "__main__":
    main()
    automatic_feedback_checks()
