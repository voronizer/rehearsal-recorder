import { useId, type ReactNode } from "react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/**
 * Pick one of a few: the row's name at its left and the shared switch
 * beside it, named by it (C8). Settings' choices are made with it, and so
 * are the metronome's Sound and Count-in, in Settings and behind the gear
 * on the rehearsal screen. Arrows move along the switch, and the choice is
 * made with a click, Space or Enter; the focus stays where it was, so a
 * choice that changes the screen round it, such as the scale, leaves the
 * keys where they were.
 *
 * `name` is an item's name where its words alone would not say it: "Scale
 * 150 percent" for "150%". An item `disabled` is shown but cannot be
 * chosen, as 16 bit at a rate the interface takes only at 24. `value` is
 * null until the setting is read, and then none is on.
 */
export function PickRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null
  options: { value: T; label: ReactNode; name?: string; disabled?: boolean }[]
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span id={id} className="min-w-20 text-sm">
        {label}
      </span>
      <ToggleGroup
        type="single"
        variant="switch"
        aria-labelledby={id}
        value={value === null ? "" : String(value)}
        // The one that is on, pressed again, sends "", which is no choice:
        // one is always on.
        onValueChange={(next) => {
          const picked = options.find((o) => String(o.value) === next)
          if (picked) onChange(picked.value)
        }}
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={String(o.value)}
            value={String(o.value)}
            aria-label={o.name}
            disabled={o.disabled}
          >
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
