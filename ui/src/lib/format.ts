export function formatMMSS(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) totalSec = 0
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

export function formatHMS(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) totalSec = 0
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0")
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0")
  const s = String(Math.floor(totalSec % 60)).padStart(2, "0")
  return `${h}:${m}:${s}`
}

/**
 * A take's clock: "1:48", and "1:02:15" once it passes the hour. Two digits
 * of hours nobody has played yet only make it smaller to read from the kit.
 */
export function formatClock(totalSec: number): string {
  if (!isFinite(totalSec) || totalSec < 0) totalSec = 0
  if (totalSec < 3600) return formatMMSS(totalSec)
  const h = Math.floor(totalSec / 3600)
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0")
  const s = String(Math.floor(totalSec % 60)).padStart(2, "0")
  return `${h}:${m}:${s}`
}

/** "2026-09-18T19:00:00" -> "18 Sep 2026, 19:00" */
export function formatDateHuman(iso: string): string {
  if (!iso) return ""
  const [datePart, timePart] = iso.split("T")
  if (!datePart) return iso
  const [y, m, d] = datePart.split("-").map(Number)
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ]
  const month = months[(m || 1) - 1] ?? ""
  return `${d} ${month} ${y}${timePart ? `, ${timePart.slice(0, 5)}` : ""}`
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** The calendar day an ISO time falls on, as days since 1970. Worked out
 *  from the digits, not through the clock's time zone: "2026-09-22T00:30"
 *  is the 22nd wherever the laptop thinks it is. */
function dayNumber(iso: string): number | null {
  const [y, m, d] = (iso.split("T")[0] ?? "").split("-").map(Number)
  if (!y || !m || !d) return null
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** "2026-09-22T19:00:00" -> "Tue 22 Sep": a rehearsal is remembered by its
 *  weekday as much as by its date. */
export function formatDay(iso: string): string {
  const day = dayNumber(iso)
  if (day === null) return ""
  const date = new Date(day * 86_400_000)
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()].slice(0, 3)}`
}

/** "2026-09-22T19:00:00" -> "22 Sep", and "22 Sep 2025" before `now`'s
 *  year: a band's history runs past New Year, and a song last played two
 *  Septembers ago is not last played this one. */
export function formatDate(iso: string, now: Date = new Date()): string {
  const [y, m, d] = (iso.split("T")[0] ?? "").split("-").map(Number)
  if (!y || !m || !d) return ""
  const date = `${d} ${MONTHS[m - 1].slice(0, 3)}`
  return y === now.getFullYear() ? date : `${date} ${y}`
}

/** "2026-09-22T19:00:00" -> "September 2026", over a month of history. */
export function formatMonth(iso: string): string {
  const [y, m] = (iso.split("T")[0] ?? "").split("-").map(Number)
  if (!y || !m) return ""
  return `${MONTHS[m - 1]} ${y}`
}

/** "Tue 22 Sep, 19:00": when a rehearsal was, by the weekday the band meets. */
export function formatWhen(iso: string): string {
  const time = iso.split("T")[1]?.slice(0, 5)
  return time ? `${formatDay(iso)}, ${time}` : formatDay(iso)
}

/** Whole days from that day to today, on the calendar. */
function daysSince(iso: string, now: Date): number | null {
  const then = dayNumber(iso)
  if (then === null) return null
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000
  return Math.round(today - then)
}

/** How long ago, but only once it is long enough to be worth saying next
 *  to a date: two weeks. Otherwise nothing. */
export function longAgo(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now)
  return days !== null && days >= 14 ? daysAgo(iso, now) : ""
}

/** How long ago that day was, in words: "today", "8 days ago", "3 weeks
 *  ago". Past two weeks, days stop being worth counting. */
export function daysAgo(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now)
  if (days === null) return ""
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  const months = Math.floor(days / 30)
  return months < 24 ? `${months} months ago` : `${Math.floor(days / 365)} years ago`
}

export function takesLabel(n: number): string {
  return `${n} ${n === 1 ? "take" : "takes"}`
}

/** "1 go", "4 goes": takes at one song, which are attempts at it. */
export function goesLabel(n: number): string {
  return n === 1 ? "1 go" : `${n} goes`
}

/**
 * "1.2 GB" / "340 MB" / "412 B": how much of the disk something is using.
 * Counted in thousands, the way the file manager the person will go and look
 * in counts it, so the two numbers agree.
 */
export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "kB", "MB", "GB", "TB"]
  let n = bytes
  let unit = 0
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000
    unit++
  }
  // Below ten of a unit the first decimal still carries information; above
  // it, it is noise on a number nobody reads that closely.
  return `${n.toFixed(unit === 0 || n >= 10 ? 0 : 1)} ${units[unit]}`
}

/** Minutes -> "3 h 20 min" / "45 min": for the disk-space estimate. */
export function formatDuration(minutes: number): string {
  if (!isFinite(minutes) || minutes < 0) minutes = 0
  // Rounded before it is split, or 119.7 minutes came out as "1 h 60 min".
  const whole = Math.round(minutes)
  const hours = Math.floor(whole / 60)
  const mins = whole % 60
  if (hours === 0) return `${mins} min`
  if (hours > 48) return "many hours"
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`
}

/** An estimate: "about 3 h 20 min", or "many hours", which takes no "about". */
export function aboutDuration(minutes: number): string {
  const said = formatDuration(minutes)
  return said === "many hours" ? said : `about ${said}`
}

/** Peak 0..1 as dBFS, for the meter caption. */
export function peakToDb(peak: number): string {
  if (peak <= 0) return "−∞"
  return (20 * Math.log10(peak)).toFixed(1)
}

/**
 * "“X18/XR18” is not connected". The audio system is named only where there
 * is more than one: on Windows the desk can be listed under MME and missing
 * under ASIO, and "not connected" with its name right there in the list
 * would read as nonsense.
 */
export function notConnected(
  missing: { name: string; host_api: string },
  severalDrivers: boolean
): string {
  const driver = severalDrivers && missing.host_api ? ` (${missing.host_api})` : ""
  return `“${missing.name}”${driver} is not connected`
}

/** What looking for interfaces again turned up, in one line. */
export function describeRescan(found: string[] = [], gone: string[] = []): string {
  const quoted = (names: string[]) => names.map((n) => `“${n}”`).join(", ")
  const goneText = `${quoted(gone)} ${gone.length === 1 ? "is" : "are"} gone`
  if (found.length && gone.length) return `Found ${quoted(found)}; ${goneText}`
  if (found.length) return `Found ${quoted(found)}`
  if (gone.length) return goneText
  return "No new interfaces"
}

/**
 * A crop that went through, whose original could not be swept away. A
 * warning, not an error: the take the person asked for exists.
 */
export function croppedButNotSwept(error: string, location?: string | null): string {
  return `The take was cropped, but the original could not be moved out of the way (${error})${
    location ? `, and is still at ${location}` : ""
  }.`
}
