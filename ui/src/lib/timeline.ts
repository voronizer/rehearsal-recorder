/**
 * Where the ruler puts its ticks. A forty-second take and a forty-minute one
 * both have to end up with a clock somebody can read, so the step is chosen
 * from a ladder rather than computed: the numbers people expect to see on a
 * clock are 5, 10, 15, 30 seconds and whole minutes, never 37.
 */
const TICK_LADDER = [5, 10, 15, 30, 60, 120, 300]

/** Ticks closer together than this stop being a scale and become noise. */
const MIN_TICK_GAP_PX = 80

export function tickStep(duration: number, width: number): number {
  const last = TICK_LADDER[TICK_LADDER.length - 1]
  if (duration <= 0 || width <= 0) return last
  for (const step of TICK_LADDER) {
    if ((step / duration) * width >= MIN_TICK_GAP_PX) return step
  }
  return last
}

/** Tick positions in seconds, from zero, never reaching the very end — a
 *  label at the right edge would be cut in half by it. */
export function tickTimes(duration: number, width: number): number[] {
  const step = tickStep(duration, width)
  const out: number[] = []
  for (let t = 0; t < duration; t += step) out.push(t)
  return out
}
