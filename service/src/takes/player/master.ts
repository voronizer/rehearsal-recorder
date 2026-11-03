/*
  Master's level in the service: how loud this phone or computer plays the
  takes, as РЭХА keeps its own in the app's settings. It is the device's,
  not the member's: a phone and a laptop want different levels, and the
  band never hears it. Kept in the browser's storage, so another browser on
  the same computer has its own; where the browser keeps none, takes play
  at full.
*/

const KEY = "reha.master"

/** The level kept on this device, 0 to 1; full when none is. */
export function keptMaster(): number {
  try {
    const kept = Number(localStorage.getItem(KEY) ?? "1")
    return Number.isFinite(kept) && kept >= 0 && kept <= 1 ? kept : 1
  } catch {
    return 1
  }
}

/** Keeps the level on this device for the next take. */
export function keepMaster(volume: number): void {
  try {
    localStorage.setItem(KEY, String(volume))
  } catch {
    // A browser that keeps nothing plays the next take at full.
  }
}
