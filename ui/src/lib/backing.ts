/**
 * A song's backing track as the interface sees it (backing-track spec,
 * Parts 5 and 6): what the metronome's status line goes on to say, the row's
 * own line, the song page's line, bar 1 typed and stepped, and the bars drawn
 * over the start of the file.
 *
 * Python keeps the file, bar 1 and the counted tempo, and says where the row
 * stands in `metronome_state`'s `backing`; what is here is only what the
 * screen decides from that.
 */

import type { MetronomeState, Signature, SongBacking } from "@/lib/api"
import { formatTempo } from "@/lib/format"
import { perBar } from "@/lib/metronome"

/** A sentence for the status line, amber when takes record without the
 *  backing track for a reason the band can put right. */
export type RowSentence = { text: string; amber: boolean }

/** Said of a copy deleted from the folder by hand, on the page and in the row. */
export function missingLine(name: string): string {
  return `${name} is missing from the Backing tracks folder.`
}

/**
 * The sentence the metronome's status line goes on with (Part 5), for the
 * next take's song and its backing track; null with no row, and for a song
 * without one or a free take, which the row says itself (rowLine).
 */
export function rowSentence(state: MetronomeState): RowSentence | null {
  const b = state.backing
  if (!b.row || b.song === null) return null
  if (b.song.missing) return { text: missingLine(b.song.name), amber: true }
  if (!b.on) return { text: "Backing track off: takes record without it.", amber: false }
  if (b.output_missing !== null) {
    return {
      text: b.output_missing
        ? `The backing track's output, ${b.output_missing}, is not connected. Takes record without it.`
        : "The backing track's output is not connected. Takes record without it.",
      amber: true,
    }
  }
  if (b.getting_ready) return { text: "Getting the backing track ready…", amber: false }
  const clicks = state.on && state.tempo !== null
  // The file plays at the tempo it was counted at: a click at another one
  // drifts away from it.
  if (clicks && b.song.tempo !== null && b.song.tempo !== state.tempo) {
    return {
      text: `The backing track was counted at ${b.song.tempo}: it will not follow ${state.tempo}.`,
      amber: false,
    }
  }
  return clicks
    ? { text: "The backing track comes in on bar 1, after the count-in.", amber: false }
    : { text: "The backing track starts with Record: no click, so no count-in.", amber: false }
}

/**
 * What the status line goes on with while a take records: that the backing
 * track's output went away, in amber, as the click's line says of its own.
 * The row shows the rest itself; null while it plays where it should, and
 * for a take without it.
 */
export function takeSentence(state: MetronomeState): RowSentence | null {
  const b = state.backing
  if (!b.playing || b.output_missing === null) return null
  return {
    text: b.output_missing
      ? `The backing track's output, ${b.output_missing}, is not connected.`
      : "The backing track's output is not connected.",
    amber: true,
  }
}

/**
 * What the row says in place of a file (Part 5): for a free take, and for a
 * song without a backing track, named as the library has it or else as
 * `name`, the next take's name as typed. Null when the row has a file to
 * show.
 */
export function rowLine(state: MetronomeState, name: string): string | null {
  const b = state.backing
  if (b.free) return "Free take: no backing track."
  if (b.song !== null) return null
  const title = state.song?.title ?? name
  return `No backing track for ${title}. It is added on the song's page in History.`
}

/** A line with links in the middle of its sentence, as lib/metronome's
 *  songLine: strings, and the words that are buttons. */
export type PageLine = {
  parts: (string | { label: string; action: "earlier" | "later" | "halve" | "double" | "take" })[]
}

const BEAT_LINKS: PageLine["parts"] = [
  " A beat off (a pickup)? One beat ",
  { label: "earlier", action: "earlier" },
  " or ",
  { label: "later", action: "later" },
  ".",
]

/**
 * The status line under a song page's backing-track section (Part 6),
 * chosen from what is stored: the counted tempo and the song's tempo, so it
 * reads the same when the page is opened again. `counting` is the file's
 * name while it is added. `took`: the song has just taken the counted tempo,
 * having none (add_backing), so halving or doubling it is offered too; once
 * the page is opened again the two read as one.
 */
