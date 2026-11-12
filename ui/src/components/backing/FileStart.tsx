import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react"
import { Waveform } from "@/components/Waveform"
import { Slider } from "@/components/ui/slider"
import { screenTakesKey } from "@/hooks/useSpacebar"
import type { Signature } from "@/lib/api"
import { barLines, stepBarOne } from "@/lib/backing"
import { formatBarOne, formatMMSS } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Past this share of the drawing a bar's number goes left of its line,
 *  where it is not cut. */
const NEAR_END = 0.95

/** The keys the shared Slider would answer itself; bar 1 answers only ← and
 *  →, so it is not sent to the start or the end of the drawing by a key. */
const SLIDER_KEYS = new Set(["Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown"])

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
 *
 * The drawing is the shared Slider's `mark`, from 0 to `end`, over the
 * peaks; its thumb is the marker, the tab with "1" on it.
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
  // Where bar 1 is while it is dragged, until it is let go.
  const [dragged, setDragged] = useState<number | null>(null)
  const shown = dragged ?? firstBar
  const share = shown / end
  const at = (seconds: number) => `${(seconds / end) * 100}%`
  const lines = barLines(shown, tempo, signature, end)

  const letGo = () => {
    if (dragged === null) return
    setDragged(null)
    if (dragged !== firstBar) onFirstBar(dragged)
  }
  const keys = (e: KeyboardEvent) => {
    // Its own ← and →; none of the slider's other keys. Left focused by the
    // mouse, it hands the screen the keys the screen has, as a fader does.
    if (SLIDER_KEYS.has(e.key)) e.preventDefault()
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
    e.preventDefault()
    if (screenTakesKey(e)) return
    const by = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 0.1 : 0.01)
    const next = stepBarOne(firstBar, by, length)
    if (next !== firstBar) onFirstBar(next)
  }

  return (
    <div className="flex flex-col gap-1">
      <div data-file-start className="relative h-16 overflow-hidden rounded-md select-none">
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
        <Slider
          variant="mark"
          min={0}
          max={end}
          step={0.01}
          value={[shown]}
          onValueChange={([seconds]) => setDragged(stepBarOne(seconds, 0, length))}
          onPointerDown={(e: PointerEvent) => {
            // The main button only, as before.
            if (e.button !== 0) e.preventDefault()
          }}
          onPointerUp={letGo}
          onPointerCancel={letGo}
          onKeyDown={keys}
          aria-label="Bar 1"
          aria-valuetext={formatBarOne(shown)}
          className="absolute inset-0 @container cursor-ew-resize items-start"
          // The marker is centred on bar 1, as the bar lines are on theirs,
          // and held a little in from the left edge, where a bar 1 at the
          // file's start would put half of it out of the drawing: this
          // takes back what the slider does to keep its thumb inside.
          style={{ "--mark-shift": `calc(max(${-share} * 100cqi, -0.5rem) + ${share} * 1rem)` } as CSSProperties}
          thumbClassName="flex h-4 w-4 items-center justify-center rounded-b-md bg-primary text-xs leading-4 font-semibold text-primary-foreground [translate:var(--mark-shift)_0] focus-visible:ring-[3px] focus-visible:ring-ring/50"
          thumb="1"
        />
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
