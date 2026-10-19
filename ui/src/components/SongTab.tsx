import { Fragment, useLayoutEffect, useRef } from "react"
import { Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { LabelDot } from "@/components/ui/mark"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Whole, WholeTip, useCut } from "@/components/ui/whole"
import { useKeysOn } from "@/lib/keys"
import { labelOf, useLabels } from "@/lib/labels"
import { formatMMSS } from "@/lib/format"
import type { Take } from "@/lib/api"
import { takeButtonLabel, takeCloudStatus } from "@/components/TakeStrip"

/** One go in a tab: the take, and the rehearsal it is in when the tab's goes
 *  come from several (a song's goes from its page). */
export type TabGo = { take: Take; folder?: string; day?: string }

type CloudStates = Record<number, "queued" | "working">

/** The marks of a take as their labels' colours, one dot a label, and how
 *  many there are. */
function Marks({ take }: { take: Take }) {
  const labels = useLabels()
  if (!take.markers?.length) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {labels
        .filter((l) => take.markers?.some((m) => labelOf(labels, m.label_id).id === l.id))
        .map((l) => (
          <LabelDot key={l.id} colour={l.colour} />
        ))}
      <span className="tnum text-xs text-muted-foreground">{take.markers.length}</span>
    </span>
  )
}

const NUMBER =
  "tnum inline-flex h-6 min-w-6 shrink-0 items-center justify-center px-1.5 text-sm font-semibold text-foreground"

/**
 * A tab's second line: the go's number, its length, ★, its marks and its
 * cloud status. Every tab shows one, open or not, so a tab says the same
 * kind of thing either way and does not change size when it is opened. A
 * `ghost` is an unseen copy, there only for its width: it carries no button
 * and nothing a test or a screen reader would take for the real line.
 */
function GoLine({
  take,
  status,
  ghost,
  toggle,
}: {
  take: Take
  status: string | null
  ghost?: boolean
  toggle?: { song: string; expanded: boolean; onToggle: () => void }
}) {
  // ↑ and ↓ go through the song's takes while Settings › Keys has the
  // player's keys on; off, the button and its tip do not say them.
  const arrows = useKeysOn("player")
  const number = take.song ? (
    toggle && !ghost ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-tiny"
            aria-label={`Every take of ${toggle.song}`}
            aria-expanded={toggle.expanded}
            aria-keyshortcuts={arrows ? "ArrowUp ArrowDown" : undefined}
            onClick={(e) => {
              toggle.onToggle()
              // Space would press it again rather than play.
              e.currentTarget.blur()
            }}
            // Grey while the column is out, and the pointer over it does not
            // change that.
            className={cn(
              NUMBER,
              "w-auto",
              toggle.expanded && "bg-selected hover:bg-selected dark:hover:bg-selected"
            )}
          >
            {take.go}
          </Button>
        </TooltipTrigger>
        {/* The button's name and its keys, which it says as its own: for
            the eyes, not read out twice. */}
        <TooltipContent>
          <span aria-hidden>{`Every take of ${toggle.song}${arrows ? " (↑ ↓)" : ""}`}</span>
        </TooltipContent>
      </Tooltip>
    ) : (
      <span className={NUMBER}>{take.go}</span>
    )
  ) : null
  return (
    <span
      data-tab-line={ghost ? undefined : ""}
      aria-hidden={ghost || undefined}
      className={cn(
        "flex items-center gap-0.5 [grid-area:1/1]",
        take.song ? "-ml-1.5" : "",
        ghost && "pointer-events-none invisible"
      )}
    >
      {number}{" "}
      <span className={cn("flex items-center gap-1.5", take.song && "ml-1")}>
        <span className="tnum text-xs">{formatMMSS(take.duration_sec)}</span>{" "}
        {take.starred && (
          <Star
            aria-hidden
            data-starred={ghost ? undefined : ""}
            className="size-3 shrink-0 fill-current text-signal"
          />
        )}
        <Marks take={take} />
        {status && <span className="text-xs whitespace-nowrap">{status}</span>}
      </span>
    </span>
  )
}

/**
 * One song on the player's strip, or one take with no song: its name, large,
 * and under it the line of the go that is open, or that a click opens. When
 * the strip is opened out, a column of its goes hangs under it.
 */
