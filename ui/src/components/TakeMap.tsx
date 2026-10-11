import { useRef } from "react"
import { MoveHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatMMSS } from "@/lib/format"
import { useSystem, words } from "@/lib/platform"
import { cn } from "@/lib/utils"

/**
 * The whole take in one strip above the ruler: a frame round the part on
 * screen, the region, and the playhead.
 *
 * Zoomed in, only two times in a corner said which part of the take was on
 * screen, and "Whole take" beside them read as one more word rather than a
 * button. The map says where you are at a glance, and it is also the way
 * about: drag the frame to move along the take, or press anywhere else on the
 * map to bring that part on screen, and drag on from there.
 *
 * It is there zoomed out as well, with nothing framed, and says how to zoom
 * where Whole take will be: shown only once zoomed in, it moved every track
 * down the moment the wheel was turned.
 */
export function TakeMap({
  duration,
  from,
  to,
  zoomed,
  position,
  region,
  closest,
  gutterPx,
  gapPx,
  controls,
  onMove,
  onWhole,
}: {
  duration: number
  from: number
  to: number
  /** Less than the whole take is on screen. */
  zoomed: boolean
  position: number
  /** The region, when there is one. */
  region: { a: number; b: number } | null
  /** Zoomed in as far as it goes. */
  closest: boolean
  /** The width of the column left of the ruler, and the gap after it, so
   *  the map lines up with the take it is a map of. */
  gutterPx: number
  gapPx: number
  /** The id of the timeline the map moves. */
  controls: string
  onMove: (from: number, to: number) => void
  onWhole: () => void
}) {
  const { mod } = words(useSystem())
  const stripRef = useRef<HTMLDivElement>(null)
  // Where in the frame the pointer took hold of it, in seconds, so the frame
  // does not jump to centre itself under the pointer when it is dragged.
  const held = useRef<number | null>(null)
  const span = to - from
  const pct = (seconds: number) =>
    duration > 0 ? Math.min(100, Math.max(0, (seconds / duration) * 100)) : 0

  const secondsAt = (clientX: number) => {
    const box = stripRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return 0
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * duration
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || duration <= 0) return
    e.preventDefault()
    stripRef.current?.setPointerCapture(e.pointerId)
    const at = secondsAt(e.clientX)
    if (at >= from && at <= to) {
      held.current = at - from
    } else {
      held.current = span / 2
      onMove(at - span / 2, at + span / 2)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (held.current === null || e.buttons !== 1) return
    const start = secondsAt(e.clientX) - held.current
    onMove(start, start + span)
  }

  const letGo = () => {
    held.current = null
  }

  return (
    <div
      className="grid items-center"
      style={{ gridTemplateColumns: `${gutterPx}px 1fr`, columnGap: gapPx }}
    >
      <div className="flex min-h-6 items-center justify-between gap-2 text-xs text-muted-foreground">
        {zoomed ? (
          <>
            {/* One line: "0:04 – 0:06 · closest" did not fit beside the
                button and broke in two, so the closest is said on the map. */}
            <span data-view-range className="tnum whitespace-nowrap">
              {formatMMSS(from)} – {formatMMSS(to)}
            </span>
            <Button
              variant="outline"
              size="row"
              className="h-6 shrink-0 gap-1.5 px-2 text-xs"
              onClick={onWhole}
            >
              <MoveHorizontal className="size-3.5" />
              Whole take
            </Button>
          </>
        ) : (
          <span>{mod} + wheel to zoom</span>
        )}
      </div>

      <div
        ref={stripRef}
        role="scrollbar"
        aria-label="Part of the take on screen"
        aria-controls={controls}
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(from)}
        aria-valuetext={`${formatMMSS(from)} – ${formatMMSS(to)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        className={cn(
          "relative h-[18px] touch-none overflow-hidden rounded-sm border bg-muted/85 select-none",
          // Zoomed out there is nowhere to move the frame to.
          zoomed && "cursor-pointer"
        )}
      >
        {region && (
          <span
            data-map-region
            className="pointer-events-none absolute inset-y-0 bg-warn/45"
            style={{ left: `${pct(region.a)}%`, width: `${pct(region.b) - pct(region.a)}%` }}
          />
        )}
        {/* A tint, not an outline: drawn with a thick blue edge it was the
            loudest thing on the map. Zoomed out there is nothing to frame,
            and round all of it that edge was all there was. */}
        {zoomed && (
          <span
            data-view-frame
            className="absolute inset-y-0 min-w-1.5 cursor-grab rounded-sm bg-primary/30 active:cursor-grabbing"
            style={{ left: `${pct(from)}%`, width: `${pct(to) - pct(from)}%` }}
          />
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-px bg-primary/80"
          style={{ left: `${pct(position)}%` }}
        />
        {/* Why the wheel has stopped answering: the window is as narrow as
            it goes. Without a word saying so that reads as the zoom having
            broken. */}
        {zoomed && closest && (
          <span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center text-[10px] text-muted-foreground">
            closest zoom
          </span>
        )}
      </div>
    </div>
  )
}
