import { describe, expect, it } from "vitest"
import {
  QUIET_THRESHOLD,
  SILENT_AFTER_MS,
  fallBack,
  isSilent,
  meterReach,
  watchStep,
} from "@/lib/levels"

const dB = (db: number) => 10 ** (db / 20)

describe("meterReach: the meters are in dB, as on a desk", () => {
  it("puts a hit at -18 dBFS, where a band sets its gain, about seven tenths up", () => {
    expect(meterReach(dB(-18))).toBeCloseTo(0.7, 2)
  })
  it("reaches the top at full scale and the bottom at -60", () => {
    expect(meterReach(1)).toBe(1)
    expect(meterReach(dB(-60))).toBeCloseTo(0, 6)
  })
  it("draws nothing for silence, or for anything below the scale", () => {
    expect(meterReach(0)).toBe(0)
    expect(meterReach(dB(-80))).toBe(0)
  })
})

describe("QUIET_THRESHOLD: what counts as silence", () => {
  it("is the bottom of the meters, -60 dBFS", () => {
    expect(QUIET_THRESHOLD).toBeCloseTo(dB(-60), 9)
  })
  it("leaves a quiet singer, at -48 dBFS, as signal", () => {
    expect(dB(-48)).toBeGreaterThan(QUIET_THRESHOLD)
  })
})

describe("fallBack: a meter rises at once and sinks back slowly", () => {
  it("goes straight up to a louder peak", () => {
    expect(fallBack(dB(-30), dB(-6), 70)).toBe(dB(-6))
  })
  it("falls 20 dB a second after the sound drops", () => {
    expect(20 * Math.log10(fallBack(dB(-6), 0, 500))).toBeCloseTo(-16, 5)
  })
  it("stops at the level that is still there", () => {
    expect(fallBack(dB(-6), dB(-10), 1000)).toBe(dB(-10))
  })
  it("does not move with no time gone", () => {
    expect(fallBack(dB(-6), 0, 0)).toBe(dB(-6))
  })
})

describe("watchStep: what a track has been doing, poll by poll", () => {
  it("counts a clip that goes on over several polls once", () => {
    let w = watchStep(undefined, [0.99], 0)
    w = watchStep(w, [0.99], 70)
    w = watchStep(w, [0.99], 140)
    expect(w.clips).toBe(1)
  })
  it("counts three separate clips as three", () => {
    let w = watchStep(undefined, [0.5], 0)
    for (let i = 1; i <= 3; i++) {
      w = watchStep(w, [0.99], i * 200)
      w = watchStep(w, [0.5], i * 200 + 100)
    }
    expect(w.clips).toBe(3)
  })
  it("keeps a clip to the end of the take, however long it runs", () => {
    let w = watchStep(undefined, [0.99], 0)
    w = watchStep(w, [0.5], 3 * 3_600_000)
    expect(w.clips).toBe(1)
  })
  it("calls a track silent only once it has been quiet for a moment", () => {
    let w = watchStep(undefined, [0.0005], 0)
    expect(isSilent(w, 0)).toBe(false)
    w = watchStep(w, [0.0005], SILENT_AFTER_MS)
    expect(isSilent(w, SILENT_AFTER_MS)).toBe(true)
  })
  it("does not call a quiet singer silent", () => {
    let w = watchStep(undefined, [dB(-48)], 0)
    w = watchStep(w, [dB(-48)], SILENT_AFTER_MS * 2)
    expect(isSilent(w, SILENT_AFTER_MS * 2)).toBe(false)
  })
  it("keeps a stereo track's sides apart, so a dead one shows", () => {
    const w = watchStep(undefined, [0.5, 0], 0)
    expect(w.shown).toEqual([0.5, 0])
    expect(w.hold.map((h) => h.peak)).toEqual([0.5, 0])
  })
  it("holds the latest peak for a moment, then lets it go", () => {
    let w = watchStep(undefined, [0.5], 0)
    w = watchStep(w, [0.126], 100)
    expect(w.hold[0].peak).toBe(0.5)
    w = watchStep(w, [0.126], 2000)
    expect(w.hold[0].peak).toBe(0.126)
  })
  it("lets the fill fall back from a peak rather than drop", () => {
    let w = watchStep(undefined, [0.5], 0)
    w = watchStep(w, [0], 70)
    expect(w.shown[0]).toBeGreaterThan(0.4)
    w = watchStep(w, [0], 3070)
    expect(meterReach(w.shown[0])).toBe(0)
  })
})
