import { describe, expect, it } from "vitest"
import fake from "../../../ui/e2e/fake-bridge.js?raw"
import band from "../../../ui/e2e/band.js?raw"
import notes from "./notes.js?raw"
import type { TakeNotes } from "@/lib/api"
import type { SiteNotes } from "./demo"

type Played = [start: number, length: number, at: number, velocity: number]

type Page = {
  __SITE_NOTES__: SiteNotes
  __SONG__: { bridge: number; bar: number }
  pywebview: { api: Record<string, (...args: unknown[]) => Promise<any>> }
}

/** The scripts as the site runs them: the fake, the band and the notes in
 *  one scope, one after the other (see installDemo). */
function run(bandText: string = band): Page {
  const page = {} as Page
  const kept = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
  }
  new Function("window", "localStorage", `${fake}\n${bandText}\n${notes}`)(page, localStorage)
  return page
}

const drumsOf = (site: SiteNotes) => site.lanes[0].notes as Extract<TakeNotes, { drums: true }>
const keysOf = (site: SiteNotes) => site.lanes[1].notes as Extract<TakeNotes, { drums: false }>
/** How many of these notes were struck on this row or pitch. */
const count = (played: Played[], at: number) => played.filter((n) => n[2] === at).length

describe("the site's notes", () => {
  const page = run()
  const site = page.__SITE_NOTES__
  const { bridge, bar } = page.__SONG__
  const beat = bar / 4

  it("are the drums from TD-17 and the keys from Launchkey Mini MK3", () => {
    expect(site.lanes.map((l) => [l.notes.name, l.port])).toEqual([
      ["Drums", "TD-17"],
      ["Keys", "Launchkey Mini MK3"],
    ])
    expect(site.lanes.map((l) => l.notes.icon)).toEqual(["drums", "keys"])
  })

  it("last eight bars, the end of the chorus into the bridge, the part heard ending a bar in", () => {
    expect(site.from).toBeCloseTo(bridge - 4 * bar, 6)
    expect(site.to).toBeCloseTo(bridge + 4 * bar, 6)
    expect(site.playhead).toBeCloseTo(bridge + bar, 6)
  })

  it("have the drums on a kit's six rows, in the order they began, in MIDI's velocities", () => {
    const drums = drumsOf(site)
    expect(drums.rows).toEqual(["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"])
    expect(drums.notes.length).toBeGreaterThan(40)
    for (const [start, length, row, velocity] of drums.notes) {
      expect(start).toBeGreaterThanOrEqual(site.from - 1e-6)
      expect(start).toBeLessThan(site.to)
      expect(length).toBeGreaterThan(0)
      expect(Number.isInteger(row) && row >= 0 && row < drums.rows.length).toBe(true)
      expect(Number.isInteger(velocity) && velocity >= 1 && velocity <= 127).toBe(true)
    }
    const starts = drums.notes.map((n) => n[0])
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it("play the chorus on the ride and the bridge on the toms", () => {
    const drums = drumsOf(site)
    const chorus = drums.notes.filter((n) => n[0] < bridge - 1e-6)
    const inBridge = drums.notes.filter((n) => n[0] >= bridge - 1e-6)
    const [crash, ride, hat, toms, snare, kick] = [0, 1, 2, 3, 4, 5]
    // Four bars: kick on 1 and 3, snare on 2 and 4, the ride in eighths, and
    // a fill of four toms into the bridge.
    expect(count(chorus, kick)).toBe(8)
    expect(count(chorus, snare)).toBe(8)
    expect(count(chorus, ride)).toBe(32)
    expect(count(chorus, hat)).toBe(0)
    expect(count(chorus, toms)).toBe(4)
    expect(count(chorus, crash)).toBe(0)
    expect(chorus.filter((n) => n[2] === toms).every((n) => n[0] >= bridge - beat - 1e-6)).toBe(true)
    // Four bars of the bridge: the crash on the one, toms on every beat and
    // the kick on each bar.
    expect(count(inBridge, crash)).toBe(1)
    expect(inBridge.find((n) => n[2] === crash)![0]).toBeCloseTo(bridge, 6)
    expect(count(inBridge, toms)).toBe(16)
    expect(count(inBridge, kick)).toBe(4)
    expect([ride, hat, snare].map((row) => count(inBridge, row))).toEqual([0, 0, 0])
  })

  it("have the keys in whole octaves, C to B, around what is played", () => {
    const keys = keysOf(site)
    expect(keys.drums).toBe(false)
    expect(keys.low % 12).toBe(0)
    expect(keys.high % 12).toBe(11)
    const pitches = keys.notes.map((n) => n[2])
    expect(Math.min(...pitches)).toBeGreaterThanOrEqual(keys.low)
    expect(Math.min(...pitches)).toBeLessThan(keys.low + 12)
    expect(Math.max(...pitches)).toBeLessThanOrEqual(keys.high)
    expect(Math.max(...pitches)).toBeGreaterThan(keys.high - 12)
    for (const [start, length, pitch, velocity] of keys.notes) {
      expect(start).toBeGreaterThanOrEqual(site.from - 1e-6)
      expect(start).toBeLessThan(site.to)
      expect(length).toBeGreaterThan(0)
      expect(Number.isInteger(pitch)).toBe(true)
      expect(Number.isInteger(velocity) && velocity >= 1 && velocity <= 127).toBe(true)
    }
    const starts = keys.notes.map((n) => n[0])
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })

  it("have the keys stab the chorus on every beat and hold chords through the bridge", () => {
    const keys = keysOf(site)
    const chorus = keys.notes.filter((n) => n[0] < bridge - 1e-6)
    const inBridge = keys.notes.filter((n) => n[0] >= bridge - 1e-6)
    expect(chorus.every((n) => n[1] < bar)).toBe(true)
    const beats = new Set(chorus.map((n) => Math.round((n[0] - site.from) / beat)))
    expect([...beats].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i))
    expect(inBridge.length).toBeGreaterThan(0)
    expect(inBridge.every((n) => n[1] > bar)).toBe(true)
    const bars = new Set(inBridge.map((n) => Math.round((n[0] - bridge) / bar)))
    expect([...bars].sort()).toEqual([0, 2])
  })

  it("come from the song's form: a longer intro moves them, and they stay the same", () => {
    const longer = band.replace("['intro', 8]", "['intro', 10]")
    expect(longer).not.toBe(band)
    const moved = run(longer)
    const by = 2 * bar
    expect(moved.__SITE_NOTES__.from).toBeCloseTo(site.from + by, 6)
    // Relative to the window's start, each note is where it was.
    const shape = (s: SiteNotes) =>
      s.lanes.map((l) =>
        (l.notes as { notes: Played[] }).notes.map(([t, d, at, v]) => [
          Math.round((t - s.from) * 1000),
          Math.round(d * 1000),
          at,
          v,
        ])
      )
    expect(shape(moved.__SITE_NOTES__)).toEqual(shape(site))
  })
})

describe("the band, with the notes laid over it", () => {
  const { api } = run().pywebview

  it("is still the four who play the audio, with no MIDI of their own", async () => {
    const { tracks } = await api.load_default_tracks()
    expect(tracks.map((t: { name: string }) => t.name)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
    for (const t of tracks) {
      expect(t.mode).toBeUndefined()
      expect(t.midi_port).toBeUndefined()
    }
  })

  it("has every rehearsal's takes as four tracks of audio and no notes", async () => {
    const { takes } = await api.get_rehearsal("/rec/tue")
    for (const take of takes) {
      expect(take.tracks.map((t: { name: string }) => t.name)).toEqual(["Drums", "Bass", "Guitar", "Vocals"])
      expect(take.notes).toBeUndefined()
    }
  })
})
