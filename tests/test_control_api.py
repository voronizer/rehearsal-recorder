"""Common controls through JSON bridge calls with no MIDI connection."""
import json
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from test_engine import fresh_api, np, SR


class BridgeCaller:
    def __init__(self, api):
        self.api = api

    def execute(self, action, parameters=None):
        request = json.loads(json.dumps({"action": action, "parameters": parameters}))
        return self.api.control_command(request["action"], request["parameters"])

    def state(self):
        return json.loads(json.dumps(self.api.control_state()))


def check_bridge_discovery(api):
    from webview import util

    scripts = []
    window = SimpleNamespace(
        _js_api=api, _functions={}, _expose_lock=threading.RLock(),
        run_js=scripts.append,
        events=SimpleNamespace(before_load=threading.Event(),
                               loaded=threading.Event(),
                               _pywebviewready=threading.Event()))
    with patch.object(util, 'load_js_files', return_value=('', '%(functions)s')):
        util.inject_pywebview('test', window)
        assert window.events.loaded.wait(10)
    exposed = {entry['func'] for entry in json.loads(scripts[-1])}
    assert {'control_command', 'control_state', 'control_catalog'} <= exposed
    assert not any(name.startswith('controls.') for name in exposed)


def check_controller_backend_lifetime(folder):
    import rehearsal_recorder.api as module
    from fake_midi import FakePortSystem
    from rehearsal_recorder.midi.ports import PortInfo

    instruments = FakePortSystem([PortInfo('Instrument', id='instrument')])
    controller = FakePortSystem([PortInfo('Remote', id='controller-input')])
    controller._outputs = [PortInfo('Remote', id='controller-output')]
    with patch.object(module, 'open_midi_system', return_value=(instruments, None)), patch.object(module.midiports, 'open_controller_system', return_value=controller):
        _, api = fresh_api(folder)
    try:
        assert api._midi_system is instruments and api._controller.system is controller
        assert api.controller_ports()['inputs'][0]['name'] == 'Remote'
        assert api.list_midi_ports()['ports'][0]['name'] == 'Instrument'
        assert api.set_controller(controller.inputs()[0].saved())['ok']
        assert instruments.inputs()[0].name == 'Instrument'
    finally:
        api.shutdown()
    assert instruments._closed and controller._closed


