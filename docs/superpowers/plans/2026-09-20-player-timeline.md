# Player Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the take player around one timeline that spans the window, where the loop region is drawn with the mouse across every track at once.

**Architecture:** A new `Timeline` component becomes the single owner of the mapping between an x position and a second in the take; it draws the ruler, the lane stack, the A–B band, the marker lines and the playhead, and it handles every pointer gesture. `Waveform` drops to a lane renderer that only paints peaks. `TakePlayer` becomes transport + timeline + marker chips, and the expanding take rows on the rehearsal and history screens become a scrolling strip of take pills with one player below.

**Tech Stack:** React 19 + TypeScript + Tailwind v4 (`ui/`), Python backend untouched. Tests: `tests/test_interface.py` (Playwright against the built bundle) — the engine suite does not change.

**Spec:** `docs/superpowers/specs/2026-09-20-player-timeline-design.md`

## Global Constraints

- The window never goes below **960×680** (`app.py`, `min_size=(960, 680)`). There is no narrow fallback layout to build; the timeline must simply hold together from 960 up.
- **Drag threshold is 5 px.** Under it a press is a click, and a click seeks.
- **Gutter 200 px fixed.** Lanes share the remaining height, clamped **64–160 px**; past the floor the lane stack scrolls.
- **Ruler tick ladder:** 5, 10, 15, 30, 60, 120, 300 seconds — the first step leaving at least **80 px** between ticks.
- **Pointer capture on press** (`setPointerCapture`), so a drag released outside the window still finishes.
- Playback stays in Python. The timeline only calls `player.seek` and `player.setRegion`.
- Nothing in `src/rehearsal_recorder/` changes. No new npm dependencies.
- **Rebuild the bundle (`cd ui && npm run build`) before running `tests/test_interface.py`** — the suite drives `ui/dist`, not `ui/src`. Forgetting this is the single most common way to "fail" a passing change.
- Comments say **why**, not what (`CONTRIBUTING.md`). A comment earns its place by explaining a decision that would otherwise look wrong.
- Run the whole suite with `python3 tests/run_all.py` before every commit.

---

### Task 1: The region moves into the hook, and the tick ladder gets a home

The player hook today calls its A–B marks `markers`, which is also the name of the listening markers drawn on the waveform — two different things, one word, in the component that is about to grow. Rename the hook's pair to `region`, and give it a way to set both ends at once, which is what a drag produces.

