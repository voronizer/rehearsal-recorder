import { ChevronRight, History, Loader2, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EveningStrip } from "@/components/EveningStrip"
import { SongName } from "@/components/SongName"
import { cn } from "@/lib/utils"
import {
  daysAgo,
  formatDay,
  formatDuration,
  formatMMSS,
  goesLabel,
  longAgo,
  takesLabel,
} from "@/lib/format"
import { labelLook, labelOf, markText, useLabels } from "@/lib/labels"
import type { LastTime as LastTimeData, SongPlays, Take } from "@/lib/api"

/** What is playing from here, and where it has got to. */
export type LastTimePlayback = {
  take: Take
  playing: boolean
  loading: boolean
  position: number
}

/** How many notes a song shows here before it says how many more there are:
 *  this is a glance before playing, not the rehearsal itself. */
const NOTES_SHOWN = 2
/** And how many of the songs left out. */
const LEFT_OUT_SHOWN = 5

/**
 * Last time, beside the setup: the rehearsal before this one, song by song,
 * so the band can hear where they left off before they start.
 *
 * Built on what every take has — its song, how many goes it got, how long
 * each ran — and not on marks, which are few: a song's row plays its newest
 * ★ go, wherever it was played, or with none its last go, which is usually
 * the one they settled on. The notes left while listening are added under
 * their song where there are any. Under it, the songs that were not played
 * last time, each with its own newest ★ go or last go, and the other
 * rehearsals, which open in history.
 */
