import { readFileSync } from "node:fs"
import { afterEach, expect, test, vi } from "vitest"
import { createEncoder } from "wasm-media-encoders"
import { addInto, gainsOf, makeMix, mixName, turnDown, type Heard, type MixWays } from "./mix"
import { parseFrames } from "./mp3"

const NAMES = ["Drums", "Bass", "Guitar", "Vocals"]
const heard = (h: Partial<Heard> = {}): Heard => ({ volumes: {}, muted: [], soloed: null, ...h })

test("each track is at its level; a muted one, or one left out by S, is not in the mix", () => {
  expect(gainsOf(NAMES, heard({ volumes: { Guitar: 0.8, Vocals: 0.5 } }))).toEqual([1, 1, 0.8, 0.5])
  expect(gainsOf(NAMES, heard({ muted: ["Bass", "Vocals"] }))).toEqual([1, 0, 1, 0])
  expect(gainsOf(NAMES, heard({ soloed: "Guitar", muted: ["Guitar"], volumes: { Guitar: 0.7 } }))).toEqual([0, 0, 0.7, 0])
})

test("the file is called after the take, and after what was left out", () => {
  expect(mixName("Viasna 12", NAMES, heard({ volumes: { Bass: 0.3 } }))).toBe("Viasna 12.mp3")
  expect(mixName("Viasna 12", NAMES, heard({ muted: ["Vocals", "Bass"] }))).toBe("Viasna 12 - without Bass, Vocals.mp3")
  expect(mixName("Viasna 12", NAMES, heard({ soloed: "Guitar", muted: ["Bass"] }))).toBe("Viasna 12 - only Guitar.mp3")
})

test("mono tracks add into one side; a stereo track makes the mix stereo; a longer one makes it longer", () => {
  let mix = addInto([], [Float32Array.of(0.1, 0.2)], 1)
  mix = addInto(mix, [Float32Array.of(0.1, 0.1)], 0.5)
  expect(mix).toHaveLength(1)
  expect([...mix[0]].map((v) => +v.toFixed(3))).toEqual([0.15, 0.25])

  mix = addInto(mix, [Float32Array.of(0.1, 0, 0.2), Float32Array.of(0, 0.1, 0.4)], 1)
  expect(mix).toHaveLength(2)
  expect([...mix[0]].map((v) => +v.toFixed(3))).toEqual([0.25, 0.25, 0.2])
  expect([...mix[1]].map((v) => +v.toFixed(3))).toEqual([0.15, 0.35, 0.4])

  // A mono track after that goes into both sides.
  mix = addInto(mix, [Float32Array.of(0.1)], 1)
  expect(+mix[0][0].toFixed(3)).toBe(0.35)
  expect(+mix[1][0].toFixed(3)).toBe(0.25)
})

test("a mix over full scale is turned down to just under it; one under it is left alone", () => {
  const loud = [Float32Array.of(0.5, -1.94), Float32Array.of(0.97, 0)]
  expect(turnDown(loud)).toBeCloseTo(0.5)
  expect(Math.abs(loud[0][1])).toBeCloseTo(0.97)
  expect(loud[1][0]).toBeCloseTo(0.485)

  const quiet = [Float32Array.of(0.2, -0.5)]
  expect(turnDown(quiet)).toBe(1)
  expect([...quiet[0]]).toEqual([Float32Array.of(0.2)[0], -0.5])
})

// A take's tracks as the page fetches them; the decoder is a stand-in that
// gives each file a second of a sine, louder for each track.
const MP3 = readFileSync(new URL("../../../test/fixtures/t1.mp3", import.meta.url))
const take = { tracks: NAMES.map((name, i) => ({ position: i + 1, name, icon: null, mp3: `/files/t/1/${i + 1}.mp3`, peaks: "" })) }
const fetched: string[] = []
afterEach(() => {
  fetched.length = 0
  vi.unstubAllGlobals()
})
const serve = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(url)
      return new Response(MP3)
    })
  )
const sine = (rate: number, loud: number) => Float32Array.from({ length: rate }, (_, i) => loud * Math.sin((2 * Math.PI * 440 * i) / rate))
const wasm = readFileSync(new URL("../../../node_modules/wasm-media-encoders/wasm/mp3.wasm", import.meta.url))
const ways = (decoded: number[] = []): MixWays => ({
  decode: async (_, rate) => [sine(rate, 0.3 * (decoded.push(rate), decoded.length))],
  encoder: () => createEncoder("audio/mpeg", wasm),
  pause: async () => {},
})

test("the mix fetches only the tracks heard, at the first track's rate, and is an MP3", async () => {
  serve()
  const rates: number[] = []
  const done: number[] = []
  const blob = await makeMix(take, heard({ muted: ["Bass"] }), { ways: ways(rates), progress: (d) => done.push(d) })
  expect(fetched).toEqual(["/files/t/1/1.mp3", "/files/t/1/3.mp3", "/files/t/1/4.mp3"])
  const rate = parseFrames(new Uint8Array(MP3)).sampleRate
  expect(rates).toEqual([rate, rate, rate])
  expect(blob.type).toBe("audio/mpeg")
  const mp3 = parseFrames(new Uint8Array(await blob.arrayBuffer()))
  expect(mp3.sampleRate).toBe(rate)
  expect(mp3.channels).toBe(2)
  // A second of sound, in frames of 1152 samples.
  expect(mp3.frames.length).toBeGreaterThanOrEqual(Math.floor(rate / 1152))
  expect(done.at(-1)).toBe(1)
  expect(done).toEqual([...done].sort((a, b) => a - b))
})

test("with nothing heard there is no mix, and a stop stops it", async () => {
  serve()
  await expect(makeMix(take, heard({ soloed: "Keys" }), { ways: ways() })).rejects.toThrow("No track is heard")
  const stop = new AbortController()
  const going = makeMix(take, heard(), { ways: ways(), signal: stop.signal, progress: () => stop.abort() })
  await expect(going).rejects.toThrow("The mix was stopped")
})
