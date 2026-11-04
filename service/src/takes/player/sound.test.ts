import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { TakePage } from "../../api"
import type { One } from "./one"
import type { Player } from "./player"

// The service's API as the sound reaches it: your levels, the take's `.peaks`.
const api = vi.hoisted(() => ({
  yours: {} as Record<string, number>,
  keepLevels: vi.fn(async (_: Record<string, number | null>) => ({ levels: {} })),
}))
vi.mock("../../api", () => ({
  keepLevels: api.keepLevels,
  levelsQuery: { queryKey: ["levels"] },
  peaksQuery: (path: string) => ({ queryKey: ["peaks", path] }),
  queryClient: {
    getQueryData: () => ({ levels: api.yours }),
    fetchQuery: async () => Array.from({ length: 1200 }, () => 0.5),
  },
}))
// The page's hooks are not used here: only the sound itself.
vi.mock("./one", () => ({ useOne: () => null }))
// Master's level on this device.
const device = vi.hoisted(() => ({ kept: [] as number[] }))
vi.mock("./master", () => ({ keepMaster: (v: number) => void device.kept.push(v) }))

const { serviceSound } = await import("./sound")

const take = {
  uid: "t1",
  gen: 1,
  duration_sec: 100,
  balance: { Guitar: 0.8 },
  tracks: [
    { name: "Bass", mp3: "/bass.mp3", peaks: "/bass.peaks" },
    { name: "Guitar", mp3: "/guitar.mp3", peaks: "/guitar.peaks" },
  ],
} as unknown as TakePage

/** The take's Player, as far as the sound reads it. */
const player = (over: Partial<Record<keyof Player, unknown>> = {}) =>
  ({
    playing: false,
    waiting: false,
    repeat: null,
    soloed: null,
    time: () => 3,
    isMuted: () => false,
    gain: () => 1,
    loudness: () => [0, 0],
    setGain: vi.fn(),
    setLoop: vi.fn(),
    seek: vi.fn(),
    stretch: vi.fn(async () => [1, 2, 3]),
    ...over,
  }) as unknown as Player

/** The one player, with this take in it or not, and how loud it all comes out. */
const one = (p: Player | null, out = 0): One => ({
  playerOf: () => p,
  comingOf: () => null,
  play: vi.fn(),
  pause: vi.fn(),
  cue: vi.fn(),
  setMute: vi.fn(),
  setSolo: vi.fn(),
  master: () => 0.6,
  setMaster: vi.fn(),
  mixLoudness: () => out,
  ready: () => () => {},
})

