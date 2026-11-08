import type { Take } from "@/lib/api"

/**
 * A take as a person reads it: its song, then its go after a #, "Viasna #12",
 * so that a title which ends in a number reads apart from it ("Opus 5 #3").
 * Python stores and sends the plain name, "Viasna 12", and folders and files
 * carry that; this is only for the words on screen. An aria-label keeps the
 * plain name: the tests and screen readers find a take by it.
 */

/** Between a title and its go: a no-break space, so the go never starts a
 *  line of its own. */
export const GO_SPACE = "\u00a0"

/** A go as it is drawn: "#12". Alone where the song is written beside it
 *  (a song's tabs, its ladder), after the title everywhere else. */
export function goMark(go: number): string {
  return `#${go}`
}

/** A take's name as plain text on screen, in a notice, a dialog's title or a
 *  tip: "Viasna #12", or the name as it is ("Take 4") for a take with no
 *  song. TakeTitle draws the same with the go muted. */
export function takeText(take: Pick<Take, "name" | "song" | "go">): string {
  if (!take.song || take.go == null) return take.name
  return `${take.song}${GO_SPACE}${goMark(take.go)}`
}
