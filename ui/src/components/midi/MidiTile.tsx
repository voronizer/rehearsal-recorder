import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { InstrumentIcon } from "@/components/InstrumentIcon"
import { MidiGlyph } from "@/components/midi/MidiGlyph"
import { cn } from "@/lib/utils"

/** How high a note at full velocity stands, in percent: the rest is the
 *  header's room, which the fill would run through. */
const REACH = 88
/** Below this nothing is drawn: a lit line along the bottom would read as a
 *  note still sounding, as it would for a dead input. */
const QUIET_VEL = 0.02

/**
 * What jumps with each note, from the bottom of the tile or of a Both tile's
 * column. The accent, not the green of the levels: it is not a sound and has
 * no level to set. `vel` is where the fill stands, 0..1; the screen lets it
 * fall back between notes as a meter does.
 */
export function NotesFill({ vel }: { vel: number }) {
  if (!(vel >= QUIET_VEL)) return null
  return (
    <div
      data-midi-fill
      className="absolute inset-x-0 bottom-0 border-t-2 border-primary bg-primary/20 transition-[height] duration-75"
      style={{ height: `${Math.round(Math.min(1, vel) * REACH)}%` }}
    />
  )
}

/** "12 notes", "1 note". The figure comes first so that a narrow tile can
 *  drop the word and keep the number. The word goes under 10 rem, where
 *  "12,345 notes" would not fit on the line: the header must never grow a
 *  second one when the count gets longer. */
export function NoteCount({ notes }: { notes: number }) {
  return (
    <>
      <span className="tnum">{notes.toLocaleString("en-US")}</span>
      <span className="@max-[10rem]:hidden"> {notes === 1 ? "note" : "notes"}</span>
    </>
  )
}

/**
 * A track that records notes alone, while it records: a tile in its place in
 * the band, laid out as an audio tile is so that a row of both reads as one.
 * It has the icon, how many notes it has had, and a fill that jumps with each
 * note's velocity. Where an audio tile says "Input 3" it says "MIDI", with
 * the port in its tooltip.
 *
 * It never turns grey as silent: notes come and go, and a pause is not a
 * fault. What can be wrong is the port, and a port that is not plugged in
 * edges the tile in amber, as a waiting input is on the setup screen. Its
 * notes start the moment the port appears.
 */
export function MidiTile({
  name,
  icon,
  port,
  vel,
  notes,
  connected,
  tip,
}: {
  name: string
  icon?: string
  /** The name of the port its notes come from. */
  port: string
  /** Where the fill stands, 0..1. */
  vel: number
  /** Notes played this take. */
  notes: number
  connected: boolean
  /** What the tooltip says under the port's name, when there is more to say
   *  of it: that it is not there, or another app holds it. */
  tip?: string
}) {
  // A count too long for the tile is hidden, never shown cut: "12,345" with
  // its end clipped reads as "12". It keeps its place, and the tooltip says it.
  const tile = useRef<HTMLDivElement>(null)
  const figure = useRef<HTMLSpanElement>(null)
  const [fits, setFits] = useState(true)
  const measure = useCallback(() => {
    const box = tile.current
    const chip = figure.current
    if (box && chip)
      setFits(
        chip.getBoundingClientRect().right <=
          box.getBoundingClientRect().left + box.clientLeft + box.clientWidth
      )
  }, [])
  useLayoutEffect(measure, [measure, notes])
  useEffect(() => {
    const watch = new ResizeObserver(measure)
    if (tile.current) watch.observe(tile.current)
    return () => watch.disconnect()
  }, [measure])
  // The tooltip: the port's name, and under it what there is no room to say
  // on the tile: its own sentence when it has one (not there, or held), else
  // the count that was hidden.
  const more =
    tip ?? (fits ? undefined : `${notes.toLocaleString("en-US")} ${notes === 1 ? "note" : "notes"}`)
  const title = [port, more].filter(Boolean).join("\n") || undefined

  return (
    <div
      ref={tile}
      role="group"
      aria-label={name}
      title={title}
      data-midi-tile
      data-level={Math.round(vel * 100)}
      data-not-connected={!connected || undefined}
      className={cn(
        "@container relative min-h-24 min-w-0 overflow-hidden rounded-xl border bg-card",
        !connected && "border-amber-500/60"
      )}
    >
      <NotesFill vel={vel} />

      <div className="relative grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-[clamp(0.375rem,7cqi,1.25rem)]">
        <div className="flex items-start justify-between gap-1">
          <span className="shrink-0 rounded bg-card/85 p-0.5">
            <InstrumentIcon icon={icon} className="size-[clamp(1rem,14cqi,1.75rem)]" />
          </span>
          <div className="flex min-w-0 flex-col items-end gap-1 text-right [&>span]:rounded [&>span]:bg-card/85 [&>span]:px-1">
            <span
              ref={figure}
              data-notes
              className={cn(
                "flex items-center gap-1 whitespace-nowrap text-muted-foreground",
                !fits && "invisible"
              )}
              style={{ fontSize: "clamp(0.6875rem, 8cqi, 1.125rem)" }}
            >
              <MidiGlyph className="size-[0.9em] shrink-0 text-primary @max-[7rem]:hidden" />
              <span>
                <NoteCount notes={notes} />
              </span>
            </span>
            {/* Always there, only not seen while the port is: the header is
                the same height when it comes and goes. On one line, and gone
                altogether where the line would not fit: the amber edge says
                it then. */}
            <span
              data-status
              className={cn(
                "text-xs whitespace-nowrap text-muted-foreground @max-[9.5rem]:hidden",
                connected && "invisible"
              )}
            >
              not connected
            </span>
          </div>
        </div>

        {/* The name as an audio tile writes it: up the tile from its bottom
            left corner, with what stands in for the input beside it. */}
        <div className="flex min-h-0 items-end gap-1.5">
          <div
            data-name
            className="max-h-full overflow-hidden leading-none font-semibold text-ellipsis whitespace-nowrap"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              fontSize: "clamp(0.875rem, 18cqi, 2.25rem)",
            }}
          >
            {name}
          </div>
          <div
            className="max-h-full overflow-hidden text-xs leading-none text-ellipsis whitespace-nowrap text-muted-foreground @max-[7rem]:hidden"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            MIDI
          </div>
        </div>
      </div>
    </div>
  )
}
