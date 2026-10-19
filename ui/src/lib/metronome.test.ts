import { describe, expect, it } from "vitest"
import type { MetronomeState } from "@/lib/api"
import { formatMeter, formatMeterShort, formatTempo, tempoUnit } from "@/lib/format"
import {
  accentOf,
  CLICK_SOUNDS,
  clampTempo,
  countDigit,
  parseTempo,
  perBar,
  SIGNATURES,
  songLine,
  statusLine,
  tapTempo,
  tempoRange,
  unitTitle,
} from "@/lib/metronome"

/** What the screen is given, between takes on a song with a tempo: a case
 *  changes the fields it is about. */
function state(over: Partial<MetronomeState> = {}): MetronomeState {
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
    ...over,
  }
}

/** A song that has no tempo yet, the row empty. */
const WITHOUT: Partial<MetronomeState> = {
  case: "song_without",
  tempo: null,
  song: { id: 5, title: "Dym", tempo: null, signature: null },
}
const LAST_TAKE = { folder: "/rec/sat", take_number: 5, name: "Dym 5" }

describe("a tempo typed in", () => {
  it("means no tempo when it is empty", () => {
    expect(parseTempo("", "4/4", 120)).toBeNull()
    expect(parseTempo("   ", "6/8", 198)).toBeNull()
  })
  it("is rounded", () => {
    expect(parseTempo("128.6", "4/4", 120)).toBe(129)
    expect(parseTempo("128,4", "4/4", 120)).toBe(128)
    expect(parseTempo(" 96 ", "3/4", 120)).toBe(96)
  })
  it("is kept in the signature's range", () => {
    expect(parseTempo("0", "4/4", 120)).toBe(30)
    expect(parseTempo("-5", "4/4", 120)).toBe(30)
    expect(parseTempo("9999", "4/4", 120)).toBe(300)
    expect(parseTempo("9999", "6/8", 198)).toBe(600)
    expect(parseTempo("20", "6/8", 198)).toBe(60)
    // A 6/8 number pasted into 4/4.
    expect(parseTempo("450", "4/4", 120)).toBe(300)
    expect(parseTempo("198", "4/4", 120)).toBe(198)
  })
  it("puts the last good value back when it is not a number", () => {
    expect(parseTempo("abc", "4/4", 120)).toBe(120)
    expect(parseTempo("12abc", "4/4", 120)).toBe(120)
    expect(parseTempo("1e3", "4/4", 120)).toBe(120)
    expect(parseTempo("128 bpm", "4/4", 120)).toBe(120)
    expect(parseTempo("abc", "4/4", null)).toBeNull()
  })
  it("clamps a number that is already whole", () => {
    expect(clampTempo(450, "4/4")).toBe(300)
    expect(clampTempo(450, "6/8")).toBe(450)
    expect(clampTempo(20, "6/8")).toBe(60)
  })
})

describe("signatures", () => {
  it("are the four, in the order the select lists them", () => {
    expect(SIGNATURES).toEqual(["4/4", "3/4", "2/4", "6/8"])
  })
  it("count their clicks to a bar", () => {
    expect(SIGNATURES.map(perBar)).toEqual([4, 3, 2, 6])
  })
  it("range over 30 to 300, and 6/8 over 60 to 600", () => {
    expect(tempoRange("4/4")).toEqual({ min: 30, max: 300 })
    expect(tempoRange("3/4")).toEqual({ min: 30, max: 300 })
    expect(tempoRange("2/4")).toEqual({ min: 30, max: 300 })
    expect(tempoRange("6/8")).toEqual({ min: 60, max: 600 })
  })
  it("accent the first click of a bar, and 6/8's fourth", () => {
    expect([0, 1, 2, 3].map((i) => accentOf("4/4", i))).toEqual([2, 0, 0, 0])
    expect([0, 1, 2].map((i) => accentOf("3/4", i))).toEqual([2, 0, 0])
    expect([0, 1].map((i) => accentOf("2/4", i))).toEqual([2, 0])
    expect([0, 1, 2, 3, 4, 5].map((i) => accentOf("6/8", i))).toEqual([2, 0, 0, 1, 0, 0])
    expect(accentOf("6/8", 3)).toBe(1)
    // The next bar's first click is the bar's first again.
    expect(accentOf("4/4", 4)).toBe(2)
  })
  it("have three sounds to click with, named as Settings names them", () => {
    expect(CLICK_SOUNDS.map((s) => [s.id, s.label])).toEqual([
      ["click", "Click"],
      ["wood", "Woodblock"],
      ["hihat", "Hi-hat"],
    ])
  })
  it("say what the number counts", () => {
    expect(unitTitle("4/4")).toBe("Beats a minute")
    expect(unitTitle("3/4")).toBe("Beats a minute")
    expect(unitTitle("6/8")).toBe("Eighths a minute: the six clicks of a bar")
  })
})

