import {
  CloudCheck,
  CloudUpload,
  Loader2,
  Pause,
  Pencil,
  Play,
  Trash2,
} from "lucide-react"
import { Fragment, useRef, type ReactNode } from "react"
import { StarButton } from "@/components/StarButton"
import { SongPills } from "@/components/SongPills"
import { useSongChoices } from "@/hooks/useSongChoices"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatMMSS, takesLabel } from "@/lib/format"
import { labelCounts, labelLook, labelOf, markText, useLabels } from "@/lib/labels"
import { isFalseStart } from "@/lib/evening"
import { motionOff } from "@/lib/motion"
import { TakeTitle } from "@/components/TakeTitle"
import { SongName } from "@/components/SongName"
import { SetPlayedCard } from "@/components/SetPlayed"
import type { RehearsalSet, Song, SongChoices, Take } from "@/lib/api"
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
  position: number
  duration: number
}

function inCloud(take: Take): boolean {
  return Boolean(take.cloud?.mix || take.cloud?.tracks)
}

/**
 * What an open rehearsal shows before a take is picked: every song, every go
 * at it, and every note left while listening.
 *
 * It used to be a line of small chips per song and a list of notes under
 * them. Each go is now a row: a bar drawn to scale — so the go that ran long
 * or stopped short is plain before anything is read — with its marks where
 * they fell, and every one of them listed under it: its label's name, then
 * its comment when it has one. The comments are usually why the rehearsal
 * was opened again at all: "this one is the take", "guitar drifts here".
 *
 * Play on a row plays the take right here, with no player on screen: the bar
 * fills as it goes. The bar, or anywhere else on its row, opens the take in
 * the player, and a take that is playing carries on there from where it was. A note opens its take at the
 * spot it was left. ★, Rename, the cloud and Delete show on the row under the
 * mouse, ★ staying in view on a starred take; Rename, the cloud and Delete
 * are the same three the strip offers for an open take.
 *
 * It also stands in for the take strip while nothing is open, so a take
 * still waiting for the cloud says so here, as its pill did.
 *
 * It is where an evening is sorted, too, on the night or later in History:
 * a false start (shorter than `falseStartSec`, no ★, no marks) is drawn
 * grey with a dashed bar where it stands; a take nobody named has the song
 * pills under it, one click naming it (`onName`); and the screen's
 * `actions`, Send starred and Clear false starts, sit in the row of figures,
 * the legend of marks moving to a line of its own under them.
 */
