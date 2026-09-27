# Background work: what is running, how far along, and how it ended

Four things the app does take real time on a long take: copying it to the
cloud folder (a mixdown and an MP3 or FLAC encode, or every track encoded),
cropping it (every track rewritten), stopping it (every raw track turned into
a .wav) and recovering an unsaved one (the same, on the next start). None of
them says how far along it is, and what a copy to the cloud came to can only
be found by opening the take it belongs to.

## What the app has

| Operation | Where it runs | What the screen shows |
|---|---|---|
| Cloud copy, automatic | `PublishQueue` worker, after a take is saved | "Waiting for the cloud" / "Copying to the cloud" on the take's pill, only on the rehearsal screen of the rehearsal in progress (`TakeStrip.tsx:37`) |
| Cloud copy, manual | `share_take`, inside the bridge call from `ShareDialog` | a spinner on the chosen option until the call returns |
| Crop | `crop_take` / `crop_draft`, inside the bridge call | the screen is busy (`Rehearsal.tsx:128`, `HistoryScreen.tsx:154`, Review) |
| Stop | `stop_take` → `AudioRecorder.stop` → `raw_to_wav` per track | the Stop button dims |
| Recover | `recover_draft` → `drafts.finalize` → `raw_to_wav` per track | the row's buttons dim |

Every one of them already works in pieces — `mixdown` sums in chunks, twice
(once to find the peak, once to write), `encode` reads `blocks()`,
`crop_wav` copies `BLOCK_FRAMES` at a time — except `raw_to_wav`, which reads
the whole raw file into memory: about 500 MB for an hour of one 24-bit track.

## The shape

- **Cloud copies run in the background**, both kinds: started, they can be
  left to finish while anything else is done in the app.
- **Crop, stop and recover run where they were started**, as now, and show
  their progress there. They stay in place because what comes next needs
  them: the review screen needs the .wav files, and a take being rewritten
  must not be played, cropped again or saved meanwhile.
- **One indicator for all of it**, in the header of every screen, with a list
  of what is running and what has finished. Leaving a screen loses neither.

## The journal: `rehearsal_recorder/activity.py`

One place in Python that every long operation registers with.

An entry is:

| Field | |
|---|---|
| `id` | increasing integer, for the interface to key on |
| `kind` | `"cloud"`, `"crop"`, `"stop"`, `"recover"` |
| `title` | what it is, in words: `“Polyn 2” → cloud` |
| `folder`, `take_number` | the take it is about; `take_number` is None for a draft |
| `state` | `"waiting"`, `"running"`, `"done"`, `"failed"` |
| `fraction` | 0.0 to 1.0 |
| `step` | what it is doing now: "Mixing", "Encoding the mix", "Track 3 of 8" |
| `error` | why it failed, when it did |
| `detail` | what it came to, when it worked: "MP3 of the mix" |
| `retry` | for a failed cloud copy: what to queue again (`what`) |
| `seen` | whether its result has been looked at |

`Journal` methods: `begin(kind, title, folder, take_number, waiting=False) →
entry`, and on the entry `start()`, `progress(fraction, step=None)`,
`done(detail=None)`, `fail(error, retry=None)` and `discard()`, which takes
it out as if it had never been. `snapshot()` returns running and waiting
entries first, then the last 20 finished, newest first. `mark_seen()` marks
every finished entry seen; `clear()` drops the finished ones. A lock around
every change; `progress` is called from the working thread many times a
second, so it only stores two values.

The interface reaches it through four `Api` methods: `activity()` (polled,
over http as well as the bridge), `activity_seen()`, `clear_activity()` and
`retry_cloud(entry_id)`.

Only for this run of the app: a cloud copy that failed is already recorded
with its take (`cloud_error`), shown in History, and queued again by the next
take saved in its rehearsal; nothing else needs to outlive a restart.

### Progress, weighted by work

A `progress` callback — `fn(fraction)` — is passed down, optional
everywhere, and each long loop calls it:

- `mixdown(..., progress=None)`: the first pass counts for the first half of
  its work, the second pass for the second.
- `encode(..., progress=None)`: by frames read.
- `raw_to_wav(..., progress=None)`: by bytes copied (see below).
- `crop_wav(..., progress=None)`: by frames written.

An operation made of several of these splits its fraction by how much each
part has to get through, in frames, not by counting parts: a copy of the mix
and eight tracks at 64% has done 64% of the work, not "the fifth of nine".
A small helper does the arithmetic: `Stages([("Mixing", w1), ("Encoding the
mix", w2), ...], report)` gives each stage its own `fn(fraction)`.

For a cloud copy, the weights are frames: the mixdown counts its two passes
over the longest track, the mix encode the same length again, and each
track's copy-and-encode its own length. A WAV "encode" is a rename and
weighs nothing.

## The operations

### Cloud copy

`share_take` is split. The work — deciding the target, the mixdown, the
encodes, writing the record — moves to `_copy_to_cloud(folder, take_number,
what, progress)`, which is what both paths run. `share_take` itself becomes
the manual path's front door: it checks what it checks now (the cloud folder,
the take, its files), then puts the take on the queue with its `what`, and
answers at once: `{"ok": True, "queued": True, "take": take}`.

