import { describe, expect, it } from "vitest"
import { titleParts } from "./title"

describe("titleParts", () => {
  it("keeps a short hyphenated word whole, apart from the words round it", () => {
    expect(titleParts("Notes too, from an e-kit or a keyboard.")).toEqual([
      { text: "Notes too, from an ", whole: false },
      { text: "e-kit", whole: true },
      { text: " or a keyboard.", whole: false },
    ])
  })

  it("leaves a title with no hyphen as it is", () => {
    expect(titleParts("Every musician on their own track.")).toEqual([
      { text: "Every musician on their own track.", whole: false },
    ])
  })

  it("lets a long hyphenated word break after a hyphen, since a tile clips what does not fit", () => {
    const parts = titleParts("A state-of-the-art tile.")
    expect(parts.some((p) => p.whole)).toBe(false)
    expect(titleParts("A well-known tile.").filter((p) => p.whole)).toEqual([
      { text: "well-known", whole: true },
    ])
  })

  it("never changes the words", () => {
    for (const title of ["Notes too, from an e-kit or a keyboard.", "A state-of-the-art, well-known tile.", ""])
      expect(titleParts(title).map((p) => p.text).join("")).toBe(title)
  })
})
