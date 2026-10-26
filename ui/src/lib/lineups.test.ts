import { describe, expect, it } from "vitest"
import type { Track } from "@/lib/api"
import { sameTracks } from "@/lib/lineups"

const band: Track[] = [
  { name: "Drums", icon: "drums", channel: 1, stereo: true },
  { name: "Bass", icon: "bass", channel: 3 },
  { name: "Keys", icon: "keys", channel: 4, mode: "both", midi_port: { name: "Nord" } },
]

function edited(at: number, change: Partial<Track>): Track[] {
  return band.map((t, i) => (i === at ? { ...t, ...change } : t))
}

// The title over the tracks says "changed" when the screen is no longer the
// lineup that was picked. Only what the person can change on screen counts.
describe("sameTracks", () => {
  it("is the same for the same tracks", () => {
    expect(sameTracks(band, band.map((t) => ({ ...t })))).toBe(true)
  })

  it("is the same whether a default is written or left out", () => {
    expect(sameTracks(edited(1, { stereo: false }), band)).toBe(true)
    expect(sameTracks(edited(0, { mode: "audio" }), band)).toBe(true)
  })

  it("is the same with a space after a name", () => {
    expect(sameTracks(edited(1, { name: "Bass " }), band)).toBe(true)
  })

  it("differs when the order changes", () => {
    expect(sameTracks([band[1], band[0], band[2]], band)).toBe(false)
  })

  it("differs when a track goes", () => {
    expect(sameTracks(band.slice(0, 2), band)).toBe(false)
  })

  it("differs on a name, an icon or an input", () => {
    expect(sameTracks(edited(1, { name: "Bass 2" }), band)).toBe(false)
    expect(sameTracks(edited(1, { icon: "guitar" }), band)).toBe(false)
    expect(sameTracks(edited(1, { channel: 5 }), band)).toBe(false)
    expect(sameTracks(edited(1, { channel: null }), band)).toBe(false)
    expect(sameTracks(edited(0, { stereo: false }), band)).toBe(false)
  })

  it("differs on Both against Audio, and on another port", () => {
    expect(sameTracks(edited(2, { mode: "audio" }), band)).toBe(false)
    expect(sameTracks(edited(2, { midi_port: { name: "Juno" } }), band)).toBe(false)
    expect(sameTracks(edited(2, { midi_port: null }), band)).toBe(false)
  })
})
