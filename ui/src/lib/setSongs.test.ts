import { describe, expect, it } from "vitest"
import type { SongChoices } from "@/lib/api"
import { otherSongs, rowsFor, shortList, songOf } from "@/lib/setSongs"

const CHOICES: SongChoices = {
  here: [{ song: "Dym", go: 3, also: [] }],
  other: [
    { song: "Pałyn", go: 1, also: ["Palyn"] },
    { song: "Viasna", go: 1 },
  ],
}

describe("songOf", () => {
  it("takes a title, a title with a go after it and an old name as the song", () => {
    expect(songOf("pałyn", CHOICES)).toBe("Pałyn")
    expect(songOf("Pałyn 4", CHOICES)).toBe("Pałyn")
    expect(songOf("Palyn", CHOICES)).toBe("Pałyn")
  })

  it("takes a set's song nobody has played yet only typed whole", () => {
    expect(songOf("kupalle", CHOICES, ["Kupalle"])).toBe("Kupalle")
    expect(songOf("Kupalle 2", CHOICES, ["Kupalle"])).toBeNull()
    expect(songOf("Take 3", CHOICES)).toBeNull()
  })
})

describe("otherSongs", () => {
  it("is tonight's songs then the rest, less the set's, case-blind", () => {
    expect(otherSongs(CHOICES, ["pałyn"])).toEqual(["Dym", "Viasna"])
    expect(otherSongs(null, [])).toEqual([])
  })
})

describe("rowsFor", () => {
  const titles = ["Dym", "Pałyn", "Viasna"]

  it("is every row while nothing narrows it, or a title is typed", () => {
    expect(rowsFor(titles, null, "Dym")).toEqual(titles)
    expect(rowsFor(titles, "Dym 4", "Dym")).toEqual(titles)
  })

  it("is an old name's song alone", () => {
    expect(rowsFor(titles, "Palyn", "Pałyn")).toEqual(["Pałyn"])
  })

  it("is the rows with the text in them otherwise", () => {
    expect(rowsFor(titles, "a", null)).toEqual(["Pałyn", "Viasna"])
    expect(rowsFor(titles, "zz", null)).toEqual([])
  })

  it("narrows by the text when an old name's song is not among them (it is the set's)", () => {
    expect(rowsFor(["Dym", "Viasna"], "Palyn", "Pałyn")).toEqual([])
  })
})

describe("shortList", () => {
  it("is the first five while tonight's songs fit in them", () => {
    const titles = ["A", "B", "C", "D", "E", "F", "G"]
    expect(
      shortList(
        titles,
        new Map([
          ["A", 3],
          ["B", 1],
        ])
      )
    ).toEqual(["A", "B", "C", "D", "E"])
  })

  it("keeps tonight's five played latest, in the order first played, when more were", () => {
    const titles = ["A", "B", "C", "D", "E", "F", "G", "X"]
    const last = new Map([
      ["A", 9],
      ["B", 2],
      ["C", 3],
      ["D", 4],
      ["E", 5],
      ["F", 6],
      ["G", 7],
    ])
    expect(shortList(titles, last)).toEqual(["A", "D", "E", "F", "G"])
  })
})
