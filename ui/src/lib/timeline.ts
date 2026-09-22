/**
 * Where the ruler puts its ticks. A forty-second take and a forty-minute one
 * both have to end up with a clock somebody can read, so the step is chosen
 * from a ladder rather than computed: the numbers people expect to see on a
 * clock are 1, 2, 5, 10, 15, 30 seconds and whole minutes, never 37.
 *
 * It starts at one second because the shortest window zoom will give is two
 * (MIN_VIEW_SEC): a ladder starting at five leaves a zoomed ruler with no
 * ticks and no labels on it most of the time, flickering between one and none
 * as the window is panned.
 */
const TICK_LADDER = [1, 2, 5, 10, 15, 30, 60, 120, 300]

/** Ticks closer together than this stop being a scale and become noise. */
const MIN_TICK_GAP_PX = 80

function tickStep(duration: number, width: number): number {
  const last = TICK_LADDER[TICK_LADDER.length - 1]
  if (duration <= 0 || width <= 0) return last
  for (const step of TICK_LADDER) {
    if ((step / duration) * width >= MIN_TICK_GAP_PX) return step
  }
  return last
}

/** The shortest window the timeline will zoom to. Below this the picture is
 *  detail nobody is looking for, and the gesture becomes twitchy. */
export const MIN_VIEW_SEC = 2

/** Tick positions in seconds across the visible window, never reaching its
 *  very end — a label at the right edge would be cut in half by it. Ticks stay
 *  on round numbers however far along the take the window has been moved. */
export function tickTimes(from: number, to: number, width: number): number[] {
  const step = tickStep(to - from, width)
  const out: number[] = []
  for (let t = Math.ceil(from / step) * step; t < to; t += step) out.push(t)
  return out
}
