/**
 * The metronome as the interface sees it: the four signatures and what a
 * tempo may be in each, a tempo typed or tapped, and the words the row's
 * status line and a song's page say (spec Parts 2, 4, 5, 7 and 11).
 *
 * Python keeps the tempo, the signature and a change held in the row, and
 * says where they stand in `metronome_state`; what is here is only what the
 * screen decides from that.
 */

import type { ClickSound, MetronomeState, Signature } from "@/lib/api"
import { formatMeterShort } from "@/lib/format"

/** The four, in the order the select lists them. */
export const SIGNATURES: readonly Signature[] = ["4/4", "3/4", "2/4", "6/8"]

/** The three sounds with the names Settings gives them. */
export const CLICK_SOUNDS: readonly { id: ClickSound; label: string }[] = [
  { id: "click", label: "Click" },
  { id: "wood", label: "Woodblock" },
  { id: "hihat", label: "Hi-hat" },
]

/** Clicks to a bar: a quarter each in x/4, an eighth each in 6/8. */
export function perBar(signature: Signature): number {
  return { "4/4": 4, "3/4": 3, "2/4": 2, "6/8": 6 }[signature]
}

/** What a tempo may be: 30 to 300 counting quarters, 60 to 600 counting the
 *  eighths of 6/8, so that a fast 6/8 fits. */
export function tempoRange(signature: Signature): { min: number; max: number } {
  return signature === "6/8" ? { min: 60, max: 600 } : { min: 30, max: 300 }
}

/** A tempo rounded and kept in the signature's range. */
export function clampTempo(tempo: number, signature: Signature): number {
  const { min, max } = tempoRange(signature)
  return Math.min(max, Math.max(min, Math.round(tempo)))
}

/** How loud a click is: 2 for the first of a bar, 1 for 6/8's fourth, the
 *  middle of its two groups of three, else 0. `index` counts from 0 and may
 *  run past the bar. */
export function accentOf(signature: Signature, index: number): 0 | 1 | 2 {
  const i = index % perBar(signature)
  if (i === 0) return 2
  return signature === "6/8" && i === 3 ? 1 : 0
}

/** What the tempo counts, for the tooltip on its unit. */
export function unitTitle(signature: Signature): string {
  return signature === "6/8" ? "Eighths a minute: the six clicks of a bar" : "Beats a minute"
}

/**
 * What was typed into the tempo field. Empty means no tempo; a number is
 * rounded and kept in the signature's range, so a 6/8 number pasted into
 * 4/4 comes out as the most 4/4 has; anything else puts `last`, the value
 * the field had, back.
 */
export function parseTempo(text: string, signature: Signature, last: number | null): number | null {
  const typed = text.trim()
  if (typed === "") return null
  // A point or a comma for the fraction; no exponents, no letters, no units.
  if (!/^[-−+]?\d+(?:[.,]\d+)?$/.test(typed)) return last
  return clampTempo(Number(typed.replace("−", "-").replace(",", ".")), signature)
}

/** A pause this long, in milliseconds, between two taps starts the count again. */
const TAP_PAUSE_MS = 2000

/** The taps that count towards a tempo: the last four gaps. */
const TAP_GAPS = 4

/**
 * The tempo the taps beat: the average of the last four gaps between them,
 * from the taps since the last pause of more than two seconds. A tap is a
 * click, so in 6/8 it is an eighth. null until there are two taps to make a
 * gap of.
 */
export function tapTempo(timesMs: number[], signature: Signature): number | null {
  const times = [...timesMs].sort((a, b) => a - b)
  let from = 0
  for (let i = 1; i < times.length; i++) if (times[i] - times[i - 1] > TAP_PAUSE_MS) from = i
  const gaps = times
    .slice(from + 1)
    .map((t, i) => t - times[from + i])
    .slice(-TAP_GAPS)
  if (gaps.length === 0) return null
  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length
  // Two hits at once make no tempo.
  if (!(mean > 0)) return null
  return clampTempo(60_000 / mean, signature)
}

/**
 * Which click of the bar the count-in is on, and how many a bar has: "2 of
 * 4". Python counts the clicks of the whole count-in; a count-in of two bars
 * counts the bar twice (Part 5), whether the number runs on or starts again.
 */
