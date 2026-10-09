/**
 * What a track's mode means, and how a take's lanes are laid out, as plain
 * functions: the interface's side of src/rehearsal_recorder/midi/rules.py.
 *
 * A track records *audio*, *both* or *midi*. Everything on screen that asks
 * what a track does asks it here. `notesProblem` says in Python's own words
 * (rules.notes_problem) what would stop a rehearsal, so the setup screen can
 * grey Start out and say why before asking; it has to keep saying what Python
 * says, sentence for sentence, or the person is told one thing here and
 * another after pressing Start.
 *
 * A track with no mode, or a mode nobody here knows, records audio. That is
 * how every band, template and rehearsal saved before MIDI reads.
 */

import type { MidiPortRef, MissingNotes, NotesFile, RecordMode, TrackFile } from "@/lib/api"

/**
 * What these functions look at of a track. Track and PlacedTrack both fit it,
 * and it takes what Python tolerates too: a mode of any text, and a port kept
 * as a bare name.
 */
export type ModedTrack = {
  mode?: string | null
  midi_port?: MidiPortRef | string | null
}

/** The track's mode. "audio" when it has none, or one that is not a mode. */
export function modeOf(track: Pick<ModedTrack, "mode">): RecordMode {
  const mode = track.mode
  return mode === "both" || mode === "midi" ? mode : "audio"
}

/** Whether the track's input goes to a WAV: Audio and Both. */
export function recordsAudio(track: Pick<ModedTrack, "mode">): boolean {
  return modeOf(track) !== "midi"
}

/** Whether the track's port goes to a .mid: Both and MIDI. */
export function recordsNotes(track: Pick<ModedTrack, "mode">): boolean {
  return modeOf(track) !== "audio"
}

/**
 * The name of the port a track takes notes from, or null for none: only a
 * track that records notes has one, whatever an Audio track is handed, and a
 * port with no name finds nothing (rules.port_of, port_ref).
 */
function portName(track: ModedTrack): string | null {
  if (!recordsNotes(track)) return null
  const port = track.midi_port
  const name = typeof port === "string" ? port : port?.name
  return typeof name === "string" && name.trim() ? name : null
}

/**
 * Null when these tracks can start a rehearsal as far as their notes go, and
 * a sentence when they cannot (rules.notes_problem). Three things stop Start,
 * said in this order:
 *
 * - No track records sound (A1): a take is timed, heard and mixed from its
 *   audio.
 * - A track that takes notes has no port picked yet (P3). A port that was
 *   picked and is not plugged in does not stop it: that waits.
 * - Two tracks take notes from one port (P2). Ports are the same when their
 *   names are. The band is walked in order and the first collision met is
 *   named: the track that held the port and the one that asked for it.
 *
 * No tracks at all is not this check's to refuse.
 */
export function notesProblem(tracks: (ModedTrack & { name: string })[]): string | null {
  if (!tracks.length) return null

  if (!tracks.some(recordsAudio)) {
    return "At least one track has to record sound, so the takes can be heard."
  }

  const portless = tracks.filter((t) => recordsNotes(t) && portName(t) === null).map((t) => t.name)
  if (portless.length === 1) {
    return `${portless[0]} has no MIDI port yet. Pick one, or set it to Audio.`
  }
  if (portless.length > 1) {
    return `${portless.join(", ")} have no MIDI port yet. Pick one, or set them to Audio.`
  }

  const taken = new Map<string, string>()
  for (const t of tracks) {
    const port = portName(t)
    if (port === null) continue
    const holder = taken.get(port)
    if (holder !== undefined) return `${holder} and ${t.name} both take notes from ${port}.`
    taken.set(port, t.name)
  }
  return null
}

/** One lane of a take in the player, as laneOrder lays them out. */
export type Lane =
  | { kind: "audio"; name: string; track: TrackFile }
  | { kind: "notes"; name: string; notes: NotesFile }
  | { kind: "missing"; name: string; missing: MissingNotes }

/**
 * The lanes of a take, top to bottom: the audio lanes in the band's order,
 * and each track's notes right after the audio lane its `after` names (a Both
 * track's own, so its notes sit under its sound), as Python worked it out
 * (rules.lane_after). `after` null goes before every audio lane. A track whose
 * .mid is missing keeps the place its .mid would have had.
 *
 * Lanes that follow the same audio lane (or all go first) stay in the order
 * they were given, the saved ones before the missing ones: nothing here says
 * how a saved track and a missing one stood in the band. One that follows an
 * audio lane this take does not have goes first, as `null` does, which is
 * where lane_after ends when nothing before it has sound.
 */
export function laneOrder(
  tracks: TrackFile[],
  notes: NotesFile[],
  missing: MissingNotes[]
): Lane[] {
  const audio = new Set(tracks.map((t) => t.name))
  // The notes lanes by the audio lane they follow; null for the top.
  const following = new Map<string | null, Lane[]>()
  const put = (after: string | null, lane: Lane) => {
    const key = after !== null && audio.has(after) ? after : null
    const group = following.get(key)
    if (group) group.push(lane)
    else following.set(key, [lane])
  }
  for (const n of notes) put(n.after, { kind: "notes", name: n.name, notes: n })
  for (const m of missing) put(m.after, { kind: "missing", name: m.name, missing: m })

  const lanes: Lane[] = [...(following.get(null) ?? [])]
  for (const track of tracks) {
    lanes.push({ kind: "audio", name: track.name, track }, ...(following.get(track.name) ?? []))
  }
  return lanes
}
