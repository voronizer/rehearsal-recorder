import { heard, withMute, withSolo, type Desk } from "./desk"
import { FRAME, loopTime, passFrames, passShift } from "./loop"
import { parseFrames } from "./mp3"
import { Fold } from "./peaks"
import type { Stretch } from "./stretch"

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
  start together. Each file comes in pieces (`Range`), from its start, and
  only as far as half a minute past the playhead (Alex's pick B, 2026-11-02):
  a take left after its first minute costs a phone a quarter of its files,
  not all of them. A seek past what has come so far (a slow connection, or
  a press far ahead) waits there, and starts again once there is a second
  more. So does a take whose sound is about to run out while it plays,
  whether its file has not come or its decoder has fallen behind.

  A piece on repeat, from a to b, plays without a gap: once a track's
  decoder has passed b, a new one starts ten frames before a, and its sound
  is placed one piece later on the same clock, so every track goes round
  together. The clock runs on; time() works out where in the piece it is.

  At another speed (#105) every piece plays at that rate, placed on the
  clock as far apart as it then takes, so the tracks still go together.
  That moves the key with the speed; one stretch node (stretch.ts) between
  Master and the speakers moves it back. The playhead counts the take's
  own seconds at that rate, less the stretch's own delay, so it is where
  the sound is. At 100% the stretch is not in the way. At another speed a
  piece says it is at the speakers' rate and plays that much faster: Chrome
  cuts a slowed piece short when its rate is above the speakers'.
*/

const AHEAD_SEC = 5
/** How far past the playhead the files are fetched. */
const FETCH_AHEAD_SEC = 30
/** A file comes in pieces of this many bytes: about 16 seconds at 128 kbps. */
const PIECE_BYTES = 256 * 1024
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

/** How the files come: how far past the playhead, in pieces of how many bytes. The tests ask for small ones. */
export type Pace = { aheadSec: number; pieceBytes: number }

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
  /** Each track's level split into its sides, for its meters. */
  private splits: ChannelSplitterNode[] = []
  /** Each track's meters after its level and the take's amount: its left side and its right. */
  private meters: AnalyserNode[][] = []
  private master: GainNode | null = null
  /** The whole mix after Master, as it goes out. */
  private mixMeter: AnalyserNode | null = null
  private levels: number[]
  /** The take's amount: every heard track's level is multiplied by it. */
  private boost = 1
  private volume = 1
  private muted = new Set<number>()
  private solo: number[] = []
  private loop: { a: number; b: number } | null = null
  /** How fast the take plays: 1 as recorded. */
  private rate = 1
  /** What puts the key back while the rate is not 1. */
  private keyBack: Stretch | null = null
  /** Told each time more of a file has come, or it failed. */
  private arrived = new Set<() => void>()
  /** Told when the files may be wanted further: the playhead moved, or a wave asked. */
  private hungry = new Set<() => void>()
  /** How far a wave asked for the files, in seconds. */
  private reach = 0
  private readonly pace: Pace
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

  /** A take page's player: each track at `level(name)`, the whole take turned up by the page's `gain`. */
  static of(take: { tracks: { name: string; mp3: string }[]; gain: number }, level: (name: string) => number): Player {
    const p = new Player(take.tracks.map((k) => ({ url: k.mp3, gain: level(k.name) })))
    p.setBoost(take.gain)
    return p
  }

  constructor(tracks: PlayerTrack[], pace: Partial<Pace> = {}) {
    this.pace = { aheadSec: FETCH_AHEAD_SEC, pieceBytes: PIECE_BYTES, ...pace }
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
    // Paused, the playhead is where it was put, even past the repeat: play starts the piece again.
    if (this.t0 === null) return Math.min(this.end(), this.from)
    const raw = this.raw()
    return this.loop ? loopTime(raw, this.loop.a, this.loop.b) : Math.min(this.end(), raw)
  }

  /** How fast the take plays, 1 as recorded. */
  get speed(): number {
    return this.rate
  }

  /**
   * Plays at `rate` times the take's speed, in its own key, with `stretch`
   * putting the key back; at 1 none is needed. While playing, it goes on
   * from where it is, as a jump does.
   */
  setRate(rate: number, stretch: Stretch | null): void {
    const at = this.time()
    this.rate = rate > 0 && Number.isFinite(rate) ? rate : 1
    this.keyBack = this.rate === 1 ? null : stretch
    this.keyBack?.setRate(this.rate)
    this.route()
    if (this.wanted) this.play(at)
    else this.changed()
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

  /** The tracks soloed. */
  get soloed(): number[] {
    return this.solo
  }

  /**
   * How loud each track comes out now, 0 to 1: after its level, the take's
   * amount, M and S; 0 while paused. A stereo file has a number a side, left then right, so a
   * side that went quiet shows; a mono file, or one whose first frame has
   * not come, has one.
   */
  loudness(): number[][] {
    return this.tracks.map((_, i) => {
      const [left, right] = this.meters[i] ?? []
      return this.sources[i].channels === 2 ? [this.peak(left), this.peak(right)] : [this.peak(left)]
    })
  }

  /** How loud the whole take comes out now, 0 to 1: every track together, after the take's amount and Master; 0 while paused. */
  mixLoudness(): number {
    return this.peak(this.mixMeter)
  }

  /** Master's level, 0 to 1: how loud the whole take plays, for listening. */
  get masterVolume(): number {
    return this.volume
  }

  /** Master's level, heard at once and kept for when the take plays. */
  setMaster(v: number): void {
    this.volume = Math.min(1, Math.max(0, v))
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, GLIDE_SEC)
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
    this.feed()
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
      this.feed()
      this.changed()
    }
  }

  /** M and S on one track take each other off (desk.ts). */
  setMute(i: number, on: boolean): void {
    this.desk(withMute(this.deskNow(), i, on))
  }

  /** Track `i`'s S on or off: with S on, only the soloed tracks are heard (desk.ts). */
  setSolo(i: number, on: boolean): void {
    this.desk(withSolo(this.deskNow(), i, on))
  }

  private deskNow(): Desk {
    return { muted: [...this.muted], solo: [...this.solo] }
  }

  private desk(d: Desk): void {
    this.muted = new Set(d.muted)
    this.solo = d.solo
    this.mix()
  }

  /** Track `i`'s level, 0 to 1, heard at once. */
  setGain(i: number, v: number): void {
    if (i < 0 || i >= this.levels.length) return
    this.levels[i] = Math.min(1, Math.max(0, v))
    this.mix()
  }

  /** How far the whole take is turned up, the same for every track, on top of their levels: the take page's
   *  `gain`, below 1 for a take that would crackle. Anything but a number plays it as recorded. */
  setBoost(v: number): void {
    this.boost = Number.isFinite(v) ? Math.max(0, v) : 1
    this.mix()
  }

  /**
   * Repeats from a to b, or, with null, plays on to the end. A piece
   * shorter than a fifth of a second is none. While playing, it goes on
   * from where it is, or from a if that is outside the piece.
   */
  setLoop(a: number | null, b: number | null): void {
    const at = this.time()
    // No further than the files go, as in РЭХА: no silence at each turn.
    const to = b === null ? null : Math.min(b, this.end())
    this.loop = a !== null && to !== null && to - a >= MIN_LOOP_SEC ? { a: Math.max(0, a), b: to } : null
    if (this.wanted) this.play(at)
    else {
      if (this.loop && (this.from < this.loop.a || this.from >= this.loop.b)) this.from = this.loop.a
      this.changed()
    }
  }

  /**
   * Track `i`'s wave from `from` to `to` seconds, as `buckets` numbers, from
   * the MP3 itself: the files are asked for if they were not, and it waits
   * until that stretch of this one has come. Only the wave is kept as the
   * sound is decoded. In `rows` rows, as many as the take's own wave has:
   * one, the louder side in each slice, or two, left then right. Null if it
   * cannot be had, or `signal` says it is no longer wanted.
   */
  async stretch(i: number, from: number, to: number, buckets: number, signal?: AbortSignal, rows = 1): Promise<number[][] | null> {
    const source = this.sources[i]
    if (!source || typeof AudioDecoder === "undefined") return null
    this.reach = Math.max(this.reach, to)
    this.fetch()
    this.feed()
    const has = () =>
      this.broken || this.shut || source.whole || (source.sampleRate > 0 && (source.frames.length * FRAME) / source.sampleRate >= to)
    while (!has() && !signal?.aborted)
      await new Promise<void>((done) => {
        this.arrived.add(done)
        signal?.addEventListener("abort", () => done(), { once: true })
      })
    if (this.broken || this.shut || signal?.aborted || !source.sampleRate) return null
    const { sampleRate, channels, frames } = source
    const start = Math.round(from * sampleRate)
    const stop = Math.round(to * sampleRate)
    const first = Math.max(0, Math.floor(start / FRAME) - WARM_UP_FRAMES)
    const last = Math.min(frames.length, Math.ceil(stop / FRAME) + 1)
    const folds = Array.from({ length: rows > 1 ? 2 : 1 }, () => new Fold(Math.max(0, stop - start), buckets))
    let cursor = first * FRAME
    const decoder = new AudioDecoder({
      output: (data) => {
        const p = planes(data)
        data.close()
        const n = p[0].length
        const lo = Math.max(0, start - cursor)
        const hi = Math.min(n, stop - cursor)
        cursor += n
        if (hi <= lo) return
        const piece = p.map((c) => c.subarray(lo, hi))
        // Two rows are a side each; one row is the louder side in each slice.
        if (folds.length === 1) folds[0].add(piece)
        else folds.forEach((fold, side) => fold.add([piece[Math.min(side, piece.length - 1)]]))
      },
      error: (e) => console.error(e),
    })
    const shut = () => {
      try {
        decoder.close()
      } catch {
        // Already closed.
      }
    }
    // A newer stretch is wanted: this decoder stops at once, and its flush fails.
    signal?.addEventListener("abort", shut, { once: true })
    try {
      decoder.configure({ codec: "mp3", sampleRate, numberOfChannels: channels })
      for (let k = first; k < last && !signal?.aborted; k++)
        decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round((k * FRAME * 1e6) / sampleRate), data: frames[k] }))
      await decoder.flush()
    } catch (e) {
      if (!signal?.aborted) console.error(e)
      return null
    } finally {
      signal?.removeEventListener("abort", shut)
      shut()
    }
    return signal?.aborted ? null : folds.map((fold) => fold.peaks)
  }

  /** Lets go of the files and the decoders; the sound stays for the next take. */
  close(): void {
    this.halt()
    this.fetching?.abort()
    this.master?.disconnect()
    this.mixMeter?.disconnect()
    for (const node of [...this.gains, ...this.splits, ...this.meters.flat()]) node.disconnect()
    this.context = null
    // A wave still waiting for its stretch gets none; a file waiting to go on stops.
    this.shut = true
    this.told()
    this.feed()
  }

  private open() {
    const context = wakeSound()
    this.context = context
    const master = context.createGain()
    master.gain.value = this.volume
    this.master = master
    this.mixMeter = context.createAnalyser()
    this.mixMeter.fftSize = 1024
    this.route()
    this.gains = this.tracks.map(() => {
      const g = context.createGain()
      g.connect(master)
      return g
    })
    // Each track's level split into its sides, a meter on each. The files
    // may not have said yet how many channels they have, so every track is
    // split: a mono file's sound is all on the first side (the splitter
    // puts a channel on the output of its number), and loudness() reads
    // that one alone.
    this.splits = this.gains.map((g) => {
      const split = context.createChannelSplitter(2)
      g.connect(split)
      return split
    })
    this.meters = this.splits.map((split) =>
      [0, 1].map((side) => {
        const meter = context.createAnalyser()
        meter.fftSize = 1024
        split.connect(meter, side)
        return meter
      })
    )
    this.mix(true)
  }

  /** Master out to the speakers, through the stretch while the speed is not 1; and to its meter. */
  private route() {
    const { master, context, mixMeter } = this
    if (!master || !context || !mixMeter) return
    master.disconnect()
    if (this.keyBack) {
      master.connect(this.keyBack.node)
      this.keyBack.node.connect(context.destination)
    } else master.connect(context.destination)
    master.connect(mixMeter)
  }

  /** The loudest sample a meter has just seen, 0 to 1; 0 while no sound comes. */
  private peak(meter: AnalyserNode | null | undefined): number {
    if (!meter || this.t0 === null) return 0
    const wave = new Float32Array(meter.fftSize)
    meter.getFloatTimeDomainData(wave)
    let top = 0
    for (const v of wave) top = Math.max(top, Math.abs(v))
    return Math.min(1, top)
  }

  private mix(now = false) {
    const d = this.deskNow()
    this.tracks.forEach((_, i) => {
      const g = this.gains[i]
      if (!g || !this.context) return
      const v = heard(d, i) ? this.levels[i] * this.boost : 0
      if (now) g.gain.value = v
      else g.gain.setTargetAtTime(v, this.context.currentTime, GLIDE_SEC)
    })
  }

  /**
   * How far the take has played since play, in its own seconds, counted as
   * if nothing repeats: as heard, or, for the files, as far as the sound has
   * gone in.
   */
  private raw(heard = true): number {
    if (this.t0 === null || !this.context) return this.from
    // The sound comes out of the stretch this much after it goes in.
    const delay = heard ? (this.keyBack?.latency ?? 0) : 0
    return this.from + Math.max(0, this.context.currentTime - this.t0 - delay) * this.rate
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

  /** The files may be wanted further: each one waiting looks again. */
  private feed() {
    const waiting = [...this.hungry]
    this.hungry.clear()
    for (const f of waiting) f()
  }

  /** How far into the take the files are wanted now. */
  private horizon(): number {
    return Math.max(this.time() + this.pace.aheadSec, this.reach)
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
    this.tracks.forEach((track, i) => void this.pull(track.url, this.sources[i], signal))
  }

  /** A track's file, a piece at a time while it is wanted further than it has come; whole once its end is in. */
  private async pull(url: string, source: Source, signal: AbortSignal) {
    let offset = 0
    let size = Infinity
    let rest = new Uint8Array(0)
    let first = true
    const has = () => (source.sampleRate ? (source.frames.length * FRAME) / source.sampleRate : 0)
    try {
      while (offset < size) {
        while (!signal.aborted && !this.shut && has() >= this.horizon()) await new Promise<void>((go) => this.hungry.add(go))
        if (signal.aborted || this.shut) return
        const last = Math.min(offset + this.pace.pieceBytes, size) - 1
        const res = await fetch(url, { signal, headers: { Range: `bytes=${offset}-${last}` } })
        // Asked from past the end: what came was all there is.
        if (res.status === 416) break
        if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`)
        // 206 is the piece asked for; 200, a server that sends the whole file at once.
        const piece = res.status === 206
        if (piece) size = Number(/\/(\d+)$/.exec(res.headers.get("Content-Range") ?? "")?.[1] ?? Infinity) || Infinity
        const reader = res.body.getReader()
        let got = 0
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          got += value.length
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
        offset += got
        if (!piece || got === 0) break
      }
      if (!source.sampleRate) throw new Error(`${url}: no MP3 frames`)
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
    // The playhead has moved on: the files go on as far as it needs.
    this.feed()
    const now = this.time()
    if (!this.loop && now >= this.end()) {
      this.halt()
      this.from = 0
      this.changed()
      this.onEnd?.()
      return
    }
    const raw = this.raw(false)
    for (const lane of this.lanes) {
      if (lane.done) continue
      const decoder = this.decoder(lane)
      if (!decoder) continue
      const { frames, sampleRate } = lane.source
      const shift = this.shift(lane.pass)
      // On repeat, a pass needs the frames up to the one b falls in, and one more.
      const { last, all } = passFrames(this.stop(lane), frames.length, lane.source.whole)
      const ahead = (frame: number) => (frame * FRAME) / sampleRate + shift - raw
      // Five seconds of the clock ahead: at half speed, two and a half of the take.
      while (lane.next < last && ahead(lane.next) < AHEAD_SEC * this.rate && decoder.decodeQueueSize < QUEUE) {
        decoder.decode(
          new EncodedAudioChunk({
            type: "key",
            timestamp: Math.round((lane.next * FRAME * 1e6) / sampleRate),
            data: frames[lane.next],
          })
        )
        lane.next++
      }
      const passed = lane.next >= last && all
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
      // The sound placed runs out in a moment: the file has not come this far, or the decoder has
      // fallen behind (#105, at 150% on Alex's Mac a take went silent with ⏸ on). Wait here for a
      // second more, as at the start, rather than let the pieces come too late to be heard.
      if (this.t0 !== null && !passed && this.placedTo(lane) / sampleRate + shift - raw < 0.15 * this.rate) {
        this.play(now)
        return
      }
    }
  }

  /** The sample a lane's placed sound goes up to in its pass: what is decoded and not yet cut is not placed. */
  private placedTo(lane: Lane): number {
    return Math.min(Math.max(lane.cursor - lane.pendingLength, lane.start), this.stop(lane))
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
    // At another speed a piece says it is at the speakers' rate and plays that much faster
    // (place): Chrome cuts a slowed piece short when it says a higher rate than the speakers',
    // the last 7% of it at 48 kHz on 44.1 kHz, so a take stuttered every half second (#105).
    const rate = this.rate === 1 ? lane.source.sampleRate : this.context.sampleRate
    const buffer = this.context.createBuffer(channels, length, rate)
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
    // At another speed the take's seconds go by on the clock at that rate.
    let when = this.t0! + (at / lane.source.sampleRate + this.shift(pass) - this.from) / this.rate
    // A piece that says another rate than its file's (cut) goes that much faster, and its seconds are that much longer.
    const fold = lane.source.sampleRate / buffer.sampleRate
    let offset = 0
    const soonest = context.currentTime + 0.01
    if (when < soonest) {
      offset = (soonest - when) * this.rate * fold
      when = soonest
    }
    if (offset >= buffer.duration) return
    const node = context.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = this.rate * fold
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
