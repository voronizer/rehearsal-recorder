import { HardDrive } from "lucide-react"
import type { RecordingHealth } from "@/lib/api"
import { aboutDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * The recording screen's status line: room left on the drive and whether
 * the interface is still sending, or what is wrong. The website shows it
 * too, in a tile.
 *
 * Always there, not only when something is wrong: you should be able to
 * see at a glance that the recording is healthy.
 */
export function HealthLine({ health }: { health: RecordingHealth | null }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs",
        health?.error
          ? "text-destructive"
          : health?.low_space
            ? "text-warn"
            : "text-muted-foreground"
      )}
    >
      <HardDrive className="size-3.5 shrink-0" />
      {health?.error ? (
        <span>{health.error}</span>
      ) : health === null ? (
        <span>Checking free space…</span>
      ) : health.low_space ? (
        <span>
          Running out of space: {aboutDuration(health.minutes_left ?? 0)}{" "}
          left. Free some up or finish the rehearsal.
        </span>
      ) : (
        <span>
          Interface connected · room for{" "}
          {aboutDuration(health.minutes_left ?? 0)} more
        </span>
      )}
    </div>
  )
}
