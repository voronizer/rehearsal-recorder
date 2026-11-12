import { useState } from "react"
import { useRouterState } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PlayButton } from "@/components/ui/play-button"
import { Slider } from "@/components/ui/slider"
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
    <Button variant="outline" size="row" disabled={!take || !!take.trashed_at} onClick={() => take && open({ kind: "mark", uid: take.uid, at })}>
      Mark
    </Button>
  )
}

/** The bar's keys, in seconds; with Shift an arrow moves ten, as Page Up and Page Down do. */
const KEY_SECONDS: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }

/** The bar's own step, in seconds: fine enough that a press or a drag lands where it is, as before the Slider. */
const FINE = 0.01

/**
 * Where the take is (S5), the shared Slider drawn as the bar: a press or a
 * drag moves the take there as it is let go, the thumb following the
 * pointer till then, since a seek starts every track again. Once it has
 * the focus, ← and → move the take a second at once, with Shift ten, and
 * Home and End go to its ends. A screen reader hears the take's name and
 * where it is, “0:05 of 3:12”.
 */
function Line({ take, at, className, trackClassName, ...rest }: { take: TakePage; at: number; className?: string; trackClassName?: string; "data-testid": string }) {
  const p = usePlayer()
  const length = take.duration_sec || 1
  const now = Math.min(at, length)
  // Where the thumb is while the bar is pressed.
  const [held, setHeld] = useState<number | null>(null)
  const shown = held ?? now
  const seek = (to: number) => p.seek(take.uid, Math.max(0, Math.min(length, to)))
  return (
    <Slider
      {...rest}
      variant="bar"
      min={0}
      max={length}
      step={FINE}
      value={[shown]}
      onValueChange={([to]) => setHeld(to)}
      onValueCommit={([to]) => {
        setHeld(null)
        seek(to)
      }}
      // Let go where it was pressed, nothing is committed: the thumb goes back to the take all the same.
      onLostPointerCapture={() => setHeld(null)}
      // The keys move the take at once, by whole seconds, and the Slider's own handler is skipped:
      // it would step by its fine step, and Home and End would leave the thumb held.
      onKeyDown={(e) => {
        const by = KEY_SECONDS[e.key]
        const to = e.key === "Home" ? 0 : e.key === "End" ? length : by === undefined ? null : now + (e.shiftKey && Math.abs(by) === 1 ? by * 10 : by)
        if (to === null) return
        e.preventDefault()
        seek(to)
      }}
      aria-label={take.name}
      aria-valuetext={`${clock(shown)} of ${clock(take.duration_sec)}`}
      className={cn("cursor-pointer", className)}
      trackClassName={trackClassName}
    />
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
          <Line data-testid="bar-line" take={take} at={at} className="flex-1" />
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
  return (
    <footer aria-label="Player" className="relative shrink-0 border-t bg-panel">
      {take && (
        // The line is thin; the strip a finger presses to move is 24 px tall.
        <Line
          data-testid="phone-line"
          take={take}
          at={at}
          className="absolute inset-x-0 -top-3 z-10 h-6"
          trackClassName="rounded-none data-[orientation=horizontal]:h-0.5 [&>span]:rounded-none"
        />
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
