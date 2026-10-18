"""A simulated BLE controller, real Controller/Transport and temporary library.

No MIDI driver, Bluetooth, microphone or physical device required. Same scenario
runs on Mac/Windows with the recorder's existing test environment.
"""
import tempfile
from pathlib import Path
from test_engine import fresh_api, np, SR
from fake_midi import FakePortSystem
from rehearsal_recorder.midi.ports import PortInfo
from rehearsal_recorder.midi.controller import Controller
from rehearsal_recorder.midi.selection import Reference, frames


def main():
    r=Reference()
    for value in (1,127,128,0xffffffff,0):
        for cc,data in frames(value):r.receive(cc,data)
        assert r.value==(value or None)
    r.receive(104,1);r.receive(106,3);r.receive(109,4);assert r.value is None
    for cc,data in frames(7)[:-1]:r.receive(cc,data)
    r.receive(109,8);assert r.value is None
    with tempfile.TemporaryDirectory() as folder:
        _,api=fresh_api(Path(folder))
        fake=FakePortSystem([PortInfo('Simulated C3',id='sim-in')],exclusive=True)
        fake._outputs=[PortInfo('Simulated C3 feedback',id='sim-out')]
        ctl=Controller(fake,api._transport,threads=False)
        try:
            ctl.configure({'input':fake.inputs()[0].saved(),'output':fake.outputs()[0].saved()});ctl.tick()
            def send(data):
                assert fake.send('Simulated C3',0,bytes(data));ctl.tick()
            send([0xBF,117,1]);assert bytes([0xBF,112,31]) in fake.feedback
            send([0xBF,111,7]);assert bytes([0xBF,112,127]) in fake.feedback
            assert bytes([0xBF,119,6]) in fake.feedback
            def press(token,note,tag=None,run=True):
                if tag is not None:
                    for cc,val in frames(tag):send([0xBF,cc,val])
                send([0xBF,113,token]);send([0x9F,note,127]);send([0x8F,note,0])
                if run:ctl.run_action()
            press(1,60);assert api._session is None # no recording at idle
            # Configure the saved setup using existing recorder methods.
            api._config['device']=0
            api.save_default_tracks({'device_index':0,'samplerate':SR,'tracks':[{'name':'Guitar','channel':1}]})
            # Use a fake configured-settings result: card identity resolution is
            # covered separately by engine tests; no real input is queried here.
            settings=api.get_settings
            api.get_settings=lambda:{**settings(),'device_index':0,'missing_device':None,'samplerate':SR}
            press(2,71);assert api._session is not None and api._recorder is None
            assert api._transport.controller_state()['state']=='ready'
            assert bytes([0xBF,119,0]) in fake.feedback
            # Retransmitted token cannot open another rehearsal.
            session=api._session;press(2,71);assert api._session is session
            def record(token):
                press(token,60);assert api._recorder is not None
                api._recorder._callback(np.full((512,1),1000,dtype=np.int32),512,None,None)
                press(token+1,60);assert api._recorder is None
            api._session['set']={'songs':['Song with takes','Empty A','Empty B']}
            api.set_next_take_name('Song with takes')
            record(3)
            press(5,62);assert api.player_state()['playing']
            record(6) # record -> play -> record through the MIDI protocol
            assert not api.player_state().get('playing',False)
            assert len(api._session_takes())==2
            # TAKE stays within SONG; empty songs must not borrow other takes.
            press(80,64);assert api._transport.state()['playback_take_number']==1
            press(81,64);assert ctl.last_action['ok'] and api._transport.state()['playback_take_number']==1
            press(82,66);assert api._transport.state()['playback_take_number']==2
            press(83,66);assert ctl.last_action['ok'] and api._transport.state()['playback_take_number']==2
            for token,title in [(84,'Empty A'),(87,'Empty B')]:
                press(token,69);assert api._next_take()['song']==title
                for offset,note in [(1,64),(2,66)]:
                    press(token+offset,note)
                    assert ctl.last_action['ok']
                    assert api._transport.state()['playback_take_number']==0
                    assert api._transport.selection_reference() is None
                    assert not api.player_state().get('open')
                    assert api._next_take()['song']==title
            press(90,68);press(91,68)
            assert api._next_take()['song']=='Song with takes'
            assert api._transport.state()['playback_take_number']==2
            # A resetting board requests HELLO even if warm-host state arrived
            # first. The unchanged metadata cache must be replayed in full.
            ctl.snapshot()
            for _ in range(50):ctl.tick()
            assert not ctl._text_frames
            fake.feedback.clear()
            send([0xBF,117,1]);send([0xBF,111,7])
            for _ in range(50):ctl.tick()
            assert bytes([0xBF,100,0]) in fake.feedback
            assert bytes([0xBF,100,1]) in fake.feedback
            assert sum(data[1]==103 for data in fake.feedback)==2
            assert len(api._session_takes())==2 and api._recorder is None
            ctl.snapshot();tag=ctl._selection_tag;assert tag and ctl._selection_identity
            # Malformed/missing/stale references cannot remove any take.
            press(8,73);assert len(api._session_takes())==2
            press(9,73,tag^1);assert len(api._session_takes())==2
            # Change selection after queueing: the captured target is not retargeted.
            press(10,73,tag,run=False)
            api.player_open(api._session_takes()[0]['tracks'])
            ctl.run_action();assert len(api._session_takes())==2 and not ctl.last_action['ok']
            ctl.snapshot();tag=ctl._selection_tag
            press(11,73,tag)
            assert len(api._session_takes())==1 and ctl.last_action['ok']
            assert api._session_takes()[0]['take_number']==2
            undo=ctl.last_action['undo'];assert undo
            press(11,73,ctl._selection_tag);assert len(api._session_takes())==1 # duplicate cannot delete again
            # Normal recorder Undo path remains usable for hardware deletion.
            assert api.undo_trash(undo)['ok']
            assert len(api._session_takes())==2
            press(12,72);assert api._session is None
            assert bytes([0xBF,119,6]) in fake.feedback
            # A reconnect invalidates any deletion authority from the old epoch.
            send([0xBF,117,1]);assert ctl._selection_tag==0 and ctl._target.value is None
            assert api._transport.controller_state()['state']=='idle'
            api._library_error='temporarily unavailable'
            assert api._transport.controller_state()['state']=='unavailable'
            api._library_error=None
            print('Controller simulator: start, record/keep, bound deletion/Undo, stop and reconnect passed')
        finally:
            ctl.close();api.shutdown()

if __name__=='__main__':main()
