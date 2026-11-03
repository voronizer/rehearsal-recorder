import { useState } from "react"
import { Music } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRestore, useRestoreSong, useTrash, type Trashed, type TrashedSong } from "../api"
import { Group, Page, Rows, Tile, Trouble, useTitle } from "../shell/parts"
import { count, day, localDay, longDay, quoted } from "../shell/words"
import { Play, TakeLink } from "../takes/parts"

/** A take or a song waits this many days in the trash. */
const KEPT = 30
const DAY = 24 * 60 * 60 * 1000

/** “deleted for good in 28 days”, counted from when it was deleted. */
function left(t: { trashed_at: string }, now = Date.now()) {
  const days = KEPT - Math.floor((now - Date.parse(t.trashed_at)) / DAY)
  return days > 0 ? `deleted for good in ${count(days, "day")}` : "deleted for good today"
}

/** Who sent it here and when: “deleted by Ivan Mon 2 Nov”, or “removed in РЭХА Mon 2 Nov”. */
const gone = (t: { trashed_at: string; by: string | null }) =>
  `${t.by ? `deleted by ${t.by}` : "removed in РЭХА"} ${day(localDay(t.trashed_at))}`

type Line = { song: TrashedSong; at: string } | { take: Trashed; at: string }

/**
 * **Trash**: takes and songs deleted here, and takes removed in РЭХА, with
 * their files, marks and stars. Anyone in the band can listen to a take or
 * press **Restore**; a song comes back with the takes that went with it.
 * After 30 days they are deleted for good.
 */
export function Trash() {
  useTitle("Trash")
  const trash = useTrash()
  const restore = useRestore()
  const restoreSong = useRestoreSong()
  const [back, setBack] = useState<string | null>(null)
  const busy = restore.isPending || restoreSong.isPending
  // Songs and takes in one list, the newest deleted first.
  const lines: Line[] = trash.data
    ? [...trash.data.songs.map((song) => ({ song, at: song.trashed_at })), ...trash.data.takes.map((take) => ({ take, at: take.trashed_at }))].sort(
        (a, b) => b.at.localeCompare(a.at)
      )
    : []
  return (
    <Page
      title="Trash"
      sub="Takes and songs deleted here or in РЭХА wait here for 30 days, then they are deleted for good. Anyone in the band can put one back."
    >
      {back && (
        <Tile boxed className="border-primary/40">
          <span role="status">{back}</span>
        </Tile>
      )}
      {trash.error && <Trouble error={trash.error} retry={() => void trash.refetch()} />}
      {trash.data &&
        (lines.length ? (
          <Group>
            <Rows>
              {lines.map((line) =>
                "song" in line ? (
                  <div key={`song-${line.song.id}`} className="flex items-center gap-3" data-song={line.song.title}>
                    <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                      <Music className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="truncate">{line.song.title}</span>
                      <div className="text-xs text-muted-foreground">
                        song with {line.song.takes ? `${count(line.song.takes, "take")}, ` : ""}notes and files · {gone(line.song)} · {left(line.song)}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="row"
                      disabled={busy}
                      onClick={() => {
                        const { id, title, takes } = line.song
                        restoreSong.mutate(id, { onSuccess: () => setBack(`${quoted(title)} is back${takes ? " with its takes" : ""}.`) })
                      }}
                    >
                      Restore
                    </Button>
                  </div>
                ) : (
                  <div key={line.take.uid} className="flex items-center gap-3" data-take={line.take.name}>
                    <Play take={line.take} />
                    <div className="min-w-0 flex-1">
                      <TakeLink take={line.take} />
                      <div className="text-xs text-muted-foreground">
                        {day(line.take.date)} · {gone(line.take)} · {left(line.take)}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="row"
                      disabled={busy}
                      onClick={() => {
                        const { uid, name, date } = line.take
                        restore.mutate(uid, { onSuccess: () => setBack(`${quoted(name)} is back with the takes of ${longDay(date)}.`) })
                      }}
                    >
                      Restore
                    </Button>
                  </div>
                )
              )}
            </Rows>
          </Group>
        ) : (
          <p className="text-muted-foreground">The trash is empty.</p>
        ))}
    </Page>
  )
}
