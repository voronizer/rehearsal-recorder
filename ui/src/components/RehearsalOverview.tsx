import { CloudCheck, CloudUpload, Pencil, Trash2 } from "lucide-react"
import { Fragment, useId, useRef, type ReactNode } from "react"
import { StarButton } from "@/components/StarButton"
import { SongPills } from "@/components/SongPills"
import { useSongChoices } from "@/hooks/useSongChoices"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LabelDot, MarkLine, MarkTick } from "@/components/ui/mark"
import { PlayButton } from "@/components/ui/play-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { playLook } from "@/lib/playLook"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import { formatMMSS, takesLabel } from "@/lib/format"
import { labelCounts, labelOf, useLabels } from "@/lib/labels"
import { isFalseStart } from "@/lib/evening"
import { TAKE_FILLS } from "@/lib/takeScale"
import { rise, scrollBehavior } from "@/lib/motion"
import { TakeTitle } from "@/components/TakeTitle"
import { SongName } from "@/components/SongName"
import { SetCard } from "@/components/NextTakeSongs"
import type { RehearsalSet, SendTo, Song, SongChoices, Take } from "@/lib/api"
import { isUp, sendButton, sendError, upLabel, type SendState } from "@/lib/sending"
import { takeButtonLabel, takeCloudStatus } from "@/components/TakeStrip"

const NOT_NAMED = "Not named"

/** How much of its row the longest take's bar takes. The rest is for its
 *  length and the cloud beside it, so the longest bar and a short one read
 *  on the same scale without the longest one pushing its label out. */
const BAR_SHARE = 88

/** The take playing in the overview, and where it is. */
export type OverviewPlayback = {
  take: number
  playing: boolean
  loading: boolean
  /** The take could not be loaded: its ▶ says so, and pressing it tries again. */
  failed?: boolean
  position: number
  duration: number
}


/**
 * What an open rehearsal shows before a take is picked: every song, every take
 * of it, and every note left while listening.
 *
 * The songs are one group: the label legend at its head on the left, the
 * screen's `actions` (Send starred, Clear false starts) on the right, then,
 * for an evening played by a set (`set`), the set's card, then each song, all
 * under 1 px lines, a take nobody named last of them. The evening's figures
 * are not here: the header says them, and it is in view with a take open too.
 *
 * Each take is a row: a bar drawn to scale — so the take that ran long or
 * stopped short is plain before anything is read — with its marks where
 * they fell, and every one of them listed under it: its label's name, then
 * its comment when it has one. The comments are usually why the rehearsal
 * was opened again at all: "this one is the take", "guitar drifts here".
 *
 * Play on a row plays the take right here, with no player on screen: the bar
 * fills as it goes. The bar, or anywhere else on its row, opens the take in
 * the player, and a take that is playing carries on there from where it was.
 * A note opens its take at the spot it was left. ★, Rename, the cloud and
 * Delete show on the row under the mouse, ★ staying in view on a starred
 * take; Rename, the cloud and Delete are the same three the strip offers for
 * an open take.
 *
 * It also stands in for the take strip while nothing is open, so a take
 * still waiting for the cloud says so here, as its pill did.
 *
 * It is where an evening is sorted, too, on the night or later in History:
 * a false start (shorter than `falseStartSec`, no ★, no marks) is drawn
 * grey with a dashed bar where it stands; and a take nobody named has the song
 * pills under it, one click naming it (`onName`).
 */