export function SongTab({
  tabKey,
  song,
  goes,
  shown,
  open,
  expanded,
  isOpenGo,
  cloudStates,
  onPick,
  onRow,
  onToggle,
}: {
  tabKey: string
  song: string | null
  goes: TabGo[]
  /** The go whose line is shown: the open one, or the one a click opens.
   *  One of `goes`, so it is left out of the unseen copies. */
  shown: TabGo
  open: boolean
  expanded: boolean
  isOpenGo: (go: TabGo) => boolean
  /** The copies running for this rehearsal's takes; another rehearsal's go
   *  has none here. */
  cloudStates?: CloudStates
  onPick: () => void
  onRow: (go: TabGo) => void
  onToggle: () => void
}) {
  // A tab is as wide as the widest of its goes' lines, and a line's status
  // comes and goes on its own: "Waiting for the cloud", then nothing once
  // the copy is done. So while the strip is up a tab only ever widens, and
  // no tab moves under the mouse because a copy finished. Set on the
  // element, not through state: it is a floor for the layout, measured from
  // the layout, and a render for it would be one more render per tab.
  const box = useRef<HTMLDivElement | null>(null)
  const widest = useRef(0)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const width = Math.ceil(el.getBoundingClientRect().width)
    if (width <= widest.current) return
    widest.current = width
    el.style.minWidth = `${widest.current}px`
  })

  const title = song ?? `Take ${shown.take.take_number}`

  // A long name is cut short so it does not take half the strip; the whole
  // of it is in the shared tip, on the names that were cut and only on those.
  // This is the shut tab's name, which the button's tip is for; the open
  // one's is Whole's own.
  const [text, cut] = useCut<HTMLSpanElement>()

  const statusOf = (go: TabGo) =>
    takeCloudStatus(go.take, go.folder === undefined ? cloudStates?.[go.take.take_number] : undefined)
  const status = statusOf(shown)

  // Every other go's line, unseen, on top of the one shown: the tab is as
  // wide as the widest of them, and keeps its size going through them.
  const lines = (
    <span className="grid min-h-6 items-center justify-items-start">
      <GoLine
        take={shown.take}
        status={status}
        toggle={
          open && song && goes.length > 1 ? { song, expanded, onToggle } : undefined
        }
      />
      {goes
        .filter((g) => g !== shown)
        .map((g) => (
          <GoLine
            key={`${g.folder ?? ""}#${g.take.take_number}`}
            take={g.take}
            status={statusOf(g)}
            ghost
          />
        ))}
    </span>
  )
  // The name as wide as it is in the open tab's weight, open or not, and
  // never wider than 14rem. A shut tab is a button, so its tip is on the
  // whole tab, where the keys reach it. The open one is not, and has the
  // number's button in it, which has a tip of its own: so its name is the
  // shared Whole with reach, whose tip is on the name alone, and a name that
  // was cut is a stop for the Tab key, with the shared focus ring, so the
  // keys reach its tip too. A name that fits is no stop.
  const name = (
    <span
      data-text={title}
      className={cn(
        "inline-flex max-w-56 flex-col text-base after:invisible after:h-0 after:overflow-hidden after:font-[650] after:content-[attr(data-text)]",
        open ? "font-[650]" : "font-medium"
      )}
    >
      {open ? (
        <Whole reach text={title} data-tab-name className="truncate" />
      ) : (
        <span ref={text} data-tab-name className="truncate">
          {title}
        </span>
      )}
    </span>
  )
  // The same box open or shut, so a tab does not change size when it is
  // opened: the shut one is a Button, which brings a frame and a height of
  // its own that are put aside here.
  const body = cn(
    "relative flex h-auto min-w-24 flex-col items-start justify-start gap-0.5 rounded-t-lg rounded-b-none border-0 px-4 pt-2 pb-3 text-left",
    open ? "cursor-default text-foreground" : "text-foreground/80 hover:bg-accent hover:text-foreground"
  )
  const bar = open && (
    <span
      aria-hidden
      data-tab-bar
      className="absolute inset-x-1.5 bottom-0 h-[3px] rounded-t-sm bg-muted-foreground"
    />
  )

  return (
    <div
      ref={box}
      data-tab={tabKey}
      aria-current={open ? "true" : undefined}
      className="flex shrink-0 flex-col"
    >
      {open ? (
        <div className={body}>
          {name} {lines}
          {bar}
        </div>
      ) : (
        <WholeTip cut={cut} text={title}>
          <Button
            type="button"
            variant="ghost"
            aria-label={tabLabel(song, shown.take, status)}
            onClick={(e) => {
              onPick()
              e.currentTarget.blur()
            }}
            className={body}
          >
            {name} {lines}
          </Button>
        </WholeTip>
      )}
      <Column
        tabKey={tabKey}
        goes={goes}
        isOpenGo={isOpenGo}
        statusOf={statusOf}
        onRow={onRow}
        ghost={!expanded}
      />
    </div>
  )
}

