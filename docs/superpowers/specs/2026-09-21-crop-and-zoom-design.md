# Cropping a take, and a timeline you can zoom into

Two changes to the player, both about the same complaint: the region you draw
with the mouse is currently good for one thing, and the timeline it is drawn
on is too coarse to draw it accurately.

## Why

**Crop.** A take is nine minutes, of which six are somebody walking back to
the kit, a false start, and the silence after everyone stopped. The three
minutes that are music are the take. Right now there is no way to say so: the
nine minutes sit in history, in the size on disk, and in the time it takes to
find the bit worth listening to again.

**Zoom.** The timeline always shows the whole take. Drag out fifteen seconds
of a nine-minute take and you have selected under three percent of the width —
about twenty pixels. The edges cannot be placed, the waveform is a smear, and
the markers pile onto each other. The gesture we built last release is at its
worst exactly where it is needed most.

The two are related: a crop is only as good as the region it is given, and
placing that region accurately is what zoom is for.

## Part 1 — Crop to the region

### The gesture

With a region on the timeline, a **Crop** button appears in the transport,
beside A, B and the clear-X, where the rest of the region's controls live. It
asks before doing anything:

> **Keep only 1:12 – 2:40?**
> The rest of the take — 6 minutes 3 seconds — goes to the Trash, and two
> markers outside it go with it. You can put it back from the Trash.

Confirming crops. The region is then cleared: the take *is* that region now.

The button is disabled when the region already covers the whole take (within
0.05 s — there is nothing to remove), and when the region is shorter than
`MIN_CROP_SEC = 1.0`, which at that length is far more likely a slip of the
mouse than an intention. A region with only one end set counts as reaching to
the take's own start or end, exactly as the band on the timeline already
draws it.

### What happens on disk

Cropping rewrites each track shorter and moves the originals to the Trash — the
same place everything else in this app goes, and for the same reason. Nothing
here is ever really destroyed; it is moved somewhere the person can reach it.

The originals leave as **one item**, not eight. A sibling folder named after
the take with ` (before crop)` appended is created inside the rehearsal, the
original files are moved into it, and that folder goes to the Trash whole. The
person finds one recognisable thing in their Trash — `03 - Polyn 2 (before
crop)` — rather than eight loose files called `Drums.wav`.

The order matters, because the app can be killed at any point in it:

1. Close the player. (See the hazards below — this one is not optional.)
2. Write each trimmed track to `<take dir>/.writing-<name>.wav`, the same
   marker of an unfinished file that `WRITING_PREFIX` already means everywhere
   else in this app.
3. If any of those writes fails, delete every `.writing-` file and return the
   error. Nothing has been touched yet, so nothing needs undoing.
4. Create `<take dir> (before crop)` (made unique with `_unique_path`) and move
   the originals into it.
5. `os.replace` each `.writing-` file onto the name its original had.
6. Send the `(before crop)` folder to the Trash.

Die between 4 and 5 and the take folder holds only `.writing-` files with the
originals in a folder beside it: ugly, but self-describing and repairable by
hand, which is the most that can be asked of a step that moves files.

The trimmed file keeps the sample rate, bit depth and channel count it had.
Tracks of a take may differ in length — `mixdown` already allows for that — so
each is cut to its own frame count clamped into the region.

**A 5 ms linear fade** is applied at each cut edge, but only at an edge that is
actually a cut: a region starting at zero keeps the original attack. Slicing
mid-waveform lands on a non-zero sample, and a non-zero sample at the start of
a file is a click. Every editor does this and it costs four lines.

### What happens in the metadata

`duration_sec` becomes `end − start`. Markers shift by `−start`; a marker is
kept when `start <= at <= end` and otherwise goes with the audio it pointed
at. The take keeps its number, its name and its folder: from the outside it is
the same take, shorter.

The dialog's count of markers about to be lost is worked out in the interface,
from the markers it is already holding. `crop_take` returns its own
`markers_dropped` for the tests and for anything that wants to say what
happened afterwards, not because the dialog waits on it.

### Three hazards

**The player holds the files open.** Tracks are played through `numpy.memmap`,
and Windows refuses to rename or delete a mapped file. On macOS the same code
succeeds silently, so this will pass every test run on a Mac and fail on the
first Windows rehearsal. `crop_take` closes the player itself before touching
anything; the interface reopens the take afterwards.

