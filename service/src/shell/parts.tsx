import { Children, createContext, Fragment, useContext, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
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
    <div key={i} className={cn(surface === "panel" ? "py-5" : "py-6", i > 0 && "border-t", surface !== "page" && "first:pt-0 last:pb-0")}>
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
      <Collapsible defaultOpen={fold === "open"} className="group/fold flex flex-col" role="region" aria-label={title}>
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
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex min-h-8 items-center gap-2">
        {heading}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

/** Rows of a list: no box of their own; a row lights up under the pointer. */
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

/** Something new for you: a take not heard yet, or a song or rehearsal with one. */
export function Dot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full bg-primary", className)} />
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