describe("tapping a tempo", () => {
  it("is the clicks a minute the gaps make", () => {
    expect(tapTempo([0, 500, 1000, 1500, 2000], "4/4")).toBe(120)
    expect(tapTempo([0, 468.75], "4/4")).toBe(128)
  })
  it("needs two taps", () => {
    expect(tapTempo([], "4/4")).toBeNull()
    expect(tapTempo([300], "4/4")).toBeNull()
  })
  it("averages the last four gaps", () => {
    expect(tapTempo([0, 900, 1400, 1900, 2400, 2900], "4/4")).toBe(120)
    expect(tapTempo([0, 500, 1000, 1700], "4/4")).toBe(106)
  })
  it("starts afresh after a gap of more than two seconds", () => {
    expect(tapTempo([0, 500, 1000, 3100], "4/4")).toBeNull()
    expect(tapTempo([0, 500, 1000, 3100, 3600], "4/4")).toBe(120)
    expect(tapTempo([0, 500, 2600, 3100, 3600], "4/4")).toBe(120)
    // Two seconds exactly is a slow tempo, not a pause.
    expect(tapTempo([0, 2000], "4/4")).toBe(30)
  })
  it("is kept in the signature's range", () => {
    expect(tapTempo([0, 100, 200], "4/4")).toBe(300)
    expect(tapTempo([0, 100, 200], "6/8")).toBe(600)
    expect(tapTempo([0, 2000], "6/8")).toBe(60)
  })
  it("reads taps that arrive out of order, and taps at once", () => {
    expect(tapTempo([1000, 0, 500], "4/4")).toBe(120)
    expect(tapTempo([400, 400], "4/4")).toBeNull()
  })
})

describe("the figures", () => {
  it("write a tempo with its unit, an eighth's text form in 6/8", () => {
    expect(formatTempo(128, "4/4")).toBe("128 bpm")
    expect(formatTempo(96, "3/4")).toBe("96 bpm")
    expect(formatTempo(198, "6/8")).toBe("198 ♪")
    expect(tempoUnit("2/4")).toBe("bpm")
    expect(tempoUnit("6/8")).toBe("♪")
  })
  it("write a tempo and its signature together", () => {
    expect(formatMeter(128, "4/4")).toBe("128 bpm · 4/4")
    expect(formatMeter(198, "6/8")).toBe("198 ♪ · 6/8")
  })
  it("write them without the unit where a row beside already shows it", () => {
    expect(formatMeterShort(128, "4/4")).toBe("128 · 4/4")
    expect(formatMeterShort(198, "6/8")).toBe("198 · 6/8")
  })
})

