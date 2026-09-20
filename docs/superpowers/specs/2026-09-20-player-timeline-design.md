# The player on one timeline

**Status:** approved, ready for an implementation plan
**Mockups:** four layouts were drawn and compared; C+ was chosen
(https://claude.ai/artifact/T8XCYKwh6dCypwRayhLdce)

## Why

Every screen centres its content in `max-w-3xl` — 768 px inside a window that
starts at 1180. Two hundred pixels of nothing on each side, while the one
thing that genuinely wants pixels, the waveform, gets 512 of them for a whole
take. A minute of playing ends up a finger wide, and you cannot point at the
bar that went wrong, which is the entire reason for looking at a waveform.

The second half of the problem is that each track draws its own waveform with
its own time axis. Four tracks are four pictures that happen to be the same
length. Nothing lines up on purpose, so the one question a band actually asks
— *where* did we come apart — has no answer on screen.

Setting the loop region has the same shape of problem: you position the
cursor, press A, position again, press B. Three deliberate acts to say
something you could point at.

## What it becomes

One timeline across the full width. A ruler at the top carrying the clock,
the markers and the playhead; under it one lane per track, all sharing that
ruler's time axis; to their left a fixed gutter with each track's name, fader
and M/S. The A–B region is a single band drawn through every lane at once.
Marker notes sit as chips under the lanes, exactly as they read today.

The region is drawn with the mouse, across the lanes.

## The gestures

This is the heart of the change, so the rules are exact.

**Drag across the timeline sets the region.** A is where the press landed, B
where it was released, in either direction — dragging right to left gives the
same region. While the pointer is down the band is drawn live, with its span
(`0:12 – 0:31`) shown above it. A new drag replaces whatever region was
there; there is no need to clear one first.

The whole surface behaves this way, ruler and lanes alike — one rule, so
nobody has to learn which strip is which. The only exceptions are the three
handles below, which sit on top of it and have jobs of their own.

**A press that does not move is a click, and a click seeks.** The threshold
is 5 px. One gesture, one surface, and the threshold separates the intents.
This is what makes the feature free of a mode switch.

**The edges can be grabbed.** Each end of the band has a handle; dragging one
moves that edge only. An edge dragged past the other stops at it rather than
inverting.

**The playhead has its own handle** — the dot at the top of its line, on the
ruler. Dragging that scrubs the position, which is what dragging anywhere on
the waveform does today. That behaviour is not being removed, it is being
given a place of its own, because the lanes now mean "region". Losing it
silently would be the wrong trade: it is how you find a spot you can see but
cannot name.

**A and B stay, with a narrower job.** They no longer mean "set the mark at
the cursor and hope"; they read out the region's times and set their edge to
the current position. Mouse work is for the coarse pass; when you have just
heard the exact spot, a button is the only way to be precise about it. The ✕
clears the region as before.

**The pointer is captured on press** (`setPointerCapture`, which the waveform
already does for scrubbing) so a drag that ends outside the window still
finishes. Without it a release off the lanes leaves the region stuck to the
pointer.

Everything is a real, focusable control, and the A/B buttons remain the
keyboard path to the same result.

## Layout rules

The window cannot go below 960×680 (`app.py`, `min_size`), which settles the
responsive question: there is no narrow fallback to design, the timeline only
has to hold together from 960 up. At that width it still has about 700 px of
lane against today's 512.

- **Gutter:** 200 px fixed. Track names, the fader, M and S.
- **Lanes:** share the height left over, `floor(available / tracks)`, clamped
  to 64–160 px. Below the floor — from about six tracks in a short window —
  the lane stack scrolls rather than squeezing further. A lane thinner than
  64 px is not a waveform, it is a smear.
- **Ruler ticks:** the step comes from the ladder 5, 10, 15, 30, 60, 120, 300
  seconds — the first one that leaves at least 80 px between ticks. A
  forty-minute take and a forty-second one both get a readable clock.
- **Screens with a player lose `max-w-3xl`** and run to the window's width,
  with the existing 24 px gutters.

## The pieces

**`Timeline` (new).** Owns the ruler, the lane stack, the region band, the
playhead and every gesture above. It is the only component that knows the
mapping between an x position and a second, which is precisely what was
missing: that mapping used to be copied into each waveform.

**`Waveform` becomes a lane renderer.** It draws the peaks, with the played
part still highlighted as it is today, and nothing else — no markers, no loop
tint, no playhead of its own, no pointer handling. Those were per-track
copies of things that are properly one thing across the take, and the
Timeline draws them once, over all lanes. The component gets smaller and its
job gets sayable in one line.

**`TakePlayer`** keeps its name and its place: transport row, then the
Timeline, then the marker chips. It stops having a `compact` variant, because
it is no longer squeezed inside a list row.

**`TakeList` becomes a take strip.** On the rehearsal and history screens the
takes are a single row of pills — number, name, marker dots — that select
rather than expand. The strip does not wrap: it scrolls sideways and keeps
the selected pill in view, so the vertical budget stays fixed however many
takes a rehearsal has. The per-take actions that used to live on each row
(rename, cloud, delete) move to the header of the take that is open, where
there is room for a word rather than an icon.

**`useMultitrackPlayer` gains `setRegion(a, b)`.** A drag produces both ends
at once; going through `markA` then `markB` would apply the loop twice and,
mid-drag, apply a region that was never asked for.

## The screens

All three hosts of the player change together, because they share the
component and two different players in one app would be worse than the
problem we are fixing.

- **Review** (straight after recording): the timeline, no take strip — there
  is one take. Spacebar still saves the take.
- **Rehearsal:** take strip, then the player for the selected take. The
  "Record take N" footer is untouched.
- **History:** the same, inside a past rehearsal.

## Not changing

- Playback stays in Python; the timeline only sends seeks.
- Markers keep their four kinds, their colours and their dialog.
- Volumes, mute and solo keep their behaviour and their persistence.
- The A–B region stays in memory per take, as today. Nothing is written to
  disk about it.
- The recording path is not touched at all.

## Testing

The interface suite drives the built bundle through Playwright, which can
press, move and release a mouse — so the gestures get real tests rather than
assertions about handlers:

- a drag across a lane sets the region, and the A/B read-outs say so;
- a drag from right to left gives the same region as left to right;
- a press-and-release without movement seeks instead of setting a region;
- dragging an edge moves that edge and leaves the other;
- the ruler's tick step changes with the take's length.

The engine suite is unaffected: nothing in Python changes.

## What this does not answer

The take strip's behaviour with a rehearsal of thirty takes is designed
(scrolls, selected kept in view) but not lived with. If it turns out that
people want to see all of them at once, the strip is the piece to revisit —
that is what the B mockup, takes in a left-hand column, was about, and it
remains the fallback.
