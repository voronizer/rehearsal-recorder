import { describe, expect, it } from "vitest"
import { anchorOf } from "@/hooks/useMultitrackPlayer"

describe("the cursor between the player's answers", () => {
  it("runs on from where the last answer put it", () => {
    expect(anchorOf(12, undefined, 500)).toEqual({ position: 12, at: 500 })
    expect(anchorOf(12, false, 500)).toEqual({ position: 12, at: 500 })
  })

  it("stays put while the sound is asked for and not heard yet", () => {
    expect(anchorOf(12, true, 500)).toBeNull()
  })
})
