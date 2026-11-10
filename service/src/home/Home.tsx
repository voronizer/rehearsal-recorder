import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFrame, useHome, type Home as HomeData, type HomeSong } from "../api"
import { MarkItem } from "../marks/MarkItem"
import { Columns, Group, Groups, OPENS, Page, Rows, Trouble, useTitle } from "../shell/parts"
import { clock, count, day, longDay } from "../shell/words"
import { TakeLine } from "../takes/parts"
import { FirstDay } from "./FirstDay"

/**
 * A song on Home, as a song in РЭХА's list: its title, a grey line about
 * it, then its best take as a row, 8 px under the title (the row's own
 * light makes up the rest).
 */
function SongRow({ song }: { song: HomeSong }) {
  return (
    <div className="flex flex-col gap-0.5" data-song={song.title}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Link to="/songs/$id" params={{ id: String(song.id) }} title={song.title} className={cn("min-w-0 max-w-full truncate font-medium", OPENS)}>
          {song.title}
        </Link>
        <span className="min-w-0 text-xs text-muted-foreground">
          {count(song.takes, "take")} · last {day(song.last_date)}
        </span>
      </div>
      <TakeLine take={song.best} />
    </div>
  )
}

/** A long evening shows this many takes first; the rest are a press away. */
const FIRST = 8

/**
 * The band's last rehearsal on top (Alex's pick A, 2026-11-02): its takes
 * as they were played. The day leads to the rehearsal's page.
 */
function LastRehearsal({ last }: { last: NonNullable<HomeData["last_rehearsal"]> }) {
  const [all, setAll] = useState(false)
  const length = last.takes.reduce((n, t) => n + t.duration_sec, 0)
  const shown = all || last.takes.length <= FIRST + 2 ? last.takes : last.takes.slice(0, FIRST)
  const more = last.takes.length - shown.length
  return (
    <Group
      name="The last rehearsal"
      title={
        // On one line: the grey words after it give way first.
        <Link to="/rehearsals/$uid" params={{ uid: last.uid }} className={cn("whitespace-nowrap", OPENS)}>
          {longDay(last.date)}
        </Link>
      }
      hint={`the last rehearsal · ${count(last.takes.length, "take")} · ${clock(length)}`}
    >
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
                // 24 px from one song's take to the next song's title, as between rows.
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
