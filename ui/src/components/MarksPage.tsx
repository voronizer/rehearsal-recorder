import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription } from "@/components/ui/empty"
import { Item } from "@/components/ui/item"
import { LabelDot } from "@/components/ui/mark"
import { TakeWave } from "@/components/ui/take-wave"
import { PlayButton } from "@/components/ui/play-button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useCut, Whole, WholeTip } from "@/components/ui/whole"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import type { Label, MarkHit, MarksGrouping } from "@/lib/api"
import { formatClock, marksLabel } from "@/lib/format"
import {
  groupMarks,
  headLine,
  markKey,
  playFrom,
  rowLine,
  type MarkGroup,
} from "@/lib/marks"
import { rise } from "@/lib/motion"
import { playLook } from "@/lib/playLook"
import { drawnLength } from "@/lib/takeScale"
import { useShape } from "@/lib/shapes"
import { PaneHead } from "@/components/PaneHead"
import { NameLink, SongName } from "@/components/SongName"

/**
 * Where the rows have under 25rem, as at 960 px and 150 %: beside the bars'
 * 7.5rem and the length, the comment would have under 10rem. There the bar
 * and the length go under the take's line. Tailwind reads a class whole, so
 * the width is in each; this is the one place they are.
 */
const NARROW = {
  columns: "@max-[25rem]:grid-cols-[2rem_minmax(0,1fr)]",
  bar: "@max-[25rem]:col-start-2",
} as const

const GROUPINGS: { grouping: MarksGrouping; label: string }[] = [
  { grouping: "rehearsal", label: "By rehearsal" },
  { grouping: "song", label: "By song" },
  { grouping: "list", label: "One list" },
]

/** The mark playing in the list, and where its take has got to. */
export type MarkPlayback = {
  key: string
  playing: boolean
  loading: boolean
  /** The take could not be loaded: its ▶ says so, and pressing it tries again. */
  failed?: boolean
  position: number
  duration: number
}

/**
 * The right of History's Marks view: every mark with the chosen label, from
 * every rehearsal, newest first, grouped as the band chose (spec H3 to H6).
 * Its head is the pane head the other pages have, with the label's dot and
 * no pencil: a label is renamed in Settings › Marks.
 *
 * Under the head, one group: "Group by" in its head row, then a part per
 * rehearsal or song, split by lines; one list is one part with no title.
 * ▶ plays a mark's take here from just before it, and a press on its wave
 * from there; the comment, or a click on the row, opens the take in the
 * player at the mark. A mark of a rehearsal
 * not on disk is listed, greyed, with nothing to play or open.
 */
