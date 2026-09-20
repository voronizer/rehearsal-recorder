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
  // `origin` is the grabbed edge's own position before this gesture touched
  // it — needed once the gesture crosses the opposite edge (see below).
  const [grab, setGrab] = useState<
    { which: "a" | "b" | "position"; origin: number } | null
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
    if (grab?.which === "position") {
      player.seek(secondsAt(e.clientX))
      return
    }
    // An edge normally stays on its own side of the other one. Once it is
    // dragged onto or past the opposite edge, that edge lets go and the
    // region becomes the span between where this edge started and where the
    // pointer is now — a fresh region, not a sliver collapsed to nothing.
    if (grab?.which === "a") {
      const raw = secondsAt(e.clientX)
      const anchor = region.b ?? duration
      if (raw < anchor) player.setRegion(raw, anchor)
      else player.setRegion(grab.origin, raw)
      return
    }
    if (grab?.which === "b") {
      const raw = secondsAt(e.clientX)
      const anchor = region.a ?? 0
      if (raw > anchor) player.setRegion(anchor, raw)
      else player.setRegion(raw, grab.origin)
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
    const origin =
      which === "a" ? (region.a ?? 0) : which === "b" ? (region.b ?? duration) : 0
    setGrab({ which, origin })
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
