import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

/**
 * One track's waveform, and nothing else. The peaks arrive ready-made from
 * Python (one value per bar), so drawing costs nothing and the browser never
 * has to decode audio just to show a picture.
 *
 * The peaks cover [peaksFrom, peaksTo] and the lane shows [viewFrom, viewTo].
 * Usually those are the same stretch; while a zoom is settling they are not,
 * and the picture is then the right bars of the old peaks stretched over the
 * new window — blurred, briefly, rather than wrong.
 *
 * The played part is highlighted; the loop region, the markers and the
 * playhead belong to the whole take rather than to one track, so Timeline
 * draws them once across every lane instead of each waveform drawing its own.
 */
export function Waveform({
  peaks,
  peaksFrom,
  peaksTo,
  viewFrom,
  viewTo,
  position,
  dimmed,
  className,
}: {
  peaks: number[]
  /** The stretch of the take `peaks` covers. */
  peaksFrom: number
  peaksTo: number
  /** The stretch of the take this lane is showing. */
  viewFrom: number
  viewTo: number
  position: number
  dimmed?: boolean
  /** Height comes from the caller's class — Timeline gives each lane
   *  `h-full` so it fills the row height the grid assigns it. */
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

      const mid = height / 2
      const n = peaks.length
      const peakSpan = peaksTo - peaksFrom
      const viewSpan = viewTo - viewFrom
      if (n === 0 || peakSpan <= 0 || viewSpan <= 0) return

      // Which of the bars we have cover the part being shown.
      const perBar = peakSpan / n
      const first = Math.max(0, Math.floor((viewFrom - peaksFrom) / perBar))
      const last = Math.min(n, Math.ceil((viewTo - peaksFrom) / perBar))
      const shown = last - first
      if (shown <= 0) return

      const barWidth = width / shown
      const playedX = ((position - viewFrom) / viewSpan) * width

      for (let i = first; i < last; i++) {
        const x = (i - first) * barWidth
        // A minimum height so silence reads as a line rather than a gap
        const h = Math.max(1, peaks[i] * (height - 4))
        ctx.fillStyle = x + barWidth <= playedX ? playedColor : restColor
        ctx.fillRect(x, mid - h / 2, Math.max(0.5, barWidth - 0.5), h)
      }
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(box)
    return () => ro.disconnect()
  }, [peaks, peaksFrom, peaksTo, viewFrom, viewTo, position])

  return (
    <div
      ref={boxRef}
      style={
        {
          "--wf-played": "var(--color-primary)",
          "--wf-rest": dimmed
            ? "color-mix(in oklab, var(--color-muted-foreground) 35%, transparent)"
            : "color-mix(in oklab, var(--color-muted-foreground) 70%, transparent)",
        } as React.CSSProperties
      }
      className={cn(
        "relative w-full overflow-hidden rounded-md bg-background",
        className
      )}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  )
}
