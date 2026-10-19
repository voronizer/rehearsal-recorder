import { useLayoutEffect, useRef, useState } from "react"
import { DriftLine } from "@/components/metronome/DriftLine"
import { MeterText, NoteGlyph } from "@/components/metronome/NoteGlyph"
import { Spinner } from "@/components/ui/spinner"
import { useAfter } from "@/hooks/useAfter"
import { usePlayerClick } from "@/hooks/usePlayerClick"
import { useDriftTolerance } from "@/hooks/useTakeDrift"
import { formatMeter } from "@/lib/format"
import { driftTag, spokenDrift, stretches, tagText, type DriftTag, type DriftView } from "@/lib/drift"
import { clickLines, clickOf, unitTitle, type TakeClick } from "@/lib/metronome"
import { cn } from "@/lib/utils"

/** What the lane says of a take that has no click and no drift line (its
 *  files are not there), on screen and to a screen reader. */
const NO_CLICK = "Recorded without the click"

/** How long the drift line may take before the lane says what it is doing
 *  (B5), in ms. */
const SAY_AFTER_MS = 10_000

/** The states of the drift line, in the tag's place. */
const STATE = { short: "Too short to show the tempo", "no-beat": "No steady beat found" } as const

/** The drift line's tag, with 6/8's drawn eighth. */
function DriftTagText({ tag }: { tag: DriftTag }) {
  if (tag.meter)
    return (
      <>
        {tag.lead} <MeterText tempo={tag.tempo} signature={tag.signature} />
        {tag.tail}
      </>
    )
  return (
    <>
      {tag.lead}{" "}
      <span className="tnum">
        {tag.tempo}{" "}
        {tag.signature === "6/8" ? (
          <NoteGlyph role="img" aria-hidden={false} aria-label={unitTitle(tag.signature)} />
        ) : (
          "bpm"
        )}
      </span>
      {tag.tail}
    </>
  )
}

/**
 * Master's lane, right of its plate and as tall as a track's (spec Part 8,
 * Q11 D): the take's click as stripes, a bar's taller and stronger than a
 * beat's, on a well as the tracks' pictures are, over the same seconds as
 * theirs, `from` to `to`. Dimmed to half while the click is off; the
 * playhead and the region over it as over the tracks; the tempo in its
 * corner. With many clicks in view it draws the bars only, and with very
 * many every fourth bar (`clickLines`). A drag across it sets the region as
 * one across the tracks does: the Timeline takes the pointer.
 *
 * Over the stripes, the band's tempo through the take (drift spec Part 3,
 * `DriftLine`), and the tag says what it is measured against; the stripes
 * are dimmed to a third under it. The line is drawn over the tag, which
 * then has no ground of its own, so a band that rushed its first bars is
 * not hidden under the words; no chip goes there. While it is counted the tag waits its
 * second and then turns a spinner (B5); a take too short or with no steady
 * beat says so in the tag's place. With no line to draw (the take's files
 * are not there) the lane is the click's alone, and a take recorded
 * without the click says so.
 */
export function MasterClickLane({
  from,
  to,
  position,
  region = null,
  take,
  drift = null,
  className,
}: {
  from: number
  to: number
  /** The playhead, in the take's seconds. */
  position: number
  /** The region as the tracks show it, while it is dragged too. */
  region?: { a: number; b: number } | null
  take: TakeClick | null
  /** The band's tempo through the take, as `useTakeDrift` has it. */
  drift?: DriftView | null
  className?: string
}) {
  const meter = clickOf(take)
  const on = usePlayerClick()
  const tolerance = useDriftTolerance()
  const counting = Boolean(drift?.counting)
  const longWait = useAfter(counting, SAY_AFTER_MS)
  const tagBox = useRef<HTMLSpanElement>(null)
  const [clear, setClear] = useState<{ right: number; bottom: number } | null>(null)
  useLayoutEffect(() => {
    const el = tagBox.current
    if (!el) return
    const measure = () => setClear({ right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight })
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const span = Math.max(0.001, to - from)
  const pct = (t: number) => ((t - from) / span) * 100
  const lines = meter ? clickLines(meter.tempo, meter.signature, from, to) : []
  const answer = drift?.answer ?? null
  const counted = answer?.ok ? answer : null
  const state = answer && !answer.ok && (answer.why === "short" || answer.why === "no-beat") ? answer.why : null
  const tag = counted ? driftTag(counted) : null
  const clickTag = meter ? `Click ${formatMeter(meter.tempo, meter.signature)}` : NO_CLICK
  const label = counted
    ? `${tagText(tag as DriftTag)}. ${spokenDrift(counted.bars, stretches(counted.bars, counted.aim.tempo, tolerance), counted.aim.signature)}`
    : state
      ? STATE[state]
      : counting
        ? "Counting the tempo"
        : clickTag

  return (
    <div
      data-master-lane
      role="img"
      aria-label={label}
      className={cn("relative h-full min-w-0 overflow-hidden rounded-md bg-well", className)}
    >
      <div
        data-click-lines
        aria-hidden
        className={cn("absolute inset-0", counted ? (on ? "opacity-35" : "opacity-15") : !on && "opacity-50")}
      >
        {lines.map(({ t, bar }) => (
          <span
            key={t}
            data-click-line
            data-bar={bar ? "" : undefined}
            className={cn(
              "absolute w-px",
              bar ? "inset-y-1.5 bg-foreground/50" : "inset-y-4 bg-foreground/25"
            )}
            style={{ left: `${pct(t)}%` }}
          />
        ))}
      </div>
      {region && (
        <span
          data-master-region
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-x border-warn/60 bg-warn/10"
          style={{ left: `${pct(region.a)}%`, width: `${pct(region.b) - pct(region.a)}%` }}
        />
      )}
      <span
        ref={tagBox}
        data-click-tag
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded-sm px-1 text-xs text-muted-foreground",
          !counted && "bg-well/90"
        )}
      >
        {tag ? (
          <DriftTagText tag={tag} />
        ) : state ? (
          STATE[state]
        ) : counting ? (
          <>
            <Spinner className="inline size-3 align-[-0.125em]" />
            {longWait && " Counting the tempo…"}
          </>
        ) : meter ? (
          <>
            Click <MeterText tempo={meter.tempo} signature={meter.signature} />
          </>
        ) : (
          NO_CLICK
        )}
      </span>
      {counted && (
        <DriftLine
          bars={counted.bars}
          aim={counted.aim.tempo}
          signature={counted.aim.signature}
          tolerance={tolerance}
          from={from}
          to={to}
          clear={clear}
        />
      )}
      {position >= from && position <= to && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
          style={{ left: `${pct(position)}%` }}
        />
      )}
    </div>
  )
}
