import { ChevronDown, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

/** A rehearsal row in history. */
export function RehearsalRow({
  name,
  subtitle,
  songsText,
  takesText,
  onClick,
  onRename,
  onDelete,
}: {
  name: string
  /** When it was, how long it ran, what it weighs. */
  subtitle: string
  /** What was played, if the takes were named. Empty means no line at all. */
  songsText?: string
  takesText: string
  onClick: () => void
  onRename?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="flex items-center rounded-xl border bg-card">
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center gap-4 rounded-l-xl px-5 py-4 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="tnum mt-0.5 text-xs text-muted-foreground">
            {subtitle}
          </div>
          {songsText && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {songsText}
            </div>
          )}
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">{takesText}</span>
        <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground" />
      </button>
      {onRename && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Rename rehearsal ${name}`}
          onClick={onRename}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Pencil />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete rehearsal ${name}`}
          onClick={onDelete}
          className="mr-3 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
}
