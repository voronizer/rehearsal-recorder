import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogButtons,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LabelDot } from "@/components/ui/mark"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatMMSS } from "@/lib/format"
import { useHeld } from "@/lib/held"
import { labelOf, useLabels } from "@/lib/labels"
import type { Marker } from "@/lib/api"

/**
 * What a marker is about.
 *
 * It opens right after a marker is dropped, so the thought can be written down
 * while it is still fresh — playback does not stop, and closing it without
 * typing anything leaves a plain time marker, which is fine.
 */
export function MarkerDialog({
  marker,
  onOpenChange,
  onSave,
  onDelete,
}: {
  marker: Marker | null
  onOpenChange: (open: boolean) => void
  onSave: (at: number, note: string, labelId: number) => void
  onDelete: (at: number) => void
}) {
  const labels = useLabels()
  const [note, setNote] = useState("")
  const [labelId, setLabelId] = useState(0)
  // The label chosen, as one there is: a mark whose label is not in the list
  // reads as the first, which is what Python would give it.
  const chosen = labelOf(labels, labelId).id

  useEffect(() => {
    if (!marker) return
    setNote(marker.note)
    setLabelId(marker.label_id)
  }, [marker])

  const save = () => {
    if (!marker) return
    onSave(marker.at, note.trim(), chosen)
    onOpenChange(false)
  }

  // The marker the title names, until the dialog has faded out.
  const shown = useHeld<Marker | null>(marker, null)

  return (
    <Dialog open={marker !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2">
            Mark at
            <span className="tnum">{formatMMSS(shown?.at ?? 0)}</span>
          </DialogTitle>
          <DialogDescription>
            A word about this spot, so next week it still means something.
          </DialogDescription>
        </DialogHeader>

        {/* One kind is always chosen: pressing the chosen one again says "",
            which is not a kind. */}
        <ToggleGroup
          type="single"
          variant="switch"
          aria-label="Label"
          value={String(chosen)}
          onValueChange={(id) => id && setLabelId(Number(id))}
          className="w-full flex-wrap"
        >
          {labels.map((l) => (
            <ToggleGroupItem
              key={l.id}
              value={String(l.id)}
              className="flex items-center justify-center gap-2"
            >
              <LabelDot colour={l.colour} />
              {l.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Input
          autoFocus
          value={note}
          placeholder="Guitar drifts, second chorus"
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              save()
            }
          }}
          aria-label="Comment"
        />

        <DialogButtons
          aside={
            <Button
              variant="ghost"
              size="row"
              onClick={() => {
                if (marker) onDelete(marker.at)
                onOpenChange(false)
              }}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
              Delete marker
            </Button>
          }
          action={<Button onClick={save}>Save</Button>}
        />
      </DialogContent>
    </Dialog>
  )
}
