import { useRef, useState, type KeyboardEvent } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { InstrumentIcon } from "@/components/InstrumentIcon"
import { INSTRUMENTS, instrument } from "@/lib/instruments"

const COLUMNS = 5

/**
 * The icon at the start of a track's row on the setup screen, and the grid
 * it opens to choose another.
 *
 * Every icon in the grid carries its name under it: at 16 px a bass and a
 * guitar are close, and the words settle it. The chosen one has the grey
 * fill of a thing that is on (F2): the grid is the shared ToggleGroup, one
 * chosen. Choosing one closes the grid; from the keys it opens on the one
 * chosen, the arrows move through it by row and column (its own, not
 * ToggleGroup's, which go along one line), Enter takes one and Escape takes
 * none. The button at the row's start names its icon in the shared tip.
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
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon-row"
              aria-label={label}
              data-icon={current.key}
              className="shrink-0"
            >
              <InstrumentIcon icon={current.key} className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{current.label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        aria-label={`Icon for ${name}`}
        // Onto the one chosen, not the first in the grid.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cells.current[INSTRUMENTS.indexOf(current)]?.focus()
        }}
      >
        <ToggleGroup
          type="single"
          rovingFocus={false}
          value={current.key}
          // The one chosen pressed again is "": nothing changes, the grid shuts.
          onValueChange={(key) => {
            if (key) onChange(key)
            setOpen(false)
          }}
          className="grid items-stretch gap-0.5"
          style={{ gridTemplateColumns: `repeat(${COLUMNS}, 5.25rem)` }}
          onKeyDown={move}
        >
          {INSTRUMENTS.map((it, i) => (
            <ToggleGroupItem
              key={it.key}
              value={it.key}
              ref={(el) => {
                cells.current[i] = el
              }}
              // A cell of the grid: the icon over its name, which may take
              // two lines.
              className="h-auto flex-col gap-1 rounded-md px-1 py-2 text-xs leading-tight whitespace-normal text-muted-foreground has-[>svg]:px-1 dark:not-data-[state=on]:hover:bg-accent/50"
            >
              <InstrumentIcon icon={it.key} className="size-5 text-foreground" />
              {it.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  )
}