export function pageLine(
  song: { tempo: number | null; signature: Signature | null },
  backing: SongBacking | null,
  counting: string | null,
  took = false
): PageLine {
  if (counting !== null) return { parts: [`Counting the tempo of ${counting}…`] }
  if (backing === null) {
    return {
      parts: [
        "One audio file, mono or stereo. Its tempo is counted when it is added; with no steady beat in it, bar 1 is set by ear.",
      ],
    }
  }
  if (backing.missing) return { parts: [missingLine(backing.name)] }
  const counted = backing.tempo
  if (counted === null) {
    return {
      parts: [
        song.tempo !== null
          ? `No steady beat in it (pads): the click keeps the song's ${song.tempo}. Drag bar 1 to where the band comes in, and check it with ▶.`
          : "No steady beat in it, and the song has no tempo: type or tap one above, or leave it, and the backing track plays from Record with no click.",
      ],
    }
  }
  const said = formatTempo(counted, song.signature ?? "4/4")
  if (song.tempo !== counted) {
    return {
      parts: [
        song.tempo === null
          ? `Counted ${said}; the song has no tempo until you `
          : `Counted ${said}; the song stays at ${song.tempo} until you `,
        { label: "take the backing track's tempo", action: "take" },
        ". Bar 1 on its first strong beat.",
      ],
    }
  }
  if (took) {
    return {
      parts: [
        `Counted ${said}, now the song's tempo; bar 1 on the first strong beat. Twice too fast or too slow: `,
        { label: "halve", action: "halve" },
        " or ",
        { label: "double", action: "double" },
        ".",
        ...BEAT_LINKS,
      ],
    }
  }
  return { parts: [`Counted ${said}, as the song; bar 1 on the first strong beat.`, ...BEAT_LINKS] }
}

/** Seconds to a hundredth, as Python keeps bar 1: what was typed or worked
 *  out, rounded half up on its written form, so 12.345 is 12.35. */
function hundredths(seconds: number): number {
  return Math.round(Number((seconds * 100).toFixed(6))) / 100
}

/** The last hundredth of a file `length` seconds long: bar 1 goes no later. */
function lastHundredth(length: number): number {
  return Math.floor(Number((length * 100).toFixed(6))) / 100
}

/**
 * Bar 1 typed into its field: "0:00.80" or "1:02.5", minutes and seconds,
 * or seconds alone, "0.8". To a hundredth. Null for anything else, a
 * negative time among them, and the field then puts back what it had.
 */
export function parseBarOne(text: string): number | null {
  const typed = text.trim()
  const m = /^(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)$/.exec(typed)
  if (!m) return null
  const seconds = Number(m[2])
  if (m[1] !== undefined && seconds >= 60) return null
  return hundredths((m[1] === undefined ? 0 : Number(m[1]) * 60) + seconds)
}

/**
 * Bar 1 moved by `delta` seconds (− and +, the arrow keys: a hundredth, a
 * tenth with Shift), to a hundredth, from the file's start to its last
 * hundredth. `length` null, the file's length unknown: only the start holds
 * it.
 */
export function stepBarOne(seconds: number, delta: number, length: number | null): number {
  const moved = Math.max(0, hundredths(seconds + delta))
  return length === null ? moved : Math.min(lastHundredth(length), moved)
}

/** One click of the song's tempo in seconds: a quarter in x/4, an eighth in
 *  6/8, as the counter found bar 1 among them. */
function clickSec(tempo: number): number {
  return 60 / tempo
}

/** Bar 1 one beat earlier or later (Part 6's links), a beat being one click
 *  at the counted tempo; to a hundredth, never before the file's start. */
export function beatShift(firstBar: number, tempo: number, _signature: Signature, by: 1 | -1): number {
  return Math.max(0, hundredths(firstBar + by * clickSec(tempo)))
}

/**
 * How much of the file's start the page draws (Part 6): to four bars past
 * bar 1, and 8 seconds at least, whatever the file's length (silence is
 * drawn past its end). With no tempo, no bars: 4 seconds past bar 1.
 */
export function drawnRange(
  firstBar: number,
  tempo: number | null,
  signature: Signature | null
): { end: number } {
  const past = tempo === null ? 4 : 4 * perBar(signature ?? "4/4") * clickSec(tempo)
  return { end: Math.max(8, firstBar + past) }
}

/** A line drawn over the file: `at` seconds in, and the bar it starts
 *  counted from 1, or null for a beat inside a bar. */
export type BarLine = { at: number; bar: number | null }

/** The song's bars and beats over the drawn file, from bar 1 to `end`;
 *  none with no tempo. Each worked out from its number, never added up. */
export function barLines(
  firstBar: number,
  tempo: number | null,
  signature: Signature | null,
  end: number
): BarLine[] {
  if (tempo === null) return []
  const bar = perBar(signature ?? "4/4")
  const click = clickSec(tempo)
  const lines: BarLine[] = []
  for (let k = 0; firstBar + k * click <= end + 1e-9; k++) {
    lines.push({ at: firstBar + k * click, bar: k % bar === 0 ? k / bar + 1 : null })
  }
  return lines
}
