import { afterEach, describe, expect, it, vi } from "vitest"
import { pythonSound } from "@/lib/playerSound"

// Python, as far as the player's sound reaches it.
const bridge = vi.hoisted(() => ({
  player_open: vi.fn(async () => ({ ok: true })),
  player_close: vi.fn(async () => ({ ok: true })),
  player_state: vi.fn(async () => ({ open: true, playing: false })),
  player_play: vi.fn(async () => ({ ok: true })),
  player_pause: vi.fn(async () => ({ ok: true })),
  player_toggle: vi.fn(async () => ({ ok: true })),
  player_seek: vi.fn(async () => ({ ok: true })),
  player_set_loop: vi.fn(async () => ({ ok: true })),
  player_set_muted: vi.fn(async () => ({ ok: true })),
  player_set_solo: vi.fn(async () => ({ ok: true })),
  player_set_volume: vi.fn(async () => ({ ok: true })),
  player_set_master: vi.fn(async () => ({ ok: true })),
  take_media: vi.fn(async () => []),
  save_mix: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/lib/api", () => ({
  api: () => bridge,
  poll: (name: "player_state") => bridge[name](),
}))

afterEach(() => vi.clearAllMocks())

const tracks = [{ name: "Bass", file: "/rec/t1/bass.wav" }]

describe("pythonSound", () => {
  it("opens and closes a take with Python's player", async () => {
    await pythonSound.open(tracks, true)
    await pythonSound.close()
    expect(bridge.player_open).toHaveBeenCalledWith(tracks, true)
    expect(bridge.player_close).toHaveBeenCalled()
  })

  it("asks Python for the waves of a stretch when zoomed in", async () => {
    await pythonSound.media(tracks, undefined, 3, 4)
    expect(bridge.take_media).toHaveBeenCalledWith(tracks, undefined, 3, 4)
  })

  it("reads the state by the same poll as before", async () => {
    await pythonSound.state()
    expect(bridge.player_state).toHaveBeenCalled()
  })

  it("sends each control to its bridge call", async () => {
    await pythonSound.play()
    await pythonSound.pause()
    await pythonSound.toggle()
    await pythonSound.seek(12)
    await pythonSound.setLoop(1, 2)
    await pythonSound.setMuted("Bass", true)
    await pythonSound.setSolo(null)
    await pythonSound.setVolume("Bass", 0.5)
    await pythonSound.setMaster(0.8)
    expect(bridge.player_play).toHaveBeenCalled()
    expect(bridge.player_pause).toHaveBeenCalled()
    expect(bridge.player_toggle).toHaveBeenCalled()
    expect(bridge.player_seek).toHaveBeenCalledWith(12)
    expect(bridge.player_set_loop).toHaveBeenCalledWith(1, 2)
    expect(bridge.player_set_muted).toHaveBeenCalledWith("Bass", true)
    expect(bridge.player_set_solo).toHaveBeenCalledWith(null)
    expect(bridge.player_set_volume).toHaveBeenCalledWith("Bass", 0.5)
    expect(bridge.player_set_master).toHaveBeenCalledWith(0.8)
  })

  it("keeps the levels in the app's settings", async () => {
    await pythonSound.keepLevels({ Bass: 0.5 })
    expect(bridge.save_mix).toHaveBeenCalledWith({ Bass: 0.5 })
  })
})
