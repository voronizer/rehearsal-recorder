import type { Take } from "@/lib/api"

/**
 * A take as a person reads it: its song, then its go after a #, "Viasna #12",
 * so that a title which ends in a number reads apart from it ("Opus 5 #3").
 * A take with no song is counted the same way, across the library, under the
 * title "Take": "Take #47". Python stores and sends the plain name, "Viasna
 * 12" or "Take 47", and folders and files carry that; this is only for the
 * words on screen.
 *
 * The take's place in its rehearsal (take_number) is never shown: it is
 * the order the takes were played in, and the key the app finds a take by.
 */

/** Between a title and its go: a no-break space, so the go never starts a
 *  line of its own. */
export const GO_SPACE = "\u00a0"

/** The title of a take with no song, drawn with its go as a song's is. */
export const NO_SONG = "Take"

/** A go as it is drawn: "#12". Alone where the song is written beside it
 *  (a song's tabs, its ladder), after the title everywhere else. */
export function goMark(go: number): string {
  return `#${go}`
}

/** What is drawn before a take's go: its song, or "Take" for a take with no
 *  song. For a place that draws the two apart, as TakeTitle does. */
export function takeTitle(take: Pick<Take, "song">): string {
  return take.song || NO_SONG
}

/** A take's name as plain text on screen, in a notice, a dialog's title, a
 *  tip or a button's label for a screen reader: "Viasna #12", or "Take #47"
 *  for a take with no song. The name as it is while the go is not known.
 *  TakeTitle draws the same with the go muted. */
export function takeText(take: Pick<Take, "name" | "song" | "go">): string {
  if (take.go == null) return take.name
  return `${takeTitle(take)}${GO_SPACE}${goMark(take.go)}`
}
