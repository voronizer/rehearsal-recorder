import { describe, expect, it } from "vitest"
import type { BackingState, MetronomeState, SongBacking } from "@/lib/api"
import {
  barLines,
  beatShift,
  drawnRange,
  pageLine,
  parseBarOne,
  rowLine,
  rowSentence,
  stepBarOne,
  takeSentence,
} from "@/lib/backing"

/** Palyn's backing track as the library has it: counted 128, bar 1 at 0.80,
 *  stereo, 3:42. */
const PALYN: SongBacking = {
  name: "Palyn backing.wav",
  seconds: 222,
  channels: 2,
  tempo: 128,
  first_bar: 0.8,
  missing: false,
}

/** The row's state between takes, the next take being Palyn with its
 *  backing track: a case changes the fields it is about. */
function backing(over: Partial<BackingState> = {}): BackingState {
  return {
    song: { ...PALYN, song_id: 1, title: "Palyn" },
    on: true,
    volume: 0.8,
    row: true,
    playing: false,
    position_sec: 0,
    output_missing: null,
    getting_ready: false,
    free: false,
    ...over,
  }
}

/** The metronome's state around it: Palyn at its own 128 in 4/4. */
function state(over: Partial<MetronomeState> = {}, row: Partial<BackingState> = {}): MetronomeState {
  return {
    phase: "idle",
    tempo: 128,
    signature: "4/4",
    per_bar: 4,
    on: true,
    case: "song",
    song: { id: 1, title: "Palyn", tempo: 128, signature: "4/4" },
    held: false,
    last_take: null,
    upcoming: [],
    count: 0,
    since_count_in_ms: null,
    output_missing: null,
    backing: backing(row),
    ...over,
  }
}

/** A page line's words, its links read as the words they show. */
const words = (line: ReturnType<typeof pageLine>) =>
  line.parts.map((p) => (typeof p === "string" ? p : p.label)).join("")
const links = (line: ReturnType<typeof pageLine>) =>
  line.parts.flatMap((p) => (typeof p === "string" ? [] : [p.action]))

describe("rowSentence", () => {
  it("a click take: the backing track comes in after the count-in", () => {
    expect(rowSentence(state())).toEqual({
      text: "The backing track comes in on bar 1, after the count-in.",
      amber: false,
    })
  })

  it("no click, the metronome off or no tempo: it starts with Record", () => {
    const said = { text: "The backing track starts with Record: no click, so no count-in.", amber: false }
    expect(rowSentence(state({ on: false }))).toEqual(said)
    expect(rowSentence(state({ tempo: null, case: "song_without" }))).toEqual(said)
  })

  it("switched off", () => {
    expect(rowSentence(state({}, { on: false }))).toEqual({
      text: "Backing track off: takes record without it.",
      amber: false,
    })
  })

  it("a tempo held in the row that the file does not have", () => {
    expect(rowSentence(state({ tempo: 132, held: true }))).toEqual({
      text: "The backing track was counted at 128: it will not follow 132.",
      amber: false,
    })
  })

  it("a song whose tempo is not the file's says so too", () => {
    expect(rowSentence(state({}, { song: { ...PALYN, tempo: 126, song_id: 1, title: "Palyn" } }))?.text).toBe(
      "The backing track was counted at 126: it will not follow 128."
    )
  })

  it("a file with no steady beat follows nothing, so nothing is said of it", () => {
    expect(rowSentence(state({}, { song: { ...PALYN, tempo: null, song_id: 1, title: "Palyn" } }))?.text).toBe(
      "The backing track comes in on bar 1, after the count-in."
    )
  })

  it("its output missing, in amber, with its outputs", () => {
    expect(rowSentence(state({}, { output_missing: "X18 5–6" }))).toEqual({
      text: "The backing track's output, X18 5–6, is not connected. Takes record without it.",
      amber: true,
    })
    expect(rowSentence(state({}, { output_missing: "" }))?.text).toBe(
      "The backing track's output is not connected. Takes record without it."
    )
  })

  it("while the file is got ready", () => {
    expect(rowSentence(state({}, { getting_ready: true }))).toEqual({
      text: "Getting the backing track ready…",
      amber: false,
    })
  })

  it("the copy deleted by hand, in amber", () => {
    expect(
      rowSentence(state({}, { song: { ...PALYN, missing: true, seconds: null, channels: null, song_id: 1, title: "Palyn" } }))
    ).toEqual({ text: "Palyn backing.wav is missing from the Backing tracks folder.", amber: true })
  })

  it("nothing while there is no row, a song without one, or a free take", () => {
    expect(rowSentence(state({}, { row: false }))).toBeNull()
    expect(rowSentence(state({}, { song: null }))).toBeNull()
    expect(rowSentence(state({ case: "free", song: null }, { song: null, free: true }))).toBeNull()
  })
})

