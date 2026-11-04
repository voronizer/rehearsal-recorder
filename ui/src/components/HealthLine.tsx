import { BatteryLow, HardDrive } from "lucide-react"
import type { RecordingHealth } from "@/lib/api"
import { diskLine } from "@/lib/format"
import { cn } from "@/lib/utils"

/** At or under this charge, on battery, the line asks for the charger. 20%
 *  is where Windows turns its own battery saver on. */
export const LOW_BATTERY = 20

/** Python calls the space low under this many minutes (api.py
 *  LOW_SPACE_MINUTES), so a low line never says more than 14. */
const LOW_SPACE_MINUTES = 15

/** The free space while the interface sends: the start screen's sentence,
 *  after a green dot that says the interface is sending (DiskLine `live`). */
const connected = (minutes: number) => diskLine(minutes, false)
const lowSpace = (minutes: number) =>
  `${diskLine(minutes, true)}. Free some up or finish the rehearsal.`

/** The longest the line can say while a take records, held unseen under it
 *  from the start, so the room it takes never changes during the take (B4).
 *  Past 48 h the estimate is "many hours", so 48 h 59 min is the longest it
 *  writes. An error is not held: it ends the take, and its words are
 *  Python's, as long as they are. */
const LONGEST = [connected(48 * 60 + 59), lowSpace(LOW_SPACE_MINUTES - 1)]

const TONE = {
  quiet: "text-muted-foreground",
  warn: "text-foreground",
  error: "text-destructive",
} as const

/**
 * The disk line's look, one for the start screen and the recording screen:
 * the icon (or `live`'s dot), then the words, in the muted colour. A warning
 * is the icon in warn and the words in the text's colour, as Alert draws it;
 * an error is the whole line in the destructive colour. The icon stands by
 * the first line, should the words take two. `unseen` holds the room of
 * `text` without drawing it.
 */
export function DiskLine({
  icon = "disk",
  text,
  tone = "quiet",
  live = false,
  unseen,
  className,
}: {
  icon?: "disk" | "battery"
  /** The interface is sending: a green dot where the icon is, instead of
   *  the words "Interface connected". On the recording screen it stands
   *  under Recording's red dot, as big and as far from its words. */
  live?: boolean
  text: string
  tone?: keyof typeof TONE
  unseen?: boolean
  className?: string
}) {
  const Icon = icon === "battery" ? BatteryLow : HardDrive
  return (
    <div
      aria-hidden={unseen || undefined}
      className={cn("flex items-start gap-1 text-xs", TONE[tone], unseen && "invisible", className)}
    >
      {live ? (
        <span className="mt-px flex size-3.5 shrink-0 items-center">
          <span data-live role="img" aria-label="Interface connected" className="size-2.5 rounded-full bg-signal" />
        </span>
      ) : (
        <Icon className={cn("mt-px size-3.5 shrink-0", tone === "warn" && "text-warn")} />
      )}
      {unseen ? (
        // Drawn from an attribute, not written in the page: a copy that only
        // holds room is not a second line of text to find, read or select.
        <span data-text={text} className="before:content-[attr(data-text)]" />
      ) : (
        <span>{text}</span>
      )}
    </div>
  )
}

/**
 * The recording screen's status line, in the footer's left under
 * Recording: room left on the drive and whether the interface is still
 * sending, or what is wrong, or a battery about to end the take. The
 * website shows it too, in a tile.
 *
 * Always there, not only when something is wrong: you should be able to
 * see at a glance that the recording is healthy. The free space is said in
 * the start screen's words (diskLine), in the start screen's look
 * (DiskLine), and running low is a warning on both screens.
 *
 * It holds the room of the longest thing it can say during a take, flush
 * left in it, so it never moves what is beside it.
 */
export function HealthLine({
  health,
  hold = true,
}: {
  health: RecordingHealth | null
  /** Keeps the room of the longest sentence, unseen. A still picture of the
   *  line, which nothing moves beside, passes false: its box is as wide as
   *  its words. */
  hold?: boolean
}) {
  const battery = health?.battery_percent
  const lowBattery = battery != null && battery <= LOW_BATTERY
  const warn = !health?.error && (!!health?.low_space || lowBattery)
  const text = health?.error
    ? health.error
    : health === null
      ? "Checking free space…"
      : health.low_space
        ? lowSpace(health.minutes_left ?? 0)
        : lowBattery
          ? `Battery ${battery}%: plug the laptop in`
          : connected(health.minutes_left ?? 0)
  return (
    // Tabular figures: every digit as wide as the next, so the longest
    // sentence is the longest whatever the minutes are.
    <div data-health className="tnum grid justify-items-start text-xs">
      {hold &&
        LONGEST.map((t) => (
          <DiskLine key={t} text={t} unseen className="col-start-1 row-start-1" />
        ))}
      <DiskLine
        icon={lowBattery && !health?.error && !health?.low_space ? "battery" : "disk"}
        text={text}
        tone={health?.error ? "error" : warn ? "warn" : "quiet"}
        live={!!health && !health.error && !warn}
        className="col-start-1 row-start-1"
      />
    </div>
  )
}
