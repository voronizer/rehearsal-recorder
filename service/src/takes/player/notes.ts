import { parseMidi } from "midi-file"

/*
  A take's .mid read back as the notes РЭХА's player draws: a grid of drum
  rows for a kit, a piano roll for anything else. The rules are РЭХА's own
  (src/rehearsal_recorder/midi/notes.py and smf.read_events), so a take looks
  the same on the band's page as in РЭХА; midi-file only takes the file apart.
*/

/** The rows of the drum grid, top to bottom; the row after the last is Other. */
export const DRUM_ROWS = ["Crash", "Ride", "Hi-hat", "Toms", "Snare", "Kick"]
const OTHER = DRUM_ROWS.length
const [CRASH, RIDE, HIHAT, TOMS, SNARE, KICK] = [0, 1, 2, 3, 4, 5]

/** The General MIDI drum notes of a kit's six rows, and the notes e-kits use beside them. */
const DRUM_MAP: Record<number, number> = {
  36: KICK, 35: KICK,
  38: SNARE, 40: SNARE, 37: SNARE,
  42: HIHAT, 44: HIHAT, 46: HIHAT, 22: HIHAT, 26: HIHAT,
  48: TOMS, 50: TOMS, 45: TOMS, 47: TOMS, 43: TOMS, 41: TOMS, 58: TOMS,
  51: RIDE, 53: RIDE, 59: RIDE,
  49: CRASH, 55: CRASH, 57: CRASH, 52: CRASH,
}

/** Channel 10 counted from 1. */
const DRUM_CHANNEL = 9
/** Every .mid starts at 120 a minute; a file timed in frames is read as 960 ticks to the beat. */
const DEFAULT_TEMPO = 500_000
const TICKS_PER_BEAT = 960

/** [start, length, row or pitch, velocity], seconds from the take's start. */
export type Note = [number, number, number, number]
export type Notes = { drums: true; rows: string[]; notes: Note[] } | { drums: false; low: number; high: number; notes: Note[] }

type Hit = { kind: "on" | "off"; channel: number; note: number; velocity: number }

const micro = (seconds: number) => Math.round(seconds * 1e6) / 1e6

/**
 * Throws unless every chunk the file has is all there and it has as many
 * tracks as its header says: midi-file reads past the end of a file cut short
 * as if it were empty, where РЭХА's reader refuses it.
 */
function whole(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const id = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 14 || id(0) !== "MThd" || view.getUint32(4) < 6) throw new Error("Not a .mid")
  const tracks = view.getUint16(10)
  let found = 0
  for (let at = 0; at < bytes.length; ) {
    if (at + 8 > bytes.length) throw new Error("The .mid is cut short")
    const next = at + 8 + view.getUint32(at + 4)
    if (next > bytes.length) throw new Error("The .mid is cut short")
    if (id(at) === "MTrk") found++
    at = next
  }
  if (found < tracks) throw new Error("The .mid is cut short")
}

/**
 * Every channel and SysEx event of the file as [seconds, the note it is, if
 * any], in time order across its tracks, through its own ticks to the beat
 * and tempo changes (120 a minute until the first).
 */
function events(bytes: Uint8Array): [number, Hit | null][] {
  whole(bytes)
  let mid: ReturnType<typeof parseMidi>
  try {
    mid = parseMidi(bytes)
  } catch (e) {
    // midi-file throws plain strings.
    throw e instanceof Error ? e : new Error(String(e))
  }
  const found: [number, Hit | null][] = []
  const tempos: [number, number][] = []
  for (const track of mid.tracks) {
    let tick = 0
    for (const e of track) {
      tick += e.deltaTime
      if (e.type === "setTempo") tempos.push([tick, e.microsecondsPerBeat])
      else if (e.type === "noteOn" || e.type === "noteOff")
        found.push([tick, { kind: e.type === "noteOn" ? "on" : "off", channel: e.channel, note: e.noteNumber, velocity: e.velocity }])
      else if (!("meta" in e && e.meta)) found.push([tick, null])
    }
  }
  // Stable, so what is on one tick keeps the order the file has it in.
  found.sort((a, b) => a[0] - b[0])
  tempos.sort((a, b) => a[0] - b[0])

  const perBeat = mid.header.ticksPerBeat && mid.header.ticksPerBeat > 0 ? mid.header.ticksPerBeat : TICKS_PER_BEAT
  const perSecond = perBeat * 1_000_000
  let segmentTick = 0
  let segmentUnits = 0
  let tempo = DEFAULT_TEMPO
  let next = 0
  return found.map(([tick, hit]) => {
    while (next < tempos.length && tempos[next][0] <= tick) {
      const [changeTick, changed] = tempos[next]
      segmentUnits += (changeTick - segmentTick) * tempo
      segmentTick = changeTick
      tempo = changed
      next++
    }
    return [(segmentUnits + (tick - segmentTick) * tempo) / perSecond, hit]
  })
}

/**
 * The notes of a .mid, for the player. A kit when `drumsIcon` says the track
 * has the drums icon or, without it, when every note-on is on channel 10 and
 * there is one. A release closes the oldest note still sounding on its
 * channel and note; a note-on at velocity 0 is a release; a note never
 * released lasts to the file's last event. Throws for bytes that are not a
 * readable .mid.
 */
export function readNotes(bytes: Uint8Array, drumsIcon: boolean): Notes {
  const all = events(bytes)
  const end = all.length ? all[all.length - 1][0] : 0

  const notes: Note[] = []
  const sounding = new Map<string, [number, Note][]>()
  const onChannels = new Set<number>()
  for (const [seconds, hit] of all) {
    if (!hit) continue
    const key = `${hit.channel}:${hit.note}`
    if (hit.kind === "on" && hit.velocity > 0) {
      const note: Note = [micro(seconds), 0, hit.note, hit.velocity]
      notes.push(note)
      const held = sounding.get(key)
      if (held) held.push([seconds, note])
      else sounding.set(key, [[seconds, note]])
      onChannels.add(hit.channel)
    } else {
      const oldest = sounding.get(key)?.shift()
      if (oldest) oldest[1][1] = micro(seconds - oldest[0])
    }
  }
  for (const held of sounding.values()) for (const [began, note] of held) note[1] = micro(end - began)

  if (drumsIcon || (onChannels.size === 1 && onChannels.has(DRUM_CHANNEL))) {
    for (const note of notes) note[2] = DRUM_MAP[note[2]] ?? OTHER
    return { drums: true, rows: notes.some((n) => n[2] === OTHER) ? [...DRUM_ROWS, "Other"] : [...DRUM_ROWS], notes }
  }
  if (!notes.length) return { drums: false, low: 60, high: 71, notes }
  const pitches = notes.map((n) => n[2])
  return {
    drums: false,
    low: Math.floor(Math.min(...pitches) / 12) * 12,
    high: Math.min(Math.floor(Math.max(...pitches) / 12) * 12 + 11, 127),
    notes,
  }
}
