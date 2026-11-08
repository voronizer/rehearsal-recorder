import { describe, expect, it } from "vitest"
import { goMark, takeText } from "./takeText"

describe("goMark", () => {
  it("puts a # before the go", () => {
    expect(goMark(12)).toBe("#12")
    expect(goMark(1)).toBe("#1")
  })
})

describe("takeText", () => {
  it("is the song, a no-break space and the go after a #", () => {
    expect(takeText({ name: "Viasna 12", song: "Viasna", go: 12 })).toBe("Viasna #12")
  })
  it("keeps a title's own number apart from the go", () => {
    expect(takeText({ name: "Opus 5 3", song: "Opus 5", go: 3 })).toBe("Opus 5 #3")
  })
  it("is the name as it is for a take with no song", () => {
    expect(takeText({ name: "Take 4", song: null, go: null })).toBe("Take 4")
    expect(takeText({ name: "Take 4" })).toBe("Take 4")
  })
  it("is the name as it is when the go is not known", () => {
    expect(takeText({ name: "Viasna", song: "Viasna", go: null })).toBe("Viasna")
  })
})
