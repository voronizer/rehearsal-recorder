import { useCallback, useState } from "react"
import type { SetSong, SongChoice, SongChoices } from "@/lib/api"
import { songFor, songNamed } from "@/lib/goes"

// What the rehearsal screen's songs beside the Next take field are worked
// out from (NextTakeSongs.tsx; issue #12 step 8, R1–R6).

/** Rows of the other songs shown before "All N songs". */
export const SHORT = 5

/**
 * The song `text` names, as the field takes it: a title, a title with a
 * go after it ("Pałyn 3"), or an old name, as the song it is now; else one
 * of `titles` typed whole (a set's song nobody has played yet, which the
 * choices do not have). Null for anything else.
 */
export function songOf(
  text: string,
  choices: SongChoices | null,
  titles: string[] = []
): string | null {
  const found = songFor(text, choices)
  if (found) return found.choice.song
  const key = text.trim().toLocaleLowerCase()
  return titles.find((t) => t.toLocaleLowerCase() === key) ?? null
}

/** The band's songs outside the set, in the pills' order: tonight's, then
 *  the others, the latest played first. */
export function otherSongs(choices: SongChoices | null, set: string[]): string[] {
  const inSet = new Set(set.map((s) => s.toLocaleLowerCase()))
  return choices
    ? [...choices.here, ...choices.other]
        .map((c) => c.song)
        .filter((s) => !inSet.has(s.toLocaleLowerCase()))
    : []
}

/**
 * The rows the list shows for what is typed (`typed`, null while nothing
 * narrows it): every one; an old name's song alone, lit (`current` is the
 * song the field names); else those with the text in them.
 */
export function rowsFor(titles: string[], typed: string | null, current: string | null): string[] {
  if (typed === null) return titles
  const text = typed.trim().toLocaleLowerCase()
  if (current !== null) {
    const title = current.toLocaleLowerCase()
    const byTitle = text === title || text.startsWith(title + " ")
    if (byTitle) return titles
    if (titles.includes(current)) return [current]
  }
  return titles.filter((t) => t.toLocaleLowerCase().includes(text))
}

/**
 * The rows a folded list shows (R5): the first five; but when more than
 * five of them were played tonight (`lastTake`: a song's latest take
 * tonight), the five of those played latest, still in the order first
 * played, as the pills kept them.
 */
export function shortList(titles: string[], lastTake: Map<string, number>): string[] {
  const tonight = titles.filter((t) => lastTake.has(t))
  if (tonight.length <= SHORT) return titles.slice(0, SHORT)
  const latest = new Set(
    [...tonight].sort((a, b) => lastTake.get(b)! - lastTake.get(a)!).slice(0, SHORT)
  )
  return tonight.filter((t) => latest.has(t))
}

// Whether the list of other songs is opened out, by rehearsal: it stays as
// it was left for the rest of the evening (R5), past the recording and
// review screens, which take the rehearsal screen away.
const openLists = new Map<string, boolean>()

export function useListOpen(folder: string): [boolean, (open: boolean) => void] {
  const [state, setState] = useState(() => ({
    folder,
    open: openLists.get(folder) ?? false,
  }))
  const open = state.folder === folder ? state.open : (openLists.get(folder) ?? false)
  const setOpen = useCallback(
    (to: boolean) => {
      openLists.set(folder, to)
      setState({ folder, open: to })
    },
    [folder]
  )
  return [open, setOpen]
}

/**
 * A set's songs as titles, each saying whether the band has played it
 * (SetSong.new), from the choices a name field has: a title or an old name
 * of one of their songs is played. While the choices are on their way none
 * is said to be new.
 */
export function asSetSongs(titles: string[], choices: SongChoices | null): SetSong[] {
  return titles.map((title) => ({ title, new: choices !== null && !songNamed(title, choices) }))
}

/** The choices less the songs a set already has, for its Add pills. */
export function notInSet(choices: SongChoices | null, titles: string[]): SongChoices | null {
  if (!choices) return null
  const inSet = new Set(titles.map((t) => t.toLocaleLowerCase()))
  const out = (c: SongChoice) => !inSet.has(c.song.toLocaleLowerCase())
  return { here: choices.here.filter(out), other: choices.other.filter(out) }
}
