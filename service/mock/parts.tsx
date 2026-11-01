import { Children, createContext, Fragment, useContext, type CSSProperties, type ReactNode } from "react"
import { ChevronRight, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { useAt, usePanel, usePlayer, useWide } from "./context"
import { fmt, isNew, marksOf, memberOf, takeOf, toggleStar, useData, type Label, type Take } from "./data"
import { LabelDot } from "@/components/ui/mark"
import { PlayButton } from "@/components/ui/play-button"
import type { Label as RehaLabel, LabelColour } from "@/lib/api"

/** "1 take", "3 takes". */
export const takesN = (n: number) => `${n} take${n === 1 ? "" : "s"}`

// ---------- groups, as РЭХА's pages: one card, its parts split by a line ----------

/** Where a group is drawn: on the page (it makes its own card), in a card, or in the panel. */
type Surface = "page" | "card" | "panel"
const SurfaceCtx = createContext<Surface>("page")
export const InPanel = ({ children }: { children: ReactNode }) => <SurfaceCtx.Provider value="panel">{children}</SurfaceCtx.Provider>

/**
 * A screen's or a panel's groups. On a page: one card (bg-card, the large
 * corner) with the groups as its parts, a line between them, as a song's
 * page in РЭХА. In a card or the panel: the parts and lines alone.
 */
export function Groups({ children, className }: { children: ReactNode; className?: string }) {
  const surface = useContext(SurfaceCtx)
  const wide = useWide()
  const items = Children.toArray(children).filter(Boolean)
  const parts = items.map((c, i) => (
    <div key={i} className={cn(surface === "panel" ? "py-5" : "py-6", i > 0 && "border-t", surface !== "page" && "first:pt-0 last:pb-0")}>
      {c}
    </div>
  ))
  if (surface !== "page") return <div className={cn("flex flex-col", className)}>{parts}</div>
  // On a phone the card would only take width from the rows: the parts and lines alone.
  return (
    <SurfaceCtx.Provider value="card">
      <div className={cn("flex flex-col", wide !== "phone" && "rounded-xl bg-card px-6", className)}>{parts}</div>
    </SurfaceCtx.Provider>
  )
}

/**
 * One group: its heading (РЭХА's 14 px semibold), a count or hint after it in
 * grey, an action at its right, then what it holds. `fold` makes the heading
 * fold the group away, for long lists and what is seldom needed; "closed"
 * starts folded. `small` is a group in a group, such as one rehearsal among a
 * song's takes. Straight on a page it makes a card of its own.
 */
export function Group({
  title,
  hint,
  action,
  fold,
  small,
  children,
}: {
  title?: string
  hint?: ReactNode
  action?: ReactNode
  fold?: "open" | "closed"
  small?: boolean
  children: ReactNode
}) {
  const surface = useContext(SurfaceCtx)
  if (surface === "page")
    return (
      <Groups>
        <Group title={title} hint={hint} action={action} fold={fold} small={small}>
          {children}
        </Group>
      </Groups>
    )
  if (!title) return <section className="flex flex-col gap-3">{children}</section>
  const heading = (
    <>
      <h2 className={cn("text-sm", small ? "font-medium" : "font-semibold")}>{title}</h2>
      {hint && <span className="truncate text-sm text-muted-foreground">{hint}</span>}
    </>
  )
  if (fold)
    return (
      <Collapsible defaultOpen={fold === "open"} className="group/fold flex flex-col">
        <div className="flex min-h-8 items-center gap-2">
          <CollapsibleTrigger asChild>
            <button type="button" className="-ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pl-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/fold:rotate-90" />
              {heading}
            </button>
          </CollapsibleTrigger>
          <span className="hidden group-data-[state=open]/fold:contents">{action}</span>
        </div>
        <CollapsibleContent className="flex flex-col gap-3 pt-2">{children}</CollapsibleContent>
      </Collapsible>
    )
  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center gap-2">
        {heading}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

/** Rows of a list, as РЭХА's: no box of their own; a row lights up under the pointer. */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children).filter(Boolean)
  return (
    <div role="list" className={cn("flex flex-col gap-0.5", className)}>
      {items.map((c, i) => (
        <div role="listitem" key={i} className="-mx-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/60">
          {c}
        </div>
      ))}
    </div>
  )
}

/** Something that is not a list. `boxed`: a form or a notice, framed in a line. */
export function Tile({ children, className, boxed }: { children: ReactNode; className?: string; boxed?: boolean }) {
  return <div className={cn("flex flex-col gap-3", boxed && "rounded-lg border p-4", className)}>{children}</div>
}

