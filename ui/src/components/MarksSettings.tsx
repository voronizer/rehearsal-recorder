import { useEffect, useState } from "react"
import { GripVertical, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { SortableList } from "@/components/SortableList"
import { cn } from "@/lib/utils"
import { dismiss, notify } from "@/lib/notices"
import {
  LABEL_COLOURS,
  colourName,
  firstFreeColour,
  labelLook,
  labelsChanged,
  loadLabels,
  useLabels,
} from "@/lib/labels"
import { api, type Label, type LabelColour, type LabelsAnswer } from "@/lib/api"

// What a change here said — one slot, so each says over the last.
const SAID = "labels"

const marksText = (n: number) => (n === 0 ? "no marks" : n === 1 ? "1 mark" : `${n} marks`)

/**
 * Settings › Marks: the labels a mark can have, in the order the marker
 * dialog offers them. Each is a name and a colour and nothing more. The band
 * makes them, renames and recolours them (every mark with the label follows
 * at once), drags them into order, and deletes them. One in use asks first
 * which label its marks get, and the last one stays, since a mark always has
 * a label.
 */
export function MarksSettings() {
  const labels = useLabels()
  const [draft, setDraft] = useState<{ name: string; colour: LabelColour } | null>(null)
  const [deleting, setDeleting] = useState<Label | null>(null)

  // The counts move whenever a mark is made, anywhere: ask afresh on opening.
  useEffect(() => {
    void loadLabels()
  }, [])

  /** Applies what a change answered; says why when it was refused.
   *  Returns whether it went through. */
  const answered = (res: LabelsAnswer) => {
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not change the labels" })
      return false
    }
    dismiss(SAID)
    if (res.labels) labelsChanged(res.labels)
    return true
  }

  const move = async (id: number, to: number) => {
    // In place at once, so the row stays where it was dropped.
    const next = labels.filter((l) => l.id !== id)
    next.splice(to, 0, labels.find((l) => l.id === id)!)
    labelsChanged(next)
    if (!answered(await api().move_label(id, to))) void loadLabels()
  }

  const remove = async (label: Label) => {
    if (label.marks > 0) {
      setDeleting(label)
      return
    }
    answered(await api().delete_label(label.id, null))
  }

  return (
    <section className="flex flex-col gap-3">
      <SortableList items={labels} label="Labels" onMove={(id, to) => void move(id, to)}>
        {(label, handleRef) => (
          <LabelRow
            label={label}
            handleRef={handleRef}
            canDelete={labels.length > 1}
            onRename={async (name) => answered(await api().rename_label(label.id, name))}
            onRecolour={async (colour) => {
              answered(await api().recolour_label(label.id, colour))
            }}
            onDelete={() => void remove(label)}
          />
        )}
      </SortableList>

      {draft ? (
        <div className="flex items-center gap-3 px-2 py-1">
          <span className="w-6" />
          <span className={cn("size-3 shrink-0 rounded-full", labelLook(draft.colour).dot)} />
          <Input
            autoFocus
            aria-label="New label name"
            value={draft.name}
            maxLength={40}
            placeholder="Solo, Tempo, Lyrics…"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onKeyDown={async (e) => {
              if (e.key === "Escape") {
                e.preventDefault()
                setDraft(null)
              }
              if (e.key === "Enter") {
                e.preventDefault()
                if (!draft.name.trim()) {
                  setDraft(null)
                  return
                }
                if (answered(await api().add_label(draft.name, draft.colour))) setDraft(null)
              }
            }}
            className="h-8 max-w-64"
          />
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setDraft({ name: "", colour: firstFreeColour(labels) })}
        >
          <Plus />
          New label
        </Button>
      )}

      {deleting && (
        <DeleteInUse
          label={deleting}
          others={labels.filter((l) => l.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDelete={async (marksTo) => {
            answered(await api().delete_label(deleting.id, marksTo))
          }}
        />
      )}
    </section>
  )
}

function LabelRow({
  label,
  handleRef,
  canDelete,
  onRename,
  onRecolour,
  onDelete,
}: {
  label: Label
  handleRef: (el: Element | null) => void
  canDelete: boolean
  onRename: (name: string) => Promise<boolean>
  onRecolour: (colour: LabelColour) => Promise<void>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [palette, setPalette] = useState(false)

  return (
    <div
      data-label={label.name}
      className="group flex items-center gap-3 rounded-lg px-2 py-1 transition-colors hover:bg-accent/40"
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={`Move ${label.name}`}
        className="flex w-6 shrink-0 cursor-grab touch-none justify-center text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="size-4" />
      </button>

      <Popover open={palette} onOpenChange={setPalette}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Colour of ${label.name}`}
            data-colour={label.colour}
            className={cn("size-3 shrink-0 rounded-full", labelLook(label.colour).dot)}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2">
          <div className="grid grid-cols-4 gap-2">
            {LABEL_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={colourName(c)}
                aria-pressed={c === label.colour}
                onClick={async () => {
                  setPalette(false)
                  await onRecolour(c)
                }}
                className={cn(
                  "size-6 rounded-full ring-offset-2 ring-offset-popover",
                  labelLook(c).swatch,
                  c === label.colour && "ring-2 ring-foreground"
                )}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {editing !== null ? (
        <Input
          autoFocus
          aria-label="Label name"
          value={editing}
          maxLength={40}
          onChange={(e) => setEditing(e.target.value)}
          // Leaving the field is Escape: only Enter renames.
          onBlur={() => setEditing(null)}
          onKeyDown={async (e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              setEditing(null)
            }
            if (e.key === "Enter") {
              e.preventDefault()
              if (editing.trim() === label.name || (await onRename(editing))) setEditing(null)
            }
          }}
          className="h-8 max-w-64"
        />
      ) : (
        <button
          type="button"
          aria-label={`Rename ${label.name}`}
          onClick={() => setEditing(label.name)}
          className="min-w-0 truncate text-left text-sm hover:underline"
        >
          {label.name}
        </button>
      )}

      <span className="tnum ml-auto shrink-0 text-xs text-muted-foreground">
        {marksText(label.marks)}
      </span>

      {canDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${label.name}`}
          onClick={onDelete}
          className="text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-destructive"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
}

/** "Delete Do again? Its 12 marks get: [Went wrong ▾]" — the first of the
 *  other labels chosen. */
function DeleteInUse({
  label,
  others,
  onClose,
  onDelete,
}: {
  label: Label
  others: Label[]
  onClose: () => void
  onDelete: (marksTo: number) => Promise<void>
}) {
  const [to, setTo] = useState(others[0]?.id ?? 0)
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete ${label.name}?`}
      description={
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Its {marksText(label.marks)} {label.marks === 1 ? "gets" : "get"}:
          </span>
          <Select value={String(to)} onValueChange={(v) => setTo(Number(v))}>
            <SelectTrigger aria-label="Label for its marks" className="h-8 w-auto">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {others.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      onConfirm={() => void onDelete(to)}
    />
  )
}
