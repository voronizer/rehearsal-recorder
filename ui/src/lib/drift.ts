import type { NotesFile, Signature, TrackFile } from "@/lib/api"
import { formatMeter, formatTempo } from "@/lib/format"
import type { TakeClick } from "@/lib/metronome"

/**
 * Where the band drifted (drift spec Part 3): the arithmetic of the line
 * along Master's lane. Python counts each bar's tempo (`take_drift`); which
 * bars ran ahead or dragged is found here, so a change of the tolerance in
 * Settings redraws the line without counting the take again.
 */

/** How far off a bar may be before it can turn amber: Settings › Click & backing track's
 *  "Drift shown past". */
export const TOLERANCES = [0.01, 0.02, 0.03, 0.05] as const
export type DriftTolerance = (typeof TOLERANCES)[number]
export const DEFAULT_TOLERANCE: DriftTolerance = 0.02

/** The lane's top and bottom edges: this far off the aim either way. A bar
 *  further off is drawn at the edge. */
export const RANGE = 0.08

/** A stretch is this many bars off the same way, or more. */
const MIN_STRETCH = 2
/** Stretches the same way with this many bars or fewer between them are one. */
const JOIN_GAP = 2

export type DriftBar = {
  n: number
  start: number
  end: number
  tempo: number | null
}

/** What the line is measured against (spec Part 1): the click the take was
 *  recorded to, the take's own tempo with the click off, the song's tempo
 *  now, or the middle of the take's own bars. */
export type DriftAim = {
  tempo: number
  signature: Signature
  from: "click" | "take" | "song" | "middle"
  song: string | null
}

export type TakeDrift =
  | {
      ok: true
      /** What it was counted from: the drums' .mid, their audio, or every
       *  track summed. */
      source: "drums-mid" | "drums" | "mix"
      per_bar: number
      middle: number
      aim: DriftAim
      bars: DriftBar[]
    }
  | {
      ok: false
      why?: "short" | "no-beat" | "missing" | "recording"
      error?: string
    }

/** What the player knows of a take's drift line: the answer once it is
 *  here, and whether it is on its way. */
export type DriftView = { answer: TakeDrift | null; counting: boolean }

/** A take as the player has it: its click for Master's stripes, and its
 *  files and song for the drift line. */
export type DriftTake = TakeClick & {
  song?: string | null
  tracks?: TrackFile[]
  notes?: NotesFile[]
  /** How long the take is: a crop changes it, and the line is asked for
   *  again. */
  duration_sec?: number
}

/** Bars `first` to `last` (indices into the bars), off the same way: `sign`
 *  1 ahead, -1 behind. `chip` is the number it says, in whole beats a
 *  minute, signed; `peak` the bar the chip stands over. */