describe("takeSentence", () => {
  const taking = { phase: "take" as const, since_count_in_ms: 4000 }

  it("its output gone mid-take, in amber, by its name", () => {
    expect(takeSentence(state(taking, { playing: true, output_missing: "X18 5–6" }))).toEqual({
      text: "The backing track's output, X18 5–6, is not connected.",
      amber: true,
    })
    expect(takeSentence(state(taking, { playing: true, output_missing: "" }))?.text).toBe(
      "The backing track's output is not connected."
    )
  })

  it("nothing while it plays where it should, or the take has none", () => {
    expect(takeSentence(state(taking, { playing: true }))).toBeNull()
    expect(takeSentence(state(taking, { playing: false, output_missing: "X18 5–6" }))).toBeNull()
  })
})

describe("rowLine", () => {
  it("a song without one says where it is added", () => {
    const dym = state({ song: { id: 5, title: "Dym", tempo: null, signature: null } }, { song: null })
    expect(rowLine(dym, "Dym")).toBe("No backing track for Dym. It is added on the song's page in History.")
  })

  it("a title no song has yet is named as typed", () => {
    expect(rowLine(state({ song: null }, { song: null }), "Kupala")).toBe(
      "No backing track for Kupala. It is added on the song's page in History."
    )
  })

  it("a free take", () => {
    expect(rowLine(state({ case: "free", song: null }, { song: null, free: true }), "")).toBe(
      "Free take: no backing track."
    )
  })

  it("nothing for a song with one: the row shows its file", () => {
    expect(rowLine(state(), "Palyn")).toBeNull()
  })
})

describe("pageLine", () => {
  const song = { tempo: 128, signature: "4/4" as const }

  it("no backing track: what it takes", () => {
    const line = pageLine(song, null, null)
    expect(words(line)).toBe(
      "One audio file, mono or stereo. Its tempo is counted when it is added; with no steady beat in it, bar 1 is set by ear."
    )
    expect(links(line)).toEqual([])
  })

  it("while it is counted", () => {
    expect(words(pageLine(song, null, "Palyn backing.wav"))).toBe("Counting the tempo of Palyn backing.wav…")
    expect(words(pageLine(song, PALYN, "Viasna backing.wav"))).toBe("Counting the tempo of Viasna backing.wav…")
  })

  it("counted as the song: a beat earlier or later", () => {
    const line = pageLine(song, PALYN, null)
    expect(words(line)).toBe(
      "Counted 128 bpm, as the song; bar 1 on the first strong beat. A beat off (a pickup)? One beat earlier or later."
    )
    expect(links(line)).toEqual(["earlier", "later"])
  })

  it("counted and taken for a song with no tempo: halve or double, and the beat", () => {
    const line = pageLine({ tempo: 104, signature: "4/4" }, { ...PALYN, tempo: 104 }, null, true)
    expect(words(line)).toBe(
      "Counted 104 bpm, now the song's tempo; bar 1 on the first strong beat. Twice too fast or too slow: halve or double. A beat off (a pickup)? One beat earlier or later."
    )
    expect(links(line)).toEqual(["halve", "double", "earlier", "later"])
  })

  it("counted in 6/8, in eighths", () => {
    expect(words(pageLine({ tempo: 198, signature: "6/8" }, { ...PALYN, tempo: 198 }, null))).toMatch(
      /^Counted 198 ♪, as the song;/
    )
  })

  it("counted another tempo than the song's: take it", () => {
    const line = pageLine(song, { ...PALYN, tempo: 126 }, null)
    expect(words(line)).toBe(
      "Counted 126 bpm; the song stays at 128 until you take the backing track's tempo. Bar 1 on its first strong beat."
    )
    expect(links(line)).toEqual(["take"])
  })

  it("counted, and the song's tempo taken away since: take it", () => {
    const line = pageLine({ tempo: null, signature: null }, PALYN, null)
    expect(words(line)).toBe(
      "Counted 128 bpm; the song has no tempo until you take the backing track's tempo. Bar 1 on its first strong beat."
    )
    expect(links(line)).toEqual(["take"])
  })

  it("no steady beat: the click keeps the song's", () => {
    const line = pageLine({ tempo: 96, signature: "3/4" }, { ...PALYN, tempo: null, first_bar: 0 }, null)
    expect(words(line)).toBe(
      "No steady beat in it (pads): the click keeps the song's 96. Drag bar 1 to where the band comes in, and check it with ▶."
    )
    expect(links(line)).toEqual([])
  })

  it("no steady beat and no tempo: it plays from Record", () => {
    expect(words(pageLine({ tempo: null, signature: null }, { ...PALYN, tempo: null }, null))).toBe(
      "No steady beat in it, and the song has no tempo: type or tap one above, or leave it, and the backing track plays from Record with no click."
    )
  })

  it("the copy deleted by hand", () => {
    const line = pageLine(song, { ...PALYN, missing: true, seconds: null, channels: null }, null)
    expect(words(line)).toBe("Palyn backing.wav is missing from the Backing tracks folder.")
    expect(links(line)).toEqual([])
  })
})

