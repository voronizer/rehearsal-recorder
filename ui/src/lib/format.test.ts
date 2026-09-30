import { describe, expect, it } from "vitest"
import {
  aboutDuration,
  clippedLine,
  croppedButNotSwept,
  describeRescan,
  formatBytes,
  formatClock,
  formatDateHuman,
  formatDuration,
  formatMMSS,
  notConnected,
  peakToDb,
  recordingLine,
  songsLabel,
  takesLabel,
} from "@/lib/format"

describe("times", () => {
  it("writes minutes and seconds, and nothing for what is not a time", () => {
    expect(formatMMSS(0)).toBe("0:00")
    expect(formatMMSS(125.9)).toBe("2:05")
    expect(formatMMSS(-3)).toBe("0:00")
    expect(formatMMSS(NaN)).toBe("0:00")
  })
  it("counts a take's clock in minutes, and hours once past the hour", () => {
    expect(formatClock(59)).toBe("0:59")
    expect(formatClock(3599)).toBe("59:59")
    expect(formatClock(3735)).toBe("1:02:15")
  })
  it("writes a date the way people say it", () => {
    expect(formatDateHuman("2026-09-18T19:00:00")).toBe("18 Sep 2026, 19:00")
    expect(formatDateHuman("2026-09-18")).toBe("18 Sep 2026")
    expect(formatDateHuman("")).toBe("")
  })
})

describe("the recording screen's line", () => {
  it("names the one track that clipped, and how often", () => {
    expect(clippedLine([{ name: "Vocals", clips: 1 }])).toBe("Vocals clipped in the last minute")
    expect(clippedLine([{ name: "Vocals", clips: 3 }])).toBe(
      "Vocals clipped 3 times in the last minute"
    )
  })
  it("names two, and counts more than that", () => {
    expect(
      clippedLine([
        { name: "Vocals", clips: 1 },
        { name: "Bass", clips: 2 },
      ])
    ).toBe("Vocals and Bass clipped in the last minute")
    expect(clippedLine([1, 2, 3, 4].map((n) => ({ name: `T${n}`, clips: 1 })))).toBe(
      "4 tracks clipped in the last minute"
    )
  })
  it("says all is fine too, so that no news does not read as good news", () => {
    expect(recordingLine(1)).toBe("1 track recording")
    expect(recordingLine(5)).toBe("All 5 tracks recording")
  })
})

describe("amounts", () => {
  it("counts takes in the singular and the plural", () => {
    expect(takesLabel(1)).toBe("1 take")
    expect(takesLabel(3)).toBe("3 takes")
  })
  it("counts bytes in thousands, as the file manager does", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(412)).toBe("412 B")
    expect(formatBytes(1_200_000_000)).toBe("1.2 GB")
    expect(formatBytes(340_000_000)).toBe("340 MB")
  })
  it("names four songs and counts the rest", () => {
    const songs = ["Polyn", "Vesna", "Ogon", "Dym", "Reka"].map((name, i) => ({
      name,
      takes: i === 0 ? 3 : 1,
    }))
    expect(songsLabel(songs)).toBe("Polyn ×3 · Vesna · Ogon · Dym · and 1 more")
  })
  it("says how long the disk lasts, without an about for many hours", () => {
    expect(formatDuration(45)).toBe("45 min")
    expect(formatDuration(200)).toBe("3 h 20 min")
    expect(formatDuration(120)).toBe("2 h")
    expect(formatDuration(49 * 60)).toBe("many hours")
    expect(aboutDuration(200)).toBe("about 3 h 20 min")
    expect(aboutDuration(49 * 60)).toBe("many hours")
  })
  it("writes a peak as dBFS", () => {
    expect(peakToDb(0.5)).toBe("-6.0")
    expect(peakToDb(0)).toBe("−∞")
  })
})

describe("what the interface says about cards and takes", () => {
  it("names the audio system of a missing card only where there are several", () => {
    const desk = { name: "X18/XR18", host_api: "ASIO" }
    expect(notConnected(desk, false)).toBe("“X18/XR18” is not connected")
    expect(notConnected(desk, true)).toBe("“X18/XR18” (ASIO) is not connected")
  })
  it("says in one line what looking for cards again turned up", () => {
    expect(describeRescan(["XR18"], [])).toBe("Found “XR18”")
    expect(describeRescan([], ["A", "B"])).toBe("“A”, “B” are gone")
    expect(describeRescan(["XR18"], ["A"])).toBe("Found “XR18”; “A” is gone")
    expect(describeRescan()).toBe("No new interfaces")
  })
  it("says where the original of a crop was left, when it was", () => {
    expect(croppedButNotSwept("disk full", "C:\\take")).toBe(
      "The take was cropped, but the original could not be moved out of the way (disk full), and is still at C:\\take."
    )
    expect(croppedButNotSwept("disk full")).toBe(
      "The take was cropped, but the original could not be moved out of the way (disk full)."
    )
  })
})
