import type { NotesFile } from "@/lib/api"
import type { TakePage } from "../../api"

/**
 * The take's .mid files as РЭХА's player draws them (lib/midi.ts
 * laneOrder): a track that recorded sound and notes has its notes under its
 * sound, with its icon; a track of notes alone goes after the take's last
 * track of sound, since the service does not know the band's order. The
 * port they came from stays in РЭХА, so the plate names none; and a track
 * whose port was never there sent no .mid, so it has no lane here.
 */
export function notesOf(take: TakePage): NotesFile[] {
  const last = take.tracks.at(-1)?.name ?? null
  return take.files
    .filter((f) => f.mid)
    .map((f) => {
      const sound = take.tracks.find((t) => t.name === f.name)
      return {
        name: f.name,
        file: `/files/${take.uid}/${take.gen}/${f.position}.mid`,
        ...(sound?.icon ? { icon: sound.icon } : {}),
        port: "",
        after: sound ? sound.name : last,
        place: f.position,
      }
    })
}
