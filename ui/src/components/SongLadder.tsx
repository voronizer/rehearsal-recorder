import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Item } from "@/components/ui/item"
import { MarkTick } from "@/components/ui/mark"
import { useCut, WholeTip } from "@/components/ui/whole"
import { cn } from "@/lib/utils"
import type { Label, SendTo, Take } from "@/lib/api"
import { formatDayIn, takesLabel } from "@/lib/format"
import { labelOf, useLabels } from "@/lib/labels"
import { motionOff } from "@/lib/motion"
import { drawnLength, TAKE_FILLS } from "@/lib/takeScale"
import { hereFor, placed, type PlacedPlayback, type PlacedTake, type Rung } from "@/lib/songs"
import { TakeRow } from "@/components/RehearsalOverview"

/**
 * Where the ladder is narrower than 25rem, as at 960 px and 150 %: the
 * columns beside the bars take 17.375rem with their gaps, which leaves the
 * bars less than the longest one's 7.5rem. There the bars go under the day,
 * across the last two columns, and their label goes. Tailwind reads a class
 * whole, so the width is in each; this is the one place they are.
 */
const NARROW = {
  columns: "@max-[25rem]:grid-cols-[1.125rem_minmax(0,1fr)_4.5rem]",
  bars: "@max-[25rem]:col-span-2 @max-[25rem]:col-start-2 @max-[25rem]:row-start-2",
  label: "@max-[25rem]:hidden",
} as const

/** The ladder's columns, in rem so they grow with the Appearance scale: the
 *  chevron, the day and the rehearsal, the takes as bars, how many. */
const COLUMNS = `grid grid-cols-[1.125rem_9.5rem_minmax(0,1fr)_4.5rem] gap-x-3 ${NARROW.columns}`

type Handlers = {
  onPlay: (take: PlacedTake) => void
  onOpen: (take: PlacedTake) => void
  onOpenAt: (take: PlacedTake, at: number) => void
  onRename: (take: PlacedTake) => void
  onStar: (take: PlacedTake, starred: boolean) => void
  onShare: (take: PlacedTake) => void
  onDelete: (take: PlacedTake) => void
  onOpenRehearsal: (folder: string) => void
  /** Where takes go: the cloud button's words are its. */
  sendTo?: SendTo
}

/**
 * Every take of a song, a rung per rehearsal, newest first. A rung is one
 * line: the rehearsal's day and name, its takes of the song as bars in the
 * order played, all drawn to the song's longest take, and how many there
 * were. A take that ran long or stopped short across a month of rehearsals
 * shows without reading a number; a ★ take is green, and each mark a tick
 * in its label's colour where it fell. More takes than the line holds go on
 * to a second line, none narrower than 6 px. The bars have no tip: an open
 * rung names each take.
 *
 * A press, Enter or Space opens a rung to its takes as the overview's rows,
 * and again closes it; its chevron says which. A rung of a rehearsal not on
 * disk says so, and its bars are the quiet ones.
 */
export function SongLadder({
  rungs,
  longest,
  unnamed,
  open,
  onToggle,
  playback,
  ...handlers
}: {
  rungs: Rung[]
  longest: number
  unnamed: boolean
  open: ReadonlySet<string>
  onToggle: (folder: string) => void
  playback: PlacedPlayback | null
} & Handlers) {
  const labels = useLabels()

  return (
    <div className="@container flex flex-col gap-0.5">
      {/* The column labels, lined up with the rungs' columns. */}
      <div aria-hidden className={cn(COLUMNS, "-mx-2 px-2 text-xs text-muted-foreground")}>
        <span />
        <span>Rehearsal</span>
        <span className={NARROW.label}>Takes, to scale</span>
        <span className="text-right">Takes</span>
      </div>
      {rungs.map((rung) => (
        <RungRow
          key={rung.folder}
          rung={rung}
          open={open.has(rung.folder)}
          onToggle={onToggle}
          longest={longest}
          unnamed={unnamed}
          labels={labels}
          playback={playback}
          {...handlers}
        />
      ))}
    </div>
  )
}

/** One rung: the line that opens it, and its takes' rows while it is open.
 *  The rehearsal's name is cut to its column, whole in the rung's tip. */
