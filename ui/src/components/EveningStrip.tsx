import { cn } from "@/lib/utils"
import type { Run } from "@/lib/api"

/**
 * An evening drawn small: a bar per take, as long as the take, in the order
 * played, with a gap where the band moved on to another song. A starred take
 * is green.
 *
 * Marks are few in practice, so it has to say something without them, and
 * it does: how many songs, how many goes at each, which ran long. Hidden from
 * screen readers — the words beside it say the same.
 */
export function EveningStrip({ runs, className }: { runs: Run[]; className?: string }) {
  if (runs.length === 0) return null
  return (
    <div aria-hidden data-strip className={cn("flex h-1.5 gap-1.5", className)}>
      {runs.map((run, i) => (
        <div
          key={i}
          className="flex min-w-0 gap-0.5"
          style={{ flex: `${lengthOf(run)} 1 0` }}
        >
          {run.takes.map((take, j) => (
            <span
              key={j}
              data-starred={take.starred || undefined}
              className={cn(
                "h-full min-w-0.5 rounded-[2px]",
                take.starred ? "bg-signal/80" : "bg-muted-foreground/40"
              )}
              style={{ flex: `${Math.max(1, take.duration_sec)} 1 0` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function lengthOf(run: Run): number {
  return Math.max(1, run.takes.reduce((sum, t) => sum + (t.duration_sec || 0), 0))
}
