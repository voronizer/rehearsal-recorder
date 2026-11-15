/*
  How fast a take plays as it comes into the one player (#105). The take
  already there, in a new generation (РЭХА sent its files again), keeps
  its speed. Another take starts at 100% (Alex's pick C, 2026-11-15
  14:34:29Z), or at the speed its page kept while it waited, as the page
  keeps its repeat, M and S (Alex's pick A, 15:04:59Z).
*/

/** The speed of take `coming` once it is in the player, where `inPlayer` is the take there now at `now`. */
export function speedFor(coming: string, inPlayer: string, now: number, page: number | undefined): number {
  return coming === inPlayer ? now : (page ?? 1)
}
