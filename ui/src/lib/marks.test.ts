import { describe, expect, it } from "vitest"
import type { Label, MarkHit } from "@/lib/api"
import { groupMarks, headLine, labelLine, markKey, playFrom, rowLine } from "@/lib/marks"

const NOW = new Date("2026-10-08T12:00:00")

function hit(take_number: number, name: string, song: string | null, at: number, extra: Partial<MarkHit> = {}): MarkHit {
  return {
    folder: "/rec/tue",
    rehearsal: "Tuesday jam",
    created_at: "2026-09-22T19:00:00",
    missing: false,
    take_number,
    name,
    song,
    duration_sec: 200,
    at,
    note: "",
    ...extra,
  }
}

const NEW_SONGS = { folder: "/rec/new", rehearsal: "New songs", created_at: "2026-09-19T19:00:00" }

// As list_marks gives them: the newest rehearsal first, then the take, then the moment.
const MARKS = [
  hit(4, "Pałyn 4", "Pałyn", 111, { note: "came in late" }),
  hit(5, "Pałyn 5", "Pałyn", 58),
  hit(11, "Take 11", null, 42),
  hit(3, "Viasna 3", "Viasna", 100, NEW_SONGS),
]

const label = (extra: Partial<Label>): Label => ({ id: 3, name: "Went wrong", colour: "red", marks: 0, ...extra })

describe("groupMarks", () => {
  it("by rehearsal: a group per rehearsal, newest first, with its day and count", () => {
    const groups = groupMarks(MARKS, "rehearsal", NOW)
    expect(groups.map((g) => g.title)).toEqual([
      "Tuesday jam · Tue 22 Sep · 3 marks",
      "New songs · Sat 19 Sep · 1 mark",
    ])
    expect(groups.map((g) => g.folder)).toEqual(["/rec/tue", "/rec/new"])
    expect(groups[0].marks).toEqual(MARKS.slice(0, 3))
  })

  it("by song: songs in the order of their newest mark, the takes with no song last", () => {
    const groups = groupMarks(MARKS, "song", NOW)
    expect(groups.map((g) => g.title)).toEqual(["Pałyn · 2 marks", "Viasna · 1 mark", "Not named · 1 mark"])
    expect(groups.map((g) => g.song)).toEqual(["Pałyn", "Viasna", null])
  })

  it("one list: one group with no title and every mark", () => {
    const groups = groupMarks(MARKS, "list", NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe("")
    expect(groups[0].marks).toEqual(MARKS)
  })

  it("no marks, no groups", () => {
    expect(groupMarks([], "rehearsal", NOW)).toEqual([])
    expect(groupMarks([], "list", NOW)).toEqual([])
  })
})

describe("the lines", () => {
  it("under a label on the left: in how many rehearsals, and the last", () => {
    expect(labelLine(label({ marks: 5, rehearsals: 3, last_marked: "2026-09-22T19:00:00" }), NOW)).toBe(
      "3 rehearsals · last 22 Sep"
    )
    expect(labelLine(label({ marks: 1, rehearsals: 1, last_marked: "2026-09-22T19:00:00" }), NOW)).toBe(
      "1 rehearsal · last 22 Sep"
    )
    expect(labelLine(label({ marks: 0, rehearsals: 0, last_marked: null }), NOW)).toBe("no marks yet")
  })

  it("under the label's name on the right", () => {
    expect(headLine(MARKS, NOW)).toBe("4 marks in 2 rehearsals · last 22 Sep")
    expect(headLine(MARKS.slice(3), NOW)).toBe("1 mark in 1 rehearsal · last 19 Sep")
    expect(headLine([], NOW)).toBe("No marks yet")
  })

  it("a row's second line: the song a link, the rest after it", () => {
    expect(rowLine(MARKS[0], "rehearsal", NOW)).toEqual({ song: "Pałyn", rest: " 4 · 1:51" })
    expect(rowLine(MARKS[0], "song", NOW)).toEqual({ song: null, rest: "Pałyn 4 · 1:51 · Tuesday jam, 22 Sep" })
    expect(rowLine(MARKS[0], "list", NOW)).toEqual({ song: "Pałyn", rest: " 4 · 1:51 · Tuesday jam, 22 Sep" })
    expect(rowLine(MARKS[2], "rehearsal", NOW)).toEqual({ song: null, rest: "Take 11 · 0:42" })
    expect(rowLine(hit(1, "Pałyn", "Pałyn", 30), "rehearsal", NOW)).toEqual({ song: "Pałyn", rest: " · 0:30" })
  })
})

describe("playing a mark", () => {
  it("starts 5 s before it, and never before the take", () => {
    expect(playFrom(111)).toBe(106)
    expect(playFrom(3)).toBe(0)
  })

  it("is told apart by its rehearsal, take and moment", () => {
    expect(markKey(MARKS[0])).toBe("/rec/tue#4@111")
  })
})
