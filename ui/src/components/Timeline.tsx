import { Fragment, useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Waveform } from "@/components/Waveform"
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { markerStyle } from "@/lib/markers"
import { MIN_VIEW_SEC, tickTimes } from "@/lib/timeline"
import type { Marker } from "@/lib/api"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"

/** A press that never travelled this far is a click, and a click seeks. */
const DRAG_THRESHOLD_PX = 5
const GUTTER_PX = 200
const LANE_MIN_PX = 64
const LANE_MAX_PX = 160
const RULER_PX = 44
const ROW_GAP_PX = 8
/** How fast the wheel zooms. One notch of a mouse wheel is about 100 units,
 *  so this makes a notch a fifth of the window. */
const ZOOM_PER_PIXEL = 0.002

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
  const from = player.view?.from ?? 0
  const to = player.view?.to ?? duration
  const span = Math.max(0.001, to - from)
  // While the user is panning by hand during playback, the window does not
  // chase the playhead — it resumes when the playhead comes back into view.
  const followingRef = useRef(true)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [drag, setDrag] = useState<{
    fromX: number
    from: number
    toX: number
    to: number
  } | null>(null)
  // The live value of whichever edge (or the playhead) is currently grabbed.
  // It stays local while the pointer is down and is sent to Python exactly
  // once, on release — not on every move, which would fire dozens of racing
  // IPC round-trips whose answers can arrive back out of order.
  const [grab, setGrab] = useState<
    { which: "a" | "b" | "position"; at: number } | null
  >(null)

  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const measure = () => setWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The wheel belongs to the gesture surface, which covers the waveforms and
  // nothing else — so a wheel over the track names beside them still scrolls
  // the lane stack, which is the only way to reach the eighth track. It has
  // to be a non-passive listener: React's onWheel cannot preventDefault, and
  // without that the scroll container takes the gesture.
  const { setView } = player
  useEffect(() => {
    const el = surfaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (duration <= 0) return
      const box = el.getBoundingClientRect()
      if (box.width === 0) return
      e.preventDefault()
      followingRef.current = false

      // Sideways on a trackpad, shift+wheel on a mouse: along the take.
      // Whichever axis carries the value, and that is not belt and braces:
      // Chromium leaves a shifted wheel in deltaY, while WebKit and Firefox
      // move it to deltaX and leave deltaY at zero — and WebKit is what this
      // app runs in on macOS, where reading deltaY would pan by nothing.
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const by = ((e.deltaX || e.deltaY) / box.width) * span
        setView(from + by, to + by)
        return
      }

      // Anchored zoom: the second under the pointer stays under the pointer.
      // A trackpad pinch arrives here too — the browser sends it as a wheel
      // event with ctrlKey set — and lands in this branch, which is what
      // stops it zooming the whole page instead.
      const ratio = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width))
      const anchor = from + ratio * span
      const next = Math.min(
        duration,
        Math.max(MIN_VIEW_SEC, span * Math.exp(e.deltaY * ZOOM_PER_PIXEL))
      )
      setView(anchor - ratio * next, anchor + (1 - ratio) * next)
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [setView, duration, from, to, span])

  // Zoomed in, playback leaves the window within seconds. The window pages
  // forward rather than sliding, which is calmer to watch.
  useEffect(() => {
    if (!player.playing || !player.view) {
      followingRef.current = true
      return
    }
    if (position >= from && position <= to) {
      followingRef.current = true
      return
    }
    if (!followingRef.current) return
    setView(position - span / 8, position + (span * 7) / 8)
  }, [setView, player.playing, player.view, position, from, to, span])

  const secondsAt = (clientX: number) => {
    const box = surfaceRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || duration <= 0) return 0
    const ratio = (clientX - box.left) / box.width
    return Math.min(duration, Math.max(0, from + ratio * span))
  }

  const pct = (seconds: number) =>
    duration > 0 ? ((seconds - from) / span) * 100 : 0

  const travelled = drag ? Math.abs(drag.toX - drag.fromX) : 0
  // While the pointer is down the band follows it; the committed region only
  // takes over once the drag is over.
  const freshLive =
    drag && travelled >= DRAG_THRESHOLD_PX
      ? { a: Math.min(drag.from, drag.to), b: Math.max(drag.from, drag.to) }
      : null
  // While an edge is being grabbed, the band tracks that edge's local value;
  // the region itself only commits once, on release (see finishPointer).
  const grabLive =
    grab?.which === "a"
      ? { a: grab.at, b: region.b ?? duration }
      : grab?.which === "b"
        ? { a: region.a ?? 0, b: grab.at }
        : null
  // The region is shown on the timeline as soon as either end is set, before
  // the repeat itself is switched on.
  const committed =
    region.a !== null || region.b !== null
      ? { a: region.a ?? 0, b: region.b ?? duration }
      : null
  const band = freshLive ?? grabLive ?? committed

  // The playhead follows the pointer while it is being dragged, and only
  // tells Python where it landed once the pointer is released.
  const displayPosition = grab?.which === "position" ? grab.at : position

  const onPointerDown = (e: React.PointerEvent) => {
    // Move already filters everything but the primary button (e.buttons !==
    // 1), but a right- or middle-click still reaches release with zero
    // travel, which finishPointer reads as a click and commits a seek.
    if (e.button !== 0) return
    if (duration <= 0) return
    surfaceRef.current?.setPointerCapture(e.pointerId)
    const at = secondsAt(e.clientX)
    setDrag({ fromX: e.clientX, from: at, toX: e.clientX, to: at })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    // A second pointer's release can clear one piece of gesture state and
    // leave the other stranded (see finishPointer); without this guard a
    // stranded `drag`/`grab` would keep following the bare cursor on hover
    // and commit a region the next time anything is pressed.
    if (e.buttons !== 1) return
    if (grab) {
      const raw = secondsAt(e.clientX)
      // An edge dragged past its opposite stops there rather than turning
      // the region inside out, which is disorienting when you are watching
      // it.
      if (grab.which === "a") {
        setGrab({ ...grab, at: Math.min(raw, region.b ?? duration) })
      } else if (grab.which === "b") {
        setGrab({ ...grab, at: Math.max(raw, region.a ?? 0) })
      } else {
        setGrab({ ...grab, at: raw })
      }
      return
    }
    if (!drag) return
    setDrag({ ...drag, toX: e.clientX, to: secondsAt(e.clientX) })
  }

  // Committing happens exactly once, here — not on every move — so Python
  // sees one call per gesture instead of a burst of racing seeks or loop
  // updates whose answers could arrive back out of order.
  const finishPointer = () => {
    if (grab) {
      if (grab.which === "position") player.seek(grab.at)
      else if (grab.which === "a") player.setRegion(grab.at, region.b ?? duration)
      else player.setRegion(region.a ?? 0, grab.at)
    } else if (drag) {
      if (Math.abs(drag.toX - drag.fromX) < DRAG_THRESHOLD_PX) player.seek(drag.from)
      else player.setRegion(drag.from, drag.to)
    }
    setDrag(null)
    setGrab(null)
  }

  // A cancelled gesture (the browser taking a touch over for scrolling, most
  // often) commits nothing — the user didn't let go on purpose.
  const cancelPointer = () => {
    setDrag(null)
    setGrab(null)
  }

  const grabHandle = (which: "a" | "b" | "position") => (e: React.PointerEvent) => {
    e.stopPropagation()
    surfaceRef.current?.setPointerCapture(e.pointerId)
    const at =
      which === "a" ? (region.a ?? 0) : which === "b" ? (region.b ?? duration) : position
    setGrab({ which, at })
  }

  const rows = media.length
  const ticks = tickTimes(from, to, width)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div
        className="grid min-h-0 flex-1"
        style={{
          gridTemplateColumns: `${GUTTER_PX}px 1fr`,
          // `repeat(0, …)` is invalid, which drops the whole declaration —
          // and rows is 0 on every load until the first track's media
          // arrives, permanently so once loadError is set.
          gridTemplateRows:
            rows > 0
              ? `${RULER_PX}px repeat(${rows}, minmax(${LANE_MIN_PX}px, 1fr))`
              : `${RULER_PX}px`,
          gap: `${ROW_GAP_PX}px 12px`,
          // Two tracks in a tall window would otherwise give lanes the height
          // of a door. Past this the leftover space simply stays empty, which
          // is honest about there being room for more tracks.
          maxHeight: RULER_PX + rows * (LANE_MAX_PX + ROW_GAP_PX),
        }}
      >
        {/* Every child below is placed explicitly. The surface (further down)
            is also explicitly placed, spanning all of column 2 — leaving any
            other child to auto-place would make CSS grid skip that occupied
            column entirely and stack everything into column 1 instead. */}
        <div
          className="flex items-end justify-between gap-2 pb-1 text-xs text-muted-foreground"
          style={{ gridColumn: 1, gridRow: 1 }}
        >
          {player.view ? (
            <>
              <span className="tnum truncate">
                {formatMMSS(from)} – {formatMMSS(to)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2 text-xs"
                onClick={player.resetView}
              >
                Whole take
              </Button>
            </>
          ) : (
            <span>{band ? "Drag the edges" : "Drag across to loop"}</span>
          )}
        </div>

        <div
          role="group"
          aria-label="Timeline clock"
          className="relative border-b"
          style={{ gridColumn: 2, gridRow: 1 }}
        >
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

        {media.map((m, i) => {
          const muted = player.isMuted(m.name)
          const soloed = player.isSoloed(m.name)
          const dimmed = muted || (player.hasSolo && !soloed)
          return (
            <Fragment key={m.name}>
              <div
                className="flex flex-col justify-center gap-2.5 rounded-lg border bg-card px-3.5 py-3"
                style={{ gridColumn: 1, gridRow: i + 2 }}
              >
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

              <div className="min-w-0" style={{ gridColumn: 2, gridRow: i + 2 }}>
                <Waveform
                  peaks={m.peaks}
                  peaksFrom={player.peaksWindow.from}
                  peaksTo={player.peaksWindow.to}
                  viewFrom={from}
                  viewTo={to}
                  position={position}
                  dimmed={dimmed}
                  className={cn("h-full rounded-lg border", dimmed && "opacity-60")}
                />
              </div>
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
          onPointerCancel={cancelPointer}
          className="relative cursor-crosshair overflow-hidden select-none"
          style={{ gridColumn: 2, gridRow: "1 / -1", touchAction: "none" }}
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

          {/* Only while the band actually overlaps the window — otherwise the
              rectangle is correctly clipped away by overflow-hidden, but the
              chip has nowhere honest to sit and would be left pinned to an
              edge, labelling a stretch of the take it has nothing to do
              with. */}
          {band && band.b >= from && band.a <= to && (
            <span
              data-region-span
              className="pointer-events-none absolute rounded bg-warn px-1.5 py-px text-[11px] text-warn-foreground tnum"
              style={{ left: `${Math.max(0, pct(band.a))}%`, top: RULER_PX + 6, marginLeft: 8 }}
            >
              {formatMMSS(band.a)} – {formatMMSS(band.b)}
            </span>
          )}

          {markers
            .filter((m) => m.at >= from && m.at <= to)
            .map((m) => (
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
                  data-marker-at={m.at}
                  className="pointer-events-none absolute size-2.5 -translate-x-1 rotate-45 rounded-[2px]"
                  style={{
                    left: `${pct(m.at)}%`,
                    top: RULER_PX - 13,
                    background: `var(${markerStyle(m.kind).cssVar})`,
                  }}
                />
              </Fragment>
            ))}

          {/* The grab target lives entirely inside the ruler band, not down
              the whole lane height — a press anywhere on the tracks always
              starts a fresh region. The full-height band border above still
              marks the edge through the lanes; this is only where you take
              hold of it. The ruler's own height is this project's minimum
              touch target, and a higher z-index keeps it from losing presses
              to the playhead grip, which occupies the same band. Each handle
              only appears once its own end is actually set — a region with
              just an A has nothing to grab at B yet. */}
          {region.a !== null && (
            <span
              onPointerDown={grabHandle("a")}
              className="absolute z-10 flex w-4 -translate-x-2 cursor-ew-resize items-center justify-center"
              style={{ left: `${pct(region.a)}%`, top: 0, height: RULER_PX }}
            >
              <span className="h-11 w-1.5 rounded-full bg-warn" />
            </span>
          )}
          {region.b !== null && (
            <span
              onPointerDown={grabHandle("b")}
              className="absolute z-10 flex w-4 -translate-x-2 cursor-ew-resize items-center justify-center"
              style={{ left: `${pct(region.b)}%`, top: 0, height: RULER_PX }}
            >
              <span className="h-11 w-1.5 rounded-full bg-warn" />
            </span>
          )}

          <span
            className="pointer-events-none absolute w-0.5 bg-primary"
            style={{ left: `${pct(displayPosition)}%`, top: RULER_PX - 14, bottom: 0 }}
          />
          {/* Dragging the waveform used to scrub. That gesture now draws the
              region, so scrubbing gets a grip of its own rather than being
              quietly dropped. Local while held, same as the edges — see
              `displayPosition`. */}
          <span
            onPointerDown={grabHandle("position")}
            aria-hidden="true"
            className="absolute size-3 -translate-x-1.5 cursor-ew-resize rounded-full bg-primary"
            style={{ left: `${pct(displayPosition)}%`, top: RULER_PX - 20 }}
          />
        </div>
      </div>
    </div>
  )
}
