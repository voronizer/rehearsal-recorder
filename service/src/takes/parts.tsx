import type { CSSProperties, ReactNode } from "react"
import { Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { LabelDot } from "@/components/ui/mark"
import { PlayButton } from "@/components/ui/play-button"
import { labelLook } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { useFrame, useLabels, useMe, useStar, type Label } from "../api"
import { Dot } from "../shell/parts"
import { usePanel } from "../shell/panel"
import { clock, quoted } from "../shell/words"
import { useLookOf, usePlayer, useTime } from "./player/one"

/** What every take is drawn from, in a list and on its own. */
export type TakeLike = {
  uid: string
  name: string
  number: number
  duration_sec: number
  shape: number[]
  stars: { member_id: string; initial: string; name: string }[]
  is_new?: boolean
  marks: { id: number; at: number; label_id: number; note: string; closed: boolean }[]
}

/** The band's labels by id; a label not read yet is drawn as the first. */
export function useLabelOf() {
  const labels = useLabels().data ?? []
  return (id: number): Label => labels.find((l) => l.id === id) ?? labels[0] ?? { id: 0, name: "Mark", colour: "grey", position: 0, marks: 0 }
}

/** A label's colour as CSS, for what is drawn in SVG. */
export const colourCss = (l: Label) => `var(${labelLook(l.colour).cssVar})`

/** “Viasna 12” as РЭХА writes a take: the song's title, then the number a shade lighter. `short`: the number alone. */
export function TakeName({ take, short, className }: { take: { name: string; number: number }; short?: boolean; className?: string }) {
  const end = ` ${take.number}`
  const title = take.name.endsWith(end) ? take.name.slice(0, -end.length) : take.name
  const split = title !== take.name
  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      {!(short && split) && title}
      {split && <span className="tnum text-muted-foreground">{take.number}</span>}
    </span>
  )
}

/** A take's name that opens its panel. */
export function TakeLink({ take, short, className }: { take: TakeLike; short?: boolean; className?: string }) {
  const { open } = usePanel()
  return (
    <button
      type="button"
      title={take.name}
      aria-label={take.name}
      onClick={() => open({ kind: "take", uid: take.uid })}
      className={cn("inline-flex min-w-0 items-center gap-1.5 truncate text-left underline-offset-4 hover:underline", className)}
    >
      <TakeName take={take} short={short} />
      {take.is_new && <Dot />}
    </button>
  )
}

/** A take's ▶: the player's own look while the take is in it. */
export function Play({ take, className }: { take: { uid: string; name: string }; className?: string }) {
  const p = usePlayer()
  const look = useLookOf(take.uid)
  return <PlayButton look={look} name={quoted(take.name)} disabled={p.supported === false} onClick={() => p.play(take.uid)} className={className} />
}

function Initials({ stars }: { stars: TakeLike["stars"] }) {
  if (!stars.length) return null
  return (
    <span className="flex -space-x-1">
      {stars.map((s) => (
        <span key={s.member_id} title={s.name} className="flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold ring-2 ring-background">
          {s.initial}
        </span>
      ))}
    </span>
  )
}

/**
 * Your own star: press to give the take yours, press again to take it back.
 * Beside it how many stars the take has; who gave them shows in full on the
 * take's panel and page (`who`), and in a tooltip elsewhere.
 */
export function StarButton({ take, who, disabled }: { take: TakeLike; who?: boolean; disabled?: boolean }) {
  const me = useMe().data
  const star = useStar()
  const mine = !!me && take.stars.some((s) => s.member_id === me.id)
  const names = take.stars.map((s) => s.name).join(", ")
  return (
    <span className="flex items-center gap-0.5" title={names ? `Starred by ${names}` : undefined}>
      <Button
        variant="ghost"
        size="icon-row"
        aria-pressed={mine}
        aria-label={mine ? `Take back your star from ${quoted(take.name)}` : `Star ${quoted(take.name)}`}
        disabled={!me || disabled || star.isPending}
        onClick={() => star.mutate({ uid: take.uid, on: !mine })}
      >
        <Star className={cn("size-4", mine ? "fill-current text-signal" : "text-muted-foreground")} />
      </Button>
      {who ? <Initials stars={take.stars} /> : <span className="tnum w-3 text-xs text-muted-foreground">{take.stars.length || ""}</span>}
    </span>
  )
}

