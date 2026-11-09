import { describe, expect, test } from "vitest"
import { lengthOf, parseLength, setLine, setTime, songsOf } from "./length"

describe("parseLength", () => {
  test("minutes and seconds are kept as seconds", () => {
    expect(parseLength("4:05")).toBe(245)
    expect(parseLength("12:30")).toBe(750)
    expect(parseLength(" 0:45 ")).toBe(45)
    expect(parseLength("60:00")).toBe(3600)
  })

  test("a full stop does for the colon, as a phone's keypad has one", () => {
    expect(parseLength("4.05")).toBe(245)
  })

  test("an empty field goes back to the best take's length", () => {
    expect(parseLength("")).toBeNull()
    expect(parseLength("   ")).toBeNull()
  })

  test("anything else is turned down", () => {
    for (const t of ["4:5", "4:65", "abc", "-1:00", "61:00", "0:00", "245", "4:05:00", "1:2:3"]) expect(parseLength(t), t).toBe("bad")
  })
})

const song = (length: number | null, typed_length: number | null) => ({ title: "Viasna", length, typed_length })

describe("lengthOf", () => {
  test("a typed length is the song's, else its best take's", () => {
    expect(lengthOf(song(201.4, 245))).toBe(245)
    expect(lengthOf(song(201.4, null))).toBe(201.4)
    expect(lengthOf(song(null, null))).toBeNull()
  })
})

describe("setTime", () => {
  test("adds up the lengths and names the songs that have none", () => {
    const songs = [song(200, null), { ...song(null, null), title: "Kryły" }, song(10, 45)]
    expect(setTime(songs)).toEqual({ sec: 245, none: ["Kryły"] })
  })
})

describe("setLine", () => {
  const songs = [song(1500, null), { ...song(null, null), title: "Kryły" }, song(10, 375)]
  test("counts the songs and their time, and says which have no length", () => {
    expect(setLine(songs)).toBe("3 songs · 31:15 · no length: Kryły")
  })
  test("short, for the list and the sheet, it leaves the songs with no length out", () => {
    expect(setLine(songs, true)).toBe("3 songs · 31:15")
  })
  test("a set with no songs has no time", () => {
    expect(setLine([])).toBe("0 songs")
  })
})

describe("songsOf", () => {
  test("a set's songs in its order, those the list lacks left out", () => {
    const all = [{ id: 1 }, { id: 2 }, { id: 3 }]
    expect(songsOf([3, 9, 1], all)).toEqual([{ id: 3 }, { id: 1 }])
  })
})
