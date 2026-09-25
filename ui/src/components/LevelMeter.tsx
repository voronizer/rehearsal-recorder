import { cn } from "@/lib/utils"
import { peakToDb } from "@/lib/format"

const CLIP_THRESHOLD = 0.97
const QUIET_THRESHOLD = 0.02

/**
 * One track's level bar while recording.
 *
 * Three states, because during a rehearsal what matters at a glance is not
 * "how many dB" but "is this mic fine": clipping (red), silence (dimmed) and
 * normal (green).
 *
 * A stereo track gets one bar of the same height, split along its length —
 * left above, right below. A bar each would make a stereo track twice as tall
 * as a mono one and push the list off the screen; one bar taken from the
 * louder side would hide an overhead that stopped arriving, which is the
 * thing this meter exists to catch.
 */
export function LevelMeter({
  name,
  channel,
  stereo,
  peaks,
}: {
  name: string
  channel: number | null
  stereo?: boolean
  /** One figure per channel, 0..1. */
  peaks: number[]
}) {
  const sides = peaks.length ? peaks : [0]
  const peak = Math.max(...sides)
  const clipping = peak > CLIP_THRESHOLD
  const quiet = peak < QUIET_THRESHOLD

  return (
    <div
      data-clipping={clipping || undefined}
      className="flex items-center gap-4 rounded-xl border bg-card px-5 py-4 data-[clipping]:border-destructive/60"
    >
      <div className="w-44 shrink-0">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="tnum text-xs text-muted-foreground">
          {channel === null
            ? "No input"
            : stereo
              ? `Inputs ${channel}–${channel + 1}`
              : `Input ${channel}`}
        </div>
      </div>

      <div className="relative h-6 flex-1 overflow-hidden rounded-md border bg-background">
        {sides.map((side, i) => (
          <div
            key={i}
            className={cn(
              "absolute left-0 transition-[width] duration-75",
              side > CLIP_THRESHOLD ? "bg-destructive" : "bg-signal"
            )}
            style={{
              width: `${Math.min(100, Math.max(0, side * 100))}%`,
              top: sides.length > 1 && i === 1 ? "50%" : 0,
              bottom: sides.length > 1 && i === 0 ? "50%" : 0,
            }}
          />
        ))}
        {/* where the clipping zone starts */}
        <div className="absolute inset-y-0 right-[3%] w-px bg-warn/40" />
      </div>

      <div className="w-24 shrink-0 text-right">
        <div
          className={cn(
            "tnum text-sm",
            clipping ? "text-destructive" : quiet ? "text-muted-foreground" : ""
          )}
        >
          {peakToDb(peak)} dB
        </div>
        {clipping && (
          <div className="text-[11px] font-medium text-destructive">clipping</div>
        )}
        {!clipping && quiet && (
          <div className="text-[11px] text-muted-foreground">silent</div>
        )}
      </div>
    </div>
  )
}
