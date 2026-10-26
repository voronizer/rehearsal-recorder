# Recorder control API

The GUI and MIDI adapter call the same Python control interface.
`control.ControlAPI` defines the contract; `transport.Transport` implements it.
Python adapters obtain the interface from `api.controls`. The existing `Api`
exposes bridge methods for the GUI. MIDI receives the control
interface directly. No REST server is added.
`start_rehearsal` accepts an explicit setup (name, device_index, samplerate, tracks,
optional bit_depth/set_id/lineup); without parameters it uses the saved recording setup
and keeps last time's lineup.

## Interface

| Method | Result |
| --- | --- |
| `execute(action, parameters=None, on_accept=None, wait=False)` | Structured action result; remote overlap returns `busy`, GUI calls wait |
| `snapshot()` | Confirmed state, revision and recent semantic action results |
| `catalog()` | Songs, take numbers, selected identities and an opaque catalog revision |
| `flush_settings()` | Persist debounced playback settings |

The GUI bridge exposes `control_command`, `control_state` and `control_catalog`.
The Python service is excluded from pywebview's recursive API discovery.
`control_state` also supports the existing read-only polling endpoint.
The older `transport_command` and `transport_state` remain compatibility methods.

## Commands

- Recording: `start`, `stop_review`, `stop_keep`, `record_stop`, `retry_save`.
- Playback: `play_stop`, `restart`, `seek_back`, `seek_forward`, `mute_toggle`.
- Volume: `set_volume`, `adjust_volume`, `volume_operations`.
- Selection: `select_song`, `select_take`, `previous_song`, `next_song`, `previous_take`, `next_take`.
- Rehearsal: `start_rehearsal`, `stop_rehearsal`.
- Removal: `remove_take`.

Laptop Stop sends `stop_review`, leaving a draft on Review for Save take or Discard.
The MIDI Record/Stop command sends `record_stop`, which stops and keeps an active
take. Configuring MIDI does not change the laptop's Stop behaviour.

## Parameters

```python
controls = api.controls
controls.execute("set_volume", {"level": 0.5})
controls.execute("adjust_volume", {"delta": -0.1})

catalog = controls.catalog()
controls.execute("select_song", {
    "target": {"catalog": catalog["identity"], "song": catalog["songs"][0]}
})
controls.execute("select_take", {
    "target": {"catalog": catalog["identity"], "take": catalog["takes"][0]}
})

state = controls.snapshot()
controls.execute("remove_take", {"target": state["selection_reference"]})
```

Volume levels are normalised to 0–1. Relative changes use the same scale.
`volume_operations` accepts an ordered list of `("set", level)` / `("adjust", delta)`
pairs, limited to 128 operations. Optional integer `resolution` specifies the
number of steps over 0–1. MIDI uses 127; the shared service has no fixed MIDI range.

Catalog and removal references are opaque strings. A changed catalog rejects an
old selection request. Removal captures the selected take's database/file identity
and checks it again under the file lock before deletion. Normal Undo remains
available. No take means a null removal reference.

## Execution

1. An adapter decodes its input and calls `execute` with a semantic action.
2. The shared service acquires its action gate. Remote calls return `busy` when
   occupied. GUI bridge calls use `wait=True`; existing GUI operations also wait.
   They retain their original behaviour instead of silently dropping a click.
3. Current recorder state and captured identities are checked under that gate.
4. `on_accept`, when supplied, runs before audio/file work. It reports admission,
   not successful completion. It must return promptly. Its failure is logged
   separately and cannot cancel an admitted recorder operation.
5. Existing recorder/player/library operations execute on the caller's worker.
6. The result and confirmed state become available to the GUI and adapters.

`ok: false` results identify `busy`, `unavailable` or `error`. Failed saves retain
recoverable work. Commands are not automatically replayed. State reads do not wait
for finalisation, so adapters can report Saving while work continues.

## Updates

Snapshots contain `revision`, `action_sequence` and the last 64 semantic action
results in `events`. Each event has a sequence, action, success flag, error and
optional Undo token. Consumers deduplicate by sequence. Volume changes update
state without adding action events. Elapsed time and the transient busy flag do
not advance the state revision. Consumers refresh a full snapshot after a gap
or application restart; this bounded list is not a durable event log.

The GUI observes the shared state regardless of MIDI configuration. It uses
semantic action names to refresh selections and offer Undo. MIDI note/CC numbers
remain inside the MIDI adapter.

## Boundaries and tests

MIDI owns port connections, protocol negotiation, channel/note/CC numbers, tokens,
heartbeat, framing, text formatting and device catalog limits. The common API
owns action validation and serialisation. Existing recorder operations own saving,
recovery and discard; adapters do not implement recovery policies. The implemented callers are the GUI and MIDI adapter. No additional adapter
or placeholder implementation is included.

`tests/test_control_api.py` exercises JSON bridge calls without MIDI enabled.
It covers Review versus Keep, state/results, bound selection, volume and overlap.
`tests/test_controller_browse.py` covers a queued MIDI selection followed by a
recording start before execution. The selection is rejected without opening
playback. Existing controller tests cover the unchanged MIDI protocol.

## Readiness and resynchronisation

`snapshot().readiness` is `busy`, `attention`, `ready` or `idle`:

- `busy`: an application action owns the gate or a take is being finalised.
- `attention`: a library problem or an unfinished take requires the recorder UI.
- `ready`: the rehearsal accepts commands subject to each command's rules.
- `idle`: no rehearsal is active; starting one remains available.

A failed operation remains in `last_error` and semantic results. It blocks new
work only while the recorder still has the associated unfinished take or library
problem. Successful existing Keep, Recover or Discard operations clear matching
integration bookkeeping. No adapter saves, discards or repairs a take on its own.

Adapters publish current readiness after work and periodically. A remote client
may ask for a fresh snapshot after a timeout. A readiness update can clear stale
client-side pending/error indicators; it does not force-release application locks.
Commands, especially recording/playback toggles, are never retried automatically.
A lost connection cannot cancel an operation already accepted by the recorder.

The controller follows the active rehearsal. History playback without an active
rehearsal leaves the controller idle and does not expose History playback controls.
The GUI shares one control-state poll between App and Rehearsal while a controller
is configured. A lightweight controller-status check detects configuration changes
without reading the library when controller support is disabled. Player polling
includes track identity and ignores a different player's timeline; closing
playback stops the local cursor.

The header uses its existing muted speaker icon for confirmed master mute.
Muting does not change the saved listening volume.

Volume changes are rate-limited by the firmware (currently 50 ms). The MIDI
adapter stores at most an absolute level followed by accumulated relative movement.
A newer absolute level replaces earlier pending movements. When the API is busy,
the adapter combines subsequent movements and retries later. Intermediate clamping
of individual detents is not preserved within a combined relative update. Recorder
feedback supplies the applied volume. A controller-only mute is cleared on
controller disconnect; if the gate is occupied, clearing waits for it to finish.
