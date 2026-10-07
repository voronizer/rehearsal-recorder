import type { SongChoice } from "@/lib/api"

/**
 * Whether pills of `widths`, in order with `gap` between them and then one
 * more `last` wide (All songs…), wrap into at most `rows` rows `row` wide. A
 * pill wider than the row takes a row of its own, cut short to it.
 */
export function fitsInRows(
  widths: number[],
  last: number,
  row: number,
  gap: number,
  rows: number
): boolean {
  let used = 1
  let x = 0
  for (const w of [...widths, last]) {
    const width = Math.min(w, row)
    if (x === 0) x = width
    else if (x + gap + width <= row) x += gap + width
    else {
      used += 1
      x = width
    }
    if (used > rows) return false
  }
  return true
}

/**
 * The songs the rows under a take's name show (two unless told otherwise), in the order shown: this
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
  gap: number,
  rows = 2
): SongChoice[] {
  const fits = (cs: SongChoice[]) => fitsInRows(cs.map(width), last, row, gap, rows)
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
