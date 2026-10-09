import { useState } from "react"
import { GripVertical, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { SongPills } from "@/components/SongPills"
import { SortableList } from "@/components/SortableList"
import type { SetSong, SongChoices } from "@/lib/api"
import { songNamed } from "@/lib/goes"
import { notInSet } from "@/lib/setSongs"

/**
 * A set's songs (issue #12 step 8, S3 and T3): numbered in the order they
 * are played, dragged into another by their handles, and ✕ to take one out.
 * Under them, *Add*: *Another song…*, a field for a song not played yet,
 * and the band's other songs as pills, as under a take's name, which
 * typing in the field narrows. A song the band has not played says so.
 *
 * `onChange` hears the titles in their new order; the caller puts them in
 * place at once.
 */
export function SetSongsEditor({
  songs,
  choices,
  onChange,
}: {
  songs: SetSong[]
  choices: SongChoices | null
  onChange: (titles: string[]) => void
}) {
  const [typed, setTyped] = useState("")
  const titles = songs.map((s) => s.title)
  const left = notInSet(choices, titles)

  const add = (text: string) => {
    // An old name, or a title in other letters, is the song as it is now.
    const title = songNamed(text, choices)?.choice.song ?? text.trim()
    if (title === "") return
    if (!titles.some((t) => t.toLocaleLowerCase() === title.toLocaleLowerCase()))
      onChange([...titles, title])
    setTyped("")
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {songs.length === 0 ? (
        <p className="rounded-lg bg-muted/50 px-3 py-3 text-sm text-muted-foreground">
          No songs yet: add them below, in the order you play them.
        </p>
      ) : (
        <SortableList
          items={songs.map((s) => ({ id: s.title, song: s }))}
          label="Songs of the set"
          onMove={(id, to) => {
            const next = titles.filter((t) => t !== id)
            next.splice(to, 0, id)
            onChange(next)
          }}
        >
          {({ song }, handleRef) => (
            <div
              data-set-editor-song={song.title}
              className="flex h-9 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-accent/40"
            >
              <button
                ref={handleRef}
                type="button"
                aria-label={`Move ${song.title}`}
                className="flex w-5 shrink-0 cursor-grab touch-none justify-center text-muted-foreground hover:text-foreground"
              >
                <GripVertical className="size-4" />
              </button>
              <span className="tnum w-5 shrink-0 text-right text-xs text-muted-foreground">
                {titles.indexOf(song.title) + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" title={song.title}>
                {song.title}
              </span>
              {song.new && (
                <span className="shrink-0 text-xs text-muted-foreground">not played yet</span>
              )}
              <button
                type="button"
                aria-label={`Take ${song.title} out`}
                title="Take it out of the set"
                onClick={() => onChange(titles.filter((t) => t !== song.title))}
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
        </SortableList>
      )}

      <div data-set-add className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Add</span>
        <Input
          aria-label="Another song"
          value={typed}
          placeholder="Another song…"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return
            e.preventDefault()
            add(typed)
          }}
          className="h-8 max-w-64"
        />
        <SongPills
          choices={left}
          value={typed}
          initial=""
          onPick={add}
          goes={false}
        />
      </div>
    </div>
  )
}
