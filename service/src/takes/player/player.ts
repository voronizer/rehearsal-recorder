import { parseFrames } from "./mp3"

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

export type PlayerTrack = { url: string; gain: number }

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
  pending: Float32Array[][]
  pendingLength: number
  /** Pieces made before the first sound, placed when every track has its second. */
  held: { at: number; buffer: AudioBuffer }[]
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
  private muted = new Set<number>()
  private solo: number | null = null
  private lanes: Lane[] = []
  private from = 0
  private t0: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private wanted = false
  private broken = false

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
    if (this.t0 === null || !this.context) return this.from
    return Math.min(this.end(), this.from + Math.max(0, this.context.currentTime - this.t0))
  }

  /** Plays from `at`. Called from a click, so the browser lets sound start. */
  play(at = this.time()): void {
    if (!this.context) this.open()
    void this.context!.resume()
    this.fetch()
    this.stopLanes()
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

  /** Lets go of the files, the decoders and the sound. */
  close(): void {
    this.halt()
    this.fetching?.abort()
    void this.context?.close()
    this.context = null
  }

  private open() {
    try {
      // On an iPhone, so the take is heard with the ring switch on silent.
      const session = (navigator as { audioSession?: { type: string } }).audioSession
      if (session) session.type = "playback"
    } catch {
      // Not there: nothing to set.
    }
    this.context = new AudioContext({ latencyHint: "playback" })
    const master = this.context.createGain()
    master.connect(this.context.destination)
    this.gains = this.tracks.map(() => {
      const g = this.context!.createGain()
      g.connect(master)
      return g
    })
    this.mix()
  }

  private mix() {
    this.tracks.forEach((t, i) => {
      const heard = this.solo !== null ? this.solo === i : !this.muted.has(i)
      if (this.gains[i]) this.gains[i].gain.value = heard ? t.gain : 0
    })
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
        }
        if (!source.sampleRate) throw new Error(`${track.url}: no MP3 frames`)
        source.whole = true
      } catch (e) {
        if (signal.aborted) return
        console.error(e)
        this.broken = true
        this.halt()
        this.changed()
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
      start: 0,
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
    lane.start = Math.round(this.from * sampleRate)
    lane.next = Math.max(0, Math.floor(lane.start / FRAME) - WARM_UP_FRAMES)
    lane.cursor = lane.next * FRAME
    lane.decoder = new AudioDecoder({
      output: (data) => {
        if (lane.dead) {
          data.close()
          return
        }
        const p = planes(data)
        data.close()
        this.take(lane, p)
      },
      error: (e) => {
        if (lane.dead) return
        console.error(e)
        this.broken = true
        this.halt()
        this.changed()
      },
    })
    lane.decoder.configure({ codec: "mp3", sampleRate, numberOfChannels: channels })
    return lane.decoder
  }

  private pump() {
    if (!this.wanted) return
    const now = this.time()
    if (now >= this.end()) {
      this.halt()
      this.from = 0
      this.changed()
      this.onEnd?.()
      return
    }
    for (const lane of this.lanes) {
      const decoder = this.decoder(lane)
      if (!decoder || lane.done) continue
      const { frames, sampleRate } = lane.source
      const head = Math.round(now * sampleRate)
      while (lane.next < frames.length && lane.next * FRAME - head < AHEAD_SEC * sampleRate && decoder.decodeQueueSize < QUEUE) {
        decoder.decode(
          new EncodedAudioChunk({
            type: "key",
            timestamp: Math.round((lane.next * FRAME * 1e6) / sampleRate),
            data: frames[lane.next],
          })
        )
        lane.next++
      }
      if (lane.source.whole && lane.next >= frames.length && !lane.flushing) {
        lane.flushing = true
        decoder
          .flush()
          .then(() => {
            if (lane.dead) return
            this.cut(lane)
            lane.done = true
            this.begin()
          })
          .catch(() => {})
      }
      // The file has not come this far: wait here for a second more of it.
      if (this.t0 !== null && !lane.source.whole && lane.next >= frames.length && lane.cursor / sampleRate - now < 0.15) {
        this.play(now)
        return
      }
    }
  }

  private take(lane: Lane, p: Float32Array[]) {
    const n = p[0].length
    // The warm-up before the playhead is not heard.
    const skip = lane.cursor < lane.start ? Math.min(n, lane.start - lane.cursor) : 0
    lane.cursor += n
    if (skip >= n) return
    lane.pending.push(skip ? p.map((a) => a.subarray(skip)) : p)
    lane.pendingLength += n - skip
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
    const at = lane.cursor - length
    lane.pending = []
    lane.pendingLength = 0
    if (this.t0 === null) {
      lane.held.push({ at, buffer })
      this.begin()
    } else this.place(lane, at, buffer)
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
      for (const h of lane.held) this.place(lane, h.at, h.buffer)
      lane.held = []
    }
    this.changed()
  }

  private place(lane: Lane, at: number, buffer: AudioBuffer) {
    const context = this.context!
    let when = this.t0! + at / lane.source.sampleRate - this.from
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