export function LastTime({
  data,
  playback,
  problem,
  onPlay,
  onOpen,
  onAll,
  onOpenSong,
}: {
  data: LastTimeData
  playback: LastTimePlayback | null
  /** Why what was asked for does not play. */
  problem?: string | null
  onPlay: (take: Take) => void
  onOpen: (folder: string) => void
  onAll: () => void
  /** Opens a song's page in History's Songs view; null is Not named's. */
  onOpenSong?: (title: string | null) => void
}) {
  const last = data.last
  if (!last) return null

  const byNumber = new Map(last.takes.map((t) => [t.take_number, t]))
  const songs = last.songs
    .map((s) => ({
      name: s.name,
      plays: s.plays,
      takes: (s.take_numbers ?? [])
        .map((n) => byNumber.get(n))
        .filter((t): t is Take => t !== undefined),
    }))
    .filter((s) => s.takes.length > 0)
  const grouped = new Set(songs.flatMap((s) => s.takes.map((t) => t.take_number)))
  const unnamed = last.takes.filter((t) => !grouped.has(t.take_number))
  const longest = Math.max(1, ...last.takes.map((t) => t.duration_sec || 0))
  const total = last.takes.reduce((sum, t) => sum + (t.duration_sec || 0), 0)

  const meta = [
    total >= 30 ? formatDuration(total / 60) : null,
    takesLabel(last.takes.length),
    last.in_cloud > 0 ? `${last.in_cloud} in the cloud` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const leftOut = data.not_played.slice(0, LEFT_OUT_SHOWN)

  return (
    <aside aria-label="Last time" className="flex min-w-0 flex-col gap-5">
      <section className="flex flex-col gap-3 rounded-xl border bg-card px-4 pt-4 pb-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              Last time · {formatDay(last.created_at)}, {daysAgo(last.created_at)}
            </h2>
            <div className="mt-1 truncate text-base font-semibold">{last.name}</div>
            <div className="tnum mt-0.5 text-xs text-muted-foreground">{meta}</div>
          </div>
          <Button
            variant="outline"
            size="row"
            onClick={() => onOpen(last.folder)}
            aria-label={`Open ${last.name} in history`}
          >
            Open
            <ChevronRight />
          </Button>
        </div>

        <EveningStrip runs={last.runs} />

        {problem && (
          <p role="status" className="text-xs text-destructive">
            {problem}
          </p>
        )}

        <div className="flex flex-col">
          {songs.map((s) => (
            <SongRow
              key={s.name}
              name={s.name}
              takes={s.takes}
              plays={s.plays}
              folder={last.folder}
              longest={longest}
              playback={playback}
              onPlay={onPlay}
              onOpenSong={onOpenSong}
            />
          ))}
          {unnamed.length > 0 && (
            <SongRow
              name="Not named"
              unnamed
              takes={unnamed}
              plays={null}
              folder={last.folder}
              longest={longest}
              playback={playback}
              onPlay={onPlay}
              onOpenSong={onOpenSong}
            />
          )}
        </div>
      </section>

      {leftOut.length > 0 && (
        <section aria-label="Not played last time" className="flex flex-col gap-0.5">
          <h2 className="px-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Not played last time
          </h2>
          {leftOut.map((s) => {
            const target = s.plays.take
            const starred = target.starred ?? false
            const here = playback?.take === target ? playback : null
            const ago = longAgo(s.created_at)
            // A ★ go from another rehearsal than the one listed says its day.
            const star = starred
              ? `★ ${target.name}${
                  s.plays.folder !== s.folder ? ` (${formatDay(s.plays.created_at)})` : ""
                } · `
              : ""
            return (
              <div
                key={s.name}
                data-song={s.name}
                className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 px-1 py-1"
              >
                <PlayButton
                  take={target}
                  here={here}
                  label={`${target.name}, the ${starred ? "starred" : "last"} go at ${s.name}`}
                  onPlay={onPlay}
                />
                <div className="flex min-w-0 items-baseline gap-2">
                  <SongName
                    title={s.name}
                    onOpen={onOpenSong}
                    className="truncate text-[13px] font-semibold"
                  />
                  <span className="tnum truncate text-xs text-muted-foreground">
                    {here
                      ? `${formatMMSS(here.position)} / ${formatMMSS(target.duration_sec)}`
                      : `${star}${formatDay(s.created_at)}${ago ? `, ${ago}` : ""} · ${goesLabel(s.goes)}`}
                  </span>
                </div>
              </div>
            )
          })}
          {data.not_played.length > leftOut.length && (
            <p className="px-1 pt-1 text-xs text-muted-foreground">
              and {data.not_played.length - leftOut.length} more in history
            </p>
          )}
        </section>
      )}

      <section aria-label="Earlier" className="flex flex-col gap-0.5">
        {data.earlier.length > 0 && (
          <h2 className="px-1 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            Earlier
          </h2>
        )}
        {data.earlier.map((r) => (
          <button
            key={r.folder}
            type="button"
            onClick={() => onOpen(r.folder)}
            className="flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="w-20 shrink-0 text-xs text-muted-foreground">
              {formatDay(r.created_at)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{r.name}</span>
            <span
              className={cn(
                "tnum shrink-0 text-xs",
                r.missing ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {r.missing
                ? "not found"
                : [
                    r.total_duration_sec >= 30
                      ? formatDuration(r.total_duration_sec / 60)
                      : null,
                    takesLabel(r.take_count),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
            </span>
          </button>
        ))}
        {/* Called what the button in the header is called, since it goes
            to the same place: two names would read as two screens. */}
        <button
          type="button"
          onClick={onAll}
          className="flex items-center gap-1.5 self-start rounded-md px-2 py-1.5 text-[13px] font-semibold transition-colors hover:bg-card focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <History className="size-3.5" />
          History
          <span className="font-normal text-muted-foreground">
            · {data.count === 1 ? "1 rehearsal" : `${data.count} rehearsals`}
          </span>
        </button>
      </section>
    </aside>
  )
}

/**
 * One song of last time: its goes as bars as tall as they ran, the starred
 * ones green, and the one its button plays at full strength while the
 * others are dimmed, when it is one of them.
 */
function SongRow({
  name,
  takes,
  plays,
  folder,
  longest,
  unnamed = false,
  playback,
  onPlay,
  onOpenSong,
}: {
  name: string
  takes: Take[]
  /** What ▶ plays: the song's newest ★ go, or its last go here. null for
   *  the takes nobody named, which have no song and play their last take. */
  plays: SongPlays | null
  /** Last time's folder, to tell its own takes from another rehearsal's. */
  folder: string
  longest: number
  unnamed?: boolean
  playback: LastTimePlayback | null
  onPlay: (take: Take) => void
  onOpenSong?: (title: string | null) => void
}) {
  const labels = useLabels()
  const lastGo = takes[takes.length - 1]
  const target = plays?.take ?? lastGo
  const isTarget = (t: Take) =>
    plays ? plays.folder === folder && plays.take.take_number === t.take_number : t === lastGo
  // Said in words only when ▶ plays something the bars do not end on.
  const elsewhere = plays !== null && !isTarget(lastGo)
  const here = playback?.take === target ? playback : null
  const total = takes.reduce((sum, t) => sum + (t.duration_sec || 0), 0)
  // Every mark is listed, a plain one with nothing written included (spec D2).
  const notes = takes.flatMap((t) => (t.markers ?? []).map((m) => ({ take: t, marker: m })))

  return (
    <div
      data-song={name}
      className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t py-2"
    >
      <PlayButton
        take={target}
        here={here}
        label={
          unnamed ? target.name : `${target.name}, the ${target.starred ? "starred" : "last"} go at ${name}`
        }
        onPlay={onPlay}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <SongName
            title={unnamed ? null : name}
            onOpen={onOpenSong}
            className={cn(
              "truncate text-[13px]",
              unnamed ? "text-muted-foreground" : "font-semibold"
            )}
          />
          <span className="tnum shrink-0 text-xs text-muted-foreground">
            {here
              ? `${formatMMSS(here.position)} / ${formatMMSS(target.duration_sec)}`
              : `${unnamed ? takesLabel(takes.length) : goesLabel(takes.length)} · ${formatMMSS(total)}`}
          </span>
        </div>
        {elsewhere && plays && (
          <span data-plays className="truncate text-xs text-muted-foreground">
            ★ {plays.take.name} · {formatDay(plays.created_at)}
          </span>
        )}
        {notes.slice(0, NOTES_SHOWN).map(({ take, marker }) => {
          const label = labelOf(labels, marker.label_id)
          return (
            <span
              key={`${take.take_number}-${marker.at}`}
              data-note
              className="flex min-w-0 items-center gap-2 text-xs"
            >
              <span className={cn("size-[7px] shrink-0 rounded-full", labelLook(label.colour).dot)} />
              <span className="truncate">
                <span className="text-muted-foreground">
                  {take.name} · <span className="tnum">{formatMMSS(marker.at)}</span> ·{" "}
                </span>
                {markText(label, marker.note)}
              </span>
            </span>
          )
        })}
        {notes.length > NOTES_SHOWN && (
          <span className="text-xs text-muted-foreground">
            and {notes.length - NOTES_SHOWN} more
          </span>
        )}
      </div>
      <div aria-hidden className="flex h-6 items-end gap-[3px]">
        {takes.map((t) => (
          <span
            key={t.take_number}
            data-starred={t.starred || undefined}
            data-lit={isTarget(t) || undefined}
            className={cn(
              "w-1.5 rounded-[2px]",
              isTarget(t)
                ? t.starred
                  ? "bg-signal"
                  : "bg-muted-foreground"
                : t.starred
                  ? "bg-signal/45"
                  : "bg-muted-foreground/35"
            )}
            style={{ height: `${Math.max(4, ((t.duration_sec || 0) / longest) * 24)}px` }}
          />
        ))}
      </div>
    </div>
  )
}

function PlayButton({
  take,
  here,
  label,
  onPlay,
}: {
  take: Take
  here: LastTimePlayback | null
  label: string
  onPlay: (take: Take) => void
}) {
  const playing = here?.playing ?? false
  return (
    <button
      type="button"
      onClick={() => onPlay(take)}
      aria-label={`${playing ? "Pause" : "Play"} ${label}`}
      aria-keyshortcuts={here ? "Space" : undefined}
      className={cn(
        "flex size-7 items-center justify-center rounded-full border transition-colors",
        here ? "border-primary bg-primary text-primary-foreground" : "hover:bg-foreground/5"
      )}
    >
      {here?.loading ? (
        <Loader2 className="size-3 animate-spin" />
      ) : playing ? (
        <Pause className="size-3 fill-current" />
      ) : (
        <Play className="size-3 fill-current" />
      )}
    </button>
  )
}