describe("the status line", () => {
  it("says the click is off", () => {
    expect(statusLine(state({ on: false }), null)).toEqual({
      text: "Off: takes record without the click.",
    })
    // Off wins over a held change and a missing output.
    expect(statusLine(state({ on: false, held: true, output_missing: "X18" }), null).text).toBe(
      "Off: takes record without the click."
    )
  })
  it("says it is the song's tempo", () => {
    expect(statusLine(state(), null)).toEqual({ text: "The song's tempo." })
  })
  it("offers Save to song while the row differs from the song", () => {
    const held = state({ tempo: 120, held: true })
    expect(statusLine(held, null)).toEqual({
      text: "The song has 128 · 4/4; this holds until another song.",
      link: { label: "Save to song", action: "save" },
    })
    const six = state({
      tempo: 120,
      held: true,
      song: { id: 3, title: "Ahon", tempo: 198, signature: "6/8" },
    })
    expect(statusLine(six, null).text).toBe("The song has 198 · 6/8; this holds until another song.")
  })
  it("offers Save to song only while it is held", () => {
    expect(statusLine(state({ held: false }), null).link).toBeUndefined()
    expect(statusLine(state({ held: true }), null).link).toEqual({
      label: "Save to song",
      action: "save",
    })
  })
  it("offers Save now when the song has no tempo and the row has one", () => {
    expect(statusLine(state({ ...WITHOUT, tempo: 104, held: true }), null)).toEqual({
      text: "No tempo in the song yet: the first take played to the click keeps this one.",
      link: { label: "Save now", action: "save" },
    })
  })
  it("offers counting from the last take only when the song has a take", () => {
    expect(statusLine(state({ ...WITHOUT, last_take: LAST_TAKE }), null)).toEqual({
      text: "No tempo yet: type or tap one, or",
      link: { label: "count it from the last take", action: "count" },
    })
    expect(statusLine(state({ ...WITHOUT }), null)).toEqual({
      text: "No tempo yet: type or tap one.",
    })
  })
  it("says it is counting, then what it counted from", () => {
    const row = state({ ...WITHOUT, last_take: LAST_TAKE })
    expect(statusLine(row, "running")).toEqual({
      text: "Counting the tempo from the last take…",
    })
    const counted = state({ ...WITHOUT, tempo: 104, held: true, last_take: LAST_TAKE })
    expect(statusLine(counted, { from: "Dym 5" })).toEqual({
      text: "Counted from Dym 5. Pick the time signature, then",
      link: { label: "save it to the song", action: "save" },
    })
  })
  it("goes back to the song's own line once the count is saved", () => {
    const saved = state({ case: "song", held: false })
    expect(statusLine(saved, { from: "Dym 5" })).toEqual({ text: "The song's tempo." })
  })
  it("says a free take has no click until a tempo is set", () => {
    const free = { case: "free", song: null, held: false } as const
    expect(statusLine(state({ ...free, tempo: null }), null)).toEqual({
      text: "Free take: no click unless you set a tempo.",
    })
    expect(statusLine(state({ ...free, tempo: 110 }), null)).toEqual({
      text: "Free take: this tempo stays with the take only.",
    })
  })
  it("warns in amber when the click's output is missing", () => {
    const line = statusLine(state({ output_missing: "X18" }), null)
    expect(line).toEqual({
      text: "The click's output, X18, is not connected. The beat will only flash.",
      warn: true,
    })
    expect(statusLine(state({ output_missing: "X18", phase: "preview" }), null).warn).toBe(true)
  })
  it("has nothing to warn of without a tempo, and no warning otherwise", () => {
    expect(statusLine(state({ ...WITHOUT, output_missing: "X18" }), null).warn).toBeUndefined()
    expect(statusLine(state(), null).warn).toBeUndefined()
  })

  it("counts the count-in", () => {
    const count = (n: number, extra: Partial<MetronomeState> = {}) =>
      statusLine(state({ phase: "count", count: n, ...extra }), null)
    expect(count(2)).toEqual({ text: "Count-in: 2 of 4" })
    // Two bars count twice.
    expect(count(6)).toEqual({ text: "Count-in: 2 of 4" })
    expect(count(5, { signature: "6/8", per_bar: 6, tempo: 198 }).text).toBe("Count-in: 5 of 6")
  })
  it("says the click runs to Stop", () => {
    expect(statusLine(state({ phase: "take", since_count_in_ms: 1200 }), null)).toEqual({
      text: "Clicking to Stop.",
    })
  })
  it("says the click is off in a take, and that the tempo still goes in", () => {
    expect(statusLine(state({ phase: "take", on: false }), null)).toEqual({
      text: "Click off. The tempo still goes into the take.",
    })
    expect(statusLine(state({ phase: "count", on: false, count: 1 }), null).text).toBe(
      "Click off. The tempo still goes into the take."
    )
  })
  it("says a take with no tempo has no click", () => {
    expect(statusLine(state({ phase: "take", tempo: null, case: "free", song: null }), null)).toEqual({
      text: "No click: this take has no tempo.",
    })
  })
  it("warns in a take whose click output has gone", () => {
    const line = statusLine(state({ phase: "take", output_missing: "X18" }), null)
    expect(line.warn).toBe(true)
    expect(line.text).toBe("The click's output, X18, is not connected. The beat will only flash.")
  })
})

describe("the count-in's digits", () => {
  it("go from 1 to the clicks of a bar, and again for a second bar", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => countDigit(n, 4).digit)).toEqual([1, 2, 3, 4, 1, 2, 3, 4])
    expect(countDigit(5, 6)).toEqual({ digit: 5, of: 6 })
    expect(countDigit(0, 4)).toEqual({ digit: 1, of: 4 })
  })
})

describe("a song's page line", () => {
  const text = (line: ReturnType<typeof songLine>) =>
    line.parts.map((p) => (typeof p === "string" ? p : p.label)).join("")
  it("asks for a tempo of a song with none", () => {
    const line = songLine("Dym", null, null)
    expect(text(line)).toBe("No tempo yet: type or tap one, or count it from a take")
    expect(line.parts.at(-1)).toEqual({ label: "count it from a take", action: "count" })
  })
  it("says what it counted, and offers to halve or double it", () => {
    const line = songLine("Dym", 104, "Dym 5")
    expect(text(line)).toBe(
      "Counted from Dym 5; pick the time signature. If the click runs twice too fast or too slow: halve or double."
    )
    expect(line.parts.filter((p) => typeof p !== "string")).toEqual([
      { label: "halve", action: "halve" },
      { label: "double", action: "double" },
    ])
  })
  it("says where a song's tempo goes, and does not offer counting for it", () => {
    const line = songLine("Dym", 104, null)
    expect(text(line)).toBe("Picking Dym at a rehearsal puts this in the metronome.")
    expect(line.parts.every((p) => typeof p === "string")).toBe(true)
  })
})