/**
 * A tab's goes, a row each, under it when the strip is opened out. While it
 * is shut the column is still there, unseen and of no height, so that a tab
 * is as wide shut as open and opening them out moves nothing sideways. The
 * unseen one has no buttons, and nothing a test or a screen reader would
 * take for the real rows.
 */
function Column({
  tabKey,
  goes,
  isOpenGo,
  statusOf,
  onRow,
  ghost,
}: {
  tabKey: string
  goes: TabGo[]
  isOpenGo: (go: TabGo) => boolean
  statusOf: (go: TabGo) => string | null
  onRow: (go: TabGo) => void
  ghost: boolean
}) {
  // From a song's page the open song's column has every go at it, which can
  // be dozens: it scrolls in its place, with the open go in view, rather
  // than push the player off the window. Its scrollbar's room is kept in the
  // unseen copy too, so the tab is as wide either way.
  const ref = useRef<HTMLDivElement | null>(null)
  const openAt = goes.findIndex(isOpenGo)
  useLayoutEffect(() => {
    const col = ref.current
    const row = col?.querySelector<HTMLElement>("[aria-current='true']")
    if (ghost || !col || !row) return
    const top = row.offsetTop
    if (top < col.scrollTop || top + row.offsetHeight > col.scrollTop + col.clientHeight) {
      col.scrollTop = top - (col.clientHeight - row.offsetHeight) / 2
    }
  }, [ghost, openAt])
  return (
    <div
      ref={ref}
      data-column={ghost ? undefined : tabKey}
      aria-hidden={ghost || undefined}
      className={cn(
        "relative flex flex-col gap-0.5 px-1.5 [scrollbar-gutter:stable] [[data-tab]+[data-tab]>&]:border-l [[data-tab]+[data-tab]>&]:border-l-border/60",
        // Not flex-1 while unseen: a flex basis would give it its rows'
        // height back.
        ghost
          ? "pointer-events-none invisible h-0 flex-none overflow-hidden"
          : "max-h-[min(40vh,20rem)] flex-1 overflow-y-auto border-t pt-1.5 pb-2.5"
      )}
    >
      {goes.map((go, i) => {
        // A day over the first of each rehearsal's goes.
        const heading = go.day !== undefined && go.day !== goes[i - 1]?.day ? go.day : null
        const current = !ghost && isOpenGo(go)
        const row = cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1 text-sm whitespace-nowrap",
          current ? "bg-selected" : "hover:bg-accent"
        )
        const inner = (
          <>
            <span className="tnum min-w-4 text-left font-semibold">
              {go.take.song ? go.take.go : "—"}
            </span>
            <span className="tnum text-xs">{formatMMSS(go.take.duration_sec)}</span>
            {go.take.starred && (
              <Star aria-hidden className="size-3 shrink-0 fill-current text-signal" />
            )}
            <Marks take={go.take} />
          </>
        )
        return (
          <Fragment key={`${go.folder ?? ""}#${go.take.take_number}`}>
            {heading && (
              <div
                data-day={ghost ? undefined : ""}
                className="px-2.5 pt-2 pb-0.5 text-xs text-muted-foreground"
              >
                {heading}
              </div>
            )}
            {ghost ? (
              <span className={row}>{inner}</span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                data-go-row
                aria-label={takeButtonLabel(go.take, statusOf(go))}
                aria-current={current ? "true" : undefined}
                onClick={(e) => {
                  onRow(go)
                  e.currentTarget.blur()
                }}
                // The unseen copy is a span in the same box: a Button's
                // frame, height and room beside a ★ are put aside, and the
                // open row keeps its fill under the pointer.
                className={cn(
                  row,
                  "h-auto justify-start border-0 has-[>svg]:px-2.5",
                  current && "hover:bg-selected dark:hover:bg-selected"
                )}
              >
                {inner}
              </Button>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}

/** A shut tab, as a screen reader and the tests name it: "Viasna, take 1,
 *  4:10", or "Take 3, 1:30" with no song. */
function tabLabel(song: string | null, take: Take, status: string | null): string {
  const what = song ? `${song}, take ${take.go}` : `Take ${take.take_number}`
  const base = `${what}, ${formatMMSS(take.duration_sec)}${take.starred ? ", starred" : ""}`
  return status ? `${base}, ${status.charAt(0).toLowerCase()}${status.slice(1)}` : base
}
