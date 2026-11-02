import { loopTime, passShift } from "./loop"
import { parseFrames } from "./mp3"
import { peaksOf } from "./peaks"

/*
  A take's tracks played together, as tested on 24 October on Alex's Mac
  and iPhone ("way 2"). Each track's MP3 comes as a stream and is cut into
  frames as it arrives. A WebCodecs AudioDecoder for each track turns its
  frames into sound a few seconds ahead of the playhead, and every piece of
  every track is started at its own sample on one AudioContext's clock, so
  the tracks cannot drift apart however long the take is. Each MP3 is kept
  as it comes, still compressed (about 4 MB for four minutes at 128 kbps);
  only the decoded sound is kept to those few seconds.

  A seek stops every piece and starts again from the frame at that time,
  ten frames early so the decoder has warmed up by then; that warm-up is not
  heard. Before the first sound every track has a second ready, so they
  start together. Each file comes whole, from its start: a seek past what
  has come so far (a slow connection) waits there, and starts again once
  there is a second more. The service would send a file from the middle
  (`Range`), but the player does not ask for that yet.

  A piece on repeat, from a to b, plays without a gap: once a track's
  decoder has passed b, a new one starts ten frames before a, and its sound
  is placed one piece later on the same clock, so every track goes round
  together. The clock runs on; time() works out where in the piece it is.
*/

const FRAME = 1152
const AHEAD_SEC = 5
const CHUNK_SEC = 0.5
const PREBUFFER_SEC = 1
const WARM_UP_FRAMES = 10
const QUEUE = 16
const TICK_MS = 40
/** Start a moment from now, so every track's first piece is placed in time. */
const LEAD_SEC = 0.1
/** A piece shorter than this is no repeat, as in РЭХА (audio/player.py). */
const MIN_LOOP_SEC = 0.2
/** How fast a level turned while playing reaches its new place: no click. */
const GLIDE_SEC = 0.01

export type PlayerTrack = { url: string; gain: number }

/*
  One AudioContext for every take, made and woken by the first press of a
  ▶. A take pressed in a list plays once its page has come, after the
  press: a browser lets that context sound then, where a new one made
  outside the press would stay silent on an iPhone.
*/
let sound: AudioContext | null = null

/** Wakes the service's sound; called from a press, before a take's page has come. */
export function wakeSound(): AudioContext {
  if (!sound) {
    try {
      // On an iPhone, so the take is heard with the ring switch on silent.
      const session = (navigator as { audioSession?: { type: string } }).audioSession
      if (session) session.type = "playback"
    } catch {
      // Not there: nothing to set.
    }
    sound = new AudioContext({ latencyHint: "playback" })
  }
  void sound.resume()
  return sound
}

type Source = {
  frames: Uint8Array[]
  sampleRate: number
  channels: number
  /** The whole file has come. */
  whole: boolean
}

type Lane = {
  index: number
  source: Source
  decoder: AudioDecoder | null
  /** The next frame to decode. */
  next: number
  /** The sample the decoder's next output starts at, counted from the file's start. */
  cursor: number
  /** The first sample to be heard. */
  start: number
  /** Which time round the piece on repeat this decoder plays: 0 before any repeat. */
  pass: number
  pending: Float32Array[][]
  pendingLength: number
  /** Pieces made before the first sound, placed when every track has its second. */
  held: { at: number; pass: number; buffer: AudioBuffer }[]
  nodes: Set<AudioBufferSourceNode>
  flushing: boolean
  done: boolean
  dead: boolean
}

/** What a decoded piece of sound holds, as one Float32Array per channel. */
function planes(data: AudioData): Float32Array[] {
  const n = data.numberOfFrames
  const count = data.numberOfChannels
  const out: Float32Array[] = []
  try {
    for (let c = 0; c < count; c++) {
      const plane = new Float32Array(n)
      data.copyTo(plane, { planeIndex: c, format: "f32-planar" })
      out.push(plane)
    }
    return out
  } catch {
    out.length = 0
  }
  // A browser that will not convert gives its own format.
  const format = data.format ?? "f32"
  const planar = format.endsWith("-planar")
  const s16 = format.startsWith("s16")
  const s32 = format.startsWith("s32")
  const u8 = format.startsWith("u8")
  const read = (plane: number) => {
    const raw = new ArrayBuffer(data.allocationSize({ planeIndex: plane }))
    data.copyTo(raw, { planeIndex: plane })
    return s16 ? new Int16Array(raw) : s32 ? new Int32Array(raw) : u8 ? new Uint8Array(raw) : new Float32Array(raw)
  }
  const scale = (v: number) => (s16 ? v / 32768 : s32 ? v / 2147483648 : u8 ? (v - 128) / 128 : v)
  for (let c = 0; c < count; c++) out.push(new Float32Array(n))
  if (planar) {
    for (let c = 0; c < count; c++) {
      const p = read(c)
      for (let k = 0; k < n; k++) out[c][k] = scale(p[k])
    }
  } else {
    const p = read(0)
    for (let k = 0; k < n; k++) for (let c = 0; c < count; c++) out[c][k] = scale(p[k * count + c])
  }
  return out
}

