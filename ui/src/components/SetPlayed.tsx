import { Check, ListMusic } from "lucide-react"
import type { RehearsalSet } from "@/lib/api"
import { cn } from "@/lib/utils"

// What History says of a rehearsal played by a set (issue #12 step 8,
// H1–H4). One played freely looks as it always did.

const goesLabel = (n: number) => (n === 1 ? "1 go" : `${n} goes`)

/** The set's name, small, after its icon: in the list of rehearsals and
 *  beside the date under a rehearsal's title (H1). */
export function SetName({ name, className }: { name: string; className?: string }) {
  return (
    <span
      data-set-name
      title={`Played by the set ${name}`}
      className={cn("flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)}
    >
      <ListMusic aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  )
}

/**
 * Over a rehearsal's songs (H2): "Gig on the 25th — 4 of 6 played", then
 * the set's songs in order, in two columns read down, each played one with
 * ✓ and its goes, each other "not played". A click on a played one goes to
 * its songs below (`onGoTo`).
 */
export function SetPlayedCard({
  set,
  goes,
  onGoTo,
}: {
  set: RehearsalSet
  /** Goes that evening by song. */
  goes: Map<string, number>
  onGoTo: (title: string) => void
}) {
  const goesOf = (title: string) => goes.get(title) ?? 0
  const played = set.songs.filter((s) => goesOf(s.title) > 0).length
  return (
    <section
      aria-label={`Set ${set.name}`}
      data-set-played-card
      className="flex flex-col gap-2 rounded-xl border px-4 pt-3.5 pb-3"
    >
      <h3 className="flex min-w-0 items-baseline gap-1.5 text-[15px] font-semibold">
        <ListMusic aria-hidden className="size-4 shrink-0 self-center text-muted-foreground" />
        <span className="min-w-0 truncate" title={set.name}>
          {set.name}
        </span>{" "}
        <span className="shrink-0 text-[13px] font-normal text-muted-foreground">
          — {played} of {set.songs.length} played
        </span>
      </h3>
      {/* Two columns read down, 1 to 3 then 4 to 6, as a numbered list is. */}
      <ol
        className="grid gap-x-6 sm:grid-flow-col sm:grid-cols-2"
        style={{ gridTemplateRows: `repeat(${Math.ceil(set.songs.length / 2)}, auto)` }}
      >
        {set.songs.map((song, i) => {
          const n = goesOf(song.title)
          return (
            <li key={song.title} className="min-w-0">
              <button
                type="button"
                data-set-played={song.title}
                disabled={n === 0}
                title={song.title}
                onClick={() => onGoTo(song.title)}
                className={cn(
                  "flex h-8 w-full items-center gap-3 rounded-md px-2 text-left text-sm",
                  "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  n > 0 ? "hover:bg-accent" : "cursor-default"
                )}
              >
                <span className="tnum w-4 shrink-0 text-right text-xs text-muted-foreground">
                  {i + 1}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", n === 0 && "text-muted-foreground")}>
                  {song.title}
                </span>
                {n > 0 ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Check aria-hidden className="size-3.5 text-primary" />
                    {goesLabel(n)}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">not played</span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
