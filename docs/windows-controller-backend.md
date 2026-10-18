# Windows MIDI controller backend

Instrument MIDI retains the recorder's existing pylibremidi backend order:
Windows MIDI Services, then WinMM. When instrument MIDI uses WinMM, controller
ports use a separate WinRT system from the same library. With MIDI Services,
controller and instrument ports share the primary system. If WinRT cannot start,
controller ports fall back to the primary system; WinMM supports wired MIDI but
does not expose Bluetooth MIDI on the tested Windows 11 laptop.

No MIDI bridge, PyWinRT binding or other runtime dependency is added. Instrument
port identities, timestamp selection and recording backend are unchanged. Native
observer, input and output objects remain on their owning threads with COM
initialised there where required. Shutdown closes a separate controller system
after closing the controller; the instrument rig owns the primary system.

Pair in Windows Bluetooth settings and select the controller input in Controls;
the selection saves immediately. Both MIDI directions are required for state feedback. Saved identities
and a unique Bluetooth MIDI IN/OUT label pair identify matching feedback ports.
Ambiguous matches require explicit output selection.

Windows 11 x64 hardware checks cover native Bluetooth handshake, initial song
and take information, recording/keep, playback/record transitions, song and take
selection, volume feedback, feedback loss, board reset and recorder restart.
Command checks use the real BLE device and application control service with test
audio. The actual recorder window also shows the connected controller and applied
volume. These checks do not validate instrument audio/MIDI timestamp alignment
or physical LCD visibility. Pairing alone does not establish application communication.
