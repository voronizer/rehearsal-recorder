import { describe, expect, it } from "vitest"
import { goFor } from "./goes"

const choices = {
  here: [{ song: "Polyn", go: 4, last_take: 3 }],
  other: [{ song: "Полынь", go: 2 }],
}

describe("goFor", () => {
  it("is the go offered for a song, whatever the case", () => {
    expect(goFor("polyn", choices)).toBe(4)
    expect(goFor("ПОЛЫНЬ", choices)).toBe(2)
  })
  it("reads a number typed after a title as that song", () => {
    expect(goFor("Polyn 7", choices)).toBe(4)
  })
  it("is 1 for a title no song has, a number in it or not", () => {
    expect(goFor("Vesna", choices)).toBe(1)
    expect(goFor("Opus 5", choices)).toBe(1)
  })
  it("is nothing while the choices have not arrived, rather than a guess", () => {
    expect(goFor("Polyn", null)).toBeNull()
    expect(goFor("Vesna", null)).toBeNull()
  })
  it("is nothing for a take nobody named", () => {
    expect(goFor("Take 4", choices)).toBeNull()
    expect(goFor("  ", choices)).toBeNull()
  })
})
