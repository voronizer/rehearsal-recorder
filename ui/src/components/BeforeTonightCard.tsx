import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { TakeRow } from "@/components/RehearsalOverview"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/format"
import { hereFor, placed, type PlacedPlayback, type PlacedTake } from "@/lib/songs"
import type { BeforeTonight } from "@/lib/api"

/**
 * The song the next take is named for, as it went before tonight: a card
 * under the Next take field in the rehearsal screen's panel (issue #12
 * step 6). "How did we play the bridge last week?" comes up mid-rehearsal,
 * and finishing to look in History is not an option.
 *
 * One go is shown, the one the band would want first — the song's newest ★
 * go, or with none the last go of its latest rehearsal — and "N more" adds
 * the last go of each of its three latest rehearsals under it. Every bar is
 * drawn to one scale, opened or not, so the first row stays where it is.
 * Its goes play right here: there is one player, and the take open in it
 * hides this card. With nothing to play, one grey line says why.
 *
 * Mount it keyed by the song: a new song folds "N more" back and slides the
 * card in, and a refresh of the same song does neither.
 */
export function BeforeTonightCard({
  before,
  song,
  playedTonight,
  playback,
  onPlay,
  onPlayAt,
}: {
  before: BeforeTonight | null
  /** The song the Next take field names, or null for "Take N". */
  song: string | null
  /** Whether tonight has a go at it already, which the overview shows. */
  playedTonight: boolean
  /** The earlier go playing here, if one is. */
  playback: PlacedPlayback | null
  onPlay: (take: PlacedTake) => void
  /** Plays a go from a spot in it: a note under it. */
  onPlayAt: (take: PlacedTake, at: number) => void
}) {
  const [open, setOpen] = useState(false)
  const title = before?.song ?? song
  const all = before ? [before.first, ...before.more] : []
  const goes = open ? all : all.slice(0, 1)
  const longest = Math.max(1, ...all.map((g) => g.take.duration_sec))

  return (
    <section
      aria-label={title ? `${title} before tonight` : "Before tonight"}
      className="flex flex-col gap-2.5 rounded-xl border bg-card px-4 pt-3.5 pb-4 duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1"
    >
      <div className="flex min-h-8 items-center gap-2">
        <h2 className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[15px] font-semibold">
          {title ? (
            <>
              <span data-before-title title={title} className="min-w-0 truncate">
                {title}
              </span>{" "}
              <span className="shrink-0 text-[13px] font-normal text-muted-foreground">
                — before tonight
              </span>
            </>
          ) : (
            <span className="text-[13px] font-normal text-muted-foreground">Before tonight</span>
          )}
        </h2>
        {before && before.more.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {open ? "Fewer" : `${before.more.length} more`}
            {open ? <ChevronUp /> : <ChevronDown />}
          </Button>
        )}
      </div>

      {before ? (
        <div className="flex flex-col gap-0.5">
          {goes.map((go) => (
            <TakeRow
              key={`${go.folder}#${go.take.take_number}`}
              take={go.take}
              unnamed={false}
              longest={longest}
              where={formatDate(go.created_at)}
              here={hereFor(playback, go.folder, go.take)}
              onPlay={(t) => onPlay(placed(go.folder, t))}
              onOpenAt={(t, at) => onPlayAt(placed(go.folder, t), at)}
            />
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {!title
            ? "Name the next take after a song to see how it went before."
            : playedTonight
              ? `No goes at ${title} before tonight. Tonight's are in the overview.`
              : `No goes at ${title} before tonight.`}
        </p>
      )}
    </section>
  )
}
