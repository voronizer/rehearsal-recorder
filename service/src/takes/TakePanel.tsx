import type { ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { usePeaks, useTake, type TakePage } from "../api"
import { TakeMarks } from "../marks/MarkItem"
import { Group, Groups, OPENS, Trouble, Waiting } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { clock, longDay } from "../shell/words"
import { usePlayer, useTime } from "./player/one"
import { Play, StarButton, TakeName, Wave } from "./parts"
import { SongWord } from "./move"
import { TakeMenu } from "./TakeMenu"

/** A track's own wave from РЭХА's 1200 numbers, at the 120 a lane draws. */
function TrackWave({ take, peaks, heard }: { take: TakePage; peaks: string; heard: boolean }) {
  const shape = usePeaks(peaks)
  const values = shape.data ?? []
  const step = values.length / 120
  const joined = values.length
    ? Array.from({ length: 120 }, (_, i) => {
        let top = 0
        for (let k = Math.floor(i * step); k < Math.floor((i + 1) * step); k++) top = Math.max(top, values[k] ?? 0)
        return top
      })
    : []
  return <Wave take={{ ...take, shape: joined }} height={26} moves className={cn("flex-1", !heard && "opacity-40")} />
}

/**
 * A lane per track with M and S, as РЭХА's player has them. They work
 * whether the take plays or not: pressed before ▶, they sound from it.
 * The names are a column as wide as the longest, up to 40 % of the row
 * (Alex's pick B, 2026-11-04), so M and S stand one under another.
 */
export function Lanes({ take }: { take: TakePage }) {
  const p = usePlayer()
  const desk = p.deskOf(take.uid)
  return (
    <div className="grid grid-cols-[fit-content(40%)_auto_auto_minmax(0,1fr)] gap-x-3 gap-y-2">
      {take.tracks.map((t, i) => {
        const heard = p.sounds(take.uid, i)
        return (
          <div key={t.position} role="group" aria-label={t.name} data-heard={heard} className="col-span-full grid grid-cols-subgrid items-center">
            <span className={cn("min-w-0 truncate", !heard && "text-muted-foreground line-through")}>{t.name}</span>
            <Toggle size="lane" variant="outline" tone="mute" pressed={desk.muted.includes(i)} onPressedChange={() => p.mute(take.uid, i)} aria-label={`Mute ${t.name}`}>
              M
            </Toggle>
            <Toggle size="lane" variant="outline" tone="solo" pressed={desk.solo === i} onPressedChange={() => p.soloOne(take.uid, i)} aria-label={`Solo ${t.name}`}>
              S
            </Toggle>
            <TrackWave take={take} peaks={t.peaks} heard={heard} />
          </div>
        )
      })}
    </div>
  )
}

/**
 * The take's player on one line: ▶ on the wave's level, the wave with the
 * time in its corner (Alex, 2026-11-04: «На волне»), and `star` at the end.
 */
export function TakePlayer({ take, height = 64, star }: { take: TakePage; height?: number; star?: ReactNode }) {
  const at = useTime(take.uid)
  return (
    <div className="flex items-center gap-3">
      <Play take={take} />
      <div className="relative min-w-0 flex-1">
        <Wave take={take} height={height} starred={take.stars.length > 0} moves />
        <span
          data-testid="clock"
          className="tnum pointer-events-none absolute right-0 bottom-0 rounded bg-background/85 px-1 text-xs leading-4 text-muted-foreground"
        >
          {clock(at)} / {clock(take.duration_sec)}
        </span>
      </div>
      {star}
    </div>
  )
}

/** The take's panel: its rehearsal and song, its player, Tracks folded, Marks. */
export function TakePanel({ uid, markAt }: { uid: string; markAt?: number }) {
  const { open, close } = usePanel()
  const take = useTake(uid)
  if (take.error) return <Trouble error={take.error} retry={() => void take.refetch()} />
  if (!take.data) return <Waiting />
  const t = take.data
  return (
    <div className="flex flex-col gap-6" aria-label={t.name}>
      {/* The name opens the take's page and wraps when long (Alex's pick D, 2026-11-04); the star is by the player. */}
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 py-0.5 text-lg font-semibold">
          <Link to="/takes/$uid" params={{ uid }} className={OPENS}>
            <TakeName take={t} wrap />
          </Link>
        </h2>
        {!t.trashed_at && <TakeMenu take={t} onGone={close} />}
        <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>
      {/* Where the take comes from: its rehearsal's page, its song's panel. */}
      <p className="-mt-4 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
        <Link to="/rehearsals/$uid" params={{ uid: t.rehearsal.uid }} className={OPENS}>
          {longDay(t.date)}
        </Link>
        <SongWord take={t}>
          {t.song && (
            <>
              <span>·</span>
              <button type="button" className={OPENS} onClick={() => open({ kind: "song", id: t.song!.id })}>
                {t.song.title}
              </button>
            </>
          )}
        </SongWord>
      </p>
      <Groups>
        <Group>
          <TakePlayer take={t} star={<StarButton take={t} who disabled={!!t.trashed_at} />} />
        </Group>
        <Group title="Tracks" hint={String(t.tracks.length)} fold="closed">
          <Lanes take={t} />
        </Group>
        <TakeMarks take={t} markAt={markAt} />
      </Groups>
    </div>
  )
}
