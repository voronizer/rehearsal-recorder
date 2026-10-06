import { cn } from "@/lib/utils"
import type { HistoryView } from "@/lib/api"

const VIEWS: { view: HistoryView; label: string }[] = [
  { view: "rehearsals", label: "Rehearsals" },
  { view: "songs", label: "Songs" },
]

/**
 * The top of History's list: evening by evening, or song by song. The two
 * answer different questions — "what did we do on Tuesday" and "where is the
 * good Viasna" — over the same takes.
 */
export function HistorySwitch({
  view,
  onChange,
}: {
  view: HistoryView
  onChange: (view: HistoryView) => void
}) {
  return (
    <div role="group" aria-label="History view" className="flex gap-1 rounded-lg bg-muted p-1">
      {VIEWS.map((v) => (
        <button
          key={v.view}
          type="button"
          aria-pressed={view === v.view}
          onClick={() => view !== v.view && onChange(v.view)}
          className={cn(
            "flex-1 rounded-md px-3 py-1 text-sm transition-colors",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            view === v.view
              ? "bg-background font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
