import type { SongChoice, SongChoices } from "@/lib/api"

/** A take nobody named, as Python names it: never a song's title. */
export const UNNAMED = /^Take \d+$/
/** A number typed after a title out of habit: "Polyn 3". */
const TRAILING_NUMBER = /^(.*?)\s+(\d+)$/

/** The song some text names, and the old name it came by, if it did. */
export type SongNamed = { choice: SongChoice; old: string | null }

/**
 * The song whose title is the whole of `text`, compared case-blind, or
 * failing that the song with it as an old name (`also`): what Python's
 * naming does first (Library._resolve). `old` is the old name as Python
 * spelt it, so the field can say "Palyn → Pałyn". Null without choices.
 * The text is taken whole: Rename song sets a title exactly, number and all.
 */
export function songNamed(text: string, choices: SongChoices | null): SongNamed | null {
  const name = text.trim().toLocaleLowerCase()
  if (name === "" || !choices) return null
  const songs = [...choices.here, ...choices.other]
  const titled = songs.find((c) => c.song.toLocaleLowerCase() === name)
  if (titled) return { choice: titled, old: null }
  for (const c of songs) {
    const old = c.also?.find((a) => a.toLocaleLowerCase() === name)
    if (old !== undefined) return { choice: c, old }
  }
  return null
}

/**
 * The song a take is a go at when the name field holds `text`, as Python
 * names it (Library._resolve): the whole text as a title or an old name,
 * then the same less a number typed after it. Null for a take nobody named
 * and for a title no song has.
 */
export function songFor(text: string, choices: SongChoices | null): SongNamed | null {
  const name = text.trim()
  if (UNNAMED.test(name)) return null
  const whole = songNamed(name, choices)
  if (whole) return whole
  const typed = TRAILING_NUMBER.exec(name)
  return typed ? songNamed(typed[1], choices) : null
}

/**
 * The go a take would be if the name field held `text`: the go Python
 * offered for that song, 1 for a title no song has, and null for a take
 * nobody named. The same steps as Python's naming (songFor), over the
 * choices the field already has, so the go beside the field follows
 * typing without asking Python on every key. Null as well while the
 * choices have not arrived: no go shown is better than a guessed 1.
 */
export function goFor(text: string, choices: SongChoices | null): number | null {
  const name = text.trim()
  if (name === "" || UNNAMED.test(name) || !choices) return null
  return songFor(name, choices)?.choice.go ?? 1
}
