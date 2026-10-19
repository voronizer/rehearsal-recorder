import { describe, expect, it } from "vitest"
import {
  chipsShown,
  driftTag,
  signed,
  spokenDrift,
  stretches,
  tagText,
  yOf,
  type DriftBar,
  type TakeDrift,
} from "@/lib/drift"

/** Bars of the tempos given, two seconds each, numbered from 1. */
const barsOf = (tempos: (number | null)[]): DriftBar[] =>
  tempos.map((tempo, i) => ({ n: i + 1, start: 2 * i, end: 2 * i + 2, tempo }))

const at = (n: number, tempo: number) => Array.from({ length: n }, () => tempo)

describe("stretches", () => {
  it("one bar off is no stretch; two are", () => {
    expect(stretches(barsOf([128, 128, 133, 128, 128]), 128, 0.02)).toEqual([])
    expect(stretches(barsOf([128, 133, 133, 128]), 128, 0.02)).toEqual([
      { first: 1, last: 2, sign: 1, chip: 5, peak: 1 },
    ])
  })

  it("is off the same way: ahead then behind is two stretches", () => {
    const found = stretches(barsOf([133, 133, 123, 123]), 128, 0.02)
    expect(found.map((s) => [s.first, s.last, s.sign])).toEqual([
      [0, 1, 1],
      [2, 3, -1],
    ])
  })

  it("joins across two bars, not three", () => {
    const two = stretches(barsOf([133, 133, 128, 128, 133, 133]), 128, 0.02)
    expect(two.map((s) => [s.first, s.last])).toEqual([[0, 5]])
    const three = stretches(barsOf([133, 133, 128, 128, 128, 133, 133]), 128, 0.02)
    expect(three.map((s) => [s.first, s.last])).toEqual([
      [0, 1],
      [5, 6],
    ])
  })

  it("leaves a bar with no tempo off neither way", () => {
    expect(stretches(barsOf([133, null, 133, 128]), 128, 0.02)).toEqual([])
  })

  it("says the largest difference after a three-bar median, so one rough bar does not make +8 of +7", () => {
    const [s] = stretches(barsOf([128, 135, 135, 136, 135, 135, 128]), 128, 0.02)
    expect(s.chip).toBe(7)
    expect(signed(stretches(barsOf([128, 123, 122, 123, 128]), 128, 0.02)[0].chip)).toBe("−5")
  })

  it("turns fewer bars amber at a wider tolerance", () => {
    const bars = barsOf([...at(4, 128), ...at(4, 131), ...at(4, 128), ...at(4, 136), ...at(4, 128)])
    expect(stretches(bars, 128, 0.02)).toHaveLength(2)
    expect(stretches(bars, 128, 0.03)).toHaveLength(1)
    expect(stretches(bars, 128, 0.05)).toHaveLength(1)
    expect(stretches(bars, 128, 0.01)).toHaveLength(2)
  })
})

describe("chipsShown", () => {
  it("hides the smaller of two chips that would overlap, and keeps both apart", () => {
    const found = stretches(barsOf([128, 133, 133, 128, 128, 128, 136, 136, 128]), 128, 0.02)
    const near = chipsShown(found, (s) => s.peak * 5, 32)
    expect([...near].map((s) => s.chip)).toEqual([8])
    const far = chipsShown(found, (s) => s.peak * 50, 32)
    expect(far.size).toBe(2)
  })
})

const counted = (aim: Partial<Extract<TakeDrift, { ok: true }>["aim"]>, source: "drums" | "mix" = "drums") =>
  ({
    ok: true,
    source,
    per_bar: 4,
    middle: 126.4,
    aim: { tempo: 128, signature: "4/4", from: "click", song: null, ...aim },
    bars: [],
  }) as Extract<TakeDrift, { ok: true }>

describe("the tag", () => {
  it("says what each take is measured against", () => {
    expect(tagText(driftTag(counted({ from: "click" })))).toBe("Click 128 bpm · 4/4")
    expect(tagText(driftTag(counted({ from: "take" })))).toBe("No click · 128 bpm · 4/4")
    expect(tagText(driftTag(counted({ from: "song", song: "Pałyn" })))).toBe("Pałyn 128 bpm")
    expect(tagText(driftTag(counted({ from: "middle", tempo: 126 })))).toBe("No tempo · middle 126 bpm")
  })

  it("counts eighths in 6/8, and says when it listened to the mix", () => {
    expect(tagText(driftTag(counted({ from: "click", tempo: 198, signature: "6/8" })))).toBe("Click 198 ♪ · 6/8")
    expect(tagText(driftTag(counted({ from: "song", song: "Ahoń", tempo: 198, signature: "6/8" })))).toBe("Ahoń 198 ♪")
    expect(tagText(driftTag(counted({ from: "middle", tempo: 126 }, "mix")))).toBe(
      "No tempo · middle 126 bpm · from the mix"
    )
  })
})

describe("for a screen reader", () => {
  it("says the stretches in words, or that the tempo held", () => {
    const bars = barsOf([...at(45, 128), ...at(23, 135), 128, ...at(6, 123)])
    const found = stretches(bars, 128, 0.02)
    expect(spokenDrift(bars, found, "4/4")).toBe("Tempo: ahead 7 bpm, bars 46 to 68; behind 5 bpm, bars 70 to 75.")
    expect(spokenDrift(bars, [], "4/4")).toBe("Tempo: steady.")
    expect(spokenDrift(bars, found, "6/8")).toContain("ahead 7 eighths a minute")
  })
})

describe("yOf", () => {
  it("puts the aim in the middle and 8% at the edges, further off at the edge", () => {
    expect(yOf(128, 128)).toBe(50)
    expect(yOf(128 * 1.04, 128)).toBeCloseTo(25)
    expect(yOf(128 * 0.96, 128)).toBeCloseTo(75)
    expect(yOf(200, 128)).toBe(4)
    expect(yOf(60, 128)).toBe(96)
  })
})
