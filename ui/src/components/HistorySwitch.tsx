import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { HistoryView } from "@/lib/api"

const VIEWS: { view: HistoryView; label: string }[] = [
  { view: "rehearsals", label: "Rehearsals" },
  { view: "songs", label: "Songs" },
  { view: "marks", label: "Marks" },
]

/**
 * The top of History's list: evening by evening, song by song, or mark by
 * mark. They answer different questions — "what did we do on Tuesday",
 * "where is the good Viasna" and "where was that riff" — over the same takes.
 *
 * It lies across the list, so ← and → move along it and ↑ and ↓ are left to
 * the list under it, wherever the focus is. A view chosen with the mouse
 * leaves no focus on it, so ←, → and Space go back to a take playing.
 */
export function HistorySwitch({
  view,
  onChange,
}: {
  view: HistoryView
  onChange: (view: HistoryView) => void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="switch"
      orientation="horizontal"
      aria-label="History view"
      value={view}
      // The view that is on, pressed again, would leave none on.
      onValueChange={(next) => {
        if (next && next !== view) onChange(next as HistoryView)
      }}
      className="w-full"
    >
      {VIEWS.map((v) => (
        <ToggleGroupItem
          key={v.view}
          value={v.view}
          // A click lets go of the focus, as the open take's box does. Left on
          // the switch, the focus would send ← and → along it and Space to
          // another view, away from the take playing. A choice made from the
          // keys has no click count (detail 0), and keeps the focus.
          onClick={(e) => {
            if (e.detail > 0) e.currentTarget.blur()
          }}
        >
          {v.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
