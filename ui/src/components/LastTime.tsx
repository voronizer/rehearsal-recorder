import { ChevronRight, History, Loader2, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EveningStrip } from "@/components/EveningStrip"
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
import { markerStyle } from "@/lib/markers"
import type { LastTime as LastTimeData, Take } from "@/lib/api"

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
 * each ran — and not on marks, which are few: a song's row plays its last
 * go, which is usually the one they settled on. The notes left while
 * listening are added under their song where there are any. Under it, the
 * songs that were not played last time, each with its own last go, and the
 * other rehearsals, which open in history.
 */
export function LastTime({
  data,
  playback,
  problem,
  onPlay,
  onOpen,
  onAll,
}: {
  data: LastTimeData
  playback: LastTimePlayback | null
  /** Why what was asked for does not play. */
  problem?: string | null
  onPlay: (take: Take) => void
  onOpen: (folder: string) => void
  onAll: () => void
}) {
  const last = data.last
  if (!last) return null

  const byNumber = new Map(last.takes.map((t) => [t.take_number, t]))
  const songs = last.songs
    .map((s) => ({
      name: s.name,
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
            size="sm"
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
              longest={longest}
              playback={playback}
              onPlay={onPlay}
            />
          ))}
          {unnamed.length > 0 && (
            <SongRow
              name="Not named"
              unnamed
              takes={unnamed}
              longest={longest}
              playback={playback}
              onPlay={onPlay}
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
            const here = playback?.take === s.take ? playback : null
            const ago = longAgo(s.created_at)
            return (
              <div
                key={s.name}
                data-song={s.name}
                className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-x-3 px-1 py-1"
              >
                <PlayButton
                  take={s.take}
                  here={here}
                  label={`${s.take.name}, the last go at ${s.name}`}
                  onPlay={onPlay}
                />
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-[13px] font-semibold">{s.name}</span>
                  <span className="tnum truncate text-xs text-muted-foreground">
                    {here
                      ? `${formatMMSS(here.position)} / ${formatMMSS(s.take.duration_sec)}`
                      : `${formatDay(s.created_at)}${ago ? `, ${ago}` : ""} · ${goesLabel(s.goes)}`}
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
            className="flex items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
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
        <button
          type="button"
          onClick={onAll}
          className="flex items-center gap-1.5 self-start rounded-md px-2 py-1.5 text-[13px] font-semibold transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <History className="size-3.5" />
          All rehearsals
          <span className="font-normal text-muted-foreground">· {data.count}</span>
        </button>
      </section>
    </aside>
  )
}

/**
 * One song of last time: its goes as bars as tall as they ran, the last one
 * lit, since that is the one its button plays.
 */
function SongRow({
  name,
  takes,
  longest,
  unnamed = false,
  playback,
  onPlay,
}: {
  name: string
  takes: Take[]
  longest: number
  unnamed?: boolean
  playback: LastTimePlayback | null
  onPlay: (take: Take) => void
}) {
  const lastGo = takes[takes.length - 1]
  const here = playback?.take === lastGo ? playback : null
  const total = takes.reduce((sum, t) => sum + (t.duration_sec || 0), 0)
  const notes = takes.flatMap((t) =>
    (t.markers ?? [])
      .filter((m) => m.note.trim() !== "" || m.kind !== "note")
      .map((m) => ({ take: t, marker: m }))
  )

  return (
    <div
      data-song={name}
      className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t py-2"
    >
      <PlayButton
        take={lastGo}
        here={here}
        label={unnamed ? lastGo.name : `${lastGo.name}, the last go at ${name}`}
        onPlay={onPlay}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              "truncate text-[13px]",
              unnamed ? "text-muted-foreground" : "font-semibold"
            )}
          >
            {name}
          </span>
          <span className="tnum shrink-0 text-xs text-muted-foreground">
            {here
              ? `${formatMMSS(here.position)} / ${formatMMSS(lastGo.duration_sec)}`
              : `${unnamed ? takesLabel(takes.length) : goesLabel(takes.length)} · ${formatMMSS(total)}`}
          </span>
        </div>
        {notes.slice(0, NOTES_SHOWN).map(({ take, marker }) => {
          const style = markerStyle(marker.kind)
          return (
            <span
              key={`${take.take_number}-${marker.at}`}
              data-note
              className="flex min-w-0 items-center gap-2 text-xs"
            >
              <span className={cn("size-[7px] shrink-0 rounded-full", style.dot)} />
              <span className="truncate">
                <span className="text-muted-foreground">
                  {take.name} · <span className="tnum">{formatMMSS(marker.at)}</span> ·{" "}
                </span>
                {marker.note || style.label}
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
            className={cn(
              "w-1.5 rounded-[2px]",
              t.markers?.some((m) => m.kind === "good")
                ? "bg-signal"
                : t === lastGo
                  ? "bg-muted-foreground"
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
        here ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent"
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

