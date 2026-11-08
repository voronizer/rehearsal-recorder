import { formatClock, formatDayIn } from "@/lib/format"

/*
  How the pages write times, days and counts: the interface's own ways
  where it has them, so a take reads the same here as in РЭХА.
*/

/** A moment in a take: "1:42". */
export const clock = (sec: number) => formatClock(sec)

/** A rehearsal's day in a list: "Thu 30 Oct", with the year if it is not this one. */
export const day = (date: string) => formatDayIn(date)

/**
 * The day of a moment the server wrote ("2026-11-02T22:30:00Z") where you
 * are: a mark set at 01:30 in Minsk is on that day, not on the day before,
 * as the server's own clock (UTC) would have it.
 */
export function localDay(stamp: string): string {
  const t = new Date(stamp)
  if (Number.isNaN(t.getTime())) return stamp.slice(0, 10)
  const two = (n: number) => String(n).padStart(2, "0")
  return `${t.getFullYear()}-${two(t.getMonth() + 1)}-${two(t.getDate())}`
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** A rehearsal's day in a heading: "Thursday, 30 October", with the year if it is not this one. */
export function longDay(date: string, now = new Date()): string {
  const [y, m, d] = date.split("-").map(Number)
  if (!y || !m || !d) return ""
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${weekday}, ${d} ${MONTHS[m - 1]}${y === now.getFullYear() ? "" : ` ${y}`}`
}

/** "1 take", "3 takes". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** A take's or a song's name in a label, in curly quotes (design system B8). */
export const quoted = (name: string) => `“${name}”`

/**
 * What a take's name is read from. Its song comes as `song_id` in a list
 * and as `song` on the take's own page; `moved`: moved to another song here,
 * and not numbered by РЭХА yet.
 */
export type TakeNaming = {
  name: string
  song_id?: number | null
  song?: { id: number } | null
  moved?: boolean
}

/**
 * РЭХА names a take of a song by the song's title and the take's number at
 * that song, “Viasna 12”. The number РЭХА sends beside the name is the
 * take's number in its rehearsal, a different one, so the song's number is
 * read from the end of the name.
 */
const SONG_AND_NUMBER = /^(.+) (\d+)$/

/**
 * “Viasna” and 12 of “Viasna 12”. Null where the name is read as it is: a
 * take with no song (“Take 4”, where the word Take already sets the number
 * apart), and a take moved here, whose name is the song's title alone.
 */
export function songAndNumber(t: TakeNaming): { song: string; number: number } | null {
  const song = t.song?.id ?? t.song_id ?? null
  const parts = song === null || t.moved ? null : SONG_AND_NUMBER.exec(t.name)
  return parts ? { song: parts[1], number: Number(parts[2]) } : null
}

/**
 * A take's name in plain text, as the page draws it: “Viasna #12”, with a
 * no-break space so the number never starts a line of its own. Any other
 * take by its name. The name РЭХА stores and sends stays “Viasna 12”, and
 * so do the downloaded files.
 */
export function takeText(t: TakeNaming): string {
  const parts = songAndNumber(t)
  return parts === null ? t.name : `${parts.song}\u00a0#${parts.number}`
}

/** A day without its weekday: "8 October", with the year if it is not this one. */
export function dayMonth(date: string, now = new Date()): string {
  const [y, m, d] = date.split("-").map(Number)
  if (!y || !m || !d) return ""
  return `${d} ${MONTHS[m - 1]}${y === now.getFullYear() ? "" : ` ${y}`}`
}

/** A month's heading: "October 2026". */
export function month(date: string): string {
  const [y, m] = date.split("-").map(Number)
  return y && m ? `${MONTHS[m - 1]} ${y}` : ""
}