**Files:**
- Create: `ui/src/lib/timeline.ts`
- Modify: `ui/src/hooks/useMultitrackPlayer.ts`
- Modify: `ui/src/components/TakePlayer.tsx` (its reads of `player.markers` / `clearMarkers`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `tickStep(duration: number, width: number): number` — seconds between ruler ticks.
  - `tickTimes(duration: number, width: number): number[]` — the tick positions in seconds, starting at 0.
  - On the player object: `region: { a: number | null; b: number | null }`, `setRegion(a: number, b: number): void`, `clearRegion(): void`. `markA`, `markB`, `looping`, `toggleLoop` keep their names.

- [ ] **Step 1: Write the tick helpers**

Create `ui/src/lib/timeline.ts`:

```ts
/**
 * Where the ruler puts its ticks. A forty-second take and a forty-minute one
 * both have to end up with a clock somebody can read, so the step is chosen
 * from a ladder rather than computed: the numbers people expect to see on a
 * clock are 5, 10, 15, 30 seconds and whole minutes, never 37.
 */
const TICK_LADDER = [5, 10, 15, 30, 60, 120, 300]

/** Ticks closer together than this stop being a scale and become noise. */
const MIN_TICK_GAP_PX = 80

export function tickStep(duration: number, width: number): number {
  const last = TICK_LADDER[TICK_LADDER.length - 1]
  if (duration <= 0 || width <= 0) return last
  for (const step of TICK_LADDER) {
    if ((step / duration) * width >= MIN_TICK_GAP_PX) return step
  }
  return last
}

/** Tick positions in seconds, from zero, never reaching the very end — a
 *  label at the right edge would be cut in half by it. */
export function tickTimes(duration: number, width: number): number[] {
  const step = tickStep(duration, width)
  const out: number[] = []
  for (let t = 0; t < duration; t += step) out.push(t)
  return out
}
```

- [ ] **Step 2: Rename the pair and add `setRegion`**

In `ui/src/hooks/useMultitrackPlayer.ts`, rename the state and the returned field, then add the setter. The state declaration (around line 34) becomes:

```ts
  const [region, setRegion] = useState<{ a: number | null; b: number | null }>(
    { a: null, b: null }
  )
```

Rename every other `markers` / `setMarkers` in this file to `region` / `setRegion` **except** `applyLoop`'s parameter, and change the returned object (lines 187–224) to:

```ts
    region,
    looping,

    toggle: () => void call(() => api().player_toggle()),
    play: () => void call(() => api().player_play()),
    pause: () => void call(() => api().player_pause()),
    restart: () => seek(region.a !== null && looping ? region.a : 0),
    skip: (delta: number) => seek(position + delta),
    seek,

    toggleLoop: () => {
      const next = !looping
      setLooping(next)
      applyLoop(region, next)
    },
    markA: () => {
      const next = { a: position, b: region.b }
      setRegion(next)
      if (looping) applyLoop(next, true)
    },
    markB: () => {
      const next = { a: region.a, b: position }
      setRegion(next)
      if (looping) applyLoop(next, true)
    },
    // A drag hands over both ends at once. Going through markA and then markB
    // would apply the loop twice, and in between would apply a region nobody
    // asked for — the old A with the new B.
    setRegion: (a: number, b: number) => {
      const next = { a: Math.min(a, b), b: Math.max(a, b) }
      setRegion(next)
      if (looping) applyLoop(next, true)
    },
    clearRegion: () => {
      const next = { a: null, b: null }
      setRegion(next)
      if (looping) applyLoop(next, true)
    },
```

The local setter and the returned method now share the name `setRegion`; rename the `useState` setter to `setRegionState` and use that inside the methods so the file compiles:

```ts
  const [region, setRegionState] = useState<{ a: number | null; b: number | null }>(
    { a: null, b: null }
  )
```

- [ ] **Step 3: Point `TakePlayer` at the new names**

In `ui/src/components/TakePlayer.tsx` the destructure at line 44 and the `Transport` body use `markers: abMarkers` and `player.clearMarkers`. Replace `abMarkers` with `player.region` throughout, and `player.clearMarkers` with `player.clearRegion`. No behaviour changes in this step — it is a rename.

- [ ] **Step 4: Build and run the whole suite**

```bash
cd ui && npm run build && cd ..
python3 tests/run_all.py
```

Expected: every suite passes exactly as before. The interface suite's `[9] Repeat, mix and history` section already drives A, B and Repeat; it is the proof the rename did not break the loop.

- [ ] **Step 5: Commit**

```bash
git add ui/src/lib/timeline.ts ui/src/hooks/useMultitrackPlayer.ts ui/src/components/TakePlayer.tsx
git commit -m "Give the loop region its own name, and both ends at once"
```

---

### Task 2: The timeline, and the player rebuilt on it

The whole visible change lands here: one ruler, one lane stack, one band, and the drag that draws it. The screens are still narrow after this task — widening them is Task 3 — so the timeline will look cramped but must behave correctly.

**Files:**
- Create: `ui/src/components/Timeline.tsx`
- Modify: `ui/src/components/TakePlayer.tsx` (rebuilt around `Timeline`)
- Modify: `tests/test_interface.py` (new gesture checks)

**Interfaces:**
- Consumes: `tickTimes(duration, width)` from `@/lib/timeline`; `player.region`, `player.setRegion(a, b)`, `player.seek(seconds)`, `player.media`, `player.duration`, `player.position`, `player.getVolume/setVolume/persistVolumes/isMuted/isSoloed/hasSolo/toggleMute/toggleSolo`.
- Produces: `<Timeline player={player} markers={markers} />`, and a timeline surface carrying `role="group"` with `aria-label="Take timeline"` — that label is how the tests find it, so it must be exact.

- [ ] **Step 1: Write the failing gesture tests**

In `tests/test_interface.py`, inside section `[9] Repeat, mix and history`, right after the existing `ok("repeat covers the whole take", ...)` assertion, add:

```python
        # The region is drawn across the tracks, not clicked together out of
        # two buttons. A press that does not travel is still a seek, which is
        # what makes one surface able to serve both.
        surface = page.get_by_role("group", name="Take timeline")
        box = surface.bounding_box()
        mid_y = box["y"] + box["height"] / 2

        def drag(from_ratio, to_ratio):
            page.mouse.move(box["x"] + box["width"] * from_ratio, mid_y)
            page.mouse.down()
            page.mouse.move(box["x"] + box["width"] * to_ratio, mid_y, steps=10)
            page.mouse.up()
            page.wait_for_timeout(200)

        drag(0.25, 0.75)
        loop = calls("player_set_loop")
        ok("dragging across the tracks sets the loop region",
           loop and abs(loop[-1]["args"][0] - TAKE_SECONDS * 0.25) < 0.4
           and abs(loop[-1]["args"][1] - TAKE_SECONDS * 0.75) < 0.4)
        ok("and the buttons read it back",
           "A 0:01" in page.locator("button", has_text="A 0:").inner_text())

        drag(0.75, 0.25)
        loop_back = calls("player_set_loop")
        ok("dragging the other way gives the same region",
           abs(loop_back[-1]["args"][0] - loop[-1]["args"][0]) < 0.4
           and abs(loop_back[-1]["args"][1] - loop[-1]["args"][1]) < 0.4)

        seeks_before = len(calls("player_seek"))
        page.mouse.move(box["x"] + box["width"] * 0.5, mid_y)
        page.mouse.down()
        page.mouse.up()
        page.wait_for_timeout(200)
        ok("a press that does not travel seeks instead",
           len(calls("player_seek")) == seeks_before + 1
           and len(calls("player_set_loop")) == len(loop_back))

        # An edge moves on its own: grabbing B must not drag A along with it.
        drag(0.25, 0.75)
        started = calls("player_set_loop")[-1]["args"]
        page.mouse.move(box["x"] + box["width"] * 0.75, mid_y)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.5, mid_y, steps=8)
        page.mouse.up()
        page.wait_for_timeout(200)
        moved = calls("player_set_loop")[-1]["args"]
        ok("dragging an edge moves that edge",
           abs(moved[1] - TAKE_SECONDS * 0.5) < 0.4)
        ok("and leaves the other one where it was",
           abs(moved[0] - started[0]) < 0.05)

        # The clock is chosen from a ladder, so a six-second take gets five
        # second steps. The other end of that ladder is checked on the long
        # take in history.
        ok("the ruler's clock fits the take",
           "0:05" in page.get_by_role("group", name="Timeline clock").inner_text())
```

Check that `player_seek` is tracked in the mocked API near line 184; if it is not, wrap it the way `player_set_loop` is wrapped:

```js
  player_seek: track('player_seek', async (sec) => ({ok:true, position:sec})),
```

- [ ] **Step 2: Run the suite to watch them fail**

```bash
cd ui && npm run build && cd ..
python3 tests/test_interface.py
```

Expected: failures reported for the three new checks — the surface `Take timeline` does not exist yet, so `bounding_box()` raises. That is the missing-feature failure; do not "fix" it by softening the test.

- [ ] **Step 3: Write the Timeline**

Create `ui/src/components/Timeline.tsx`:

```tsx
import { Fragment, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Waveform } from "@/components/Waveform"
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { markerStyle } from "@/lib/markers"
import { tickTimes } from "@/lib/timeline"
import type { Marker } from "@/lib/api"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"

/** A press that never travelled this far is a click, and a click seeks. */
const DRAG_THRESHOLD_PX = 5
const GUTTER_PX = 200
const LANE_MIN_PX = 64
const LANE_MAX_PX = 160
const RULER_PX = 34
const ROW_GAP_PX = 8

/**
 * Every track of the take on one time axis: a ruler, a lane each, and one
 * A–B band drawn through all of them.
 *
 * This component is the only place that knows how an x position becomes a
 * second. That mapping used to be copied into every waveform, which is why
 * four tracks were four pictures that happened to be the same length rather
 * than one picture of one take.
 */
export function Timeline({
  player,
  markers = [],
}: {
  player: MultitrackPlayer
  markers?: Marker[]
}) {
  const { media, duration, position, region } = player
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<{
    fromX: number
    from: number
    toX: number
    to: number
  } | null>(null)
  const [grab, setGrab] = useState<"a" | "b" | "position" | null>(null)

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const secondsAt = (clientX: number) => {
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || duration <= 0) return 0
    const ratio = (clientX - box.left) / box.width
    return Math.min(duration, Math.max(0, ratio * duration))
  }

  const pct = (seconds: number) => (duration > 0 ? (seconds / duration) * 100 : 0)

  const travelled = drag ? Math.abs(drag.toX - drag.fromX) : 0
  // While the pointer is down the band follows it; the committed region only
  // takes over once the drag is over.
  const live =
    drag && travelled >= DRAG_THRESHOLD_PX
      ? { a: Math.min(drag.from, drag.to), b: Math.max(drag.from, drag.to) }
      : null
  const band =
    live ??
    (region.a !== null && region.b !== null
      ? { a: region.a, b: region.b }
      : null)

  const onPointerDown = (e: React.PointerEvent) => {
    if (duration <= 0) return
    surfaceRef.current?.setPointerCapture(e.pointerId)
    const at = secondsAt(e.clientX)
    setDrag({ fromX: e.clientX, from: at, toX: e.clientX, to: at })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (grab === "position") {
      player.seek(secondsAt(e.clientX))
      return
    }
    // An edge dragged past its opposite stops there rather than turning the
    // region inside out, which is disorienting when you are watching it.
    if (grab === "a") {
      const at = Math.min(secondsAt(e.clientX), region.b ?? duration)
      player.setRegion(at, region.b ?? duration)
      return
    }
    if (grab === "b") {
      const at = Math.max(secondsAt(e.clientX), region.a ?? 0)
      player.setRegion(region.a ?? 0, at)
      return
    }
    if (!drag) return
    setDrag({ ...drag, toX: e.clientX, to: secondsAt(e.clientX) })
  }

  const finishPointer = () => {
    if (grab) {
      setGrab(null)
      return
    }
    if (!drag) return
    if (Math.abs(drag.toX - drag.fromX) < DRAG_THRESHOLD_PX) player.seek(drag.from)
    else player.setRegion(drag.from, drag.to)
    setDrag(null)
  }

  const grabHandle = (which: "a" | "b" | "position") => (e: React.PointerEvent) => {
    e.stopPropagation()
    surfaceRef.current?.setPointerCapture(e.pointerId)
    setGrab(which)
  }

  const rows = media.length
  const ticks = tickTimes(duration, width)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        className="grid"
        style={{
          gridTemplateColumns: `${GUTTER_PX}px 1fr`,
          gridTemplateRows: `${RULER_PX}px repeat(${rows}, minmax(${LANE_MIN_PX}px, 1fr))`,
          gap: `${ROW_GAP_PX}px 12px`,
          // Two tracks in a tall window would otherwise give lanes the height
          // of a door. Past this the leftover space simply stays empty, which
          // is honest about there being room for more tracks.
          maxHeight: RULER_PX + rows * (LANE_MAX_PX + ROW_GAP_PX),
        }}
      >
        <div className="flex items-end pb-1 text-xs text-muted-foreground">
          {band ? "Drag the edges" : "Drag across to loop"}
        </div>

        <div role="group" aria-label="Timeline clock" className="relative border-b">
          {ticks.map((t) => (
            <Fragment key={t}>
              <span
                className="absolute top-4 bottom-0 w-px bg-border"
                style={{ left: `${pct(t)}%` }}
              />
              <span
                className="tnum absolute top-0 pl-1.5 text-[11px] text-muted-foreground"
                style={{ left: `${pct(t)}%` }}
              >
                {formatMMSS(t)}
              </span>
            </Fragment>
          ))}
        </div>

        {media.map((m) => {
          const muted = player.isMuted(m.name)
          const soloed = player.isSoloed(m.name)
          const dimmed = muted || (player.hasSolo && !soloed)
          return (
            <Fragment key={m.name}>
              <div className="flex flex-col justify-center gap-2.5 rounded-lg border bg-card px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      dimmed && "text-muted-foreground"
                    )}
                  >
                    {m.name}
                  </span>
                  <Button
                    variant={muted ? "default" : "outline"}
                    size="icon-sm"
                    aria-pressed={muted}
                    aria-label={`Mute ${m.name}`}
                    onClick={() => player.toggleMute(m.name)}
                    className={cn(
                      "shrink-0 font-semibold",
                      muted && "bg-warn text-warn-foreground hover:bg-warn/90"
                    )}
                  >
                    M
                  </Button>
                  <Button
                    variant={soloed ? "default" : "outline"}
                    size="icon-sm"
                    aria-pressed={soloed}
                    aria-label={`Solo ${m.name}`}
                    onClick={() => player.toggleSolo(m.name)}
                    className="shrink-0 font-semibold"
                  >
                    S
                  </Button>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={player.getVolume(m.name)}
                  onChange={(e) => player.setVolume(m.name, Number(e.target.value))}
                  onPointerUp={player.persistVolumes}
                  onKeyUp={player.persistVolumes}
                  aria-label={`${m.name} volume`}
                  className="h-1 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
              </div>

              <Waveform
                peaks={m.peaks}
                duration={duration}
                position={position}
                dimmed={dimmed}
                className={cn("h-full rounded-lg border", dimmed && "opacity-60")}
              />
            </Fragment>
          )
        })}

        <div
          ref={surfaceRef}
          role="group"
          aria-label="Take timeline"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
          className="relative cursor-crosshair select-none"
          style={{ gridColumn: 2, gridRow: "1 / -1" }}
        >
          {band && (
            <span
              className="pointer-events-none absolute border-x border-warn/60 bg-warn/10"
              style={{
                left: `${pct(band.a)}%`,
                width: `${pct(band.b) - pct(band.a)}%`,
                top: RULER_PX,
                bottom: 0,
              }}
            />
          )}

          {band && (
            <span
              className="pointer-events-none absolute rounded bg-warn px-1.5 py-px text-[11px] text-warn-foreground tnum"
              style={{ left: `${pct(band.a)}%`, top: RULER_PX + 6, marginLeft: 8 }}
            >
              {formatMMSS(band.a)} – {formatMMSS(band.b)}
            </span>
          )}

          {markers.map((m) => (
            <Fragment key={m.at}>
              <span
                className="pointer-events-none absolute w-0.5 opacity-60"
                style={{
                  left: `${pct(m.at)}%`,
                  top: RULER_PX,
                  bottom: 0,
                  background: `var(${markerStyle(m.kind).cssVar})`,
                }}
              />
              <span
                className="pointer-events-none absolute size-2.5 -translate-x-1 rotate-45 rounded-[2px]"
                style={{
                  left: `${pct(m.at)}%`,
                  top: RULER_PX - 13,
                  background: `var(${markerStyle(m.kind).cssVar})`,
                }}
                title={m.note || markerStyle(m.kind).label}
              />
            </Fragment>
          ))}

          {region.a !== null && region.b !== null && (
            <>
              <span
                onPointerDown={grabHandle("a")}
                className="absolute flex w-3 -translate-x-1.5 cursor-ew-resize items-center justify-center"
                style={{ left: `${pct(region.a)}%`, top: RULER_PX, bottom: 0 }}
              >
                <span className="h-11 w-1.5 rounded-full bg-warn" />
              </span>
              <span
                onPointerDown={grabHandle("b")}
                className="absolute flex w-3 -translate-x-1.5 cursor-ew-resize items-center justify-center"
                style={{ left: `${pct(region.b)}%`, top: RULER_PX, bottom: 0 }}
              >
                <span className="h-11 w-1.5 rounded-full bg-warn" />
              </span>
            </>
          )}

          <span
            className="pointer-events-none absolute w-0.5 bg-primary"
            style={{ left: `${pct(position)}%`, top: RULER_PX - 14, bottom: 0 }}
          />
          {/* Dragging the waveform used to scrub. That gesture now draws the
              region, so scrubbing gets a grip of its own rather than being
              quietly dropped. */}
          <span
            onPointerDown={grabHandle("position")}
            aria-hidden="true"
            className="absolute size-3 -translate-x-1.5 cursor-ew-resize rounded-full bg-primary"
            style={{ left: `${pct(position)}%`, top: RULER_PX - 20 }}
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rebuild `TakePlayer` around it**

Replace the body of `ui/src/components/TakePlayer.tsx` between the transport and the marker chips. The whole `media.map(...)` block (lines 74–153 of the current file) goes, and in its place:

```tsx
      <Timeline player={player} markers={markers} />
```

Add `import { Timeline } from "@/components/Timeline"`, and drop the now-unused imports (`Waveform`, `markerStyle` stays for the chips, `cn` stays). Remove the `compact` prop from the component's props and its two uses — with the player no longer living inside a list row there is nothing to be compact for. The root element becomes:

```tsx
    <div className="flex min-h-0 flex-1 flex-col gap-3">
```

In `Transport`, change the A and B buttons so they read the region back, and keep their job of putting an edge at the cursor:

```tsx
        <Button
          variant="outline"
          size="sm"
          onClick={player.markA}
          disabled={player.loading}
          title="Start of the loop region — at the current position"
          className="tnum"
        >
          A{player.region.a !== null ? ` ${formatMMSS(player.region.a)}` : ""}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={player.markB}
          disabled={player.loading}
          title="End of the loop region — at the current position"
          className="tnum"
        >
          B{player.region.b !== null ? ` ${formatMMSS(player.region.b)}` : ""}
        </Button>
```

- [ ] **Step 5: Run the suite**

```bash
cd ui && npm run build && cd ..
python3 tests/run_all.py
```

Expected: the three new gesture checks pass. Existing checks in section `[9]` that press `aria-label='Repeat'`, `Mute Guitar` and `Solo Vocals` must still pass — the gutter keeps those exact labels. If `page.click("button[aria-label='Mute Guitar']")` now misses, the gutter's labels drifted; fix the component, not the test.

- [ ] **Step 6: Commit**

```bash
git add ui/src/components/Timeline.tsx ui/src/components/TakePlayer.tsx tests/test_interface.py
git commit -m "Put every track of a take on one timeline, and draw the loop on it"
```

---

### Task 3: Give the player screens the window

**Files:**
- Modify: `ui/src/screens/Review.tsx:126`
- Modify: `ui/src/screens/Rehearsal.tsx:192`
- Modify: `ui/src/screens/HistoryScreen.tsx:208`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. This is the one-line change the "A" mockup was, kept as its own task because it is separately reviewable and separately revertible.

- [ ] **Step 1: Widen the three containers**

In each of the three files, replace `mx-auto flex max-w-3xl flex-col` with `flex w-full flex-col`. Leave `HistoryScreen.tsx:283` (the list of past rehearsals) at `max-w-3xl` — a list of rehearsal rows is text, and text at 1200 px is worse, not better. Only screens holding a player widen.

Add to `Review.tsx`, above its container:

```tsx
      {/* The player wants the width; the name field does not. */}
```

and keep the name field capped:

```tsx
        <div className="flex max-w-xl flex-col gap-2">
```

- [ ] **Step 2: Run the suite**

```bash
cd ui && npm run build && cd ..
python3 tests/run_all.py
```

Expected: everything passes; no assertion depends on the container's width.

- [ ] **Step 3: Look at it**

```bash
python3 -m rehearsal_recorder
```

Open a rehearsal, expand a take, and confirm the timeline now runs the width of the window and the waveforms are readable. Close the app afterwards.

- [ ] **Step 4: Commit**

```bash
git add ui/src/screens/Review.tsx ui/src/screens/Rehearsal.tsx ui/src/screens/HistoryScreen.tsx
git commit -m "Let the screens with a player have the window"
```

---

### Task 4: Takes become a strip, and the player stays put

The expanding rows go. Takes become a single scrolling row of pills that select; one player sits below, always in the same place. The per-take actions move to the right of the strip, where they act on the take that is open.

**Files:**
- Create: `ui/src/components/TakeStrip.tsx`
- Create: `ui/src/components/RehearsalRow.tsx`
- Delete: `ui/src/components/TakeList.tsx`
- Modify: `ui/src/screens/Rehearsal.tsx`
- Modify: `ui/src/screens/HistoryScreen.tsx`
- Modify: `tests/test_interface.py`

**Interfaces:**
- Consumes: `<TakePlayer player markers onAddMarker onEditMarker onRemoveMarker />` from Task 2.
- Produces:
  - `useTakeStripPlayer(): { selected: Take | null; select(take: Take | null): void; reselect(take: Take | null): void; player: MultitrackPlayer }` — selection is sticky: clicking the open take does **not** close it, because with a strip there is nothing to gain by emptying the player.
  - `<TakeStrip takes selected onSelect onRename onShare onDelete cloudStates emptyHint />`
  - `<RehearsalRow name subtitle songsText takesText onClick onRename onDelete />` — moved verbatim from `TakeList.tsx`, no changes.

- [ ] **Step 1: Move `RehearsalRow` to its own file**

Create `ui/src/components/RehearsalRow.tsx` holding the `RehearsalRow` function exactly as it stands at the end of `TakeList.tsx` (lines 231–end after Task 1's edits), with the imports it needs: `ChevronDown`, `Pencil`, `Trash2` from `lucide-react` and `Button` from `@/components/ui/button`. Update `HistoryScreen.tsx`'s import to `import { RehearsalRow } from "@/components/RehearsalRow"`.

- [ ] **Step 2: Write the failing strip test**

Three places in `tests/test_interface.py` drive the old expanding rows and have to become the strip.

**`[7] Markers while listening back`** (line ~524). `page.click("text=Polyn 2")` now matches the pill, whose text also holds the number and the length, so pin it to the label:

```python
        print("\n[7] Markers while listening back")
        page.click("button[aria-label='Take 2 Polyn 2']")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)
        ok("picking a take opens it in the player below",
           page.get_by_role("group", name="Take timeline").count() == 1)
        ok("and the pill says it is the open one",
           page.locator("button[aria-label='Take 2 Polyn 2']")
               .get_attribute("aria-current") == "true")
