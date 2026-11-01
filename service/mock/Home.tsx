import { PlayButton } from "@/components/ui/play-button"
import { usePanel, usePlayer } from "./context"
import { bestOf, fmt, isNew, takeOf, takesOf, lastOf, useData, type Mark } from "./data"
import { FirstDay } from "./more"
import { MarkItem } from "./panels"
import { Columns, Dot, Group, Groups, Page, Rows, StarButton, TakeLink, Wave } from "./parts"

/** A take's ▶: the accent while it plays. */
export function Play({ uid, className }: { uid: string; className?: string }) {
  const data = useData()
  const p = usePlayer()
  const t = takeOf(data, uid)
  return <PlayButton look={p.uid === uid && p.playing ? "playing" : "idle"} name={`${t.song ?? "Take"} ${t.n}`} onClick={() => p.play(uid)} className={className} />
}

/** A song on Home: a line about it, its best take to play, and what that take is. One edge for all text. */
function SongRow({ id }: { id: string }) {
  const data = useData()
  const { open } = usePanel()
  const g = data.songs.find((s) => s.id === id)!
  const best = bestOf(data, g.title)!
  const ts = takesOf(data, g.title)
  const unheard = ts.filter((t) => isNew(data, t.uid))
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
      <span />
      <div className="flex min-w-0 items-baseline gap-2">
        <button type="button" className="font-semibold underline-offset-4 hover:underline" onClick={() => open({ kind: "song", id })}>
          {g.title}
        </button>
        <span className="truncate text-muted-foreground">
          {ts.length} takes · {lastOf(data, g.title)}
        </span>
        <span className="flex-1" />
        {unheard.length > 0 && (
          <button type="button" className="flex shrink-0 items-center gap-1.5 self-center text-xs text-primary hover:underline" onClick={() => open({ kind: "take", uid: unheard[0].uid })}>
            <Dot />
            {unheard.length} not heard yet
          </button>
        )}
      </div>
      <Play uid={best.take.uid} />
      <div className="flex min-w-0 items-center gap-2">
        <Wave uid={best.take.uid} className="flex-1" />
        <StarButton take={best.take} />
      </div>
      <span />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <TakeLink uid={best.take.uid} short className="text-foreground" />
        {best.why === "most stars" ? "the band likes it best" : best.why} · {fmt(best.take.len)}
      </p>
    </div>
  )
}

/** A mark on Home: what it says, where and who under it, the last word under that. Opens its take. */
export function MarkRow({ mark }: { mark: Mark }) {
  return <MarkItem mark={mark} take="full" compact />
}

export function Home() {
  const data = useData()
  if (data.fresh) return <FirstDay />
  const unheard = data.takes.filter((t) => isNew(data, t.uid)).length
  const newMarks = data.marks.filter((k) => isNew(data, k.id)).length
  const songs = data.songs.filter((g) => takesOf(data, g.title).length)
  const marks = [...data.marks].filter((k) => !k.closed).reverse()
  const favourites = data.takes.filter((t) => t.stars.length >= 2)
  return (
    <Page
      title="Home"
      sub={unheard ? `${unheard} takes you have not heard yet${newMarks ? ` · ${newMarks} new marks` : ""}` : "You have heard every take."}
    >
      <Columns
        main={
          <Group title="Songs" hint="with their best take">
            <Rows>
              {songs.map((g) => (
                <SongRow key={g.id} id={g.id} />
              ))}
            </Rows>
          </Group>
        }
        side={
          <Groups>
            <Group title="Latest marks">
              <Rows>
                {marks.map((k) => (
                  <MarkRow key={k.id} mark={k} />
                ))}
              </Rows>
            </Group>
            <Group title="The band's favourites">
              <Rows>
                {favourites.map((t) => (
                  <div key={t.uid} className="flex items-center gap-3">
                    <Play uid={t.uid} />
                    <TakeLink uid={t.uid} />
                    <span className="flex-1" />
                    <StarButton take={takeOf(data, t.uid)} />
                  </div>
                ))}
              </Rows>
            </Group>
          </Groups>
        }
      />
    </Page>
  )
}
