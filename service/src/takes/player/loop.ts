/*
  A piece on repeat, from a to b seconds of the take. The player's clock
  runs on through every pass; `raw` is how far it has run, counted as if
  the take had no repeat. The first pass plays from wherever play started
  to b, every later one from a to b.
*/

/** Where the playhead is after the clock has run to `raw`. */
export function loopTime(raw: number, a: number, b: number): number {
  if (raw < b || b <= a) return raw
  return a + ((raw - b) % (b - a))
}

/** How much later on the clock a pass's sound is placed than its place in the take. */
export function passShift(pass: number, a: number, b: number): number {
  return pass * (b - a)
}
