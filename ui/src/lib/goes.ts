import type { SongChoices } from "@/lib/api"

/** A take nobody named, as Python names it. */
const UNNAMED = /^Take \d+$/
/** A number typed after a title out of habit: "Polyn 3". */
const TRAILING_NUMBER = /^(.*?)\s+(\d+)$/

/**
 * The go a take would be if the name field held `text`: the go Python
 * offered for that song, 1 for a title no song has, and null for a take
 * nobody named. The same steps as Python's naming (Library._resolve), over
 * the choices the field already has, so the go beside the field follows
 * typing without asking Python on every key. Null as well while the
 * choices have not arrived: no go shown is better than a guessed 1.
 */
export function goFor(text: string, choices: SongChoices | null): number | null {
  const name = text.trim()
  if (name === "" || UNNAMED.test(name) || !choices) return null
  const songs = [...choices.here, ...choices.other]
  const find = (title: string) =>
    songs.find((c) => c.song.toLocaleLowerCase() === title.toLocaleLowerCase())
  const exact = find(name)
  if (exact) return exact.go
  const typed = TRAILING_NUMBER.exec(name)
  const base = typed ? find(typed[1].trim()) : undefined
  return base ? base.go : 1
}
