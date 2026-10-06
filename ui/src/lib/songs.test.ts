import { describe, expect, it } from "vitest"
import type { SongGo, SongIndex, SongSummary, Take } from "@/lib/api"
import {
  byPlace,
  firstOpen,
  fromLastTime,
  hereFor,
  inSongOrder,
  pageLine,
  placed,
  rungsOf,
  songLine,
  songRefFor,
} from "@/lib/songs"

const NOW = new Date("2026-10-06T12:00:00")

function take(n: number, extra: Partial<Take> = {}): Take {
  return { take_number: n, name: `Take ${n}`, duration_sec: 100, tracks: [], ...extra }
}

function go(folder: string, n: number, created_at: string, extra: Partial<SongGo> = {}): SongGo {
  return { folder, rehearsal: folder, created_at, missing: false, take: take(n), ...extra }
}

function song(id: number, title: string, extra: Partial<SongSummary> = {}): SongSummary {
  return {
    id,
    title,
    goes: 1,
    rehearsals: 1,
    first_played: "2026-09-01T19:00:00",
    last_played: "2026-09-01T19:00:00",
    starred: 0,
    ...extra,
  }
}

describe("byPlace", () => {
  it("is the same take number in the same rehearsal, whatever the copy", () => {
    expect(byPlace(placed("/a", take(2)), placed("/a", take(2, { name: "Pałyn 2" })))).toBe(true)
  })
  it("is not the same take number in another rehearsal", () => {
    expect(byPlace(placed("/a", take(2)), placed("/b", take(2)))).toBe(false)
  })
})

describe("hereFor", () => {
  const playing = {
    take: placed("/a", take(1)),
    playing: true,
    loading: false,
    position: 12,
    duration: 100,
  }
  it("is the playback for the row of the take playing", () => {
    expect(hereFor(playing, "/a", take(1))).toEqual({ ...playing, take: 1 })
  })
  it("is nothing for the same take number in another rehearsal", () => {
    expect(hereFor(playing, "/b", take(1))).toBeNull()
  })
})

describe("inSongOrder", () => {
  it("puts the songs in alphabetical order, case-blind, any script, Not named last", () => {
    const index: SongIndex = {
      songs: ["vesna", "Ahoń", "Дорога", "ahoń 2", "Pałyn"].map((t, i) => song(i + 1, t)),
      not_named: { takes: 2, rehearsals: 1, last_played: "2026-09-01T19:00:00" },
    }
    const titles = new Map(index.songs.map((s) => [s.id, s.title]))
    expect(inSongOrder(index).map((r) => (r === "not_named" ? r : titles.get(r)))).toEqual([
      "Ahoń",
      "ahoń 2",
      "Pałyn",
      "vesna",
      "Дорога",
      "not_named",
    ])
  })
  it("has no Not named row when every take has a song", () => {
    expect(inSongOrder({ songs: [song(1, "Dym")], not_named: null })).toEqual([1])
  })
})

describe("songRefFor", () => {
  const index: SongIndex = {
    songs: [song(1, "Pałyn"), song(2, "Viasna")],
    not_named: { takes: 1, rehearsals: 1, last_played: "2026-09-01T19:00:00" },
  }
  it("is the song of that title, capitals or not", () => {
    expect(songRefFor(index, "viasna")).toBe(2)
  })
  it("is Not named for no title", () => {
    expect(songRefFor(index, null)).toBe("not_named")
  })
  it("is nothing for a title with no goes", () => {
    expect(songRefFor(index, "Dym")).toBeNull()
    expect(songRefFor({ ...index, not_named: null }, null)).toBeNull()
  })
})

describe("rungsOf", () => {
  it("makes a rung of each rehearsal's goes, in the order given", () => {
    const goes = [
      go("/t", 1, "2026-09-22T19:00:00"),
      go("/t", 2, "2026-09-22T19:00:00"),
      go("/m", 1, "2026-09-10T19:00:00"),
      go("/f", 3, "2026-08-25T19:00:00"),
      go("/f", 4, "2026-08-25T19:00:00"),
    ]
    expect(rungsOf(goes).map((r) => [r.folder, r.goes.map((t) => t.take_number)])).toEqual([
      ["/t", [1, 2]],
      ["/m", [1]],
      ["/f", [3, 4]],
    ])
  })
})

describe("firstOpen", () => {
  it("is the newest rehearsal on disk", () => {
    const rungs = rungsOf([
      go("/t", 1, "2026-09-22T19:00:00", { missing: true }),
      go("/m", 1, "2026-09-10T19:00:00"),
    ])
    expect(firstOpen(rungs)).toBe("/m")
  })
  it("is the newest when none is on disk", () => {
    const rungs = rungsOf([
      go("/t", 1, "2026-09-22T19:00:00", { missing: true }),
      go("/m", 1, "2026-09-10T19:00:00", { missing: true }),
    ])
    expect(firstOpen(rungs)).toBe("/t")
  })
  it("is nothing with no goes", () => {
    expect(firstOpen([])).toBeNull()
  })
})

describe("fromLastTime", () => {
  const mark = (at: number, note = "") => ({ at, label_id: 1, note })
  it("is the marks at the newest rehearsal on disk, go by go", () => {
    const goes = [
      go("/t", 1, "2026-09-22T19:00:00", {
        missing: true,
        take: take(1, { markers: [mark(5, "not reachable")] }),
      }),
      go("/m", 1, "2026-09-10T19:00:00", { take: take(1, { markers: [mark(40, "late")] }) }),
      go("/m", 3, "2026-09-10T19:00:00", {
        take: take(3, { markers: [mark(70, "the take"), mark(10)] }),
      }),
      go("/f", 1, "2026-08-25T19:00:00", { take: take(1, { markers: [mark(1, "older")] }) }),
    ]
    expect(fromLastTime(goes).map((m) => [m.go.take.take_number, m.marker.at])).toEqual([
      [1, 40],
      [3, 10],
      [3, 70],
    ])
  })
  it("is nothing when that rehearsal has no marks", () => {
    expect(fromLastTime([go("/m", 1, "2026-09-10T19:00:00")])).toEqual([])
  })
})

describe("the lines under a song", () => {
  it("says goes, rehearsals and when it was last played", () => {
    expect(
      songLine(song(1, "Dym", { last_played: "2026-09-28T19:00:00" }), NOW)
    ).toBe("1 go · 1 rehearsal · last 28 Sep")
  })
  it("says the year of a date before this one", () => {
    const goes = [go("/b", 1, "2026-01-08T19:00:00"), go("/a", 1, "2025-12-30T19:00:00")]
    expect(pageLine(goes, false, NOW)).toBe(
      "2 goes in 2 rehearsals · first 30 Dec 2025 · last 8 Jan"
    )
  })
  it("counts takes, not goes, for Not named", () => {
    const goes = [go("/b", 4, "2026-09-22T19:00:00"), go("/a", 2, "2026-09-10T19:00:00")]
    expect(pageLine(goes, true, NOW)).toBe("2 takes in 2 rehearsals · last Tue 22 Sep")
  })
})
