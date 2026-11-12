import {
  Children,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { ITEM_CHOSEN } from "@/components/ui/item"
import { WholeTip, useCut } from "@/components/ui/whole"
import type { RehearsalSet } from "@/lib/api"
import { takesLabel } from "@/lib/format"
import { SHORT, rowsFor, shortList } from "@/lib/setSongs"
import { cn } from "@/lib/utils"

// The songs on the rehearsal screen's panel, under the Next take field, in
// place of the pills the other name fields have (issue #12 step 8, R1–R7):
// the set the rehearsal plays by, then the band's other songs, as rows like
// the set's. A click on a row names the next take after it. Each is a part
// of the panel's one group, under a line the screen draws; neither has a
// frame of its own. The set's card is History's too, over the songs of a
// rehearsal played by a set (`onGoTo`): there a click goes to the song's takes.

// A row is the shared Button (C1); the row the field names is selected, grey
// (F2), and the ↑ ↓ row while typing shows the focus ring rather than a ring
// of its own.
const ROW = "h-9 w-full justify-start gap-3 px-2 text-left text-sm font-normal"

/** One song: its number in the set (none in the other songs, whose names
 *  still line up with the set's), the title, and its takes tonight. With
 *  `recap` (History's card) a song with no takes is disabled and says *not
 *  played*, and a click on one played scrolls to its takes. */
function SongRow({
  title,
  number,
  goes,
  lit,
  next = false,
  highlighted,
  onPick,
  data,
  recap = false,
}: {
  title: string
  number: number | null
  goes: number
  lit: boolean
  next?: boolean
  highlighted: boolean
  onPick: (title: string) => void
  data: Record<string, string>
  recap?: boolean
}) {
  const [titleRef, cut] = useCut<HTMLSpanElement>()
  const unplayed = recap && goes === 0
  const row = (
    <Button
      type="button"
      variant="ghost"
      {...data}
      disabled={unplayed}
      aria-current={lit ? "true" : undefined}
      data-highlighted={highlighted ? "" : undefined}
      // The field keeps focus until the row says what it names: what was
      // half typed in it is dropped, not sent (TakeNameField's `put`).
      // History has no field to keep it for.
      onMouseDown={recap ? undefined : (e) => e.preventDefault()}
      onClick={() => onPick(title)}
      className={cn(
        ROW,
        // A row that is not played is not dimmed as a disabled button is:
        // its title and *not played* are grey already.
        "disabled:opacity-100",
        lit && ITEM_CHOSEN,
        highlighted && "border-ring ring-[3px] ring-ring/50"
      )}
    >
      <span className="tnum w-4 shrink-0 text-right text-xs text-muted-foreground">
        {number}
      </span>
      <span
        ref={titleRef}
        data-row-title
        className={cn(
          "min-w-0 flex-1 truncate",
          lit && "font-semibold",
          unplayed && "text-muted-foreground"
        )}
      >
        {title}
      </span>
      {next && <span className="shrink-0 text-xs text-foreground">next</span>}
      {unplayed ? (
        <span className="shrink-0 text-xs text-muted-foreground">not played</span>
      ) : (
        goes > 0 && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            {!lit && (
              <Check data-played-check aria-hidden className="size-3.5 text-foreground" />
            )}
            {takesLabel(goes)}
          </span>
        )
      )}
    </Button>
  )
  // A disabled button gets no pointer events, so the tip of a song not played
  // is on the item round it. No key reaches that row, so it needs no more.
  return unplayed ? (
    <WholeTip cut={cut} text={title}>
      <li>{row}</li>
    </WholeTip>
  ) : (
    <li>
      <WholeTip cut={cut} text={title}>
        {row}
      </WholeTip>
    </li>
  )
}

/**
 * The panel's parts as one group: the field, the set and the other songs,
 * each after the first under a 1 px line across the panel, with 24 px either
 * side of the line. A part that is null, undefined or false is not drawn, and
 * leaves no line. `bleed` is how far the line runs past the padding the parts
 * sit in, in spacing steps: 8 (32 px) in the rehearsal screen's panel, whose
 * padding it takes back; none, the default, where the parts have the room to
 * themselves (reha.stream's tiles).
 */