export function RehearsalOverview({
  takes,
  songs,
  cloudStates,
  sendTo = "cloud",
  playback,
  onPlay,
  onOpen,
  onOpenAt,
  onRename,
  onStar,
  onShare,
  onDelete,
  onOpenSong,
  falseStartSec,
  folder,
  onName,
  actions,
  set,
  rise: place = 0,
}: {
  takes: Take[]
  songs: Song[]
  cloudStates?: Record<number, SendState>
  /** Where takes go: the cloud button's words and the status are its. */
  sendTo?: SendTo
  /** The take loaded from here, or null. */
  playback: OverviewPlayback | null
  onPlay: (take: Take) => void
  onOpen: (take: Take) => void
  onOpenAt: (take: Take, at: number) => void
  onRename?: (take: Take) => void
  onStar?: (take: Take, starred: boolean) => void
  onShare?: (take: Take) => void
  onDelete?: (take: Take) => void
  /** Opens a song's page in History's Songs view; null is Not named's. */
  onOpenSong?: (title: string | null) => void
  /** Left out, no take is drawn as a false start. */
  falseStartSec?: number
  /** The rehearsal's folder, for the songs a take could be named after. */
  folder?: string
  /** Names a take after a song from its pills; left out, there are none. */
  onName?: (take: Take, title: string) => void
  /** Drawn on the right of the group's head. */
  actions?: ReactNode
  /** The set it was played by, as History has it: the group's first part,
   *  a card of what was played of it, over the songs. */
  set?: RehearsalSet | null
  /** The songs' group's place in the line the screen's groups rise in by
   *  (lib/motion's rise): 0 where it is the first, as on the rehearsal
   *  screen; History's list rises first. */
  rise?: number
}) {
  const labels = useLabels()
  const byNumber = new Map(takes.map((t) => [t.take_number, t]))
  const rows = songs
    .map((s) => ({
      name: s.name,
      takes: (s.take_numbers ?? [])
        .map((n) => byNumber.get(n))
        .filter((t): t is Take => t !== undefined),
    }))
    .filter((r) => r.takes.length > 0)
  const grouped = new Set(rows.flatMap((r) => r.takes.map((t) => t.take_number)))
  const unnamed = takes.filter((t) => !grouped.has(t.take_number))
  if (unnamed.length > 0) rows.push({ name: NOT_NAMED, takes: unnamed })

  const longest = Math.max(1, ...takes.map((t) => t.duration_sec || 0))
  // Every mark counts, a plain one with nothing written included (spec D2).
  const counts = labelCounts(labels, takes.flatMap((t) => t.markers ?? []))
  const legend = counts.length > 0 && (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {counts.map(({ label, n }) => (
        <span key={label.id} className="flex items-center gap-2">
          <LabelDot colour={label.colour} />
          {n} {label.name}
        </span>
      ))}
    </div>
  )
  // Anything renamed or added changes the number each pill offers (the 3 of
  // "Pałyn 3"). A take nobody named would get the same number at any song as
  // another one would, so one look, which reads the whole library, serves them all.
  const version = takes.map((t) => `${t.take_number}:${t.name}`).join("|")
  const naming = onName !== undefined && folder !== undefined
  const nameChoices = useSongChoices(naming && unnamed.length > 0, folder, null, version)
  // Each song's group, for the set card to go to.
  const groups = useRef(new Map<string, HTMLElement>())

  // The legend on the left and the buttons on the right; too narrow for both,
  // the buttons go to a line of their own, still on the right.
  const head = (actions || legend) && (
    <div
      data-overview-head
      className="flex flex-wrap items-center justify-between gap-x-8 gap-y-2 px-6 pt-6 pb-4"
    >
      {legend || <span />}
      {actions && <div className="ml-auto flex flex-wrap justify-end gap-2">{actions}</div>}
    </div>
  )

  return (
    <section aria-label="Rehearsal overview" className="flex flex-col">
      <div data-songs-group className="flex animate-rise flex-col rounded-xl bg-card" style={rise(place)}>
        {head}
        {/* The set the evening was played by is the group's first part: what
            was played of it, each song played going to its own below. The
            card's title lines up with the songs' names; its rows reach 8 px
            further out, as a take's row does. */}
        {set && (
          <div data-set-part className={cn("px-6 py-6", head && "border-t")}>
            <div className="-mx-2">
              <SetCard
                set={set}
                goes={new Map(rows.map((r) => [r.name, r.takes.length]))}
                onGoTo={(title) =>
                  groups.current
                    .get(title)
                    ?.scrollIntoView({ behavior: scrollBehavior(), block: "start" })
                }
              />
            </div>
          </div>
        )}
        {rows.map((row, i) => {
          const isUnnamed = row.name === NOT_NAMED
          return (
            <div
              key={row.name}
              ref={(el) => {
                if (el) groups.current.set(row.name, el)
                else groups.current.delete(row.name)
              }}
              role="group"
              aria-label={row.name}
              data-song-group
              // A line above each song, under the head or the song before.
              className={cn(
                "flex flex-col gap-3 px-6 py-4",
                (i > 0 || head || set) && "border-t",
                i === rows.length - 1 && "pb-6",
                i === 0 && !head && !set && "pt-6"
              )}
            >
              <div className="flex items-baseline gap-2">
                <h3
                  className={cn(
                    "text-base",
                    isUnnamed ? "text-muted-foreground" : "font-semibold"
                  )}
                >
                  <SongName title={isUnnamed ? null : row.name} onOpen={onOpenSong} />
                </h3>
                <span className="text-xs text-muted-foreground">
                  {takesLabel(row.takes.length)}
                </span>
              </div>
              {row.takes.map((t) => (
                <Fragment key={t.take_number}>
                  <TakeRow
                    take={t}
                    unnamed={isUnnamed}
                    falseStart={falseStartSec !== undefined && isFalseStart(t, falseStartSec)}
                    longest={longest}
                    cloudState={cloudStates?.[t.take_number]}
                    sendTo={sendTo}
                    here={playback?.take === t.take_number ? playback : null}
                    onPlay={onPlay}
                    onOpen={onOpen}
                    onOpenAt={onOpenAt}
                    onRename={onRename}
                    onStar={onStar}
                    onShare={onShare}
                    onDelete={onDelete}
                  />
                  {isUnnamed && onName && nameChoices && (
                    <NamePills take={t} choices={nameChoices} onName={onName} />
                  )}
                </Fragment>
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The songs a take nobody named could be, under it: one row of the Next take
 * field's pills, tonight's songs first, each as the name the take would get. A
 * click names it, and it moves into that song.
 */
function NamePills({
  take,
  choices,
  onName,
}: {
  take: Take
  choices: SongChoices
  onName: (take: Take, title: string) => void
}) {
  if (choices.here.length + choices.other.length === 0) return null
  return (
    <div data-name-pills={take.take_number} className="-mt-1 ml-11 flex items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">Name:</span>
      <div className="min-w-0 flex-1">
        <SongPills
          choices={choices}
          value=""
          initial=""
          rows={1}
          onPick={(title) => onName(take, title)}
        />
      </div>
    </div>
  )
}

/**
 * What a bar is filled with, `TAKE_FILLS` and what it does under the pointer:
 * it goes to the accent, in the dark theme too, where Button's ghost hover is
 * half strength; a starred bar keeps the card's fill and its tint deepens.
 * A false start and a take not on disk are both `quiet`.
 */
const FILLS = {
  rest: `${TAKE_FILLS.rest} hover:bg-accent dark:hover:bg-accent`,
  starred: `${TAKE_FILLS.starred} hover:bg-card hover:from-signal/15 hover:to-signal/15 dark:hover:bg-card`,
  quiet: `${TAKE_FILLS.quiet} hover:bg-accent dark:hover:bg-accent`,
} as const

/**
 * One take as a row: ▶, its bar to scale with its marks, its length, and the
 * buttons for it, with every mark's line under it. The rehearsal overview
 * draws one per take; a song's page, one per take of the song.
 *
 * On a song's page a row can be of a rehearsal whose folder is not on disk
 * (`missing`): it says so, and has nothing to play, open or change. `where`
 * names its rehearsal and day, for a row away from its rehearsal's rung.
 */
export function TakeRow({
  take,
  unnamed,
  falseStart = false,
  longest,
  cloudState,
  sendTo = "cloud",
  here,
  missing = false,
  where,
  onPlay,
  onOpen,
  onOpenAt,
  onRename,
  onStar,
  onShare,
  onDelete,
}: {
  take: Take
  unnamed: boolean
  /** Drawn grey, its bar dashed, and said to be one after its length. */
  falseStart?: boolean
  longest: number
  cloudState?: SendState
  sendTo?: SendTo
  here: OverviewPlayback | null
  missing?: boolean
  where?: string
  onPlay: (take: Take) => void
  /** Opens the take in the player. Left out, the row and its bar play it
   *  where it is, as the rehearsal screen's earlier takes do. */
  onOpen?: (take: Take) => void
  onOpenAt: (take: Take, at: number) => void
  onRename?: (take: Take) => void
  onStar?: (take: Take, starred: boolean) => void
  onShare?: (take: Take) => void
  onDelete?: (take: Take) => void
}) {
  const labels = useLabels()
  const why = useId()
  const open = onOpen ?? onPlay
  const status = takeCloudStatus(take, cloudState, sendTo)
  // Why the copy failed, when it did and nothing is on its way, and the take
  // is on disk: a row that is not found says that, not this, and the bar's
  // description points only at what is drawn.
  const error = status && !missing && !cloudState ? sendError(take, sendTo) : undefined
  const shared = isUp(take, sendTo)
  const button = sendButton(take, sendTo)
  const starred = take.starred ?? false
  const length = take.duration_sec || here?.duration || 0
  const along = (at: number) =>
    length > 0 ? Math.min(98.5, Math.max(1, (at / length) * 100)) : 0
  const played =
    here && length > 0 ? Math.min(100, Math.max(0, (here.position / length) * 100)) : null
  const playing = here?.playing ?? false
  // Playing, its ▶ has Space while Settings › Keys has it on.
  const spaceKeys = useKeysOn("space")

  return (
    <div
      data-take={take.take_number}
      data-false-start={falseStart || undefined}
      className="flex flex-col gap-0.5"
    >
      {/* The whole row opens the take, as its bar does: a short take's bar
          is a small thing to aim at, and the row lights up under the mouse
          all the way across. The buttons on it keep their own jobs. The bar
          stays the one to reach with Tab. */}
      <div
        onClick={(e) => {
          if (!missing && !(e.target as HTMLElement).closest("button")) open(take)
        }}
        className={cn(
          "group -mx-2 grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-1 transition-colors",
          missing
            ? "opacity-55"
            : "cursor-pointer hover:bg-accent/60 focus-within:bg-accent/60",
          here && "bg-accent/60"
        )}
      >
        <PlayButton
          look={playLook({
            loaded: here !== null,
            playing,
            loading: here?.loading ?? false,
            failed: here?.failed ?? false,
            missing,
          })}
          name={take.name}
          onClick={() => onPlay(take)}
          aria-keyshortcuts={here && spaceKeys ? "Space" : undefined}
        />

        {/* Where the row has under 17rem for the bar, the length, the badge and
            the rest, and they do not fit with the bar at its smallest, what
            follows the bar goes under it, rather than out over the edge of
            the screen: the buttons at the right keep their place, and at a
            large scale in a narrow window that leaves nothing else. The bar
            asks for 6rem and has the rest of the line up to its share, so
            that it is the first to give way. */}
        <div className="@container min-w-0">
          <div className="flex items-center gap-x-2.5 gap-y-1 @max-[17rem]:flex-wrap">
            <Button
              type="button"
              variant="ghost"
              // A take not on disk is named as the row says it, whatever
              // the cloud's status.
              aria-label={takeButtonLabel(take, missing ? "Not found on disk" : status)}
              aria-describedby={error ? why : undefined}
              onClick={() => open(take)}
              disabled={missing}
              data-starred={starred || undefined}
              className={cn(
                "relative h-8 min-w-24 flex-[1_1_6rem] justify-start gap-2 overflow-hidden rounded-sm px-2.5 py-0 text-left whitespace-nowrap disabled:opacity-100",
                missing || falseStart ? FILLS.quiet : starred ? FILLS.starred : FILLS.rest
              )}
              style={{ maxWidth: `${(take.duration_sec / longest) * BAR_SHARE}%` }}
            >
              {/* In this order, so each is over the one before: the ticks, then
                  the number and the name on their backing, which a mark in a
                  take's first seconds would otherwise strike out, then the part
                  played, which washes over the name, and the playhead, over
                  everything. */}
              {(take.markers ?? []).map((m) => (
                <MarkTick
                  key={m.at}
                  colour={labelOf(labels, m.label_id).colour}
                  at={along(m.at)}
                  className="inset-y-[5px]"
                />
              ))}
              <span
                data-bar-title
                className="relative -mx-1 flex min-w-0 items-center gap-2 rounded-sm px-1 [background:inherit]"
              >
                <span className="tnum text-xs text-muted-foreground">
                  {String(take.take_number).padStart(2, "0")}
                </span>
                <span
                  className={cn(
                    "flex min-w-0 text-sm",
                    (unnamed || falseStart) && "text-muted-foreground"
                  )}
                >
                  <TakeTitle take={take} cut />
                </span>
              </span>
              {played !== null && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-primary/20"
                  style={{ width: `${played}%` }}
                />
              )}
              {played !== null && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 w-0.5 bg-primary"
                  style={{ left: `${played}%` }}
                />
              )}
            </Button>

            {/* Nothing jumps (B4): the time played has its room kept before
                the length, so the bar keeps its width and the length its place
                while the take plays here. */}
            <span className={cn("tnum grid shrink-0 justify-items-end text-sm", falseStart && "text-muted-foreground")}>
              <span aria-hidden className="invisible col-start-1 row-start-1">
                {formatMMSS(here ? here.duration || take.duration_sec : take.duration_sec)} /{" "}
                {formatMMSS(take.duration_sec)}
              </span>
              <span className="col-start-1 row-start-1">
                {here && (
                  <>
                    <span className="text-primary">{formatMMSS(here.position)}</span>
                    {" / "}
                  </>
                )}
                {formatMMSS(take.duration_sec)}
              </span>
            </span>
            {falseStart && <Badge variant="warn">false start</Badge>}
            {shared && (
              <CloudCheck
                data-in-cloud
                aria-label={upLabel(sendTo)}
                className="size-3.5 shrink-0 text-signal"
              />
            )}
            {status && !missing && (
              error ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate text-xs text-destructive">{status}</span>
                    </TooltipTrigger>
                    <TooltipContent>{error}</TooltipContent>
                  </Tooltip>
                  {/* The bar's description: the status in its name is the
                      reason's heading. */}
                  <span id={why} className="sr-only">
                    {error}
                  </span>
                </>
              ) : (
                <span className="truncate text-xs text-muted-foreground">{status}</span>
              )
            )}
            {/* Its rehearsal is what tells it from the others here, so the
                bar gives way to it rather than it to the bar. */}
            {where && (
              <span className="max-w-1/2 shrink-0 truncate text-xs text-muted-foreground">
                {where}
              </span>
            )}
            {missing && (
              <span className="shrink-0 text-xs text-destructive">Not found on disk</span>
            )}
          </div>
        </div>

        {missing ? (
          <div />
        ) : (
          <div className="flex items-center gap-1">
            {/* ★ stays in view on a starred take, so which ones they are reads
                down the list; on the others it shows with the rest. */}
            {onStar && (
              <StarButton
                take={take}
                onStar={onStar}
                className={cn(
                  !starred &&
                    "opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                )}
              />
            )}
            {/* On the row under the mouse, or reached with Tab. Hidden, they
                still hold their place, so the rows do not shift as it moves.
                Delete is set apart from the others. */}
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {onRename && (
                <Button
                  variant="ghost"
                  size="icon-row"
                  aria-label={`Rename take ${take.name}`}
                  onClick={() => onRename(take)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil />
                </Button>
              )}
              {onShare && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-row"
                      aria-label={button.label}
                      onClick={() => onShare(take)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <CloudUpload />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {button.tip}
                  </TooltipContent>
                </Tooltip>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon-row"
                  aria-label={`Delete take ${take.name}`}
                  onClick={() => onDelete(take)}
                  className="ml-2 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Every mark has its line, a plain one with nothing written included
          (spec D2): its label's name, then its comment. */}
      {!missing && (take.markers ?? []).map((m) => (
        <Button
          key={m.at}
          type="button"
          variant="ghost"
          size="row"
          onClick={() => onOpenAt(take, m.at)}
          className="ml-10 h-7 max-w-[calc(100%-2.5rem)] justify-start self-start px-2 text-left"
        >
          <MarkLine label={labelOf(labels, m.label_id)} at={m.at} note={m.note} className="text-sm" />
        </Button>
      ))}
    </div>
  )
}
