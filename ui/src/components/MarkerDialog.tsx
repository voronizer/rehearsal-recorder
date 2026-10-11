import { useEffect, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { labelLook, labelOf, useLabels } from "@/lib/labels"
import type { Marker } from "@/lib/api"

const overlayClass =
  "fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"

const contentClass =
  "fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"

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

  return (
    <DialogPrimitive.Root open={marker !== null} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlayClass} />
        <DialogPrimitive.Content className={contentClass}>
          <DialogPrimitive.Title className="flex items-baseline gap-2 text-base font-semibold">
            Marker at
            <span className="tnum">{formatMMSS(marker?.at ?? 0)}</span>
          </DialogPrimitive.Title>
          <DialogPrimitive.Description asChild>
            <p className="mt-1 text-sm text-muted-foreground">
              A word about this spot, so next week it still means something.
            </p>
          </DialogPrimitive.Description>

          <div className="mt-4 flex flex-wrap gap-2">
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
            className="mt-3"
          />

          <div className="mt-6 flex items-center justify-between gap-3">
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
            <div className="flex gap-2">
              <DialogPrimitive.Close asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogPrimitive.Close>
              <Button onClick={save}>Save</Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
