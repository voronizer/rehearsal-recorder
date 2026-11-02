/*
  A piece on repeat, from a to b seconds of the take. The player's clock
  runs on through every pass; `raw` is how far it has run, counted as if
  the take had no repeat. The first pass plays from wherever play started
  to b, every later one from a to b.
*/

/** Samples in each MP3 frame of a take's track (MPEG-1 Layer III). */
export const FRAME = 1152

/** Where the playhead is after the clock has run to `raw`. */
export function loopTime(raw: number, a: number, b: number): number {
  if (raw < b || b <= a) return raw
  return a + ((raw - b) % (b - a))
}

/** How much later on the clock a pass's sound is placed than its place in the take. */
export function passShift(pass: number, a: number, b: number): number {
  return pass * (b - a)
}

/**
 * The frames a pass decodes, up to `last`, out of the `have` that have come
 * of the file so far. `all` once those are every frame the pass needs: on
 * repeat, the frame b falls in and one more (`stop` is b as a sample);
 * with no repeat, the whole file.
 */
export function passFrames(stop: number, have: number, whole: boolean): { last: number; all: boolean } {
  if (!Number.isFinite(stop)) return { last: have, all: whole }
  const need = Math.ceil(stop / FRAME) + 1
  return { last: Math.min(have, need), all: whole || need <= have }
}
