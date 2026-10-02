import { describe, expect, it } from "vitest"
import { fitsInTwoRows, pillsShown } from "@/lib/songPills"
import type { SongChoice } from "@/lib/api"

const song = (name: string, last_take?: number): SongChoice => ({ song: name, go: 1, last_take })
const by = (widths: Record<string, number>) => (c: SongChoice) => widths[c.song]

describe("fitsInTwoRows: pills wrap as flex-wrap lays them out", () => {
  it("fits what wraps once", () => {
    // Row of 100, gap 10: [40 40] [40 + last 30].
    expect(fitsInTwoRows([40, 40, 40], 30, 100, 10)).toBe(true)
  })
  it("refuses what needs a third row for All songs…", () => {
    expect(fitsInTwoRows([40, 40, 40, 40], 30, 100, 10)).toBe(false)
  })
  it("counts a pill wider than the row as one, cut to the row", () => {
    expect(fitsInTwoRows([500], 30, 100, 10)).toBe(true)
    expect(fitsInTwoRows([500, 500], 30, 100, 10)).toBe(false)
  })
})

describe("pillsShown: this rehearsal's first, then the rest, as many as fit", () => {
  it("adds the other songs, in their order, until the next would not fit", () => {
    const here = [song("Polyn 3", 2), song("Vesna 2", 3)]
    const other = [song("Ogon"), song("Sonce"), song("Dym")]
    const w = by({ "Polyn 3": 40, "Vesna 2": 40, Ogon: 40, Sonce: 40, Dym: 40 })
    expect(pillsShown(here, other, w, 30, 100, 10).map((c) => c.song)).toEqual([
      "Polyn 3",
      "Vesna 2",
      "Ogon",
    ])
  })
  it("keeps the songs played latest when this rehearsal's alone do not fit, in the order first played", () => {
    const here = [song("A", 9), song("B", 2), song("C", 7), song("D", 5)]
    const w = by({ A: 40, B: 40, C: 40, D: 40 })
    expect(pillsShown(here, [song("E")], w, 30, 100, 10).map((c) => c.song)).toEqual([
      "A",
      "C",
      "D",
    ])
  })
  it("shows nothing when there is nothing", () => {
    expect(pillsShown([], [], () => 0, 30, 100, 10)).toEqual([])
  })
})
