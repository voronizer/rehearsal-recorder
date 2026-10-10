import { afterEach, describe, expect, it, vi } from "vitest"
import { motionOff } from "@/lib/motion"

/** A page as far as motionOff() looks at it: whether Reduce motion is on,
 *  and whether <html> says a take is being recorded. */
function page({ reduce = false, recording = false }) {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: reduce && q.includes("prefers-reduced-motion") }))
  vi.stubGlobal("document", {
    documentElement: { hasAttribute: (name: string) => recording && name === "data-recording" },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe("motionOff", () => {
  it("is off for nothing when the system allows motion and nothing is recording", () => {
    page({})
    expect(motionOff()).toBe(false)
  })

  it("is on under the system's Reduce motion", () => {
    page({ reduce: true })
    expect(motionOff()).toBe(true)
  })

  it("is on while the recording screen is up", () => {
    page({ recording: true })
    expect(motionOff()).toBe(true)
  })

  it("is off where there is no page to ask, as in the tests that need none", () => {
    expect(motionOff()).toBe(false)
  })
})
