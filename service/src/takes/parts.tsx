import type { CSSProperties, ReactNode, Ref } from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { Star } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button, OPENS } from "@/components/ui/button"
import { Item } from "@/components/ui/item"
import { MarkLine } from "@/components/ui/mark"
import { PlayButton } from "@/components/ui/play-button"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCut, WholeTip } from "@/components/ui/whole"
import { labelLook } from "@/lib/labels"
import { cn } from "@/lib/utils"
import { useFrame, useLabels, useMe, usePeople, useStar, type Label } from "../api"
import { usePanel } from "../shell/panel"
import { BARE } from "../shell/parts"
import { clock, quoted, songAndNumber, takeText, type TakeNaming } from "../shell/words"
import { useLookOf, usePlayer, useTime } from "./player/one"
import { TakeMenu } from "./TakeMenu"

/** What every take is drawn from, in a list and on its own. */
export type TakeLike = {
  uid: string
  name: string
  number: number
  duration_sec: number
  shape: number[]
  stars: { member_id: string; initial: string; name: string }[]
  marks: { id: number; at: number; label_id: number; note: string; closed: boolean }[]
  song_id?: number | null
  song?: { id: number } | null
  moved?: boolean
}

/** The band's labels by id; a label not read yet is drawn as the first. */
export function useLabelOf() {
  const labels = useLabels().data ?? []
  return (id: number): Label => labels.find((l) => l.id === id) ?? labels[0] ?? { id: 0, name: "Mark", colour: "grey", position: 0, marks: 0 }
}

/** A label's colour as CSS, for what is drawn in SVG. */
export const colourCss = (l: Label) => `var(${labelLook(l.colour).cssVar})`

/**
 * “Viasna #12”: the song's title, then # and the take's number a shade
 * lighter. A take with no song reads the same way, “Take #47”. `short`,
 * where the song is written beside it: “#12” alone. A long title gives way
 * and the number stays, so two takes of one song never read the same.
 * `wrap`: a heading's, the whole name over as many lines as it takes. A take
 * moved to another song here is the song's title alone until РЭХА numbers
 * it, and one taken out of its song is “Take” alone; a heading says so.
 */
