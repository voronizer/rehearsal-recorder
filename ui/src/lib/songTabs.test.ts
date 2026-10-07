import { describe, expect, it } from "vitest"
import type { SongGo, Take } from "@/lib/api"
import { goesByTime, lastPlayed, neighbour, songTabs } from "./songTabs"

function take(n: number, song: string | null, go: number | null = null): Take {
  return {
    take_number: n,
    name: song ? `${song} ${go}` : `Take ${n}`,
    song,
    go,
    duration_sec: 100,
    tracks: [],
  }
}

function go(folder: string, created_at: string, t: Take, missing = false): SongGo {
  return { folder, rehearsal: folder, created_at, missing, take: t }
}

describe("songTabs", () => {
  const evening = [
    take(1, "Pałyn", 1),
    take(2, null),
    take(3, "Viasna", 1),
    take(4, "Pałyn", 2),
    take(5, null),
  ]

  it("is a tab per song in the order first played, and one per take with no song", () => {
    const tabs = songTabs(evening)
    expect(tabs.map((t) => t.key)).toEqual(["song:Pałyn", "take:2", "song:Viasna", "take:5"])
    expect(tabs[0].song).toBe("Pałyn")
    expect(tabs[1].song).toBeNull()
  })
  it("never keys a song as a take with no song, whatever the song is called", () => {
    const tabs = songTabs([take(1, "take:3", 1), take(3, null)])
    expect(new Set(tabs.map((t) => t.key)).size).toBe(2)
  })
  it("holds a song's takes in the order played", () => {
    expect(songTabs(evening)[0].takes.map((t) => t.take_number)).toEqual([1, 4])
  })
  it("is nothing for an evening with no takes", () => {
    expect(songTabs([])).toEqual([])
  })
})

describe("lastPlayed", () => {
  it("is the song's last go of the evening", () => {
    const tabs = songTabs([take(1, "Pałyn", 1), take(2, "Viasna", 1), take(4, "Pałyn", 2)])
    expect(lastPlayed(tabs[0]).take_number).toBe(4)
  })
})

describe("goesByTime", () => {
  it("is the oldest rehearsal first, in the order played within one", () => {
    // As get_song sends them: the newest rehearsal first.
    const goes = [
      go("/tue", "2026-09-22T19:00:00", take(2, "Pałyn", 4)),
      go("/tue", "2026-09-22T19:00:00", take(3, "Pałyn", 5)),
      go("/mid", "2026-09-10T19:00:00", take(1, "Pałyn", 3)),
      go("/first", "2026-08-25T19:00:00", take(1, "Pałyn", 1)),
      go("/first", "2026-08-25T19:00:00", take(2, "Pałyn", 2)),
    ]
    expect(goesByTime(goes).map((g) => g.take.go)).toEqual([1, 2, 3, 4, 5])
  })
  it("leaves out the goes of a rehearsal not on disk", () => {
    const goes = [
      go("/gone", "2026-09-30T19:00:00", take(1, "Pałyn", 8), true),
      go("/tue", "2026-09-22T19:00:00", take(2, "Pałyn", 4)),
    ]
    expect(goesByTime(goes).map((g) => g.folder)).toEqual(["/tue"])
  })
})

describe("neighbour", () => {
  const list = ["a", "b", "c"]
  it("is the one before or after", () => {
    expect(neighbour(list, 1, -1)).toBe("a")
    expect(neighbour(list, 1, 1)).toBe("c")
  })
  it("is nothing past either end", () => {
    expect(neighbour(list, 0, -1)).toBeNull()
    expect(neighbour(list, 2, 1)).toBeNull()
  })
  it("is nothing for a place not in the list", () => {
    expect(neighbour(list, -1, 1)).toBeNull()
  })
})
