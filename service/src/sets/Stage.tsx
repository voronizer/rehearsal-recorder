import { useEffect, useRef, type ReactNode } from "react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight, FileText, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatMeter } from "@/lib/format"
import { useSets, useSong, useSongs, type SongItem } from "../api"
import { Note, Trouble, useTitle } from "../shell/parts"
import { clock } from "../shell/words"
import { lengthOf, songsOf } from "./length"

/*
  **On stage** (Alex's pick, 9 November): the set on a phone on the mic
  stand, one song a screen, big, with ‹ and › at the bottom, or a swipe.
  No marks yet; a grey line at the top says it is still in development.
*/

/** How far a finger goes sideways before it is a swipe to the next song, in pixels. */
const SWIPE = 60

/**
 * While the stage view is open the screen stays on, where the browser lets
 * it. A hidden page loses the lock, so it is asked for again when the page
 * is back in view. A browser that says no is left to dim as it would.
 */
function useScreenOn() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let left = false
    const ask = () => {
      if (document.visibilityState !== "visible" || !navigator.wakeLock) return
      navigator.wakeLock.request("screen").then(
        (got) => {
          if (left) return void got.release().catch(() => {})
          void lock?.release().catch(() => {})
          lock = got
        },
        () => {}
      )
    }
    ask()
    document.addEventListener("visibilitychange", ask)
    return () => {
      left = true
      document.removeEventListener("visibilitychange", ask)
      void lock?.release().catch(() => {})
    }
  }, [])
}

/** The song's key, tempo and length on one line. */
function Facts({ song }: { song: SongItem }) {
  const length = lengthOf(song)
  return (
    <p className="tnum text-xl text-muted-foreground">
      {[song.key, song.tempo !== null && formatMeter(Math.round(song.tempo), song.signature ?? "4/4"), length !== null && clock(length)]
        .filter(Boolean)
        .join(" · ")}
    </p>
  )
}

/** The song's notes and files, as big as a phone on a mic stand needs: pictures whole, the rest as buttons. */
function Sheet({ id }: { id: number }) {
  const page = useSong(id).data
  if (!page) return null
  const { song, files } = page
  return (
    <div className="flex flex-col gap-4">
      {song.notes && <p className="text-xl leading-relaxed whitespace-pre-wrap">{song.notes}</p>}
      {files.map((f) =>
        f.kind === "picture" ? (
          <img key={f.id} src={f.url} alt={f.name} className="h-auto w-full rounded-lg border" />
        ) : (
          <Button key={f.id} asChild variant="outline" className="h-11 max-w-full justify-start gap-2 self-start text-base">
            <a href={f.url} {...(f.kind === "pdf" ? { target: "_blank", rel: "noreferrer" } : { download: f.name })}>
              <FileText />
              <span className="truncate">{f.name}</span>
            </a>
          </Button>
        )
      )}
    </div>
  )
}

/** The bar at the top: the set's name over “Still in development”, where the set is, and ✕ back to it. */
function Top({ id, name, children }: { id: string; name: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm text-muted-foreground">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{name}</span>
        <span className="text-xs">Still in development</span>
      </span>
      {children}
      <Button asChild variant="ghost" size="icon-row" aria-label="Leave the stage view">
        <Link to="/sets/$id" params={{ id }}>
          <X />
        </Link>
      </Button>
    </div>
  )
}

/** The set's song `n` (from 1) over the whole screen. */
export function Stage() {
  const { id, n } = useParams({ from: "/stage/$id/$n" })
  const sets = useSets()
  const all = useSongs()
  const navigate = useNavigate()
  const from = useRef<{ x: number; y: number } | null>(null)
  const set = sets.data?.sets.find((s) => s.id === Number(id))
  useTitle(set?.name)
  useScreenOn()
  const error = sets.error ?? all.error
  if (error)
    return (
      <div className="p-5">
        <Trouble error={error} retry={() => void Promise.all([sets.refetch(), all.refetch()])} />
      </div>
    )
  if (!sets.data || !all.data) return null
  const songs = set ? songsOf(set.songs, all.data.songs) : []
  if (!set || !songs.length)
    return (
      <div className="flex h-full flex-col bg-background text-sm">
        <Top id={id} name={set?.name ?? "Sets"} />
        <div className="p-5">
          <Note>{set ? "This set has no songs yet." : "This set is not here. It may be in the Trash."}</Note>
        </div>
      </div>
    )
  const at = Math.min(Math.max((Number(n) || 1) - 1, 0), songs.length - 1)
  const song = songs[at]
  const before = songs[at - 1]
  const after = songs[at + 1]
  // Past the first song or the last, nothing happens.
  const go = (to: number) => {
    if (to < 0 || to >= songs.length) return
    void navigate({ to: "/stage/$id/$n", params: { id, n: String(to + 1) }, replace: true })
  }
  return (
    <div
      className="flex h-full touch-pan-y flex-col bg-background text-sm select-none"
      onPointerDown={(e) => (from.current = { x: e.clientX, y: e.clientY })}
      onPointerCancel={() => (from.current = null)}
      onPointerUp={(e) => {
        const start = from.current
        from.current = null
        if (!start) return
        const dx = e.clientX - start.x
        if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(e.clientY - start.y)) return
        go(dx < 0 ? at + 1 : at - 1)
      }}
    >
      <Top id={id} name={set.name}>
        <span className="tnum">
          {at + 1} of {songs.length}
        </span>
      </Top>
      <div key={song.id} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
        <h1 className="text-4xl font-semibold text-balance">
          <span className="tnum mr-3 text-muted-foreground">{at + 1}</span>
          {song.title}
        </h1>
        <Facts song={song} />
        <Sheet id={song.id} />
      </div>
      <div className="grid grid-cols-2 gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button
          variant="outline"
          className="h-14 min-w-0 justify-start gap-1 text-base"
          aria-label={before ? `Previous song: ${before.title}` : "Previous song"}
          disabled={!before}
          onClick={() => go(at - 1)}
        >
          <ChevronLeft />
          <span className="truncate">{before?.title ?? ""}</span>
        </Button>
        <Button
          className="h-14 min-w-0 justify-end gap-1 text-base"
          aria-label={after ? `Next song: ${after.title}` : "The end"}
          disabled={!after}
          onClick={() => go(at + 1)}
        >
          <span className="truncate">{after ? after.title : "The end"}</span>
          <ChevronRight />
        </Button>
      </div>
    </div>
  )
}