```

**`[7b] When the chosen output is not there any more`** (line ~580) reopens the take by clicking its row twice — the first click used to close it. A pill does not close, so reload the player by stepping to the other take and back:

```python
        page.evaluate("() => { window.__OUTPUT_GONE__ = true }")
        page.click("button[aria-label='Take 1 Polyn']")      # away
        page.wait_for_timeout(200)
        page.click("button[aria-label='Take 2 Polyn 2']")    # and back
        page.wait_for_selector("text=using the system output", timeout=8000)
```

The two assertions that follow it stay exactly as they are.

**The long take.** In the mocked `get_rehearsal` (line ~248) give the history take a real length so the other end of the tick ladder gets exercised:

```js
    takes:[{take_number:1, name:'Polyn', duration_sec:600, markers:[],
            tracks:[{name:'Guitar', file:'/rec/g.wav'}]}]}),
```

and in `[11] Finishing and history`, after `page.wait_for_selector("text=Tuesday jam")`, open it and check the clock:

```python
        page.click("text=Tuesday jam")
        page.click("button[aria-label='Take 1 Polyn']")
        page.wait_for_selector("button[aria-label='Mute Guitar']", timeout=8000)
        ok("a ten-minute take gets a clock in minutes",
           "2:00" in page.get_by_role("group", name="Timeline clock").inner_text())
        page.click("button[aria-label='Back']")
        page.wait_for_selector("text=Tuesday jam")
