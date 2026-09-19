import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { markerStyle } from "@/lib/markers"
import type { Marker } from "@/lib/api"

/**
 * One track's waveform. The peaks arrive ready-made from Python (one value
 * per bar), so drawing costs nothing and the browser never has to decode
 * audio just to show a picture.
 *
 * The played part is highlighted, the A–B region is tinted, markers are drawn
 * as ticks. Click and drag to scrub.
 */
export function Waveform({
  peaks,
  duration,
  position,
  loop,
  markers,
  dimmed,
  onSeek,
  className,
}: {
  peaks: number[]
  duration: number
  position: number
  loop?: { a: number; b: number } | null
  markers?: Marker[]
  dimmed?: boolean
  onSeek?: (seconds: number) => void
  /** Height comes from a class (h-9 / h-12) so the waveform grows with the
   *  interface scale, which changes the base font size. */
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const box = boxRef.current
    if (!canvas || !box) return

    const draw = () => {
      const width = box.clientWidth
      const height = box.clientHeight
      if (width === 0 || height === 0) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(width * dpr)
      canvas.height = Math.floor(height * dpr)

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const styles = getComputedStyle(canvas)
      const playedColor = styles.getPropertyValue("--wf-played").trim()
      const restColor = styles.getPropertyValue("--wf-rest").trim()
      const loopColor = styles.getPropertyValue("--wf-loop").trim()
      const markerColor = styles.getPropertyValue("--wf-marker").trim()

      if (loop && duration > 0) {
        ctx.fillStyle = loopColor
        const x1 = (loop.a / duration) * width
        const x2 = (loop.b / duration) * width
        ctx.fillRect(x1, 0, Math.max(1, x2 - x1), height)
      }

      const mid = height / 2
      const n = peaks.length
      if (n === 0) return
      const barWidth = width / n
      const playedX = duration > 0 ? (position / duration) * width : 0

      for (let i = 0; i < n; i++) {
        const x = i * barWidth
        // A minimum height so silence reads as a line rather than a gap
        const h = Math.max(1, peaks[i] * (height - 4))
        ctx.fillStyle = x + barWidth <= playedX ? playedColor : restColor
        ctx.fillRect(x, mid - h / 2, Math.max(0.5, barWidth - 0.5), h)
      }

      if (markers && duration > 0) {
        for (const m of markers) {
          // The colour carries the meaning: red is where it fell apart.
          ctx.fillStyle =
            styles.getPropertyValue(markerStyle(m.kind).cssVar).trim() ||
            markerColor
          const x = (m.at / duration) * width
          ctx.fillRect(x - 1, 0, 2, height)
          // a little flag on top, so a marker is visible even on a loud part
          ctx.beginPath()
          ctx.moveTo(x - 1, 0)
          ctx.lineTo(x + 6, 0)
          ctx.lineTo(x - 1, 7)
          ctx.closePath()
          ctx.fill()
        }
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(box)
    return () => ro.disconnect()
  }, [peaks, duration, position, loop, markers])

  const seekFromEvent = (clientX: number) => {
    const box = boxRef.current
    if (!box || !onSeek || duration <= 0) return
    const rect = box.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onSeek(ratio * duration)
  }

  return (
    <div
      ref={boxRef}
      onPointerDown={(e) => {
        if (!onSeek) return
        e.currentTarget.setPointerCapture(e.pointerId)
        seekFromEvent(e.clientX)
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) seekFromEvent(e.clientX)
      }}
      style={
        {
          "--wf-played": "var(--color-primary)",
          "--wf-rest": dimmed
            ? "color-mix(in oklab, var(--color-muted-foreground) 35%, transparent)"
            : "color-mix(in oklab, var(--color-muted-foreground) 70%, transparent)",
          "--wf-loop": "color-mix(in oklab, var(--color-warn) 14%, transparent)",
          "--wf-marker": "var(--color-signal)",
        } as React.CSSProperties
      }
      className={cn(
        "relative w-full overflow-hidden rounded-md bg-background",
        onSeek && "cursor-pointer",
        className
      )}
    >
      <canvas ref={canvasRef} className="block size-full" />
      {duration > 0 && (
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
          style={{ left: `${(position / duration) * 100}%` }}
        />
      )}
    </div>
  )
}
