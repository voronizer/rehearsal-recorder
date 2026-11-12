import { Children, createContext, Fragment, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight, PanelRightClose, TriangleAlert, X } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar as Circle, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty as EmptyBox, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { FieldError } from "@/components/ui/field"
import { Item, ItemGroup } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAfter } from "@/hooks/useAfter"
import { cn } from "@/lib/utils"
import { usePanel } from "./panel"
import { sectionIcon, type SectionTo } from "./sections"
import { useSize } from "./size"
import { count, day, longDay } from "./words"

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

/** The panel as the drawer on a take's page (shell/drawer.tsx): it folds into its strip rather than closing. */
const DrawerCtx = createContext(false)
export const InDrawer = ({ children }: { children: ReactNode }) => <DrawerCtx.Provider value>{children}</DrawerCtx.Provider>

/** The panel's ✕; in the drawer, the sign that folds it into its strip, so there is one way to fold it. */
export function PanelClose() {
  const { close } = usePanel()
  if (!useContext(DrawerCtx))
    return (
      <Button variant="ghost" size="icon-row" aria-label="Close" onClick={close}>
        <X />
      </Button>
    )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-row" aria-label="Fold the panel" onClick={close}>
          <PanelRightClose />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Fold the panel</TooltipContent>
    </Tooltip>
  )
}

/** A child's own key, so a row keeps its state when one is added above it; its place when it has none. */
const keyOf = (c: ReturnType<typeof Children.toArray>[number], i: number) =>
  (typeof c === "object" && c !== null && "key" in c && c.key !== null ? c.key : i)

/**
 * A screen's or a panel's groups. On a page: one card with the groups as
 * its parts, a line between them. In a card or the panel: the parts and
 * lines alone. On a phone the card would only take width from the rows.
 * `columns`: side by side instead, the last as wide as it says (`Columns`).
 */
