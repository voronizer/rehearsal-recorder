import { InstrumentIcon } from "@/components/InstrumentIcon"
import { cn } from "@/lib/utils"
import { peakToDb } from "@/lib/format"
import { CLIP_THRESHOLD, QUIET_THRESHOLD, meterReach } from "@/lib/levels"

const percent = (peak: number) => Math.min(100, Math.max(0, peak * 100))
/** How high the fill reaches, in dB as on the desk — see meterReach. */
const reach = (peak: number) => meterReach(peak) * 100

/**
 * One track while it records, as a tile that fills from the bottom with its
 * level — read from behind the kit, not from the laptop.
 *
 * Every tile is one width whatever it carries, so sixteen tracks still fit in
 * one row. A stereo track is split down the middle, left and right each
 * filling on its own: one fill for the louder side would hide an overhead
 * that stopped arriving, which is the thing this exists to catch.
 *
 * The writing on it shrinks with the tile rather than with the track count,
 * and what does not fit at that size — the input, the words — goes, leaving
 * the colour to say it: a red edge for a clip in the last minute, dimmed for
 * silence. The latest peak in dB sits at the top, out of the name's way,
 * and the fill is in dB too, from −60 at the bottom to full scale at the top,
 * as on the desk the band sets its gain on. The track's icon stands in the
 * corner opposite the figure, as a second way to find your own tile.
 */
export function TrackTile({
  name,
  icon,
  channel,
  stereo,
  peaks,
  shown,
  held,
  clips,
  silent,
}: {
  name: string
  icon?: string
  channel: number | null
  stereo?: boolean
  /** One figure per side, 0..1. */
  peaks: number[]
  /** Where each side's meter stands, falling back from its peaks, 0..1. */
  shown: number[]
  /** The highest each side reached lately, 0..1. */
  held: number[]
  /** Clips in the last minute. */
  clips: number
  silent: boolean
}) {
  const sides = peaks.length ? peaks : [0]
  // The figure is the peak the line holds, not the last poll's: that
  // changed fourteen times a second, and what the eye kept of it was the
  // troughs between the hits.
  const peak = Math.max(...sides, ...held)

  return (
    <div
      role="group"
      aria-label={name}
      data-clipped={clips > 0 || undefined}
      data-silent={silent || undefined}
      data-channels={sides.length}
      className={cn(
        "@container relative min-h-24 min-w-0 overflow-hidden rounded-xl border bg-card transition-opacity duration-300",
        clips > 0 && "border-destructive/70",
        silent && "opacity-45"
      )}
    >
      <div className="absolute inset-0 flex gap-0.5">
        {sides.map((side, i) => (
          <div
            key={i}
            data-side={i + 1}
            data-level={Math.round(percent(side))}
            className="relative flex-1"
          >
            {/* Nothing at all for silence: a lit line along the bottom of a
                dead input would read as a little signal. The fill stands
                where the meter has fallen back to, not at the last poll. */}
            {(shown[i] ?? side) >= QUIET_THRESHOLD && (
              <div
                data-fill
                className={cn(
                  "absolute inset-x-0 bottom-0 border-t-2 transition-[height] duration-75",
                  side > CLIP_THRESHOLD
                    ? "border-destructive bg-destructive/25"
                    : "border-signal bg-signal/15"
                )}
                style={{ height: `${reach(shown[i] ?? side)}%` }}
              />
            )}
            {(held[i] ?? 0) > QUIET_THRESHOLD && (
              <div
                className="absolute inset-x-0 h-0.5 bg-foreground/35"
                style={{ bottom: `${reach(held[i])}%` }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="relative grid h-full grid-rows-[auto_minmax(0,1fr)] gap-2 p-[clamp(0.375rem,7cqi,1.25rem)]">
        {/* On a card of their own, the icon and the figure alike: in dB a
            level that is set well stands near the top, and the fill and its
            line ran through the figure. */}
        <div className="flex items-start justify-between gap-1">
          <span className="shrink-0 rounded bg-card/85 p-0.5">
            <InstrumentIcon icon={icon} className="size-[clamp(1rem,14cqi,1.75rem)]" />
          </span>
          <div className="flex min-w-0 flex-col items-end gap-1 text-right [&>span]:rounded [&>span]:bg-card/85 [&>span]:px-1">
            <span
              className={cn(
                "tnum",
                peak > CLIP_THRESHOLD ? "text-destructive" : "text-muted-foreground"
              )}
              style={{ fontSize: "clamp(0.6875rem, 8cqi, 1.125rem)" }}
            >
              {peakToDb(peak)}
              <span className="@max-[7rem]:hidden"> dB</span>
            </span>
            {clips > 0 && (
              <span className="text-xs font-semibold text-destructive @max-[7rem]:hidden">
                {clips > 1 ? `clipped ${clips}×` : "clipped"}
              </span>
            )}
            {silent && clips === 0 && (
              <span className="text-xs text-muted-foreground @max-[7rem]:hidden">
                silent
              </span>
            )}
          </div>
        </div>

        {/* The name runs up the tile from its bottom left corner, as on the
            spine of a book: a tile is tall and, sixteen to a row, narrow, and
            "Overheads" across one came out as "Overhea / ds". Written the
            same way on a wide tile, so there is one way to read them. */}
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
            className="tnum max-h-full overflow-hidden text-xs leading-none text-ellipsis whitespace-nowrap text-muted-foreground @max-[7rem]:hidden"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {channel === null
              ? "No input"
              : stereo
                ? `Inputs ${channel}–${channel + 1}`
                : `Input ${channel}`}
          </div>
        </div>
      </div>
    </div>
  )
}