**The cloud copy goes stale invisibly.** `cloud.source_of` fingerprints a copy
by what was asked for, the take's name, the format, the destination folder and
the balance — there is no length in it. A cropped take therefore still matches
its fingerprint, and auto-publish would skip it forever, leaving the uncropped
version in the cloud folder as the copy of record. Cropping must call
`_remove_shared(take)`, clear `take["cloud"]`, and re-enqueue the take when
auto-publish is on.

**A too-short region.** Guarded at both ends: the button is disabled in the
interface, and `crop_take` refuses independently. The interface is where slips
are caught; Python is where correctness lives.

### On the Review screen

The same operation, one folder over. A take that has been stopped is already
proper `.wav` in the rehearsal's drafts folder — `capture` wraps the raw PCM on
stop — so the trimming code is identical; only the bookkeeping differs, because
there is no entry in `meta.json` yet.

This is the moment the feature is most useful: you have just recorded, the
first twenty seconds are you walking to the kit, and you can see it on the
waveform. Leaving Crop off this one screen would also make it look arbitrary,
since the player is the same component on all three.

`crop_draft` returns the new tracks and duration; the Review screen shifts the
markers it is holding in memory (they are not on disk until the take is kept)
and hands the new take up to `App`, which owns `screen.take`, so the player
reopens on the new paths. The originals go to the Trash here too — a draft is
a recording like any other.

### Failure

Every failure returns `{"ok": False, "error": ...}` and leaves the take
playable. The interface shows the error where it shows the others and does not
close the take. There is no undo beyond the Trash, and the dialog says so.

## Part 2 — Zoom and pan

### The view window

`Timeline` is already the only place that knows how an x position becomes a
second: `pct()` one way and `secondsAt()` the other. A view window `[from, to]`
goes into those two functions and the ruler, the markers, the region band, its
handles and the playhead all follow without being told.

The window lives in `useMultitrackPlayer`, beside `region`, as `view` with
`setView(from, to)` and `resetView()`. It belongs there rather than in
`Timeline` because the waveform peaks it governs are fetched there, and because
it must reset when the take changes, which is a thing that hook already knows
about.

The surface gets `overflow-hidden`, and markers outside the window are not
drawn at all. Without both, an element at `left: -340%` escapes into the track
names beside it.

The region's span read-out stays clamped into view, so zooming inside a region
does not take its own duration off the screen.

### The wheel

- **Wheel over the waveforms** zooms around the pointer. The second under the
  pointer stays under the pointer — anchored zoom, not centred zoom, which is
  the difference between aiming and hunting.
- **Wheel over the track names**, the left column, still scrolls the lane
  stack as it does today. The picture zooms; the list scrolls. With eight
  tracks the stack scrolls, and swallowing the wheel everywhere would make the
  bottom ones unreachable.
- **Horizontal scroll** — two fingers sideways on a trackpad, Shift+wheel on a
  mouse — moves along the take.
- `ctrl+wheel` (the trackpad pinch, which browsers deliver as a wheel event
  with `ctrlKey`) zooms as well, rather than zooming the whole page.

The handler goes on the gesture surface itself — the element that already
owns the region drags, which spans column two and every row of it — and not on
the grid or the scroll container around them. That placement is what makes the
two rules above one rule: the surface covers the waveforms and nothing else,
so a wheel over the track names never reaches it.

It must be attached with `addEventListener("wheel", fn, {passive: false})` in
an effect, not as React's `onWheel`: it has to call `preventDefault`, or the
surrounding scroll container takes the gesture.

Zoom is clamped to `MIN_VIEW_SEC = 2` at one end and the take's length at the
other. Zooming all the way out is the same state as never having zoomed.

### Following the playhead

Zoomed in, playback runs off the right edge within seconds. So while playing,
a playhead that leaves the window moves the window: it jumps forward to put
the playhead an eighth of the way in, the way a page turns rather than the way
a belt slides. Panning by hand during playback suspends following until the
playhead next comes back into view, so looking at something else is not fought.

### The peaks

`wav_peaks` takes an optional second range and seeks to it, so the same 900
bars describe two seconds instead of nine minutes. `take_media` passes the
range through.

Refetching on every wheel tick would be a burst of calls into Python, so the
window is redrawn immediately from the peaks already in hand and the sharper
ones are fetched 150 ms after the gesture settles. Zoom in: it is there at
once, and a moment later it is crisp.

