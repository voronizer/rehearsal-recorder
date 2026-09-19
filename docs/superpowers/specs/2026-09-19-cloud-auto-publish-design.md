# Publishing takes to the cloud folder without being asked

Design, 2026-09-19.

## The problem

Today a take reaches the cloud folder only if somebody opens the share dialog
on it and picks what to copy (`ShareDialog.tsx`, `api.share_take`). After a
rehearsal that means walking the list take by take, which is the kind of
chore that quietly stops happening. The takes people actually want to hear
are the ones that never get sent.

The dialog's own comment explains why it was built per-take: copying
everything would sync every failed attempt, and most of a rehearsal is failed
attempts. That objection no longer bites. A failed attempt is discarded on the
review screen and never becomes a take at all, so "publish every saved take"
already filters on the decision a person made anyway.

## What was decided

- Takes are published **during** the rehearsal, in the background, not in one
  batch at the end.
- The queue **stops while a take is recording**, so mixing and encoding never
  compete with the audio callback.
- **What** gets published is a setting, not a fixed choice.
- A rename or a new balance **re-publishes** the take, replacing the old copy.

## Architecture

### The work itself is already written

`share_take(folder, take_number, what)` mixes, encodes, copies, replaces any
previous copy through `_remove_shared`, and records the result on the take.
Nothing about that changes. Everything below decides *when* to call it.

### A queue in memory, seeded from a fingerprint on disk

Each published take already carries `take["cloud"]` with the paths and formats
it produced. Add to it a record of what the copy was made *from*:

```json
"cloud": {
  "mix": "…/01 - Polyn.flac",
  "mix_format": "flac",
  "source": {
    "what": "mix",
    "name": "Polyn",
    "format": "flac",
    "dir": "…/Google Drive/Band/Tuesday jam - 2026-09-19 20-00",
    "volumes": {"Guitar": 1.0, "Vocals": 0.8}
  }
}
```

`volumes` holds only the tracks in that take, so changing an unrelated track's
level does not invalidate it. `dir` is where the copy was actually written,
which depends on the cloud folder and on the rehearsal's name — without it a
take points the app at a different Drive folder and still reports itself as
published. A take whose current name, format, chosen `what`, balance or
destination differ from `source` has a stale copy in the cloud. A take with no
`cloud` at all has none.

The record describes files on somebody else's disk, so it is believed only
while those files are still there: a sync client that logs out and re-creates
its folder empty must not leave every take fingerprinted as published with
nothing behind it. A fingerprint that cannot be disproved suppresses its own
repair.

This fingerprint is the guard, checked inside the worker just before it
copies: if the take already matches, the job is dropped and nothing is
recomputed. It is what keeps a burst of triggers from doing the same work
repeatedly.

The queue itself is an in-memory list of `(folder, take_number)`. It is filled
by triggers, not by scanning:

| Trigger | What is enqueued |
|---|---|
| `keep_take` | that take, and any take of this rehearsal that failed earlier |
| `recover_draft` | the take it rescued |
| `rename_take` | that take, in any rehearsal |
| `save_mix` | every take of the **active** rehearsal |
| auto-publish switched on | every take of the active rehearsal |
| `set_cloud_format` | every take of the active rehearsal |
| `set_cloud_dir` | every take of the active rehearsal |
| `rename_rehearsal` | every take of it, when it is the active one |

There is deliberately no startup row. A rehearsal does not survive the
process — `Api.__init__` starts with `self._session = None` — so at startup
there is never an active rehearsal to seed the queue from, and scanning the
recordings folder for stale copies is exactly the sweep this design avoids.
Takes left unsaved when the app died are the drafts screen's business, and
`recover_draft` enqueues the take it makes — it builds and writes that take
itself rather than going through `keep_take`, so it has to. That recovery is
the case the app dying mid-rehearsal is argued from, and nothing else would
ever send the take.

