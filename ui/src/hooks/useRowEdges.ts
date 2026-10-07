import { useCallback, useEffect, useLayoutEffect, useState } from "react"

/** How far a row fades out at an end that has more of it past the edge. */
export const FADE = 48

/** A fade at each end of a row that has more past it. */
function fadeMask(before: boolean, after: boolean): string {
  if (!before && !after) return ""
  const from = before ? `transparent, #000 ${FADE}px` : "#000"
  const to = after ? `#000 calc(100% - ${FADE}px), transparent` : "#000"
  return `linear-gradient(to right, ${from}, ${to})`
}

/**
 * The two ends of a row that scrolls sideways. The row fades out at an end
 * that has more of it past the edge, and carries `data-before` or
 * `data-after` for whatever is drawn there; `page` moves it a screenful. A
 * plain mouse wheel moves it too, since only a trackpad or Shift would
 * otherwise, and nothing said the row went on.
 *
 * Both are set on the element rather than rendered: they change with every
 * scroll, and are known only from the layout.
 *
 * `ref` goes on the row. It is a callback, not a ref object, because the
 * row can come later than the component: the rehearsal screen's strip has
 * no row until its first take. `keep` picks the one thing in the row that
 * is brought back into view when the row gets narrower or wider.
 */
export function useRowEdges(keep: string) {
  const [row, setRow] = useState<HTMLElement | null>(null)

  const measure = useCallback(() => {
    if (!row) return
    const before = row.scrollLeft > 1
    const after = row.scrollLeft + row.clientWidth < row.scrollWidth - 1
    row.toggleAttribute("data-before", before)
    row.toggleAttribute("data-after", after)
    const mask = fadeMask(before, after)
    row.style.setProperty("mask-image", mask)
    row.style.setProperty("-webkit-mask-image", mask)
  }, [row])

  // After every render as well as on scroll and resize: a tab that comes,
  // goes or grows changes how much there is to scroll without changing the
  // row's own box, and a resize observer would not hear of it.
  useLayoutEffect(measure)

  /** Moves the row as little as it takes for `el` to be whole in it, and
   *  clear of a fade, which would hide half of it otherwise. */
  const reveal = useCallback(
    (el: HTMLElement) => {
      if (!row) return
      const box = row.getBoundingClientRect()
      const from = el.getBoundingClientRect().left - box.left + row.scrollLeft
      const to = from + el.offsetWidth
      let at = row.scrollLeft
      if (from - FADE < at) at = from - FADE
      else if (to + FADE > at + row.clientWidth) at = to + FADE - row.clientWidth
      row.scrollTo({ left: Math.max(0, Math.min(at, row.scrollWidth - row.clientWidth)) })
    },
    [row]
  )

  useEffect(() => {
    if (!row) return
    // A narrower window, or the take's buttons coming in, can leave the
    // open tab past an edge; opening the strip out changes only the height.
    let width = -1
    const resized = new ResizeObserver(() => {
      if (row.clientWidth !== width) {
        width = row.clientWidth
        const el = row.querySelector<HTMLElement>(keep)
        if (el) reveal(el)
      }
      measure()
    })
    resized.observe(row)
    const wheel = (e: WheelEvent) => {
      // A sideways swipe already scrolls it, and Ctrl or ⌘ is a zoom.
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      // An opened-out column of goes scrolls up and down on its own.
      if (e.target instanceof Element && e.target.closest("[data-column]")) return
      const by = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? row.clientWidth : 1)
      const room = by > 0 ? row.scrollWidth - row.clientWidth - row.scrollLeft : row.scrollLeft
      // At the end the page gets the wheel back, as if the row were not there.
      if (room < 1) return
      e.preventDefault()
      row.scrollBy({ left: by })
    }
    row.addEventListener("scroll", measure, { passive: true })
    row.addEventListener("wheel", wheel, { passive: false })
    return () => {
      resized.disconnect()
      row.removeEventListener("scroll", measure)
      row.removeEventListener("wheel", wheel)
    }
  }, [row, keep, measure, reveal])

  /** The next screenful one way, less the fades, so the tab half under one
   *  is whole after the move. */
  const page = useCallback(
    (dir: -1 | 1) => {
      row?.scrollBy({ left: dir * Math.max(row.clientWidth - 2 * FADE, FADE), behavior: "smooth" })
    },
    [row]
  )

  return { ref: setRow, row, page, reveal }
}