def main():
    with tempfile.TemporaryDirectory() as folder:
        check_controller_backend_lifetime(Path(folder) / 'backends')
        _, api = fresh_api(Path(folder))
        adapter = BridgeCaller(api)
        try:
            assert api.controls is api._transport
            check_bridge_discovery(api)
            assert not api.controller_state()['enabled']
            assert adapter.state()['state'] == 'idle'
            assert 'automatic_keep' not in api.get_settings()
            assert adapter.execute('start_rehearsal', {'name':'API', 'device_index':0, 'samplerate':SR, 'tracks':[{'name':'Guitar','channel':1}]})['ok']
            api._session['set'] = {'songs': ['One', 'Empty']}
            api.set_next_take_name('One')
            # Laptop Stop leaves a draft for Review even if an old config enabled automatic keeping.
            api._config['automatic_keep'] = True
            assert adapter.execute('start')['ok']
            api._recorder._callback(np.full((512,1),1000,dtype=np.int32),512,None,None)
            review = adapter.execute('stop_review')
            assert review['ok'] and not api._session_takes()
            assert adapter.state()['pending_take']['take_number'] == 1
            assert not adapter.execute('start')['ok']
            assert api.keep_take(review['take_number'],review['temp_dir'],'One',review['duration_sec'],review['tracks'])['ok']
            assert adapter.state()['state'] == 'ready'
            # Explicit stop-and-keep is available to any adapter.
            assert adapter.execute('record_stop')['ok']
            api._recorder._callback(np.full((512,1),1000,dtype=np.int32),512,None,None)
            assert adapter.execute('record_stop')['ok'] and len(api._session_takes()) == 2
            api._transport.error = 'Save needs recovery'
            assert adapter.execute('set_volume', {'level':0.6})['ok']
            assert adapter.state()['error'] is None
            api._transport.error = None
            events = adapter.state()['events']
            assert events[-1]['action'] == 'record_stop' and events[-1]['ok']
            assert all('note' not in e and 'token' not in e for e in events)
            catalog = api.control_catalog()
            assert not adapter.execute('select_take', {'target':{'catalog':catalog['identity'], 'take':True}})['ok']
            target = {'catalog':catalog['identity'], 'take':1}
            assert adapter.execute('select_take', {'target':target})['ok']
            # State is rechecked under the gate, not only when a request arrives.
            catalog = api.control_catalog()
            target = {'catalog':catalog['identity'], 'take':2}
            assert adapter.execute('start')['ok']
            assert adapter.execute('select_take', {'target':target})['result'] == 'busy'
            assert not api.player_state().get('open')
            assert adapter.execute('stop_keep')['ok']
            assert not adapter.execute('select_take', {'target':target})['ok']
            # Catalog size limits belong to adapters, not the recorder API.
            api._session['set'] = {'songs':['One', *[f'Song {n}' for n in range(130)]]}
            catalog = api.control_catalog()
            assert len(catalog['songs']) == 131 and len(catalog['identity']) == 64
            target = {'catalog':catalog['identity'], 'song':'Song 129'}
            assert adapter.execute('select_song', {'target':target})['ok']
            assert adapter.state()['playback_take_number'] == 0
            # Normalised volume has no fixed MIDI range.
            assert adapter.execute('set_volume', {'level':0.4})['ok']
            assert adapter.execute('adjust_volume', {'delta':0.1})['ok']
            assert abs(adapter.state()['master_volume']-0.5) < 1e-9
            assert not adapter.execute('set_volume', {'level':2})['ok']
            assert not adapter.execute('set_volume', {'level':True})['ok']
            # Other callers receive busy while an action owns the same gate.
            entered, release = threading.Event(), threading.Event()
            def hold():
                def work():
                    entered.set(); assert release.wait(5)
                api._transport.run(work)
            thread = threading.Thread(target=hold);thread.start();assert entered.wait(5)
            try: assert api.controls.execute('start')['result'] == 'busy'
            finally: release.set();thread.join(5)
            assert not thread.is_alive()
            # Stop Review remains Saving even after stop_take clears its own
            # stopping flag, until the pending take is published atomically.
            assert adapter.execute('start')['ok']
            api._recorder._callback(np.full((512, 1), 1000, dtype=np.int32), 512, None, None)
            original_stop = api.stop_take
            stopped, finish_stop = threading.Event(), threading.Event()
            stop_results = []
            def slow_stop():
                result = original_stop()
                stopped.set()
                assert finish_stop.wait(5)
                return result
            api.stop_take = slow_stop
            stop_thread = threading.Thread(target=lambda: stop_results.append(adapter.execute('stop_review')))
            stop_thread.start()
            assert stopped.wait(5)
            try:
                state = adapter.state()
                assert state['state'] == 'saving' and state['readiness'] == 'busy'
                assert state['pending_take'] is None and not api._stopping
            finally:
                finish_stop.set()
                stop_thread.join(5)
                api.stop_take = original_stop
            assert not stop_thread.is_alive() and stop_results[0]['ok']
            pending = stop_results[0]
            assert adapter.state()['readiness'] == 'attention'
            assert api.keep_take(pending['take_number'], pending['temp_dir'], 'One', pending['duration_sec'], pending['tracks'])['ok']
            # A failed acknowledgement cannot prevent a validated action.
            def broken_feedback():
                raise OSError('Feedback queue closed')
            assert api.controls.execute('start', on_accept=broken_feedback)['ok']
            assert adapter.state()['state'] == 'recording'
            assert api.controls.execute('stop_keep', on_accept=broken_feedback)['ok']
            assert adapter.state()['readiness'] == 'ready'
            # Starting a recording releases playback but restores it on failure.
            take = api._session_takes()[0]
            assert api.player_open(take['tracks'])['ok']
            api.player_seek(0.001)
            old_start = api.start_take
            api.start_take = lambda: {'ok': False, 'error': 'Input device absent'}
            try:
                assert not adapter.execute('start')['ok']
                state = api.player_state()
                assert state['open'] and not state['playing']
                assert abs(state['position'] - 0.001) < 0.001
            finally:
                api.start_take = old_start
                api.player_close()
            # Internal crop/Undo recovery may reopen under the file lock.
            # It must finish even when another action holds the gate and waits
            # for those files; only the public player entry acquires the gate.
            files_owned, gate_owned = threading.Event(), threading.Event()
            reopen_results = []
            def reopen_under_files():
                with api._files_lock:
                    files_owned.set()
                    assert gate_owned.wait(5)
                    reopen_results.append(api._player_open(take['tracks']))
            def wait_for_files():
                def work():
                    gate_owned.set()
                    with api._files_lock:
                        return {'ok': True}
                api._transport.run(work, wait=True)
            internal = threading.Thread(target=reopen_under_files, daemon=True)
            internal.start()
            assert files_owned.wait(5)
            gated = threading.Thread(target=wait_for_files, daemon=True)
            gated.start()
            internal.join(5)
            gated.join(5)
            assert not internal.is_alive() and not gated.is_alive()
            assert reopen_results[0]['ok']
            api.player_close()
            # History playback does not advertise a rehearsal transport state.
            assert adapter.execute('stop_rehearsal')['ok']
            assert adapter.state()['state'] == 'idle'
            assert api.player_open(take['tracks'])['ok']
            assert api.player_play()['ok']
            assert adapter.state()['state'] == 'idle'
            assert not adapter.state()['playback_open']
            assert adapter.execute('start_rehearsal', {'name':'Next', 'device_index':0, 'samplerate':SR, 'tracks':[{'name':'Guitar','channel':1}]})['ok']
            assert api.player_state()['playing']
            assert adapter.state()['state'] == 'ready' and not adapter.state()['playback_open']
            assert not adapter.execute('play_stop')['ok']
            assert api.player_state()['playing']
            print('Control API: JSON bridge, review/keep, bound selection, execution state, catalog limits, volume and shared gate passed')
        finally:
            api.shutdown()


if __name__ == '__main__':
    main()
