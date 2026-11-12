import { useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { Separator } from "@/components/ui/separator"
import { FooterTight } from "@/hooks/useFooterTight"
import { cn } from "@/lib/utils"

/**
 * A screen's footer as one row: what the screen has to say on the left, its
 * buttons on the right, the main one rightmost, so that it is in the same
 * place on every screen. Stacked with the name field and its songs, a
 * footer came to about 270 px; in a row, 183.
 *
 * `rule` draws a line between the two halves, where the left one holds a
 * field: the start screen's rehearsal name.
 *
 * With a field, the buttons get the same room on every screen that has one.
 * Its songs wrap under it by the room they have, and buttons of different
 * widths gave the songs different room: a list that took two rows on one
 * screen fitted in one on the next, and the field dropped a row. 26rem
 * held the rehearsal screen's buttons in the tests' browser, Record still
 * saying the take's number then, up to 100. (That screen has its Next take
 * field in a panel of its own since issue #12 step 6.)
 *
 * Short of room, the row stays one row and gives things up, least needed
 * first (owner's pick B, 2026-11-02): in the smallest window at 115 % the
 * metronome's row slid under Finish, and at 130 % the start screen's name
 * field was a sliver. With `squeeze` steps, whenever either half changes
 * width the footer takes them one by one until the left part fits
 * (`data-tight` on it, 1 to `squeeze`). From step 1 the key chips and the
 * buttons' kept room go; what goes at each step is marked where it is
 * drawn, `data-squeeze="2"` to go, `data-squeeze-quiet="2"` to stay for a
 * screen reader only (index.css). The keys still work.
 */
export function FooterRow({
  left,
  rule = false,
  squeeze = 0,
  children,
}: {
  left?: ReactNode
  rule?: boolean
  /** How many steps the footer may take to give its left part room. */
  squeeze?: number
  /** The buttons, and any line that goes under them. */
  children: ReactNode
}) {
  const row = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const [tight, setTight] = useState(0)

  useLayoutEffect(() => {
    const el = row.current
    const part = leftRef.current
    const actions = actionsRef.current
    if (!squeeze || !el || !part || !actions) return
    // Measured afresh from none: more room may need fewer steps. A ghost
    // button's padding reaching a little into the gap after the part is no
    // collision, so half a rem of it is let be.
    const fit = () => {
      const slack = parseFloat(getComputedStyle(document.documentElement).fontSize) / 2
      let n = 0
      el.removeAttribute("data-tight")
      while (n < squeeze && part.scrollWidth > part.clientWidth + slack) {
        n += 1
        el.setAttribute("data-tight", String(n))
      }
      setTight(n)
    }
    fit()
    // Again whenever either half changes width: the window, the Appearance
    // scale, a set with a long name. In the next frame, as fitting changes
    // the widths it is woken by.
    let frame = 0
    const watch = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    })
    watch.observe(part)
    watch.observe(actions)
    return () => {
      cancelAnimationFrame(frame)
      watch.disconnect()
    }
  }, [squeeze])

  return (
    <FooterTight.Provider value={tight}>
      <div ref={row} data-footer className="mx-auto flex w-full max-w-7xl items-center gap-7">
        <div ref={leftRef} className="min-w-0 flex-1">
          {left}
        </div>
        {rule && (
          <Separator
            orientation="vertical"
            data-footer-rule
            // As tall as the row: stretched, which a height of its own stops.
            className="self-stretch data-[orientation=vertical]:h-auto"
          />
        )}
        <div
          ref={actionsRef}
          data-footer-actions
          className={cn("flex shrink-0 flex-col items-end gap-2", rule && "min-w-[26rem]")}
        >
          {children}
        </div>
      </div>
    </FooterTight.Provider>
  )
}
