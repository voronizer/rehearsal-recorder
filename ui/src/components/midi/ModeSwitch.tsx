import type { RecordMode } from "@/lib/api"
import { cn } from "@/lib/utils"

const MODES: { mode: RecordMode; label: string }[] = [
  { mode: "audio", label: "Audio" },
  { mode: "both", label: "Both" },
  { mode: "midi", label: "MIDI" },
]

/**
 * What a track records, at the end of its card's top line: its sound, its
 * notes, or both. History's switch in look, and one width whatever is
 * chosen, so the name beside it never moves.
 */
export function ModeSwitch({
  label,
  value,
  onChange,
}: {
  /** What the group is called: "Track 1 records". */
  label: string
  value: RecordMode
  onChange: (mode: RecordMode) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid h-8 w-40 shrink-0 grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          aria-pressed={value === m.mode}
          onClick={() => value !== m.mode && onChange(m.mode)}
          className={cn(
            "rounded-md px-1 text-sm whitespace-nowrap transition-colors",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            value === m.mode
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
