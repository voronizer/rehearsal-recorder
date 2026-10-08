import { Loader2, Pause, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Label, MarkHit, MarksGrouping } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { labelLook } from "@/lib/labels"
import {
  groupMarks,
  headLine,
  markKey,
  marksLabel,
  playFrom,
  rowLine,
  type MarkGroup,
} from "@/lib/marks"

const GROUPINGS: { grouping: MarksGrouping; label: string }[] = [
  { grouping: "rehearsal", label: "By rehearsal" },
  { grouping: "song", label: "By song" },
  { grouping: "list", label: "One list" },
]

/** How wide the longest take's bar is; the others are drawn to its scale. */
const BAR_PX = 120

/** The mark playing in the list, and where its take has got to. */
export type MarkPlayback = {
  key: string
  playing: boolean
  loading: boolean
  position: number
  duration: number
}

/**
 * The right of History's Marks view: every mark with the chosen label, from
 * every rehearsal, newest first, grouped as the band chose (spec H3 to H6).
 * ▶ plays a mark's take here from just before it; a click opens the take in
 * the player at the mark. A mark of a rehearsal not on disk is listed,
 * greyed, with nothing to play or open.
 */
export function MarksPage({
  label,
  marks,
  grouping,
  onGrouping,
  playing,
  onPlay,
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
  onOpen: (mark: MarkHit) => void
  onOpenSong: (title: string | null) => void
  onOpenRehearsal: (folder: string) => void
}) {
  const look = labelLook(label.colour)
  const empty = marks.length === 0
  const longest = Math.max(1, ...marks.map((m) => m.duration_sec || 0))

  const heading = (g: MarkGroup) => (
    <h3
      data-group-title
      className="mb-1.5 flex min-w-0 items-baseline gap-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
    >
      <button
        type="button"
        onClick={() => (g.kind === "rehearsal" ? onOpenRehearsal(g.folder!) : onOpenSong(g.song ?? null))}
        title={g.kind === "rehearsal" ? "Open the rehearsal" : "Open the song's page"}
        className="min-w-0 truncate rounded-sm uppercase hover:text-foreground hover:underline hover:underline-offset-3"
      >
        {g.name}
      </button>
      <span className="shrink-0 font-medium tracking-normal normal-case"> · {marksLabel(g.marks.length)}</span>
    </h3>
  )

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className={cn("size-3.5 shrink-0 rounded-full", look.dot)} />
        <div className="min-w-48 flex-1">
          <h2 className="truncate text-[26px] leading-tight font-semibold">{label.name}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{headLine(marks)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">Group by</span>
          <div role="group" aria-label="Group marks" className="flex gap-1 rounded-lg bg-muted p-1">
            {GROUPINGS.map((g) => (
              <button
                key={g.grouping}
                type="button"
                disabled={empty}
                aria-pressed={grouping === g.grouping}
                onClick={() => grouping !== g.grouping && onGrouping(g.grouping)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors disabled:opacity-50",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  grouping === g.grouping
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground enabled:hover:text-foreground"
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {empty ? (
        <p className="max-w-[60ch] text-[13px] text-muted-foreground">
          Marks given the label {label.name} in the player gather here, from every rehearsal.
        </p>
      ) : (
        groupMarks(marks, grouping).map((g) => (
          <div key={g.key} className="flex min-w-0 flex-col gap-0.5">
            {g.kind !== "list" && heading(g)}
            {g.marks.map((m) => (
              <MarkRow
                key={markKey(m)}
                mark={m}
                label={label}
                grouping={grouping}
                longest={longest}
                here={playing && playing.key === markKey(m) ? playing : null}
                onPlay={onPlay}
                onOpen={onOpen}
                onOpenSong={onOpenSong}
              />
            ))}
          </div>
        ))
      )}
    </div>
  )
}

function MarkRow({
  mark: m,
  label,
  grouping,
  longest,
  here,
  onPlay,
  onOpen,
  onOpenSong,
}: {
  mark: MarkHit
  label: Label
  grouping: MarksGrouping
  longest: number
  here: MarkPlayback | null
  onPlay: (mark: MarkHit) => void
  onOpen: (mark: MarkHit) => void
  onOpenSong: (title: string | null) => void
}) {
  const playing = here?.playing ?? false
  const line = rowLine(m, grouping)
  const said = m.note.trim()
  const length = m.duration_sec || 0
  const along = (sec: number) => (length > 0 ? Math.min(100, (100 * sec) / length) : 0)
  return (
    <div
      data-mark={markKey(m)}
      data-missing={m.missing || undefined}
      onClick={(e) => {
        if (!m.missing && !(e.target as HTMLElement).closest("button")) onOpen(m)
      }}
      className={cn(
        "-mx-2 grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-1.5 transition-colors",
        m.missing ? "opacity-55" : "cursor-pointer hover:bg-accent/60",
        here && "bg-accent/60"
      )}
    >
      {m.missing ? (
        <button
          type="button"
          disabled
          aria-label={`Play ${m.name} from ${formatClock(playFrom(m.at))}`}
          title="Not found on disk"
          className="size-8 rounded-full border border-dashed"
        />
      ) : (
        <button
          type="button"
          onClick={() => onPlay(m)}
          aria-label={playing ? `Pause ${m.name}` : `Play ${m.name} from ${formatClock(playFrom(m.at))}`}
          aria-keyshortcuts={here ? "Space" : undefined}
          title="Plays the take from 5 s before the mark, here"
          className={cn(
            "flex size-8 items-center justify-center rounded-full border transition-colors",
            here ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
          )}
        >
          {here?.loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : playing ? (
            <Pause className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 fill-current" />
          )}
        </button>
      )}

      <div className="flex min-w-0 flex-col gap-px">
        {m.missing ? (
          <span
            data-line="comment"
            data-unsaid={!said || undefined}
            title={said || label.name}
            className={cn("truncate text-[13.5px]", !said && "text-muted-foreground")}
          >
            {said || label.name}
          </span>
        ) : (
          <button
            type="button"
            data-line="comment"
            data-unsaid={!said || undefined}
            onClick={() => onOpen(m)}
            title={said || label.name}
            className={cn(
              "truncate text-left text-[13.5px] focus-visible:underline focus-visible:outline-none",
              !said && "text-muted-foreground"
            )}
          >
            {said || label.name}
          </button>
        )}
        <span data-line="take" className="truncate text-xs text-muted-foreground">
          {line.song !== null && (
            <button
              type="button"
              onClick={() => onOpenSong(line.song)}
              title="Open the song's page"
              className="font-medium text-foreground hover:underline hover:underline-offset-3"
            >
              {line.song}
            </button>
          )}
          <span className="tnum">{line.rest}</span>
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <span className="w-[120px]">
          <span
            title={`${m.name} · ${formatClock(length)}`}
            className="relative block h-[22px] rounded-[5px] border bg-muted"
            style={{ width: `${Math.max(8, Math.round((length / longest) * BAR_PX))}px` }}
          >
            <span
              aria-hidden
              className={cn("absolute inset-y-[4px] w-[3px] -translate-x-px rounded-sm", labelLook(label.colour).dot)}
              style={{ left: `${along(m.at)}%` }}
            />
            {here && (
              <span
                aria-hidden
                data-playhead
                className="absolute inset-y-px w-0.5 rounded-sm bg-foreground"
                style={{ left: `${along(here.position)}%` }}
              />
            )}
          </span>
        </span>
        <span className="tnum w-10 text-right text-[12.5px]">{formatClock(length)}</span>
        {m.missing && <span className="text-xs whitespace-nowrap text-muted-foreground">not on disk</span>}
      </div>
    </div>
  )
}
