import { Link } from "@tanstack/react-router"
import { ChevronRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { usePeaks, useTake, type TakePage } from "../api"
import { TakeMarks } from "../marks/MarkItem"
import { Group, Groups, Note, Rows } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { clock } from "../shell/words"
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
  return <Wave take={{ ...take, shape: joined }} height={26} className={cn("flex-1", !heard && "opacity-40")} />
}

/**
 * A lane per track with M and S, as РЭХА's player has them. They work on
 * the take in the player: for another take they wait until it plays.
 */
export function Lanes({ take }: { take: TakePage }) {
  const p = usePlayer()
  const here = p.uid === take.uid && p.take?.gen === take.gen
  return (
    <Rows>
      {take.tracks.map((t, i) => {
        const heard = here ? p.sounds(i) : true
        return (
          <div key={t.position} role="group" aria-label={t.name} data-heard={heard} className="flex items-center gap-3">
            <span className={cn("w-16 shrink-0 truncate", !heard && "text-muted-foreground line-through")}>{t.name}</span>
            <Toggle size="lane" variant="outline" disabled={!here} pressed={here && p.muted.includes(i)} onPressedChange={() => p.mute(i)} aria-label={`Mute ${t.name}`}>
              M
            </Toggle>
            <Toggle size="lane" variant="outline" disabled={!here} pressed={here && p.solo === i} onPressedChange={() => p.soloOne(i)} aria-label={`Solo ${t.name}`}>
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
      <Wave take={take} height={height} starred={take.stars.length > 0} />
      <div className="flex items-center gap-3">
        <Play take={take} />
        <span data-testid="clock" className="tnum text-xs text-muted-foreground">
          {clock(at)} / {clock(take.duration_sec)}
        </span>
      </div>
    </div>
  )
}

/** The take's panel: its player, Tracks folded, Marks. */
export function TakePanel({ uid, markAt }: { uid: string; markAt?: number }) {
  const { close } = usePanel()
  const take = useTake(uid)
  if (take.error) return <Note>{take.error.message}</Note>
  if (!take.data) return null
  const t = take.data
  return (
    <div className="flex flex-col gap-6" aria-label={t.name}>
      <div className="flex items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 truncate text-lg font-semibold">
          <TakeName take={t} />
        </h2>
        <StarButton take={t} who disabled={!!t.trashed_at} />
        <Button asChild variant="outline" size="row">
          <Link to="/takes/$uid" params={{ uid }} onClick={close}>
            Take's page
            <ChevronRight />
          </Link>
        </Button>
        <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
          <X />
        </Button>
      </div>
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
