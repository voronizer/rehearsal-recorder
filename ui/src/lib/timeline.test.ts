import { describe, expect, it } from "vitest"
import { MIN_VIEW_SEC, tickTimes } from "@/lib/timeline"

describe("tickTimes: a clock on the ruler somebody can read", () => {
  it("puts a six-minute take on round steps", () => {
    const ticks = tickTimes(0, 360, 900)
    expect(ticks[0]).toBe(0)
    const step = ticks[1] - ticks[0]
    expect([1, 2, 5, 10, 15, 30, 60, 120, 300]).toContain(step)
    expect((step / 360) * 900).toBeGreaterThanOrEqual(80)
  })
  it("still has ticks at the closest zoom", () => {
    expect(tickTimes(100, 100 + MIN_VIEW_SEC, 900).length).toBeGreaterThan(0)
  })
  it("keeps them on round numbers however far along the window is", () => {
    const ticks = tickTimes(123.4, 135.4, 900)
    const step = ticks[1] - ticks[0]
    for (const t of ticks) expect(t % step).toBe(0)
  })
  it("never puts one at the very end, where its label would be cut in half", () => {
    const ticks = tickTimes(0, 60, 900)
    expect(ticks[ticks.length - 1]).toBeLessThan(60)
  })
})
