import { cn } from "@/lib/utils"
import type { Label } from "@/lib/api"
import { labelLook } from "@/lib/labels"
import { labelLine } from "@/lib/marks"

/**
 * History's Marks view, down the left: every label, in the order the band
 * gave them in Settings › Marks, with how many marks have it and since
 * when. A label nothing has yet is listed too, dimmed, so the list is the
 * same whatever was marked.
 */
export function LabelList({
  labels,
  current,
  onChoose,
}: {
  labels: Label[]
  current: number | null
  onChoose: (id: number) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {labels.map((label) => {
        const empty = !label.marks
        return (
          <button
            key={label.id}
            type="button"
            data-label={label.id}
            data-empty={empty || undefined}
            aria-current={label.id === current ? "true" : undefined}
            onClick={() => onChoose(label.id)}
            className={cn(
              "flex flex-col gap-1 rounded-lg border border-transparent px-3 pt-2.5 pb-3 text-left transition-colors",
              "hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              label.id === current && "border-border bg-accent hover:bg-accent"
            )}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  labelLook(label.colour).dot,
                  empty && "opacity-45"
                )}
              />
              <span
                data-name
                className={cn(
                  "min-w-0 flex-1 truncate",
                  empty ? "text-base font-medium text-muted-foreground" : "text-base font-semibold"
                )}
              >
                {label.name}
              </span>
              {!empty && (
                <span data-count className="tnum shrink-0 text-xs text-muted-foreground">
                  {label.marks}
                </span>
              )}
            </span>
            <span className="truncate pl-4 text-xs text-muted-foreground">{labelLine(label)}</span>
          </button>
        )
      })}
    </div>
  )
}
