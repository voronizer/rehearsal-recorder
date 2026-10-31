import { useEffect, useRef, type PointerEvent } from "react"
import { useParams, useSearch } from "@tanstack/react-router"
import { Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PlayButton } from "@/components/ui/play-button"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { useMe, usePeaks, useRestore, useSeen, useStar, useTake, type TakePage } from "../api"
import { Note, PageHead, Stars } from "../shell/parts"
import { clock, count, longDay, quoted } from "../shell/words"
import { colourOf } from "./colours"
import { Comments } from "./Comments"
import { Downloads } from "./Downloads"
import { CANNOT_PLAY, usePlayer } from "./player/usePlayer"

/**
 * A take's page: its name and stars, a lane for each track with M and S as
 * РЭХА's player has them, one ▶ for all of them, the marks and comments,
 * and the tracks to download.
 */
export function Take() {
  const { uid } = useParams({ from: "/band/takes/$uid" })
  const { at } = useSearch({ from: "/band/takes/$uid" })
  const take = useTake(uid)
  const seen = useSeen(uid)
  // Opening the take is what makes it, and its comments, no longer new.
  const opened = useRef("")
  useEffect(() => {
    if (!take.data || opened.current === uid) return
    opened.current = uid
    seen.mutate()
  }, [take.data, uid, seen])

  if (take.error) return <Note>{take.error.message}</Note>
  if (!take.data) return null
  // A new page for each take, so its player and M and S start afresh.
  return <Page key={uid} take={take.data} start={at ?? 0} />
}

function Page({ take, start }: { take: TakePage; start: number }) {
  const player = usePlayer(take, start)
  const song = take.song
  return (
    <>
      <PageHead
        path={[
          song
            ? { label: song.title, to: { to: "/songs/$id", params: { id: String(song.id) } } }
            : { label: "Not named", to: { to: "/songs/$id", params: { id: "not-named" } } },
          { label: take.name },
        ]}
      />
      <div className="flex max-w-4xl flex-col gap-4 p-4 md:p-5">
        <Head take={take} />
        {take.trashed_at && <InTrash uid={take.uid} />}
        <section aria-label="Tracks" className="flex flex-col gap-2 rounded-xl bg-card p-3">
          {take.tracks.map((t, i) => (
            <div key={t.position} role="group" aria-label={t.name} data-heard={player.heard(i)} className="flex items-center gap-3">
              <span className="flex w-28 shrink-0 items-center gap-1 md:w-36">
                <span className={cn("min-w-0 flex-1 truncate text-sm", !player.heard(i) && "text-muted-foreground line-through")}>
                  {t.name}
                </span>
                <Toggle size="icon-row" className="size-7 text-xs font-semibold" aria-label={`Mute ${t.name}`} pressed={player.muted.includes(i)} onPressedChange={() => player.mute(i)}>
                  M
                </Toggle>
                <Toggle size="icon-row" className="size-7 text-xs font-semibold" aria-label={`Solo ${t.name}`} pressed={player.solo === i} onPressedChange={() => player.soloOne(i)}>
                  S
                </Toggle>
              </span>
              <Wave take={take} peaks={t.peaks} at={player.time} heard={player.heard(i)} onSeek={player.seek} />
            </div>
          ))}
          <div className="flex items-center gap-3 pt-1">
            {player.supported === false ? (
              <p className="text-sm text-muted-foreground">{CANNOT_PLAY}</p>
            ) : (
              <PlayButton
                size="head"
                look={player.look}
                name={quoted(take.name)}
                disabled={!player.supported || take.tracks.length === 0}
                onClick={player.toggle}
              />
            )}
            <span data-testid="clock" className="text-sm tnum">
              {clock(player.time)} <span className="text-muted-foreground">/ {clock(take.duration_sec)}</span>
            </span>
          </div>
        </section>
        <Comments take={take} at={player.time} onSeek={player.seek} />
        <Downloads take={take} />
      </div>
    </>
  )
}

/** The name, the day, the length; your ★, who starred it, and the ★ from РЭХА. */
function Head({ take }: { take: TakePage }) {
  const star = useStar(take.uid)
  const me = useMe()
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{take.name}</h1>
        <p className="text-xs text-muted-foreground">
          {longDay(take.date)} · {clock(take.duration_sec)} · {count(take.tracks.length, "track")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {take.starred_at_rehearsal && (
          <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">★ at rehearsal</span>
        )}
        <span className="flex items-center gap-1.5 rounded-md bg-card px-1.5 py-1">
          <Button
            variant="ghost"
            size="icon-row"
            aria-label={`Star ${quoted(take.name)}`}
            aria-pressed={take.starred_by_me}
            disabled={!me.data || !!take.trashed_at || star.isPending}
            onClick={() => star.mutate(!take.starred_by_me)}
            className={take.starred_by_me ? "text-signal hover:text-signal" : "text-muted-foreground"}
          >
            <Star className={cn(take.starred_by_me && "fill-current")} />
          </Button>
          <Stars stars={take.stars} />
        </span>
      </div>
    </div>
  )
}

function InTrash({ uid }: { uid: string }) {
  const restore = useRestore()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm">
      <span>This take is in the trash. It is deleted for good 30 days after it was put there.</span>
      <Button size="row" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(uid)}>
        Restore
      </Button>
    </div>
  )
}

/** Bars drawn from a waveform's 1200 numbers. */
const BARS = 240

function bars(peaks: number[]): number[] {
  const step = peaks.length / BARS
  return Array.from({ length: BARS }, (_, i) => {
    let top = 0
    for (let k = Math.floor(i * step); k < Math.floor((i + 1) * step); k++) top = Math.max(top, peaks[k] ?? 0)
    return Math.max(0.04, Math.min(1, top))
  })
}

/** A track's waveform with the marks across it and the playhead; a tap moves the playhead there. */
function Wave({
  take,
  peaks,
  at,
  heard,
  onSeek,
}: {
  take: TakePage
  peaks: string
  at: number
  heard: boolean
  onSeek: (at: number) => void
}) {
  const shape = usePeaks(peaks)
  const height = 46
  const length = take.duration_sec || 1
  const x = (sec: number) => (Math.min(sec, length) / length) * BARS
  const seek = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * take.duration_sec)
  }
  return (
    <div data-testid="wave" onPointerDown={seek} className="min-w-0 flex-1 cursor-pointer touch-none">
      <svg viewBox={`0 0 ${BARS} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden="true">
        {(shape.data ? bars(shape.data) : []).map((v, i) => (
          <rect
            key={i}
            x={i + 0.15}
            width={0.7}
            y={(height * (1 - v)) / 2}
            height={height * v}
            className={!heard ? "fill-muted-foreground/30" : i < x(at) ? "fill-primary" : "fill-muted-foreground/60"}
          />
        ))}
        {take.comments.map((c) => (
          <line key={c.id} x1={x(c.at)} x2={x(c.at)} y1={0} y2={height} strokeWidth={0.4} className={colourOf(c.colour).line} />
        ))}
        <line x1={x(at)} x2={x(at)} y1={0} y2={height} strokeWidth={0.6} className="stroke-foreground" />
      </svg>
    </div>
  )
}