```

Then search the file for any remaining `aria-expanded` and for `text=Polyn 2` used as a row click, and update those too. `ok("renaming does not close the player", ...)` keeps working as written, because `aria-label='Repeat'` still exists.

- [ ] **Step 3: Run it and watch it fail**

```bash
cd ui && npm run build && cd ..
python3 tests/test_interface.py
```

Expected: the pill selectors are not found.

- [ ] **Step 4: Write the strip**

Create `ui/src/components/TakeStrip.tsx`:

```tsx
import { useState } from "react"
import { Cloud, CloudCheck, Music2, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/Shell"
import {
  useMultitrackPlayer,
  type MultitrackPlayer,
} from "@/hooks/useMultitrackPlayer"
import { cn } from "@/lib/utils"
import { MARKER_KINDS } from "@/lib/markers"
import { formatMMSS } from "@/lib/format"
import type { Take } from "@/lib/api"

export function useTakeStripPlayer() {
  const [selected, setSelected] = useState<Take | null>(null)
  const player = useMultitrackPlayer(
    selected?.tracks ?? null,
    selected?.duration_sec ?? 0
  )

  // Nothing is open until somebody picks a take: opening a rehearsal should
  // not start reading audio files nobody asked for. Once one is open it
  // stays open — with a strip there is nothing to gain by emptying the
  // player, and the old rows only closed because they had to make room.
  const select = (take: Take | null) => setSelected(take)

  // After a rename the take's files have moved, so the player has to be
  // pointed at the fresh paths.
  const reselect = (take: Take | null) => setSelected(take)

  return { selected, select, reselect, player }
}

/**
 * The takes of a rehearsal as one scrolling row. It does not wrap: a
 * rehearsal with thirty takes would otherwise push the player off the screen,
 * and the player is the thing you came for.
 */
export function TakeStrip({
  takes,
  selected,
  onSelect,
  onRename,
  onShare,
  onDelete,
  cloudStates,
  emptyHint,
}: {
  takes: Take[]
  selected: Take | null
  onSelect: (take: Take) => void
  onRename?: (take: Take) => void
  onShare?: (take: Take) => void
  onDelete?: (take: Take) => void
  cloudStates?: Record<number, "queued" | "working">
  emptyHint?: string
}) {
  if (takes.length === 0) {
    return (
      <EmptyState
        icon={<Music2 className="size-6" />}
        title="No takes yet"
        hint={emptyHint}
      />
    )
  }

  const isShared = Boolean(selected?.cloud?.mix || selected?.cloud?.tracks)
  const cloudState = selected ? cloudStates?.[selected.take_number] : undefined

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs tracking-wide text-muted-foreground uppercase">
        Takes
      </span>

      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
        {takes.map((take) => {
          const open = selected?.take_number === take.take_number
          return (
            <button
              key={take.take_number}
              type="button"
              aria-label={`Take ${take.take_number} ${take.name}`}
              aria-current={open ? "true" : undefined}
              onClick={(e) => {
                onSelect(take)
                // Otherwise focus stays on the pill and Space picks it again
                // instead of starting playback.
                e.currentTarget.blur()
              }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                open
                  ? "border-primary bg-primary/15"
                  : "bg-card hover:bg-accent/50"
              )}
            >
              <span className="tnum text-[11px] text-muted-foreground">
                {String(take.take_number).padStart(2, "0")}
              </span>
              <span className="max-w-40 truncate">{take.name}</span>
              {MARKER_KINDS.filter((k) =>
                take.markers?.some((m) => m.kind === k.kind)
              ).map((k) => (
                <span
                  key={k.kind}
                  title={k.label}
                  className={cn("size-1.5 shrink-0 rounded-full", k.dot)}
                />
              ))}
              <span className="tnum text-[11px] text-muted-foreground">
                {formatMMSS(take.duration_sec)}
              </span>
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="flex shrink-0 items-center gap-1">
          {cloudState && (
            <span className="text-xs text-muted-foreground">
              {cloudState === "working"
                ? "Copying to the cloud"
                : "Waiting for the cloud"}
            </span>
          )}
          {!cloudState && selected.cloud_error && (
            <span className="text-xs text-destructive" title={selected.cloud_error}>
              Not in the cloud
            </span>
          )}
          {onRename && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename take ${selected.name}`}
              onClick={() => onRename(selected)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil />
            </Button>
          )}
          {onShare && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                isShared
                  ? `Cloud copies of ${selected.name}`
                  : `Copy ${selected.name} to the cloud`
              }
              title={
                isShared ? "In the cloud folder" : "Copy this take to the cloud folder"
              }
              onClick={() => onShare(selected)}
              className={cn(
                isShared
                  ? "text-signal hover:text-signal"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isShared ? <CloudCheck /> : <Cloud />}
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete take ${selected.name}`}
              onClick={() => onDelete(selected)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Wire the two screens**

In `Rehearsal.tsx` and `HistoryScreen.tsx`, replace the `<TakeList ... />` call with the strip plus the player.

The two screens do not pass the same props, so keep their existing ones:
`Rehearsal.tsx` passes `takes={session.takes}`, `onRename={setToRename}`,
`onShare={setToShare}`, `onDelete={setToDelete}`, `cloudStates={session.cloud_queue}`
and its own `emptyHint`; `HistoryScreen.tsx` passes `takes={opened.takes}`,
`onRename={setTakeToRename}`, `onShare={setTakeToShare}`,
`onDelete={setTakeToDelete}` and **no** `cloudStates` — the queue only exists
during a rehearsal. Both keep `selected={selected}` and `onSelect={select}`.
The history version, with its names:

```tsx
          <TakeStrip
            takes={opened.takes}
            selected={selected}
            onSelect={select}
            onRename={setTakeToRename}
            onShare={setTakeToShare}
            onDelete={setTakeToDelete}
          />

          {selected ? (
            <TakePlayer
              player={player}
              markers={selected.markers ?? []}
              onAddMarker={(sec) => addMarker(selected, sec)}
              onEditMarker={(m) => setMarkerEdit({ take: selected, marker: m })}
              onRemoveMarker={(sec) => removeMarker(selected, sec)}
            />
          ) : (
            takes.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Pick a take to listen back to it.
              </p>
            )
          )}
```

Change both imports from `@/components/TakeList` to `@/components/TakeStrip`, and `useTakeListPlayer` to `useTakeStripPlayer`. Delete `ui/src/components/TakeList.tsx`.

- [ ] **Step 6: Run the suite**

```bash
cd ui && npm run build && cd ..
python3 tests/run_all.py
```

Expected: all green. Every `TakeList` reference must be gone — `grep -rn "TakeList" ui/src` returns nothing.

- [ ] **Step 7: Commit**

```bash
git add -A ui/src tests/test_interface.py
git commit -m "Takes become a strip, and the player stops moving"
```

---

### Task 5: Waveform goes back to drawing a waveform

**Files:**
- Modify: `ui/src/components/Waveform.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `<Waveform peaks duration position dimmed className />` — `loop`, `markers` and `onSeek` are gone.

- [ ] **Step 1: Strip the props that moved to the Timeline**

Remove the `loop`, `markers` and `onSeek` props and everything that used them: the loop `fillRect` (lines 62–67), the marker loop (lines 83–99), `seekFromEvent`, both pointer handlers, the `--wf-loop` and `--wf-marker` custom properties, the playhead `div`, and the `markerStyle` / `Marker` imports. Keep the peaks drawing with its played/rest colouring, the `ResizeObserver`, and `--wf-played` / `--wf-rest`.

Update the doc comment to say what it now is:

```tsx
/**
 * One track's waveform, and nothing else. The peaks arrive ready-made from
 * Python (one value per bar), so drawing costs nothing and the browser never
 * has to decode audio just to show a picture.
 *
 * The played part is highlighted; the loop region, the markers and the
 * playhead belong to the whole take rather than to one track, so Timeline
 * draws them once across every lane instead of each waveform drawing its own.
 */
```

The effect's dependency array drops `loop` and `markers`:

```tsx
  }, [peaks, duration, position])
```

- [ ] **Step 2: Run the suite**

```bash
cd ui && npm run build && cd ..
python3 tests/run_all.py
```

Expected: all green. TypeScript is the real check here — `tsc -b` runs as part of `npm run build` and will name any leftover caller passing a removed prop.

- [ ] **Step 3: Commit**

```bash
git add ui/src/components/Waveform.tsx
git commit -m "A waveform draws a waveform"
```

---

### Task 6: Say what changed

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/using-it.md`

**Interfaces:**
- Consumes: the finished behaviour.
- Produces: nothing code depends on.

- [ ] **Step 1: Add the changelog entry**

At the top of `CHANGELOG.md`, above `## 0.3.0`:

```markdown
## Unreleased

- The player runs on one timeline across the window instead of a column in
  the middle of it. Every track shares the same time axis, so where one of
  them came apart is now a thing you can point at.
- The repeat region is drawn with the mouse across the tracks, in either
  direction, and its edges can be dragged afterwards. A press that does not
  travel still seeks, as it always did. A and B keep their jobs for when you
  have just heard the exact spot and want it to the tenth of a second.
- Takes in a rehearsal and in history are a strip along the top rather than
  rows that expand. The player sits below and stops moving when you switch
  takes.
```

- [ ] **Step 2: Update the player section of `docs/using-it.md`**

In "The player", after the sentence explaining that audio is played by Python, add:

```markdown
All the tracks of a take share one timeline: a ruler at the top with the
clock, the markers and the playhead, a lane each underneath, and the fader
with M and S in the gutter on the left. Anything that belongs to the take
rather than to one track — the A–B region, the marker lines, the playhead —
is drawn once across every lane, which is what makes it possible to see that
two tracks parted company at 1:12.

Drag across the timeline to set the repeat region, in either direction; the
edges can be dragged afterwards. A click without a drag seeks, as before, and
the A and B buttons put an edge exactly at the cursor for when you have found
the spot by ear. The playhead has a grip of its own on the ruler: dragging
that scrubs, which is what dragging the waveform used to do.
```

Also update the **History** and **Rehearsal** bullets in the screens list: takes are a strip, not rows that expand.

- [ ] **Step 3: Run the suite one last time and commit**

```bash
python3 tests/run_all.py
git add CHANGELOG.md docs/using-it.md
git commit -m "Describe the timeline where people read about the player"
```

---

## Notes for the executor

- **The interface suite drives `ui/dist`.** Every task that touches `ui/src` must rebuild before testing. A test that fails in a way that makes no sense is usually a stale bundle.
- **Do not add a JavaScript test framework.** This project has none on purpose (`tests/README.md`); UI behaviour is tested through Playwright against the real bundle.
- **Do not touch `src/rehearsal_recorder/`.** Nothing in this plan needs Python, and the engine suite should stay untouched and green throughout.
- If a task's tests pass but the screen looks wrong, say so in the report rather than fixing it silently in a later task — the layout numbers in the Global Constraints came from the spec and are the thing to argue with.
