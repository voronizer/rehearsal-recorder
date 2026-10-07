import { useLayoutEffect, useRef, useState } from "react"
import { GoTitle } from "@/components/TakeTitle"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import type { SongChoice, SongChoices } from "@/lib/api"
import { pillsShown } from "@/lib/songPills"
import { ALPHABETICAL } from "@/lib/songs"
import { cn } from "@/lib/utils"

/** The gap between pills, as `gap-1.5` draws it. */
const GAP = 6
const PILL =
  "max-w-full truncate rounded-full border px-3 py-1 text-[13px] font-medium transition-colors " +
  "hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

/**
 * The songs under a take's name, in two rows at most: what this rehearsal
 * played, then the other rehearsals' songs, the latest played first, and
 * All songs… last. Each shows the go a take would be ("Polyn 3", the number
 * dimmed); a click puts only the title in the field.
 *
 * A click puts the song's title in the field and takes no focus of its own;
 * a field being typed in is then left (TakeNameField's `put`), so Space
 * records or saves. The one matching the field is lit where it stands:
 * nothing moves under the pointer. Typing narrows them over every song, not
 * only the ones shown.
 *
 * Which fit is worked out from the pills' own widths, measured off screen,
 * and again whenever the row changes width.
 */
export function SongPills({
  choices,
  value,
  initial,
  onPick,
}: {
  choices: SongChoices | null
  value: string
  /** What the field started from: it does not narrow them. */
  initial: string
  onPick: (name: string) => void
}) {
  const all = choices ? [...choices.here, ...choices.other] : []
  const typed = value.trim().toLocaleLowerCase()
  const isChoice = (c: SongChoice) => c.song.toLocaleLowerCase() === typed
  const narrowing = typed !== "" && value.trim() !== initial.trim() && !all.some(isChoice)
  const fits = (c: SongChoice) => !narrowing || c.song.toLocaleLowerCase().includes(typed)
  const here = (choices?.here ?? []).filter(fits)
  const other = (choices?.other ?? []).filter(fits)
  const candidates = [...here, ...other]
  const key = candidates.map((c) => c.song).join("\n")

  const row = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<string[]>([])

  // `lay` runs once here, synchronously, so `shown` is set before the
  // browser repaints — a layout effect's setState is flushed before paint,
  // which is exactly what keeps a quick mousedown/mouseup right after the
  // pills changed from landing between two different layouts. The observer
  // then answers again on every later change of width.
  useLayoutEffect(() => {
    const rowEl = row.current
    const m = measure.current
    if (!rowEl || !m) return
    const lay = () => {
      const kids = [...m.children] as HTMLElement[]
      const width = new Map(candidates.map((c, i) => [c.song, kids[i].getBoundingClientRect().width]))
      const last = kids[candidates.length]?.getBoundingClientRect().width ?? 0
      const picked = pillsShown(here, other, (c) => width.get(c.song) ?? 0, last, rowEl.clientWidth, GAP)
      // Measuring and setting this before the row paints is the point of
      // doing it in a layout effect rather than the ResizeObserver alone.
      // eslint-disable-next-line react/set-state-in-effect
      setShown(picked.map((c) => c.song))
    }
    lay()
    const watch = new ResizeObserver(lay)
    watch.observe(rowEl)
    return () => watch.disconnect()
    // `key` stands for the candidates: the same names, the same layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (all.length === 0) return null
  const byName = new Map(candidates.map((c) => [c.song, c]))
  const visible = shown.map((n) => byName.get(n)).filter((c): c is SongChoice => !!c)

  return (
    <div className="relative min-w-0">
      <div ref={row} className="flex flex-wrap gap-1.5">
        {visible.map((c) => (
          <button
            key={c.song}
            type="button"
            data-song-choice={c.song}
            aria-current={isChoice(c) ? "true" : undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(c.song)}
            className={cn(PILL, isChoice(c) && "border-primary bg-primary/15 hover:bg-primary/20")}
          >
            <GoTitle title={c.song} go={c.go} />
          </button>
        ))}
        <AllSongsPill choices={all} value={value} onPick={onPick} className={PILL} />
      </div>
      {/* The same pills, out of sight, to measure. In a box of no height
          that clips them: in a panel that scrolls (the rehearsal screen's
          Next take) all of them in one line would otherwise make it
          scroll sideways too. */}
      <div
        aria-hidden
        inert
        className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        <div ref={measure} className="flex w-max gap-1.5">
          {candidates.map((c) => (
            <span key={c.song} className={PILL}>
              <GoTitle title={c.song} go={c.go} />
            </span>
          ))}
          <span className={PILL}>All songs…</span>
        </div>
      </div>
    </div>
  )
}

/**
 * The last pill, and the whole repertoire behind it, over the field: in
 * columns, alphabetical, scrolling when it is long. One click opens it, one
 * fills the field and closes it. Closed, focus goes nowhere in particular,
 * so the next Space is the screen's again.
 */
function AllSongsPill({
  choices,
  value,
  onPick,
  className,
}: {
  choices: SongChoice[]
  value: string
  onPick: (name: string) => void
  className: string
}) {
  const [open, setOpen] = useState(false)
  const typed = value.trim().toLocaleLowerCase()
  const sorted = [...choices].sort((a, b) => ALPHABETICAL.compare(a.song, b.song))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-all-songs
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            className,
            "border-dashed text-muted-foreground",
            open && "bg-accent text-foreground"
          )}
        >
          All songs…
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        aria-label="All songs"
        // Opening the list must not take the keyboard from a field somebody
        // is typing in: a half-typed name stays put, and unsent, until a
        // song in the panel is actually clicked.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        className="max-h-[min(22rem,55vh)] w-[min(44rem,calc(100vw-2rem))] overflow-y-auto p-3"
      >
        <div className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          All songs
        </div>
        <div className="mt-2 columns-[9rem] gap-4">
          {sorted.map((c) => (
            <button
              key={c.song}
              type="button"
              data-song-choice={c.song}
              aria-current={c.song.toLocaleLowerCase() === typed ? "true" : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onPick(c.song)
                setOpen(false)
              }}
              // The ring and the focus outline are drawn inside the song's
              // box: the window is WebKit on a Mac, which carried anything
              // under the last song of a column to the top of the next.
              className={cn(
                "block w-full truncate rounded-md px-1.5 py-0.5 text-left text-sm break-inside-avoid hover:bg-accent",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                c.song.toLocaleLowerCase() === typed && "bg-primary/15 ring-1 ring-primary ring-inset"
              )}
            >
              <GoTitle title={c.song} go={c.go} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
