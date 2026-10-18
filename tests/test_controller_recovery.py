"""Controller regressions with real temporary WAVs/library and fake audio only."""
import tempfile
from pathlib import Path
from test_engine import fresh_api, np, SR


def main():
    with tempfile.TemporaryDirectory() as folder:
        _, api = fresh_api(Path(folder))
        try:
            t=api._transport
            assert api.start_rehearsal("Recovery",0,SR,[{"name":"Guitar","channel":1}])["ok"]
            assert t.command('previous_take')['unchanged']
            assert t.command('next_take')['unchanged']
            assert t.state()['playback_take_number']==0
            api._session['set']={'songs':['First','Second','Third']}
            api.set_next_take_name('First')
            assert t.state()['playback_take_number']==0
            for title in ['Second','Third']:
                assert t.command('next_song')['ok']
                assert t.state()['next_take_name']==title
                assert t.state()['playback_take_number']==0
            assert t.command('next_song')['result']=='unavailable'
            assert t.state()['state']=='ready' and t.error is None
            assert t.command('previous_song')['ok']
            # Ordinary failures cannot poison later commands until app restart.
            original=api.set_next_take_name
            api.set_next_take_name=lambda *_: (_ for _ in ()).throw(OSError('temporary navigation failure'))
            assert t.command('previous_song')['result']=='error'
            assert t.state()['state']=='ready' and t.error is None
            api.set_next_take_name=original
            assert t.command('previous_song')['ok']
            def record():
                assert t.command('record_stop')['ok']
                api._recorder._callback(np.full((512,1),1000,dtype=np.int32),512,None,None)
                assert t.command('record_stop')['ok']
            record()
            assert t.state()['playback_take_number']==1
            assert t.command('play_stop')['ok']
            original_start=api.start_take
            def exclusive_start():
                assert api._player is None, 'output stream must be closed before record'
                return original_start()
            api.start_take=exclusive_start
            record()
            assert len(api._session_takes())==2
            assert t.state()['playback_take_number']==2
            assert t.command('play_stop')['ok'] and t.playback_take_number==2
            assert t.command('play_stop')['ok']
            # With no player open after saving, the displayed latest take is
            # the navigation anchor: the first backwards detent must move.
            api.player_close()
            assert t.state()['playback_take_number']==2
            assert t.command('previous_take')['ok'] and t.playback_take_number==1
            player=api._player
            assert t.command('previous_take')['unchanged']
            assert api._player is player # a boundary must not reopen/interrupt playback
            assert t.command('next_song')['ok']
            assert t.state()['playback_take_number']==0 and t.state()['next_take_name']=='Second'
            for action in ['previous_take','next_take']:
                result=t.command(action)
                assert result['ok'] and result['unchanged']
                assert t.state()['playback_take_number']==0
                assert api._player is None
                assert t.selection_reference() is None
                assert t.state()['next_take_name']=='Second'
            assert t.command('play_stop')['result']=='unavailable'
            assert t.state()['state']=='ready'
            assert t.command('previous_song')['ok']
            assert t.command('play_stop')['ok'] and t.playback_take_number==2
            # Saving errors remain latched; recorded drafts are never thrown away.
            assert t.command('record_stop')['ok']
            api._recorder._callback(np.full((512,1),1000,dtype=np.int32),512,None,None)
            keep=api.keep_take
            api.keep_take=lambda *a,**k:{'ok':False,'error':'Disk refused'}
            assert not t.command('record_stop')['ok']
            assert t.pending_take and t.state()['state']=='error'
            assert not t.command('record_stop')['ok']
            api.keep_take=keep
            assert t.command('retry_save')['ok'] and t.state()['state']=='ready'
            print('Controller state/navigation recovery: passed')
        finally:
            api.shutdown()

if __name__=='__main__':main()
