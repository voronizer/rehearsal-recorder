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
 */
export function LevelMeter({
  name,
  channel,
  peak,
}: {
  name: string
  channel: number
  peak: number
}) {
  const clipping = peak > CLIP_THRESHOLD
  const quiet = peak < QUIET_THRESHOLD
  const pct = Math.min(100, Math.max(0, peak * 100))

  return (
    <div
      data-clipping={clipping || undefined}
      className="flex items-center gap-4 rounded-xl border bg-card px-5 py-4 data-[clipping]:border-destructive/60"
    >
      <div className="w-44 shrink-0">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="tnum text-xs text-muted-foreground">Input {channel}</div>
      </div>

      <div className="relative h-6 flex-1 overflow-hidden rounded-md border bg-background">
        <div
          className={cn(
            "absolute inset-y-0 left-0 transition-[width] duration-75",
            clipping ? "bg-destructive" : "bg-signal"
          )}
          style={{ width: `${pct}%` }}
        />
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
