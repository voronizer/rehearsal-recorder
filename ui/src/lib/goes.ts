import type { SongChoice, SongChoices } from "@/lib/api"
import { NO_SONG, takeText } from "@/lib/takeText"

/** A take with no song, as Python names it ("Take 47"), as the app writes
 *  it ("Take #47"), or typed as "Take" alone: never a song's title. Python
 *  reads it the same way (names.UNNAMED_TAKE), and gives such a take its go
 *  whatever the number typed. */
export const UNNAMED = /^Take(?:\s*#\s*(\d+)|\s+(\d+))?$/
/** A number typed after a title, out of habit or as the app writes a take:
 *  "Polyn 3", "Polyn #3", "Polyn#3". Python reads it the same way
 *  (names.split_go). */
const TYPED_GO = /^(.*?)(?:\s*#\s*|\s+)(\d+)$/

/** Whether `text` names no song: "Take", "Take 47" or "Take #47". */
export function isNoSong(text: string): boolean {
  return UNNAMED.test(text.trim())
}

/** The go in the name of a take with no song: 47 for "Take 47" or "Take
 *  #47", null for "Take" alone and for any other name. Python names such a
 *  take by its go, so the number in a name it gave is that go. */
export function unnamedGo(text: string): number | null {
  const m = UNNAMED.exec(text.trim())
  const go = m?.[1] ?? m?.[2]
  return go === undefined ? null : Number(go)
}

/** What was typed, less a number after it ("Polyn #3" is "Polyn"), trimmed. */
export function withoutGo(text: string): string {
  const name = text.trim()
  const typed = TYPED_GO.exec(name)
  return typed && typed[1].trim() ? typed[1].trim() : name
}

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
  const typed = TYPED_GO.exec(name)
  return typed ? songNamed(typed[1], choices) : null
}

/**
 * The go a take would be if the name field held `text`: the go Python
 * offered for that song, 1 for a title no song has, and for no song the go
 * Python has for it (unnamed_go), whatever number was typed. The same steps
 * as Python's naming (songFor), over the choices the field already has, so
 * the go beside the field follows typing without asking Python on every
 * key. Null for an empty field, and while the choices have not arrived: no
 * go shown is better than a guessed 1.
 */
export function goFor(text: string, choices: SongChoices | null): number | null {
  const name = text.trim()
  if (name === "" || !choices) return null
  if (UNNAMED.test(name)) return choices.unnamed_go ?? null
  return songFor(name, choices)?.choice.go ?? 1
}

/**
 * A take as the screen after it calls it while its name field holds
 * `text`: its song and the go it will be, "Pałyn #3", as a notice names a
 * take once it is kept (takeText); "Take #48" for no song, at the go Python
 * has for it, or until the choices arrive the number in the name Python
 * gave it (unnamedGo); the text alone while the choices have not arrived.
 * The header's title there (TakeName, in components/TakeSummary) draws the
 * same two parts.
 */
export function nameWithGo(text: string, choices: SongChoices | null): string {
  const typed = text.trim()
  if (UNNAMED.test(typed)) {
    const go = choices?.unnamed_go ?? unnamedGo(typed)
    return go === null ? NO_SONG : takeText({ name: typed, song: NO_SONG, go })
  }
  const go = goFor(typed, choices)
  if (go === null) return typed
  return takeText({ name: typed, song: songFor(typed, choices)?.choice.song ?? typed, go })
}
