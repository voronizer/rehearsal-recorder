import { describe, expect, it } from "vitest"
import type { Take } from "@/lib/api"
import { eveningOf, falseStarts, isFalseStart, lengthLabel, starredToSend, takesLine } from "./evening"

function take(n: number, song: string | null, seconds: number, inCloud = false): Take {
  return {
    take_number: n,
    name: song ?? `Take ${n}`,
    song,
    go: song ? 1 : null,
    duration_sec: seconds,
    tracks: [],
    ...(inCloud ? { cloud: { mix: "Jam/Pałyn 1.mp3" } } : {}),
  }
}

describe("eveningOf", () => {
  it("adds up the takes, the songs and what is in the cloud", () => {
    const takes = [take(1, "Pałyn", 60, true), take(2, "Pałyn", 90), take(3, null, 30)]
    expect(eveningOf(takes)).toEqual({ seconds: 180, takes: 3, songs: 1, inCloud: 1 })
  })
  it("counts a take whose tracks alone are in the cloud", () => {
    const t = { ...take(1, null, 10), cloud: { tracks: "Jam/Take 1" } }
    expect(eveningOf([t]).inCloud).toBe(1)
  })
})

describe("lengthLabel", () => {
  it("is in minutes, and under one is said so", () => {
    expect(lengthLabel(0)).toBe("0 min")
    expect(lengthLabel(20)).toBe("<1 min")
    expect(lengthLabel(2700)).toBe("45 min")
  })
})

describe("takesLine", () => {
  it("is the takes and how many songs they are", () => {
    expect(takesLine({ seconds: 0, takes: 11, songs: 4, inCloud: 0 })).toBe("11, 4 songs")
    expect(takesLine({ seconds: 0, takes: 2, songs: 1, inCloud: 0 })).toBe("2, 1 song")
  })
  it("is the takes alone when none has a song", () => {
    expect(takesLine({ seconds: 0, takes: 2, songs: 0, inCloud: 0 })).toBe("2")
  })
})

describe("isFalseStart", () => {
  it("is a take shorter than the limit with no star and no marks", () => {
    expect(isFalseStart(take(4, null, 12), 30)).toBe(true)
  })
  it("is not a take exactly as long as the limit", () => {
    expect(isFalseStart(take(4, null, 30), 30)).toBe(false)
  })
  it("is not a short take somebody starred", () => {
    expect(isFalseStart({ ...take(4, null, 12), starred: true }, 30)).toBe(false)
  })
  it("is not a short take with a mark", () => {
    const marked = { ...take(4, null, 12), markers: [{ at: 3, label_id: 1, note: "" }] }
    expect(isFalseStart(marked, 30)).toBe(false)
  })
  it("follows the limit it is given", () => {
    expect(isFalseStart(take(4, null, 12), 10)).toBe(false)
  })
})

describe("falseStarts", () => {
  it("is the evening's false starts, in order", () => {
    const takes = [take(1, "Pałyn", 8), take(2, "Pałyn", 200), take(3, null, 5)]
    expect(falseStarts(takes, 30).map((t) => t.take_number)).toEqual([1, 3])
  })
})

describe("starredToSend", () => {
  const starred = (n: number) => ({ ...take(n, "Pałyn", 120), starred: true })
  it("is the starred takes with no copy in the cloud and none waiting", () => {
    const takes = [
      starred(1),
      { ...starred(2), cloud: { mix: "Jam/Pałyn 2.mp3" } },
      { ...starred(3), cloud: { tracks: "Jam/Pałyn 3" } },
      starred(4),
      take(5, "Pałyn", 120),
    ]
    expect(starredToSend(takes, { 4: "queued" }).map((t) => t.take_number)).toEqual([1])
  })
  it("needs nothing waiting to be told", () => {
    expect(starredToSend([starred(1)]).map((t) => t.take_number)).toEqual([1])
  })
})