`PublishQueue` jobs gain what to copy: `(folder, take_number, what, manual)`.
A manual job copies what it was asked for whatever the automatic settings
say; an automatic one does what it does now (reads `auto_publish_what`, skips
a take that is current, or asked not to be sent). Two requests for the same
take collapse into one, as now; a manual request replaces a waiting automatic
one for the same take, since it is the more specific.

Each job has a journal entry from the moment it is queued (`waiting`), which
`run_next` moves to `running` and then to `done` or `failed`. An automatic
job that turns out to have nothing to do (already current, or not to be sent)
removes its entry rather than reporting "done" for nothing. While a take is
being recorded the queue waits, as now; the entry says so (`step`: "After the
take").

A failure is recorded as it is now, with the take (`cloud_error`), and in the
journal with `retry` = its `what`. `retry_cloud(entry_id)` queues the same
take with the same `what` as a manual job.

`ShareDialog` closes as soon as the answer comes back; the indicator takes it
from there.

### Stop and recover

`raw_to_wav` copies in pieces — 4 MB at a time — and trims a trailing partial
frame the way it does now, by knowing the file's length before it starts
rather than by slicing what it read. The bytes of the .wav are the same as
before. `progress` is by bytes.

`AudioRecorder.stop(progress=None)` and `drafts.finalize(..., progress=None)`
split their fraction over the tracks by size. `stop_take` and `recover_draft`
register an entry ("Saving “Take 3”", "Recovering “take 2”") and pass its
`progress` down.

The Recording screen, once Stop is pressed, says "Saving the take… 45%" under
the Stop button. The Drafts screen shows a bar in the row being recovered.

### Crop

`_crop_tracks` splits its fraction over the tracks by frames and passes each
`crop_wav` its share; `crop_take` and `crop_draft` register an entry ("Cropping
“Polyn 2”"). Where the screen is now simply busy, it says "Cropping… 40%".

### Operations that stay in place

Their bridge call still waits to the end, because the screen needs the answer
to go on. Their progress reaches the screen through the same poll as the
indicator: the screen looks for the running entry of its kind and take. A
screen left half-way lets the operation finish all the same; its result is in
the list. Corner notices are only for cloud results — the screen that ran an
operation in place says how it went, as it does now, and a second word in the
corner would say it twice.

## The interface

### `lib/activity.ts`

A store in the manner of `lib/notices.ts`: one poll for the whole app, read
with `useActivity()`. It asks for `activity` over http (it is added to
`POLLABLE`): every 0.4 s while anything is waiting or running or the list is
open, every 2 s otherwise — often enough to notice an automatic copy that
started after a take was saved.

When a cloud entry turns `done`, it raises a `done` notice: "“Polyn 2” is in
the cloud folder" with its detail; when it turns `failed`, an `error` notice:
"Could not copy “Polyn 2” to the cloud: …". Each under its own key,
`cloud:<folder>:<take>`, so a retry that works replaces the failure.

### The indicator

`ActivityButton`, rendered by `Shell` in the header, to the left of the
screen's own header action. It is there only when there is something to show:
anything waiting or running, or anything finished in this run. The Recording
screen has no header and needs none: cloud copies wait while recording, and
the take's own saving is shown under its Stop button.

- Running: a ring filled to the overall fraction (the running entries' work
  together), and the number running.
- Finished and not yet looked at: a dot — green when all of it worked, red
  when anything failed.
- Its accessible name says it in words: "Background work: 1 running, 2
  finished".

Pressed, it opens a list (Radix Popover, from `radix-ui`, which the app
already has):

- **Working**: each entry's title, its step, and a bar with the percentage.
  Waiting ones say "Waiting", or "After the take" while recording.
- **Done**: ✓ or ✕, the title, the detail or the error, and **Retry** on a
  failed cloud copy. **Clear** at the bottom drops the finished ones.

Opening the list marks what is in it seen (`activity_seen`), and the dot
goes. Escape closes
the list and nothing else — the screen underneath keeps its own Escape
(`hooks/useSpacebar.ts`).

## Testing

`tests/test_engine.py`:

- the journal: an entry's life from waiting to done or failed; the 20 kept;
  seen and clear; `snapshot` order.
- `Stages`: fractions add up to 1.0 by weight, never go backwards.
- cloud copies: manual `share_take` answers at once and queues; the entry
  goes waiting → running → done, its fraction rising to 1.0, for mix, tracks
  and both; a failure lands in the journal and in `cloud_error`; retry queues
  it again as manual; an automatic job with nothing to do leaves no entry; a
  manual request replaces a waiting automatic one.
- `raw_to_wav` in pieces writes the same bytes as before, for 16 and 24 bit,
  mono and stereo, with and without a trailing partial frame, and reports
  progress up to 1.0.
- stop, recover and crop each register an entry and report progress.

`tests/test_interface.py`, with `activity` mocked:

- no indicator when there is nothing to show; a ring and a count while
  something runs; the list shows running and finished entries; opening it
  clears the dot; Retry calls `retry_cloud`; Clear calls `clear_activity`.
- a cloud copy finishing raises a notice, a failure raises one that stays.
- the share dialog closes as soon as the copy is queued; the existing share
  tests change to that.
- "Saving the take… N%" on Recording, "Cropping… N%" where a crop runs, and a
  bar in the Drafts row being recovered.

## Not in this

- Cancelling a copy. Nothing asked for it, and a half-written copy is
  already kept out of the band's folder by the `.writing` names.
- Keeping the list across restarts.
- Crop, stop or recover in the background.
