import { CloudCheck, CloudUpload, Pencil, Trash2 } from "lucide-react"
import { Fragment, useId, useRef, type ReactNode } from "react"
import { StarButton } from "@/components/StarButton"
import { SongPills } from "@/components/SongPills"
import { useSongChoices } from "@/hooks/useSongChoices"
import { Badge } from "@/components/ui/badge"
import { Button, OPENS } from "@/components/ui/button"
import { LabelDot, MarkLine } from "@/components/ui/mark"
import { PlayButton } from "@/components/ui/play-button"
import { TakeWave } from "@/components/ui/take-wave"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { playLook } from "@/lib/playLook"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import { formatMMSS, takesLabel } from "@/lib/format"
import { labelCounts, labelOf, useLabels } from "@/lib/labels"
import { isFalseStart } from "@/lib/evening"
import { useShape } from "@/lib/shapes"
import { rise, scrollBehavior } from "@/lib/motion"
import { TakeTitle } from "@/components/TakeTitle"
import { SongName } from "@/components/SongName"
import { SetCard } from "@/components/NextTakeSongs"
import type { RehearsalSet, SendTo, Song, SongChoices, Take } from "@/lib/api"
import { isUp, sendButton, sendError, upLabel, type SendState } from "@/lib/sending"
import { takeButtonLabel, takeCloudStatus } from "@/components/TakeStrip"

const NOT_NAMED = "Not named"

/** The room after a wave, in rem: the length while it plays ("1:02 /
 *  3:20", kept the same while it does not), the ✓ of a take sent and the
 *  gaps. The longest take's wave has the rest, so every row's is to one
 *  scale, which a share of the row could not promise with the length's
 *  width fixed. */
