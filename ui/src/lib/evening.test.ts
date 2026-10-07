import { describe, expect, it } from "vitest"
import type { Take } from "@/lib/api"
import { eveningOf, lengthLabel, takesLine } from "./evening"

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
