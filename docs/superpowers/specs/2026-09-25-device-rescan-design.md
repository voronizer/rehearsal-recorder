# Looking for interfaces again

An interface plugged in after the app has started is not offered until the
app is restarted. At a rehearsal that is the usual order of things: the
laptop is opened first, the desk is cabled and switched on after, and an XR18
takes longer to boot than a Mac does to wake.

## Why

PortAudio builds its list of devices once, in `Pa_Initialize`, which
sounddevice calls when it is imported. Nothing rebuilds it afterwards:
`sd.query_devices()` reads the list PortAudio made at start, and a card that
arrived later is not in it. Only `Pa_Terminate` followed by `Pa_Initialize`
makes a new one.

`Pa_Initialize` is counted. `Pa_Terminate` tears the host APIs down only when
the count comes back to zero (`pa_front.c:398-415`), so a single terminate
after two initialises rebuilds nothing.

Tearing down is not harmless while anything is open. `Pa_Terminate` closes
every open stream itself (`CloseOpenStreams`, `pa_front.c:343`) and leaves
the Python stream objects pointing at memory PortAudio has freed. The next
call on one of them, or the next block its callback is handed, is a crash
rather than an error.

## Part 1 — Rebuilding the list

`audio/devices.py` gains `rescan()`. Under `STREAM_LOCK` it terminates
PortAudio as many times as sounddevice has initialised it, then initialises
it the same number of times. It returns `None`, or the driver's words when
PortAudio would not come back.

A failed initialise is tried once more. When the second fails too, the app
has no audio until it is restarted, and the sentence says so.

`sd._terminate`, `sd._initialize` and `sd._initialized` are private to
sounddevice. They are what sounddevice's own exit handler uses (0.5.6), but
a release could rename them. `rescan()` checks for all
three before touching anything, and when one is missing it changes nothing
and says that looking again needs a restart. The build's self-test runs a
real rescan, so a sounddevice that lost them fails the build rather than the
rehearsal.

## Part 2 — What has to be let go first

`Api.rescan_devices()` settles every stream the app has before calling
`rescan()`:

- **A recording** refuses the rescan. Nothing about a take is worth risking
  for a device list.
- **The signal check** is stopped. It is only a check, and the setup screen
  stops it itself before asking.
- **The player** has its output closed and, after the rescan, reopened on
  the saved playback device found again by its name and audio system, at the
  same position, playing if it was. Only the stream is closed: the take stays
  loaded.

Asking a card which rates it takes, and listing the devices, also hold
`STREAM_LOCK`. On ASIO the first can take a second or more per rate, and a
rescan arriving meanwhile waits for the answer rather than pulling PortAudio
out from under it.

The answer names what changed, by device name: `found` for names that were
not in the list before, `gone` for names that are no longer in it.

## Part 3 — The screens

**Settings → Audio.** A **Look again** button beside the recording
interface's picker rebuilds the list for both recording and playback. Afterwards the lists and
settings are read again and the card is asked for its rates again, since the
rates on a desk are set on the desk. The status line says what happened:
`Found “X18/XR18”`, `“X18/XR18” is gone`, or `No new interfaces`. While
looking, the button reads **Looking…** and the device pickers are disabled.

When the saved recording interface is not in the list, its picker reads
`“X18/XR18” is not connected` rather than `Pick an interface`.

**Setup.** When the saved recording interface is not in the list, **Recording
with** says `“X18/XR18” is not connected`, with **Look again** beside it. It
used to say `No interface chosen`, which is wrong — it was chosen — and on a
Mac it did not say even that: the screen quietly took the first input in the
list, usually the laptop's own microphone. Guessing the first input is kept
for a first run, where nothing was ever chosen.

When the card turns up, the tracks take the inputs that card remembers. The
names and stereo switches stay as they are on the screen: whatever was
edited while the card was missing is kept.
`load_default_tracks(band)` takes the band to place; without one it uses the
saved band, as it does now.

`get_settings` reports the saved-but-absent interface as `missing_device`,
`{name, host_api}`, or `null`.

## Not done

**Noticing a new card without a button.** macOS and Windows both announce
device changes, but PortAudio does not pass the announcement on, and acting
on it means a rescan. On Windows `Pa_Initialize` loads every installed ASIO
driver in turn (`pa_asio.cpp:1016-1080`) — the load-and-unload the ASIO
backend is already careful to do as little of as possible — and done on a
timer, or on the window regaining focus, that would happen in the middle of
a song. A button does it when somebody asks, and never while recording.

## Tests

`test_engine.py`:

- A rescan finds a card added after start, and says which; one taken away is
  named as gone.
- A rescan during a recording is refused, and PortAudio is not touched.
- The signal check is stopped; the player's output is closed before PortAudio
  is torn down and reopened after, at the same position.
- Two initialisations are undone as two, and put back as two.
- Without sounddevice's private calls nothing is touched, and the answer says
  to restart.
- A failed initialise is tried again; two failures say to restart.
- Asking a card its rates holds `STREAM_LOCK`.
- `get_settings` reports a saved card that is absent, and not one that is
  present.
- `load_default_tracks` places the band it is given.

`test_interface.py`:

- Settings: **Look again** reaches Python, the lists are read again, and the
  status names the card found.
- Setup with the saved card absent: the screen says it is not connected and
  does not fall back to another input; after **Look again** finds it, the
  tracks keep a name edited meanwhile and take this card's inputs.
