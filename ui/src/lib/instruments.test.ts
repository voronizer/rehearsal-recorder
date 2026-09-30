import { describe, expect, it } from "vitest"
import { INSTRUMENTS, instrument } from "./instruments"

describe("instrument", () => {
  it("gives each icon a key of its own, since the key is what the band keeps", () => {
    const keys = INSTRUMENTS.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("draws none, and one it does not know, as the neutral one", () => {
    for (const key of [undefined, null, "", "theremin"]) {
      expect(instrument(key).key).toBe("other")
    }
    expect(instrument("bass").label).toBe("Bass")
  })
})