beforeEach(() => {
  api.yours = {}
  api.keepLevels.mockClear()
  device.kept = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A kick at the start, let go half a second later: 960 ticks to the beat at 120. */
const KICK = new Uint8Array([
  ...[0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x03, 0xc0],
  ...[0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 13],
  ...[0x00, 0x99, 36, 100, 0x87, 0x40, 0x89, 36, 0, 0x00, 0xff, 0x2f, 0],
])

test("a take's notes are read on the page from its .mid", async () => {
  const asked: string[] = []
  vi.stubGlobal("fetch", async (url: string) => {
    asked.push(url)
    return new Response(KICK)
  })
  const notes = await serviceSound(take, one(null)).notes([{ name: "Drums", file: "/files/t1/1/3.mid", icon: "drums" }])
  expect(asked).toEqual(["/files/t1/1/3.mid"])
  expect(notes).toEqual([{ name: "Drums", icon: "drums", drums: true, rows: ["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"], notes: [[0, 0.5, 5, 100]] }])
})

test("a .mid that is not there, or is no .mid, says so in its lane", async () => {
  vi.stubGlobal("fetch", async (url: string) =>
    url.endsWith("3.mid") ? new Response("gone", { status: 404 }) : new Response("<html>a page</html>")
  )
  const notes = await serviceSound(take, one(null)).notes([
    { name: "Drums", file: "/files/t1/1/3.mid" },
    { name: "Keys", file: "/files/t1/1/4.mid" },
    { name: "Pads", file: null },
  ])
  expect(notes).toEqual([
    { name: "Drums", error: "Notes file not found" },
    { name: "Keys", error: "Notes file not readable" },
    { name: "Pads", error: "Notes file not found" },
  ])
})

test("while the files come, the take shows as playing and its playhead waits", async () => {
  const sound = serviceSound(take, one(player({ playing: true, waiting: true })))
  expect(await sound.state()).toMatchObject({ playing: true, waiting: true, position: 3 })
  const going = serviceSound(take, one(player({ playing: true })))
  expect(await going.state()).toMatchObject({ playing: true, waiting: false })
})

test("leaving the page lets go of the repeat, and the take plays on in the bar", async () => {
  const p = player({ playing: true, repeat: { a: 10, b: 20 } })
  const o = one(p)
  await serviceSound(take, o).close()
  expect(p.setLoop).toHaveBeenCalledWith(null, null)
  expect(o.pause).not.toHaveBeenCalled()
})

test("leaving the page of a take that is not in the player changes nothing", async () => {
  const o = one(null)
  expect(await serviceSound(take, o).close()).toEqual({ ok: true })
  expect(o.pause).not.toHaveBeenCalled()
})

test("a zoom the take's .peaks can draw does not decode the MP3", async () => {
  const p = player()
  const sound = serviceSound(take, one(p))
  // Half the take: 600 of the 1200 points, enough for 900 slices drawn.
  const wide = await sound.media(sound.tracks, 900, 20, 70)
  expect(p.stretch).not.toHaveBeenCalled()
  expect(wide[0].peaks[0]).toHaveLength(600)
  // A third of it: 400 points would show, so the MP3 is decoded.
  const close = await sound.media(sound.tracks, 900, 20, 50)
  expect(p.stretch).toHaveBeenCalledTimes(2)
  expect(close[0].peaks[0]).toEqual([1, 2, 3])
})

test("a newer zoom stops the stretch before it", async () => {
  const signals: AbortSignal[] = []
  const p = player({
    stretch: vi.fn((_i: number, _f: number, _t: number, _b: number, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise((done) => signal.addEventListener("abort", () => done(null)))
    }),
  })
  const sound = serviceSound(take, one(p))
  const first = sound.media(sound.tracks, 900, 10, 20)
  expect(signals).toHaveLength(2)
  void sound.media(sound.tracks, 900, 12, 22)
  expect(signals.slice(0, 2).every((s) => s.aborted)).toBe(true)
  expect(signals.slice(2).some((s) => s.aborted)).toBe(false)
  // The stopped one gives the coarse wave, which the player throws away.
  expect((await first)[0].peaks[0].length).toBeGreaterThan(0)
})

test("only the tracks that were turned are kept as yours", async () => {
  const sound = serviceSound(take, one(player()))
  // Bass at 1 and the guitar at its balance: nothing turned.
  expect(await sound.keepLevels({ Bass: 1, Guitar: 0.8 })).toEqual({ ok: true })
  expect(api.keepLevels).not.toHaveBeenCalled()
  await sound.keepLevels({ Bass: 1, Guitar: 0.5, Keys: 0.2 })
  expect(api.keepLevels).toHaveBeenCalledWith({ Guitar: 0.5 })
})

test("REHA's levels forgets yours for this take's tracks", async () => {
  api.yours = { Bass: 0.4, Vocals: 0.9 }
  await serviceSound(take, one(player())).backToReha()
  expect(api.keepLevels).toHaveBeenCalledWith({ Bass: null, Guitar: null })
})

test("repeat, M and S set while another take plays go with the take when it plays", async () => {
  const sound = serviceSound(take, one(null))
  await sound.setLoop(2, 5)
  await sound.setMuted("Bass", true)
  await sound.setSolo("Guitar")
  expect(sound.setup()).toEqual({ loop: { a: 2, b: 5 }, muted: [0], solo: 1 })
  expect(await sound.state()).toMatchObject({ position: 2, loop: { a: 2, b: 5 }, muted: ["Bass"], soloed: "Guitar" })
})

test("M and S on one track take each other off while another take plays, as they do in the player", async () => {
  const sound = serviceSound(take, one(null))
  await sound.setMuted("Bass", true)
  await sound.setSolo("Bass")
  expect(sound.setup()).toMatchObject({ muted: [], solo: 0 })
  await sound.setMuted("Bass", true)
  expect(sound.setup()).toMatchObject({ muted: [0], solo: null })
})

test("Master's level comes with the take as it opens, and a poll leaves the fader where the hand has it", async () => {
  const sound = serviceSound(take, one(player({ playing: true })))
  expect(await sound.open(sound.tracks)).toMatchObject({ master: 0.6 })
  expect(await sound.state()).not.toHaveProperty("master")
})

test("Master is the one player's, on every take: turned, it is heard on the take that plays", async () => {
  const o = one(null)
  expect(await serviceSound(take, o).setMaster(0.3)).toEqual({ ok: true })
  expect(o.setMaster).toHaveBeenCalledWith(0.3)
})

test("Master's meter is what comes out, whichever take plays", async () => {
  // Another take in the player: this one's tracks are quiet, and Master shows the other.
  expect(await serviceSound(take, one(null, 0.4)).state()).toMatchObject({ levels: {}, master_level: 0.4 })
  expect(await serviceSound(take, one(player({ playing: true }), 0.55)).state()).toMatchObject({ master_level: 0.55 })
})

test("Master's level let go is kept on this device and on the take that plays, opened or not", async () => {
  const o = one(null)
  expect(await serviceSound(take, o).keepMaster(0.35)).toEqual({ ok: true })
  expect(device.kept).toEqual([0.35])
  expect(o.setMaster).toHaveBeenCalledWith(0.35)
})
