import { BatteryLow, HardDrive } from "lucide-react"
import type { RecordingHealth } from "@/lib/api"
import { aboutDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

/** At or under this charge, on battery, the line asks for the charger. 20%
 *  is where Windows turns its own battery saver on. */
export const LOW_BATTERY = 20

/**
 * The recording screen's status line: room left on the drive and whether
 * the interface is still sending, or what is wrong, or a battery about to
 * end the take. The website shows it too, in a tile.
 *
 * Always there, not only when something is wrong: you should be able to
 * see at a glance that the recording is healthy.
 */
export function HealthLine({ health }: { health: RecordingHealth | null }) {
  const battery = health?.battery_percent
  const lowBattery = battery != null && battery <= LOW_BATTERY
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs",
        health?.error
          ? "text-destructive"
          : health?.low_space || lowBattery
            ? "text-warn"
            : "text-muted-foreground"
      )}
    >
      {lowBattery && !health?.error && !health?.low_space ? (
        <BatteryLow className="size-3.5 shrink-0" />
      ) : (
        <HardDrive className="size-3.5 shrink-0" />
      )}
      {health?.error ? (
        <span>{health.error}</span>
      ) : health === null ? (
        <span>Checking free space…</span>
      ) : health.low_space ? (
        <span>
          Running out of space: {aboutDuration(health.minutes_left ?? 0)}{" "}
          left. Free some up or finish the rehearsal.
        </span>
      ) : lowBattery ? (
        <span>Battery {battery}%: plug the laptop in</span>
      ) : (
        <span>
          Interface connected · room for{" "}
          {aboutDuration(health.minutes_left ?? 0)} more
        </span>
      )}
    </div>
  )
}
