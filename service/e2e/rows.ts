import type { Locator } from "@playwright/test"

/**
 * The room between a list's rows, in px, as the band sees it: from one
 * row's content (its box less its padding) to the next row's. A take's row
 * is measured from its name's line to its wave, the light round them left
 * out. `rows` picks the rows in the list.
 */
export function roomBetween(list: Locator, rows = ":scope > [role=listitem]") {
  return list.evaluate((el, rows) => {
    const edges = [...el.querySelectorAll(rows)].map((row) => {
      const box = row.querySelector("[data-testid=wave]")?.closest("[data-take] > div") ?? row
      const r = box.getBoundingClientRect()
      const s = getComputedStyle(box)
      return [r.top + parseFloat(s.paddingTop), r.bottom - parseFloat(s.paddingBottom)]
    })
    return edges.slice(1).map(([top], i) => Math.round(top - edges[i][1]))
  }, rows)
}

/** The lines drawn over a list's rows: each row's top border, and its first child's. */
export function linesOf(list: Locator, rows = ":scope > [role=listitem]") {
  return list.evaluate(
    (el, rows) =>
      [...el.querySelectorAll(rows)].flatMap((row) => [row, row.firstElementChild].filter((e): e is Element => !!e).map((e) => getComputedStyle(e).borderTopWidth)),
    rows
  )
}
