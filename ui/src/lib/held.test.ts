import { describe, expect, it } from "vitest"
import { held } from "@/lib/held"

// A dialog closing runs its animation with nothing asked any more: the
// state that held its title and text is already cleared. held() is what it
// shows meanwhile.
describe("held", () => {
  it("keeps the last text while nothing is asked", () => {
    expect(held("Delete “A”?", null)).toBe("Delete “A”?")
    expect(held("Delete “A”?", undefined)).toBe("Delete “A”?")
  })

  it("takes what is asked now", () => {
    expect(held("x", "y")).toBe("y")
  })

  it("takes an empty text as a text", () => {
    // Only null and undefined mean nothing is asked.
    expect(held("x", "")).toBe("")
  })
})
