"""Local previews commit a single generation-bound absolute choice on release."""
import tempfile
from pathlib import Path
from test_engine import fresh_api, np, SR
from fake_midi import FakePortSystem
from rehearsal_recorder.midi.ports import PortInfo
from rehearsal_recorder.midi.controller import Controller
from rehearsal_recorder.midi.browse import Frame, frame, number, index, catalog_frames

def main():
    f=Frame()
    for cc,value in frame(4,number(123)+index(511)):f.receive(cc,value)
    assert f.consume()==(4,123,511) and f.consume() is None
    for cc,value in frame(5,number(123)+index(1))[:-1]:f.receive(cc,value)
    f.receive(93,0);assert f.consume() is None
    with tempfile.TemporaryDirectory() as temp:
        _,api=fresh_api(Path(temp));fake=FakePortSystem([PortInfo('C3',id='in')],exclusive=True)
        fake._outputs=[PortInfo('C3 feedback',id='out')];ctl=Controller(fake,api._transport,threads=False)
        try:
            ctl.configure({'input':fake.inputs()[0].saved(),'output':fake.outputs()[0].saved()});ctl.tick()
            def send(msg):assert fake.send('C3',0,bytes(msg));ctl.tick()
            def press(token,note,tag=None,choice=0,run=True):
                if tag is not None:
                    for cc,v in frame(note-70,number(tag)+index(choice)):send([0xBF,cc,v])
                send([0xBF,113,token]);send([0x9F,note,127]);send([0x8F,note,0])
                if run:ctl.run_action()
            send([0xBF,117,1]);send([0xBF,111,15]);assert bytes([0xBF,110,1]) in fake.feedback
            assert ctl._browse_tag and ctl._browse_values==((),(),16383,16383)
            for _ in range(30):ctl.tick()
            assert not ctl._browse_frames # explicitly empty idle catalog is complete
            assert api.start_rehearsal('Browse',0,SR,[{'name':'Guitar','channel':1}])['ok']
            api._session['set']={'songs':['One','Two','Three']};api.set_next_take_name('One')
            for _ in range(2):
                assert api._transport.command('record_stop')['ok']
                api._recorder._callback(np.full((512,1),1000,dtype=np.int32),512,None,None)
                assert api._transport.command('record_stop')['ok']
            ctl.snapshot();tag=ctl._browse_tag
            for _ in range(200):ctl.tick()
            assert not ctl._browse_frames and bytes([0xBF,90,3]) in fake.feedback
            assert ctl._browse_values==(('One','Two','Three'),(1,2),0,1)
            assert api._transport.state()['playback_take_number']==2 # no selection while merely receiving preview data
            press(1,74,tag,0);assert ctl.last_action['ok'] and api._transport.state()['playback_take_number']==1
            seq=ctl.last_action['sequence'];press(1,74,tag,1)
            assert ctl.last_action['sequence']==seq and api._transport.state()['playback_take_number']==1
            press(2,75,tag,1);assert not ctl.last_action.get('sequence')==seq+1 # old generation cannot retarget
            assert api._next_take()['song']=='One'
            tag=ctl._browse_tag;press(3,75,tag,1)
            assert ctl.last_action['ok'] and api._next_take()['song']=='Two'
            assert api._transport.state()['playback_take_number']==0
            press(4,74,ctl._browse_tag,0);assert api._player is None
            tag=ctl._browse_tag;press(5,75,tag,2,run=False)
            api.set_next_take_name('One');ctl.run_action()
            assert not ctl.last_action['ok'] and api._next_take()['song']=='One'
            ctl.snapshot();tag=ctl._browse_tag
            # Missing/partial payload is rejected without touching playback/song.
            press(6,75);assert api._next_take()['song']=='One'
            for cc,v in frame(5,number(tag)+index(2))[:-1]:send([0xBF,cc,v])
            press(7,75);assert api._next_take()['song']=='One'
            before=len(api._session_takes());send([0xBF,89,1])
            assert ctl._browse_frames and len(api._session_takes())==before
            for cc,v in frame(5,number(ctl._browse_tag)+index(2)):send([0xBF,cc,v])
            send([0xBF,117,1]);send([0xBF,111,15]);press(8,75)
            assert api._next_take()['song']=='One' and api._recorder is None
            # A queued choice must be checked again after another caller starts recording.
            ctl.snapshot();tag=ctl._browse_tag
            press(9,74,tag,0,run=False)
            assert api.control_command('start')['ok']
            ctl.run_action()
            assert not ctl.last_action['ok']
            assert api._recorder is not None and not api.player_state().get('open')
            assert api.control_command('stop_keep')['ok']
            api._session['set'] = {'songs': [f'Song {n}' for n in range(150)]}
            api.set_next_take_name('Song 149')
            limited = ctl._catalog()['values']
            assert len(limited[0]) == 128
            assert limited[0][0] == 'Song 0' and limited[0][limited[2]] == 'Song 149'
            assert len(api.control_catalog()['songs']) >= 150
            print('Release selection: catalog, absolute choice, duplicate/stale/cancel/empty/reconnect cases passed')
        finally:ctl.close();api.shutdown()
if __name__=='__main__':main()