export function countDigit(count: number, perBar: number): { digit: number; of: number } {
  return { digit: ((Math.max(1, count) - 1) % perBar) + 1, of: perBar }
}

/**
 * "Count it from the last take" (Part 10), which the row holds while it is
 * open: null before it has been used, "running" while Python listens, then
 * the name of the take it counted from ("Dym 5").
 */
export type Counting = null | "running" | { from: string }

/** What the status line says, and the one link that may follow it, which
 *  the screen draws as a link button after the text. `warn` puts the
 *  warning icon before it, the words keeping the text's colour. */
export type StatusLine = {
  text: string
  link?: { label: string; action: "save" | "count" }
  warn?: boolean
}

/** How the row's line and the song page's begin for a song with no tempo yet. */
const NO_TEMPO_YET = "No tempo yet: type or tap one"

function missingOutput(device: string): StatusLine {
  return { text: `The click's output, ${device}, is not connected. The beat will only flash.`, warn: true }
}

/**
 * The line under the metronome row, always one of Part 4's and, while a take
 * is on, one of Part 5's. Save to song and Save now are offered only while
 * the row is held; counting from the last take only when the song has a take.
 */
export function statusLine(state: MetronomeState, counting: Counting = null): StatusLine {
  const hasTempo = state.tempo !== null
  if (state.phase === "count" || state.phase === "take") {
    if (!hasTempo) return { text: "No click: this take has no tempo." }
    // A take that began with the switch off has no count-in to measure from
    // (`since_count_in_ms` is null), so switching it on mid-take starts no click.
    const unclicked = state.phase === "take" && state.since_count_in_ms === null
    if (!state.on || unclicked) return { text: "Click off. The tempo still goes into the take." }
    if (state.output_missing) return missingOutput(state.output_missing)
    if (state.phase === "take") return { text: "Clicking to Stop." }
    const { digit, of } = countDigit(state.count, state.per_bar)
    return { text: `Count-in: ${digit} of ${of}` }
  }

  if (!state.on) return { text: "Off: takes record without the click." }
  if (counting === "running") return { text: "Counting the tempo from the last take…" }
  // The count is over once the row is saved: the song's own line is back.
  if (counting && state.held) {
    return {
      text: `Counted from ${counting.from}. Pick the time signature, then`,
      link: { label: "save it to the song", action: "save" },
    }
  }
  if (hasTempo && state.output_missing) return missingOutput(state.output_missing)

  switch (state.case) {
    case "song": {
      const song = state.song
      if (state.held && song && song.tempo !== null && song.signature !== null) {
        return {
          text: `The song has ${formatMeterShort(song.tempo, song.signature)}; this holds until another song.`,
          link: { label: "Save to song", action: "save" },
        }
      }
      return { text: "The song's tempo." }
    }
    case "song_without":
      if (hasTempo) {
        return {
          text: "No tempo in the song yet: the first take played to the click keeps this one.",
          link: state.held ? { label: "Save now", action: "save" } : undefined,
        }
      }
      return state.last_take
        ? {
            text: `${NO_TEMPO_YET}, or`,
            link: { label: "count it from the last take", action: "count" },
          }
        : { text: `${NO_TEMPO_YET}.` }
    case "free":
      return {
        text: hasTempo
          ? "Free take: this tempo stays with the take only."
          : "Free take: no click unless you set a tempo.",
      }
  }
}

/** A line with links in the middle of its sentence: strings, and the words
 *  that are buttons. */
export type SongLine = { parts: (string | { label: string; action: "count" | "halve" | "double" })[] }

/**
 * The line under a song's tempo row in History (Part 7): what to do for a
 * song with none, what a count did (`counted` is the take's name) and how to
 * mend it, or where the song's tempo goes.
 */
export function songLine(title: string, tempo: number | null, counted: string | null): SongLine {
  if (counted !== null) {
    return {
      parts: [
        `Counted from ${counted}; pick the time signature. If the click runs twice too fast or too slow: `,
        { label: "halve", action: "halve" },
        " or ",
        { label: "double", action: "double" },
        ".",
      ],
    }
  }
  if (tempo === null) {
    return {
      parts: [
        `${NO_TEMPO_YET}, or `,
        { label: "count it from a take", action: "count" },
      ],
    }
  }
  return { parts: [`Picking ${title} at a rehearsal puts this in the metronome.`] }
}
