import { Link, useParams } from "@tanstack/react-router"
import { PlayButton } from "@/components/ui/play-button"
import { useSong, useTake, type TakeRow } from "../api"
import { Dot, Note, PageHead, Stars } from "../shell/parts"
import { count, day, clock, longDay, quoted } from "../shell/words"
import { CANNOT_PLAY, usePlayer } from "../takes/player/usePlayer"

/**
 * A song's page: the take the band likes best on top, with a ▶ that plays
 * it there and then, then every take, newest first.
 */
export function Song() {
  const { id } = useParams({ from: "/band/songs/$id" })
  const song = useSong(id)
  if (song.error) return <Note>{song.error.message}</Note>
  if (!song.data) return null
  const { best, takes } = song.data
  const rest = takes.filter((t) => t.uid !== best?.uid)
  const first = takes[takes.length - 1]
  return (
    <>
      <PageHead path={[{ label: song.data.song.title }]} />
      <div className="flex max-w-2xl flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{song.data.song.title}</h1>
          {first && (
            <p className="text-xs text-muted-foreground">
              {count(takes.length, "take")} since {longDay(first.date)}
            </p>
          )}
        </div>
        {best && <Best take={best} />}
        {rest.length > 0 && (
          <section aria-labelledby="all" className="flex flex-col gap-2">
            <h2 id="all" className="px-1 text-sm font-semibold">
              All takes
            </h2>
            <ul className="flex flex-col rounded-xl bg-card">
              {rest.map((t, i) => (
                <li key={t.uid} className={i > 0 ? "border-t" : undefined}>
                  <Row take={t} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}

/** "Thu 30 Oct · 4:05 · 2 marks" */
const facts = (t: TakeRow) => `${day(t.date)} · ${clock(t.duration_sec)}${t.marks > 0 ? ` · ${count(t.marks, "mark")}` : ""}`

function Row({ take }: { take: TakeRow }) {
  return (
    <Link to="/takes/$uid" params={{ uid: take.uid }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent">
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          {take.name}
          {take.is_new && <Dot />}
        </span>
        <span className="text-xs text-muted-foreground tnum">{facts(take)}</span>
      </span>
      <Stars stars={take.stars} />
    </Link>
  )
}

/** The take the band likes best (most members' stars), or with no stars yet the newest. */
function Best({ take }: { take: TakeRow }) {
  const page = useTake(take.uid)
  const player = usePlayer(page.data)
  const title = take.stars.length > 0 ? "The take the band likes best" : "The newest take"
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl bg-card p-4">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="flex items-center gap-3">
        {player.supported === false ? (
          <p className="w-32 shrink-0 text-xs text-muted-foreground">{CANNOT_PLAY}</p>
        ) : (
          <PlayButton
            size="head"
            look={player.look}
            name={quoted(take.name)}
            disabled={!page.data || !player.supported}
            onClick={player.toggle}
          />
        )}
        <Link to="/takes/$uid" params={{ uid: take.uid }} className="flex min-w-0 flex-1 flex-col gap-0.5 hover:underline">
          <span className="flex items-center gap-2 text-sm font-semibold">
            {take.name}
            {take.is_new && <Dot />}
          </span>
          <span className="text-xs text-muted-foreground tnum">{facts(take)}</span>
        </Link>
        <Stars stars={take.stars} />
      </div>
    </section>
  )
}
