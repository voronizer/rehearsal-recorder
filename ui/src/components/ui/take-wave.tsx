import type { CSSProperties } from "react"
import type { LabelColour } from "@/lib/api"
import { labelLook } from "@/lib/labels"
import type { Shape } from "@/lib/shapes"
import { cn } from "@/lib/utils"

/** How many bars a wave has when it has no shape yet, or nothing to draw. */
const FLAT = 120

/**
 * A take's wave in a list (owner's pick A, 2026-11-02), as the band service
 * draws it: its shape as thin bars, the part played darker, each mark a line
 * in its label's colour with a diamond on top, and the playhead. A starred
 * take's is green; a false start's, or one not on disk, is pale (`quiet`).
 * Until its shape is in, and for a take with nothing to draw, it is a flat
 * line, so the row does not jump when it comes.
 *
 * A press plays the take from there (`onPress`, given the second). It is a
 * picture for the pointer: the take's ▶ and its name are what Tab reaches.
 */
export function TakeWave({
  shape,
  duration,
  played = null,
  starred = false,
  quiet = false,
  marks = [],
  onPress,
  className,
  style,
}: {
  shape: Shape | null
  /** The take's length, in seconds, for where a press and a mark are. */
  duration: number
  /** How much of it has been played, 0..1, while it is the one playing. */
  played?: number | null
  starred?: boolean
  quiet?: boolean
  marks?: { at: number; colour: LabelColour }[]
  onPress?: (at: number) => void
  className?: string
  style?: CSSProperties
}) {
  const bars = shape?.length ? shape.map((v) => Math.max(0.08, Math.min(1, v))) : Array(FLAT).fill(0.08)
  const n = bars.length
  const length = duration > 0 ? duration : 1
  return (
    <div
      aria-hidden
      data-wave={quiet ? "quiet" : starred ? "starred" : "rest"}
      data-shaped={shape?.length ? true : undefined}
      onClick={
        onPress &&
        ((e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onPress(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration)
        })
      }
      className={cn("relative h-7 min-w-8 py-[3px]", onPress && "cursor-pointer", className)}
      style={style}
    >
      <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="size-full">
        {bars.map((v, i) => (
          <rect
            key={i}
            x={i + 0.2}
            y={50 - v * 46}
            width={0.6}
            height={v * 92}
            rx={0.3}
            className={
              played !== null && (i + 1) / n <= played
                ? starred
                  ? "fill-signal"
                  : "fill-foreground/70"
                : quiet
                  ? "fill-muted-foreground/25"
                  : starred
                    ? // On a dark card the lighter green would sink into it.
                      "fill-signal/55 dark:fill-signal/80"
                    : "fill-muted-foreground/45"
            }
          />
        ))}
      </svg>
      {marks.map((m) => (
        <span
          key={m.at}
          data-slot="mark-tick"
          data-mark-colour={m.colour}
          className={cn("pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2", labelLook(m.colour).dot)}
          style={{ left: `${(Math.min(m.at, length) / length) * 100}%` }}
        >
          <span
            className={cn(
              // design-ok(radius): the mark's diamond on the wave, a graphic that keeps its own corner
              "absolute -top-1 left-1/2 size-2 -translate-x-1/2 rotate-45 rounded-[2px]",
              labelLook(m.colour).dot
            )}
          />
        </span>
      ))}
      {played !== null && (
        <span
          data-playhead
          className="pointer-events-none absolute inset-y-0 w-px bg-primary"
          style={{ left: `${played * 100}%` }}
        />
      )}
    </div>
  )
}
