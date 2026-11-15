/**
 * What each track has been doing while it records, remembered from one poll
 * of the levels to the next.
 *
 * The recording screen is read from behind the kit, by people who were
 * playing rather than watching when something happened. So a clip stays on
 * its tile to the end of the take instead of flashing for one poll — it was
 * kept for a minute, and a minute is shorter than a song — and "silent"
 * waits a moment before it is said: a drum between hits is not a dead mic.
 */

/** A peak this close to full scale is a clip. */
export const CLIP_THRESHOLD = 0.97
/**
 * The bottom of every meter, in dB below full scale, as on a desk. A band
 * sets its gain for the loudest hit to reach about −18 dBFS: on a straight
 * scale that was an eighth of a meter, and the quiet passages were nothing.
 */
export const METER_FLOOR_DB = -60
/**
 * Below this an input is taken to be silent: the bottom of the meters. It
 * was −34 dBFS, where a singer playing quietly with the gain set for the
 * loudest hit sits, and a dead input on a desk's preamp lies far below this.
 */
export const QUIET_THRESHOLD = 10 ** (METER_FLOOR_DB / 20)

/**
 * How fast a meter falls back once the sound drops, as on a desk; it rises at
 * once. Dropping to each poll's level made a voice blink: in dB the quiet
 * between two syllables is half a tile.
 */
export const METER_FALL_DB_PER_SEC = 20

/**
 * Where a meter stands (a peak, 0..1) `ms` after it stood at `was`, now that
 * the latest peak is `peak`.
 */
export function fallBack(was: number, peak: number, ms: number): number {
  const fallen = was * 10 ** ((-METER_FALL_DB_PER_SEC * Math.max(0, ms)) / 20_000)
  return Math.max(peak, fallen)
}

/** How far up a meter a peak (0..1) reaches, 0..1, on a scale in dB. */
export function meterReach(peak: number): number {
  if (!(peak > 0)) return 0
  const db = 20 * Math.log10(peak)
  return Math.min(1, Math.max(0, 1 - db / METER_FLOOR_DB))
}
/** How long a track stays quiet before it is called silent. */
export const SILENT_AFTER_MS = 1_500
/** How long the line for the latest peak stays put before it falls back. */
const HOLD_MS = 1_500

export type TrackWatch = {
  /** Clips since the take began. */
  clips: number
  /** Clipping on the last poll, so a clip that goes on is counted once. */
  clipping: boolean
  /** Since when every side has been quiet, or null while it plays. */
  quietSince: number | null
  /** The highest peak each side reached lately, and when. */
  hold: { peak: number; at: number }[]
  /** Where each side's meter stands, falling back from its peaks. */
  shown: number[]
  /** When this poll was. */
  at: number
}

/** The track's state after one more poll of its peaks (0..1, one per side). */
export function watchStep(
  prev: TrackWatch | undefined,
  peaks: number[],
  now: number
): TrackWatch {
  const sides = peaks.length ? peaks : [0]
  const clipping = sides.some((p) => p > CLIP_THRESHOLD)
  const clips = (prev?.clips ?? 0) + (clipping && !prev?.clipping ? 1 : 0)

  const quiet = sides.every((p) => p < QUIET_THRESHOLD)
  const quietSince = quiet ? (prev?.quietSince ?? now) : null

  const hold = sides.map((peak, i) => {
    const held = prev?.hold[i]
    return held && held.peak >= peak && now - held.at < HOLD_MS
      ? held
      : { peak, at: now }
  })
  const since = prev ? now - prev.at : 0
  const shown = sides.map((peak, i) => fallBack(prev?.shown[i] ?? 0, peak, since))
  return { clips, clipping, quietSince, hold, shown, at: now }
}

/** Quiet for long enough to say so. */
export function isSilent(watch: TrackWatch | undefined, now: number): boolean {
  return (
    watch?.quietSince != null && now - watch.quietSince >= SILENT_AFTER_MS
  )
}

/**
 * In the band service a fader you moved shows a notch where РЭХА had the
 * track (LaneControls). This close to РЭХА's level, half a key step, the
 * fader is on it: the notch goes, and the service forgets your level.
 */
export const AT_REHA = 0.005
/**
 * A drag stops on the notch while the fader's knob covers it: half the knob
 * with its ring (`size-3.5` and `ring-2`, 18 px). Alex, 2026-11-15 16:02Z.
 */
export const STOP_PX = 9

/** The fader stands on РЭХА's level. */
export const atReha = (v: number, reha: number) => Math.abs(v - reha) < AT_REHA

/**
 * Where a drag puts the fader: on РЭХА's level while the knob would cover
 * the notch, else where the pointer is. `travel` is how far the knob's
 * centre moves along the fader, in px; 0 when it is not known yet.
 */
export const stopAtReha = (v: number, reha: number, travel: number) =>
  travel > 0 && Math.abs(v - reha) * travel < STOP_PX ? reha : v
