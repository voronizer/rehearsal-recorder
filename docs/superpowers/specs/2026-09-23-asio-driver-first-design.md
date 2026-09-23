# ASIO, and choosing the driver before the device

Issue #3: at the rehearsal space a 16-channel Behringer mixer is offered only
with 2 or 8 inputs, while Reaper on the same machine sees all 16 — once its
ASIO driver is chosen.

## Why

The PortAudio that `sounddevice` loads by default on Windows is built without
ASIO, so that audio system never appears. The pip wheel ships a second DLL
with ASIO, loaded when `SD_ENABLE_ASIO` is set before `sounddevice` is
imported. Checked on sounddevice 0.5.6: `_sounddevice_data/portaudio-binaries`
holds `libportaudio64bit.dll` and `libportaudio64bit-asio.dll`, and with the
variable set `query_hostapis()` goes from

    MME, Windows DirectSound, Windows WASAPI, Windows WDM-KS

to

    MME, Windows DirectSound, ASIO, Windows WASAPI, Windows WDM-KS

ASIO is inserted in the middle. Devices are enumerated host API by host API,
so every WASAPI and WDM-KS device index shifts. A `device_index` saved before
this change can point at a different device after it.

The second problem is the list itself. It is flat today: every device of every
audio system in one column, the system written beside each. On Windows that
is one card four or five times with the same name. Adding ASIO makes it one
more copy — the only useful one — which makes choosing correctly harder.

## Part 1 — ASIO on Windows, always

`rehearsal_recorder/__init__.py` sets `SD_ENABLE_ASIO=1` on `win32` with
`os.environ.setdefault`, before anything imports `sounddevice`. That module is
the only place that runs first for every entry point: `python -m`, the console
script and the PyInstaller bundle. `setdefault` leaves a value someone set by
hand alone.

There is no setting for it. As a setting it would need a restart to take
effect, since the variable must be set before the import. With the driver as
the first step of the choice (Part 3), ASIO is simply one more entry in the
driver list, as it is in every other audio program.

The comment beside the line records three things:

- It works only with the pip-installed PortAudio; conda-forge's has no ASIO.
- A custom `portaudio.dll` on `%PATH%` defeats it silently.
- The cost is accepted on purpose: with the ASIO DLL, importing `sounddevice`
  briefly interrupts whatever else is playing when the output device has
  exclusive mode enabled (python-sounddevice issue #496). It happens once, at
  launch, in an app people open in order to record.

### The self-test checks it reached the build

`--selftest` gains a check on Windows only: the `ASIO` host API is present.
Without it the check fails. The release workflow already runs `--selftest` on
the packaged app on a Windows runner, so this answers whether
`collect_data_files("_sounddevice_data")` brings the ASIO DLL into the bundle,
without anyone opening a zip. The check needs no ASIO driver installed: the
host API is listed with zero devices on a machine that has none.

## Part 2 — a saved choice survives renumbering

Both saved choices — the recording interface and the playback output — are
stored as the device's identity alongside its index:

```json
"device_index": 7,
"device": {"name": "X32 USB", "host_api": "ASIO"},
"output_device_index": 3,
"output_device": {"name": "X32 USB", "host_api": "ASIO"}
```

The interface keeps sending and receiving indices. What changes is that
Python, not the interface, decides which index a saved choice means now.

- **Saving** (`set_recording_format`, `save_default_tracks`,
  `set_output_device`): the index is looked up and its name and host API
  written beside it. `None` (the system output) clears the identity.
- **Reading** (`get_settings`, `load_default_tracks`, `player_open`):
  `audio/devices.py` gains `saved_device(config, key, want_input)`, which
  returns the current index or `None`:
  1. An identity is stored: the device with that name and host API that has
     channels in the right direction. The stored index is preferred when it
     still matches, so two identical cards on one machine stay apart;
     otherwise the first match. No match — the card is not plugged in — is
     `None`.
  2. Only an index is stored (a config from before this change):
     - on Windows, `None`. The index may have shifted when ASIO appeared, and
       recording from the wrong device without saying so is worse than being
       asked to choose again. Settings shows "Pick an interface".
     - elsewhere, the index as before. Enumeration there did not change. The
       identity is filled in the next time the choice is saved.

`usable_output` and the recorder's own errors stay as they are: they still
catch an index that is valid but cannot do the job.

A rehearsal in progress keeps the index it started with in its session; the
choice is resolved when the rehearsal starts, not per take.

## Part 3 — the driver, then the device

`_describe_devices` always reports `host_api`, including on macOS, where it
used to be left empty. Whether the name is worth showing is the interface's
decision now.

In Settings → Audio, for **Recording** and for **Playback output** alike:

- **More than one driver has a device for this direction** — two selects:
  *Driver*, then the devices of that driver. Device rows drop the
  ` (WASAPI)` suffix, because the driver is already chosen above. A driver
  with no device for that direction is not listed; ASIO on a machine with no
  ASIO driver therefore does not appear at all.
- **One driver** (every Mac, and any machine with only one audio system) — the
  single device select exactly as today.

The driver shown is the one of the saved device; with nothing saved, the first
in the list. Changing the driver does not save anything by itself — nothing
is chosen until a device is. It narrows the second select, whose placeholder
reads "Pick an interface". For the output the system output stays the first
entry of the device select, under any driver.

The note that one card can appear more than once goes, since that no longer
happens within one list. In its place, shown only when there are several
drivers: "Each driver can offer a different number of inputs. If your
interface shows fewer than it has, try another driver — ASIO, where there is
one, usually offers all of them."

Setup shows the interface in force, by name, taking the index from
`get_settings`, which is now already resolved. When nothing resolves it
falls back to the first input only if every input comes through one driver,
as on a Mac; with several drivers it shows "No interface chosen" and cannot
start, because guessing there would undo the reason a legacy Windows choice
is dropped.

## Not in this change

Both need the mixer and its driver in the room, and are left open on #3:

- Whether `recording_formats` answers usefully through an ASIO driver, which
  usually holds the device exclusively.
- What a person sees when another program takes the card while we are
  monitoring or recording, and when recording and playback both use the same
  card through ASIO. Today they get the PortAudio error text, as for any
  other failure to open.

The pull request refers to #3 and does not close it. The issue is done when a
rehearsal records 16 tracks, which only the rehearsal space can confirm.

## Tests

- **test_engine.py**: saving writes the identity; reading finds the device by
  name and host API after the indices have moved; a duplicate card resolves
  by its stored index; an unplugged card is `None`; a legacy index is kept
  off Windows and dropped on Windows; the system output clears the identity.
  The fake machine gains a second host API for this.
- **test_platform.py**: `SD_ENABLE_ASIO` is set on `win32` and not elsewhere,
  and a value already present is left alone.
- **test_interface.py**: with several drivers, the driver select is shown,
  lists only drivers that have devices in that direction, and narrows the
  device list; with one driver it is absent — for recording and for output.

## Documentation

`docs/design-notes.md` ("Picking an interface"), `docs/using-it.md` (the
Settings → Audio line) and an Unreleased entry in `CHANGELOG.md`.
