/**
 * The metronome as the interface sees it: the four signatures and what a
 * tempo may be in each, a tempo typed or tapped, and the words the row's
 * status line and a song's page say (spec Parts 2, 4, 5, 7 and 11).
 *
 * Python keeps the tempo, the signature and a change held in the row, and
 * says where they stand in `metronome_state`; what is here is only what the
 * screen decides from that.
 */

import type { ClickSound, MetronomePhase, MetronomeState, Signature, SongGo } from "@/lib/api"
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

/** The longest a click stays lit, in milliseconds. */
const LIT_MAX_MS = 150

/** How long a click at `tempo` stays lit: half the time to the next click,
 *  and never more than 150 ms, so the light goes dark between clicks even at
 *  600 a minute. Nothing lights with no tempo. */
export function litFor(tempo: number | null): number {
  return tempo ? Math.min(LIT_MAX_MS, 30_000 / tempo) : 0
}

/** A click heard at `at` on the page's clock (performance.now()), the
 *  `index`th of its bar from 0. */
export type Click = { at: number; index: number }

/** An answer of `metronome_state`, and when on the page's clock it was
 *  given: its `upcoming` and `since_count_in_ms` count from then. */
export type Heard = { state: MetronomeState; at: number }

/** What the screen shows of the beat at a moment: the click lit (its index
 *  in the bar) or none, where the take is, and the count-in's click. `last`
 *  is the latest click heard, to carry into the next answer. */
export type Beat = { lit: number | null; phase: MetronomePhase; count: number; last: Click | null }

/**
 * The beat at `now`, from the last answer and the click lit before it.
 * Python says when the next clicks are heard and how far the count-in is,
 * and the screen counts on from that at each frame: no clock of its own
 * that could drift from the click (Part 5). The count-in ends when Python
 * said it would, and the take is on from then.
 */
export function beatAt(heard: Heard, last: Click | null, now: number): Beat {
  const { state, at } = heard
  let latest = last
  let passed = 0
  for (const [ms, index] of state.upcoming) {
    const t = at + ms
    if (t > now) continue
    passed += 1
    if (latest === null || t >= latest.at) latest = { at: t, index }
  }
  const lit = latest !== null && now - latest.at < litFor(state.tempo) ? latest.index : null
  const ended = state.since_count_in_ms !== null && state.since_count_in_ms + (now - at) >= 0
  const phase = state.phase === "count" && ended ? "take" : state.phase
  return { lit, phase, count: phase === "count" ? state.count + passed : 0, last: latest }
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

/** The click's output cannot play: by its name, or without one when Python
 *  has none for it (`output_missing` is then ""). */
function missingOutput(device: string): StatusLine {
  return {
    text: device
      ? `The click's output, ${device}, is not connected. The beat will only flash.`
      : "The click's output is not connected. The beat will only flash.",
    warn: true,
  }
}

/**
 * The line under the metronome row, always one of Part 4's and, while a take
 * is on, one of Part 5's. Save to song and Save now are offered only while
 * the row is held, and stay while the click's output cannot play; counting
 * from the last take only when the song has a take.
 */
export function statusLine(state: MetronomeState, counting: Counting = null): StatusLine {
  const hasTempo = state.tempo !== null
  if (state.phase === "count" || state.phase === "take") {
    if (!hasTempo) return { text: "No click: this take has no tempo." }
    // Python says "count" from Record and the time once it has chosen the
    // first click: until then nothing is heard, so nothing is counted. The
    // line keeps its room.
    if (state.phase === "count" && state.on && state.since_count_in_ms === null) return { text: "" }
    // A take that began with the switch off has no count-in to measure from
    // (`since_count_in_ms` is null), so switching it on mid-take starts no click.
    const unclicked = state.phase === "take" && state.since_count_in_ms === null
    if (!state.on || unclicked) return { text: "Click off. The tempo still goes into the take." }
    if (state.output_missing !== null) return missingOutput(state.output_missing)
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
  const line = caseLine(state)
  if (!hasTempo || state.output_missing === null) return line
  // The click's output cannot play. A change held keeps its line and its
  // link, so it can still be saved, with the warning's icon before it.
  return state.held && line.link ? { ...line, warn: true } : missingOutput(state.output_missing)
}

/** The status line between takes for where the row's tempo comes from
 *  (Part 2's three cases). */
function caseLine(state: MetronomeState): StatusLine {
  const hasTempo = state.tempo !== null
  switch (state.case) {
    case "song": {
      const song = state.song
      // The row is not the song's: a tempo held, which the link saves, or
      // the row emptied, which is not held (a song's tempo is taken away on
      // its page in History).
      if (song && song.tempo !== null && song.signature !== null && (state.held || !hasTempo)) {
        return {
          text: `The song has ${formatMeterShort(song.tempo, song.signature)}; this holds until another song.`,
          link: state.held ? { label: "Save to song", action: "save" } : undefined,
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

/**
 * The takes of a song its tempo can be counted from, as its page lists
 * them (Part 7): the starred ones first, then the newest, the last take of
 * the newest rehearsal at the top.
 */
export function takesToCount(goes: readonly SongGo[]): SongGo[] {
  return [...goes].sort(
    (a, b) =>
      Number(b.take.starred ?? false) - Number(a.take.starred ?? false) ||
      b.created_at.localeCompare(a.created_at) ||
      b.take.take_number - a.take.take_number
  )
}

/** A line of the click on Master: when, in the take's seconds, and whether
 *  it is the first of a bar. */
export type ClickLine = { t: number; bar: boolean }

/** Past this many clicks in view only the bars are drawn, and past the
 *  second only every fourth bar: closer, the lines would be a grey fill. */
const ALL_CLICKS = 120
const BARS_ONLY = 480

/**
 * The click of a click take between two of its times, as Master's lane
 * draws it (Part 8): its bars start at the files' first sample, so click k
 * is at k · 60 / tempo seconds, worked out from k and never added up. With
 * more than 120 clicks in view only the bars are drawn, with more than 480
 * every fourth bar, counted from the first, so a line stays where it is
 * while the view moves.
 */
export function clickLines(tempo: number, signature: Signature, from: number, to: number): ClickLine[] {
  const period = 60 / tempo
  const bar = perBar(signature)
  const inView = (to - from) / period
  const every = inView > BARS_ONLY ? 4 * bar : inView > ALL_CLICKS ? bar : 1
  const lines: ClickLine[] = []
  const first = Math.max(0, Math.ceil(from / period / every - 1e-9)) * every
  for (let k = first; k * period <= to + 1e-9; k += every) {
    lines.push({ t: k * period, bar: k % bar === 0 })
  }
  return lines
}

/** What a take says of the click it was recorded to (spec Part 1): a take
 *  from before the metronome says nothing, and is no click take. */
export type TakeClick = { tempo?: number | null; signature?: Signature | null; click?: boolean }

/** A click take's tempo and signature, or null for a take recorded without
 *  the click: one with the switch off has a tempo and no click to play. */
export function clickOf(take: TakeClick | null | undefined): { tempo: number; signature: Signature } | null {
  if (!take?.click || !take.tempo || !take.signature) return null
  return { tempo: take.tempo, signature: take.signature }
}
