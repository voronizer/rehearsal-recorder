import { useEffect, useState } from "react"
import { GripVertical, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LabelDot } from "@/components/ui/mark"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { WholeTip, useCut } from "@/components/ui/whole"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { SettingsGroup } from "@/components/SettingsGroup"
import { SortableList } from "@/components/SortableList"
import { useNoticesGoWithPage } from "@/hooks/useErrorNotice"
import { marksLabel } from "@/lib/format"
import { dismiss, notify } from "@/lib/notices"
import {
  LABEL_COLOURS,
  colourName,
  firstFreeColour,
  labelsChanged,
  loadLabels,
  useLabels,
} from "@/lib/labels"
import { api, type Label, type LabelColour, type LabelsAnswer } from "@/lib/api"

// What a change here said: one slot, so each says over the last.
const SAID = "labels"

/**
 * Settings › Marks: the labels a mark can have, in the order the marker
 * dialog offers them, in one group. Each is a name and a colour and nothing
 * more. The band makes them, renames and recolours them (every mark with the
 * label follows at once), drags them into order, and deletes them. One in
 * use asks first which label its marks get, and the last one stays, since a
 * mark always has a label.
 */
export function MarksSettings() {
  useNoticesGoWithPage(SAID)
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
    <SettingsGroup rise={1} className="gap-3">
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
        // Where a row has its grip and its dot, so the name is where the
        // row's will be.
        <div className="flex items-center gap-3 py-1">
          <span className="size-6 shrink-0" />
          <span className="flex size-6 shrink-0 items-center justify-center">
            <LabelDot colour={draft.colour} />
          </span>
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
          size="row"
          // Its + under the rows' grips.
          className="-ml-1.5 self-start"
          onClick={() => setDraft({ name: "", colour: firstFreeColour(labels) })}
        >
          <Plus />
          New label
        </Button>
      )}

      <DeleteInUse
        label={deleting}
        others={labels.filter((l) => l.id !== deleting?.id)}
        onClose={() => setDeleting(null)}
        onDelete={async (label, marksTo) => {
          answered(await api().delete_label(label.id, marksTo))
        }}
      />
    </SettingsGroup>
  )
}

/**
 * A label's row: its grip, its dot, which opens the eight colours, and its
 * name, which turns into a field to rename it; how many marks have it, and
 * Delete, which shows on hover or focus. The name is cut at the end of its
 * room, and whole in the shared tip on hover and on keyboard focus (B6).
 */
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
  const [nameRef, cut] = useCut<HTMLSpanElement>()

  return (
    <div data-label={label.name} className="group flex items-center gap-3 py-1">
      <Button
        ref={handleRef}
        variant="ghost"
        size="icon-tiny"
        aria-label={`Move ${label.name}`}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="size-4" />
      </Button>

      {/* The dot is small, its button as big as Delete: a near miss would
          start a drag or open the name. */}
      <Popover open={palette} onOpenChange={setPalette}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-row"
            aria-label={`Colour of ${label.name}`}
            data-colour={label.colour}
          >
            <LabelDot colour={label.colour} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3">
          {/* Pick one of eight, the label's own chosen, and the focus on it
              as it opens. Any press closes it; the chosen one pressed again
              sends "", which changes nothing. */}
          <ToggleGroup
            type="single"
            aria-label={`Colour of ${label.name}`}
            value={label.colour}
            onValueChange={(colour) => {
              setPalette(false)
              if (colour) void onRecolour(colour as LabelColour)
            }}
            className="grid grid-cols-4 gap-3"
          >
            {LABEL_COLOURS.map((c) => (
              <ToggleGroupItem
                key={c}
                value={c}
                aria-label={colourName(c)}
                // A round swatch in its colour; the chosen one ringed in the
                // text's colour, clear of it.
                className="size-5 rounded-full border-0 p-0 first:rounded-full last:rounded-full data-[state=on]:ring-2 data-[state=on]:ring-foreground data-[state=on]:ring-offset-2 data-[state=on]:ring-offset-popover"
              >
                <LabelDot colour={c} className="size-full" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
        <WholeTip cut={cut} text={label.name}>
          <Button
            variant="ghost"
            size="row"
            aria-label={`Rename ${label.name}`}
            onClick={() => setEditing(label.name)}
            className="min-w-0 shrink justify-start"
          >
            <span ref={nameRef} className="block min-w-0 truncate">
              {label.name}
            </span>
          </Button>
        </WholeTip>
      )}

      <span className="tnum ml-auto shrink-0 text-xs text-muted-foreground">
        {marksLabel(label.marks)}
      </span>

      {canDelete && (
        <Button
          variant="ghost"
          size="icon-row"
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

/** "Delete “Do again”? Its 12 marks get: [Went wrong ▾]" — the first of the
 *  other labels chosen. `label` is null when nothing is asked: the question
 *  then keeps its words while it fades out. */
function DeleteInUse({
  label,
  others,
  onClose,
  onDelete,
}: {
  label: Label | null
  others: Label[]
  onClose: () => void
  onDelete: (label: Label, marksTo: number) => Promise<void>
}) {
  // The label picked for the marks, for the label asked about; until one is,
  // the first of the others.
  const [picked, setPicked] = useState<{ of: number; to: number } | null>(null)
  const to = label && picked?.of === label.id ? picked.to : (others[0]?.id ?? 0)
  return (
    <ConfirmDialog
      open={label !== null}
      onOpenChange={(open) => {
        if (open) return
        setPicked(null)
        onClose()
      }}
      title={label && `Delete “${label.name}”?`}
      description={
        label && (
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Its {marksLabel(label.marks)} {label.marks === 1 ? "gets" : "get"}:
            </span>
            <Select
              value={String(to)}
              onValueChange={(v) => setPicked({ of: label.id, to: Number(v) })}
            >
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
        )
      }
      actionLabel="Delete"
      onConfirm={() => label && void onDelete(label, to)}
    />
  )
}
