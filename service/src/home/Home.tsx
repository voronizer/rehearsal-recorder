import { useFrame, useHome, type HomeSong } from "../api"
import { MarkItem } from "../marks/MarkItem"
import { Columns, Group, Groups, Note, Page, Rows } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { count, day } from "../shell/words"
import { TakeLine } from "../takes/parts"
import { FirstDay } from "./FirstDay"

/** A song on Home, as a song in РЭХА's list: its title, a grey line about it, then its best take as a row. */
function SongRow({ song }: { song: HomeSong }) {
  const { open } = usePanel()
  return (
    <div className="flex flex-col gap-2" data-song={song.title}>
      <div className="flex min-w-0 items-baseline gap-2">
        <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={() => open({ kind: "song", id: song.id })}>
          {song.title}
        </button>
        <span className="truncate text-xs text-muted-foreground">
          {count(song.takes, "take")} · last {day(song.last_date)}
          {song.unheard.length > 0 && (
            <>
              {" · "}
              <button type="button" className="text-primary hover:underline" onClick={() => open({ kind: "take", uid: song.unheard[0] })}>
                {song.unheard.length} not heard yet
              </button>
            </>
          )}
        </span>
      </div>
      <TakeLine take={song.best} />
    </div>
  )
}

/** What is new for you, under the title. */
function news(unheard: number, marks: number) {
  const said = [unheard > 0 && `${count(unheard, "take")} you have not heard yet`, marks > 0 && count(marks, "new mark")].filter(Boolean)
  return said.length ? said.join(" · ") : "You have heard every take."
}

/**
 * **Home**: every song with takes and its best one, the latest marks, the
 * band's favourites. Before the band has a take, the first steps.
 */
export function Home() {
  const home = useHome()
  const frame = useFrame()
  if (home.error) return <Note>{home.error.message}</Note>
  if (!home.data || !frame.data) return null
  const h = home.data
  if (!frame.data.has_takes) return <FirstDay steps={h.steps} />
  return (
    <Page title="Home" sub={news(h.unheard, h.new_marks)}>
      <Columns
        main={
          <Group title="Songs" hint="with their best take">
            {h.songs.length ? (
              <div className="flex flex-col gap-5">
                {h.songs.map((s) => (
                  <SongRow key={s.id} song={s} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No song has a take yet. Takes without a song's title are under Rehearsals.</p>
            )}
          </Group>
        }
        side={
          <Groups>
            <Group title="Latest marks">
              {h.latest_marks.length ? (
                <Rows>
                  {h.latest_marks.map((k) => (
                    <MarkItem key={k.id} mark={k} take="full" compact />
                  ))}
                </Rows>
              ) : (
                <p className="text-muted-foreground">No marks yet.</p>
              )}
            </Group>
            <Group title="The band's favourites">
              {h.favourites.length ? (
                <div className="flex flex-col gap-1">
                  {h.favourites.map((t) => (
                    <TakeLine key={t.uid} take={t} />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">Takes starred by two or more of the band show here.</p>
              )}
            </Group>
          </Groups>
        }
      />
    </Page>
  )
}
