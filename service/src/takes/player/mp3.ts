/*
  The frames of an MP3, as РЭХА writes them: MPEG-1 Layer III, constant bit
  rate, with or without an ID3v2 tag in front. Each frame is a piece the
  browser's AudioDecoder takes on its own, 1152 samples long, so a frame's
  number says exactly where in the take its sound is.
*/

const BIT_RATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const SAMPLE_RATES = [44100, 48000, 32000]
export const SAMPLES_PER_FRAME = 1152

export type Frames = {
  frames: Uint8Array[]
  samplesPerFrame: number
  /** 0 until a frame is found. */
  sampleRate: number
  channels: number
  /** How many bytes the frames and the tag take: what follows is the start of a frame not yet whole. */
  used: number
}

/**
 * Every whole frame in `bytes`. A file that comes in pieces is read by
 * calling this again with what was not `used` and the next piece in front:
 * `start` is 0 for the file's first bytes, where a tag may be.
 */
export function parseFrames(bytes: Uint8Array, start = true): Frames {
  const frames: Uint8Array[] = []
  let sampleRate = 0
  let channels = 0
  let i = 0
  if (start && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    if (bytes.length < 10) return { frames, samplesPerFrame: SAMPLES_PER_FRAME, sampleRate, channels, used: 0 }
    i = 10 + (((bytes[6] & 127) << 21) | ((bytes[7] & 127) << 14) | ((bytes[8] & 127) << 7) | (bytes[9] & 127))
    if (i > bytes.length) return { frames, samplesPerFrame: SAMPLES_PER_FRAME, sampleRate, channels, used: 0 }
  }
  let used = i
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) {
      i++
      used = i
      continue
    }
    const version = (bytes[i + 1] >> 3) & 3
    const layer = (bytes[i + 1] >> 1) & 3
    const rate = bytes[i + 2] >> 4
    const sample = (bytes[i + 2] >> 2) & 3
    const pad = (bytes[i + 2] >> 1) & 1
    // MPEG-1 (3) Layer III (1), a known bit rate and sample rate.
    if (version !== 3 || layer !== 1 || rate === 0 || rate === 15 || sample === 3) {
      i++
      used = i
      continue
    }
    const length = Math.floor((144000 * BIT_RATES[rate]) / SAMPLE_RATES[sample]) + pad
    if (i + length > bytes.length) break
    if (!sampleRate) {
      sampleRate = SAMPLE_RATES[sample]
      channels = bytes[i + 3] >> 6 === 3 ? 1 : 2
    }
    frames.push(bytes.subarray(i, i + length))
    i += length
    used = i
  }
  return { frames, samplesPerFrame: SAMPLES_PER_FRAME, sampleRate, channels, used }
}
