import { describe, expect, it } from "vitest"
import type { SongChoices, Take } from "./api"
import { takeFacts } from "./takeFacts"

/** A take kept tonight, as session_state lists it. */
const kept = (n: number, song: string | null, go: number | null, sec: number, starred = false): Take => ({
  take_number: n,
  name: song ? `${song}${go && go > 1 ? ` ${go}` : ""}` : `Take ${go ?? n}`,
  song,
  go,
  starred,
  duration_sec: sec,
  tracks: [],
})

/** Tonight so far: Viasna 1 (18 s, starred), Dym 1, Viasna 2 (12 s). */
const tonight = [kept(1, "Viasna", 1, 18, true), kept(2, "Dym", 1, 30), kept(3, "Viasna", 2, 12)]
const choices: SongChoices = {
  here: [
    { song: "Viasna", go: 3 },
    { song: "Dym", go: 2 },
  ],
  other: [{ song: "Ahoń", go: 1 }],
}

const facts = (name: string, takes: Take[], known: SongChoices | null = choices) =>
  takeFacts({ name, takeNumber: 4, durationSec: 6, takes, choices: known })

describe("takeFacts", () => {
  it("names an unnamed take Take, with the number in its name and no columns", () => {
    // Its number is its own across the library, not its place tonight (4).
    const f = facts("Take 47", tonight)
    expect(f).toMatchObject({ song: null, go: 47, unnamed: true, shown: "Take" })
    expect(f.columns).toEqual([])
    expect(f.columnsText).toBe("")
    expect(f.columnsSaid).toBe("")
  })

  it("gives no song typed the go Python has for it, whatever the number", () => {
    const told = { ...choices, unnamed_go: 48 }
    expect(facts("Take", tonight, told)).toMatchObject({ song: null, go: 48, unnamed: true, shown: "Take" })
    expect(facts("Take #5", tonight, told)).toMatchObject({ song: null, go: 48, shown: "Take" })
  })

  it("gives a song's first take tonight its number and no columns", () => {
    const f = facts("Ahoń", tonight)
    expect(f).toMatchObject({ song: "Ahoń", go: 1, unnamed: false, shown: "Ahoń" })
    expect(f.columns).toEqual([])
  })

  it("draws the song's takes tonight as columns, this one last and lit", () => {
    const f = facts("Viasna", tonight)
    expect(f).toMatchObject({ song: "Viasna", go: 3, shown: "Viasna" })
    expect(f.columns).toEqual([
      { key: 1, sec: 18, starred: true, lit: false, label: 1 },
      { key: 3, sec: 12, starred: false, lit: false, label: 2 },
      { key: 4, sec: 6, starred: false, lit: true, label: 3 },
    ])
    expect(f.columnsText).toBe("Viasna #1: 0:18, Viasna #2: 0:12, Viasna #3: 0:06")
    // A screen reader has each by its plain name, as the aria-labels have it.
    expect(f.columnsSaid).toBe("Viasna 1: 0:18, Viasna 2: 0:12, Viasna 3: 0:06")
  })

  it("keeps the last ten of thirty takes, this one the tenth", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => kept(i + 1, "Viasna", i + 1, 10 + i))
    const f = takeFacts({
      name: "Viasna",
      takeNumber: 31,
      durationSec: 6,
      takes: thirty,
      choices: { here: [{ song: "Viasna", go: 31 }], other: [] },
    })
    expect(f.columns).toHaveLength(10)
    expect(f.columns.map((c) => c.label)).toEqual([22, 23, 24, 25, 26, 27, 28, 29, 30, 31])
    expect(f.columns.at(-1)).toMatchObject({ key: 31, lit: true })
  })

  it("leaves a number not known yet as ? in words, rather than guess it", () => {
    // The songs are not in yet: the title is the name as typed, with no number.
    const f = facts("Viasna", tonight, null)
    expect(f).toMatchObject({ song: "Viasna", go: null })
    expect(f.columns.at(-1)).toMatchObject({ lit: true, label: null })
    expect(f.columnsText).toBe("Viasna #1: 0:18, Viasna #2: 0:12, Viasna #?: 0:06")
    expect(f.columnsSaid).toBe("Viasna 1: 0:18, Viasna 2: 0:12, Viasna ?: 0:06")
  })
})
