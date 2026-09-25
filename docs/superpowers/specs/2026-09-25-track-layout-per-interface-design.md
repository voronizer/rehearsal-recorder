# The band is one list; the inputs belong to the card

A track's input number means something only on the interface it was set on.
The app keeps the name and the number as one record, so changing the
interface leaves the band pointing at inputs that belong to a different card.

## Why

A saved track carries two facts welded into one record, `{"name": "Guitar",
"channel": 3}`. The name belongs to the band and is the same wherever they
play. The number belongs to the card: input 3 on an eighteen-input desk is
somebody's guitar, and on a two-input box it does not exist.

The app stores that record once, under the config key `tracks`, and stores
the chosen interface separately as `device_index` plus a `device` identity
(`api.py:404-408`). Nothing joins them. The template is written only by the
"Save as template" button, which sends the tracks and nothing else
(`Setup.tsx:233`), so a saved layout does not record which card it was for.
The interface is chosen on a different screen, in Settings (`api.py:616`).

Changing the interface therefore invalidates the track list without saying
so, and moving back does not bring the old numbers with it. A band that
rehearses on an XR18 and records at home on a two-input box renumbers every
track, twice, every time.

Two things follow from PortAudio rather than from this app, and both bound
the design. An input count is a property of the card, so a number is only
valid against the card it was set on. And a device index is not stable —
unplugging a card, rebooting, or loading ASIO renumbers the list — which is
why the app already identifies a card by name and audio system rather than
by position (`device_identity`, `devices.py:270`).

## Part 1 — What is stored

The config key `tracks` holds the band: track names, in order, the same
whatever is plugged in.

```json
"tracks": ["Guitar", "Vocals", "Drums"]
```

The config key `layouts` holds one entry per interface. Each entry maps a
track name to the input that name uses on that card:

```json
"layouts": [
  {"device": {"name": "X AIR XR18", "host_api": "ASIO"},
   "inputs": {"Guitar": 3, "Vocals": 7, "Drums": 9}},
  {"device": {"name": "Scarlett 2i2", "host_api": "Windows WASAPI"},
   "inputs": {"Guitar": 1, "Vocals": 2}}
]
```

`device` is the identity `device_identity()` returns: the card's name and
its audio system. An entry is found by comparing both fields, which is the
comparison `saved_device()` already makes (`devices.py:309`).

`layouts` is a list rather than an object keyed by a string because the
identity is two fields. Flattening two fields into one key requires a
separator, and a card's name may contain any character a manufacturer
chooses to put in it.

`inputs` is keyed by track name rather than by position, so adding,
removing or reordering the band leaves every other name's input untouched.
Track names are already unique within a rehearsal: the recorder keys its
level meters and its open files by them.

The list is ordered most recently used first.

`get_settings()` does not return the band. No screen reads it from there.

## Part 2 — What loads for an interface

Opening the start screen, and changing the interface in Settings, both
resolve a track list for the interface in force. Every name in the band
loads, in the band's order:

1. **A name this card knows**, whose input is within the card's input count
   and not already taken, loads on that input.
2. **Every other name** loads on the lowest input no other name is on.
3. **When the inputs run out**, the remaining names load with no input,
   written `{"name": "Drums", "channel": null}`.
4. **An empty band** loads two names, "Guitar 1" and "Vocals".

Case 3 keeps every name because dropping one is a decision about who plays
at this rehearsal. Five musicians do not fit on a two-input box in any
arrangement, and which three to leave out is the band's answer, not the
app's. Leaving the tracks visible and unassigned is also what a reader of
other recording software meets: Cubase marks an unresolvable input "Missing
Port", Ardour leaves the cell in its patchbay empty, and Studio One leaves
the row in Audio I/O Setup unassigned. None of them guesses.

## Part 3 — When a layout is remembered

Starting a rehearsal writes the band to `tracks`, and writes each track's
input into the entry for the interface it is starting with. That entry
stands at the front of `layouts` afterwards, whether it replaces an entry
already there or is the interface's first.

The "Save as template" button writes the same thing without starting a
rehearsal.

A name absent from what is written keeps whatever input it had on that card.
Somebody dropped from the band and later brought back plugs into the same
socket.

Saving while no interface is chosen writes the inputs to the entry whose
`device` is null. That entry is never loaded as an interface's own, and it
is kept rather than discarded because there is no reason to forget where
people were plugged in.

Starting a rehearsal saves the layout because the case this feature exists
for is a band who set up once and play every week. A memory that fills only
when somebody remembers a button is a memory that stays empty.

## Part 4 — What the screens show

The start screen's interface line states the number of inputs alongside the
rate and depth: `X AIR XR18 · 18 inputs · 48 kHz · 24 bit`. The input count
governs every row of the track list below it, and the line is where the
track list can be read against the card.

A track with no input shows "No input" in its input control, marked, rather
than an empty control with no stated cause.

The start screen carries one note while any track has no input: those tracks
by name, and the card's input count. Where the band outnumbers the card's
inputs, the note says so instead, because no arrangement of inputs would
help.

The signal check and the rehearsal refuse while any track has no input, with
the sentence `channels_available()` returns (`devices.py:98`).

## Part 5 — Migration

A config holding `tracks` as a list of records converts to a band of those
names, in order, and one `layouts` entry for the saved `device` identity
holding their numbers.

A config holding `tracks` as a list of records and no `device` identity puts
those numbers in the entry whose `device` is null. A config with no identity
comes from a version before identities were saved, and the card it was
written for is unknown.

A config holding neither converts to an empty band and an empty `layouts`.

Migration runs when the config is read, and the converted config is written
back on the next save. Reading a config that has already been converted
changes nothing.

## What this does not do

The band is one list, so removing a track removes that person everywhere.
Interfaces remember where people are plugged in, not who is in the band.

Two identical cards — the same name, the same audio system, both plugged in
— share one entry. The app cannot tell them apart, and `saved_device()`
already resolves such a pair by the stored index rather than by identity.

An entry is not offered for an interface that is not connected. The list of
interfaces comes from PortAudio, and an entry whose card is absent waits
until the card returns.

No entry is ever deleted by the app. The config grows by one small entry per
interface ever used.

## Testing

`tests/test_engine.py`, against the stubbed sounddevice:

- a card's saved inputs come back for that card and not for another
- a card nobody has used keeps the whole band, counted from the first free
  input
- switching between two cards and back returns each card's own numbers
- a name added on one card appears on every other card
- a band larger than the card's inputs keeps every name, the surplus with no
  input
- a name left out of a save keeps its input on that card
- starting a rehearsal writes the band and that card's inputs
- a config of records migrates to a band and one entry for its identity
- a config of records with no identity migrates to the entry with no device
- migrating an already-migrated config changes nothing
- the signal check and the rehearsal refuse while a track has no input

`tests/test_interface.py`, against the mocked bridge:

- the interface line states the input count
- a track with no input reads "No input", and the note names it
- the rehearsal cannot start while a track has no input
