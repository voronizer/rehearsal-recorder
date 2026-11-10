import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useFrame, useHome, type Home as HomeData, type HomeSong } from "../api"
import { MarkItem } from "../marks/MarkItem"
import { Columns, Group, Groups, Page, RehearsalLine, Rows, SongLine, Trouble, useTitle } from "../shell/parts"
import { clock, count } from "../shell/words"
import { TakeLine } from "../takes/parts"
import { FirstDay } from "./FirstDay"

/** A song on Home: its grey line, as on a rehearsal's page, over its best take. */
function SongRow({ song }: { song: HomeSong }) {
  return (
    <div className="flex flex-col gap-3" data-song={song.title}>
      <SongLine song={song} takes={song.takes} last={song.last_date} />
      <TakeLine take={song.best} />
    </div>
  )
}

/** A long evening shows this many takes first; the rest are a press away. */
const FIRST = 8

/**
 * The band's last rehearsal on top (Alex's pick A, 2026-11-02): its takes
 * as they were played, under its grey line, which leads to the rehearsal's
 * page as a song's does to the song's (Alex, 2026-11-10).
 */
function LastRehearsal({ last }: { last: NonNullable<HomeData["last_rehearsal"]> }) {
  const [all, setAll] = useState(false)
  const length = last.takes.reduce((n, t) => n + t.duration_sec, 0)
  const shown = all || last.takes.length <= FIRST + 2 ? last.takes : last.takes.slice(0, FIRST)
  const more = last.takes.length - shown.length
  return (
    <Group name="The last rehearsal">
      <RehearsalLine uid={last.uid} date={last.date} facts={`${count(last.takes.length, "take")} · ${clock(length)}`} />
      <Rows takes>
        {shown.map((t) => (
          <TakeLine key={t.uid} take={t} />
        ))}
      </Rows>
      {more > 0 && (
        <Button variant="ghost" size="row" className="self-start" onClick={() => setAll(true)}>
          Show {count(more, "more take")}
        </Button>
      )}
    </Group>
  )
}

/**
 * **Home**: the last rehearsal, every song with takes (but the archived)
 * and its best one, the latest marks, the band's latest favourites. Before
 * the band has a take, the first steps.
 */
export function Home() {
  useTitle("Home")
  const home = useHome()
  const frame = useFrame()
  const error = home.error ?? frame.error
  if (error) return <Trouble error={error} retry={() => void Promise.all([home.refetch(), frame.refetch()])} />
  if (!home.data || !frame.data) return null
  const h = home.data
  if (!frame.data.has_takes) return <FirstDay steps={h.steps} />
  return (
    <Page title="Home">
      <Columns
        sideWidth="22rem"
        main={
          <Groups>
            {h.last_rehearsal && <LastRehearsal last={h.last_rehearsal} />}
            <Group title="Songs" hint="with their best take">
              {h.songs.length ? (
                // 24 px from one song's take to the next song's line, as between rows.
                <div className="flex flex-col gap-4.5">
                  {h.songs.map((s) => (
                    <SongRow key={s.id} song={s} />
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No song here yet. Archived songs are under Songs, takes without a song's title under Rehearsals.</p>
              )}
            </Group>
          </Groups>
        }
        side={
          <Groups>
            <Group title="Latest marks">
              {h.latest_marks.length ? (
                <Rows opens>
                  {h.latest_marks.map((k) => (
                    <MarkItem key={k.id} mark={k} take="full" compact />
                  ))}
                </Rows>
              ) : (
                <p className="text-muted-foreground">No marks yet.</p>
              )}
            </Group>
            <Group title="The band's favourites" hint={h.favourite_count > h.favourites.length ? `the latest ${h.favourites.length}` : undefined}>
              {h.favourites.length ? (
                <Rows takes>
                  {h.favourites.map((t) => (
                    <TakeLine key={t.uid} take={t} />
                  ))}
                </Rows>
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
