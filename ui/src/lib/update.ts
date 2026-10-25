import { useEffect, useSyncExternalStore } from "react"
import { api, poll, type UpdateStatus } from "@/lib/api"
import { notify } from "@/lib/notices"

/**
 * Whether a newer version is out, for every place that can say so: the dot
 * on the setup screen's gear, the one on Settings' Under the hood, and the
 * Updates section there. One answer for all of them, asked of the
 * local server while any of them is on screen — see updates.py for when
 * Python itself asks GitHub.
 *
 * A minute between asks: the answer changes once a day at most, and the
 * first one is in a few seconds after the window opens. While the new
 * version downloads or is got ready, every second, for its percentage.
 *
 * The notices after Restart now come from here too: "Updated to" once the
 * new copy runs, or, when the swap failed and the old copy opened again,
 * a warning that stays until closed. Each once a run.
 */
const EVERY_MS = 60_000
const DOWNLOADING_MS = 1_000

let current: UpdateStatus = { on: true, latest: null, download: null }
let timer = 0
const listeners = new Set<() => void>()

const downloading = () =>
  current.download?.state === "running" ||
  current.install?.state === "downloading" ||
  current.install?.state === "preparing"

const said = new Set<string>()

/** The notices the new status calls for, each said once a run. */
function announce(next: UpdateStatus) {
  if (next.updated && !said.has("updated")) {
    said.add("updated")
    notify({ key: "update", kind: "done", text: `Updated to ${next.updated}` })
  }
  const failed = next.install?.state === "place_failed" ? next.install.version : null
  if (failed && !said.has(`place_failed ${failed}`)) {
    said.add(`place_failed ${failed}`)
    notify({ key: "update", kind: "warning", text: `Could not put ${failed} in place` })
  }
}

function schedule() {
  window.clearTimeout(timer)
  if (listeners.size === 0) return
  timer = window.setTimeout(async () => {
    await refreshUpdate()
    schedule()
  }, downloading() ? DOWNLOADING_MS : EVERY_MS)
}

/** Asks now: after the switch in Settings, so the dots go at once. */
export async function refreshUpdate() {
  try {
    const next = await poll("update_status")
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      const wasDownloading = downloading()
      set(next)
      // Ask quickly while it downloads, slowly again once it has stopped.
      if (downloading() !== wasDownloading) schedule()
    }
  } catch {
    // Nothing to say is the same as nothing newer.
  }
}

function set(next: UpdateStatus) {
  current = next
  announce(next)
  for (const l of listeners) l()
}

/** The switch in Settings. Said at once, so the box and the dots do not wait
 *  for Python to answer; then asked again to be sure. */
export async function switchUpdates(on: boolean) {
  set({ ...current, on, latest: on ? current.latest : null })
  await api().set_check_updates(on)
  await refreshUpdate()
}

/** The Download button, and Try again. */
export async function startDownload() {
  if (current.latest) {
    set({ ...current, download: { state: "running", version: current.latest.version, fraction: 0 } })
    schedule()
  }
  await api().download_update()
  await refreshUpdate()
}

/** The Update button, and Try again after getting it ready failed. */
export async function startUpdate() {
  const version = current.latest?.version ?? current.install?.version
  if (version) {
    set({ ...current, install: { state: "downloading", version, fraction: 0 } })
    schedule()
  }
  await api().update_now()
  await refreshUpdate()
}

/** Restart now, and Try again after the swap failed. Python closes the
 *  window once the swap has started. */
export async function restartNow() {
  return api().restart_to_update()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshUpdate()
    schedule()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.clearTimeout(timer)
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
