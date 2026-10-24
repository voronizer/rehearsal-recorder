import { describe, expect, it } from "vitest"
import {
  aboutDuration,
  countOf,
  daysAgo,
  describeRescan,
  diskLine,
  formatBarOne,
  formatBytes,
  formatClock,
  formatDate,
  formatDateHuman,
  formatDay,
  formatDayIn,
  formatDuration,
  formatMMSS,
  formatMonth,
  formatWhen,
  inCloudLabel,
  inputsLabel,
  longAgo,
  marksLabel,
  notConnected,
  nounFor,
  peakToDb,
  rehearsalsLabel,
  savedLine,
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
  it("writes bar 1's place in a file to a hundredth of a second", () => {
    expect(formatBarOne(0)).toBe("0:00.00")
    expect(formatBarOne(0.8)).toBe("0:00.80")
    expect(formatBarOne(1.27)).toBe("0:01.27")
    expect(formatBarOne(62.5)).toBe("1:02.50")
    // A hundredth that rounds up to the next minute carries into it.
    expect(formatBarOne(59.999)).toBe("1:00.00")
    expect(formatBarOne(-1)).toBe("0:00.00")
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
  it("names a rehearsal's day by its weekday, and its month in full", () => {
    expect(formatDay("2026-09-22T19:00:00")).toBe("Tue 22 Sep")
    expect(formatDay("2026-08-25")).toBe("Tue 25 Aug")
    expect(formatDay("2026-09-26T23:59:00")).toBe("Sat 26 Sep")
    expect(formatDay("")).toBe("")
    expect(formatMonth("2026-09-22T19:00:00")).toBe("September 2026")
    expect(formatMonth("")).toBe("")
  })
  it("says how long ago a day was, in days and then weeks and months", () => {
    // Late in the evening: the time of day does not tip a date over.
    const now = new Date(2026, 8, 30, 23, 30)
    expect(daysAgo("2026-09-30T19:00:00", now)).toBe("today")
    expect(daysAgo("2026-09-29T23:00:00", now)).toBe("yesterday")
    expect(daysAgo("2026-09-22T19:00:00", now)).toBe("8 days ago")
    expect(daysAgo("2026-09-15T19:00:00", now)).toBe("2 weeks ago")
    expect(daysAgo("2026-07-01T19:00:00", now)).toBe("3 months ago")
    expect(daysAgo("2023-09-01T19:00:00", now)).toBe("3 years ago")
    // Beside a date, only once it is a while back.
    expect(longAgo("2026-09-22T19:00:00", now)).toBe("")
    expect(longAgo("2026-09-15T19:00:00", now)).toBe("2 weeks ago")
    expect(formatWhen("2026-09-22T19:00:00")).toBe("Tue 22 Sep, 19:00")
    expect(formatWhen("2026-09-22")).toBe("Tue 22 Sep")
  })
})

describe("amounts", () => {
  it("counts takes in the singular and the plural", () => {
    expect(takesLabel(1)).toBe("1 take")
    expect(takesLabel(3)).toBe("3 takes")
  })
  it("counts inputs in the singular and the plural", () => {
    expect(inputsLabel(1)).toBe("1 input")
    expect(inputsLabel(18)).toBe("18 inputs")
  })
  it("counts rehearsals in the singular and the plural", () => {
    expect(rehearsalsLabel(1)).toBe("1 rehearsal")
    expect(rehearsalsLabel(4)).toBe("4 rehearsals")
  })
  it("counts songs in the singular and the plural", () => {
    expect(songsLabel(1)).toBe("1 song")
    expect(songsLabel(6)).toBe("6 songs")
  })
  it("says how many takes are in the cloud", () => {
    expect(inCloudLabel(1)).toBe("1 in the cloud")
    expect(inCloudLabel(3)).toBe("3 in the cloud")
  })
  it("says how many takes are saved, with a verb that agrees", () => {
    expect(savedLine(1)).toBe("1 take is saved and stays where it is.")
    expect(savedLine(3)).toBe("3 takes are saved and stay where they are.")
  })
  it("counts bytes in thousands, as the file manager does", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(412)).toBe("412 B")
    expect(formatBytes(1_200_000_000)).toBe("1.2 GB")
    expect(formatBytes(340_000_000)).toBe("340 MB")
  })
  it("says how long the disk lasts, without an about for many hours", () => {
    expect(formatDuration(45)).toBe("45 min")
    expect(formatDuration(200)).toBe("3 h 20 min")
    expect(formatDuration(120)).toBe("2 h")
    expect(formatDuration(119.7)).toBe("2 h")
    expect(formatDuration(79.8)).toBe("1 h 20 min")
    expect(formatDuration(49 * 60)).toBe("many hours")
    expect(aboutDuration(200)).toBe("about 3 h 20 min")
    expect(aboutDuration(49 * 60)).toBe("many hours")
  })
  it("says the free space one way for the start screen and the recording screen", () => {
    expect(diskLine(180, false)).toBe("Room for about 3 h of recording")
    expect(diskLine(5, false)).toBe("Room for about 5 min of recording")
    expect(diskLine(5, true)).toBe("Low disk space: room for about 5 min")
    // An estimate past two days takes no about, low or not.
    expect(diskLine(49 * 60, false)).toBe("Room for many hours of recording")
    expect(diskLine(49 * 60, true)).toBe("Low disk space: room for many hours")
  })
  it("counts a thing in the singular and the plural, with thousands set apart", () => {
    expect(countOf(0, "note")).toBe("0 notes")
    expect(countOf(1, "note")).toBe("1 note")
    expect(countOf(2, "note")).toBe("2 notes")
    expect(countOf(1234, "note")).toBe("1,234 notes")
    expect(countOf(1_234_567, "note")).toBe("1,234,567 notes")
    expect(countOf(2, "box", "boxes")).toBe("2 boxes")
    expect(countOf(1, "box", "boxes")).toBe("1 box")
  })
  it("counts marks: one, many, and thousands set apart", () => {
    expect(marksLabel(1)).toBe("1 mark")
    expect(marksLabel(221)).toBe("221 marks")
    expect(marksLabel(0)).toBe("0 marks")
    expect(marksLabel(1234)).toBe("1,234 marks")
  })
  it("names the noun alone for a count drawn apart from it", () => {
    expect(nounFor(1, "take")).toBe("take")
    expect(nounFor(2, "take")).toBe("takes")
    expect(nounFor(0, "take")).toBe("takes")
    expect(nounFor(2, "box", "boxes")).toBe("boxes")
  })
  it("writes a peak as dBFS", () => {
    expect(peakToDb(0.5)).toBe("-6.0")
    expect(peakToDb(0)).toBe("−∞")
  })
})

describe("what the interface says about cards", () => {
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
})

describe("formatDayIn", () => {
  const now = new Date("2026-10-06T12:00:00")
  it("is the weekday, day and month in this year", () => {
    expect(formatDayIn("2026-09-22T19:00:00", now)).toBe("Tue 22 Sep")
  })
  it("says the year of a day in another", () => {
    expect(formatDayIn("2025-12-30T19:00:00", now)).toBe("Tue 30 Dec 2025")
  })
})

describe("formatDate", () => {
  const now = new Date("2026-10-06T12:00:00")
  it("is the day and month in this year", () => {
    expect(formatDate("2026-09-22T19:00:00", now)).toBe("22 Sep")
  })
  it("adds the year before this one", () => {
    expect(formatDate("2025-09-22T19:00:00", now)).toBe("22 Sep 2025")
  })
  it("is nothing for what it cannot read", () => {
    expect(formatDate("", now)).toBe("")
  })
})