export type Stretch = {
  first: number
  last: number
  sign: 1 | -1
  chip: number
  peak: number
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The stretches of a take's bars: two or more bars off the aim the same way
 * by more than `tolerance`, joined across two bars or fewer. A bar with no
 * tempo is off neither way. The chip is the stretch's largest difference
 * after a three-bar median, so one rough bar does not inflate it.
 */
export function stretches(bars: DriftBar[], aim: number, tolerance: number): Stretch[] {
  const sign = bars.map((b) =>
    b.tempo === null || Math.abs(b.tempo / aim - 1) <= tolerance ? 0 : b.tempo > aim ? 1 : -1
  )
  const runs: { first: number; last: number; sign: 1 | -1 }[] = []
  for (let i = 0; i < sign.length; ) {
    if (sign[i] === 0) {
      i++
      continue
    }
    let j = i
    while (j + 1 < sign.length && sign[j + 1] === sign[i]) j++
    const last = runs[runs.length - 1]
    if (j - i + 1 >= MIN_STRETCH) {
      if (last && last.sign === sign[i] && i - last.last - 1 <= JOIN_GAP) last.last = j
      else runs.push({ first: i, last: j, sign: sign[i] as 1 | -1 })
    }
    i = j + 1
  }
  return runs.map((r) => {
    let peak = r.first
    let most = 0
    for (let i = r.first; i <= r.last; i++) {
      const near = bars
        .slice(Math.max(0, i - 1), i + 2)
        .map((b) => b.tempo)
        .filter((t): t is number => t !== null)
      if (bars[i].tempo === null || !near.length) continue
      const d = median(near) - aim
      if (Math.sign(d) === r.sign && Math.abs(d) > most) {
        most = Math.abs(d)
        peak = i
      }
    }
    // A bar is off by more than the tolerance, so never by 0 bpm.
    return { ...r, chip: r.sign * Math.max(1, Math.round(most)), peak }
  })
}

/** A chip's height, and the room kept between it and the line, in px. */
const CHIP_PX = 16
const CHIP_GAP_PX = 3
/** Chips whose centres come closer than this would overlap: the smaller
 *  difference's is hidden. */
export const CHIP_ROOM_PX = 32

/** How far a chip beside its peak stands from it, in px. */
const CHIP_BESIDE_PX = 6

export type Box = { width: number; height: number }

/** Where a chip stands: `x` is its middle, start or end (`align`), in px. */
export type ChipSpot = { x: number; top: number; align: "middle" | "start" | "end" }

/**
 * Where a stretch's chip goes, given its bars' points in px, the peak first
 * and then the rest from the nearest: above a rise and below a dip, or on
 * the line's other side where the lane's edge leaves no room; else beside
 * the peak, on the side away from the lane's nearer end. Never past either
 * end of the lane. Where the lane's tag (`clear`) is over the peak, the chip
 * moves along its stretch to the nearest bar clear of it; a stretch the tag
 * covers end to end has its chip over the tag, which the number matters more
 * than. Null only for a lane too small for a chip. Its box is taken as
 * CHIP_ROOM_PX wide.
 */
export function chipSpot(
  sign: 1 | -1,
  points: { x: number; y: number }[],
  lane: Box,
  clear: { right: number; bottom: number } | null
): ChipSpot | null {
  const w = CHIP_ROOM_PX
  const free = (left: number, top: number) =>
    left >= 0 &&
    left + w <= lane.width &&
    top >= 1 &&
    top + CHIP_PX <= lane.height - 1 &&
    !(clear && top < clear.bottom && left < clear.right)
  const over = ({ x, y }: { x: number; y: number }): ChipSpot | null => {
    const middle = Math.min(lane.width - w / 2, Math.max(w / 2, x))
    const above = y - CHIP_GAP_PX - CHIP_PX
    const below = y + CHIP_GAP_PX
    for (const top of sign > 0 ? [above, below] : [below, above])
      if (free(middle - w / 2, top)) return { x: middle, top, align: "middle" }
    return null
  }
  const beside = ({ x, y }: { x: number; y: number }): ChipSpot | null => {
    const top = Math.min(lane.height - 1 - CHIP_PX, Math.max(1, y - CHIP_PX / 2))
    const at = Math.min(lane.width - w - CHIP_BESIDE_PX, Math.max(w + CHIP_BESIDE_PX, x))
    if (at > lane.width / 2) return free(at - CHIP_BESIDE_PX - w, top) ? { x: at - CHIP_BESIDE_PX, top, align: "end" } : null
    return free(at + CHIP_BESIDE_PX, top) ? { x: at + CHIP_BESIDE_PX, top, align: "start" } : null
  }
  const [peak, ...rest] = points
  if (!peak) return null
  for (const spot of [over(peak), beside(peak)]) if (spot) return spot
  for (const p of rest) {
    const spot = over(p)
    if (spot) return spot
  }
  return clear ? chipSpot(sign, [peak], lane, null) : null
}

/**
 * The stretches whose chips can be shown, given where each would stand in
 * pixels: where two would come closer than `room`, the smaller difference's
 * is hidden, and its stretch is still drawn amber.
 */
export function chipsShown(found: Stretch[], xOf: (s: Stretch) => number, room: number): Set<Stretch> {
  const shown: Stretch[] = []
  for (const s of [...found].sort((a, b) => Math.abs(b.chip) - Math.abs(a.chip))) {
    if (shown.every((t) => Math.abs(xOf(t) - xOf(s)) >= room)) shown.push(s)
  }
  return new Set(shown)
}

/** "+7", "−5" (a true minus), "0". */
export function signed(d: number): string {
  return d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0"
}

/** How high a tempo sits in the lane, 0 at the top and 100 at the bottom:
 *  the aim in the middle, RANGE either way at the edges. */
export function yOf(tempo: number, aim: number): number {
  return Math.min(96, Math.max(4, 50 - ((tempo / aim - 1) / RANGE) * 50))
}

/** Master's tag for a counted take, in parts, so the lane can draw 6/8's
 *  eighth: `lead`, then the tempo (with its signature when `meter`), then
 *  `tail`. */
export type DriftTag = {
  lead: string
  tempo: number
  signature: Signature
  meter: boolean
  tail: string
}

export function driftTag(drift: Extract<TakeDrift, { ok: true }>): DriftTag {
  const { tempo, signature, from, song } = drift.aim
  const lead =
    from === "click" ? "Click" : from === "take" ? "No click ·" : from === "song" ? (song ?? "") : "No tempo · middle"
  return {
    lead,
    tempo,
    signature,
    meter: from === "click" || from === "take",
    tail: drift.source === "mix" ? " · from the mix" : "",
  }
}

/** The tag in plain words: "Click 128 bpm · 4/4", "Pałyn 128 bpm". */
export function tagText(tag: DriftTag): string {
  const tempo = tag.meter ? formatMeter(tag.tempo, tag.signature) : formatTempo(tag.tempo, tag.signature)
  return `${tag.lead} ${tempo}${tag.tail}`
}

/** What a tempo is counted in, said in words, for a screen reader. */
function unitWords(signature: Signature): string {
  return signature === "6/8" ? "eighths a minute" : "bpm"
}

/** The stretches as a screen reader says them: "Tempo: ahead 7 bpm, bars 46
 *  to 68; behind 5 bpm, bars 70 to 75." or "Tempo: steady." */
export function spokenDrift(bars: DriftBar[], found: Stretch[], signature: Signature): string {
  if (!found.length) return "Tempo: steady."
  const said = found.map(
    (s) =>
      `${s.sign > 0 ? "ahead" : "behind"} ${Math.abs(s.chip)} ${unitWords(signature)}, bars ${bars[s.first].n} to ${bars[s.last].n}`
  )
  return `Tempo: ${said.join("; ")}.`
}
