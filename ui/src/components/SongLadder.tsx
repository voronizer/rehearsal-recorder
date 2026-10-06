import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Take } from "@/lib/api"
import { formatDay, formatMMSS, goesLabel, takesLabel } from "@/lib/format"
import { labelLook, labelOf, useLabels } from "@/lib/labels"
import { hereFor, placed, type PlacedPlayback, type PlacedTake, type Rung } from "@/lib/songs"
import { TakeRow } from "@/components/RehearsalOverview"

/** How wide the song's longest go is on its rung, in pixels: the mockup's
 *  scale, which fits a dozen goes of an evening beside the rehearsal's name. */
const RUNG_PX = 118

/**
 * Every go at a song, a rung per rehearsal, newest first. A rung is one line:
 * the rehearsal's day and name, its goes at the song as bars side by side in
 * the order played, all drawn to the song's longest go, and how many there
 * were. A go that ran long or stopped short across a month of rehearsals
 * shows without reading a number; a ★ go is green, and each mark a tick in
 * its label's colour where it fell.
 *
 * A click opens a rung to its goes as the overview's rows, and a second click
 * closes it. A rung of a rehearsal not on disk is greyed and says so.
 */
export function SongLadder({
  rungs,
  longest,
  unnamed,
  open,
  onToggle,
  playback,
  onPlay,
  onOpen,
  onOpenAt,
  onRename,
  onStar,
  onShare,
  onDelete,
  onOpenRehearsal,
}: {
  rungs: Rung[]
  longest: number
  unnamed: boolean
  open: ReadonlySet<string>
  onToggle: (folder: string) => void
  playback: PlacedPlayback | null
  onPlay: (take: PlacedTake) => void
  onOpen: (take: PlacedTake) => void
  onOpenAt: (take: PlacedTake, at: number) => void
  onRename: (take: PlacedTake) => void
  onStar: (take: PlacedTake, starred: boolean) => void
  onShare: (take: PlacedTake) => void
  onDelete: (take: PlacedTake) => void
  onOpenRehearsal: (folder: string) => void
}) {
  const labels = useLabels()
  const count = (n: number) => (unnamed ? takesLabel(n) : goesLabel(n))

  return (
    <section aria-label="Every go" className="flex flex-col gap-0.5">
      <div
        aria-hidden
        className="grid grid-cols-[18px_150px_minmax(0,1fr)_70px] gap-3 px-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase"
      >
        <span />
        <span>Rehearsal</span>
        <span>{unnamed ? "Takes, to scale" : "Goes, to scale"}</span>
        <span className="text-right">{unnamed ? "Takes" : "Goes"}</span>
      </div>

      {rungs.map((rung) => {
        const isOpen = open.has(rung.folder)
        const day = formatDay(rung.created_at)
        const at = (take: Take) => placed(rung.folder, take)
        return (
          <div key={rung.folder} data-rung-group={rung.folder} className="flex flex-col">
            <button
              type="button"
              data-rung={rung.folder}
              data-missing={rung.missing || undefined}
              aria-expanded={isOpen}
              onClick={() => onToggle(rung.folder)}
              className={cn(
                "grid w-full grid-cols-[18px_150px_minmax(0,1fr)_70px] items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                "hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                isOpen && "bg-accent hover:bg-accent",
                rung.missing && "opacity-55"
              )}
            >
              <ChevronRight
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform motion-reduce:transition-none",
                  isOpen && "rotate-90"
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-semibold">{day}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {rung.rehearsal}
                  {rung.missing && (
                    <>
                      {" · "}
                      <span className="text-destructive">not on disk</span>
                    </>
                  )}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                {rung.goes.map((take) => {
                  const length = take.duration_sec || 0
                  return (
                    <span
                      key={take.take_number}
                      data-starred={take.starred || undefined}
                      title={`${take.name} · ${formatMMSS(length)}`}
                      className={cn(
                        "relative flex h-6 shrink-0 items-center overflow-hidden rounded-[5px] border",
                        rung.missing
                          ? "border-dashed border-muted-foreground/45"
                          : take.starred
                            ? "border-signal/55 bg-signal/15"
                            : "bg-muted"
                      )}
                      style={{ width: `${Math.round((length / longest) * RUNG_PX)}px` }}
                    >
                      {(take.markers ?? []).map((m) => (
                        <span
                          key={m.at}
                          aria-hidden
                          data-mark-colour={labelOf(labels, m.label_id).colour}
                          className={cn(
                            "absolute inset-y-1 w-0.5 rounded-[1px]",
                            labelLook(labelOf(labels, m.label_id).colour).dot
                          )}
                          style={{
                            left: `${length > 0 ? Math.min(98.5, Math.max(1, (m.at / length) * 100)) : 0}%`,
                          }}
                        />
                      ))}
                      <span className="tnum relative pl-1.5 text-[10px] text-muted-foreground">
                        {unnamed ? take.take_number : (take.go ?? take.take_number)}
                      </span>
                    </span>
                  )
                })}
              </span>
              <span className="text-right text-xs whitespace-nowrap text-muted-foreground">
                {count(rung.goes.length)}
              </span>
            </button>

            {isOpen && (
              <div className="flex flex-col gap-1 pt-1.5 pr-2.5 pb-3 pl-10">
                {rung.goes.map((take) => (
                  <TakeRow
                    key={take.take_number}
                    take={take}
                    unnamed={unnamed}
                    longest={longest}
                    missing={rung.missing}
                    here={hereFor(playback, rung.folder, take)}
                    onPlay={(t) => onPlay(at(t))}
                    onOpen={(t) => onOpen(at(t))}
                    onOpenAt={(t, sec) => onOpenAt(at(t), sec)}
                    onRename={(t) => onRename(at(t))}
                    onStar={(t, starred) => onStar(at(t), starred)}
                    onShare={(t) => onShare(at(t))}
                    onDelete={(t) => onDelete(at(t))}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => onOpenRehearsal(rung.folder)}
                  className="self-start rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline hover:underline-offset-3"
                >
                  Open {rung.rehearsal}, {day} in Rehearsals <span aria-hidden>→</span>
                </button>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
