/**
 * Whether the tracks on the setup screen are still the lineup that was
 * picked, so its title can say "changed" and offer Update.
 *
 * Only what the person can change on the screen counts: the order, each
 * track's name, icon, input, stereo, what it records and the port its notes
 * come from. A default written out reads the same as one left out, so a
 * lineup saved before MIDI (no mode) is not "changed" against the same
 * tracks on Audio.
 */

import type { Track } from "@/lib/api"
import { modeOf } from "@/lib/midi"

/** How long a lineup's name may be: Python cuts it there too
 *  (layouts.NAME_MAX). */
export const LINEUP_NAME_MAX = 40

function sameTrack(a: Track, b: Track): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    !!a.stereo === !!b.stereo &&
    (a.icon ?? "") === (b.icon ?? "") &&
    (a.channel ?? null) === (b.channel ?? null) &&
    modeOf(a) === modeOf(b) &&
    (a.midi_port?.name ?? "") === (b.midi_port?.name ?? "")
  )
}

/** The same tracks in the same order. */
export function sameTracks(a: Track[], b: Track[]): boolean {
  return a.length === b.length && a.every((t, i) => sameTrack(t, b[i]))
}
