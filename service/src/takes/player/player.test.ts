import { readFileSync } from "node:fs"
import { afterEach, expect, test, vi } from "vitest"
import { Player } from "./player"
import type { Stretch } from "./stretch"

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
    this.to.length = 0
    this.outputs.length = 0
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
  /** Every piece started: when on the clock, from where in it, at what rate, how long it is, and the rate its buffer says. */
  static started: { when: number; offset: number; rate: number; duration: number; sampleRate: number }[] = []
  /** The one sound the service makes; the tests move its clock. */
  static last: FakeSound | null = null
  /** The speakers' rate: as the test files' unless a test says otherwise. The one sound is made once, so it reads this. */
  static rate = 48000
  readonly destination = { speakers: true }
  get sampleRate() {
    return FakeSound.rate
  }
  currentTime = 0
  constructor() {
    FakeSound.last = this
  }
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
    const node = {
      buffer: null as FakeBuffer | null,
      onended: null,
      playbackRate: { value: 1 },
      connect() {},
      start(when: number, offset = 0) {
        FakeSound.started.push({ when, offset, rate: node.playbackRate.value, duration: node.buffer!.duration, sampleRate: node.buffer!.sampleRate })
      },
      stop() {},
    }
    return node
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

test("the take's amount turns every heard track up by the same, on top of its level", () => {
  withDecoder()
  vi.stubGlobal("AudioContext", FakeSound)
  vi.stubGlobal("fetch", () => new Promise(() => {}))
  const p = new Player([{ url: "t1.mp3", gain: 1 }, { url: "t2.mp3", gain: 0.5 }, { url: "t3.mp3", gain: 0.8 }])
  p.setBoost(2)
  p.setMute(2, true)
  p.play(0)
  const splitters = FakeSound.splitters.slice(-3)
  const gains = splitters.map((s) => FakeSound.made.find((g) => g.to.includes(s))!)
  expect(gains.map((g) => g.gain.value)).toEqual([2, 1, 0])
  // The faders still read the level the member set.
  expect([p.gain(0), p.gain(1), p.gain(2)]).toEqual([1, 0.5, 0.8])
  p.setGain(1, 0.25)
  expect(gains[1].gain.value).toBe(0.5)
  p.setBoost(1)
  expect(gains.map((g) => g.gain.value)).toEqual([1, 0.25, 0])
  // A page with no amount plays the take as recorded.
  p.setBoost(Number.NaN)
  expect(gains.map((g) => g.gain.value)).toEqual([1, 0.25, 0])
  p.close()
})

