import type { NotesFile } from "@/lib/api"
import type { TakePage } from "../../api"

/**
 * The take's .mid files as РЭХА's player draws them (lib/midi.ts
 * laneOrder): a track that recorded sound and notes has its notes under its
 * sound, with its icon; a track of notes alone goes after the take's last
 * track of sound, since the service does not know the band's order, and
 * before the Backing track, which stays last, right above Master. The port
 * they came from stays in РЭХА, so the plate names none; and a track whose
 * port was never there sent no .mid, so it has no lane here.
 *
 * Each .mid has its track's icon, as РЭХА sends it. A take from РЭХА 0.21
 * or older has none until РЭХА sends its details again: a track of notes
 * alone then has the neutral icon, and is a kit only when its notes are all
 * on channel 10.
 */
export function notesOf(take: TakePage): NotesFile[] {
  const last = take.tracks.findLast((t) => t.kind !== "backing")?.name ?? null
  return take.notes.map((n) => {
    const sound = take.tracks.find((t) => t.name === n.name)
    const icon = n.icon ?? sound?.icon
    return {
      name: n.name,
      file: `/files/${take.uid}/${take.gen}/${n.position}.mid`,
      ...(icon ? { icon } : {}),
      port: "",
      after: sound ? sound.name : last,
      place: n.position,
    }
  })
}

/** The lanes of tracks that recorded notes and no sound. */
export const notesAlone = (take: TakePage, notes: NotesFile[]) =>
  notes.filter((n) => !take.tracks.some((t) => t.name === n.name))
