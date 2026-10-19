import { MeterText } from "@/components/metronome/NoteGlyph"
import { usePlayerClick } from "@/hooks/usePlayerClick"
import { formatMeter } from "@/lib/format"
import { clickLines, clickOf, type TakeClick } from "@/lib/metronome"
import { cn } from "@/lib/utils"

/** What the lane says of a take that has no click, on screen and to a
 *  screen reader. */
const NO_CLICK = "Recorded without the click"

/**
 * Master's lane, right of its plate and as tall as a track's (spec Part 8,
 * Q11 D): the take's click as stripes, a bar's taller and stronger than a
 * beat's, on a well as the tracks' pictures are, over the same seconds as
 * theirs, `from` to `to`. Dimmed to half while the click is off; the
 * playhead and the region over it as over the tracks; the tempo in its
 * corner. With many clicks in view it draws the bars only, and with very
 * many every fourth bar (`clickLines`). A drag across it sets the region as
 * one across the tracks does: the Timeline takes the pointer.
 *
 * A take recorded without the click has no stripes, and says so.
 */
export function MasterClickLane({
  from,
  to,
  position,
  region = null,
  take,
  className,
}: {
  from: number
  to: number
  /** The playhead, in the take's seconds. */
  position: number
  /** The region as the tracks show it, while it is dragged too. */
  region?: { a: number; b: number } | null
  take: TakeClick | null
  className?: string
}) {
  const meter = clickOf(take)
  const on = usePlayerClick()
  const span = Math.max(0.001, to - from)
  const pct = (t: number) => ((t - from) / span) * 100
  const lines = meter ? clickLines(meter.tempo, meter.signature, from, to) : []

  return (
    <div
      data-master-lane
      role="img"
      aria-label={meter ? `Click ${formatMeter(meter.tempo, meter.signature)}` : NO_CLICK}
      className={cn("relative h-full min-w-0 overflow-hidden rounded-md bg-well", className)}
    >
      <div data-click-lines aria-hidden className={cn("absolute inset-0", !on && "opacity-50")}>
        {lines.map(({ t, bar }) => (
          <span
            key={t}
            data-click-line
            data-bar={bar ? "" : undefined}
            className={cn(
              "absolute w-px",
              bar ? "inset-y-1.5 bg-foreground/50" : "inset-y-4 bg-foreground/25"
            )}
            style={{ left: `${pct(t)}%` }}
          />
        ))}
      </div>
      {region && (
        <span
          data-master-region
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-x border-warn/60 bg-warn/10"
          style={{ left: `${pct(region.a)}%`, width: `${pct(region.b) - pct(region.a)}%` }}
        />
      )}
      {position >= from && position <= to && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
          style={{ left: `${pct(position)}%` }}
        />
      )}
      <span
        data-click-tag
        aria-hidden
        className="absolute top-1 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-sm bg-well/90 px-1 text-xs text-muted-foreground"
      >
        {meter ? (
          <>
            Click <MeterText tempo={meter.tempo} signature={meter.signature} />
          </>
        ) : (
          NO_CLICK
        )}
      </span>
    </div>
  )
}
