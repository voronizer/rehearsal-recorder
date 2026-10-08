import { Loader2, Pause, Pencil, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SongDetail } from "@/lib/api"
import { formatDayIn, formatMMSS } from "@/lib/format"
import { labelLook, labelOf, markText, useLabels } from "@/lib/labels"
import {
  fromLastTime,
  hereFor,
  pageLine,
  placed,
  rungsOf,
  type PlacedPlayback,
  type PlacedTake,
} from "@/lib/songs"
import { OldNames } from "@/components/OldNames"
import { TakeRow } from "@/components/RehearsalOverview"
import { SongLadder } from "@/components/SongLadder"

const EYEBROW =
  "mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"

/**
 * A song's page, on the right of History's Songs view: every go at it, from
 * every rehearsal. Its head says how much it was played and when, and its ▶
 * plays the go worth hearing first — the newest ★ one, or the last — from a
 * rehearsal on disk.
 *
 * Under the head, the ★ goes on their own, then what the band marked on the
 * song last time, then every go as a ladder (`SongLadder`).
 *
 * The takes nobody named have a page too, so they can be found and given a
 * song; it has nothing to play first, and no ★ goes or marks of its own.
 *
 * A song's title has a pencil beside it, for Rename song, and under the
 * play line the names it is also typed as, each to forget.
 */
export function SongPage({
  page,
  playback,
  open,
  onToggle,
  onPlay,
  onOpen,
  onOpenAt,
  onRename,
  onStar,
  onShare,
  onDelete,
  onOpenRehearsal,
  onRenameSong,
  onForgetName,
}: {
  page: SongDetail
  playback: PlacedPlayback | null
  /** The rungs open, by their rehearsal's folder. */
  open: ReadonlySet<string>
  onToggle: (folder: string) => void
  onPlay: (take: PlacedTake) => void
  onOpen: (take: PlacedTake) => void
  onOpenAt: (take: PlacedTake, at: number) => void
  onRename: (take: PlacedTake) => void
  onStar: (take: PlacedTake, starred: boolean) => void
  onShare: (take: PlacedTake) => void
  onDelete: (take: PlacedTake) => void
  onOpenRehearsal: (folder: string) => void
  onRenameSong: () => void
  onForgetName: (name: string) => void
}) {
  const labels = useLabels()
  const goes = page.goes ?? []
  const unnamed = page.title == null
  const plays = unnamed ? null : (page.plays ?? null)
  const here = plays ? hereFor(playback, plays.folder, plays.take) : null
  const playing = here?.playing ?? false
  const longest = Math.max(1, ...goes.map((g) => g.take.duration_sec || 0))
  // Newest first: the newest rehearsal first, and in it the last go played.
  const starred = unnamed
    ? []
    : goes
        .filter((g) => g.take.starred)
        .sort(
          (a, b) =>
            b.created_at.localeCompare(a.created_at) || b.take.take_number - a.take.take_number
        )
  const marks = unnamed ? [] : fromLastTime(goes)

  return (
    <div className="flex flex-col gap-6">
      <header data-song-head className="flex items-center gap-4">
        {plays && (
          <button
            type="button"
            onClick={() => onPlay(placed(plays.folder, plays.take))}
            aria-label={`${playing ? "Pause" : "Play"} ${plays.take.name}`}
            aria-keyshortcuts={here ? "Space" : undefined}
            className={cn(
              "flex size-13 shrink-0 items-center justify-center rounded-full transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              playing && "ring-4 ring-primary/30"
            )}
          >
            {here?.loading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : playing ? (
              <Pause className="size-5 fill-current" />
            ) : (
              <Play className="size-5 fill-current" />
            )}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <h2
              className={cn(
                "truncate text-[26px] leading-tight",
                unnamed ? "font-medium text-muted-foreground" : "font-semibold"
              )}
            >
              {unnamed ? "Not named" : page.title}
            </h2>
            {!unnamed && (
              <button
                type="button"
                onClick={onRenameSong}
                aria-label={`Rename song ${page.title}`}
                title="Rename song"
                className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Pencil className="size-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{pageLine(goes, unnamed)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {unnamed ? (
              "Takes nobody named. Rename one to give it a song."
            ) : !plays ? (
              "Nothing to play: every go is on a drive that is not plugged in"
            ) : plays.take.starred ? (
              <>
                ▶ plays <span className="text-signal">★</span> {plays.take.name} ·{" "}
                {formatDayIn(plays.created_at)}
              </>
            ) : (
              `▶ plays the last go, ${plays.take.name} · ${formatDayIn(plays.created_at)}`
            )}
          </p>
          {!unnamed && <OldNames names={page.also ?? []} onForget={onForgetName} />}
        </div>
      </header>

      {starred.length > 0 && (
        <section aria-label="Starred" className="flex flex-col gap-0.5">
          <h3 className={EYEBROW}>
            <span className="text-signal">★</span> Starred
          </h3>
          {starred.map((go) => (
            <TakeRow
              key={`${go.folder}#${go.take.take_number}`}
              take={go.take}
              unnamed={false}
              longest={longest}
              missing={go.missing}
              where={`${go.rehearsal} · ${formatDayIn(go.created_at)}`}
              here={hereFor(playback, go.folder, go.take)}
              onPlay={(t) => onPlay(placed(go.folder, t))}
              onOpen={(t) => onOpen(placed(go.folder, t))}
              onOpenAt={(t, sec) => onOpenAt(placed(go.folder, t), sec)}
              onRename={(t) => onRename(placed(go.folder, t))}
              onStar={(t, on) => onStar(placed(go.folder, t), on)}
              onShare={(t) => onShare(placed(go.folder, t))}
              onDelete={(t) => onDelete(placed(go.folder, t))}
            />
          ))}
        </section>
      )}

      {marks.length > 0 && (
        <section aria-label="From last time" className="flex flex-col gap-px">
          <h3 className={EYEBROW}>From last time · {formatDayIn(marks[0].go.created_at)}</h3>
          {marks.map(({ go, marker }) => {
            const label = labelOf(labels, marker.label_id)
            return (
              <button
                key={`${go.take.take_number}-${marker.at}`}
                type="button"
                data-note
                onClick={() => onOpenAt(placed(go.folder, go.take), marker.at)}
                className="flex max-w-full items-center gap-2.5 self-start rounded-md px-1.5 py-0.5 text-left text-[13px] transition-colors hover:bg-accent/50"
              >
                <span
                  className={cn("size-[7px] shrink-0 rounded-full", labelLook(label.colour).dot)}
                />
                <span className="tnum text-xs text-muted-foreground">
                  {formatMMSS(marker.at)}
                </span>
                <span className="truncate">
                  <span className="text-muted-foreground">{go.take.name} · </span>
                  {markText(label, marker.note)}
                </span>
              </button>
            )
          })}
        </section>
      )}

      <SongLadder
        rungs={rungsOf(goes)}
        longest={longest}
        unnamed={unnamed}
        open={open}
        onToggle={onToggle}
        playback={playback}
        onPlay={onPlay}
        onOpen={onOpen}
        onOpenAt={onOpenAt}
        onRename={onRename}
        onStar={onStar}
        onShare={onShare}
        onDelete={onDelete}
        onOpenRehearsal={onOpenRehearsal}
      />
    </div>
  )
}
