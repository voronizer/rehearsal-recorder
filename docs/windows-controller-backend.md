# Windows MIDI controller backend

Instrument MIDI keeps the recorder's pylibremidi backend order: Windows MIDI
Services, then WinMM. On Windows the controller's ports go through WinRT
itself, with pywinrt (`src/rehearsal_recorder/midi/winrt_ports.py`), whichever
system the instruments use. If pywinrt cannot start, the controller falls back
to the instruments' system, which serves wired controllers; WinMM does not
expose Bluetooth MIDI on the tested Windows 11 laptop.

The controller used pylibremidi's own WinRT before. A paired Bluetooth
controller that is switched off stays in WinRT's list, and libremidi
opens a port with a wait that has no end (`get(MidiInPort::FromIdAsync(id))`
in `backends/winuwp/helpers.hpp`), while its Python binding holds the GIL for
the whole call (pylibremidi 5.4.3). No Python ran until Windows answered, so
the app stayed on its startup window until the controller was taken out of
the config. Steinberg describes the same hang for Cubase started with a
Bluetooth MIDI device off. pylibremidi's open on MIDI Services is a
synchronous call under the GIL too, so the controller uses WinRT there as
well. On such a computer the id saved for the controller is a MIDI Services
one, so the controller is found again only if WinRT gives its port the same
name; if not, it has to be picked again once in Controls. The instruments'
port lists leave the controller out by the same match, so where the names
differ it can be listed there too.

pywinrt (winrt-runtime 4.0.3) lets go of the GIL for each call into WinRT, and
an open's result comes to a Completed handler. The app waits for it at most
10 s (`OPEN_PATIENCE_SEC`) and then gives the open up: Controls says once that
the controller does not answer, and no port is tried again for 5 s
(`RETRY_SEC`). The crash log says so once, until the controller opens. A port
Windows opens after the app gave up on it is closed, so it does not hold the
controller against the next try. Choosing another controller in Controls gives
up an open that waits, and the new one is tried at once.

Ports are listed by a DeviceWatcher for each direction, on MidiInPort's and
MidiOutPort's selectors, as libremidi's WinRT observer listed them: a port's
name is the DeviceInformation's Name and its id the Id, with no device or
maker, so a controller saved with the old backend is found again. A watcher
Windows stops (Aborted) is started again within a second and lists the ports
afresh. Messages are stamped when they arrive; the controller does not use the
time.

The packages are `winrt-Windows.Devices.Midi` and
`winrt-Windows.Devices.Enumeration`, Windows only, which bring
`winrt-runtime`, `winrt-Windows.Foundation`,
`winrt-Windows.Foundation.Collections` and `winrt-Windows.Storage.Streams`.
pywinrt needs Python 3.11 or later; on 3.10 they are not installed and the
controller falls back as above. winrt-runtime has its own PyInstaller hook,
which collects the tables its modules read, so the spec names none of them.
`--selftest` on Windows lists the controller's ports and asks for one that is
not there, which Windows must refuse at once. Shutdown closes the controller's
system before the controller, so an open still waiting gives up at once.

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
They were made on pylibremidi's WinRT backend and are owed again on pywinrt.
