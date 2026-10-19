import { useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

/**
 * The beat while a take records: the window's edge lit in the accent on
 * every click after the count-in, 14 px and full on the first of a bar, 7 px
 * and paler on the others (spec Part 5). It is a reading, as the meters are
 * (F11): on and off on the click with no fade or transition, while a take
 * records and under Reduce motion alike, since the band may count on it.
 * A thin edge, never the screen, and hidden from a screen reader.
 *
 * Drawn over everything, outside the screen's own boxes, and always there,
 * so lighting it changes nothing else on the page.
 */
export function EdgeLight({ accent }: { accent: 0 | 1 | 2 | null }) {
  // The last click's look, kept while dark.
  const [last, setLast] = useState<0 | 1 | 2>(0)
  if (accent !== null && accent !== last) setLast(accent)
  const shown = accent ?? last
  const strong = shown === 2
  return createPortal(
    <div
      data-edge-light
      data-lit={accent !== null ? "" : undefined}
      data-accent={shown}
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-50",
        accent === null && "invisible",
        !strong && "opacity-60"
      )}
      style={{ boxShadow: `inset 0 0 0 ${strong ? 14 : 7}px var(--primary)` }}
    />,
    document.body
  )
}
