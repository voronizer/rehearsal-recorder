import { Link } from "@tanstack/react-router"
import { ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { usePeaks, useTake, type TakePage } from "../api"
import { TakeMarks } from "../marks/MarkItem"
import { Group, Groups, OPENS, Rows, Trouble, Waiting } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { clock, longDay } from "../shell/words"
import { usePlayer, useTime } from "./player/one"
import { Play, StarButton, TakeName, Wave } from "./parts"

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
 */
export function Lanes({ take }: { take: TakePage }) {
  const p = usePlayer()
  const desk = p.deskOf(take.uid)
  return (
    <Rows>
      {take.tracks.map((t, i) => {
        const heard = p.sounds(take.uid, i)
        return (
          <div key={t.position} role="group" aria-label={t.name} data-heard={heard} className="flex items-center gap-3">
            <span className={cn("w-16 shrink-0 truncate", !heard && "text-muted-foreground line-through")}>{t.name}</span>
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
    </Rows>
  )
}

/** The take's wave with ▶ and the time under it. */
export function TakePlayer({ take, height = 64 }: { take: TakePage; height?: number }) {
  const at = useTime(take.uid)
  return (
    <div className="flex flex-col gap-2">
      <Wave take={take} height={height} starred={take.stars.length > 0} moves />
      <div className="flex items-center gap-3">
        <Play take={take} />
        <span data-testid="clock" className="tnum text-xs text-muted-foreground">
          {clock(at)} / {clock(take.duration_sec)}
        </span>
      </div>
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
      <div className="flex items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold">
          <TakeName take={t} />
        </h2>
        <StarButton take={t} who disabled={!!t.trashed_at} />
        <Button asChild variant="outline" size="row">
          <Link to="/takes/$uid" params={{ uid }}>
            Take's page
            <ChevronRight />
          </Link>
        </Button>
        <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>
      {/* Where the take comes from: its rehearsal's page, its song's panel. */}
      <p className="-mt-4 flex flex-wrap items-baseline gap-x-1.5 text-xs text-muted-foreground">
        <Link to="/rehearsals/$uid" params={{ uid: t.rehearsal.uid }} className={OPENS}>
          {longDay(t.date)}
        </Link>
        {t.song && (
          <>
            <span>·</span>
            <button type="button" className={OPENS} onClick={() => open({ kind: "song", id: t.song!.id })}>
              {t.song.title}
            </button>
          </>
        )}
      </p>
      <Groups>
        <Group>
          <TakePlayer take={t} />
        </Group>
        <Group title="Tracks" hint={String(t.tracks.length)} fold="closed">
          <Lanes take={t} />
        </Group>
        <TakeMarks take={t} markAt={markAt} />
      </Groups>
    </div>
  )
}
