/** M and S of a take's tracks: the muted ones, by their index, and the one
 *  heard alone. */
export type Desk = { muted: number[]; solo: number | null }

/*
  M and S on one track take each other off, here as in РЭХА's player
  (audio/player.py): both are never lit, so what plays is what the buttons
  show. S on another track leaves a muted one muted.
*/

/** Track `i`'s M turned on or off. */
export function withMute(d: Desk, i: number, on: boolean): Desk {
  return on
    ? { muted: d.muted.includes(i) ? d.muted : [...d.muted, i], solo: d.solo === i ? null : d.solo }
    : { muted: d.muted.filter((x) => x !== i), solo: d.solo }
}

/** Track `i` heard alone, or, with null, every track again. */
export function withSolo(d: Desk, i: number | null): Desk {
  return { muted: i === null ? d.muted : d.muted.filter((x) => x !== i), solo: i }
}
