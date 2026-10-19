import { useEffect, useMemo, useRef, useState } from "react"
import { NoteGlyph } from "@/components/metronome/NoteGlyph"
import type { Signature } from "@/lib/api"
import { unitTitle } from "@/lib/metronome"
import { chipsShown, signed, stretches, yOf, type DriftBar, type Stretch } from "@/lib/drift"
import { cn } from "@/lib/utils"

/** A chip's height, and the room kept between it and the line, in px. */
const CHIP_PX = 16
const CHIP_GAP_PX = 3
/** Chips whose centres come closer than this would overlap: the smaller
 *  difference's is hidden. */
const CHIP_ROOM_PX = 32

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
 * breaks the line.
 */
export function DriftLine({
  bars,
  aim,
  signature,
  tolerance,
  from,
  to,
}: {
  bars: DriftBar[]
  aim: number
  signature: Signature
  tolerance: number
  from: number
  to: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 50 })
  const [hover, setHover] = useState<DriftBar | null>(null)
  useEffect(() => {
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
  const px = (s: Stretch) => (mid(bars[s.peak]) / 100) * size.width
  const shown = chipsShown(found, px, CHIP_ROOM_PX)

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
      {found.map((s) => {
        if (!shown.has(s)) return null
        const peak = bars[s.peak]
        const left = mid(peak)
        if (left < 0 || left > 100) return null
        const y = (yOf(peak.tempo as number, aim) / 100) * size.height
        // Above a rise and below a dip; beside it where the edge leaves no
        // room, on the side away from the lane's nearer end. Never past
        // either end of the lane.
        const want = s.sign > 0 ? y - CHIP_GAP_PX - CHIP_PX : y + CHIP_GAP_PX
        const fits = want >= 1 && want + CHIP_PX <= size.height - 1
        const leftward = left > 50
        return (
          <span
            key={`chip-${s.first}`}
            data-drift-chip
            className={cn(
              "pointer-events-none absolute rounded-sm bg-warn px-1 text-xs leading-4 font-medium whitespace-nowrap text-warn-foreground tabular-nums",
              fits ? "-translate-x-1/2" : leftward ? "-translate-x-[calc(100%+0.375rem)] -translate-y-1/2" : "translate-x-1.5 -translate-y-1/2"
            )}
            style={{
              left: fits
                ? `clamp(${CHIP_ROOM_PX / 2}px, ${left}%, calc(100% - ${CHIP_ROOM_PX / 2}px))`
                : `clamp(${CHIP_ROOM_PX + 6}px, ${left}%, calc(100% - ${CHIP_ROOM_PX + 6}px))`,
              top: fits ? want : Math.min(size.height - CHIP_PX / 2, Math.max(CHIP_PX / 2, y)),
            }}
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