/** Two columns on a wide screen; one under another in a small window and on a phone. */
export function Columns({ main, side, sideWidth = "20rem" }: { main: ReactNode; side: ReactNode; sideWidth?: string }) {
  const wide = useWide()
  if (wide !== "wide")
    return (
      <Groups>
        {main}
        {side}
      </Groups>
    )
  return (
    <div className="grid items-start gap-10" style={{ gridTemplateColumns: `minmax(0,1fr) ${sideWidth}` }}>
      <div className="min-w-0">{main}</div>
      <div className="min-w-0">{side}</div>
    </div>
  )
}

/** A page: its heading and the line under it, then its groups. */
export function Page({ title, sub, head, children }: { title?: ReactNode; sub?: ReactNode; head?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-6">
      <header className="flex flex-col gap-1">
        {head}
        {title && <h1 className="text-xl font-semibold text-balance">{title}</h1>}
        {sub && <p className="text-muted-foreground">{sub}</p>}
      </header>
      {children}
    </div>
  )
}

/** Name and value, a line each. */
export function Props({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

// ---------- small parts, as service/src/shell/parts.tsx ----------

/** Something new for you: a take not opened yet, or a song with one. */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full bg-primary", className)} />
}

export function Diamond({ colour, className }: { colour: string; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2.5 shrink-0 rotate-45 rounded-[2px]", className)} style={{ background: colour }} />
}

/** "Viasna 12", as РЭХА writes a take: the song's title, then the number a shade lighter. `short`: the number alone. */
export function TakeName({ take, short, className }: { take: Take; short?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-baseline gap-1", className)}>
      {!(short && take.song) && (take.song ?? "Take")}
      <span className="tnum text-muted-foreground">{take.n}</span>
    </span>
  )
}

/** A take's name that opens its panel. */
/** `short` where the song is plain from what is around: the pill alone. */
export function TakeLink({ uid, short, className }: { uid: string; short?: boolean; className?: string }) {
  const data = useData()
  const { open } = usePanel()
  const t = takeOf(data, uid)
  return (
    <button type="button" onClick={() => open({ kind: "take", uid })} className={cn("inline-flex items-center gap-1.5 hover:underline underline-offset-4", className)}>
      <TakeName take={t} short={short} />
      {isNew(data, uid) && <Dot />}
    </button>
  )
}

function Initials({ ids }: { ids: string[] }) {
  const data = useData()
  if (!ids.length) return null
  return (
    <span className="flex -space-x-1">
      {ids.map((s) => (
        <span key={s} title={memberOf(data, s)?.name} className="flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold ring-2 ring-background">
          {memberOf(data, s)?.initial}
        </span>
      ))}
    </span>
  )
}

/** Who starred a take: a ★ and their first letters. */
export function Stars({ take }: { take: Take }) {
  const data = useData()
  if (!take.stars.length) return null
  return (
    <span role="img" aria-label={`Starred by ${take.stars.map((s) => memberOf(data, s)?.name).join(", ")}`} className="flex items-center gap-1">
      <Star className="size-3.5 fill-current text-signal" />
      <span className="flex -space-x-1">
        {take.stars.map((s) => (
          <span key={s} className="flex size-5 items-center justify-center rounded-full bg-secondary text-[10px] font-semibold ring-2 ring-background">
            {memberOf(data, s)?.initial}
          </span>
        ))}
      </span>
    </span>
  )
}

/** Your own star: press to give the take yours, press again to take it back. */
/**
 * Your own star: press to give the take yours, press again to take it back.
 * Beside it how many stars the take has; who gave them shows in full only
 * on the take's panel and page (`who`), and in a tooltip elsewhere.
 */
export function StarButton({ take, who }: { take: Take; who?: boolean }) {
  const data = useData()
  const mine = take.stars.includes(data.me)
  const names = take.stars.map((s) => memberOf(data, s)?.name).join(", ")
  return (
    <span className="flex items-center gap-0.5" title={names ? `Starred by ${names}` : undefined}>
      <Button variant="ghost" size="icon-row" aria-pressed={mine} aria-label={mine ? "Take back your star" : "Star this take"} onClick={() => toggleStar(take.uid)}>
        <Star className={cn("size-4", mine ? "fill-current text-signal" : "text-muted-foreground")} />
      </Button>
      {who ? <Initials ids={take.stars} /> : <span className="tnum w-3 text-xs text-muted-foreground">{take.stars.length || ""}</span>}
    </span>
  )
}

// ---------- a take as РЭХА draws it in a list ----------

/** A take's ▶: the accent while it plays. */
export function Play({ uid, className }: { uid: string; className?: string }) {
  const data = useData()
  const p = usePlayer()
  const t = takeOf(data, uid)
  return <PlayButton look={p.uid === uid && p.playing ? "playing" : "idle"} name={`${t.song ?? "Take"} ${t.n}`} onClick={() => p.play(uid)} className={className} />
}

/** Our label in РЭХА's shape, for its dot and tick. */
export function rehaLabel(l: Label, i: number): RehaLabel {
  const c = l.colour.match(/--label-(\w+)/)?.[1] ?? "grey"
  return { id: i, name: l.name, colour: (c === "orange" ? "blue" : c) as LabelColour, marks: 0 }
}

// As РЭХА's rehearsal overview (RehearsalOverview.tsx): the longest take's wave takes this share of the row.
const BAR_SHARE = 88

/**
 * One take as a row: ▶, its name (opens the take's panel), its wave to
 * scale with its marks (green when it has stars; press it to play from
 * there), its length, your star. `marks` lists its marks under it, each a
 * line that plays from there.
 */
export function TakeLine({ take, marks, after }: { take: Take; marks?: boolean; after?: ReactNode }) {
  const data = useData()
  const p = usePlayer()
  const { open } = usePanel()
  const longest = Math.max(...data.takes.map((t) => t.len))
  const ms = marksOf(data, take.uid)
  return (
    <div className="flex flex-col gap-0.5">
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3">
        <Play uid={take.uid} />
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => open({ kind: "take", uid: take.uid })}
            title={`${take.song ?? "Take"} ${take.n}`}
            className="w-24 shrink-0 truncate rounded-sm text-left text-sm hover:underline"
          >
            <TakeName take={take} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <Wave uid={take.uid} height={28} starred={take.stars.length > 0} className="min-w-12" style={{ width: `${(take.len / longest) * BAR_SHARE}%` }} />
            <span className="tnum shrink-0 text-sm text-muted-foreground">{fmt(take.len)}</span>
            {isNew(data, take.uid) && <Dot />}
            {after}
          </div>
        </div>
        <StarButton take={take} />
      </div>
      {marks &&
        ms.map((k) => (
          <button key={k.id} type="button" onClick={() => p.seek(take.uid, k.at)} className="ml-9 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent/60">
            <LabelDot colour={rehaLabel(data.labels[k.label], k.label).colour} />
            <span className="tnum shrink-0 text-muted-foreground">{fmt(k.at)}</span>
            <span className="truncate">{k.note || data.labels[k.label].name}</span>
          </button>
        ))}
    </div>
  )
}

// ---------- the wave: in the player and in every list ----------

const N = 110
function bars(seed: string) {
  let h = 2166136261
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  const out: number[] = []
  for (let i = 0; i < N; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    const r = ((h >>> 0) % 1000) / 1000
    const env = i < 4 ? i / 4 : i > N - 5 ? (N - i) / 5 : 1
    out.push(Math.max(0.08, (0.35 + r * 0.65) * env))
  }
  return out
}

/**
 * A take's wave, straight on what holds it (no well of its own: a well in a
 * tile read as a sausage); the part played darker, as in РЭХА's player; the
 * marks in their colours; the playhead in blue. Press to play from there.
 */
export function Wave({
  uid,
  seed,
  height = 40,
  starred,
  className,
  style,
}: {
  uid: string
  seed?: string
  height?: number
  /** A take with stars: its wave in РЭХА's green, as its bar had a green edge. */
  starred?: boolean
  className?: string
  style?: CSSProperties
}) {
  const data = useData()
  const p = usePlayer()
  const at = useAt(uid)
  const t = takeOf(data, uid)
  const b = bars(seed ?? uid)
  return (
    <div
      className={cn("relative min-w-0 cursor-pointer py-[3px]", className)}
      style={{ ...style, height }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        p.seek(uid, Math.round(((e.clientX - r.left) / r.width) * t.len))
      }}
    >
      <svg viewBox={`0 0 ${N} 100`} preserveAspectRatio="none" className="size-full" aria-hidden="true">
        {b.map((v, i) => (
          <rect
            key={i}
            x={i + 0.2}
            y={50 - v * 46}
            width={0.6}
            height={v * 92}
            rx={0.3}
            className={
              p.uid === uid && (i + 1) / N <= at / t.len
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
      {marksOf(data, uid).map((k) => (
        <span key={k.id} className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2" style={{ left: `${(k.at / t.len) * 100}%`, background: data.labels[k.label].colour }}>
          <Diamond colour={data.labels[k.label].colour} className="absolute -top-1 left-1/2 -translate-x-1/2" />
        </span>
      ))}
      {p.uid === uid && <span className="pointer-events-none absolute inset-y-0 w-px bg-primary" style={{ left: `${(at / t.len) * 100}%` }} />}
    </div>
  )
}