function RungRow({
  rung,
  open,
  onToggle,
  longest,
  unnamed,
  labels,
  playback,
  onPlay,
  onOpen,
  onOpenAt,
  onRename,
  onStar,
  onShare,
  onDelete,
  onOpenRehearsal,
  sendTo,
}: {
  rung: Rung
  open: boolean
  onToggle: (folder: string) => void
  longest: number
  unnamed: boolean
  labels: Label[]
  playback: PlacedPlayback | null
} & Handlers) {
  const [nameRef, cut] = useCut<HTMLSpanElement>()
  const day = formatDayIn(rung.created_at)
  const at = (take: Take) => placed(rung.folder, take)

  return (
    <Collapsible
      open={open}
      onOpenChange={() => onToggle(rung.folder)}
      data-rung-group={rung.folder}
      className="flex flex-col"
    >
      <WholeTip cut={cut} text={rung.rehearsal}>
        <CollapsibleTrigger asChild>
          <Item asChild size="sm">
            {/* Open, it has no fill of its own: the chevron says it. Its
                data-state is the tip's, which WholeTip's trigger hands down
                over the Collapsible's, so nothing styles it by
                data-[state=open]; aria-expanded is the Collapsible's. */}
            <Button
              variant="ghost"
              data-rung={rung.folder}
              data-missing={rung.missing || undefined}
              className={cn(
                COLUMNS,
                "-mx-2 h-auto items-center gap-y-2 px-2 py-2 text-left has-[>svg]:px-2"
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 text-muted-foreground",
                  !motionOff() && "transition-transform",
                  open && "rotate-90"
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold">{day}</span>
                <span ref={nameRef} className="truncate text-xs text-muted-foreground">
                  {rung.rehearsal}
                </span>
                {rung.missing && (
                  <span className="text-xs text-destructive">Not found on disk</span>
                )}
              </span>
              {/* A picture: the count beside it says it in words. */}
              <span
                data-bars
                aria-hidden
                className={cn("flex min-w-0 flex-wrap items-center gap-1", NARROW.bars)}
              >
                {rung.goes.map((take) => (
                  <Bar
                    key={take.take_number}
                    take={take}
                    missing={rung.missing}
                    longest={longest}
                    unnamed={unnamed}
                    labels={labels}
                  />
                ))}
              </span>
              <span className="text-right text-xs text-muted-foreground">
                {takesLabel(rung.goes.length)}
              </span>
            </Button>
          </Item>
        </CollapsibleTrigger>
      </WholeTip>

      {/* The rows start where the day does. */}
      <CollapsibleContent className="flex flex-col gap-1 pt-1 pb-3 pl-7.5">
        {rung.goes.map((take) => (
          <TakeRow
            key={take.take_number}
            take={take}
            unnamed={unnamed}
            longest={longest}
            missing={rung.missing}
            here={hereFor(playback, rung.folder, take)}
            onPlay={(t) => onPlay(at(t))}
            onOpen={(t) => onOpen(at(t))}
            onOpenAt={(t, sec) => onOpenAt(at(t), sec)}
            onRename={(t) => onRename(at(t))}
            onStar={(t, starred) => onStar(at(t), starred)}
            onShare={(t) => onShare(at(t))}
            onDelete={(t) => onDelete(at(t))}
            sendTo={sendTo}
          />
        ))}
        <Button
          variant="link"
          onClick={() => onOpenRehearsal(rung.folder)}
          className="h-auto max-w-full self-start p-0 text-left text-xs whitespace-normal"
        >
          Open {rung.rehearsal}, {day} in Rehearsals <span aria-hidden>→</span>
        </Button>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A take as a bar on its rung: as long as it ran against the song's
 *  longest take, with its marks as ticks and its number. Never under 6 px:
 *  its least, 0.375rem, is 6 px at 100 % but 5.4 px at 90 %. */
function Bar({
  take,
  missing,
  longest,
  unnamed,
  labels,
}: {
  take: Take
  missing: boolean
  longest: number
  unnamed: boolean
  labels: Label[]
}) {
  const length = take.duration_sec || 0
  const along = (at: number) =>
    length > 0 ? Math.min(98.5, Math.max(1, (at / length) * 100)) : 0
  return (
    <span
      data-starred={take.starred || undefined}
      className={cn(
        "relative flex h-6 shrink-0 items-center overflow-hidden rounded-sm border",
        missing ? TAKE_FILLS.quiet : take.starred ? TAKE_FILLS.starred : TAKE_FILLS.rest
      )}
      style={{ width: `max(6px, ${drawnLength(length, longest, 7.5, 0.375)}rem)` }}
    >
      {(take.markers ?? []).map((m) => (
        <MarkTick
          key={m.at}
          colour={labelOf(labels, m.label_id).colour}
          at={along(m.at)}
          className="inset-y-1"
        />
      ))}
      <span className="tnum relative pl-1.5 text-xs text-muted-foreground">
        {unnamed ? take.take_number : (take.go ?? take.take_number)}
      </span>
    </span>
  )
}
