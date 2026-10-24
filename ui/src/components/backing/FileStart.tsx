import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { Waveform } from "@/components/Waveform"
import type { Signature } from "@/lib/api"
import { barLines, stepBarOne } from "@/lib/backing"
import { formatBarOne, formatMMSS } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Past this share of the drawing a bar's number goes left of its line,
 *  where it is not cut. */
const NEAR_END = 0.95

/**
 * The start of a song's backing track, drawn on its page (spec Part 6), to
 * set bar 1 by eye: the file's peaks from 0 to `end`, a scale that the page
 * keeps while it is open, so dragging does not change it. Over it, from bar
 * 1, the song's bars, numbered, and its beats; none with no tempo.
 *
 * Bar 1's marker is dragged, or anywhere on the drawing pressed, and the new
 * place goes to `onFirstBar` once let go. With the marker in focus, ← and →
 * move it a hundredth of a second, a tenth with Shift, each step saved at
 * once. `playhead` is where ▶ has got to, null while it is still.
 */
export function FileStart({
  peaks,
  length,
  firstBar,
  tempo,
  signature,
  end,
  playhead,
  onFirstBar,
}: {
  /** One row per channel, over 0 to `end`; none while they are read. */
  peaks: number[][] | null
  /** The file's length, or null when it is not known. */
  length: number | null
  firstBar: number
  tempo: number | null
  signature: Signature | null
  end: number
  playhead: number | null
  onFirstBar: (seconds: number) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  // Where bar 1 is while it is dragged, until it is let go.
  const [dragged, setDragged] = useState<number | null>(null)
  const shown = dragged ?? firstBar
  const at = (seconds: number) => `${(seconds / end) * 100}%`
  const lines = barLines(shown, tempo, signature, end)

  const placeFrom = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    const seconds = Math.min(end, Math.max(0, ((e.clientX - r.left) / r.width) * end))
    return stepBarOne(seconds, 0, length)
  }
  const letGo = (e: PointerEvent) => {
    if (dragged === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragged(null)
    if (dragged !== firstBar) onFirstBar(dragged)
  }
  const step = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    const by = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01)
    const next = stepBarOne(firstBar, by, length)
    if (next !== firstBar) onFirstBar(next)
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={box}
        data-file-start
        className="relative h-16 cursor-ew-resize touch-none overflow-hidden rounded-md select-none"
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragged(placeFrom(e))
        }}
        onPointerMove={(e) => {
          if (dragged !== null && e.currentTarget.hasPointerCapture(e.pointerId)) setDragged(placeFrom(e))
        }}
        onPointerUp={letGo}
        onPointerCancel={letGo}
      >
        <Waveform
          peaks={peaks ?? []}
          peaksFrom={0}
          peaksTo={end}
          viewFrom={0}
          viewTo={end}
          position={playhead ?? 0}
          className="h-full"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {lines.map((line) =>
            line.bar === 1 ? null : line.bar === null ? (
              <span
                key={line.at}
                className="absolute bottom-0 h-2 w-px bg-primary/50"
                style={{ left: at(line.at) }}
              />
            ) : (
              <span key={line.at}>
                <span className="absolute top-4 bottom-0 w-px bg-primary/50" style={{ left: at(line.at) }} />
                <span
                  data-bar
                  className={cn(
                    "tnum absolute top-0 px-1 text-xs leading-4 text-muted-foreground",
                    line.at / end > NEAR_END && "-translate-x-full"
                  )}
                  style={{ left: at(line.at) }}
                >
                  {line.bar}
                </span>
              </span>
            )
          )}
          <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary" style={{ left: at(shown) }} />
          {playhead !== null && playhead <= end && (
            <span data-playhead className="absolute inset-y-0 w-px bg-foreground" style={{ left: at(playhead) }} />
          )}
        </div>
        <span
          role="slider"
          tabIndex={0}
          aria-label="Bar 1"
          aria-valuemin={0}
          aria-valuemax={length ?? end}
          aria-valuenow={shown}
          aria-valuetext={formatBarOne(shown)}
          onKeyDown={step}
          className="absolute top-0 flex h-4 min-w-4 -translate-x-1/2 items-center justify-center rounded-b-md bg-primary px-1 text-xs leading-4 font-semibold text-primary-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          // Held a little in from the left edge, where a bar 1 at the
          // file's start would put half of it out of the drawing.
          style={{ left: `max(0.5rem, ${at(shown)})` }}
        >
          1
        </span>
      </div>
      <div data-file-start-hint className="flex justify-between gap-3 text-xs text-muted-foreground">
        <span className="tnum">0:00</span>
        <span className="text-center">
          {tempo === null
            ? "No tempo, so no bars to draw: drag bar 1."
            : "Drag bar 1; the lines are the song's bars and beats."}
        </span>
        <span data-end className="tnum">
          {formatMMSS(end)}
        </span>
      </div>
    </div>
  )
}
