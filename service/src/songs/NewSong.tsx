import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Dialog, DialogButtons, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAddSong, useSongs } from "../api"

/**
 * **New song**, on Songs, as a dialog (Alex, 2026-11-10): the title, then
 * the status, the band's first one to start with. **Add song** makes the
 * song with that status and opens its page.
 */
export function NewSongDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New song</DialogTitle>
          <DialogDescription>
            For a song before its first take: its notes and files can go here now. Takes come to it from РЭХА when a take has the same title.
          </DialogDescription>
        </DialogHeader>
        <NewSongForm />
      </DialogContent>
    </Dialog>
  )
}

/** The dialog's fields, new each time it opens. */
function NewSongForm() {
  const navigate = useNavigate()
  const add = useAddSong()
  const statuses = useSongs().data?.statuses ?? []
  const [title, setTitle] = useState("")
  const [status, setStatus] = useState<number>()
  const picked = status ?? statuses[0]?.id
  return (
    <>
      <form
        id="new-song"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          add.mutate(
            { title: title.trim(), status_id: picked },
            { onSuccess: (made) => void navigate({ to: "/songs/$id", params: { id: String((made as { id: number }).id) } }) }
          )
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-title">Title</Label>
          <Input
            id="new-title"
            autoFocus
            maxLength={100}
            value={title}
            onChange={(e) => (setTitle(e.target.value), add.reset())}
            placeholder="Zorka"
            aria-invalid={!!add.error}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-status">Status</Label>
          <Select value={picked === undefined ? undefined : String(picked)} onValueChange={(v) => (setStatus(Number(v)), add.reset())}>
            <SelectTrigger id="new-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {add.error && (
          <p role="alert" className="text-destructive">
            {add.error.message}
          </p>
        )}
      </form>
      <DialogButtons
        action={
          <Button type="submit" form="new-song" disabled={add.isPending}>
            Add song
          </Button>
        }
      />
    </>
  )
}
