import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useSongs, type SongItem } from "../api"
import { Empty, Group, Groups, OPENS, Page, Rows, TitleWith, Trouble, useTitle } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { useSize } from "../shell/size"
import { clock, count, day } from "../shell/words"
import { Play, TakeLine, TakeLink } from "../takes/parts"

const COLS = "grid-cols-[minmax(0,1fr)_6rem_4rem_4rem_4rem_6rem_minmax(8rem,1fr)]"

function SongLine({ song }: { song: SongItem }) {
  const size = useSize()
  const { open } = usePanel()
  // The title is the song's button, for the keyboard too; a press anywhere
  // else on the row opens it as well.
  const name = (
    <span className="flex min-w-0 items-center gap-2">
      <button type="button" className={cn("truncate", OPENS)} onClick={() => open({ kind: "song", id: song.id })}>
        {song.title}
      </button>
    </span>
  )
  const row = (e: { target: EventTarget }) => (e.target as HTMLElement).closest("button, a") || open({ kind: "song", id: song.id })
  const best = song.best && (
    <span className="flex items-center gap-2">
      <Play take={song.best} />
      <TakeLink take={song.best} short />
    </span>
  )
  if (size === "wide")
    return (
      <div data-song={song.title} className={cn("grid cursor-pointer items-center gap-3", COLS)} onClick={row}>
        {name}
        <span>{song.key}</span>
        <span className="tnum">{song.tempo ? Math.round(song.tempo) : ""}</span>
        <span className="tnum">{song.length ? clock(song.length) : ""}</span>
        <span className="tnum">{song.takes || ""}</span>
        <span>{song.last_date ? day(song.last_date) : ""}</span>
        {best ?? <span className="text-muted-foreground">No takes yet</span>}
      </div>
    )
  return (
    <div data-song={song.title} className="flex cursor-pointer items-center gap-3" onClick={row}>
      <span className="min-w-0 flex-1">
        {name}
        <span className="block truncate text-xs text-muted-foreground">
          {[song.key, song.tempo && `${Math.round(song.tempo)} bpm`, song.takes && count(song.takes, "take")].filter(Boolean).join(" · ")}
        </span>
      </span>
      {best}
    </div>
  )
}

/** Songs: a table grouped by status, the last status folded; takes nobody named a song under Not named. */
export function Songs() {
  useTitle("Songs")
  const songs = useSongs()
  const size = useSize()
  const { open } = usePanel()
  const head = (
    <TitleWith title="Songs">
      <Button variant="outline" size="row" onClick={() => open({ kind: "statuses" })}>
        Statuses
      </Button>
      <Button variant="outline" size="row" onClick={() => open({ kind: "new-song" })}>
        <Plus />
        New song
      </Button>
    </TitleWith>
  )
  if (songs.error) return <Trouble error={songs.error} retry={() => void songs.refetch()} />
  if (!songs.data) return null
  const { statuses, songs: all, not_named } = songs.data
  if (!all.length && !not_named.length)
    return <Empty title={head} text="No songs yet. A song appears with its first take from РЭХА, or press New song to keep its notes and files here before that." />
  const takes = all.reduce((n, s) => n + s.takes, 0) + not_named.length
  return (
    <Page title={head} sub={`${count(all.length, "song")} · ${count(takes, "take")}`}>
      {size === "wide" && (
        <div className={cn("-mb-4 grid gap-3 px-6 text-xs text-muted-foreground", COLS)}>
          <span>Song</span>
          <span>Key</span>
          <span>Tempo</span>
          <span>Length</span>
          <span>Takes</span>
          <span>Last played</span>
          <span>Best take</span>
        </div>
      )}
      <Groups>
        {statuses.map((st, i) => {
          const these = all.filter((s) => s.status_id === st.id)
          return (
            // The last status (Archive) and an empty one folded, so they take one line.
            <Group
              key={st.id}
              title={st.name}
              hint={String(these.length)}
              fold={!these.length || (i === statuses.length - 1 && statuses.length > 1) ? "closed" : "open"}
            >
              {these.length ? (
                <Rows opens>
                  {these.map((s) => (
                    <SongLine key={s.id} song={s} />
                  ))}
                </Rows>
              ) : (
                <p className="text-muted-foreground">No songs with this status.</p>
              )}
            </Group>
          )
        })}
        {not_named.length > 0 && (
          <Group title="Not named" hint="takes recorded in РЭХА without a song's title" fold="open">
            <Rows>
              {not_named.map((t) => (
                <TakeLine key={t.uid} take={t} />
              ))}
            </Rows>
          </Group>
        )}
      </Groups>
    </Page>
  )
}