export function TakeName({
  take,
  short,
  wrap,
  className,
  titleRef,
}: {
  take: TakeNaming
  short?: boolean
  wrap?: boolean
  className?: string
  /** On the title, the part that is cut where there is no room. */
  titleRef?: Ref<HTMLSpanElement>
}) {
  const parts = songAndNumber(take)
  const title = parts?.song ?? take.name
  if (wrap)
    return (
      <span className={cn("[overflow-wrap:anywhere]", className)}>
        {title}
        {parts && <span className="tnum text-muted-foreground">{"\u00a0"}#{parts.number}</span>}
        {take.moved && <span className="text-sm font-normal text-muted-foreground"> · number from РЭХА</span>}
      </span>
    )
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-baseline gap-1", className)}>
      {!(short && parts) && (
        <span ref={titleRef} className="min-w-0 truncate">
          {title}
        </span>
      )}
      {parts && <span className="tnum shrink-0 text-muted-foreground">#{parts.number}</span>}
    </span>
  )
}

/**
 * A take's name that opens its page. On that page already, it opens the
 * take's marks in the drawer: the page itself is there. `plain`: in a row
 * that lights up and opens as a whole, with no dotted line. A name cut
 * short, or `short` ("#12"), shows whole in a tip (B6).
 */
export function TakeLink({
  take,
  short,
  plain,
  className,
}: {
  take: TakeNaming & { uid: string }
  short?: boolean
  plain?: boolean
  className?: string
}) {
  const { open } = usePanel()
  const here = useRouterState({ select: (s) => s.location.pathname === `/takes/${take.uid}` })
  const [ref, cut] = useCut<HTMLSpanElement>()
  // "#12" alone says the song in the tip, as a name cut short does.
  const shortened = !!short && songAndNumber(take) !== null
  const look = cn("inline-flex min-w-0 max-w-full items-center gap-1.5 text-left", !plain && OPENS, className)
  const name = <TakeName take={take} short={short} titleRef={ref} />
  return (
    <WholeTip cut={cut || shortened} text={takeText(take)}>
      {here ? (
        <Button
          variant={plain ? "ghost" : "link"}
          aria-label={take.name}
          onClick={() => open({ kind: "marks", uid: take.uid })}
          className={cn(BARE, "whitespace-normal", look)}
        >
          {name}
        </Button>
      ) : (
        <Link to="/takes/$uid" params={{ uid: take.uid }} aria-label={take.name} className={look}>
          {name}
        </Link>
      )}
    </WholeTip>
  )
}

/** A take's ▶: the player's own look while the take is in it. */
export function Play({ take, className }: { take: { uid: string; name: string }; className?: string }) {
  const p = usePlayer()
  const look = useLookOf(take.uid)
  return <PlayButton look={look} name={quoted(take.name)} disabled={p.supported === false} onClick={() => p.play(take.uid)} className={className} />
}

/**
 * The letters a member's star shows: the first letter of their name, or the
 * first two where someone else in the band starts with the same one (Ivan
 * “Iv”, Ira “Ir”), so a phone, which has no tooltips, still tells them apart.
 */
export function useInitials() {
  const people = usePeople().data ?? []
  const first = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?"
  return (member: string, name: string, initial: string) => {
    const clash = people.some((p) => p.id !== member && first(p.name) === initial)
    if (!clash) return initial
    const [a = "?", b = ""] = Array.from(name.trim())
    return a.toUpperCase() + b.toLowerCase()
  }
}

/** Who starred the take, a circle each, the shared Avatar; two letters still fit (“Iv”, “Ir”). */
function Initials({ stars }: { stars: TakeLike["stars"] }) {
  const letters = useInitials()
  if (!stars.length) return null
  return (
    <span className="flex -space-x-1">
      {stars.map((s) => (
        <Tooltip key={s.member_id}>
          <TooltipTrigger asChild>
            <Avatar className="h-5 w-auto min-w-5 ring-2 ring-background">
              <AvatarFallback className="bg-secondary px-1 text-xs font-semibold text-foreground">{letters(s.member_id, s.name, s.initial)}</AvatarFallback>
            </Avatar>
          </TooltipTrigger>
          <TooltipContent>{s.name}</TooltipContent>
        </Tooltip>
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
  // The shared Toggle with no fill when on, as РЭХА's star: the filled star says it.
  const button = (
    <Toggle
      size="icon-row"
      pressed={mine}
      onPressedChange={(on) => star.mutate({ uid: take.uid, on })}
      aria-label={mine ? `Take back your star from ${quoted(take.name)}` : `Star ${quoted(take.name)}`}
      disabled={!me || disabled || star.isPending}
      className="dark:not-data-[state=on]:hover:bg-accent/50 data-[state=on]:bg-transparent data-[state=on]:hover:bg-accent dark:data-[state=on]:hover:bg-accent/50"
    >
      <Star className={cn("size-4", mine ? "fill-current text-signal" : "text-muted-foreground")} />
    </Toggle>
  )
  return (
    <span className="flex items-center gap-0.5">
      {names ? (
        // The tip is on a box round the star, so it shows while the star
        // cannot be pressed too (in Trash, signed out, while it is saved).
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex">{button}</span>
          </TooltipTrigger>
          <TooltipContent>Starred by {names}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
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
 * colours, the playhead. In a take's player (`moves`) a press moves the
 * playhead, as in РЭХА; in a list it has no press of its own, and its row
 * opens the take's page (Alex, 2026-11-10). A starred take's wave is
 * green, as РЭХА's bar has a green edge.
 */
export function Wave({
  take,
  height = 40,
  starred,
  moves,
  className,
  style,
}: {
  take: TakeLike
  height?: number
  starred?: boolean
  moves?: boolean
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
      className={cn("relative min-w-0 py-[3px]", moves && "cursor-crosshair", className)}
      style={{ ...style, height }}
      // A press, not a touch: a finger landing on a wave still scrolls the list.
      onClick={
        moves
          ? (e) => {
              const r = e.currentTarget.getBoundingClientRect()
              p.seek(take.uid, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * take.duration_sec)
            }
          : undefined
      }
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
                  ? // On a dark card the lighter green would sink into it.
                    "fill-signal/55 dark:fill-signal/80"
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
  // design-ok(radius): the marker's diamond on the waveform, a graphic that keeps its own corner
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rotate-45 rounded-[2px]", className)} style={{ background: colour }} />
}

/** The room after the longest take's wave, in rem: its length and the gap. */
const AFTER_WAVE = 3

/**
 * What a press in a row does by itself: none of these is the row. A box
 * marked `data-own-press` holds a row's own buttons: a press on one greyed
 * out goes through it to its box, which is not the row either.
 */
export const OWN_PRESS = "button, a, [role=menuitem], input, [data-own-press]"

/** A row's own buttons in a box of their own (OWN_PRESS), with the arrow round them. */
export function OwnPress({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span data-own-press className={cn("flex cursor-default items-center", className)}>
      {children}
    </span>
  )
}

/**
 * One take as a row: ▶, its name on a line of its own, and under it the
 * wave to scale with its marks (green when it has stars) and its length;
 * your star. A press anywhere in the row but ▶, the star and ⋯ opens the
 * take's page (Alex, 2026-11-10). The name has the row's whole width and
 * the wave all of it but its length's room (Alex's pick B, 2026-11-04): a
 * fixed column cut the name while the wave had room to spare. `marks`
 * lists its marks under it, each a line that plays from there.
 */
export function TakeLine({ take, marks, short, after }: { take: TakeLike; marks?: boolean; short?: boolean; after?: ReactNode }) {
  const p = usePlayer()
  const navigate = useNavigate()
  const longest = useFrame().data?.longest || take.duration_sec || 1
  const labelOf = useLabelOf()
  return (
    <div className="flex flex-col gap-0.5" data-take={take.name}>
      <Item
        className="-mx-2 grid cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-0 gap-x-3 rounded-lg border-0 px-2 py-1.5 hover:bg-accent/60"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest(OWN_PRESS)) return
          // A press inside a menu drawn over the row is the menu's.
          if (!e.currentTarget.contains(e.target as Node)) return
          void navigate({ to: "/takes/$uid", params: { uid: take.uid } })
        }}
      >
        <OwnPress>
          <Play take={take} />
        </OwnPress>
        <div className="flex min-w-0 flex-col gap-0.5 overflow-x-clip">
          <TakeLink take={take} short={short} plain className="self-start" />
          <div className="flex min-w-0 items-center gap-2.5">
            <Wave
              take={take}
              height={28}
              starred={take.stars.length > 0}
              className="min-w-8"
              // Of the row less the length's room, so every row's is to one scale.
              style={{ width: `calc((100% - ${AFTER_WAVE}rem) * ${Math.min(take.duration_sec, longest) / longest})` }}
            />
            <span className="tnum shrink-0 text-sm text-muted-foreground">{clock(take.duration_sec)}</span>
            {after}
          </div>
        </div>
        <OwnPress className="gap-1">
          <StarButton take={take} />
          <TakeMenu take={take} row />
        </OwnPress>
      </Item>
      {marks &&
        take.marks.map((k) => (
          <Button
            key={k.id}
            variant="ghost"
            onClick={() => p.seek(take.uid, k.at)}
            className={cn(
              "ml-9 h-auto min-w-0 justify-start gap-2 rounded-md border-0 px-2 py-1 text-left hover:bg-accent/60 dark:hover:bg-accent/60",
              k.closed && "opacity-60"
            )}
          >
            <MarkLine variant="service" label={labelOf(k.label_id)} at={k.at} note={k.note} />
          </Button>
        ))}
    </div>
  )
}
