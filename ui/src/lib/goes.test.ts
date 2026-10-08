import { describe, expect, it } from "vitest"
import { goFor, songFor, songNamed } from "./goes"

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

// Pałyn, which Palyn and Polyn were merged into: typed, they are Pałyn.
const merged = {
  here: [],
  other: [
    { song: "Pałyn", go: 12, also: ["Palyn", "Polyn"] },
    { song: "Viasna", go: 3, also: [] },
  ],
}

describe("songNamed", () => {
  it("finds a song by its whole title, saying it came by no old name", () => {
    expect(songNamed("pałyn", merged)).toEqual({ choice: merged.other[0], old: null })
  })
  it("finds a song by an old name, spelled as Python spelt it", () => {
    expect(songNamed("palyn", merged)).toEqual({ choice: merged.other[0], old: "Palyn" })
    expect(songNamed(" POLYN ", merged)).toEqual({ choice: merged.other[0], old: "Polyn" })
  })
  it("takes the text whole: a number after it is part of it", () => {
    expect(songNamed("Palyn 3", merged)).toBeNull()
  })
  it("prefers a title to an old name, should both ever be sent", () => {
    const both = { here: [{ song: "Palyn", go: 2 }], other: merged.other }
    expect(songNamed("Palyn", both)).toEqual({ choice: both.here[0], old: null })
  })
  it("is nothing for no choices, nothing typed, or a title no song has", () => {
    expect(songNamed("Palyn", null)).toBeNull()
    expect(songNamed("  ", merged)).toBeNull()
    expect(songNamed("Opus", merged)).toBeNull()
  })
})

describe("songFor", () => {
  it("reads a number typed after an old name as the song too", () => {
    expect(songFor("Palyn 3", merged)).toEqual({ choice: merged.other[0], old: "Palyn" })
  })
  it("is nothing for a take nobody named", () => {
    expect(songFor("Take 4", merged)).toBeNull()
  })
})

describe("goFor, through old names", () => {
  it("is the go of the song an old name leads to, with a number or not", () => {
    expect(goFor("polyn", merged)).toBe(12)
    expect(goFor("Polyn 2", merged)).toBe(12)
  })
  it("is still 1 for a title nobody has had", () => {
    expect(goFor("Opus", merged)).toBe(1)
  })
})
