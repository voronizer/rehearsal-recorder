import { useRef, useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { InstrumentIcon } from "@/components/InstrumentIcon"
import { INSTRUMENTS, instrument } from "@/lib/instruments"
import { cn } from "@/lib/utils"

const COLUMNS = 5

/**
 * The icon at the start of a track's row on the setup screen, and the grid
 * it opens to choose another.
 *
 * Every icon in the grid carries its name under it: at 16 px a bass and a
 * guitar are close, and the words settle it. Choosing one closes the grid;
 * from the keys it opens on the one chosen, the arrows move through it by
 * row and column, Enter takes one and Escape takes none.
 */
export function IconPicker({
  label,
  name,
  value,
  onChange,
}: {
  /** What the button is called: "Track 1 icon". */
  label: string
  /** Whose icon it is, for the grid's own name: "Icon for Guitar". */
  name: string
  value?: string
  onChange: (icon: string) => void
}) {
  const [open, setOpen] = useState(false)
  const cells = useRef<(HTMLButtonElement | null)[]>([])
  const current = instrument(value)

  const move = (e: KeyboardEvent) => {
    const at = cells.current.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    const last = INSTRUMENTS.length - 1
    const to =
      e.key === "ArrowRight" ? at + 1
      : e.key === "ArrowLeft" ? at - 1
      : e.key === "ArrowDown" ? at + COLUMNS
      : e.key === "ArrowUp" ? at - COLUMNS
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null
    if (to === null) return
    e.preventDefault()
    cells.current[Math.max(0, Math.min(last, to))]?.focus()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-row"
          aria-label={label}
          title={current.label}
          data-icon={current.key}
          className="shrink-0"
        >
          <InstrumentIcon icon={current.key} className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={`Icon for ${name}`}
        // Onto the one chosen, not the first in the grid.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cells.current[INSTRUMENTS.indexOf(current)]?.focus()
        }}
      >
        <div
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${COLUMNS}, 5.25rem)` }}
          onKeyDown={move}
        >
          {INSTRUMENTS.map((it, i) => {
            const on = it.key === current.key
            return (
              <button
                key={it.key}
                ref={(el) => {
                  cells.current[i] = el
                }}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onChange(it.key)
                  setOpen(false)
                }}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded px-1 pt-2.5 pb-2 text-[11px] leading-tight text-muted-foreground transition-colors",
                  "hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
                  on && "bg-accent text-foreground ring-1 ring-primary ring-inset"
                )}
              >
                <InstrumentIcon icon={it.key} className="size-5 text-foreground" />
                {it.label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
