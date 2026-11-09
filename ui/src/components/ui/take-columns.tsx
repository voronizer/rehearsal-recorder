import { drawnLength } from "@/lib/takeScale"
import { cn } from "@/lib/utils"

/*
  A song's takes as columns (C8), each as tall as it ran, in one scale: by
  default the longest of these columns fills the height. Last time draws them
  small beside a song (24 px).

  The lit column is the take the screen is about: the one Last time's play
  button plays. It is in the text's colour, or the star's green when it is
  starred. A starred take that is not lit is a paler green, the rest grey. A
  column's width follows its height: 6 px at 24, 8 px at 36.

  It is a picture of figures that the caller says in words, so a screen
  reader skips it: the caller names it.
*/

type TakeColumn = {
  /** The take's number in the rehearsal, to tell the columns apart. */
  key: number
  /** How long it ran, in seconds. */
  sec: number
  starred: boolean
  lit: boolean
}

function TakeColumns({
  columns,
  height,
  longest,
  className,
}: {
  columns: TakeColumn[]
  /** How tall the longest column is, in px. */
  height: 24 | 36
  /** The length that fills `height`, where it is not the longest of these
   *  columns: Last time draws every song to the scale of its longest take. */
  longest?: number
  className?: string
}) {
  if (columns.length === 0) return null
  const full = longest ?? Math.max(...columns.map((c) => c.sec), 1)
  return (
    <div aria-hidden data-columns className={cn("flex shrink-0 items-end gap-1", className)}>
      {columns.map((c) => (
        <span
          key={c.key}
          data-column
          data-lit={c.lit || undefined}
          data-starred={c.starred || undefined}
          className="flex flex-col items-center"
        >
          <span className="flex items-end" style={{ height }}>
            <span
              data-bar
              className={cn(
                "rounded-sm",
                height === 24 ? "w-1.5" : "w-2",
                c.lit
                  ? c.starred
                    ? "bg-signal"
                    : "bg-foreground"
                  : c.starred
                    ? "bg-signal/45"
                    : "bg-muted-foreground/35"
              )}
              style={{ height: drawnLength(c.sec, full, height) }}
            />
          </span>
        </span>
      ))}
    </div>
  )
}

export { TakeColumns, type TakeColumn }
