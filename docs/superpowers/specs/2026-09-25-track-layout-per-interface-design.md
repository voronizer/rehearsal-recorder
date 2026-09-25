# One track layout per interface

A track's input number means something only on the interface it was set on.
The app keeps one list of tracks for every interface, so changing the
interface leaves the band pointing at inputs that belong to a different card.

## Why

A saved track carries two facts welded into one record, `{"name": "Guitar",
"channel": 3}`. The name belongs to the band and is the same wherever they
play. The number belongs to the card: input 3 on an eighteen-input desk is
somebody's guitar, and on a two-input box it does not exist.

The app stores that record once, under the config key `tracks`
(`api.py:649`), and stores the chosen interface separately as
`device_index` plus a `device` identity (`api.py:404-408`). Nothing joins
them. The template is written only by the "Save as template" button, which
sends the tracks and nothing else (`Setup.tsx:233`), so a saved layout does
not record which card it was for. The interface is chosen on a different
screen, in Settings (`api.py:616`).

The result is that changing the interface silently invalidates the track
list, and moving back does not bring the old numbers with it. A band that
rehearses on an XR18 and records at home on a two-input box has to renumber
every track, twice, every time.

Two things follow from PortAudio rather than from this app, and both bound
the design. An input count is a property of the card, so a layout is only
valid against the card it was made on. And a device index is not stable —
unplugging a card, rebooting, or loading ASIO renumbers the list — which is
why the app already identifies a card by name and audio system rather than
by position (`device_identity`, `devices.py:270`).

## Part 1 — What is stored

The config key `layouts` holds a list. Each entry is one interface and the
tracks last used with it:

```json
"layouts": [
  {"device": {"name": "X AIR XR18", "host_api": "ASIO"},
   "tracks": [{"name": "Guitar", "channel": 3},
              {"name": "Vocals", "channel": 7}]},
  {"device": {"name": "Scarlett 2i2", "host_api": "Windows WASAPI"},
   "tracks": [{"name": "Guitar", "channel": 1},
              {"name": "Vocals", "channel": 2}]}
]
```

`device` is the identity `device_identity()` returns: the card's name and
its audio system. A layout is found by comparing both fields, which is the
comparison `saved_device()` already makes (`devices.py:309`).

The list is ordered most recently used first. The first entry is therefore
the layout to take track names from when an interface has none of its own.

`layouts` is a list rather than an object keyed by a string because the
identity is two fields. Flattening two fields into one key requires a
separator, and a card's name may contain any character a manufacturer
chooses to put in it.

The key `tracks` does not exist after migration (Part 5). The app reads the
track list from `layouts` alone, so there is one place a layout can be
wrong.

`get_settings()` stops returning `tracks` (`api.py:420`). No screen reads
that field.

## Part 2 — Choosing an interface

Opening the start screen, and changing the interface in Settings, both
resolve a track list for the interface in force. Four cases, in order:

1. **A layout exists for this interface.** Its tracks load unchanged. The
   input numbers are valid by construction.
2. **The interface is new and its inputs are enough.** The track names from
   the first entry of `layouts` load, in the order they are stored in, on
   inputs 1, 2, 3 and upward.
3. **The interface is new and its inputs are fewer than the names.** Every
   name loads. The first names take inputs 1 upward until the inputs run
   out; the rest load with no input.
4. **`layouts` is empty.** Two tracks named "Guitar 1" and "Vocals" load, on
   inputs 1 and 2, trimmed to the card's input count.

What each of these four cases puts on screen is Part 4.

Case 3 keeps every name because dropping one is a decision about who plays
at this rehearsal. Five musicians do not fit on a two-input box in any
arrangement, and which three to leave out is the band's answer, not the
app's. Leaving the tracks visible and unassigned is also what a reader of
other recording software meets: Cubase marks an unresolvable input "Missing
Port", Ardour leaves the cell in its patchbay empty, and Studio One leaves
the row in Audio I/O Setup unassigned. None of them guesses.

A track with no input is written `{"name": "Keys", "channel": null}`.

## Part 3 — When a layout is remembered

Starting a rehearsal writes the track list to `layouts` as the layout for
the interface it is starting with. That entry stands at the front of the
list afterwards, whether it replaces an entry already there or is the
interface's first.

The "Save as template" button writes the same thing without starting a
rehearsal.

Starting a rehearsal saves the layout because the case this feature exists
for is a band who set up once and play every week. A memory that fills only
when somebody remembers a button is a memory that stays empty.

## Part 4 — What the screens show

The start screen's interface line states the number of inputs alongside the
rate and depth: `X AIR XR18 · 18 inputs · 48 kHz · 24 bit`. The input count
governs every row of the track list below it, and the line is where the
track list can be read against the card.

The start screen carries one note about the track list, and only in case 3
of Part 2: the tracks with no input, by name, and the card's input count.

The start screen states, in case 2 of Part 2, that the input numbers were
assigned in order and are worth checking.

The signal check and the rehearsal refuse while any track has no input,
with the same sentence the note carries. `channels_available()`
(`devices.py:98`) already refuses on a track numbered past the card's
inputs; a track with no input joins that refusal.

## Part 5 — Migration

A config holding `tracks` and a `device` identity converts to one entry in
`layouts` for that identity, and `tracks` is removed.

A config holding `tracks` and no `device` identity converts to one entry
with `"device": null`. An entry whose `device` is null matches no interface
and is never loaded by case 1 of Part 2; it supplies track names to cases 2
and 3 like any other entry. A config with no identity comes from a version
before identities were saved, and the card it was written for is unknown.

A config holding neither converts to an empty `layouts`.

Migration runs when the config is read, and the converted config is written
back on the next save. Reading a config that has already been converted
changes nothing.

## What this does not do

Two identical cards — the same name, the same audio system, both plugged in
— share one layout. The app cannot tell them apart, and `saved_device()`
already resolves such a pair by the stored index rather than by identity.

A layout is not offered for an interface that is not connected. The list of
interfaces comes from PortAudio, and a layout whose card is absent waits
until the card returns.

No layout is ever deleted by the app. The config grows by one small entry
per interface ever used.

## Testing

`tests/test_engine.py`, against the stubbed sounddevice:

- a layout saved for one interface loads for that interface and not for
  another
- an interface with no layout takes the names from the most recent layout,
  on inputs counted from 1
- an interface with fewer inputs than names leaves the surplus names with no
  input, and keeps every name
- starting a rehearsal writes the layout for the interface it started with,
  at the front of the list
- a config with `tracks` and an identity migrates to one entry for that
  identity, and `tracks` is gone afterwards
- a config with `tracks` and no identity migrates to an entry whose device
  is null, and those names still seed a new interface
- migrating an already-migrated config changes nothing
- the signal check and the rehearsal refuse while a track has no input

`tests/test_interface.py`, against the mocked bridge:

- the interface line states the input count
- a track with no input is visible as such, and the note names it
- an interface with a layout shows that layout's numbers