export class Player {
  /** The take played to its end. */
  onEnd?: () => void
  /** Something a page shows changed: playing, waiting, failed. */
  onChange?: () => void

  private readonly tracks: PlayerTrack[]
  private sources: Source[]
  private fetching: AbortController | null = null
  private context: AudioContext | null = null
  private gains: GainNode[] = []
  private meters: AnalyserNode[] = []
  private master: GainNode | null = null
  private levels: number[]
  private muted = new Set<number>()
  private solo: number | null = null
  private loop: { a: number; b: number } | null = null
  /** Told each time more of a file has come, or it failed. */
  private arrived = new Set<() => void>()
  private lanes: Lane[] = []
  private from = 0
  private t0: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private wanted = false
  private broken = false
  private shut = false

  /** Whether this browser's AudioDecoder can decode MP3. */
  static async supported(): Promise<boolean> {
    if (typeof AudioDecoder === "undefined" || typeof AudioContext === "undefined") return false
    try {
      return !!(await AudioDecoder.isConfigSupported({ codec: "mp3", sampleRate: 48000, numberOfChannels: 1 })).supported
    } catch {
      return false
    }
  }

  constructor(tracks: PlayerTrack[]) {
    this.tracks = tracks
    this.levels = tracks.map((t) => t.gain)
    this.sources = tracks.map(() => ({ frames: [], sampleRate: 0, channels: 0, whole: false }))
  }

  /** Asked to play: sounding, or waiting for the files. */
  get playing(): boolean {
    return this.wanted
  }

  /** Asked to play, and no sound yet. */
  get waiting(): boolean {
    return this.wanted && this.t0 === null
  }

  /** A file could not be had or read. */
  get failed(): boolean {
    return this.broken
  }

  /** Where the playhead is, in seconds. */
  time(): number {
    const raw = this.raw()
    return this.loop ? loopTime(raw, this.loop.a, this.loop.b) : Math.min(this.end(), raw)
  }

  /** The piece on repeat, or null. */
  get repeat(): { a: number; b: number } | null {
    return this.loop
  }

  /** Track `i`'s level, 0 to 1, before M and S. */
  gain(i: number): number {
    return this.levels[i] ?? 1
  }

  isMuted(i: number): boolean {
    return this.muted.has(i)
  }

  /** The track heard alone, or null. */
  get soloed(): number | null {
    return this.solo
  }

  /** How loud each track comes out now, 0 to 1: after its level, M and S; 0 while paused. */
  loudness(): number[] {
    return this.tracks.map((_, i) => {
      const meter = this.meters[i]
      if (!meter || this.t0 === null) return 0
      const wave = new Float32Array(meter.fftSize)
      meter.getFloatTimeDomainData(wave)
      let top = 0
      for (const v of wave) top = Math.max(top, Math.abs(v))
      return Math.min(1, top)
    })
  }

  /** Plays from `at`. Called from a click, so the browser lets sound start. */
  play(at = this.time()): void {
    if (!this.context) this.open()
    void this.context!.resume()
    this.fetch()
    this.stopLanes()
    // On repeat, a playhead outside the piece goes to its start, as in РЭХА.
    if (this.loop && (at < this.loop.a || at >= this.loop.b)) at = this.loop.a
    this.from = Math.max(0, at)
    this.t0 = null
    this.wanted = true
    this.lanes = this.sources.map((source, index) => this.lane(index, source))
    if (!this.timer) this.timer = setInterval(() => this.pump(), TICK_MS)
    this.pump()
    this.changed()
  }

  pause(): void {
    this.from = this.time()
    this.halt()
    this.changed()
  }

  seek(at: number): void {
    if (this.wanted) this.play(at)
    else {
      this.from = Math.max(0, at)
      this.changed()
    }
  }

  setMute(i: number, on: boolean): void {
    if (on) this.muted.add(i)
    else this.muted.delete(i)
    this.mix()
  }

