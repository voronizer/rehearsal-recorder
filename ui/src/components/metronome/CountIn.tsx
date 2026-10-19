import type { Signature } from "@/lib/api"
import { accentOf, countDigit, perBar } from "@/lib/metronome"
import { cn } from "@/lib/utils"

/**
 * The count-in on the recording screen: the click it is on, big, in the
 * clock's place and at the clock's size, from 1 to the clicks of a bar (1 to
 * 6 in 6/8), the accented ones in the accent colour (spec Part 5). Two bars
 * count the bar twice. Before the first click is heard it shows nothing. It
 * lies over the clock's box, which keeps its room, so nothing moves when the
 * clock takes over; set it in a box that is `relative` round the clock.
 *
 * A picture: the line in the metronome's row says "Count-in: 2 of 4".
 */
export function CountIn({
  count,
  signature,
  size,
}: {
  /** Python's count of the count-in's clicks, from 1; 0 before the first
   *  is heard. */
  count: number
  signature: Signature
  /** The clock's font size, which follows the window. */
  size: string
}) {
  const { digit } = countDigit(count, perBar(signature))
  return (
    <div
      data-count-in
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 text-center leading-none font-semibold tracking-tight tnum [text-box:trim-end_cap_alphabetic]",
        digit !== null && accentOf(signature, digit - 1) > 0 ? "text-primary" : "text-foreground"
      )}
      // design-ok(px-text): the count-in takes the clock's size, which is sized from the window's height
      style={{ fontSize: size }}
    >
      {digit}
    </div>
  )
}
