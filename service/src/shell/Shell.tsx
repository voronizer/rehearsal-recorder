import { Link, Outlet, useLocation, useMatch } from "@tanstack/react-router"
import { Trash2, Users } from "lucide-react"
import { cn } from "@/lib/utils"
import { useFeed, useMe, useTake, type Feed } from "../api"
import { Dot } from "./parts"
import { useWide } from "./useWide"

const row = "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
const active = "bg-secondary font-medium hover:bg-secondary"

/**
 * The band's pages. On a computer a column down the left holds **New**,
 * then every song, then the trash, the owner's **Members** and your name;
 * the rest of the window is the page picked there. On a phone the column is
 * gone and the pages come one at a time.
 */
export function Shell() {
  const wide = useWide()
  const me = useMe()
  if (me.isPending) return null
  if (!wide)
    return (
      <div className="min-h-full">
        <Outlet />
      </div>
    )
  return (
    <div className="flex h-full">
      <aside className="flex w-52 shrink-0 flex-col overflow-y-auto border-r bg-card">
        <p className="px-5 pt-4 text-sm font-semibold">РЭХА</p>
        <SongSide />
        <span className="flex-1" />
        <Bottom className="p-3" />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

/** The song a take page shows, so its row stays picked in the column. */
function useOpenSong(): Feed["songs"][number]["id"] | undefined {
  const match = useMatch({ from: "/band/takes/$uid", shouldThrow: false })
  const take = useTake(match?.params.uid ?? "")
  if (!match) return undefined
  return take.data ? (take.data.song?.id ?? "not-named") : undefined
}

/** The column's songs: the new things first, then every song. */
function SongSide() {
  const feed = useFeed()
  const open = useOpenSong()
  const songs = [...(feed.data?.songs ?? []), ...(feed.data?.not_named ? [feed.data.not_named] : [])]
  const count = feed.data?.new_count ?? 0
  return (
    <nav aria-label="Songs" className="flex flex-col gap-1 p-3">
      <Link to="/" activeOptions={{ exact: true }} className={row} activeProps={{ className: active }}>
        {count > 0 && <Dot />}
        <span className="flex-1">New</span>
        {count > 0 && <span className="text-xs text-muted-foreground tnum">{count}</span>}
      </Link>
      <p className="px-2.5 pt-3 pb-1 text-xs font-semibold text-muted-foreground">Songs</p>
      {songs.map((s) => (
        <Link
          key={s.id}
          to="/songs/$id"
          params={{ id: String(s.id) }}
          className={cn(row, open === s.id && active)}
          activeProps={{ className: active }}
          aria-current={open === s.id ? "page" : undefined}
        >
          <span className="min-w-0 flex-1 truncate">{s.title}</span>
          {s.has_new && <Dot />}
          <span className="text-xs text-muted-foreground tnum">{s.takes}</span>
        </Link>
      ))}
    </nav>
  )
}

/** The trash, the owner's page of members, and your name, to change it. */
export function Bottom({ className }: { className?: string }) {
  const me = useMe()
  const location = useLocation()
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Link to="/trash" className={row} activeProps={{ className: active }}>
        <Trash2 aria-hidden="true" className="size-4 text-muted-foreground" />
        Trash
      </Link>
      {me.data?.owner && (
        <Link to="/members" className={row} activeProps={{ className: active }}>
          <Users aria-hidden="true" className="size-4 text-muted-foreground" />
          Members
        </Link>
      )}
      {me.data && (
        <Link to="/name" search={{ redirect: location.href }} className={cn(row, "text-muted-foreground")}>
          <span
            aria-hidden="true"
            className="flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold text-foreground"
          >
            {(Array.from(me.data.name.trim())[0] ?? "?").toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate">{me.data.name}</span>
        </Link>
      )}
    </div>
  )
}
