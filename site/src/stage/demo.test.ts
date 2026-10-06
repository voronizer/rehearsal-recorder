import { describe, expect, it } from "vitest"
import { clipSchedule } from "./demo"

/** How many clips the app counts from these polls: it counts a rise. */
function counted(times: number[], polls: number[]): number {
  const clipping = clipSchedule(times)
  let clips = 0
  let was = false
  for (const t of polls) {
    const now = clipping(t)
    if (now && !was) clips++
    was = now
  }
  return clips
}

describe("clipSchedule", () => {
  it("gives each clip to one poll, so polls every 70 ms count three", () => {
    const polls = Array.from({ length: 60 }, (_, i) => i * 0.07)
    expect(counted([1.2, 2.2, 3.4], polls)).toBe(3)
  })

  it("still counts three when the polls come late and far apart", () => {
    expect(counted([1.2, 2.2, 3.4], [0.5, 1.9, 3.6, 3.7, 3.8, 4.5])).toBe(3)
  })

  it("counts nothing before the first clip is due", () => {
    expect(counted([1.2, 2.2, 3.4], [0.1, 0.5, 1.1])).toBe(0)
  })
})
