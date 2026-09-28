/**
 * What each track has been doing while it records, remembered from one poll
 * of the levels to the next.
 *
 * The recording screen is read from behind the kit, by people who were
 * playing rather than watching when something happened. So a clip is kept
 * for a minute instead of flashing for one poll, and "silent" waits a moment
 * before it is said — a drum between hits is not a dead mic.
 */

/** A peak this close to full scale is a clip. */
export const CLIP_THRESHOLD = 0.97
/** Below this an input is taken to be silent. */
export const QUIET_THRESHOLD = 0.02
/** How long a clip is remembered. */
export const CLIP_MEMORY_MS = 60_000
/** How long a track stays quiet before it is called silent. */
export const SILENT_AFTER_MS = 1_500
/** How long the line for the latest peak stays put before it falls back. */
const HOLD_MS = 1_500

export type TrackWatch = {
  /** When each clip began, oldest first; none older than CLIP_MEMORY_MS. */
  clips: number[]
  /** Clipping on the last poll, so a clip that goes on is counted once. */
  clipping: boolean
  /** Since when every side has been quiet, or null while it plays. */
  quietSince: number | null
  /** The highest peak each side reached lately, and when. */
  hold: { peak: number; at: number }[]
}

/** The track's state after one more poll of its peaks (0..1, one per side). */
export function watchStep(
  prev: TrackWatch | undefined,
  peaks: number[],
  now: number
): TrackWatch {
  const sides = peaks.length ? peaks : [0]
  const clipping = sides.some((p) => p > CLIP_THRESHOLD)
  const clips = (prev?.clips ?? []).filter((at) => now - at < CLIP_MEMORY_MS)
  if (clipping && !prev?.clipping) clips.push(now)

  const quiet = sides.every((p) => p < QUIET_THRESHOLD)
  const quietSince = quiet ? (prev?.quietSince ?? now) : null

  const hold = sides.map((peak, i) => {
    const held = prev?.hold[i]
    return held && held.peak >= peak && now - held.at < HOLD_MS
      ? held
      : { peak, at: now }
  })
  return { clips, clipping, quietSince, hold }
}

/** Quiet for long enough to say so. */
export function isSilent(watch: TrackWatch | undefined, now: number): boolean {
  return (
    watch?.quietSince != null && now - watch.quietSince >= SILENT_AFTER_MS
  )
}

/** Clips in the last minute — the ones a later poll has not yet dropped. */
export function clipsInLastMinute(
  watch: TrackWatch | undefined,
  now: number
): number {
  return (watch?.clips ?? []).filter((at) => now - at < CLIP_MEMORY_MS).length
}
