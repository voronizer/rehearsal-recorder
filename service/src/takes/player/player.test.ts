import { readFileSync } from "node:fs"
import { afterEach, expect, test, vi } from "vitest"
import { Player } from "./player"

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url)))

/**
 * A decoder as far as these tests need one: each MP3 frame comes out as
 * 1152 samples of one value, its frame's number plus one, over a thousand.
 */
class FakeDecoder {
  constructor(private readonly init: { output: (data: unknown) => void }) {}
  configure() {}
  decode(chunk: { timestamp: number }) {
    const frame = Math.round((chunk.timestamp * 48000) / 1e6 / 1152)
    this.init.output({
      numberOfFrames: 1152,
      numberOfChannels: 1,
      copyTo: (plane: Float32Array) => plane.fill((frame + 1) / 1000),
      close() {},
    })
  }
  async flush() {}
  close() {}
}

class FakeChunk {
  readonly timestamp: number
  constructor(init: { timestamp: number }) {
    this.timestamp = init.timestamp
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// t1.mp3: 418 frames of mono at 48 kHz, 10.032 s.
const T1_END = (418 * 1152) / 48000

const withDecoder = () => {
  vi.stubGlobal("AudioDecoder", FakeDecoder)
  vi.stubGlobal("EncodedAudioChunk", FakeChunk)
}

test("a playhead put past the repeated piece while paused stays where it was put", () => {
  const p = new Player([{ url: "t1.mp3", gain: 1 }])
  p.setLoop(10, 20)
  p.seek(25)
  expect(p.time()).toBe(25)
  p.seek(29)
  expect(p.time()).toBe(29)
  p.seek(15)
  expect(p.time()).toBe(15)
})

test("a repeat over the whole take ends where the file ends", async () => {
  withDecoder()
  vi.stubGlobal("fetch", async () => new Response(fixture("t1.mp3")))
  const p = new Player([{ url: "t1.mp3", gain: 1 }])
  // Asking for a stretch past the end waits until the whole file has come.
  await p.stretch(0, 0, 60, 10)
  p.setLoop(2, 12)
  expect(p.repeat).toEqual({ a: 2, b: T1_END })
})

test("a stretch's wave is the loudest sample in each slice, read as it is decoded", async () => {
  withDecoder()
  vi.stubGlobal("fetch", async () => new Response(fixture("t1.mp3")))
  const p = new Player([{ url: "t1.mp3", gain: 1 }])
  // 0.5 s to 1.5 s is samples 24000 to 72000, four slices of 12000: the last
  // frame in each is 31, 41, 52 and 62.
  const wave = (await p.stretch(0, 0.5, 1.5, 4))!
  expect(wave.map((v) => Math.round(v * 1000) / 1000)).toEqual([0.032, 0.042, 0.053, 0.063])
})

test("a file comes a piece at a time, only as far as it is wanted", async () => {
  withDecoder()
  const file = fixture("t1.mp3")
  const asked: string[] = []
  vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string> }) => {
    const range = init.headers.Range
    asked.push(range)
    const [from, to] = /bytes=(\d+)-(\d+)/.exec(range)!.slice(1).map(Number)
    const last = Math.min(to, file.length - 1)
    return new Response(file.slice(from, last + 1), { status: 206, headers: { "Content-Range": `bytes ${from}-${last}/${file.length}` } })
  })
  // Pieces of about a second; two seconds past the playhead.
  const p = new Player([{ url: "t1.mp3", gain: 1 }], { aheadSec: 2, pieceBytes: 16 * 1024 })
  await p.stretch(0, 0, 1, 4)
  expect(asked).toEqual(["bytes=0-16383", "bytes=16384-32767"])

  // Moved on to the end, it goes on from where it stopped and no further.
  await p.stretch(0, 0, 60, 4)
  expect(asked).toHaveLength(Math.ceil(file.length / (16 * 1024)))
  expect(asked.at(-1)).toBe(`bytes=${9 * 16 * 1024}-${file.length - 1}`)
  p.setLoop(2, 12)
  expect(p.repeat).toEqual({ a: 2, b: T1_END })
})

test("a stretch no longer wanted gives up waiting for its file", async () => {
  withDecoder()
  vi.stubGlobal("fetch", () => new Promise(() => {}))
  const p = new Player([{ url: "t1.mp3", gain: 1 }])
  const wanted = new AbortController()
  const wave = p.stretch(0, 0, 5, 10, wanted.signal)
  wanted.abort()
  expect(await wave).toBeNull()
})
