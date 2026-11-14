/**
 * How much louder the service plays a take: one amount for all its tracks,
 * so the band's balance stays as recorded (Alex, 2026-11-14). It puts the
 * take's loudest moment, with every track at full level, at CEILING, so the
 * faders do not take it over full scale. The exception is tracks that cancel
 * each other, such as two mics on one cabinet in opposite polarity: turning
 * one down can make the sum louder. A take already over CEILING is turned
 * down to it.
 */

/** −1 dBFS. MP3 raised a measured take's loudest moment by 0.25 dB, so the
 *  take's files are given a decibel of room. */
export const CEILING = 0.891

/** +24 dB at most, so an almost silent take, such as a false start, does not
 *  have its hiss turned up further. */
export const MOST = 16

/** The amount for the generation `gen` the band hears, from the peak РЭХА
 *  sent and the generation it was counted for; 1 with no peak, a peak of
 *  another generation, or silence. */
export function gainOf(peak: number | null, peakGen: number | null, gen: number): number {
  if (peakGen !== gen || peak === null || peak <= 0) return 1
  return Math.min(MOST, CEILING / peak)
}
