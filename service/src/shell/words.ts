import { formatClock, formatDayIn } from "@/lib/format"

/*
  How the pages write times, days and counts: the interface's own ways
  where it has them, so a take reads the same here as in РЭХА.
*/

/** A moment in a take: "1:42". */
export const clock = (sec: number) => formatClock(sec)

/** A rehearsal's day in a list: "Thu 30 Oct", with the year if it is not this one. */
export const day = (date: string) => formatDayIn(date)

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
