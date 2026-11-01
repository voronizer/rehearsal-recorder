import { Link, Navigate } from "@tanstack/react-router"
import { ChevronRight, MessageSquare } from "lucide-react"
import { useFeed, type Feed } from "../api"
import { Bottom } from "../shell/Shell"
import { Dot, Note, PageHead, Stars } from "../shell/parts"
import { useWide } from "../shell/useWide"
import { clock, count, day } from "../shell/words"
import { colourOf } from "../takes/colours"

/**
 * The first screen. On a computer it is the new card, or, with nothing
 * new, the song played last; the songs are in the column on the left. On a
 * phone it is the new card, then the songs, then the trash and the rest.
 */
export function First() {
  const wide = useWide()
  const feed = useFeed()
  if (feed.error) return <Note>{feed.error.message}</Note>
  if (!feed.data) return null
  const { start } = feed.data
  if (wide && start.kind === "song") return <Navigate to="/songs/$id" params={{ id: String(start.id) }} replace />
  const songs = [...feed.data.songs, ...(feed.data.not_named ? [feed.data.not_named] : [])]
  return (
    <>
      <PageHead path={wide ? [{ label: "New" }] : []} />
      <div className="flex max-w-xl flex-col gap-5 p-4 md:p-5">
        {feed.data.new_count > 0 && <NewCard feed={feed.data} />}
        {songs.length === 0 && (
          <p className="text-sm text-muted-foreground">No takes yet. They come here once РЭХА sends them.</p>
        )}
        {!wide && songs.length > 0 && <SongRows songs={songs} />}
        {!wide && <Bottom className="rounded-xl bg-card p-2" />}
      </div>
    </>
  )
}

/** What arrived since you last looked: takes not opened yet, and comments on takes you had. */
function NewCard({ feed }: { feed: Feed }) {
  return (
    <section aria-labelledby="new" className="flex flex-col gap-3 rounded-xl bg-card p-4">
      <h2 id="new" className="flex items-center gap-2 text-sm font-semibold">
        <Dot />
        New since you were here
      </h2>
      {feed.new.takes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {feed.new.takes.map((t) => (
            <Link
              key={t.uid}
              to="/takes/$uid"
              params={{ uid: t.uid }}
              className="rounded-md bg-secondary px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            >
              {t.name}
            </Link>
          ))}
        </div>
      )}
      {feed.new.comments.length > 0 && (
        <ul className="flex flex-col gap-2 border-t pt-3">
          {feed.new.comments.map((c) => (
            <li key={c.id}>
              <Link
                to="/takes/$uid"
                params={{ uid: c.take_uid }}
                search={{ at: c.at }}
                className="flex items-start gap-2 rounded-md text-xs hover:bg-accent"
              >
                <MessageSquare aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-muted-foreground tnum">
                    <span aria-hidden="true" className={`size-2 rounded-full ${colourOf(c.colour).dot}`} />
                    {c.take_name} · {clock(c.at)}
                  </span>
                  <span>“{c.text || c.label}”</span>
                  <span className="text-muted-foreground">{c.author ?? `${c.label} · mark from РЭХА`}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** On a phone: every song, the most recently played first, with its best take. */
function SongRows({ songs }: { songs: Feed["songs"] }) {
  return (
    <section aria-labelledby="songs" className="flex flex-col gap-2">
      <h2 id="songs" className="px-1 text-sm font-semibold">
        Songs
      </h2>
      <ul className="flex flex-col rounded-xl bg-card">
        {songs.map((s, i) => (
          <li key={s.id} className={i > 0 ? "border-t" : undefined}>
            <Link to="/songs/$id" params={{ id: String(s.id) }} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-sm font-medium">
                  {s.title}
                  {s.has_new && <Dot />}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {count(s.takes, "take")} · last on {day(s.last_date)}
                  {s.best && s.best.stars.length > 0 && ` · best ${s.best.name}`}
                </span>
              </span>
              {s.best && <Stars stars={s.best.stars} />}
              <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
