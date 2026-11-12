import { useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { Check, GripVertical, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { ErrorLine } from "./parts"

/** An editor's heading with ✕. */
export function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="flex-1 text-base font-semibold">{title}</h2>
      <Button variant="ghost" size="icon-row" aria-label="Close" onClick={onClose}>
        <X />
      </Button>
    </div>
  )
}

/** A colour the row offers: its name, how it is drawn, and whether the row has it. */
export type Swatch = { value: string; name: string; className: string; chosen: boolean }

/** The colours' grid: four to a row. */
const COLUMNS = 4

/**
 * The colours, in a grid that opens by the swatch (S15), as the icons do in
 * РЭХА (IconPicker): the shared ToggleGroup, the row's colour pressed and
 * ticked. It opens on that one; the arrows move through it by row and
 * column, Enter takes one and Esc none.
 */
function ColourPicker({ name, swatch, swatches, onColour }: { name: string; swatch: ReactNode; swatches: Swatch[]; onColour: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const cells = useRef<(HTMLButtonElement | null)[]>([])
  const chosen = swatches.find((s) => s.chosen)?.value ?? ""
  const move = (e: KeyboardEvent) => {
    const at = cells.current.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    const last = swatches.length - 1
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
        {/* Framed, so it reads as a button that opens the colours, not as a sign. */}
        <Button variant="outline" size="icon-row" aria-label={`Colour of “${name}”`}>
          {swatch}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label={`Colour of “${name}”`}
        className="w-auto p-2"
        // Onto the row's colour, not the first in the grid.
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cells.current[swatches.findIndex((s) => s.chosen)]?.focus()
        }}
      >
        <ToggleGroup
          type="single"
          rovingFocus={false}
          value={chosen}
          // The row's colour pressed again is "": nothing changes, the grid shuts.
          onValueChange={(value) => {
            if (value) onColour(value)
            setOpen(false)
          }}
          aria-label={`Colour of “${name}”`}
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${COLUMNS}, 2rem)` }}
          onKeyDown={move}
        >
          {swatches.map((s, i) => (
            <Tooltip key={s.value}>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value={s.value}
                  aria-label={s.name}
                  // Its own on or off, where the tip's trigger would put its own state.
                  data-state={s.chosen ? "on" : "off"}
                  ref={(el) => {
                    cells.current[i] = el
                  }}
                  className="size-8 rounded-md p-0 dark:not-data-[state=on]:hover:bg-accent/50"
                >
                  <span className={cn("flex size-5 items-center justify-center rounded-full", s.className)}>
                    {s.chosen && <Check className="size-3 text-mark-foreground" />}
                  </span>
                </ToggleGroupItem>
              </TooltipTrigger>
              {/* Esc with a tip showing shuts the colours too, at one press. */}
              <TooltipContent onEscapeKeyDown={() => setOpen(false)}>{s.name}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  )
}

/**
 * One row of the band's labels or statuses: up and down, the name (saved
 * on Enter or on leaving the box), how many things have it, delete. A row
 * that has some asks first which other row they go to.
 */
export function EditRow({
  name,
  count,
  used,
  swatch,
  swatches,
  onColour,
  onName,
  handleRef,
  canDelete,
  onDelete,
  others,
  error,
  focus,
}: {
  name: string
  count: string
  used: boolean
  swatch?: ReactNode
  swatches?: Swatch[]
  onColour?: (value: string) => void
  onName: (v: string) => void
  /** Where the row is dragged by, from SortableList. */
  handleRef: (el: Element | null) => void
  canDelete: boolean
  onDelete: (to?: number) => void
  others: { id: number; name: string; swatch?: ReactNode }[]
  error?: string
  focus?: boolean
}) {
  const [ask, setAsk] = useState(false)
  const [text, setText] = useState(name)
  const save = () => {
    const v = text.trim()
    if (v && v !== name) onName(v)
    else setText(name)
  }
  return (
    <div className="flex flex-col gap-2 py-1.5">
      {/* The name's line for what went wrong under the row (S11), there when empty. */}
      <Field className="gap-1">
        <div className="flex items-center gap-1.5">
          {/* As in РЭХА's Settings › Marks: drag by the grip, or Space on it and the arrows. */}
          <Button
            ref={handleRef}
            variant="ghost"
            size="icon-tiny"
            aria-label={`Move ${name}`}
            className="h-8 w-5 cursor-grab touch-none text-muted-foreground hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
          >
            <GripVertical className="size-4" />
          </Button>
          {swatch && swatches && onColour && <ColourPicker name={name} swatch={swatch} swatches={swatches} onColour={onColour} />}
          <Input
            autoFocus={focus}
            value={text}
            maxLength={40}
            aria-label="Name"
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur()
              if (e.key === "Escape") setText(name)
            }}
            className="h-8 flex-1"
          />
          <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
          {canDelete && (
            <Button variant="ghost" size="icon-row" aria-label={`Delete “${name}”`} onClick={() => (used ? setAsk(!ask) : onDelete())}>
              <Trash2 className="text-muted-foreground" />
            </Button>
          )}
        </div>
        <ErrorLine error={error} className="pl-6" />
      </Field>
      {ask && (
        <div className="flex flex-col gap-2 pl-6">
          <span className="text-xs text-muted-foreground">Its {count} move to:</span>
          <div className="flex flex-wrap gap-1.5">
            {others.map((o) => (
              <Button key={o.id} variant="outline" size="row" onClick={() => onDelete(o.id)}>
                {o.swatch}
                {o.name}
              </Button>
            ))}
            <Button variant="ghost" size="row" onClick={() => setAsk(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The list with `id` put at place `to`, as SortableList drops it. */
export const placed = <T extends { id: number }>(items: T[], id: number, to: number): T[] => {
  const next = items.filter((x) => x.id !== id)
  next.splice(to, 0, items.find((x) => x.id === id)!)
  return next
}
