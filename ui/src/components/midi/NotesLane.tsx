import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { TakeNotes } from "@/lib/api"

/** Room left above the top row and below the bottom one, so a bar there is
 *  not drawn against the lane's edge. */
const PAD_PX = 3
/** A label needs this much height to be read: the 9 px text and its chip. */
const LABEL_MIN_PX = 11
/** The narrowest a note is drawn. A drum hit lasts a tenth of a second, which
 *  is under a pixel on a long take zoomed out, and a note struck as a file's
 *  very last event is 0 long: either would not be drawn at all. */
const MIN_NOTE_PX = 2

/**
 * One track's notes, on the same time axis as the audio lanes above and
 * below it: a drum grid for a kit (Crash at the top, Kick at the bottom, as
 * a DAW's drum editor has them), and notes by pitch for anything else.
 *
 * Each note is a bar as long as it was held, paler the softer it was played.
 * The part already played is in the accent and the rest grey, as the
 * waveform does: a long note the playhead is in the middle of is both.
 *
 * Row names show only when the rows are tall enough to read them: the
 * drums' each, and for pitches the octave each C names.
 *
 * Nothing here is heard. The lane only draws what take_notes read back from
 * the .mid, all of it at once, so zooming asks Python for nothing.
 */
export function NotesLane({
  name,
  data,
  duration,
  view,
  playhead,
  missing = false,
  className,
}: {
  /** The track's name, for finding the lane: data-notes-lane. */
  name?: string
  /** The notes read back, or what went wrong reading them; null while they
   *  are being read. */
  data: TakeNotes | null
  duration: number
  /** The stretch of the take on screen; none is all of it. */
  view?: { from: number; to: number } | null
  playhead: number
  /** The track's port was not there the whole take: no .mid to draw. */
  missing?: boolean
  /** The lane's height comes from here, as a waveform's does. Nothing
   *  inside it has a height of its own, so beside a plate it is as tall as
   *  the plate. */
  className?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const from = view?.from ?? 0
  const to = view?.to ?? duration

  useEffect(() => {
    const box = boxRef.current
    if (!box) return
    const measure = () => setSize({ width: box.clientWidth, height: box.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const notes = !missing && data && !("error" in data) ? data : null
  // How the lane is cut across: a row per drum, or one per pitch from the
  // take's lowest octave to its highest.
  const rows = notes ? (notes.drums ? notes.rows.length : notes.high - notes.low + 1) : 0
  const rowPx = rows ? (size.height - PAD_PX * 2) / rows : 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { width, height } = size
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    const ctx = canvas.getContext("2d")
    if (!ctx || !notes || width === 0 || height === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const span = to - from
    if (span <= 0) return

    const styles = getComputedStyle(canvas)
    const played = styles.getPropertyValue("--nl-played").trim()
    const rest = styles.getPropertyValue("--nl-rest").trim()
    const grid = styles.getPropertyValue("--nl-grid").trim()
    const x = (t: number) => ((t - from) / span) * width
    const playedX = x(playhead)

    // The lines between the drum rows, and under each C.
    ctx.fillStyle = grid
    if (notes.drums) {
      for (let r = 1; r < rows; r++) ctx.fillRect(0, PAD_PX + r * rowPx, width, 1)
    } else {
      for (let p = notes.low; p <= notes.high; p++)
        if (p % 12 === 0) ctx.fillRect(0, PAD_PX + (notes.high - p + 1) * rowPx, width, 1)
    }

    // The notes come in the order they began (midi/notes.py), so the first
    // one past the window ends the drawing: a long take zoomed in is not
    // walked to its end every frame.
    for (const [t, d, at, vel] of notes.notes) {
      if (t > to) break
      if (t + d < from) continue
      const left = x(t)
      const right = left + Math.max(MIN_NOTE_PX, (d / span) * width)
      const top = notes.drums
        ? PAD_PX + at * rowPx + rowPx * 0.18
        : PAD_PX + (notes.high - at) * rowPx
      const tall = Math.max(1.5, notes.drums ? rowPx * 0.64 : rowPx * 0.9)
      // Velocity is MIDI's, 1 to 127: the softest still shows.
      ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, Math.max(0, vel / 127))
      if (left < playedX) {
        ctx.fillStyle = played
        ctx.fillRect(left, top, Math.min(right, playedX) - left, tall)
      }
      if (right > playedX) {
        ctx.fillStyle = rest
        const start = Math.max(left, playedX)
        ctx.fillRect(start, top, right - start, tall)
      }
    }
    ctx.globalAlpha = 1
  }, [size, notes, rows, rowPx, from, to, playhead])

  const message = missing
    ? "No notes in this take"
    : data && "error" in data
      ? data.error
      : notes && notes.notes.length === 0
        ? "No notes in this take"
        : null
  // A drum row each, or for pitches the octave above each C.
  const labelled = notes !== null && notes.notes.length > 0 && rowPx * (notes.drums ? 1 : 12) >= LABEL_MIN_PX

  return (
    <div
      ref={boxRef}
      data-notes-lane={name}
      style={
        {
          "--nl-played": "var(--color-primary)",
          "--nl-rest": "color-mix(in oklab, var(--color-muted-foreground) 70%, transparent)",
          "--nl-grid": "color-mix(in oklab, var(--color-border) 80%, transparent)",
        } as React.CSSProperties
      }
      className={cn("relative w-full overflow-hidden rounded-md bg-background", className)}
    >
      {/* Out of the flow: a canvas is as tall as it was last drawn, and in
          the flow it would hold the lane at that height. */}
      <canvas ref={canvasRef} className="absolute inset-0 block size-full" />
      {message && (
        <span className="absolute inset-0 grid place-items-center px-2 text-center text-xs text-muted-foreground">
          {message}
        </span>
      )}
      {labelled && notes.drums && (
        <div
          className="pointer-events-none absolute left-1 flex flex-col"
          style={{ top: PAD_PX, bottom: PAD_PX }}
        >
          {notes.rows.map((row) => (
            <span key={row} className="flex flex-1 items-center">
              <span className="rounded-sm bg-background/85 px-0.5 text-[9px] leading-none text-muted-foreground">
                {row}
              </span>
            </span>
          ))}
        </div>
      )}
      {labelled && !notes.drums && (
        <div className="pointer-events-none absolute left-1" style={{ top: PAD_PX, bottom: PAD_PX }}>
          {Array.from({ length: notes.high - notes.low + 1 }, (_, i) => notes.low + i)
            .filter((p) => p % 12 === 0)
            .map((p) => (
              <span
                key={p}
                className="absolute -translate-y-full rounded-sm bg-background/85 px-0.5 text-[9px] leading-none whitespace-nowrap text-muted-foreground"
                style={{ top: `${((notes.high - p + 1) / (notes.high - notes.low + 1)) * 100}%` }}
              >
                C{p / 12 - 1}
              </span>
            ))}
        </div>
      )}
    </div>
  )
}