const AFTER_WAVE = 7.5

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
 * Each take is a row: its name, and under it its wave drawn to scale — so
 * the take that ran long or stopped short is plain before anything is read, and
 * where the band played loud or stopped — with its marks where they fell,
 * and every one of them listed under it: its label's name, then its comment
 * when it has one. The comments are usually why the rehearsal was opened
 * again at all: "this one is the take", "guitar drifts here".
 *
 * Play on a row plays the take right here, with no player on screen: the
 * wave darkens as it goes. The name, the wave or anywhere else on its row
 * opens the take in the player, and a take that is playing carries on there
 * from where it was. A note opens its take at the spot it was left. ★ is on
 * every row, faint on a take with none (owner's pick B, 2026-11-02); Rename,
 * the cloud and Delete show on the row under the mouse, the same three the
 * strip offers for an open take.
 *
 * It also stands in for the take strip while nothing is open, so a take
 * still waiting for the cloud says so here, as its pill did.
 *
 * It is where an evening is sorted, too, on the night or later in History:
 * a false start (shorter than `falseStartSec`, no ★, no marks) is drawn
 * grey with a pale wave where it stands; and a take nobody named has the song
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
  /** The rehearsal's folder: for the songs a take could be named after,
   *  and for its takes' waves. */
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
                // 16 px between rows and their own 4 px each: 24 from a wave
                // to the next name. The heading keeps its 12 px.
                "flex flex-col gap-4 px-6 py-4",
                (i > 0 || head || set) && "border-t",
                i === rows.length - 1 && "pb-6",
                i === 0 && !head && !set && "pt-6"
              )}
            >
              <div className="-mb-1 flex items-baseline gap-2">
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
                    folder={folder}
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
    <div data-name-pills={take.take_number} className="-mt-2 ml-11 flex items-center gap-2">
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
 * One take as a row: ▶, its name with its wave to scale under it, its
 * marks, its length, and the buttons for it, with every mark's line under it. The rehearsal overview
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
  folder,
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
  /** Drawn grey, its wave pale, and said to be one after its length. */
  falseStart?: boolean
  longest: number
  cloudState?: SendState
  sendTo?: SendTo
  here: OverviewPlayback | null
  missing?: boolean
  where?: string
  /** Its rehearsal's folder, which its wave is asked for by: without it the
   *  wave is a flat line. */
  folder?: string
  onPlay: (take: Take) => void
  /** Opens the take in the player. Left out, the row and its name play it
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
  // is on disk: a row that is not found says that, not this, and the name's
  // description points only at what is drawn.
  const error = status && !missing && !cloudState ? sendError(take, sendTo) : undefined
  const shared = isUp(take, sendTo)
  const button = sendButton(take, sendTo)
  const starred = take.starred ?? false
  const length = take.duration_sec || here?.duration || 0
  const shape = useShape(folder, take)
  const playing = here?.playing ?? false
  // Playing, its ▶ has Space while Settings › Keys has it on.
  const spaceKeys = useKeysOn("space")

  return (
    <div
      data-take={take.take_number}
      data-false-start={falseStart || undefined}
      className="@container/row flex flex-col gap-0.5"
    >
      {/* The whole row opens the take, as its name does, the wave too: a
          short take's name is a small thing to aim at, and the row lights
          up under the mouse all the way across. The buttons on it keep their
          own jobs. The name stays the one to reach with Tab. */}
      <div
        onClick={(e) => {
          if (!missing && !(e.target as HTMLElement).closest("button")) open(take)
        }}
        className={cn(
          "group relative -mx-2 grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-lg px-2 py-1 transition-colors",
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

        {/* The name on a line of its own, then the wave, to scale, and the
            length right after it (owner's pick, 2026-11-04, as the band
            service has them): a long name is not cut to give the wave its
            room. Where the row has under 17rem, the wave and the rest wrap
            too, rather than going out over the edge of the screen: the
            buttons at the right keep their place, and at a large scale in a
            narrow window that leaves nothing else. */}
        <div className="@container min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Button
              type="button"
              variant="ghost"
              // A take not on disk is named as the row says it, whatever
              // the cloud's status.
              aria-label={takeButtonLabel(take, missing ? "Not found on disk" : status)}
              aria-describedby={error ? why : undefined}
              onClick={() => open(take)}
              disabled={missing}
              data-take-name
              data-starred={starred || undefined}
              className="h-auto max-w-full shrink-0 basis-full justify-start gap-2 rounded-sm p-0 text-left font-normal whitespace-nowrap hover:bg-transparent disabled:opacity-100 dark:hover:bg-transparent"
            >
              <span
                className={cn(
                  "flex min-w-0 text-sm",
                  !missing && OPENS,
                  (unnamed || falseStart || missing) && "text-muted-foreground"
                )}
              >
                <TakeTitle take={take} cut />
              </span>
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-x-2.5 gap-y-1 @max-[17rem]:flex-wrap">
              <TakeWave
                shape={shape}
                duration={length}
                played={here && length > 0 ? Math.min(1, Math.max(0, here.position / length)) : null}
                starred={starred}
                quiet={missing || falseStart}
                marks={(take.markers ?? []).map((m) => ({
                  at: m.at,
                  colour: labelOf(labels, m.label_id).colour,
                }))}
                className="shrink"
                // Of the row less the length's and a ✓'s, so that every
                // row's is to the one scale.
                style={{ width: `calc((100% - ${AFTER_WAVE}rem) * ${Math.min(1, take.duration_sec / longest)})` }}
              />

              {/* Nothing jumps (B4): the time played has its room kept before
                  the length, so the wave keeps its width and the length its
                  place while the take plays here. */}
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
                    {/* The name's description: the status in its label is
                        the reason's heading. */}
                    <span id={why} className="sr-only">
                      {error}
                    </span>
                  </>
                ) : (
                  <span className="truncate text-xs text-muted-foreground">{status}</span>
                )
              )}
              {/* Its rehearsal is what tells it from the others here, so the
                  wave gives way to it rather than it to the wave. */}
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
        </div>

        {missing ? (
          <div />
        ) : (
          <div className="flex items-center gap-1">
            {/* ★ on every row (owner's pick B, 2026-11-02): which takes have
                one reads down the list, and giving one needs no knowing that
                it is there under the mouse. Faint on a take with none. */}
            {onStar && (
              <StarButton
                take={take}
                onStar={onStar}
                className={cn(
                  !starred &&
                    "text-muted-foreground/45 group-focus-within:text-muted-foreground group-hover:text-muted-foreground"
                )}
              />
            )}
            {/* On the row under the mouse, or reached with Tab. Hidden, they
                still hold their place, so the rows do not shift as it moves.
                Where the row is under 36rem that place is the wave's room:
                they come over the row's end instead, on the row's own
                colour, and let a press through while they are hidden.
                Delete is set apart from the others. */}
            <div
              className={cn(
                "flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100",
                "@max-[36rem]/row:pointer-events-none @max-[36rem]/row:absolute @max-[36rem]/row:inset-y-0 @max-[36rem]/row:right-[2.75rem] @max-[36rem]/row:rounded-md @max-[36rem]/row:bg-[color-mix(in_oklab,var(--accent)_60%,var(--card))] @max-[36rem]/row:pl-1",
                "@max-[36rem]/row:group-focus-within:pointer-events-auto @max-[36rem]/row:group-hover:pointer-events-auto"
              )}
            >
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
          <MarkLine label={labelOf(labels, m.label_id)} at={m.at} note={m.note} opens className="text-sm" />
        </Button>
      ))}
    </div>
  )
}
