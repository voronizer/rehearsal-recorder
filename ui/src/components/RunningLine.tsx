import { Progress } from "@/components/ui/progress"
import type { ActivityEntry } from "@/lib/api"

/**
 * An operation's own progress, shown where it was started — the take being
 * saved under Stop, the crop beside the player, the draft in its row. The
 * same entry the header's list shows (see lib/activity.ts).
 *
 * `active` says the screen knows the work has begun though the journal has
 * not been asked yet: the words stand alone until the figure arrives.
 */
export function RunningLine({
  entry,
  label,
  active = false,
}: {
  entry: ActivityEntry | null
  label: string
  active?: boolean
}) {
  if (!entry && !active) return null
  const pct = entry ? Math.round(entry.fraction * 100) : null
  return (
    <div role="status" className="flex w-full items-center gap-3 text-xs text-muted-foreground">
      <span className="shrink-0 tnum">
        {label}…{pct !== null ? ` ${pct}%` : ""}
      </span>
      {pct !== null && <Progress value={pct} className="h-1" />}
    </div>
  )
}
