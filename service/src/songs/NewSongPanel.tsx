import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAddSong } from "../api"
import { PanelHead } from "../shell/EditList"
import { usePanel } from "../shell/panel"

/** **New song**: a song before its first take, so its notes and files can go here now. */
export function NewSongPanel() {
  const { open, close } = usePanel()
  const add = useAddSong()
  const [title, setTitle] = useState("")
  return (
    <div className="flex flex-col gap-6">
      <PanelHead title="New song" />
      <p className="text-muted-foreground">
        For a song before its first take: its notes and files can go here now. Takes come to it from РЭХА when a take has the same title.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          add.mutate(title.trim(), { onSuccess: (made) => open({ kind: "song", id: (made as { id: number }).id }) })
        }}
      >
        <Label htmlFor="new-title">Title</Label>
        <Input id="new-title" autoFocus maxLength={100} value={title} onChange={(e) => (setTitle(e.target.value), add.reset())} placeholder="Zorka" aria-invalid={!!add.error} />
        {add.error && (
          <p role="alert" className="text-destructive">
            {add.error.message}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={add.isPending}>
            Add song
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}
