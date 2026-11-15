/** M and S of a take's tracks: the muted ones and the soloed ones, by their index. */
export type Desk = { muted: number[]; solo: number[] }

/*
  M and S on one track take each other off, here as in РЭХА's player
  (audio/player.py): both are never lit, so what plays is what the buttons
  show. S on another track leaves a muted one muted. Each S adds its track
  to the ones heard; pressed again, it takes it away (Alex, 2026-11-15).
*/

/** Track `i`'s M turned on or off. */
export function withMute(d: Desk, i: number, on: boolean): Desk {
  return on
    ? { muted: d.muted.includes(i) ? d.muted : [...d.muted, i], solo: d.solo.filter((x) => x !== i) }
    : { muted: d.muted.filter((x) => x !== i), solo: d.solo }
}

/** Track `i`'s S turned on or off. */
export function withSolo(d: Desk, i: number, on: boolean): Desk {
  return on
    ? { muted: d.muted.filter((x) => x !== i), solo: d.solo.includes(i) ? d.solo : [...d.solo, i] }
    : { muted: d.muted, solo: d.solo.filter((x) => x !== i) }
}

/** Whether track `i` is heard: with S on, only the soloed tracks; with none, all but the muted. */
export const heard = (d: Desk, i: number): boolean => (d.solo.length ? d.solo.includes(i) : !d.muted.includes(i))
