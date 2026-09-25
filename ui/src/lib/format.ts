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

export function takesLabel(n: number): string {
  return `${n} ${n === 1 ? "take" : "takes"}`
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

/** How many songs a rehearsal row names before it stops being a glance. */
const SONGS_SHOWN = 4

/** "Polyn ×3 · Vesna ×2 · Ogon": what a rehearsal was spent on. */
export function songsLabel(songs: { name: string; takes: number }[]): string {
  const shown = songs
    .slice(0, SONGS_SHOWN)
    .map((s) => (s.takes > 1 ? `${s.name} ×${s.takes}` : s.name))
  const rest = songs.length - shown.length
  if (rest > 0) shown.push(`and ${rest} more`)
  return shown.join(" · ")
}

/** Minutes -> "3 h 20 min" / "45 min": for the disk-space estimate. */
export function formatDuration(minutes: number): string {
  if (!isFinite(minutes) || minutes < 0) minutes = 0
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (hours === 0) return `${mins} min`
  if (hours > 48) return "many hours"
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`
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