That is what the first row's second half is for. The realistic failure is a
sync folder that is briefly not there — logged out, unmounted, full — and the
rehearsal carries on regardless. Retrying this rehearsal's failed takes each
time a new one is saved means the backlog clears itself the moment the folder
comes back, without a retry loop and without anybody noticing.

The `save_mix` row is the one worth pausing on. The balance lives in the
config globally, not per take (`api.py:245`), so "the balance changed" is true
of every take ever recorded. Re-publishing all of them because a fader moved
would be a storm of mixdowns. Scoping that trigger to the current rehearsal
keeps it to the takes the balance was actually set for; older rehearsals stay
as they were published, and the share dialog is still there to redo one by
hand.

### The worker

One daemon thread, started with the app, sleeping on an event when the queue
is empty. Each pass:

1. If `self._recorder is not None`, wait. Recording wins.
2. Take the next job. If auto-publish is off, drop it.
3. If the fingerprint already matches, drop it.
4. Call `share_take`, then write the fingerprint and clear any `cloud_error`.
5. On failure, record `take["cloud_error"]` and move on. Do not spin.

Every trigger above is scoped to the rehearsal in progress, except a rename,
which is about one named take wherever it lives. So a failure in a rehearsal
that has since been finished is not retried on its own — it is shown in
History with its error, and the share dialog republishes it. Within the
rehearsal in progress, the next saved take is what sweeps up the earlier
failures.

The loop body is a method of its own (`publish_next_pending()`), called by the
thread and by the tests, so the behaviour can be driven one step at a time
without sleeping on a thread in a test.

Serialisation comes free: one worker, one job at a time, so two takes never
mix at once.

### What the screens show

`session_state()` already returns `takes` and `recording`, and the app already
calls it. Add `cloud_queue`: a map of take number to `"queued"` or
`"working"`, read from the worker. Persisted state stays on the take itself —
`cloud` for success, `cloud_error` for failure — so History, which reads
`get_rehearsal`, shows the outcome without knowing anything about the queue.

That gives four states per take in the list: queued, working, in the cloud,
failed. Failed offers a retry, which is the existing manual path.

The rehearsal screen polls `session_state` while anything is queued or
working, and stops when the queue drains. The share dialog stays exactly as it
is, for publishing something by hand and for removing a copy.

### Settings

Two keys in the config, surfaced through `get_settings` and written by one
setter:

- `auto_publish` — off by default.
- `auto_publish_what` — `"mix"`, `"tracks"` or `"both"`, default `"mix"`.

In the Settings screen they sit under the existing cloud folder row, disabled
until a cloud folder is chosen — without one there is nowhere to publish, and
`share_take` already refuses with `needs_dir`.

## Failures

The cloud folder is somebody else's software: a sync client that may be
logged out, a disk that may be full, a folder that may have been moved.

- Missing or unwritable folder, full disk, encoder failure — `share_take`
  already returns `{"ok": false, "error": …}`. That text is stored on the take
  and shown in the list.
- A failed take in the rehearsal in progress is retried the next time a take
  is saved, or when the setting is touched — not in a tight loop.
- Nothing about a failure touches the originals. The recordings under the
  recordings folder are never the copy.

## Testing

`tests/test_engine.py`, a new section after the existing sharing one:

- a saved take reaches the cloud folder on its own when auto-publish is on
- and does not when it is off
- the second pass over an unchanged take copies nothing
- renaming a take replaces its copy
- changing the balance re-queues the current rehearsal's takes, not older ones
- the queue does not run while a take is recording
- a failure is recorded on the take and the take is retried later

`tests/test_interface.py`:

- the setting renders, is disabled without a cloud folder, and persists
- a take shows its cloud status in the list

## Not in this

- Talking to any cloud service. Files are copied into a watched folder, which
  is what the app does today and all it should do.
- Choosing what to publish per take. One setting; the dialog covers exceptions.
- Re-publishing old rehearsals when the balance changes.
- Removing a cloud copy when a take is deleted. Worth doing, separate change.
