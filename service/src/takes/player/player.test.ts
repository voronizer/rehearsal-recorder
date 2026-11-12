import { readFileSync } from "node:fs"
import { afterEach, expect, test, vi } from "vitest"
import { Player } from "./player"

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test/fixtures/${name}`, import.meta.url)))

/**
 * A decoder as far as these tests need one: each MP3 frame comes out as
 * 1152 samples of one value, its frame's number plus one, over a thousand;
 * configured for two channels, the right side is half the left.
 */
class FakeDecoder {
  decodeQueueSize = 0
  private channels = 1
  constructor(private readonly init: { output: (data: unknown) => void }) {}
  configure(config: { numberOfChannels: number }) {
    this.channels = config.numberOfChannels
  }
  decode(chunk: { timestamp: number }) {
    const frame = Math.round((chunk.timestamp * 48000) / 1e6 / 1152)
    this.init.output({
      numberOfFrames: 1152,
      numberOfChannels: this.channels,
      copyTo: (plane: Float32Array, to: { planeIndex: number }) => plane.fill((frame + 1) / 1000 / (to.planeIndex + 1)),
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

// t1.mp3: 418 frames of mono at 48 kHz, 10.032 s; t7.mp3, the same length in stereo.
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
  expect(wave.map((row) => row.map((v) => Math.round(v * 1000) / 1000))).toEqual([[0.032, 0.042, 0.053, 0.063]])
})

test("zoomed in, a stereo file's wave has a row a side when the take's wave has two, else the louder side", async () => {
  withDecoder()
  vi.stubGlobal("fetch", async () => new Response(fixture("t7.mp3")))
  const p = new Player([{ url: "t7.mp3", gain: 1 }])
  const round = (rows: number[][] | null) => rows!.map((row) => row.map((v) => Math.round(v * 10000) / 10000))
  // The right side is half the left: 0.032 on the left, 0.016 on the right.
  expect(round(await p.stretch(0, 0.5, 1.5, 4, undefined, 2))).toEqual([
    [0.032, 0.042, 0.053, 0.063],
    [0.016, 0.021, 0.0265, 0.0315],
  ])
  expect(round(await p.stretch(0, 0.5, 1.5, 4))).toEqual([[0.032, 0.042, 0.053, 0.063]])
})

test("a mono file asked for two rows has its one side in both", async () => {
  withDecoder()
  vi.stubGlobal("fetch", async () => new Response(fixture("t1.mp3")))
  const p = new Player([{ url: "t1.mp3", gain: 1 }])
  const [left, right] = (await p.stretch(0, 0.5, 1.5, 4, undefined, 2))!
  expect(right).toEqual(left)
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

/** A node of the fake sound: what it is joined to, from which output, its gain as last set, what a meter reads, and whether it was let go. */
class FakeNode {
  readonly to: unknown[] = []
  readonly outputs: (number | undefined)[] = []
  fftSize = 0
  reads = 0
  gone = false
  gain = { value: 1, setTargetAtTime: (v: number) => void (this.gain.value = v) }
  connect(node: unknown, output?: number) {
    this.to.push(node)
    this.outputs.push(output)
    return node
  }
  disconnect() {
    this.gone = true
  }
  getFloatTimeDomainData(wave: Float32Array) {
    wave.fill(this.reads)
  }
}

class FakeBuffer {
  private readonly data: Float32Array[]
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }
  get duration() {
    return this.length / this.sampleRate
  }
  getChannelData(c: number) {
    return this.data[c]
  }
}

/** Web Audio as far as the player needs it: every gain, splitter and meter made, and where each goes. */
class FakeSound {
  static made: FakeNode[] = []
  static meters: FakeNode[] = []
  static splitters: FakeNode[] = []
  readonly destination = { speakers: true }
  currentTime = 0
  async resume() {}
  createGain() {
    const g = new FakeNode()
    FakeSound.made.push(g)
    return g
  }
  createAnalyser() {
    const m = new FakeNode()
    FakeSound.meters.push(m)
    return m
  }
  createChannelSplitter() {
    const s = new FakeNode()
    FakeSound.splitters.push(s)
    return s
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new FakeBuffer(channels, length, rate)
  }
  createBufferSource() {
    return { buffer: null, onended: null, connect() {}, start() {}, stop() {} }
  }
}

test("Master's level is on the whole take as it goes out: set before it plays, and turned while it does", () => {
  withDecoder()
  vi.stubGlobal("AudioContext", FakeSound)
  vi.stubGlobal("fetch", () => new Promise(() => {}))
  const p = new Player([{ url: "t1.mp3", gain: 1 }, { url: "t2.mp3", gain: 0.8 }])
  expect(p.masterVolume).toBe(1)
  p.setMaster(0.5)
  expect(p.masterVolume).toBe(0.5)
  p.play(0)
  // The gain that goes to the speakers: the tracks' own gains go to it.
  const out = FakeSound.made.findLast((n) => n.to.some((t) => (t as { speakers?: boolean }).speakers))!
  expect(out.gain.value).toBe(0.5)
  expect(FakeSound.made.filter((n) => n.to.includes(out))).toHaveLength(2)
  p.setMaster(0.25)
  expect(out.gain.value).toBe(0.25)
  p.setMaster(3)
  expect(out.gain.value).toBe(1)
  p.setMaster(-1)
  expect(p.masterVolume).toBe(0)
  // The whole mix's meter is after Master; with no sound come yet, it reads 0, as a meter at rest does.
  expect(out.to.some((n) => FakeSound.meters.includes(n as FakeNode))).toBe(true)
  expect(p.mixLoudness()).toBe(0)
  p.close()
})

test("a stereo track's level is two numbers, left then right, after its level; a mono track's is one; closed, all let go", async () => {
  withDecoder()
  vi.stubGlobal("AudioContext", FakeSound)
  vi.stubGlobal("fetch", async (url: string) => new Response(fixture(url)))
  const p = new Player([{ url: "t7.mp3", gain: 1 }, { url: "t1.mp3", gain: 1 }])
  p.play(0)
  // Each track's gain goes to a splitter, and each of its two outputs to a meter of its own.
  const splitters = FakeSound.splitters.slice(-2)
  const gains = FakeSound.made.filter((g) => splitters.some((s) => g.to.includes(s)))
  expect(gains).toHaveLength(2)
  const sides = splitters.map((s) => s.to as FakeNode[])
  for (const s of splitters) expect(s.outputs).toEqual([0, 1])
  sides[0][0].reads = 0.5
  sides[0][1].reads = 0.25
  sides[1][0].reads = 0.75
  await vi.waitFor(() => expect(p.waiting).toBe(false))
  expect(p.loudness()).toEqual([[0.5, 0.25], [0.75]])
  // Paused, each side reads 0.
  p.pause()
  expect(p.loudness()).toEqual([[0, 0], [0]])
  // Closed, no node of the take stays joined to the sound the next take plays through.
  p.close()
  expect([...gains, ...splitters, ...sides.flat()].filter((n) => !n.gone)).toEqual([])
})
