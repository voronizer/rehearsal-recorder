import { withMute, withSolo, type Desk } from "./desk"
import { FRAME, loopTime, passFrames, passShift } from "./loop"
import { parseFrames } from "./mp3"
import { Fold } from "./peaks"

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
  more.

  A piece on repeat, from a to b, plays without a gap: once a track's
  decoder has passed b, a new one starts ten frames before a, and its sound
  is placed one piece later on the same clock, so every track goes round
  together. The clock runs on; time() works out where in the piece it is.
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
  /** Each track's meters after its level: its left side and its right. */
  private meters: AnalyserNode[][] = []
  private master: GainNode | null = null
  /** The whole mix after Master, as it goes out. */
  private mixMeter: AnalyserNode | null = null
  private levels: number[]
  /** The take's amount: every heard track's level is multiplied by it. */
  private boost = 1
  private volume = 1
  private muted = new Set<number>()
  private solo: number | null = null
  private loop: { a: number; b: number } | null = null
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

  /** Only this track is heard, or, with `on` false, every track again. */
  setSolo(i: number, on: boolean): void {
    this.desk(on ? withSolo(this.deskNow(), i) : this.solo === i ? withSolo(this.deskNow(), null) : this.deskNow())
  }

  private deskNow(): Desk {
    return { muted: [...this.muted], solo: this.solo }
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

  /** How much louder the whole take plays, the same for every track, on top of their levels: the take page's `gain`. */
  setBoost(v: number): void {
    this.boost = Math.max(0, v)
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
    master.connect(context.destination)
    this.master = master
    this.mixMeter = context.createAnalyser()
    this.mixMeter.fftSize = 1024
    master.connect(this.mixMeter)
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
    this.tracks.forEach((_, i) => {
      const heard = this.solo !== null ? this.solo === i : !this.muted.has(i)
      const g = this.gains[i]
      if (!g || !this.context) return
      const v = heard ? this.levels[i] * this.boost : 0
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
    const raw = this.raw()
    for (const lane of this.lanes) {
      if (lane.done) continue
      const decoder = this.decoder(lane)
      if (!decoder) continue
      const { frames, sampleRate } = lane.source
      const shift = this.shift(lane.pass)
      // On repeat, a pass needs the frames up to the one b falls in, and one more.
      const { last, all } = passFrames(this.stop(lane), frames.length, lane.source.whole)
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
