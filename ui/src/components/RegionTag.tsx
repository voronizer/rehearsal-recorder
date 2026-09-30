import { useLayoutEffect, useRef, useState } from "react"
import { Repeat, Scissors, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"

/** What the take player can do with a region, when it can crop at all. */
export type RegionCrop = {
  onClick: () => void
  enabled: boolean
  title: string
  /** Why Crop is off, in a few words, or absent when it is usable. */
  whyOff?: string
}

/** Plain, like the other buttons: Crop does something to the take, and the
 *  orange is the region's own. Solid, so the waveform under it does not show
 *  through the word. */
const ACTION =
  "inline-flex h-6 items-center gap-1 rounded-md border bg-card px-2 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"

/** The two beside the times are parts of the tag, in its own orange, not
 *  buttons of their own: tinted apart from it, they read as something else. */
const ON_TAG =
  "inline-flex w-5 items-center justify-center border-l border-warn-foreground/15 transition-colors hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-warn-foreground/50 focus-visible:outline-none focus-visible:ring-inset"

/**
 * The region's times, written on the region, with what can be done with it.
 *
 * Beside the times, a loop and a cross: the loop is Repeat, a hand's width
 * from the region that was just drawn rather than up in the transport, and
 * the cross clears the region the way a tag is closed. It said Clear, under
 * the times, and read as clearing that part of the take. Crop, which does
 * cut the take, is a plain button under them.
 *
 * They were in the transport, far from the stretch they act on. They go with
 * the times: zoomed to another part of the take there is nothing for them to
 * sit by, and the map above the ruler still shows where the region is. Near
 * the right edge the whole of it moves left rather than run off the end.
 */
export function RegionTag({
  a,
  b,
  leftPx,
  topPx,
  roomPx,
  actions,
  looping,
  onToggleLoop,
  onClear,
  crop,
}: {
  a: number
  b: number
  /** Where it would like to start: at the region's start, a little in. */
  leftPx: number
  topPx: number
  /** How wide the timeline is, for keeping it on it. */
  roomPx: number
  /** False while a region is still being drawn or dragged: the buttons are
   *  for one that has been let go of. */
  actions: boolean
  looping: boolean
  onToggleLoop: () => void
  onClear: () => void
  crop?: RegionCrop
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    setWidth(ref.current?.offsetWidth ?? 0)
  }, [a, b, actions, crop?.whyOff, crop?.enabled])

  const left = Math.max(0, Math.min(leftPx, roomPx - width - 8))
  // A press on the tracks starts a region and a click seeks; a press on
  // these is theirs alone.
  const theirs = (e: React.PointerEvent) => e.stopPropagation()

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute flex flex-col items-start gap-1"
      style={{ left, top: topPx }}
    >
      <div className="flex items-stretch overflow-hidden rounded bg-warn text-warn-foreground">
        <span data-region-span className="tnum px-1.5 py-0.5 text-[11px] leading-4">
          {formatMMSS(a)} – {formatMMSS(b)}
        </span>
        {actions && (
          <div className="pointer-events-auto flex items-stretch" onPointerDown={theirs}>
            {/* On, it is pressed in: darker, its loop at full strength. Off,
                the loop is faint, as the transport's Repeat is plain. */}
            <button
              type="button"
              onClick={onToggleLoop}
              aria-pressed={looping}
              aria-label="Loop the region"
              title={looping ? "Stop repeating it (R)" : "Repeat it (R)"}
              className={cn(ON_TAG, looping ? "bg-black/15 hover:bg-black/20" : "[&>svg]:opacity-55")}
            >
              <Repeat className="size-3" />
            </button>
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear the loop region"
              title="Clear it — Repeat then loops the whole take"
              className={ON_TAG}
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>
      {actions && crop && (
        <div className="pointer-events-auto flex items-center gap-1" onPointerDown={theirs}>
          <button
            type="button"
            onClick={crop.onClick}
            disabled={!crop.enabled}
            aria-label="Crop to the region"
            title={crop.title}
            className={ACTION}
          >
            <Scissors className="size-3" />
            Crop
          </button>
          {/* A disabled button takes no pointer events, so its title is
              never read; the reason has to be on screen beside it. */}
          {crop.whyOff && (
            <span className="rounded-sm bg-card/85 px-1.5 py-px text-[11px] text-muted-foreground">
              {crop.whyOff}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