export function PanelParts({ children, bleed = 0 }: { children: ReactNode; bleed?: 0 | 8 }) {
  const parts = Children.toArray(children)
  return parts.map((part, i) => (
    <div
      // A part keeps its own box as the others come and go.
      key={isValidElement(part) ? part.key : i}
      className={cn(
        bleed === 8 && "-mx-8 px-8",
        i > 0 && "border-t pt-6",
        i < parts.length - 1 && "pb-6"
      )}
    >
      {part}
    </div>
  ))
}

/** The field's state, or History's `onGoTo`: not both. */
type SetCardProps = {
  set: RehearsalSet
  /** Takes tonight by song. */
  goes: Map<string, number>
} & (
  | {
      /** The song the field names. */
      current: string | null
      onPick: (title: string) => void
      /** The row the arrow keys are on while the field is typed in. */
      highlighted: string | null
      onGoTo?: undefined
    }
  | {
      /** History's card: a click on a song played scrolls to its takes. */
      onGoTo: (title: string) => void
      current?: undefined
      onPick?: undefined
      highlighted?: undefined
    }
)

/**
 * The set (R1): "Gig on the 25th · 2 of 6 played", then its songs in
 * order, numbered. The song the field names is lit and the row after it
 * says *next*; with the field naming a song outside the set, *next* is on
 * the first one not played yet. Rows never move: the set is as tall all
 * evening as it is long.
 *
 * It is the same card in History (`onGoTo`), where the evening is over: a
 * song played scrolls to its own takes, one not played is disabled and says
 * so, and nothing is next, lit or under the arrow keys: it is given none of
 * the field's state, and ignores it if it is. A card 32rem wide or more
 * reads the songs down two columns, as a numbered list is read, and under
 * that in one.
 */
