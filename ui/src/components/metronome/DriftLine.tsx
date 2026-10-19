import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { NoteGlyph } from "@/components/metronome/NoteGlyph"
import type { Signature } from "@/lib/api"
import { unitTitle } from "@/lib/metronome"
import {
  CHIP_ROOM_PX,
  chipSpot,
  chipsShown,
  signed,
  stretches,
  yOf,
  type Box,
  type ChipSpot,
  type DriftBar,
  type Stretch,
} from "@/lib/drift"
import { cn } from "@/lib/utils"

/** A tempo with what it counts: "135 bpm", or 6/8's drawn eighth. */
function TempoWords({ tempo, signature }: { tempo: number; signature: Signature }) {
  return signature === "6/8" ? (
    <>
      {tempo} <NoteGlyph role="img" aria-hidden={false} aria-label={unitTitle(signature)} />
    </>
  ) : (
    <>{tempo} bpm</>
  )
}

/**
 * The band's tempo through a take, along Master's lane (drift spec Part 3):
 * a dashed line where it aimed, a faint band as wide as the tolerance either
 * way, and the band's own tempo bar by bar as a line through each bar's
 * middle. Two bars or more off the same way are amber, filled to the aim,
 * with a chip that says by how much. Hovering says a bar's tempo. Over the
 * seconds `from` to `to`, as the tracks' pictures are; a bar with no tempo
 * breaks the line. No chip goes under the lane's tag (`chipSpot`).
 */
export function DriftLine({
  bars,
  aim,
  signature,
  tolerance,
  from,
  to,
  clear = null,
}: {
  bars: DriftBar[]
  aim: number
  signature: Signature
  tolerance: number
  from: number
  to: number
  /** The tag's corner: its right and bottom edges, in px from the lane's
   *  top left. */
  clear?: { right: number; bottom: number } | null
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Box>({ width: 0, height: 50 })
  const [hover, setHover] = useState<DriftBar | null>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])

  const found = useMemo(() => stretches(bars, aim, tolerance), [bars, aim, tolerance])
  const span = Math.max(0.001, to - from)
  const x = (t: number) => ((t - from) / span) * 100
  const mid = (b: DriftBar) => x((b.start + b.end) / 2)
  const point = (b: DriftBar) => `${mid(b)},${yOf(b.tempo as number, aim)}`
  const pointOf = (b: DriftBar) => ({
    x: (mid(b) / 100) * size.width,
    y: (yOf(b.tempo as number, aim) / 100) * size.height,
  })
  // Each stretch's chip: over its peak, or the nearest bar of it the tag
  // leaves clear. One out of view has none.
  const spots = new Map<Stretch, ChipSpot | null>()
  for (const s of found) {
    const left = mid(bars[s.peak])
    if (left < 0 || left > 100) {
      spots.set(s, null)
      continue
    }
    const nearest = bars
      .slice(s.first, s.last + 1)
      .filter((b) => b.tempo !== null && b !== bars[s.peak])
      .sort((a, b) => Math.abs(a.n - bars[s.peak].n) - Math.abs(b.n - bars[s.peak].n))
    spots.set(s, chipSpot(s.sign, [bars[s.peak], ...nearest].map(pointOf), size, clear))
  }
  const placed = found.filter((s) => spots.get(s))
  const shown = chipsShown(placed, (s) => spots.get(s)!.x, CHIP_ROOM_PX)

  // The line, in pieces: a bar with no tempo ends one and the next begins
  // the next.
  const pieces: DriftBar[][] = []
  for (const b of bars) {
    if (b.tempo === null) pieces.push([])
    else if (pieces.length && pieces[pieces.length - 1].length) pieces[pieces.length - 1].push(b)
    else pieces.push([b])
  }
  const lines = pieces.filter((p) => p.length > 1)
  const amber = (s: Stretch) => bars.slice(s.first, s.last + 1).filter((b) => b.tempo !== null)
  const top = yOf(aim * (1 + tolerance), aim)
  const bottom = yOf(aim * (1 - tolerance), aim)

  return (
    <div
      ref={box}
      data-drift-line
      aria-hidden
      className="absolute inset-0"
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        const t = from + ((e.clientX - rect.left) / rect.width) * span
        setHover(bars.find((b) => t >= b.start && t < b.end) ?? null)
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <rect data-drift-band x="-1" y={top} width="102" height={bottom - top} className="fill-foreground/[0.07]" />
        <line
          data-drift-aim
          x1="0"
          x2="100"
          y1="50"
          y2="50"
          className="stroke-foreground/40"
          strokeWidth="1"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        {found.map((s) => {
          const inside = amber(s)
          if (!inside.length) return null
          return (
            <polygon
              key={`fill-${s.first}`}
              points={`${mid(inside[0])},50 ${inside.map(point).join(" ")} ${mid(inside[inside.length - 1])},50`}
              className="fill-warn/30"
            />
          )
        })}
        {lines.map((piece) => (
          <polyline
            key={piece[0].n}
            data-drift-tempo
            points={piece.map(point).join(" ")}
            fill="none"
            className="stroke-foreground"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {found.map((s) => (
          <polyline
            key={`line-${s.first}`}
            data-drift-stretch
            points={amber(s).map(point).join(" ")}
            fill="none"
            className="stroke-warn"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {placed.map((s) => {
        if (!shown.has(s)) return null
        const spot = spots.get(s)!
        return (
          <span
            key={`chip-${s.first}`}
            data-drift-chip
            className={cn(
              "pointer-events-none absolute rounded-sm bg-warn px-1 text-xs leading-4 font-medium whitespace-nowrap text-warn-foreground tabular-nums",
              spot.align === "middle" && "-translate-x-1/2",
              spot.align === "end" && "-translate-x-full"
            )}
            style={{ left: spot.x, top: spot.top }}
          >
            {signed(s.chip)}
          </span>
        )
      })}
      {hover && (
        <span
          data-drift-hover
          className={cn(
            "pointer-events-none absolute bottom-1 z-[3] rounded-sm bg-popover px-1.5 text-xs leading-4 whitespace-nowrap text-popover-foreground tabular-nums shadow-sm ring-1 ring-border",
            mid(hover) > 50 && "-translate-x-full"
          )}
          style={{ left: `${Math.min(100, Math.max(0, mid(hover)))}%` }}
        >
          Bar {hover.n}
          {hover.tempo !== null && (
            <>
              {" · "}
              <TempoWords tempo={Math.round(hover.tempo)} signature={signature} />
              {` (${signed(Math.round(hover.tempo) - Math.round(aim))})`}
            </>
          )}
        </span>
      )}
    </div>
  )
}
