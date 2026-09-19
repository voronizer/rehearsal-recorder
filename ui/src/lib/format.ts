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
