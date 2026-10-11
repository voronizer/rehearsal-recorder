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
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { useHeld } from "@/lib/held"
import { labelLook, labelOf, useLabels } from "@/lib/labels"
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
            Marker at
            <span className="tnum">{formatMMSS(shown?.at ?? 0)}</span>
          </DialogTitle>
          <DialogDescription>
            A word about this spot, so next week it still means something.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {labels.map((l) => (
            <Button
              key={l.id}
              variant={chosen === l.id ? "default" : "outline"}
              size="row"
              aria-pressed={chosen === l.id}
              aria-label={l.name}
              onClick={() => setLabelId(l.id)}
            >
              <span className={cn("size-2 rounded-full", labelLook(l.colour).dot)} />
              {l.name}
            </Button>
          ))}
        </div>

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
          aria-label="Marker note"
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
