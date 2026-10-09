import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/**
 * A screen's footer as one row: what the screen has to say on the left, its
 * buttons on the right, the main one rightmost, so that it is in the same
 * place on every screen. Stacked with the name field and its songs, the
 * review screen's footer came to about 270 px; in a row, 183.
 *
 * `rule` draws a line between the two halves, where the left one holds a
 * field or, on the screen after a take, the take itself. An error goes over
 * the buttons it is about.
 *
 * With a field, the buttons get the same room on every screen that has one.
 * Its songs wrap under it by the room they have, and buttons of different
 * widths gave the songs different room: a list that took two rows on one
 * screen fitted in one on the next, and the field dropped a row. 26rem
 * holds Record take 100 in the tests' browser. (The rehearsal screen has
 * its Next take field in a panel of its own since issue #12 step 6.)
 */
export function FooterRow({
  left,
  rule = false,
  error,
  children,
}: {
  left?: ReactNode
  rule?: boolean
  error?: string | null
  /** The buttons, and any line that goes under them. */
  children: ReactNode
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl items-center gap-7">
      <div className="min-w-0 flex-1">{left}</div>
      {rule && <div data-footer-rule aria-hidden className="w-px self-stretch bg-border" />}
      <div
        data-footer-actions
        className={cn("flex shrink-0 flex-col items-end gap-2", rule && "min-w-[26rem]")}
      >
        {error && <p className="max-w-md text-right text-sm text-destructive">{error}</p>}
        {children}
      </div>
    </div>
  )
}
