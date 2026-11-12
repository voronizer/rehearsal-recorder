import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Dialog, DialogButtons, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAddSong, useSongs } from "../api"
import { ErrorLine } from "../shell/parts"

/**
 * **New song**, on Songs, as a dialog (Alex, 2026-11-10): the title, then
 * the status, the band's first one to start with. **Add song** makes the
 * song with that status and opens its page.
 */
export function AddSongDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
  const songs = useSongs()
  const statuses = songs.data?.statuses ?? []
  const [title, setTitle] = useState("")
  const [status, setStatus] = useState<number>()
  // A status someone deleted meanwhile gives way to the first again.
  const picked = statuses.some((s) => s.id === status) ? status : statuses[0]?.id
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
            {
              onSuccess: (made) => void navigate({ to: "/songs/$id", params: { id: String((made as { id: number }).id) } }),
              // The band's list again, as it is now: a status may have gone meanwhile.
              onError: () => void songs.refetch(),
            }
          )
        }}
      >
        {/* What went wrong in the line under the title, there when empty (S11). */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="new-title">Title</Label>
          <Field className="gap-1">
            <Input
              id="new-title"
              autoFocus
              maxLength={100}
              value={title}
              onChange={(e) => (setTitle(e.target.value), add.reset())}
              placeholder="Zorka"
              aria-invalid={!!add.error}
            />
            <ErrorLine error={add.error?.message} />
          </Field>
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