export function Groups({ children, className, columns }: { children: ReactNode; className?: string; columns?: string }) {
  const surface = useContext(SurfaceCtx)
  const size = useSize()
  const items = Children.toArray(children).filter(Boolean)
  const parts = items.map((c, i) => (
    <div
      key={keyOf(c, i)}
      className={columns ? "min-w-0" : cn(surface === "panel" ? "py-5" : "py-6", i > 0 && "border-t", surface !== "page" && "first:pt-0 last:pb-0")}
    >
      {c}
    </div>
  ))
  // One tree whatever the surface and the room, so what is in the groups
  // stays as a panel opening beside the page turns two columns into one:
  // always the shared Card, whose look is there only where it is a card.
  const card = surface === "page" && !columns
  return (
    <SurfaceCtx.Provider value={card ? "card" : surface}>
      <Card
        className={cn(
          "gap-0 p-0",
          card && size !== "phone" ? "px-6" : "rounded-none bg-transparent text-inherit",
          columns && "grid items-start gap-10",
          className
        )}
        style={columns ? { gridTemplateColumns: `minmax(0,1fr) ${columns}` } : undefined}
      >
        {parts}
      </Card>
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
  if (!title)
    return (
      <section aria-label={name} className="flex flex-col gap-3">
        {children}
      </section>
    )
  const label = typeof title === "string" ? title : name
  const heading = (
    <>
      <h2 className={cn("text-sm", small ? "font-medium" : "font-semibold")}>{title}</h2>
      {hint && <span className="truncate text-sm text-muted-foreground">{hint}</span>}
    </>
  )
  // A title that leads away, such as a day's pill: the arrow and the count
  // fold the group, the title beside them leads to its page.
  if (fold && typeof title !== "string")
    return (
      <Collapsible defaultOpen={fold === "open"} className="group/fold flex flex-col" role="region" aria-label={label}>
        <div className="flex min-h-8 items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon-tiny" aria-label={[label, typeof hint === "string" ? hint : null].filter(Boolean).join(", ")} className="-ml-1">
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[state=open]/fold:rotate-90" />
            </Button>
          </CollapsibleTrigger>
          <h2 className={cn("min-w-0 text-sm", small ? "font-medium" : "font-semibold")}>{title}</h2>
          {hint && (
            // The count folds too; the arrow says it to the keyboard and a screen reader.
            <CollapsibleTrigger asChild>
              <Button variant="ghost" tabIndex={-1} aria-hidden="true" className={cn(BARE, "block min-w-0 flex-1 truncate py-1 text-muted-foreground hover:text-muted-foreground")}>
                {hint}
              </Button>
            </CollapsibleTrigger>
          )}
          <span className="hidden group-data-[state=open]/fold:contents">{action}</span>
        </div>
        <CollapsibleContent className="flex flex-col gap-3 pt-2">{children}</CollapsibleContent>
      </Collapsible>
    )
  if (fold)
    return (
      <Collapsible defaultOpen={fold === "open"} className="group/fold flex flex-col" role="region" aria-label={label}>
        <div className="flex min-h-8 items-center gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className={cn(BARE, "-ml-1 min-w-0 flex-1 gap-1.5 py-1 pl-1 whitespace-normal has-[>svg]:pl-1")}>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/fold:rotate-90" />
              {heading}
            </Button>
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

/**
 * Rows of a list, by one rule for every list (Alex's pick А, 2026-11-10):
 * no box and no lines, 24 px from one row's content to the next. With
 * `opens`, a row lights up under the pointer over that room, and a press
 * there is the row's. `takes`: take rows (TakeLine), which light up by
 * themselves, the same 24 px apart. `talk`: a take's marks, which read as
 * messages and keep their 14 px (the spec's call 16).
 */
export function Rows({
  children,
  className,
  opens,
  takes,
  talk,
}: {
  children: ReactNode
  className?: string
  opens?: boolean
  takes?: boolean
  talk?: boolean
}) {
  const items = Children.toArray(children).filter(Boolean)
  return (
    <ItemGroup className={cn(takes && "gap-3", talk && "gap-0.5", className)}>
      {items.map((c, i) => (
        // The shared row, holding whatever the list's row is: no frame, so
        // the rows keep their 24 px, and no layout of its own.
        <Item
          role="listitem"
          key={keyOf(c, i)}
          className={cn(
            "block border-0",
            takes ? "p-0" : "-mx-2 rounded-lg px-2",
            talk ? "py-1.5" : !takes && "py-3",
            opens && "cursor-pointer hover:bg-accent/60"
          )}
          onClick={
            opens
              ? (e) => {
                  if (e.target === e.currentTarget) (e.currentTarget.firstElementChild as HTMLElement | null)?.click()
                }
              : undefined
          }
        >
          {c}
        </Item>
      ))}
    </ItemGroup>
  )
}

/**
 * A Button with no look of its own, for words that are pressed where they
 * stand (a fold's heading, a mark's words, a set's length): no frame, fill
 * or padding, only the shared focus ring. It gives way in a row as the
 * words it took the place of did (Button keeps its width by itself), so a
 * long name is cut, not pushed past what is beside it. A word that opens
 * something by itself adds `OPENS` (components/ui/button.tsx), only where
 * the row round it does not open (2026-11-10).
 */
export const BARE = "h-auto min-w-0 shrink justify-start gap-0 rounded-sm border-0 p-0 text-left font-normal hover:bg-transparent has-[>svg]:px-0 dark:hover:bg-transparent"

/**
 * **Statuses** and **Labels** at the top of their page: the shared Toggle,
 * pressed while their panel is open, drawn as the outline Button beside it
 * is while it is not (its faint fill in dark).
 */
export const PANEL_TOGGLE = "dark:not-data-[state=on]:bg-input/30 dark:not-data-[state=on]:hover:bg-input/50"

/** The browser tab says which page this is: “Viasna · РЭХА”. */
export function useTitle(name: string | undefined) {
  useEffect(() => {
    document.title = name ? `${name} · РЭХА` : "РЭХА"
  }, [name])
}

/** Something that is not a list. `boxed`: a form or a notice, framed in a line. */
export function Tile({ children, className, boxed }: { children: ReactNode; className?: string; boxed?: boolean }) {
  return <div className={cn("flex flex-col gap-3", boxed && "rounded-lg border p-4", className)}>{children}</div>
}

/** Two columns on a computer; one under another in a small window and on a phone. */
export function Columns({ main, side, sideWidth = "20rem" }: { main: ReactNode; side: ReactNode; sideWidth?: string }) {
  return (
    <Groups columns={useSize() === "wide" ? sideWidth : undefined}>
      {main}
      {side}
    </Groups>
  )
}

/** A page's heading: its size, weight and balanced lines. */
export const PAGE_TITLE = "text-xl font-semibold text-balance"

/** A page: its heading and the line under it, then its groups. */
export function Page({
  title,
  heading,
  sub,
  head,
  children,
}: {
  title?: ReactNode
  /** In the title's place, a line the page draws itself: its own h1 (`PAGE_TITLE`), and what stands beside the heading outside it. */
  heading?: ReactNode
  sub?: ReactNode
  head?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-[72rem] flex-col gap-6">
      <header className="flex flex-col gap-1">
        {head}
        {heading ?? (title && <h1 className={PAGE_TITLE}>{title}</h1>)}
        {sub && <div className="text-muted-foreground">{sub}</div>}
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

/**
 * A section with nothing in it yet, as РЭХА's empty lists (B7): `empty` in
 * the shared Empty, its first sentence the title, the rest the line under
 * it; `top`, what goes over it, such as the button that fills it.
 */
export function Empty({ title, empty, top }: { title: ReactNode; empty: [title: string, text: string]; top?: ReactNode }) {
  return (
    <Page title={title}>
      {top}
      <EmptyBox>
        <EmptyHeader>
          <EmptyTitle>{empty[0]}</EmptyTitle>
          <EmptyDescription>{empty[1]}</EmptyDescription>
        </EmptyHeader>
      </EmptyBox>
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

type BackTo = { to: "/rehearsals" } | { to: "/songs" } | { to: "/sets" } | { to: "/songs/$id"; params: { id: string } }

type PillTo = { to: "/songs/$id"; params: { id: string } } | { to: "/rehearsals/$uid"; params: { uid: string } }

/**
 * A song or a rehearsal that leads to its page, under a take's title and as
 * a day on a song's page (Alex's pick Б, 2026-11-10): the icon its section
 * has in the column on the left, the words, a thin line round them. A press
 * does not reach a fold round it.
 */
export function Pill({ kind, children, ...to }: PillTo & { kind: "song" | "rehearsal"; children: ReactNode }) {
  const Icon = sectionIcon(kind === "song" ? "/songs" : "/rehearsals")
  return (
    <Badge asChild variant="outline" className="h-7 max-w-full shrink gap-1.5 bg-background px-2.5 py-0 text-sm font-normal transition-colors [&>svg]:size-3.5">
      <Link {...(to as { to: "/songs/$id"; params: { id: string } })} data-pill={kind} onClick={(e) => e.stopPropagation()}>
        <Icon className="shrink-0 text-muted-foreground" />
        <span className="truncate">{children}</span>
      </Link>
    </Badge>
  )
}

/** A grey line's look (Alex's pick А, 2026-11-10): a band of РЭХА's side panels' grey, lit under the pointer. On the shared Item, a row that goes somewhere. */
const LINE = "-mx-3 flex-nowrap gap-2.5 rounded-lg border-0 bg-panel px-3 py-2.5 hover:bg-accent [a]:hover:bg-accent"

/** What a grey line says: its section's icon, its title a size up, grey facts, and ›. The title keeps its room; the facts give way first. */
function LineWords({ section, title, facts }: { section: SectionTo; title: string; facts: string }) {
  const Icon = sectionIcon(section)
  return (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="max-w-[75%] shrink-0 truncate text-base font-semibold">{title}</span>{" "}
      <span className="min-w-0 truncate text-sm text-muted-foreground">{facts}</span>
      <span className="flex-1" />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </>
  )
}

/**
 * A song over its takes, on a grey band, on a rehearsal's page and on Home
 * (Alex, 2026-11-10): its takes, its key and tempo, or when it was last
 * played (`last`). The whole line opens the song's page.
 */
export function SongLine({
  song,
  takes,
  last,
}: {
  song: { id: number; title: string; key?: string | null; tempo?: number | null }
  takes: number
  last?: string
}) {
  const facts = [count(takes, "take"), song.key, song.tempo ? `${Math.round(song.tempo)} bpm` : null, last && `last ${day(last)}`]
    .filter(Boolean)
    .join(" · ")
  return (
    <Item asChild className={LINE}>
      <Link to="/songs/$id" params={{ id: String(song.id) }}>
        <LineWords section="/songs" title={song.title} facts={facts} />
      </Link>
    </Item>
  )
}

/** A rehearsal over its takes, on Home, as a song's line: the whole line opens the rehearsal's page. */
export function RehearsalLine({ uid, date, facts }: { uid: string; date: string; facts: string }) {
  return (
    <Item asChild className={LINE}>
      <Link to="/rehearsals/$uid" params={{ uid }}>
        <LineWords section="/rehearsals" title={longDay(date)} facts={facts} />
      </Link>
    </Item>
  )
}

/** Back to where the page belongs: “‹ Songs”. */
export function Back({ label, ...to }: BackTo & { label: string }) {
  return (
    <Link {...(to as { to: "/songs" })} className="mb-2 flex items-center gap-1 self-start text-muted-foreground hover:text-foreground">
      <ChevronLeft className="size-4" />
      {label}
    </Link>
  )
}

/** A member's first letter in a circle, the shared Avatar. */
export function Avatar({ letter, className }: { letter: string; className?: string }) {
  return (
    <Circle className={cn("size-7", className)}>
      <AvatarFallback className="bg-secondary text-xs font-semibold text-foreground">{letter}</AvatarFallback>
    </Circle>
  )
}

/**
 * The band's picture, or the first letter of its name on the accent: the
 * shared Avatar with a square's corners. The letter stands in when the
 * picture is slow to come or does not come.
 */
export function Logo({ name, picture, className }: { name: string; picture: string | null; className?: string }) {
  return (
    <Circle className={cn("size-9 rounded-lg text-base", className)}>
      {picture && <AvatarImage src={picture} alt="" className="object-cover" />}
      <AvatarFallback delayMs={picture ? 600 : undefined} className="rounded-none bg-primary text-[length:inherit] font-semibold text-primary-foreground">{(Array.from(name.trim())[0] ?? "B").toUpperCase()}</AvatarFallback>
    </Circle>
  )
}

/**
 * The line under a field where its error goes (S11): 20 px whether or not
 * it has one, so nothing below moves when one comes (B4). `children` is
 * what the line says while nothing is wrong, such as “Saved”.
 */
export function ErrorLine({ error, children, className }: { error?: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={cn("min-h-5", className)}>{error ? <FieldError>{error}</FieldError> : children}</div>
}

/** A page's words while it loads, or what went wrong. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

/** How long a panel waits before it says in words what it is doing (B5). */
const SAY_AFTER_MS = 10_000

/**
 * A panel whose take is still on its way, as B5 has it: nothing for the
 * first second, so a quick answer does not flash, then the shared Spinner,
 * and from 10 s “Opening…” beside it.
 */
export function Waiting() {
  const slow = useAfter(true, SAY_AFTER_MS)
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      {/* "Loading" until the words come, then quiet beside them. */}
      <Spinner quiet={slow} />
      {slow && <span>Opening…</span>}
    </div>
  )
}

/**
 * What could not be read, said plainly, with **Try again**. A dropped
 * connection reads “Failed to fetch” in the browser; it is said in words.
 */
export function Trouble({ error, retry }: { error: Error; retry: () => void }) {
  const offline = error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(error.message)
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertDescription className="gap-3">
        <p>{offline ? "The band's service cannot be reached. Check the connection, then try again." : error.message}</p>
        <Button variant="outline" size="row" onClick={retry} className="text-foreground">
          Try again
        </Button>
      </AlertDescription>
    </Alert>
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
