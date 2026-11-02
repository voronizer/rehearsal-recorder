import { Children, createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { useSize } from "./size"

/*
  The pages' layout, as РЭХА's History: one card a page with its parts
  split by a line, 14 px text, part headings 14 px semibold with a grey
  count, rows with no box that light up under the pointer.
*/

/** Where a group is drawn: on the page (it makes its own card), in a card, or in the panel. */
type Surface = "page" | "card" | "panel"
const SurfaceCtx = createContext<Surface>("page")
export const InPanel = ({ children }: { children: ReactNode }) => <SurfaceCtx.Provider value="panel">{children}</SurfaceCtx.Provider>
/** Whether this is drawn in the panel, not on the page. */
export const useInPanel = () => useContext(SurfaceCtx) === "panel"

/** A child's own key, so a row keeps its state when one is added above it; its place when it has none. */
const keyOf = (c: ReturnType<typeof Children.toArray>[number], i: number) =>
  (typeof c === "object" && c !== null && "key" in c && c.key !== null ? c.key : i)

/**
 * A screen's or a panel's groups. On a page: one card with the groups as
 * its parts, a line between them. In a card or the panel: the parts and
 * lines alone. On a phone the card would only take width from the rows.
 */
export function Groups({ children, className }: { children: ReactNode; className?: string }) {
  const surface = useContext(SurfaceCtx)
  const size = useSize()
  const items = Children.toArray(children).filter(Boolean)
  const parts = items.map((c, i) => (
    <div key={keyOf(c, i)} className={cn(surface === "panel" ? "py-5" : "py-6", i > 0 && "border-t", surface !== "page" && "first:pt-0 last:pb-0")}>
      {c}
    </div>
  ))
  if (surface !== "page") return <div className={cn("flex flex-col", className)}>{parts}</div>
  return (
    <SurfaceCtx.Provider value="card">
      <div className={cn("flex flex-col", size !== "phone" && "rounded-xl bg-card px-6", className)}>{parts}</div>
    </SurfaceCtx.Provider>
  )
}

/**
 * One group: its heading, a count or hint after it in grey, an action at
 * its right, then what it holds. `fold` makes the heading fold the group
 * away, for long lists and what is seldom needed; "closed" starts folded.
 * `small` is a group in a group, such as one rehearsal among a song's
 * takes. Straight on a page it makes a card of its own.
 */
export function Group({
  title,
  name,
  hint,
  action,
  fold,
  small,
  children,
}: {
  /** A word, or something that opens, such as a day leading to its rehearsal. */
  title?: ReactNode
  /** What a screen reader calls the group when its title is not a word. */
  name?: string
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
        <Group title={title} name={name} hint={hint} action={action} fold={fold} small={small}>
          {children}
        </Group>
      </Groups>
    )
  if (!title) return <section className="flex flex-col gap-3">{children}</section>
  const label = typeof title === "string" ? title : name
  const heading = (
    <>
      <h2 className={cn("text-sm", small ? "font-medium" : "font-semibold")}>{title}</h2>
      {hint && <span className="truncate text-sm text-muted-foreground">{hint}</span>}
    </>
  )
  if (fold)
    return (
      <Collapsible defaultOpen={fold === "open"} className="group/fold flex flex-col" role="region" aria-label={label}>
        <div className="flex min-h-8 items-center gap-2">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="-ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pl-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
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
    <section aria-label={label} className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center gap-2">
        {heading}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

/** Rows of a list: no box of their own; with `opens`, a row lights up under the pointer. */
export function Rows({ children, className, opens }: { children: ReactNode; className?: string; opens?: boolean }) {
  const items = Children.toArray(children).filter(Boolean)
  return (
    <div role="list" className={cn("flex flex-col gap-0.5", className)}>
      {items.map((c, i) => (
        // Lit under the pointer only where the whole row opens something (`opens`).
        <div role="listitem" key={keyOf(c, i)} className={cn("-mx-2 rounded-lg px-2 py-1.5", opens && "transition-colors hover:bg-accent/60")}>
          {c}
        </div>
      ))}
    </div>
  )
}

/**
 * What a word that opens or plays something looks like (Alex's pick C,
 * 2026-11-02): a grey dotted line under it, solid under the pointer, so a
 * phone with no pointer shows it too. A take's or a song's name, a mark's
 * words, a day that leads to its rehearsal, a file.
 */
export const OPENS =
  "text-left underline decoration-muted-foreground/60 decoration-dotted underline-offset-4 hover:decoration-current hover:decoration-solid"

/** The browser tab says which page this is: “Viasna · РЭХА”. */
export function useTitle(name: string | undefined) {
  useEffect(() => {
    document.title = name ? `${name} · РЭХА` : "РЭХА"
  }, [name])
}

/** A box for more than a line of words, drawn as the interface's Input. */
export const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"

/** Something that is not a list. `boxed`: a form or a notice, framed in a line. */
export function Tile({ children, className, boxed }: { children: ReactNode; className?: string; boxed?: boolean }) {
  return <div className={cn("flex flex-col gap-3", boxed && "rounded-lg border p-4", className)}>{children}</div>
}

/** Two columns on a computer; one under another in a small window and on a phone. */
export function Columns({ main, side, sideWidth = "20rem" }: { main: ReactNode; side: ReactNode; sideWidth?: string }) {
  const size = useSize()
  if (size !== "wide")
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
export function Page({ title, sub, head, children }: { title?: ReactNode; sub?: ReactNode; head?: ReactNode; children?: ReactNode }) {
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

/** A heading with buttons at its right, for Songs and Marks. */
export function TitleWith({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="flex-1">{title}</span>
      {children}
    </span>
  )
}

/** A section with nothing in it yet: what will come, and how. */
export function Empty({ title, text }: { title: ReactNode; text: string }) {
  return (
    <Page title={title}>
      <Tile>
        <p className="text-muted-foreground">{text}</p>
      </Tile>
    </Page>
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

type BackTo = { to: "/rehearsals" } | { to: "/songs" } | { to: "/songs/$id"; params: { id: string } }

/** Back to where the page belongs: “‹ Songs”. */
export function Back({ label, ...to }: BackTo & { label: string }) {
  return (
    <Link {...(to as { to: "/songs" })} className="mb-2 flex items-center gap-1 self-start text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" />
      {label}
    </Link>
  )
}

/** A member's first letter in a circle. */
export function Avatar({ letter, className }: { letter: string; className?: string }) {
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold", className)}>{letter}</span>
  )
}

/** The band's picture, or the first letter of its name on the accent. */
export function Logo({ name, picture, className }: { name: string; picture: string | null; className?: string }) {
  if (picture) return <img src={picture} alt="" className={cn("size-9 shrink-0 rounded-lg object-cover", className)} />
  return (
    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground", className)}>
      {(Array.from(name.trim())[0] ?? "B").toUpperCase()}
    </span>
  )
}

/** A page's words while it loads, or what went wrong. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

/**
 * A panel whose take or song is still on its way: nothing for the first
 * moment, so a quick answer does not flash, then a line that says it is coming.
 */
export function Waiting() {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 300)
    return () => clearTimeout(t)
  }, [])
  return late ? <p className="text-sm text-muted-foreground">Opening…</p> : null
}

/**
 * What could not be read, said plainly, with **Try again**. A dropped
 * connection reads “Failed to fetch” in the browser; it is said in words.
 */
export function Trouble({ error, retry }: { error: Error; retry: () => void }) {
  const offline = error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error.message)
  return (
    <div role="alert" className="flex flex-col items-start gap-3 text-sm">
      <p className="text-muted-foreground">{offline ? "The band's service cannot be reached. Check the connection, then try again." : error.message}</p>
      <Button variant="outline" size="row" onClick={retry}>
        Try again
      </Button>
    </div>
  )
}

/** A word that says it worked (“Saved”, “Copied”), shown for two seconds. */
export function useFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return [
    on,
    () => {
      setOn(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setOn(false), 2000)
    },
  ]
}
