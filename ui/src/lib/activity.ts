import { useEffect, useRef, useSyncExternalStore } from "react"
import { api, poll, type Activity, type ActivityEntry } from "@/lib/api"
import { notify } from "@/lib/notices"

/**
 * What long work is running and how it ended, for every screen at once: one
 * poll for the whole app, read with useActivity(). See activity.py.
 *
 * Fast while anything waits or runs or the list is open, slow otherwise —
 * slow enough to cost nothing, fast enough to notice a copy that started by
 * itself after a take was saved.
 */
export const BUSY_MS = 400
export const IDLE_MS = 2000

let current: Activity = { entries: [], recording: false }
let listOpen = false
let started = false
const known = new Map<number, ActivityEntry["state"]>()
const listeners = new Set<() => void>()
const settledListeners = new Set<(e: ActivityEntry) => void>()

function emit() {
  for (const l of listeners) l()
}

function busy() {
  return listOpen || current.entries.some((e) => e.state === "running" || e.state === "waiting")
}

/** A cloud copy that finished says so in the corner; the operations that run
 *  in place say it on their own screen. */
function announce(next: ActivityEntry[]) {
  for (const e of next) {
    const before = known.get(e.id)
    known.set(e.id, e.state)
    if (e.kind !== "cloud" || before === undefined || before === e.state) continue
    if (e.state === "done" || e.state === "failed") {
      for (const l of settledListeners) l(e)
    }
    const key = `cloud:${e.folder}:${e.take_number}`
    const name = e.title.replace(/ → cloud$/, "")
    if (e.state === "done") {
      notify({ key, kind: "done", text: `${name} is in the cloud folder${e.detail ? ` — ${e.detail}` : ""}` })
    } else if (e.state === "failed") {
      notify({ key, kind: "error", text: `Could not copy ${name} to the cloud: ${e.error ?? "it failed"}` })
    }
  }
}

async function tick() {
  try {
    const next = await poll("activity")
    announce(next.entries)
    current = next
    emit()
    // Whatever finishes while the list is open has been seen by being there.
    if (listOpen && next.entries.some((e) => !e.seen && (e.state === "done" || e.state === "failed"))) {
      void api().activity_seen()
    }
  } catch {
    /* the bridge blinked — ask again next time */
  }
  window.setTimeout(tick, busy() ? BUSY_MS : IDLE_MS)
}

function ensureStarted() {
  if (started) return
  started = true
  void tick()
}

export function useActivity(): Activity {
  return useSyncExternalStore(
    (onChange) => {
      ensureStarted()
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => current
  )
}

/** Calls `onSettled` each time a cloud copy finishes, either way — for a
 *  screen showing that take, which would otherwise go on saying what it
 *  said before the copy ran. */
export function useCloudSettled(onSettled: (e: ActivityEntry) => void) {
  const latest = useRef(onSettled)
  useEffect(() => {
    latest.current = onSettled
  })
  useEffect(() => {
    ensureStarted()
    const listener = (e: ActivityEntry) => latest.current(e)
    settledListeners.add(listener)
    return () => {
      settledListeners.delete(listener)
    }
  }, [])
}

export function setListOpen(open: boolean) {
  listOpen = open
  if (open) void api().activity_seen()
}

/** The running entry of this kind that `match` picks out, for a screen that
 *  shows its own operation's progress in place. */
export function useRunning(
  kind: ActivityEntry["kind"],
  match: (e: ActivityEntry) => boolean = () => true
): ActivityEntry | null {
  const { entries } = useActivity()
  return entries.find((e) => e.kind === kind && e.state === "running" && match(e)) ?? null
}