export function RehearsalOverview({
  takes,
  songs,
  cloudStates,
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
}: {
  takes: Take[]
  songs: Song[]
  cloudStates?: Record<number, "queued" | "working">
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
  /** Drawn on the right of the row of figures. */
  actions?: ReactNode
  /** The set it was played by, as History has it: a card of what was
   *  played over the songs. */
  set?: RehearsalSet | null
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
  const songCount = rows.length
  const grouped = new Set(rows.flatMap((r) => r.takes.map((t) => t.take_number)))
  const unnamed = takes.filter((t) => !grouped.has(t.take_number))
  if (unnamed.length > 0) rows.push({ name: NOT_NAMED, takes: unnamed })

  const total = takes.reduce((sum, t) => sum + (t.duration_sec || 0), 0)
  const longest = Math.max(1, ...takes.map((t) => t.duration_sec || 0))
  const shared = takes.filter(inCloud).length
  // Every mark counts, a plain one with nothing written included (spec D2).
  const counts = labelCounts(labels, takes.flatMap((t) => t.markers ?? []))
  const legend = counts.length > 0 && (
    <div className="ml-auto flex flex-wrap justify-end gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
      {counts.map(({ label, n }) => (
        <span key={label.id} className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", labelLook(label.colour).dot)} />
          {n} {label.name}
        </span>
      ))}
    </div>
  )
  // Anything renamed or added changes the go each pill offers. A take
  // nobody named would be the same go at any song as another one, so one
  // look, which reads the whole library, serves them all.
  const version = takes.map((t) => `${t.take_number}:${t.name}`).join("|")
  const naming = onName !== undefined && folder !== undefined
  const nameChoices = useSongChoices(naming && unnamed.length > 0, folder, null, version)
  // Each song's group, for the set card to go to.
  const groups = useRef(new Map<string, HTMLElement>())

  return (
    <section aria-label="Rehearsal overview" className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2 px-1 pb-1">
        <div className="flex flex-wrap items-end gap-x-9 gap-y-3">
          <Stat value={formatMMSS(total)} label="played" />
          <Stat value={String(takes.length)} label={takes.length === 1 ? "take" : "takes"} />
          {songCount > 0 && (
            <Stat value={String(songCount)} label={songCount === 1 ? "song" : "songs"} />
          )}
          {shared > 0 && (
            <Stat value={`${shared} of ${takes.length}`} label="in the cloud" />
          )}
          {/* Too narrow for both, the buttons go to a line of their own,
              still on the right. */}
          {actions ? (
            <div className="ml-auto flex flex-wrap justify-end gap-2 self-center">{actions}</div>
          ) : (
            legend
          )}
        </div>
        {actions && legend}
      </div>

      {set && (
        <SetPlayedCard
          set={set}
          goes={new Map(rows.map((r) => [r.name, r.takes.length]))}
          onGoTo={(title) =>
            groups.current
              .get(title)
              ?.scrollIntoView({ behavior: motionOff() ? "auto" : "smooth", block: "start" })
          }
        />
      )}

      {rows.map((row) => {
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
            className={cn(
              "flex flex-col gap-2.5 rounded-xl border px-4 pt-3.5 pb-3",
              isUnnamed ? "border-dashed" : "bg-card"
            )}
          >
            <div className="flex items-baseline gap-2.5">
              <h3
                className={cn(
                  "text-base",
                  isUnnamed ? "text-muted-foreground" : "font-semibold"
                )}
              >
                <SongName title={isUnnamed ? null : row.name} onOpen={onOpenSong} />
              </h3>
              <span className="text-xs text-muted-foreground">
                {isUnnamed
                  ? takesLabel(row.takes.length)
                  : row.takes.length === 1
                    ? "1 go"
                    : `${row.takes.length} goes`}
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
    </section>
  )
}

/**
 * The songs a take nobody named could be, under it: one row of the Next take
 * field's pills, tonight's songs first, each as the go the take would be. A
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
    <div data-name-pills={take.take_number} className="-mt-1.5 ml-11 flex items-center gap-2.5">
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

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="tnum text-[22px] leading-tight">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

/**
 * One take as a row: ▶, its bar to scale with its marks, its length, and the
 * buttons for it, with every mark's line under it. The rehearsal overview
 * draws one per take; a song's page, one per go.
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
  cloudState?: "queued" | "working"
  here: OverviewPlayback | null
  missing?: boolean
  where?: string
  onPlay: (take: Take) => void
  /** Opens the take in the player. Left out, the row and its bar play it
   *  where it is, as the rehearsal screen's earlier goes do. */
  onOpen?: (take: Take) => void
  onOpenAt: (take: Take, at: number) => void
  onRename?: (take: Take) => void
  onStar?: (take: Take, starred: boolean) => void
  onShare?: (take: Take) => void
  onDelete?: (take: Take) => void
}) {
  const labels = useLabels()
  const open = onOpen ?? onPlay
  const status = takeCloudStatus(take, cloudState)
  const shared = inCloud(take)
  const starred = take.starred ?? false
  const length = take.duration_sec || here?.duration || 0
  const along = (at: number) =>
    length > 0 ? Math.min(98.5, Math.max(1, (at / length) * 100)) : 0
  const played =
    here && length > 0 ? Math.min(100, Math.max(0, (here.position / length) * 100)) : null
  const playing = here?.playing ?? false

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
        {missing ? (
          <span
            title="Not found on disk"
            className="size-8 rounded-full border border-dashed"
          />
        ) : (
          <button
            type="button"
            onClick={() => onPlay(take)}
            aria-label={`${playing ? "Pause" : "Play"} ${take.name}`}
            aria-keyshortcuts={here ? "Space" : undefined}
            className={cn(
              "flex size-8 items-center justify-center rounded-full border transition-colors",
              here
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-accent"
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

        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            aria-label={takeButtonLabel(take, status)}
            title={missing ? "Not found on disk" : onOpen ? "Open it in the player" : "Play it here"}
            onClick={() => open(take)}
            disabled={missing}
            data-starred={starred || undefined}
            className={cn(
              "relative flex h-8 min-w-24 shrink items-center gap-2 overflow-hidden rounded-lg border px-2.5 text-left whitespace-nowrap transition-colors",
              missing
                ? "border-dashed border-muted-foreground/45 bg-transparent"
                : starred
                  ? "border-signal/50 bg-signal/10 hover:bg-signal/15"
                  : falseStart
                    ? "border-dashed border-muted-foreground/45 bg-transparent hover:bg-accent"
                    : "bg-muted hover:bg-accent"
            )}
            style={{ width: `${(take.duration_sec / longest) * BAR_SHARE}%` }}
          >
            {played !== null && (
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 bg-primary/20"
                style={{ width: `${played}%` }}
              />
            )}
            {/* Under the number and the name, which are drawn after them: a
                mark in a take's first seconds otherwise struck its number
                out. The playhead, last, stays over everything. */}
            {(take.markers ?? []).map((m) => {
              const label = labelOf(labels, m.label_id)
              return (
                <span
                  key={m.at}
                  aria-hidden
                  data-mark-colour={label.colour}
                  className={cn("absolute inset-y-[5px] w-[3px] rounded-sm", labelLook(label.colour).dot)}
                  style={{ left: `${along(m.at)}%` }}
                />
              )
            })}
            <span className="tnum relative text-[11px] text-muted-foreground">
              {String(take.take_number).padStart(2, "0")}
            </span>
            <span
              className={cn(
                "relative flex min-w-0 text-[13px]",
                (unnamed || falseStart) && "text-muted-foreground"
              )}
            >
              <TakeTitle take={take} cut />
            </span>
            {played !== null && (
              <span
                aria-hidden
                className="absolute inset-y-0 w-0.5 bg-primary"
                style={{ left: `${played}%` }}
              />
            )}
          </button>

          <span className={cn("tnum shrink-0 text-[13px]", falseStart && "text-muted-foreground")}>
            {here && (
              <>
                <span className="text-primary">{formatMMSS(here.position)}</span>
                {" / "}
              </>
            )}
            {formatMMSS(take.duration_sec)}
          </span>
          {falseStart && (
            <span className="shrink-0 rounded-full border border-warn/50 px-2 text-[11px] leading-[18px] whitespace-nowrap text-warn">
              false start
            </span>
          )}
          {shared && (
            <CloudCheck
              data-in-cloud
              aria-label="In the cloud folder"
              className="size-3.5 shrink-0 text-signal"
            />
          )}
          {status && !missing && (
            <span
              className={cn(
                "truncate text-[11px]",
                cloudState ? "text-muted-foreground" : "text-destructive"
              )}
              title={cloudState ? undefined : take.cloud_error}
            >
              {status}
            </span>
          )}
          {/* Its rehearsal is what tells it from the others here, so the
              bar gives way to it rather than it to the bar. */}
          {where && (
            <span className="max-w-1/2 shrink-0 truncate text-xs text-muted-foreground">
              {where}
            </span>
          )}
          {missing && (
            <span className="shrink-0 text-[11px] text-destructive">Not found on disk</span>
          )}
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
                still hold their place, so the rows do not shift as it moves. */}
            <div className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {onShare && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    shared ? `Cloud copies of ${take.name}` : `Copy ${take.name} to the cloud`
                  }
                  title={shared ? "In the cloud folder" : "Copy this take to the cloud folder"}
                  onClick={() => onShare(take)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <CloudUpload />
                </Button>
              )}
              {onRename && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Rename take ${take.name}`}
                  onClick={() => onRename(take)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Pencil />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete take ${take.name}`}
                  onClick={() => onDelete(take)}
                  className="text-muted-foreground hover:text-destructive"
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
      {!missing && (take.markers ?? []).map((m) => {
        const label = labelOf(labels, m.label_id)
        return (
          <button
            key={m.at}
            type="button"
            data-note
            onClick={() => onOpenAt(take, m.at)}
            className="ml-11 flex max-w-[calc(100%-2.75rem)] items-center gap-2.5 self-start rounded-md px-1.5 py-0.5 text-left text-[13px] transition-colors hover:bg-accent/50"
          >
            <span className={cn("size-[7px] shrink-0 rounded-full", labelLook(label.colour).dot)} />
            <span className="tnum text-xs text-muted-foreground">{formatMMSS(m.at)}</span>
            <span className="truncate">{markText(label, m.note)}</span>
          </button>
        )
      })}
    </div>
  )
}
