import { useState } from "react"
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
import { api, type SongSummary } from "@/lib/api"
import { UNNAMED } from "@/lib/goes"

/**
 * New song, from the button over History's song list (spec Part 6): a song
 * with no takes yet, so its tempo and backing track can be set before its
 * first take. It asks only for the title. A song's title, or one of its old
 * names, is that song already, and a take's own name ("Take 3") is no song's:
 * the line under the field says so and Create waits. The line keeps its
 * height, so the buttons do not move as it changes.
 *
 * Create makes the song (`add_song`) and hands it to `onMade`, which opens
 * its page; a refusal from Python shows in the same line.
 */
export function NewSongDialog({
  open,
  songs,
  onOpenChange,
  onMade,
}: {
  open: boolean
  /** Every song in the Songs view. */
  songs: SongSummary[]
  onOpenChange: (open: boolean) => void
  onMade: (song: { id: number; title: string }) => void
}) {
  // Each opening starts the form empty; closing leaves it as it was while
  // the dialog fades.
  const [was, setWas] = useState(open)
  const [opening, setOpening] = useState(0)
  if (was !== open) {
    setWas(open)
    if (open) setOpening((n) => n + 1)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New song</DialogTitle>
          <DialogDescription>
            A song with no takes yet: give it a tempo and a backing track before its first take.
          </DialogDescription>
        </DialogHeader>
        <NewSongForm
          key={opening}
          songs={songs}
          onMade={(song) => {
            onOpenChange(false)
            onMade(song)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

function NewSongForm({
  songs,
  onMade,
}: {
  songs: SongSummary[]
  onMade: (song: { id: number; title: string }) => void
}) {
  const [title, setTitle] = useState("")
  // Python's refusal, for the title it was about.
  const [refused, setRefused] = useState<{ title: string; error: string } | null>(null)
  const [making, setMaking] = useState(false)
  const typed = title.trim()
  const lower = typed.toLocaleLowerCase()
  const taken = songs.find(
    (s) => s.title.toLocaleLowerCase() === lower || s.also.some((a) => a.toLocaleLowerCase() === lower)
  )
  const says = taken
    ? `${taken.title} is already a song.`
    : UNNAMED.test(typed)
      ? `${typed} is what a take with no song is called.`
      : refused?.title === typed
        ? refused.error
        : ""
  const can = typed !== "" && says === "" && !making

  const make = async () => {
    if (!can) return
    setMaking(true)
    try {
      const res = await api().add_song(typed)
      if (!res.ok || res.id === undefined) {
        setRefused({ title: typed, error: res.error ?? "Could not make the song" })
        return
      }
      onMade({ id: res.id, title: res.title ?? typed })
    } catch {
      /* the bar across the top says why */
    } finally {
      setMaking(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <Input
          autoFocus
          aria-label="Song title"
          placeholder="Song title"
          autoComplete="off"
          spellCheck={false}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void make()
            }
          }}
        />
        <p data-new-song-says className="min-h-5 text-xs break-words text-muted-foreground">
          {says}
        </p>
      </div>
      <DialogButtons
        action={
          <Button onClick={() => void make()} disabled={!can}>
            Create
          </Button>
        }
      />
    </div>
  )
}