  /** Only this track is heard, or, with `on` false, every track again. */
  setSolo(i: number, on: boolean): void {
    this.solo = on ? i : this.solo === i ? null : this.solo
    this.mix()
  }

  /** Track `i`'s level, 0 to 1, heard at once. */
  setGain(i: number, v: number): void {
    if (i < 0 || i >= this.levels.length) return
    this.levels[i] = Math.min(1, Math.max(0, v))
    this.mix()
  }

  /**
   * Repeats from a to b, or, with null, plays on to the end. A piece
   * shorter than a fifth of a second is none. While playing, it goes on
   * from where it is, or from a if that is outside the piece.
   */
  setLoop(a: number | null, b: number | null): void {
    const at = this.time()
    this.loop = a !== null && b !== null && b - a >= MIN_LOOP_SEC ? { a: Math.max(0, a), b } : null
    if (this.wanted) this.play(at)
    else {
      if (this.loop && (this.from < this.loop.a || this.from >= this.loop.b)) this.from = this.loop.a
      this.changed()
    }
  }

  /**
   * Track `i`'s wave from `from` to `to` seconds, as `buckets` numbers, from
   * the MP3 itself: the files are asked for if they were not, and it waits
   * until that stretch of this one has come. Null if it cannot be had.
   */
  async stretch(i: number, from: number, to: number, buckets: number): Promise<number[] | null> {
    const source = this.sources[i]
    if (!source || typeof AudioDecoder === "undefined") return null
    this.fetch()
    const has = () =>
      this.broken || this.shut || source.whole || (source.sampleRate > 0 && (source.frames.length * FRAME) / source.sampleRate >= to)
    while (!has()) await new Promise<void>((done) => this.arrived.add(done))
    if (this.broken || this.shut || !source.sampleRate) return null
    const { sampleRate, channels, frames } = source
    const start = Math.round(from * sampleRate)
    const stop = Math.round(to * sampleRate)
    const first = Math.max(0, Math.floor(start / FRAME) - WARM_UP_FRAMES)
    const last = Math.min(frames.length, Math.ceil(stop / FRAME) + 1)
    const pieces: Float32Array[][] = []
    let cursor = first * FRAME
    const decoder = new AudioDecoder({
      output: (data) => {
        const p = planes(data)
        data.close()
        const n = p[0].length
        const lo = Math.max(0, start - cursor)
        const hi = Math.min(n, stop - cursor)
        cursor += n
        if (hi > lo) pieces.push(p.map((c) => c.subarray(lo, hi)))
      },
      error: (e) => console.error(e),
    })
    try {
      decoder.configure({ codec: "mp3", sampleRate, numberOfChannels: channels })
      for (let k = first; k < last; k++)
        decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round((k * FRAME * 1e6) / sampleRate), data: frames[k] }))
      await decoder.flush()
    } catch (e) {
      console.error(e)
      return null
    } finally {
      try {
        decoder.close()
      } catch {
        // Already closed.
      }
    }
    return peaksOf(pieces, buckets)
  }

  /** Lets go of the files and the decoders; the sound stays for the next take. */
  close(): void {
    this.halt()
    this.fetching?.abort()
    this.master?.disconnect()
    for (const meter of this.meters) meter.disconnect()
    this.context = null
    // A wave still waiting for its stretch gets none.
    this.shut = true
    this.told()
  }

  private open() {
    const context = wakeSound()
    this.context = context
    const master = context.createGain()
    master.connect(context.destination)
    this.master = master
    this.gains = this.tracks.map(() => {
      const g = context.createGain()
      g.connect(master)
      return g
    })
    this.meters = this.gains.map((g) => {
      const meter = context.createAnalyser()
      meter.fftSize = 1024
      g.connect(meter)
      return meter
    })
    this.mix(true)
  }

  private mix(now = false) {
    this.tracks.forEach((_, i) => {
      const heard = this.solo !== null ? this.solo === i : !this.muted.has(i)
      const g = this.gains[i]
      if (!g || !this.context) return
      const v = heard ? this.levels[i] : 0
      if (now) g.gain.value = v
      else g.gain.setTargetAtTime(v, this.context.currentTime, GLIDE_SEC)
    })
  }

  /** How far the clock has run since play, counted as if nothing repeats. */
  private raw(): number {
    if (this.t0 === null || !this.context) return this.from
    return this.from + Math.max(0, this.context.currentTime - this.t0)
  }

  /** How much later than its place in the take a pass's sound is heard. */
  private shift(pass: number): number {
    return this.loop ? passShift(pass, this.loop.a, this.loop.b) : 0
  }

  private told() {
    const waiting = [...this.arrived]
    this.arrived.clear()
    for (const f of waiting) f()
  }

  /** The take's end: its longest track, once every file has come. */
  private end(): number {
    if (!this.sources.every((s) => s.whole)) return Infinity
    return Math.max(0, ...this.sources.map((s) => (s.sampleRate ? (s.frames.length * FRAME) / s.sampleRate : 0)))
  }

  private fetch() {
    if (this.fetching) return
    this.fetching = new AbortController()
    const signal = this.fetching.signal
    this.tracks.forEach(async (track, i) => {
      const source = this.sources[i]
      try {
        const res = await fetch(track.url, { signal })
        if (!res.ok || !res.body) throw new Error(`${track.url}: ${res.status}`)
        const reader = res.body.getReader()
        let rest = new Uint8Array(0)
        let first = true
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const bytes = new Uint8Array(rest.length + value.length)
          bytes.set(rest)
          bytes.set(value, rest.length)
          const found = parseFrames(bytes, first)
          first = first && found.used === 0
          if (!source.sampleRate && found.sampleRate) {
            source.sampleRate = found.sampleRate
            source.channels = found.channels
          }
          for (const f of found.frames) source.frames.push(f)
          rest = bytes.slice(found.used)
          this.told()
        }
        if (!source.sampleRate) throw new Error(`${track.url}: no MP3 frames`)
        source.whole = true
        this.told()
      } catch (e) {
        if (signal.aborted) return
        console.error(e)
        this.broken = true
        this.halt()
        this.changed()
        this.told()
      }
    })
  }

  private lane(index: number, source: Source): Lane {
    return {
      index,
      source,
      decoder: null,
      next: 0,
      cursor: 0,
      start: -1,
      pass: 0,
      pending: [],
      pendingLength: 0,
      held: [],
      nodes: new Set(),
      flushing: false,
      done: false,
      dead: false,
    }
  }

  /** The decoder for a lane, once its file's first frame has said what it is. */
  private decoder(lane: Lane): AudioDecoder | null {
    if (lane.decoder || !lane.source.sampleRate) return lane.decoder
    const { sampleRate, channels } = lane.source
    // The first pass starts at the playhead; a pass round the repeat, at a.
    if (lane.start < 0) lane.start = Math.round(this.from * sampleRate)
    lane.next = Math.max(0, Math.floor(lane.start / FRAME) - WARM_UP_FRAMES)
    lane.cursor = lane.next * FRAME
    const decoder: AudioDecoder = new AudioDecoder({
      output: (data) => {
        if (lane.dead || lane.decoder !== decoder) {
          data.close()
          return
        }
        const p = planes(data)
        data.close()
        this.take(lane, p)
      },
      error: (e) => {
        if (lane.dead || lane.decoder !== decoder) return
        console.error(e)
        this.broken = true
        this.halt()
        this.changed()
      },
    })
    lane.decoder = decoder
    decoder.configure({ codec: "mp3", sampleRate, numberOfChannels: channels })
    return decoder
  }

  /** The sample a lane's pass ends at: the repeat's end, or none. */
  private stop(lane: Lane): number {
    return this.loop ? Math.round(this.loop.b * lane.source.sampleRate) : Infinity
  }

  /** Round the repeat again: a new decoder from ten frames before a. */
  private again(lane: Lane) {
    try {
      lane.decoder?.close()
    } catch {
      // Already closed.
    }
    lane.decoder = null
    lane.flushing = false
    lane.pass++
    lane.start = Math.round(this.loop!.a * lane.source.sampleRate)
    // A track that has no sound in the piece stays silent from here.
    if (lane.source.whole && Math.floor(lane.start / FRAME) >= lane.source.frames.length) lane.done = true
  }

  private pump() {
    if (!this.wanted) return
    const now = this.time()
    if (!this.loop && now >= this.end()) {
      this.halt()
      this.from = 0
      this.changed()
      this.onEnd?.()
      return
    }
    const raw = this.raw()
    for (const lane of this.lanes) {
      if (lane.done) continue
      const decoder = this.decoder(lane)
      if (!decoder) continue
      const { frames, sampleRate } = lane.source
      const shift = this.shift(lane.pass)
      // On repeat, a pass needs the frames up to the one b falls in, and one more.
      const stop = this.stop(lane)
      const last = Number.isFinite(stop) ? Math.min(frames.length, Math.ceil(stop / FRAME) + 1) : frames.length
      const ahead = (frame: number) => (frame * FRAME) / sampleRate + shift - raw
      while (lane.next < last && ahead(lane.next) < AHEAD_SEC && decoder.decodeQueueSize < QUEUE) {
        decoder.decode(
          new EncodedAudioChunk({
            type: "key",
            timestamp: Math.round((lane.next * FRAME * 1e6) / sampleRate),
            data: frames[lane.next],
          })
        )
        lane.next++
      }
      const passed = lane.next >= last && (lane.source.whole || last < frames.length)
      if (passed && !lane.flushing) {
        lane.flushing = true
        decoder
          .flush()
          .then(() => {
            if (lane.dead || lane.decoder !== decoder) return
            this.cut(lane)
            if (this.loop) this.again(lane)
            else lane.done = true
            this.begin()
          })
          .catch(() => {})
      }
      // The file has not come this far: wait here for a second more of it.
      if (this.t0 !== null && !passed && lane.next >= frames.length && lane.cursor / sampleRate + shift - raw < 0.15) {
        this.play(now)
        return
      }
    }
  }

  private take(lane: Lane, p: Float32Array[]) {
    const n = p[0].length
    // The warm-up before the playhead is not heard, nor what is past the repeat's end.
    const skip = lane.cursor < lane.start ? Math.min(n, lane.start - lane.cursor) : 0
    const keep = Math.max(skip, Math.min(n, this.stop(lane) - lane.cursor))
    lane.cursor += n
    if (skip >= keep) return
    lane.pending.push(skip || keep < n ? p.map((a) => a.subarray(skip, keep)) : p)
    lane.pendingLength += keep - skip
    if (lane.pendingLength >= CHUNK_SEC * lane.source.sampleRate) this.cut(lane)
  }

  /** What a lane has decoded, as one piece of sound, placed at its sample. */
  private cut(lane: Lane) {
    if (!lane.pendingLength || !this.context) return
    const length = lane.pendingLength
    const channels = lane.pending[0].length
    const buffer = this.context.createBuffer(channels, length, lane.source.sampleRate)
    for (let c = 0; c < channels; c++) {
      const out = buffer.getChannelData(c)
      let o = 0
      for (const p of lane.pending) {
        out.set(p[c], o)
        o += p[c].length
      }
    }
    // Where the piece starts in the take: what came after it, if anything, was past the repeat's end.
    const at = Math.min(lane.cursor, this.stop(lane)) - length
    lane.pending = []
    lane.pendingLength = 0
    if (this.t0 === null) {
      lane.held.push({ at, pass: lane.pass, buffer })
      this.begin()
    } else this.place(lane, at, lane.pass, buffer)
  }

  /** The first sound, once every track has a second ready or has nothing more. */
  private begin() {
    if (this.t0 !== null || !this.wanted || !this.context || !this.lanes.length) return
    const ready = this.lanes.every(
      (l) => l.done || (l.source.sampleRate > 0 && l.held.reduce((n, h) => n + h.buffer.length, 0) >= PREBUFFER_SEC * l.source.sampleRate)
    )
    if (!ready) return
    this.t0 = this.context.currentTime + LEAD_SEC
    for (const lane of this.lanes) {
      for (const h of lane.held) this.place(lane, h.at, h.pass, h.buffer)
      lane.held = []
    }
    this.changed()
  }

  private place(lane: Lane, at: number, pass: number, buffer: AudioBuffer) {
    const context = this.context!
    let when = this.t0! + at / lane.source.sampleRate + this.shift(pass) - this.from
    let offset = 0
    const soonest = context.currentTime + 0.01
    if (when < soonest) {
      offset = soonest - when
      when = soonest
    }
    if (offset >= buffer.duration) return
    const node = context.createBufferSource()
    node.buffer = buffer
    node.connect(this.gains[lane.index])
    node.start(when, offset)
    lane.nodes.add(node)
    node.onended = () => lane.nodes.delete(node)
  }

  private stopLanes() {
    for (const lane of this.lanes) {
      lane.dead = true
      for (const node of lane.nodes) {
        try {
          node.stop()
        } catch {
          // Already stopped.
        }
      }
      try {
        lane.decoder?.close()
      } catch {
        // Already closed.
      }
    }
    this.lanes = []
  }

  private halt() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.stopLanes()
    this.wanted = false
    this.t0 = null
  }

  private changed() {
    this.onChange?.()
  }
}
