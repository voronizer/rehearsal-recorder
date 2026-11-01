import { Children, Fragment, type ReactNode } from "react"
import { ChevronRight, Star } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { useAt, usePanel, usePlayer, useWide } from "./context"
import { isNew, marksOf, memberOf, takeOf, toggleStar, useData, type Take } from "./data"

/** "1 take", "3 takes". */
export const takesN = (n: number) => `${n} take${n === 1 ? "" : "s"}`

// ---------- groups ----------

/** A screen's or a panel's groups, one under another. */
export function Groups({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-8", className)}>{Children.toArray(children).filter(Boolean)}</div>
}

/**
 * One group: a heading, an optional hint after it and an action at its
 * right, then its rows as tiles. `fold` makes the heading a row that folds
 * the group away: for long lists and for what is seldom needed. "closed"
 * starts it folded; the hint then says what is inside. `small` is a group
 * inside a group, such as one rehearsal among a song's takes.
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
  if (!title) return <section className="flex flex-col gap-3">{children}</section>
  const heading = (
    <>
      <h2 className={small ? "text-sm text-muted-foreground" : "text-base font-semibold"}>{title}</h2>
      {hint && <span className={cn("truncate text-muted-foreground", small && "text-sm")}>{hint}</span>}
    </>
  )
  if (fold)
    return (
      <Collapsible defaultOpen={fold === "open"} className="group/fold flex flex-col">
        <div className={cn("flex items-center gap-2", small ? "min-h-7" : "min-h-8")}>
          <CollapsibleTrigger asChild>
            <button type="button" className="-ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pl-1 text-left outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/fold:rotate-90" />
              {heading}
            </button>
          </CollapsibleTrigger>
          <span className="hidden group-data-[state=open]/fold:contents">{action}</span>
        </div>
        <CollapsibleContent className={cn("flex flex-col gap-3", small ? "pt-2" : "pt-3")}>{children}</CollapsibleContent>
      </Collapsible>
    )
  return (
    <section className="flex flex-col gap-3">
      <div className={cn("flex items-center gap-2", small ? "min-h-7" : "min-h-8")}>
        {heading}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

/** Rows of a list: each row a soft tile, a hair apart. */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children).filter(Boolean)
  return (
    <div role="list" className={cn("flex flex-col gap-0.5", className)}>
      {items.map((c, i) => (
        <div
          role="listitem"
          key={i}
          className={cn("bg-muted/60 px-4 py-3", i === 0 ? "rounded-t-xl" : "rounded-t-sm", i === items.length - 1 ? "rounded-b-xl" : "rounded-b-sm")}
        >
          {c}
        </div>
      ))}
    </div>
  )
}

/** Something that is not a list, such as the notes: a tile of its own. */
export function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-3 rounded-xl bg-muted/60 p-4", className)}>{children}</div>
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
    <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-8">
      <header className="flex flex-col gap-1">
        {head}
        {title && <h1 className="text-2xl font-semibold text-balance">{title}</h1>}
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

/** "Viasna 12": the song's title and the take's number in a pill. */
export function TakeName({ take, short, className }: { take: Take; short?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {!(short && take.song) && (take.song ?? "Take")}
      <Badge variant="secondary" className="tnum h-5 rounded-md px-1.5 text-xs font-normal">
        {take.n}
      </Badge>
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

// ---------- the wave ----------

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

/** A take's wave in its well; the marks on it in their colours; the playhead in blue. Press to play from there. */
export function Wave({ uid, seed, height = 40, className }: { uid: string; seed?: string; height?: number; className?: string }) {
  const data = useData()
  const p = usePlayer()
  const at = useAt(uid)
  const t = takeOf(data, uid)
  const b = bars(seed ?? uid)
  return (
    <div
      className={cn("relative min-w-0 cursor-pointer rounded-md p-[3px]", "bg-background", className)}
      style={{ height }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        p.seek(uid, Math.round(((e.clientX - r.left) / r.width) * t.len))
      }}
    >
      <svg viewBox={`0 0 ${N} 100`} preserveAspectRatio="none" className="size-full text-muted-foreground/55" aria-hidden="true">
        {b.map((v, i) => (
          <rect key={i} x={i + 0.2} y={50 - v * 46} width={0.6} height={v * 92} rx={0.3} fill="currentColor" />
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
