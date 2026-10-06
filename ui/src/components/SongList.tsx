import { cn } from "@/lib/utils"
import type { SongIndex } from "@/lib/api"
import { inSongOrder, notNamedLine, songLine, type SongRef } from "@/lib/songs"

/**
 * History's Songs view, down the left: every song with a go, alphabetically,
 * and the takes nobody named last. A song is where it was last time whatever
 * the band played since, which a list by date could not promise.
 */
export function SongList({
  index,
  current,
  onChoose,
}: {
  index: SongIndex
  current: SongRef | null
  onChoose: (ref: SongRef) => void
}) {
  const byId = new Map(index.songs.map((s) => [s.id, s]))
  return (
    <div className="flex flex-col gap-1">
      {inSongOrder(index).map((ref) => {
        const song = ref === "not_named" ? null : byId.get(ref)
        const title = song ? song.title : "Not named"
        const line = song ? songLine(song) : index.not_named ? notNamedLine(index.not_named) : ""
        return (
          <button
            key={ref}
            type="button"
            data-song={title}
            data-song-ref={ref}
            aria-current={ref === current ? "true" : undefined}
            onClick={() => onChoose(ref)}
            className={cn(
              "flex flex-col gap-1 rounded-lg border border-transparent px-3 pt-2.5 pb-3 text-left transition-colors",
              "hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              ref === current && "border-border bg-accent hover:bg-accent",
              !song && "mt-2 border-dashed"
            )}
          >
            <span className="flex items-baseline gap-2">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  song ? "text-base font-semibold" : "text-sm text-muted-foreground"
                )}
              >
                {title}
              </span>
              {song && song.starred > 0 && (
                <span className="tnum shrink-0 text-xs text-signal">★ {song.starred}</span>
              )}
            </span>
            <span className="truncate text-xs text-muted-foreground">{line}</span>
          </button>
        )
      })}
    </div>
  )
}
