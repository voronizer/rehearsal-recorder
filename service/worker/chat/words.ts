/** What the chat's messages say, in one place. */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

/** A rehearsal's date as a calendar day, with no time zone: “Thursday, 30 October”. */
export function rehearsalDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number)
  const day = new Date(Date.UTC(y, m - 1, d))
  return `${WEEKDAYS[day.getUTCDay()]}, ${d} ${MONTHS[m - 1]}`
}

/** A moment, for Alex: “30 October 2025, 19:00 UTC”. */
export function moment(at: Date): string {
  const hh = String(at.getUTCHours()).padStart(2, "0")
  const mm = String(at.getUTCMinutes()).padStart(2, "0")
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${hh}:${mm} UTC`
}

/** A place in a take: 1:42, or 1:02:05 past an hour. */
export function clock(seconds: number): string {
  const s = Math.floor(seconds)
  const ss = String(s % 60).padStart(2, "0")
  if (s < 3600) return `${Math.floor(s / 60)}:${ss}`
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${ss}`
}

/**
 * A take as the pages write it (src/shell/words.ts): “Viasna #12”, with a
 * no-break space before the #. The number is the one at the end of the
 * name, the take's number at its song; the take's `number` column is its
 * number in its rehearsal. Any other take by its name: one with no song
 * (“Take 4”), and one moved to another song here that РЭХА has not
 * numbered yet, whose name is the song's title.
 */
export function takeText(t: { name: string; songId: number | null; movedBy: string | null }): string {
  const parts = t.songId === null || t.movedBy !== null ? null : /^(.+) (\d+)$/.exec(t.name)
  return parts ? `${parts[1]}\u00a0#${parts[2]}` : t.name
}

/** Text for Telegram's HTML. */
export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export const link = (href: string, text: string) => `<a href="${escape(href)}">${escape(text)}</a>`