/** A wave drawn from 120 values, or a flat line when РЭХА sent none. */
function bars(shape: number[]): number[] {
  return shape.length ? shape.map((v) => Math.max(0.08, Math.min(1, v))) : Array.from({ length: 120 }, () => 0.08)
}

/**
 * A take's wave: the part played darker, its marks as diamonds in their
 * colours, the playhead. Press it to play from there. A starred take's wave
 * is green, as РЭХА's bar has a green edge.
 */
export function Wave({
  take,
  height = 40,
  starred,
  className,
  style,
}: {
  take: TakeLike
  height?: number
  starred?: boolean
  className?: string
  style?: CSSProperties
}) {
  const p = usePlayer()
  const at = useTime(take.uid)
  const labelOf = useLabelOf()
  const b = bars(take.shape)
  const n = b.length
  const length = take.duration_sec || 1
  const here = p.uid === take.uid
  return (
    <div
      data-testid="wave"
      className={cn("relative min-w-0 cursor-pointer touch-none py-[3px]", className)}
      style={{ ...style, height }}
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        p.seek(take.uid, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * take.duration_sec)
      }}
    >
      <svg viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="size-full" aria-hidden="true">
        {b.map((v, i) => (
          <rect
            key={i}
            x={i + 0.2}
            y={50 - v * 46}
            width={0.6}
            height={v * 92}
            rx={0.3}
            className={
              here && (i + 1) / n <= at / length
                ? starred
                  ? "fill-signal"
                  : "fill-foreground/70"
                : starred
                  ? "fill-signal/55"
                  : "fill-muted-foreground/45"
            }
          />
        ))}
      </svg>
      {take.marks.map((k) => {
        const colour = colourCss(labelOf(k.label_id))
        return (
          <span
            key={k.id}
            className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2"
            style={{ left: `${(Math.min(k.at, length) / length) * 100}%`, background: colour }}
          >
            <Diamond colour={colour} className="absolute -top-1 left-1/2 -translate-x-1/2" />
          </span>
        )
      })}
      {here && <span className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: `${(Math.min(at, length) / length) * 100}%` }} />}
    </div>
  )
}

/** A mark's diamond, as on the wave. */
export function Diamond({ colour, className }: { colour: string; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rotate-45 rounded-[2px]", className)} style={{ background: colour }} />
}

/** РЭХА's rehearsal overview gives the longest take this share of the row. */
const SHARE = 88

/**
 * One take as a row: ▶, its name (opens the take's panel), its wave to
 * scale with its marks (green when it has stars; press it to play from
 * there), its length, your star. `marks` lists its marks under it, each a
 * line that plays from there.
 */
export function TakeLine({ take, marks, short, after }: { take: TakeLike; marks?: boolean; short?: boolean; after?: ReactNode }) {
  const p = usePlayer()
  const longest = useFrame().data?.longest || take.duration_sec || 1
  const labelOf = useLabelOf()
  return (
    <div className="flex flex-col gap-0.5" data-take={take.name}>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3">
        <Play take={take} />
        <div className="flex min-w-0 items-center gap-2.5">
          <TakeLink take={take} short={short} className="w-24 shrink-0" />
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Wave
              take={take}
              height={28}
              starred={take.stars.length > 0}
              className="min-w-12"
              style={{ width: `${(Math.min(take.duration_sec, longest) / longest) * SHARE}%` }}
            />
            <span className="tnum shrink-0 text-sm text-muted-foreground">{clock(take.duration_sec)}</span>
            {after}
          </div>
        </div>
        <StarButton take={take} />
      </div>
      {marks &&
        take.marks.map((k) => (
          <button
            key={k.id}
            type="button"
            onClick={() => p.seek(take.uid, k.at)}
            className={cn("ml-9 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent/60", k.closed && "opacity-60")}
          >
            <LabelDot colour={labelOf(k.label_id).colour} />
            <span className="tnum shrink-0 text-muted-foreground">{clock(k.at)}</span>
            <span className="truncate">{k.note || labelOf(k.label_id).name}</span>
          </button>
        ))}
    </div>
  )
}
