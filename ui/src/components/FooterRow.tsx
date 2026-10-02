import type { ReactNode } from "react"

/**
 * A screen's footer as one row: what the screen has to say on the left, its
 * buttons on the right, the main one rightmost, so that it is in the same
 * place on every screen. Stacked with the name field and its songs, the
 * review screen's footer came to about 270 px; in a row, 183.
 *
 * `rule` draws a line between the two halves, where the left one holds a
 * field. An error goes over the buttons it is about.
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
      <div data-footer-actions className="flex shrink-0 flex-col items-end gap-2">
        {error && <p className="max-w-md text-right text-sm text-destructive">{error}</p>}
        {children}
      </div>
    </div>
  )
}
