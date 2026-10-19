# Recorder control integration

This contribution adds a shared control API and a MIDI adapter. The GUI and MIDI
use the same recorder action gate. Other adapters can call the Python interface
without depending on MIDI ports or message formats.

The GUI retains Record take → Stop → Review → Save take/Discard. Controller Record/Stop
starts recording or stops and keeps a take. Playback, volume, selection, rehearsal
lifecycle and confirmed take removal use semantic commands. State feedback
includes recovery information. MIDI disconnect does not stop recording or saving.

The dedicated controller input is excluded from instrument MIDI capture.
Settings › Controls saves input and feedback output selections immediately.
The tab uses the shared Settings groups and notice slot. MIDI uses the
recorder's existing pylibremidi dependency and retains the existing Windows
MIDI Services/WinMM backend selection. The macOS settings button opens Apple's
Bluetooth MIDI picker.

- [Control API and command path](control-api.md)
- [MIDI adapter](controller/midi.md)
- [Diagnostics](controller-debugging.md)
- [Windows backend](windows-controller-backend.md)

The contribution adds no runtime dependency, separate packager or REST server.
Controller firmware and enclosure hardware are maintained outside this repository.
