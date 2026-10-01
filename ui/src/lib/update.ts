import { useEffect, useSyncExternalStore } from "react"
import { api, poll, type UpdateStatus } from "@/lib/api"

/**
 * Whether a newer version is out, for every place that can say so: the dot
 * on the setup screen's gear, the one on Settings' Under the hood, and the
 * line beside the version there. One answer for all of them, asked of the
 * local server while any of them is on screen — see updates.py for when
 * Python itself asks GitHub.
 *
 * A minute between asks: the answer changes once a day at most, and the
 * first one is in a few seconds after the window opens.
 */
const EVERY_MS = 60_000

let current: UpdateStatus = { on: true, latest: null }
let timer = 0
const listeners = new Set<() => void>()

/** Asks now: after the switch in Settings, so the dots go at once. */
export async function refreshUpdate() {
  try {
    const next = await poll("update_status")
    if (next.on !== current.on || next.latest?.version !== current.latest?.version) set(next)
  } catch {
    // Nothing to say is the same as nothing newer.
  }
}

function set(next: UpdateStatus) {
  current = next
  for (const l of listeners) l()
}

/** The switch in Settings. Said at once, so the box and the dots do not wait
 *  for Python to answer; then asked again to be sure. */
export async function switchUpdates(on: boolean) {
  set({ on, latest: on ? current.latest : null })
  await api().set_check_updates(on)
  await refreshUpdate()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshUpdate()
    timer = window.setInterval(() => void refreshUpdate(), EVERY_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.clearInterval(timer)
  }
}

/** The newer version that is out, or null; and whether checking is on. */
export function useUpdate(): UpdateStatus {
  const status = useSyncExternalStore(subscribe, () => current)
  // A screen that mounts after the last answer still asks once for itself.
  useEffect(() => {
    void refreshUpdate()
  }, [])
  return status
}
