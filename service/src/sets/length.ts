import { clock, count } from "../shell/words"

/*
  A song's length in a set: its best take's, or what someone typed over it
  (Alex's pick, 9 November). A typed length is kept on the song, so it is
  the same in every set, and stays in the service.
*/

/** What the service takes for a typed length, in whole seconds: 59:59, as the clock shows an hour as 1:00:00. */
const LONGEST = 3599

/** What a length is read from: a SongItem, or only these parts of one. */
type Timed = { title: string; length: number | null; typed_length: number | null }

/**
 * A length typed as “4:05”: its seconds, null for an empty field (back to
 * the best take's), or "bad" for anything else. A full stop does for the
 * colon, as a phone's number keys have no colon.
 */
export function parseLength(text: string): number | null | "bad" {
  const t = text.trim()
  if (!t) return null
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(t)
  if (!m || Number(m[2]) > 59) return "bad"
  const sec = Number(m[1]) * 60 + Number(m[2])
  return sec >= 1 && sec <= LONGEST ? sec : "bad"
}

/** The song's length in its sets: typed, else its best take's; null with neither. */
export const lengthOf = (song: Timed): number | null => song.typed_length ?? song.length ?? null

/** How long the songs play one after another, with no pause between, and the titles of those with no length. */
export function setTime(songs: Timed[]): { sec: number; none: string[] } {
  return {
    sec: songs.reduce((n, s) => n + (lengthOf(s) ?? 0), 0),
    none: songs.filter((s) => lengthOf(s) === null).map((s) => s.title),
  }
}

/** A set's songs by their numbers, in its order; one the band's list does not have (yet) is left out. */
export function songsOf<S extends { id: number }>(ids: number[], all: S[]): S[] {
  const byId = new Map(all.map((s) => [s.id, s]))
  return ids.map((id) => byId.get(id)).filter((s): s is S => !!s)
}

/**
 * “9 songs · 31:15 · no length: Kryły”: how many, how long, and which have
 * no length to count. `short` leaves the last part out, for the list of
 * sets and the printed sheet.
 */
export function setLine(songs: Timed[], short = false): string {
  const { sec, none } = setTime(songs)
  return [count(songs.length, "song"), songs.length ? clock(sec) : "", !short && none.length ? `no length: ${none.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ")
}
