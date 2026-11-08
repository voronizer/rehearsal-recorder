import { useRouterState } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PlayButton } from "@/components/ui/play-button"
import type { TakePage } from "../api"
import { usePlayer, useTime } from "../takes/player/one"
import { StarButton, TakeLink } from "../takes/parts"
import { usePanel } from "./panel"
import { clock, day, quoted } from "./words"

/** Before any take is in the player. */
const NOTHING = "Press ▶ on a take to play it here."

/** ▶ in the bar: the take in the player, played or paused. */
function BarPlay({ take }: { take: TakePage | undefined }) {
  const p = usePlayer()
  return (
    <PlayButton
      look={take ? p.look : "idle"}
      name={take ? quoted(take.name) : "Take"}
      disabled={!take || p.supported === false}
      onClick={() => take && p.play(take.uid)}
      className="size-10"
    />
  )
}

/** **Mark**: the playing take's panel, with a new mark at this moment; on a phone the new mark alone. A take in the trash takes none. */
function MarkHere({ take, at }: { take: TakePage | undefined; at: number }) {
  const { open } = usePanel()
  return (
    <Button variant="outline" size="row" disabled={!take || !!take.trashed_at} onClick={() => take && open({ kind: "take", uid: take.uid, markAt: at })}>
      Mark
    </Button>
  )
}

/** Where the take is: press to move there. */
function Line({ take, at }: { take: TakePage; at: number }) {
  const p = usePlayer()
  const length = take.duration_sec || 1
  return (
    <div
      data-testid="bar-line"
      className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-muted"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        p.seek(take.uid, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * take.duration_sec)
      }}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(Math.min(at, length) / length) * 100}%` }} />
    </div>
  )
}

/**
 * The take's own page has РЭХА's player with its ▶ and **Mark**. While the
 * bar holds that take, the bar steps aside (Alex's pick A, 2026-11-02), so
 * the same buttons are not there twice; on another page it is back.
 */
function useOnItsPage(uid: string | undefined) {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const p = usePlayer()
  return !!uid && p.supported !== false && path === `/takes/${uid}`
}

/** The player along the bottom: ▶, the take and its day, the time, where it is, **Mark**, your ★. */
export function PlayerBar() {
  const p = usePlayer()
  const take = p.take
  const at = useTime(p.uid)
  const here = useOnItsPage(take?.uid)
  if (here) return null
  return (
    <footer
      aria-label="Player"
      className="grid h-16 shrink-0 items-center gap-4 border-t bg-panel px-3"
      style={{ gridTemplateColumns: "13rem minmax(0,1fr) auto" }}
    >
      {/* Before a take the words take the middle too, so they stay on one line. */}
      <div className={cn("flex min-w-0 items-center gap-3 pl-1", !take && "col-span-2")}>
        <BarPlay take={take} />
        {take ? (
          <div className="min-w-0">
            <TakeLink take={take} />
            <div className="text-xs text-muted-foreground">{day(take.date)}</div>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">{NOTHING}</span>
        )}
      </div>
      {take && (
        <div className="flex min-w-0 items-center gap-3">
          <span className="tnum text-xs text-muted-foreground" data-testid="bar-time">
            {clock(at)}
          </span>
          <Line take={take} at={at} />
          <span className="tnum text-xs text-muted-foreground">{clock(take.duration_sec)}</span>
        </div>
      )}
      <div className="flex items-center gap-2">
        <MarkHere take={take} at={at} />
        {take && <StarButton take={take} disabled={!!take.trashed_at} />}
      </div>
    </footer>
  )
}

/** On a phone: a thin line of where the take is, ▶, the take, the time, **Mark**. */
export function PhoneBar() {
  const p = usePlayer()
  const take = p.take
  const at = useTime(p.uid)
  const length = take?.duration_sec || 1
  return (
    <footer aria-label="Player" className="relative shrink-0 border-t bg-panel">
      {take && (
        // The line is thin; the strip a finger presses to move is 24 px tall.
        <div
          data-testid="phone-line"
          className="absolute inset-x-0 -top-3 z-10 h-6 cursor-pointer touch-none"
          onPointerDown={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            p.seek(take.uid, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * take.duration_sec)
          }}
        >
          <div className="absolute inset-x-0 top-[11px] h-0.5 bg-muted" />
          <div className="absolute top-[11px] left-0 h-0.5 bg-primary" style={{ width: `${(Math.min(at, length) / length) * 100}%` }} />
        </div>
      )}
      <div className="flex h-14 items-center gap-3 px-3">
        <BarPlay take={take} />
        {take ? (
          <>
            <TakeLink take={take} className="min-w-0" />
            <span className="tnum flex-1 text-xs text-muted-foreground" data-testid="bar-time">
              {clock(at)} / {clock(take.duration_sec)}
            </span>
          </>
        ) : (
          <span className="flex-1 text-xs text-muted-foreground">{NOTHING}</span>
        )}
        <MarkHere take={take} at={at} />
      </div>
    </footer>
  )
}