test("a take page's player has each track at its level and the whole take at the page's amount", () => {
  withDecoder()
  vi.stubGlobal("AudioContext", FakeSound)
  vi.stubGlobal("fetch", () => new Promise(() => {}))
  const tracks = [
    { name: "Drums", mp3: "t1.mp3" },
    { name: "Bass", mp3: "t2.mp3" },
  ]
  const p = Player.of({ tracks, gain: 2.5 }, (name) => (name === "Bass" ? 0.4 : 1))
  p.play(0)
  const splitters = FakeSound.splitters.slice(-2)
  const gains = splitters.map((s) => FakeSound.made.find((g) => g.to.includes(s))!)
  expect(gains.map((g) => g.gain.value)).toEqual([2.5, 1])
  expect([p.gain(0), p.gain(1)]).toEqual([1, 0.4])
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

/** A stretch as far as the player needs one: a node, its own delay, and the speeds it was told. */
const fakeStretch = () => {
  const stretch = { node: new FakeNode(), latency: 0.05, setRate: vi.fn() }
  return stretch as typeof stretch & Stretch
}

/** t1.mp3 played from `from` at `rate`, until its first second is placed; `t0` is when the first piece starts on the clock. */
async function playAt(rate: number, from = 0, before?: (p: Player) => void) {
  withDecoder()
  vi.stubGlobal("AudioContext", FakeSound)
  vi.stubGlobal("fetch", async (url: string) => new Response(fixture(url)))
  FakeSound.started = []
  const stretch = fakeStretch()
  const p = new Player([{ url: "t1.mp3", gain: 1 }])
  before?.(p)
  p.setRate(rate, stretch)
  p.play(from)
  await vi.waitFor(() => expect(p.waiting).toBe(false))
  // The track's gain was made last; Master is the gain it goes to.
  const master = FakeSound.made.find((g) => FakeSound.made.at(-1)!.to.includes(g))!
  return { p, stretch, master, sound: FakeSound.last!, t0: FakeSound.started[0].when }
}

/** How much of the take is placed so far, in its own seconds. */
const placed = () => FakeSound.started.reduce((n, s) => n + s.duration, 0)

test("at half speed each piece plays at half its rate, twice as far apart on the clock, and the playhead runs at half", async () => {
  const { p, sound, t0 } = await playAt(0.5)
  const started = FakeSound.started
  expect(started.length).toBeGreaterThan(1)
  expect(started.every((s) => s.rate === 0.5)).toBe(true)
  for (let i = 1; i < started.length; i++) expect(started[i].when - started[i - 1].when).toBeCloseTo(started[i - 1].duration / 0.5, 9)
  // Five seconds of the clock are decoded ahead: two and a half of the take.
  expect(placed()).toBeGreaterThan(2)
  expect(placed()).toBeLessThan(2.6)
  // Two seconds of the clock after the first sound comes out of the stretch, a second of the take is heard.
  sound.currentTime = t0 + 0.05 + 2
  expect(p.time()).toBeCloseTo(1, 9)
  expect(p.speed).toBe(0.5)
  p.close()
})

test("at 1.5 the playhead runs half as fast again", async () => {
  const { p, sound, t0 } = await playAt(1.5)
  const started = FakeSound.started
  expect(started.every((s) => s.rate === 1.5)).toBe(true)
  for (let i = 1; i < started.length; i++) expect(started[i].when - started[i - 1].when).toBeCloseTo(started[i - 1].duration / 1.5, 9)
  expect(placed()).toBeGreaterThan(7)
  expect(placed()).toBeLessThan(7.6)
  sound.currentTime = t0 + 0.05 + 2
  expect(p.time()).toBeCloseTo(3, 9)
  p.close()
})

test("at 1 Master goes straight out and the stretch is not joined", async () => {
  const { p, stretch, master, sound, t0 } = await playAt(1)
  expect(master.to).toContain(sound.destination)
  expect(master.to).not.toContain(stretch.node)
  expect(stretch.node.to).toEqual([])
  expect(stretch.setRate).not.toHaveBeenCalled()
  expect(FakeSound.started.every((s) => s.rate === 1)).toBe(true)
  // No stretch, no delay: the playhead is the clock.
  sound.currentTime = t0 + 2
  expect(p.time()).toBeCloseTo(2, 9)
  p.close()
})

test("at another speed Master goes through the stretch, which is told the speed", async () => {
  const { p, stretch, master, sound } = await playAt(0.75)
  expect(stretch.setRate).toHaveBeenCalledWith(0.75)
  expect(master.to).toContain(stretch.node)
  expect(master.to).not.toContain(sound.destination)
  expect(stretch.node.to).toContain(sound.destination)
  // The whole mix's meter is still after Master.
  expect(master.to.some((n) => FakeSound.meters.includes(n as FakeNode))).toBe(true)
  p.close()
})

test("a speed changed while playing goes on from the same moment", async () => {
  const { p, stretch, master, sound, t0 } = await playAt(1)
  sound.currentTime = t0 + 3
  FakeSound.started = []
  p.setRate(0.5, stretch)
  expect(p.playing).toBe(true)
  expect(p.time()).toBeCloseTo(3, 9)
  await vi.waitFor(() => expect(p.waiting).toBe(false))
  expect(FakeSound.started.every((s) => s.rate === 0.5)).toBe(true)
  expect(master.to).toContain(stretch.node)
  sound.currentTime = FakeSound.started[0].when + 0.05 + 1
  expect(p.time()).toBeCloseTo(3.5, 9)
  // And back to 100%: straight out again, from where it was.
  p.setRate(1, stretch)
  expect(p.time()).toBeCloseTo(3.5, 9)
  expect(master.to).toContain(sound.destination)
  expect(master.to).not.toContain(stretch.node)
  p.close()
})

test("at another speed on speakers slower than the files, each piece says the speakers' rate and plays that much faster, with no gap", async () => {
  // Chrome cuts a slowed piece short when its buffer's rate is above the sound's: a hole after every piece.
  FakeSound.rate = 44100
  const playing: Player[] = []
  try {
    const { p, sound, t0 } = await playAt(0.5)
    playing.push(p)
    const fold = 48000 / 44100
    expect(FakeSound.started.every((s) => s.sampleRate === 44100)).toBe(true)
    expect(FakeSound.started.every((s) => Math.abs(s.rate - 0.5 * fold) < 1e-12)).toBe(true)
    // A piece late for its place starts at once, that much into it.
    sound.currentTime = t0 + 5.5
    await vi.waitFor(() => expect(FakeSound.started.some((s) => s.offset > 0)).toBe(true))
    await vi.waitFor(() => expect(FakeSound.started.at(-1)!.offset).toBe(0))
    const late = FakeSound.started.findIndex((s) => s.offset > 0)
    expect(FakeSound.started[late].when).toBeCloseTo(t0 + 5.51, 9)
    // Each piece ends on the clock where the next one starts, as at the files' own rate.
    const started = FakeSound.started
    for (let i = late; i < started.length - 1; i++)
      expect(started[i].when + (started[i].duration - started[i].offset) / started[i].rate).toBeCloseTo(started[i + 1].when, 9)
    for (let i = 1; i < late; i++) expect(started[i - 1].when + started[i - 1].duration / started[i - 1].rate).toBeCloseTo(started[i].when, 9)
    // The playhead is as at any speed.
    sound.currentTime = t0 + 0.05 + 2
    expect(p.time()).toBeCloseTo(1, 9)
    p.close()
    // At 100% a piece keeps its file's rate, as before the speed was there.
    const { p: q } = await playAt(1)
    playing.push(q)
    expect(FakeSound.started.every((s) => s.sampleRate === 48000 && s.rate === 1)).toBe(true)
  } finally {
    for (const p of playing) p.close()
    FakeSound.rate = 48000
  }
})

/** A decoder that keeps what it is given while `held`, as one fallen behind does, and gives it all out once let go. */
class SlowDecoder extends FakeDecoder {
  static held = false
  static all: SlowDecoder[] = []
  private kept: { timestamp: number }[] = []
  constructor(init: { output: (data: unknown) => void }) {
    super(init)
    SlowDecoder.all.push(this)
  }
  decode(chunk: { timestamp: number }) {
    if (!SlowDecoder.held) return super.decode(chunk)
    this.kept.push(chunk)
    this.decodeQueueSize = this.kept.length
  }
  static letGo() {
    SlowDecoder.held = false
    for (const d of SlowDecoder.all) {
      const kept = d.kept
      d.kept = []
      d.decodeQueueSize = 0
      for (const chunk of kept) FakeDecoder.prototype.decode.call(d, chunk)
    }
  }
}

test("a decoder fallen behind at 150% makes the take wait where it is heard, then go on, not play on in silence", async () => {
  vi.stubGlobal("AudioDecoder", SlowDecoder)
  vi.stubGlobal("EncodedAudioChunk", FakeChunk)
  vi.stubGlobal("AudioContext", FakeSound)
  vi.stubGlobal("fetch", async (url: string) => new Response(fixture(url)))
  FakeSound.started = []
  SlowDecoder.all = []
  const p = new Player([{ url: "t1.mp3", gain: 1 }, { url: "t2.mp3", gain: 1 }])
  try {
    p.setRate(1.5, fakeStretch())
    p.play(0)
    await vi.waitFor(() => expect(p.waiting).toBe(false))
    const sound = FakeSound.last!
    const t0 = FakeSound.started[0].when
    // The decoders stop keeping up; the clock reaches a tenth of a second before the sound placed runs out.
    SlowDecoder.held = true
    const end = Math.max(...FakeSound.started.map((s) => s.when + s.duration / s.rate))
    sound.currentTime = end - 0.1
    const heard = p.time()
    await vi.waitFor(() => expect(p.waiting).toBe(true))
    expect(p.playing).toBe(true)
    expect(p.time()).toBeCloseTo(heard, 9)
    // Let go, it plays on from there, every piece in time and none cut.
    FakeSound.started = []
    SlowDecoder.letGo()
    await vi.waitFor(() => expect(p.waiting).toBe(false))
    expect(FakeSound.started.every((s) => s.offset === 0 && s.when >= sound.currentTime)).toBe(true)
    sound.currentTime = FakeSound.started[0].when + 0.05 + 1
    expect(p.time()).toBeCloseTo(heard + 1.5, 9)
    expect(t0).toBeLessThan(FakeSound.started[0].when)
  } finally {
    SlowDecoder.held = false
    p.close()
  }
})

test("a repeat goes round at the speed", async () => {
  const { p, sound, t0 } = await playAt(0.5, 2, (p) => p.setLoop(2, 4))
  // Two seconds of the take from 2 to 4 take four of the clock; the second pass starts there.
  sound.currentTime = t0 + 2
  await vi.waitFor(() => expect(FakeSound.started.some((s) => s.when > t0 + 4 - 1e-6)).toBe(true))
  const first = FakeSound.started.filter((s) => s.when < t0 + 4 - 1e-6)
  const second = FakeSound.started.filter((s) => s.when >= t0 + 4 - 1e-6)
  expect(Math.max(...first.map((s) => s.when + s.duration / 0.5))).toBeCloseTo(t0 + 4, 9)
  expect(Math.min(...second.map((s) => s.when))).toBeCloseTo(t0 + 4, 9)
  // Five seconds of the clock in, the take is half a second into its second pass.
  sound.currentTime = t0 + 0.05 + 5
  expect(p.time()).toBeCloseTo(2.5, 9)
  p.close()
})
