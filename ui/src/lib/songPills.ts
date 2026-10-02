import type { SongChoice } from "@/lib/api"

/**
 * Whether pills of `widths`, in order with `gap` between them and then one
 * more `last` wide (All songs…), wrap into at most two rows `row` wide. A
 * pill wider than the row takes a row of its own, cut short to it.
 */
export function fitsInTwoRows(widths: number[], last: number, row: number, gap: number): boolean {
  let rows = 1
  let x = 0
  for (const w of [...widths, last]) {
    const width = Math.min(w, row)
    if (x === 0) x = width
    else if (x + gap + width <= row) x += gap + width
    else {
      rows += 1
      x = width
    }
    if (rows > 2) return false
  }
  return true
}

/**
 * The songs the two rows under a take's name show, in the order shown: this
 * rehearsal's first, then the others, as many as fit with All songs… after
 * them. When this rehearsal's alone do not fit, the ones whose latest take
 * is latest stay, still in the order they were first played.
 */
export function pillsShown(
  here: SongChoice[],
  other: SongChoice[],
  width: (c: SongChoice) => number,
  last: number,
  row: number,
  gap: number
): SongChoice[] {
  const fits = (cs: SongChoice[]) => fitsInTwoRows(cs.map(width), last, row, gap)
  if (fits(here)) {
    const shown = [...here]
    for (const c of other) {
      if (!fits([...shown, c])) break
      shown.push(c)
    }
    return shown
  }
  const latestFirst = [...here].sort((a, b) => (b.last_take ?? 0) - (a.last_take ?? 0))
  const kept = new Set<SongChoice>()
  for (const c of latestFirst) {
    if (!fits(here.filter((h) => kept.has(h) || h === c))) break
    kept.add(c)
  }
  return here.filter((h) => kept.has(h))
}
