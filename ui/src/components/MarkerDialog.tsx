import { useEffect, useState } from "react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { MARKER_KINDS } from "@/lib/markers"
import type { Marker, MarkerKind } from "@/lib/api"

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
  onSave: (at: number, note: string, kind: MarkerKind) => void
  onDelete: (at: number) => void
}) {
  const [note, setNote] = useState("")
  const [kind, setKind] = useState<MarkerKind>("note")

  useEffect(() => {
    if (!marker) return
    setNote(marker.note)
    setKind(marker.kind)
  }, [marker])

  const save = () => {
    if (!marker) return
    onSave(marker.at, note.trim(), kind)
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
            {MARKER_KINDS.map((k) => (
              <Button
                key={k.kind}
                variant={kind === k.kind ? "default" : "outline"}
                size="sm"
                aria-pressed={kind === k.kind}
                aria-label={k.label}
                onClick={() => setKind(k.kind)}
              >
                <span className={cn("size-2 rounded-full", k.dot)} />
                {k.label}
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
              size="sm"
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
