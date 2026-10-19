# MIDI control adapter

`midi.controller.Controller` implements protocol v1 over a dedicated MIDI input
and feedback output. It receives a `control.ControlAPI` instance. It does not
access the audio engine or library directly.

## Command path

```text
Port callback -> Controller.receive -> bounded input queue
-> Controller.tick -> MIDI decoding and protocol validation
-> action queue -> Controller.run_action -> ControlAPI.execute
-> Transport -> existing recorder/player/library operations
```

Port callbacks enqueue bytes. The action worker performs application work.
`ControlAPI.execute` checks recorder state again after acquiring the shared gate.
An optional admission callback lets the adapter acknowledge before long audio/file
operations. State and heartbeat feedback continue while a take is saving.

## Feedback path

```text
ControlAPI.snapshot / catalog -> MIDI encoding -> feedback output
ControlAPI.snapshot -> GUI polling -> screen and selection updates
```

The adapter translates shared catalog identities into bounded generation/index
frames. It maps opaque take references into protocol removal tags. Device limits
are 128 songs, 512 takes and 32 ASCII characters per text row. Those limits do not
restrict the shared catalog. Oversized catalogs expose a bounded prefix in
set/rehearsal/library order, retaining the current selection in the last slot
when necessary. Selection remains bound to the original catalog identity. Normalised volume is converted to MIDI's 0–127 range.
The controller firmware protocol remains version 1.

## Connection

Settings → Controls selects input and feedback output. A unique matching output
is selected automatically; ambiguous matches require an explicit output. Saved
port identities are reused after reconnect. The controller input is reserved
from instrument capture and meters. An input already assigned to an instrument
cannot also be selected as a controller.

Observer, input and output native objects remain on their owning threads.
Output uses a bounded queue. Disconnect invalidates queued old commands and
requests a new handshake. It does not cancel work already executing. Shutdown
waits for active controller work before closing the recording library.

The GUI reads semantic control state/events independently of MIDI connection
status. MIDI settings display adapter connection and diagnostic information.

[Shared API](../control-api.md) · [Controller protocol](https://github.com/viktor-baikov/reha-controller/blob/main/docs/controller-protocol-v1.md)

## Optional readiness extension

A controller advertising CC111 bit 16 receives host CC110 bit 2. Controller
CC113=query token followed by CC115=127 requests current status without starting a new connection epoch.
The host echoes the query token in CC114 (periodic snapshots use the last command
token, or 127 before any command),
then CC115: 0 permits control, 1 waits for current work, 2 needs recorder attention.
Only readiness with the matching command token releases an outstanding command.
Normal snapshots include this status; the controller polls it while left waiting.
The extension is optional and leaves legacy protocol-v1 clients unchanged.
