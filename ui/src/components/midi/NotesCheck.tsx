import { cn } from "@/lib/utils"

/**
 * The signal check's meter for a port, at the end of its line on a setup
 * card: a bar that jumps with each note's velocity and falls back, and
 * "✓ notes" once a note has arrived. In the accent, not the level's green:
 * notes are not a sound and have no level to set. As wide as the input's
 * meter above it, the bars one under the other.
 */
export function NotesCheck({
  seen,
  vel,
  className,
}: {
  /** A note has arrived from this port since the check began. */
  seen: boolean
  /** Where the bar stands, 0..1. */
  vel: number
  className?: string
}) {
  return (
    <div className={cn("flex w-40 shrink-0 items-center gap-2", className)}>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full border bg-background">
        <div
          className="absolute inset-y-0 left-0 bg-primary transition-[width] duration-75"
          style={{ width: `${Math.round(Math.min(1, Math.max(0, vel)) * 100)}%` }}
        />
      </div>
      {seen ? (
        <span
          className="w-12 text-[11px] whitespace-nowrap text-primary"
          title="Notes have arrived from this port"
        >
          ✓ notes
        </span>
      ) : (
        <span className="w-12 text-[11px] whitespace-nowrap text-muted-foreground">no notes</span>
      )}
    </div>
  )
}
