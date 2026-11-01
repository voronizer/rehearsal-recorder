import { usePanel } from "./context"
import { bestOf, isNew, takesOf, lastOf, useData, type Mark } from "./data"
import { FirstDay } from "./more"
import { MarkItem } from "./panels"
import { Columns, Group, Groups, Page, Rows, TakeLine } from "./parts"
export { Play } from "./parts"

/** A song on Home, as a song in РЭХА's list: its title, a grey line about it, then its best take's wave. */
function SongRow({ id }: { id: string }) {
  const data = useData()
  const { open } = usePanel()
  const g = data.songs.find((s) => s.id === id)!
  const best = bestOf(data, g.title)!
  const ts = takesOf(data, g.title)
  const unheard = ts.filter((t) => isNew(data, t.uid))
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-w-0 items-baseline gap-2">
        <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => open({ kind: "song", id })}>
          {g.title}
        </button>
        <span className="truncate text-xs text-muted-foreground">
          {ts.length} takes · last {lastOf(data, g.title)}
          {unheard.length > 0 && (
            <>
              {" · "}
              <button type="button" className="text-primary hover:underline" onClick={() => open({ kind: "take", uid: unheard[0].uid })}>
                {unheard.length} not heard yet
              </button>
            </>
          )}
        </span>
      </div>
      <TakeLine take={best.take} />
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
            <div className="flex flex-col gap-5">
              {songs.map((g) => (
                <SongRow key={g.id} id={g.id} />
              ))}
            </div>
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
              <div className="flex flex-col gap-1">
                {favourites.map((t) => (
                  <TakeLine key={t.uid} take={t} />
                ))}
              </div>
            </Group>
          </Groups>
        }
      />
    </Page>
  )
}
