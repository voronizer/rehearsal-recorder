import { Loader2, Pause, Play } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SongDetail } from "@/lib/api"
import { formatDay } from "@/lib/format"
import { hereFor, pageLine, placed, type PlacedPlayback, type PlacedTake } from "@/lib/songs"

/**
 * A song's page, on the right of History's Songs view: every go at it, from
 * every rehearsal. Its head says how much it was played and when, and its ▶
 * plays the go worth hearing first — the newest ★ one, or the last — from a
 * rehearsal on disk.
 *
 * The takes nobody named have a page too, so they can be found and given a
 * song; it has nothing to play first.
 */
export function SongPage({
  page,
  playback,
  onPlay,
}: {
  page: SongDetail
  playback: PlacedPlayback | null
  onPlay: (take: PlacedTake) => void
}) {
  const goes = page.goes ?? []
  const unnamed = page.title == null
  const plays = unnamed ? null : (page.plays ?? null)
  const here = plays ? hereFor(playback, plays.folder, plays.take) : null
  const playing = here?.playing ?? false

  return (
    <div className="flex flex-col gap-5">
      <header data-song-head className="flex items-start gap-4">
        {plays && (
          <button
            type="button"
            onClick={() => onPlay(placed(plays.folder, plays.take))}
            aria-label={`${playing ? "Pause" : "Play"} ${plays.take.name}`}
            aria-keyshortcuts={here ? "Space" : undefined}
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-full transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {here?.loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : playing ? (
              <Pause className="size-4 fill-current" />
            ) : (
              <Play className="size-4 fill-current" />
            )}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h2
            className={cn(
              "truncate text-xl leading-tight",
              unnamed ? "font-medium text-muted-foreground" : "font-semibold"
            )}
          >
            {unnamed ? "Not named" : page.title}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{pageLine(goes, unnamed)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {unnamed ? (
              "Takes nobody named. Rename one to give it a song."
            ) : !plays ? (
              "Nothing to play: every go is on a drive that is not plugged in"
            ) : plays.take.starred ? (
              <>
                ▶ plays <span className="text-signal">★</span> {plays.take.name} ·{" "}
                {formatDay(plays.created_at)}
              </>
            ) : (
              `▶ plays the last go, ${plays.take.name} · ${formatDay(plays.created_at)}`
            )}
          </p>
        </div>
      </header>
    </div>
  )
}
