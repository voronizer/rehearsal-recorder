import { ChevronDown, Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/** A rehearsal row in history. */
export function RehearsalRow({
  name,
  subtitle,
  songsText,
  takesText,
  missing,
  onClick,
  onRename,
  onDelete,
  onLocate,
  onForget,
}: {
  name: string
  /** When it was, how long it ran, what it weighs. */
  subtitle: string
  /** What was played, if the takes were named. Empty means no line at all. */
  songsText?: string
  takesText: string
  /** The folder is not on disk. Swaps rename/delete for Locate/Remove and
   *  the row stops opening. */
  missing?: boolean
  onClick: () => void
  onRename?: () => void
  onDelete?: () => void
  onLocate?: () => void
  onForget?: () => void
}) {
  if (missing) {
    return (
      <div className="flex items-center rounded-xl border bg-card">
        <div aria-disabled="true" className="flex flex-1 items-center gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="tnum text-xs text-muted-foreground">
                {subtitle}
              </span>
              <Badge
                variant="outline"
                className="border-destructive/40 text-muted-foreground"
              >
                Not found on disk
              </Badge>
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onLocate}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          Locate folder…
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onForget}
          className="mr-3 shrink-0 text-muted-foreground hover:text-destructive"
        >
          Remove from history
        </Button>
      </div>
    )
  }

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