export function MarksPage({
  label,
  marks,
  grouping,
  onGrouping,
  playing,
  onPlay,
  onPlayAt,
  onOpen,
  onOpenSong,
  onOpenRehearsal,
}: {
  label: Label
  marks: MarkHit[]
  grouping: MarksGrouping
  onGrouping: (grouping: MarksGrouping) => void
  playing: MarkPlayback | null
  onPlay: (mark: MarkHit) => void
  /** Plays a mark's take here from a spot: a press on its wave. */
  onPlayAt?: (mark: MarkHit, at: number) => void
  onOpen: (mark: MarkHit) => void
  onOpenSong: (title: string | null) => void
  onOpenRehearsal: (folder: string) => void
}) {
  const empty = marks.length === 0
  const longest = Math.max(1, ...marks.map((m) => m.duration_sec || 0))

  return (
    <div className="flex flex-col gap-8">
      {/* The head holds its place from the first frame: it does not rise. */}
      <PaneHead
        lead={
          // The dot sits on the middle of the title's first line.
          <span className="flex h-7 items-center">
            <LabelDot colour={label.colour} className="size-3.5" />
          </span>
        }
        title={label.name}
        lines={<p className="text-sm text-muted-foreground">{headLine(marks)}</p>}
      />

      <div data-marks-group className="flex animate-rise flex-col rounded-xl bg-card" style={rise(1)}>
        {/* Where the row has no room for both, the words go above the switch.
            Arrows along the switch move along it; up and down are left to
            the list of labels, as on History's own switch. */}
        <div
          data-marks-head
          className="flex flex-wrap items-center justify-end gap-2 px-6 pt-6 pb-4"
        >
          <span className="text-xs whitespace-nowrap text-muted-foreground">Group by</span>
          <ToggleGroup
            type="single"
            variant="switch"
            orientation="horizontal"
            aria-label="Group marks"
            value={grouping}
            disabled={empty}
            // The grouping that is on, pressed again, would leave none on.
            onValueChange={(next) => {
              if (next && next !== grouping) onGrouping(next as MarksGrouping)
            }}
          >
            {GROUPINGS.map((g) => (
              <ToggleGroupItem
                key={g.grouping}
                value={g.grouping}
                // As on History's switch: a click lets go of the focus, so
                // ←, → and Space are the mark playing's again; a choice
                // made from the keys keeps it.
                onClick={(e) => {
                  if (e.detail > 0) e.currentTarget.blur()
                }}
              >
                {g.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {empty ? (
          <Empty>
            <EmptyDescription>
              Marks given the label {label.name} in the player gather here, from every rehearsal.
            </EmptyDescription>
          </Empty>
        ) : (
          groupMarks(marks, grouping).map((g) => (
            <div key={g.key} data-marks-part className="border-t px-6 py-4 last:pb-6">
              {g.kind !== "list" && (
                <GroupTitle group={g} onOpenSong={onOpenSong} onOpenRehearsal={onOpenRehearsal} />
              )}
              <div className="@container flex min-w-0 flex-col gap-0.5">
                {g.marks.map((m) => (
                  <MarkRow
                    key={markKey(m)}
                    mark={m}
                    label={label}
                    grouping={grouping}
                    longest={longest}
                    here={playing && playing.key === markKey(m) ? playing : null}
                    onPlay={onPlay}
                    onPlayAt={onPlayAt}
                    onOpen={onOpen}
                    onOpenSong={onOpenSong}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/**
 * A part's title: the rehearsal, which opens it in Rehearsals, or the song,
 * which opens its page; then how many marks are in the part. The name takes
 * two lines at most, then is cut, whole in the shared tip.
 */
function GroupTitle({
  group: g,
  onOpenSong,
  onOpenRehearsal,
}: {
  group: MarkGroup
  onOpenSong: (title: string | null) => void
  onOpenRehearsal: (folder: string) => void
}) {
  return (
    <h3 data-group-title className="mb-2 flex min-w-0 items-baseline gap-1 text-sm font-semibold">
      {g.kind === "rehearsal" ? (
        <NameLink
          text={g.name}
          label={`Open the rehearsal ${g.name}`}
          onOpen={() => onOpenRehearsal(g.folder!)}
          textClassName="line-clamp-2"
        />
      ) : (
        <SongName title={g.song ?? null} onOpen={onOpenSong} textClassName="line-clamp-2" />
      )}
      <span className="shrink-0 font-normal text-muted-foreground"> · {marksLabel(g.marks.length)}</span>
    </h3>
  )
}

function MarkRow({
  mark: m,
  label,
  grouping,
  longest,
  here,
  onPlay,
  onPlayAt,
  onOpen,
  onOpenSong,
}: {
  mark: MarkHit
  label: Label
  grouping: MarksGrouping
  longest: number
  here: MarkPlayback | null
  onPlay: (mark: MarkHit) => void
  onPlayAt?: (mark: MarkHit, at: number) => void
  onOpen: (mark: MarkHit) => void
  onOpenSong: (title: string | null) => void
}) {
  const line = rowLine(m, grouping)
  const said = m.note.trim()
  const comment = said || label.name
  const length = m.duration_sec || 0
  const played = here && length > 0 ? Math.min(1, Math.max(0, here.position / length)) : null
  const shape = useShape(m.folder, m)
  // Playing, its ▶ has Space while Settings › Keys has it on.
  const spaceKeys = useKeysOn("space")
  return (
    <Item
      size="sm"
      data-mark={markKey(m)}
      data-missing={m.missing || undefined}
      onClick={(e) => {
        if (!m.missing && !(e.target as HTMLElement).closest("button, [data-wave]")) onOpen(m)
      }}
      className={cn(
        "-mx-2 grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-2 py-1.5",
        NARROW.columns,
        // Lit under the pointer, and while the focus is on one of its
        // controls, as a take's row is.
        m.missing ? "opacity-55" : "cursor-pointer hover:bg-accent/60 focus-within:bg-accent/60",
        here && "bg-accent/60"
      )}
    >
      <PlayButton
        look={playLook({
          loaded: here !== null,
          playing: here?.playing ?? false,
          loading: here?.loading ?? false,
          failed: here?.failed ?? false,
          missing: m.missing,
        })}
        name={`${m.name} from ${formatClock(playFrom(m.at))}`}
        onClick={() => onPlay(m)}
        aria-keyshortcuts={here && spaceKeys ? "Space" : undefined}
      />

      <div className="flex min-w-0 flex-col gap-px">
        {m.missing ? (
          <Whole
            text={comment}
            data-line="comment"
            data-unsaid={!said || undefined}
            className={cn("truncate text-sm", !said && "text-muted-foreground")}
          />
        ) : (
          <Comment text={comment} unsaid={!said} onOpen={() => onOpen(m)} />
        )}
        {/* The song and what follows it share the line: each has half of it
            at least, or all it needs, so a long title does not push the
            take's number and moment out. */}
        <span
          data-line="take"
          className="grid grid-cols-[minmax(0,max-content)_minmax(0,max-content)] items-baseline text-xs text-muted-foreground"
        >
          {line.song !== null && (
            <SongName
              title={line.song}
              onOpen={onOpenSong}
              className="font-semibold text-foreground"
              textClassName="truncate"
            />
          )}
          {/* Its own spaces kept: the line would drop the one it starts with. */}
          <span className="tnum truncate whitespace-pre">{line.rest}</span>
        </span>
        {m.missing && <span className="text-xs text-destructive">Not found on disk</span>}
      </div>

      <div className={cn("flex items-center gap-2.5", NARROW.bar)}>
        {/* The waves line up in a column as wide as the longest. A picture:
            the length beside it says it in words. A press plays the take
            from there. */}
        <span className="w-30">
          <TakeWave
            shape={shape}
            duration={length}
            played={played}
            quiet={m.missing}
            marks={[{ at: m.at, colour: label.colour }]}
            onPress={m.missing || !onPlayAt ? undefined : (at) => onPlayAt(m, at)}
            className="h-6"
            // Never under 2rem, TakeWave's least, so a short take's wave is
            // still there to press; its length beside it says the rest.
            style={{ width: `${drawnLength(length, longest, 7.5, 0.5)}rem` }}
          />
        </span>
        <span className="tnum w-10 text-right text-xs">{formatClock(length)}</span>
      </div>
    </Item>
  )
}

/**
 * What was written at the mark, or the label's name where nothing was: the
 * row's Tab stop, which opens the take at the mark. Cut at the end of its
 * room, whole in the shared tip.
 */
function Comment({ text, unsaid, onOpen }: { text: string; unsaid: boolean; onOpen: () => void }) {
  const [ref, cut] = useCut<HTMLSpanElement>()
  return (
    <WholeTip cut={cut} text={text}>
      <Button
        variant="ghost"
        data-line="comment"
        data-unsaid={unsaid || undefined}
        onClick={onOpen}
        className={cn(
          // No frame: a clear one would set the words 1 px in from the
          // take's line under them. Nor a fill or colour of its own under the
          // pointer: the row's fill says where it is, and the keys have the ring.
          "h-auto min-w-0 justify-start border-0 p-0 text-sm font-normal hover:bg-transparent dark:hover:bg-transparent",
          unsaid ? "text-muted-foreground hover:text-muted-foreground" : "hover:text-foreground"
        )}
      >
        <span ref={ref} data-cut={cut || undefined} className="block min-w-0 truncate">
          {text}
        </span>
      </Button>
    </WholeTip>
  )
}
