import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"

/** How far a row fades out at an end that has more of it past the edge. */
export const FADE = 48

/** A fade at each end of a row that has more past it. */
function fadeMask(before: boolean, after: boolean): string {
  if (!before && !after) return ""
  const from = before ? `transparent, #000 ${FADE}px` : "#000"
  const to = after ? `#000 calc(100% - ${FADE}px), transparent` : "#000"
  return `linear-gradient(to right, ${from}, ${to})`
}

/** Whether `el` is whole in the row and clear of a fade at either end. */
function isClear(row: HTMLElement, el: HTMLElement): boolean {
  const box = row.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const from = box.left + (row.hasAttribute("data-before") ? FADE : 0)
  const to = box.right - (row.hasAttribute("data-after") ? FADE : 0)
  return r.left >= from - 1 && r.right <= to + 1
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
 * is brought back into view when the row gets narrower or wider, unless
 * the row was moved away from it on purpose.
 */
export function useRowEdges(keep: string) {
  const [row, setRow] = useState<HTMLElement | null>(null)
  // Whether the row was last moved, by the wheel, a swipe or ‹ ›, to where
  // `keep` is not in view. Only a move counts: the row getting narrower is
  // what a reveal is for, and must not count as moving away.
  const away = useRef(false)

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
      away.current = false
    },
    [row]
  )

  useEffect(() => {
    if (!row) return
    // A narrower window, or the take's buttons coming in, can leave the
    // open tab past an edge. So can the window's scrollbar coming in when
    // the strip opens out, which is why a row moved away stays put.
    let width = -1
    const resized = new ResizeObserver(() => {
      if (row.clientWidth !== width) {
        width = row.clientWidth
        const el = row.querySelector<HTMLElement>(keep)
        if (el && !away.current) reveal(el)
      }
      measure()
    })
    resized.observe(row)
    const moved = () => {
      measure()
      const el = row.querySelector<HTMLElement>(keep)
      away.current = el !== null && !isClear(row, el)
    }
    const wheel = (e: WheelEvent) => {
      // A sideways swipe already scrolls it, and Ctrl or ⌘ is a zoom. A turn
      // that cannot be cancelled is one the page scrolls anyway, such as the
      // rest of a trackpad swipe: moving the row too would move it twice.
      if (!e.cancelable || e.ctrlKey || e.metaKey) return
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return
      // An opened-out column of goes that scrolls takes the wheel for
      // itself, to its end and past it, rather than slide off sideways.
      const column = e.target instanceof Element ? e.target.closest("[data-column]") : null
      if (column && column.scrollHeight > column.clientHeight) return
      const by = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? row.clientWidth : 1)
      const room = by > 0 ? row.scrollWidth - row.clientWidth - row.scrollLeft : row.scrollLeft
      // At the end the page gets the wheel back, as if the row were not there.
      if (room < 1) return
      e.preventDefault()
      row.scrollBy({ left: by })
    }
    row.addEventListener("scroll", moved, { passive: true })
    row.addEventListener("wheel", wheel, { passive: false })
    return () => {
      resized.disconnect()
      row.removeEventListener("scroll", moved)
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
