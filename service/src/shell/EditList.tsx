import { useState, type ReactNode } from "react"
import { Check, GripVertical, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { usePanel } from "./panel"

/** A panel's heading with ✕. */
export function PanelHead({ title }: { title: string }) {
  const { close } = usePanel()
  return (
    <div className="flex items-center gap-2">
      <h2 className="flex-1 text-lg font-semibold">{title}</h2>
      <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
        <X />
      </Button>
    </div>
  )
}

/** A colour the row offers: its name and how it is drawn. */
export type Swatch = { value: string; name: string; className: string }

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
  const [palette, setPalette] = useState(false)
  const [ask, setAsk] = useState(false)
  const [text, setText] = useState(name)
  const save = () => {
    const v = text.trim()
    if (v && v !== name) onName(v)
    else setText(name)
  }
  return (
    <div className="flex flex-col gap-2 py-1.5">
      <div className="flex items-center gap-1.5">
        {/* As in РЭХА's Settings › Marks: drag by the grip, or Space on it and the arrows. */}
        <button
          ref={handleRef}
          type="button"
          aria-label={`Move ${name}`}
          className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <GripVertical className="size-4" />
        </button>
        {swatch && (
          <Button variant="ghost" size="icon-row" aria-label={`Colour of “${name}”`} aria-expanded={palette} onClick={() => setPalette(!palette)}>
            {swatch}
          </Button>
        )}
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
          className="h-8 flex-1 border-transparent bg-transparent shadow-none hover:border-input"
        />
        <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
        {canDelete && (
          <Button variant="ghost" size="icon-row" aria-label={`Delete “${name}”`} onClick={() => (used ? setAsk(!ask) : onDelete())}>
            <Trash2 className="text-muted-foreground" />
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="pl-6 text-destructive">
          {error}
        </p>
      )}
      {palette && swatches && onColour && (
        <div className="flex flex-wrap gap-1.5 pl-6">
          {swatches.map((s) => (
            <button
              key={s.value}
              type="button"
              title={s.name}
              aria-label={s.name}
              onClick={() => (onColour(s.value), setPalette(false))}
              className={cn("flex size-7 items-center justify-center rounded-full", s.className)}
            >
              {s.className.includes("ring-2") && <Check className="size-3.5 text-white" />}
            </button>
          ))}
        </div>
      )}
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