export function SetCard(props: SetCardProps) {
  const { set, goes } = props
  const recap = props.onGoTo !== undefined
  const current = props.onGoTo ? null : props.current
  const highlighted = props.onGoTo ? null : props.highlighted
  const pick = props.onGoTo ? props.onGoTo : props.onPick
  const titles = set.songs.map((s) => s.title)
  const played = titles.filter((t) => (goes.get(t) ?? 0) > 0).length
  const at = current === null ? -1 : titles.indexOf(current)
  const next = recap
    ? null
    : at >= 0
      ? (titles[at + 1] ?? null)
      : (titles.find((t) => (goes.get(t) ?? 0) === 0) ?? null)
  return (
    <section
      aria-label={`Set ${set.name}`}
      data-set-card
      className="@container flex flex-col gap-2"
    >
      {/* The set's name keeps its width before its figure (B6): a long one
          wraps, and "N of M played" goes under it when there is no room. */}
      <h2 className="flex min-h-8 min-w-0 flex-wrap items-baseline gap-x-1.5 px-2 pt-1.5 text-sm font-semibold">
        <span className="min-w-0 break-words">{set.name}</span>{" "}
        <span className="shrink-0 text-sm font-normal text-muted-foreground">
          · {played} of {titles.length} played
        </span>
      </h2>
      {/* Tonight's copy of the set: songs added in Settings › Sets now are
          for the next rehearsal, so this does not send anyone there. */}
      {titles.length === 0 ? (
        <Empty className="items-start justify-start p-0 md:p-0">
          <EmptyHeader className="max-w-none items-start px-2 text-left">
            <EmptyDescription>
              This set has no songs yet. Add them in Settings › Sets.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        // Two columns read down, 1 to 3 then 4 to 6, once the card has room.
        <ol
          className="flex flex-col @min-[32rem]:grid @min-[32rem]:grid-flow-col @min-[32rem]:grid-cols-2 @min-[32rem]:gap-x-6"
          style={{ gridTemplateRows: `repeat(${Math.ceil(titles.length / 2)}, auto)` }}
        >
          {titles.map((title, i) => (
            <SongRow
              key={title}
              title={title}
              number={i + 1}
              goes={goes.get(title) ?? 0}
              lit={i === at}
              next={i !== at && title === next}
              highlighted={highlighted === title}
              onPick={pick}
              recap={recap}
              data={{ "data-set-song": title }}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * The band's songs as rows (R4–R6): under the set, the ones outside it
 * (*Other songs*); with no set, every song (*Songs*). Five show, and with
 * more than six *All N songs* opens the rest, *Fewer* folds them; the song
 * the field names shows even past the five. Typing narrows them over all
 * of them; while the field has focus the list keeps the height it had,
 * so nothing under it moves.
 *
 * The fold is the shared Collapsible. It opens more rows of the same list,
 * which has no part of its own to fold, so the button says it controls the
 * list.
 */
export function SongRows({
  titles,
  lastTake,
  goes,
  current,
  typed,
  typing,
  inSet,
  title,
  onPick,
  highlighted,
  open,
  onOpen,
}: {
  /** The songs, in order (otherSongs). */
  titles: string[]
  /** Tonight's songs' latest takes: the five folded keep the latest. */
  lastTake: Map<string, number>
  goes: Map<string, number>
  /** The song the field names. */
  current: string | null
  /** What the list narrows by; null while nothing does (rowsFor). */
  typed: string | null
  /** Whether the field has focus: the list's height is held. */
  typing: boolean
  /** The set's songs, for "No other song has…" when only they match. */
  inSet: string[]
  title: string
  onPick: (title: string) => void
  highlighted: string | null
  open: boolean
  onOpen: (open: boolean) => void
}) {
  const box = useRef<HTMLElement>(null)
  const list = useId()
  const [held, setHeld] = useState<number | null>(null)
  // Measured as focus arrives, before any key narrows the list.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeld(typing ? (box.current?.offsetHeight ?? null) : null)
  }, [typing])

  if (titles.length === 0) return null
  const shown = rowsFor(titles, typed, current)
  const folds = typed === null && titles.length > SHORT + 1
  // The song the field names shows after the five when it is not one.
  const short = shortList(titles, lastTake)
  const rows =
    folds && !open
      ? [
          ...short,
          ...(current !== null && titles.includes(current) && !short.includes(current)
            ? [current]
            : []),
        ]
      : shown
  const text = (typed ?? "").trim()
  // What is typed is one of the set's songs, or in one of their titles: the
  // card above has it.
  const setHasIt =
    typed !== null &&
    ((current !== null && inSet.includes(current)) ||
      inSet.some((t) => t.toLocaleLowerCase().includes(text.toLocaleLowerCase())))
  return (
    <Collapsible open={open} onOpenChange={onOpen} asChild>
      <section
        ref={box}
        aria-label={title}
        data-song-list
        style={{ minHeight: held ?? undefined }}
        className="flex flex-col gap-2"
      >
        <h2 className="flex min-h-8 items-center px-2 text-sm font-semibold">{title}</h2>
        {rows.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">
            {setHasIt
              ? `No other song has “${text}” in it.`
              : `No song has “${text}” in it. The take makes it a new one.`}
          </p>
        ) : (
          <ul id={list} className="flex flex-col">
            {rows.map((t) => (
              <SongRow
                key={t}
                title={t}
                number={null}
                goes={goes.get(t) ?? 0}
                lit={t === current}
                highlighted={highlighted === t}
                onPick={onPick}
                data={{ "data-song-row": t }}
              />
            ))}
          </ul>
        )}
        {folds && (
          <CollapsibleTrigger asChild aria-controls={list}>
            <Button
              type="button"
              variant="ghost"
              data-songs-more
              onMouseDown={(e) => e.preventDefault()}
              className={cn(ROW, "text-muted-foreground hover:text-foreground")}
            >
              <span className="w-4 shrink-0" />
              <span className="flex-1">{open ? "Fewer" : `All ${titles.length} songs`}</span>
              {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </Button>
          </CollapsibleTrigger>
        )}
      </section>
    </Collapsible>
  )
}
