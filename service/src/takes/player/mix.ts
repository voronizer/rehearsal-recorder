import type { TakePage } from "../../api"
import { parseFrames } from "./mp3"

/*
  The take as one MP3, made in the page as the band member hears it there:
  each track at the level the page plays it at, a muted track left out, and
  with a track on S only that track (Alex's pick, 2026-11-04 10:19). Master
  is the device's listening level, not the band's balance, so it is not in
  it. The take's amount is, as the page plays it (takes/gain.ts in the
  Worker). The rest is as РЭХА makes a mix for the cloud folder
  (audio/mixdown.py, audio/encode.py): a mono track in the middle, a stereo
  one keeping its sides, turned down if the tracks together still go over
  full scale, and MP3 at LAME's best variable bit rate.

  The tracks are fetched and decoded one at a time and added into one
  buffer a side, a single buffer while every track is mono, so a phone
  holds the mix and one track at most.
*/

/** Where the loudest moment of the mix ends up, as in audio/mixdown.py. */
export const TARGET_PEAK = 0.97

/** What the page plays now: levels, M and S. */
export type Heard = { volumes: Record<string, number>; muted: string[]; soloed: string | null }

/** Each track's level in the mix, in the take's order: 0 for one not heard. */
export function gainsOf(names: string[], heard: Heard): number[] {
  return names.map((name) => {
    if (heard.soloed !== null ? name !== heard.soloed : heard.muted.includes(name)) return 0
    return Math.max(0, heard.volumes[name] ?? 1)
  })
}

/** “Viasna 12.mp3”, “Viasna 12 - without Bass, Vocals.mp3”, “Viasna 12 - only Guitar.mp3”. */
export function mixName(take: string, names: string[], heard: Heard): string {
  if (heard.soloed !== null && names.includes(heard.soloed)) return `${take} - only ${heard.soloed}.mp3`
  const without = names.filter((n) => heard.muted.includes(n))
  return without.length ? `${take} - without ${without.join(", ")}.mp3` : `${take}.mp3`
}

/**
 * Adds a track's sides at `gain` into the mix's: a mono track into each
 * side, a stereo track side by side. A stereo track into a mono mix makes
 * it stereo; a track longer than the mix makes it longer. Returns the mix.
 */
export function addInto(mix: Float32Array[], track: Float32Array[], gain: number): Float32Array[] {
  const length = Math.max(mix[0]?.length ?? 0, track[0]?.length ?? 0)
  let out = mix.length ? mix : [new Float32Array(length)]
  if (out[0].length < length) out = out.map((side) => grow(side, length))
  if (track.length > 1 && out.length === 1) out = [out[0], out[0].slice()]
  for (let s = 0; s < out.length; s++) {
    const from = track[Math.min(s, track.length - 1)]
    const to = out[s]
    for (let i = 0; i < from.length; i++) to[i] += from[i] * gain
  }
  return out
}

function grow(side: Float32Array, length: number): Float32Array {
  const longer = new Float32Array(length)
  longer.set(side)
  return longer
}

/** Turns the mix down to TARGET_PEAK when it goes over it, never up. Returns what it was multiplied by. */
export function turnDown(mix: Float32Array[]): number {
  let peak = 0
  for (const side of mix) for (let i = 0; i < side.length; i++) peak = Math.max(peak, Math.abs(side[i]))
  if (peak <= TARGET_PEAK) return 1
  const gain = TARGET_PEAK / peak
  for (const side of mix) for (let i = 0; i < side.length; i++) side[i] *= gain
  return gain
}

/** An MP3 encoder as `wasm-media-encoders` gives one. */
export type Encoder = {
  configure(params: { sampleRate: number; channels: 1 | 2; vbrQuality: number }): void
  encode(samples: readonly Float32Array[]): Uint8Array
  finalize(): Uint8Array
}

export type MixWays = {
  /** The file's sides at `sampleRate`. */
  decode: (bytes: ArrayBuffer, sampleRate: number) => Promise<Float32Array[]>
  encoder: () => Promise<Encoder>
  /** Lets the page draw between pieces of work. */
  pause: () => Promise<void>
}

/** The browser's own: Web Audio decodes, LAME in WebAssembly encodes. */
const browser: MixWays = {
  decode: async (bytes, sampleRate) => {
    const audio = await new OfflineAudioContext(1, 1, sampleRate).decodeAudioData(bytes)
    return Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c))
  },
  // Loaded on the first mix, as a file of its own.
  encoder: async () => (await import("./encoder")).mp3Encoder(),
  // A message to itself, not a timer: in a tab out of sight a browser lets a
  // timer go once a second at most, and the mix would take minutes.
  pause: () =>
    new Promise((go) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => {
        channel.port1.close()
        go()
      }
      channel.port2.postMessage(null)
    }),
}

/** How much of the work the fetching and decoding are; encoding takes the rest. Measured: 4 s of 14 for six 5-minute tracks. */
const DECODING = 0.3

/** How many samples are encoded between pauses: about a second of sound. */
const PIECE = 48_000

const stopped = () => new DOMException("The mix was stopped", "AbortError")

/**
 * The take mixed as `heard` says, as an MP3 Blob. `progress` hears how far
 * along it is, 0 to 1: fetching and decoding the tracks, then encoding. `signal` stops it.
 */
export async function makeMix(
  take: Pick<TakePage, "tracks" | "gain">,
  heard: Heard,
  { progress, signal, ways = browser }: { progress?: (done: number) => void; signal?: AbortSignal; ways?: MixWays } = {}
): Promise<Blob> {
  const gains = gainsOf(
    take.tracks.map((t) => t.name),
    heard
  )
  const tracks = take.tracks.flatMap((t, i) => (gains[i] > 0 ? [{ file: t.mp3, gain: gains[i] * take.gain }] : []))
  if (!tracks.length) throw new Error("No track is heard")
  let mix: Float32Array[] = []
  let sampleRate = 0
  for (const [n, t] of tracks.entries()) {
    const res = await fetch(t.file, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bytes = await res.arrayBuffer()
    // Every track at the first one's rate: the take's tracks share one.
    sampleRate ||= parseFrames(new Uint8Array(bytes)).sampleRate || 48000
    mix = addInto(mix, await ways.decode(bytes, sampleRate), t.gain)
    if (signal?.aborted) throw stopped()
    progress?.((DECODING * (n + 1)) / tracks.length)
  }
  turnDown(mix)

  const encoder = await ways.encoder()
  encoder.configure({ sampleRate, channels: 2, vbrQuality: 0 })
  const [left, right] = mix.length > 1 ? mix : [mix[0], mix[0]]
  const parts: Uint8Array<ArrayBuffer>[] = []
  // The encoder's output lives in its own memory and is overwritten next time: kept as a copy.
  const keep = (bytes: Uint8Array) => bytes.length && parts.push(bytes.slice())
  for (let at = 0; at < left.length; at += PIECE) {
    keep(encoder.encode([left.subarray(at, at + PIECE), right.subarray(at, at + PIECE)]))
    progress?.(DECODING + ((1 - DECODING) * Math.min(at + PIECE, left.length)) / left.length)
    await ways.pause()
    if (signal?.aborted) throw stopped()
  }
  keep(encoder.finalize())
  return new Blob(parts, { type: "audio/mpeg" })
}
