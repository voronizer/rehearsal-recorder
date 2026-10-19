# Controller development and diagnostics

The controller remains separate from instrument MIDI inputs. Protocol routing
uses the configured dedicated input/output pair. The adapter uses the shared ControlAPI and the existing pylibremidi backend.
The [shared API](control-api.md) also supports non-MIDI adapters.

## Hardware-free regression

From the recorder checkout, using its existing Python environment:

```sh
python tests/test_controller_extensions.py
python tests/test_controller_recovery.py
python tests/test_controller_diagnostics.py
python tests/run_all.py
```

These are executable scripts, not pytest modules. Each exits nonzero on failure.
The simulated C3 sends the real channel-16 CC/note handshake and commands into
Controller, backed by real Transport and a temporary library. Audio devices,
MIDI ports and samples are simulated. It tests negotiated idle state, start,
record/keep, immutable selected-take removal, stale/missing references,
duplicate commands, Undo, stop and reconnect. Recovery tests cover navigation
and closing playback output before recording on exclusive audio devices.
No physical MIDI driver, BLE connection, microphone or user library is used.
This tests host semantics; it cannot establish Windows BLE or LCD performance.

## Optional host trace

Set REHA_CONTROLLER_TRACE only for the recorder process. POSIX shell example:

```sh
REHA_CONTROLLER_TRACE=/absolute/path/controller.log python -u -m rehearsal_recorder
```

Windows PowerShell, inside an existing configured recorder environment:

```powershell
$env:REHA_CONTROLLER_TRACE = Join-Path $PWD 'controller.log'
python -u -m rehearsal_recorder
# When finished, close the recorder and remove the process environment override:
Remove-Item Env:REHA_CONTROLLER_TRACE
```

No trace is created without the variable. It rotates at 2 MiB, keeping two
backups. JSON events have a UTC prefix and monotonic nanoseconds; fields include
port opening, HELLO/capabilities, confirmed state, command token/note, results
and execution duration. Logs may contain device names or error paths; inspect
before sharing. A trace setup failure does not prevent recorder startup.
Unset the variable and restart to disable. Delete the chosen log and its .1/.2
backups when no longer needed. No listener or global OS setting is added.

## Added host behaviours

Healthy recorder with no rehearsal is distinct from a recorder fault on peers
that negotiate lifecycle support. Start uses the saved valid input, track
layout and next set. Missing input is rejected rather than silently selecting a
new device. Stop preserves kept takes and requires recording/playback stopped.
Remove uses the existing undoable deletion path, checks concrete database/file
identity again at execution, and exposes the ordinary Undo toast in the UI.
Legacy peers retain their prior capabilities and unavailable state at idle.

## Take browsing

TAKE + encoder browses kept takes for the selected song in the current rehearsal.
The first/last take clamps silently. Songs with no takes stay at T0 and both
turn directions succeed without changing playback or showing an error.
The displayed latest take anchors the first turn when playback is closed.
TAKE never borrows another song's take; SONG changes the selected song.


## Local preview and release selection

New controllers negotiate remote capability8 and receive CC110=1 plus a bounded
song/take catalog. Actual names/numbers are previewed locally; only release sends
one generation-bound absolute Select Take/Select Song request. Existing relative
navigation remains supported for old peers/diagnostics. The worker rejects stale
catalog identities before opening playback/changing the next song. Back/cancel
never sends a selection. Tests/test_controller_browse.py covers this protocol
with fake MIDI/audio and temporary recordings. run_all.py runs fourteen suites.
The optional Mac bridge must also route CC89..93, CC110 and Notes74/75.
