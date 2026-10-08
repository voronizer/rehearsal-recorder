import { describe, expect, it } from "vitest"
import type { DemoApi } from "../stage/demo"
import { silence } from "./silence"

/** The fake as far as these calls go: every take is 6 s of something. */
function stub(): DemoApi {
  let open = false
  return {
    take_media: async (tracks: { name: string; file: string }[]) =>
      tracks.map((t) => ({
        name: t.name,
        url: "about:blank",
        frames: 48000 * 6,
        samplerate: 48000,
        duration_sec: 6,
        peaks: [[0.5, 0.9, 0.2]],
      })),
    player_open: async () => ((open = true), { ok: true, open: true, playing: false, position: 0, duration: 6 }),
    player_state: async () => (open ? { ok: true, open: true, playing: false, position: 0, duration: 6 } : { open: false }),
    player_close: async () => ((open = false), { ok: true }),
  }
}

const SILENT = [
  { name: "Drums", file: "/404/Drums.wav" },
  { name: "Bass", file: "/404/Bass.wav" },
]
const LOUD = [{ name: "Drums", file: "/band/take-2/Drums.wav" }]

describe("silence", () => {
  it("gives the takes under its folder flat peaks and its length", async () => {
    const api = stub()
    silence(api, "/404/", 244)
    const media = await api.take_media(SILENT)
    expect(media).toHaveLength(2)
    for (const m of media) {
      expect(m.duration_sec).toBe(244)
      expect(m.frames).toBe(48000 * 244)
      expect(m.peaks.flat().every((v: number) => v === 0)).toBe(true)
      expect(m.peaks[0]).toHaveLength(3)
    }
  })

  it("leaves every other take as the fake has it", async () => {
    const api = stub()
    const before = await stub().take_media(LOUD)
    silence(api, "/404/", 244)
    expect(await api.take_media(LOUD)).toEqual(before)
  })

  it("plays the silent take at its length, and others at theirs", async () => {
    const api = stub()
    silence(api, "/404/", 244)
    expect((await api.player_open(SILENT)).duration).toBe(244)
    expect((await api.player_state()).duration).toBe(244)
    await api.player_close()
    expect((await api.player_open(LOUD)).duration).toBe(6)
    expect((await api.player_state()).duration).toBe(6)
  })
})