For that to be honest, the peaks must say what they describe. `media` carries
the window its peaks were computed for, and `Waveform` is given both that
window and the one being displayed, mapping one onto the other. The transitional
blur is then a state the component draws correctly rather than a bug — and the
same code path covers the ordinary case, where the peaks cover the whole take
and the view does too.

### Getting back out

The ruler's own gutter cell — today the hint that reads "Drag across to loop" —
becomes the zoom read-out when zoomed: the visible span, and a **Whole take**
button beside it. The transport row is already carrying ten controls; this one
belongs to the timeline anyway.

### What zoom does not touch

Playback, the loop, the region, the crop, sharing, and what the take is. It
changes what part of the take you are looking at and nothing else. It resets
to the whole take when the take changes.

## Interfaces

Python:

```python
# audio/crop.py — new
def crop_wav(src, dst, start_sec, end_sec, fade_sec=0.005):
    """Frames [start, end) of src written to dst, keeping rate, depth and
    channels, faded at each edge that is a cut. Returns
    {"ok", "frames", "samplerate"} or {"ok": False, "error"}."""

# audio/waveform.py — changed
def wav_peaks(path, buckets=DEFAULT_BUCKETS, start_sec=None, end_sec=None): ...

# api.py — changed
def take_media(self, tracks, buckets=DEFAULT_BUCKETS,
               start_sec=None, end_sec=None): ...

# api.py — new
def crop_take(self, folder, take_number, start_sec, end_sec):
    """-> {"ok", "take", "trashed", "location", "markers_dropped"}"""

def crop_draft(self, temp_dir, tracks, start_sec, end_sec):
    """-> {"ok", "tracks", "duration_sec", "trashed", "location"}"""
```

TypeScript:

```ts
// lib/api.ts
take_media(tracks: TrackFile[], buckets?: number,
           startSec?: number, endSec?: number): Promise<TrackMedia[]>
crop_take(folder: string, takeNumber: number,
          startSec: number, endSec: number): Promise<Ok<{ take?: Take; markers_dropped?: number }>>
crop_draft(tempDir: string, tracks: TrackFile[],
           startSec: number, endSec: number): Promise<Ok<{ tracks?: TrackFile[]; duration_sec?: number }>>

// hooks/useMultitrackPlayer.ts — added to the returned object
view: { from: number; to: number } | null   // null is the whole take
peaksWindow: { from: number; to: number }   // what `media[].peaks` describe
setView(from: number, to: number): void
resetView(): void

// components/Waveform.tsx — props
peaks, peaksFrom, peaksTo, viewFrom, viewTo, position, dimmed, className
```

`Review` gains an `onCropped(take: PendingTake) => void` prop; `App` replaces
`screen.take` with it.

## Testing

`tests/test_engine.py`:

- a cropped track is shorter, and keeps its rate, depth and channel count
- the originals leave as one folder, named after the take
- markers shift by the start; markers outside the region are dropped and
  counted
- `duration_sec` in `meta.json` matches the new length
- a take that was shared has its cloud record cleared by the crop
- a region outside the take, shorter than `MIN_CROP_SEC`, or in a folder
  outside the recordings directory is refused, and nothing on disk moves
- a failed write leaves no `.writing-` files and the take intact
- `wav_peaks` over a range puts the peaks where the sound actually is: a file
  of silence then a tone, asked for the tone's range, comes back loud

`tests/test_interface.py`, against the built interface:

- Crop appears only with a region, and is disabled for a whole-take region
- the confirmation names the span that is kept and the markers that are lost
- after cropping, the timeline shows the shorter take and the region is gone
- the wheel zooms around the pointer: the second under it stays under it
- the ruler's labels change with the zoom
- horizontal scroll moves along the take; Whole take returns
- markers outside the window are not drawn
- switching takes resets the zoom

The mocked bridge deep-copies whatever `crop_take` and `crop_draft` hand back,
as the other handlers now do — the real bridge serialises through JSON, and a
mock that hands back the same object hides exactly this class of bug.

## Out of scope

- Undo beyond the Trash.
- Cropping more than one take at once.
- Keeping the region when you switch takes, or saving it in `meta.json` —
  both were considered and deliberately left out of this round.
- Sharing only the region without cropping. Crop then share does it.
- Zoom affecting anything but what is drawn.
