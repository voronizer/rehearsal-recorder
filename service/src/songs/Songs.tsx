import { formatMeter } from "@/lib/format"
import { useEffect, useState } from "react"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useSongs, type SongItem } from "../api"
import { usePanel } from "../shell/panel"
import { Empty, Group, Groups, Page, Rows, TitleWith, Trouble, useTitle } from "../shell/parts"
import { useSize } from "../shell/size"
import { clock, count, day } from "../shell/words"
import { Play, TakeLine, TakeLink } from "../takes/parts"
import { NewSongDialog } from "./NewSong"

// Last played as wide as “Thu 30 Oct 2025” on one line: a row of two lines would be taller than the rest.
const COLS = "grid-cols-[minmax(0,1fr)_6rem_4rem_4rem_4rem_7rem_minmax(8rem,1fr)]"

function SongLine({ song }: { song: SongItem }) {
  const size = useSize()
  const navigate = useNavigate()
  const to = { to: "/songs/$id", params: { id: String(song.id) } } as const
  // The title is the link to the song's page, for the keyboard too; a press
  // anywhere else on the row opens it as well.
  const name = (
    <span className="flex min-w-0 items-center gap-2">
      <Link {...to} className="truncate">
        {song.title}
      </Link>
    </span>
  )
  const row = (e: { target: EventTarget }) => (e.target as HTMLElement).closest("button, a") || void navigate(to)
  const best = song.best && (
    <span className="flex items-center gap-2">
      <Play take={song.best} />
      <TakeLink take={song.best} short plain />
    </span>
  )
  if (size === "wide")
    return (
      <div data-song={song.title} className={cn("grid min-h-8 cursor-pointer items-center gap-3", COLS)} onClick={row}>
        {name}
        <span>{song.key}</span>
        <span className="tnum">{song.tempo ? Math.round(song.tempo) : ""}</span>
        <span className="tnum">{song.length ? clock(song.length) : ""}</span>
        <span className="tnum">{song.takes || ""}</span>
        <span className="whitespace-nowrap">{song.last_date ? day(song.last_date) : ""}</span>
        {best ?? <span className="text-muted-foreground">No takes yet</span>}
      </div>
    )
  return (
    <div data-song={song.title} className="flex min-h-8 cursor-pointer items-center gap-3" onClick={row}>
      <span className="min-w-0 flex-1">
        {name}
        <span className="block truncate text-xs text-muted-foreground">
          {[song.key, song.tempo !== null && formatMeter(Math.round(song.tempo), song.signature ?? "4/4"), song.takes && count(song.takes, "take")].filter(Boolean).join(" · ")}
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
  const { panel, open, close } = usePanel()
  const navigate = useNavigate()
  // An address from before, `?edit=new-song`, opens Songs with the dialog.
  const edit = useSearch({ from: "/band/songs", select: (s) => s.edit })
  const [adding, setAdding] = useState(edit === "new-song")
  useEffect(() => {
    if (edit === "new-song") void navigate({ to: ".", search: {}, replace: true })
  }, [edit, navigate])
  const head = (
    <TitleWith title="Songs">
      <Button variant="outline" size="row" aria-pressed={panel?.kind === "statuses"} onClick={() => open({ kind: "statuses" })}>
        Statuses
      </Button>
      <Button
        variant="outline"
        size="row"
        onClick={() => {
          // One at a time: the dialog in the panel's place.
          if (panel) close()
          setAdding(true)
        }}
      >
        <Plus />
        New song
      </Button>
    </TitleWith>
  )
  const dialog = <NewSongDialog open={adding} onOpenChange={setAdding} />
  if (songs.error) return <Trouble error={songs.error} retry={() => void songs.refetch()} />
  if (!songs.data) return null
  const { statuses, songs: all, not_named } = songs.data
  if (!all.length && !not_named.length)
    return <Empty title={head} top={dialog} text="No songs yet. A song made in РЭХА appears here, or press New song to start one here." />
  const takes = all.reduce((n, s) => n + s.takes, 0) + not_named.length
  return (
    <Page title={head} sub={`${count(all.length, "song")} · ${count(takes, "take")}`}>
      {dialog}
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
          <Group title="Not named" hint={String(not_named.length)} fold="open">
            <Rows takes>
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