describe("parseBarOne", () => {
  it("reads minutes and seconds, or seconds, to a hundredth", () => {
    expect(parseBarOne("0:00.80")).toBe(0.8)
    expect(parseBarOne("1:02.5")).toBe(62.5)
    expect(parseBarOne("0.8")).toBe(0.8)
    expect(parseBarOne(" 12.345 ")).toBe(12.35)
    expect(parseBarOne("3")).toBe(3)
  })

  it("refuses what is not a time", () => {
    expect(parseBarOne("")).toBeNull()
    expect(parseBarOne("abc")).toBeNull()
    expect(parseBarOne("-1")).toBeNull()
    expect(parseBarOne("0:75")).toBeNull()
  })
})

describe("stepBarOne", () => {
  it("moves a hundredth, or a tenth", () => {
    expect(stepBarOne(0.8, 0.01, 222)).toBe(0.81)
    expect(stepBarOne(0.8, -0.01, 222)).toBe(0.79)
    expect(stepBarOne(0.8, 0.1, 222)).toBe(0.9)
    expect(stepBarOne(0.07, 0.01, 222)).toBe(0.08)
  })

  it("never before the file's start nor past its end", () => {
    expect(stepBarOne(0.05, -0.1, 222)).toBe(0)
    expect(stepBarOne(3.0, 0.1, 3.04)).toBe(3.04)
    expect(stepBarOne(3.0, 0.1, 3.047)).toBe(3.04)
  })

  it("with no length known, only the start holds it", () => {
    expect(stepBarOne(500, 0.1, null)).toBe(500.1)
  })
})

describe("beatShift", () => {
  it("one beat at 128 in 4/4 is 0.47 s", () => {
    expect(beatShift(0.8, 128, "4/4", 1)).toBe(1.27)
    expect(beatShift(0.8, 128, "4/4", -1)).toBe(0.33)
  })

  it("in 6/8 a beat is a click, an eighth", () => {
    expect(beatShift(1, 198, "6/8", 1)).toBe(1.3)
  })

  it("never before the file's start", () => {
    expect(beatShift(0.2, 128, "4/4", -1)).toBe(0)
  })
})

describe("drawnRange", () => {
  it("four bars past bar 1", () => {
    expect(drawnRange(0.8, 128, "4/4").end).toBeCloseTo(8.3, 6)
    expect(drawnRange(0.5, 72, "4/4").end).toBeCloseTo(0.5 + 16 * (60 / 72), 6)
    expect(drawnRange(1, 198, "6/8").end).toBeCloseTo(1 + 24 * (60 / 198), 6)
  })

  it("and 8 seconds at least", () => {
    expect(drawnRange(0, 200, "4/4").end).toBe(8)
    expect(drawnRange(0, null, null).end).toBe(8)
  })

  it("with no tempo, still past a late bar 1", () => {
    expect(drawnRange(30, null, null).end).toBe(34)
  })
})

describe("barLines", () => {
  it("from bar 1, the bars numbered from 1 and the beats between", () => {
    const lines = barLines(0.8, 128, "4/4", 3)
    expect(lines.map((l) => l.bar)).toEqual([1, null, null, null, 2])
    expect(lines[1].at).toBeCloseTo(0.8 + 60 / 128, 9)
    expect(lines[4].at).toBeCloseTo(0.8 + 4 * (60 / 128), 9)
  })

  it("6/8 counts six clicks to a bar", () => {
    const lines = barLines(0, 198, "6/8", 2)
    expect(lines.filter((l) => l.bar !== null).map((l) => l.bar)).toEqual([1, 2])
    expect(lines[6].bar).toBe(2)
  })

  it("none with no tempo", () => {
    expect(barLines(0.8, null, null, 8)).toEqual([])
  })
})
