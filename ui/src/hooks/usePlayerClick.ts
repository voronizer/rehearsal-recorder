import { useSyncExternalStore } from "react"
import { api } from "@/lib/api"

/**
 * Whether the player plays the click with a click take (spec Part 8): one
 * switch for the whole app, kept by Python for as long as it runs. It is off
 * when the app starts and stays as it was left from one take to the next,
 * on whichever screen the take is open. Held here once, so every player
 * shows the same, and set again from what Python says of the take it opens.
 */
let on = false
// The changes made here, and how many are still on their way to Python.
let changes = 0
let pending = 0
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

function show(click: boolean) {
  if (click === on) return
  on = click
  emit()
}

/** Taken as `player_state` is asked for, and handed to `heardPlayerClick`
 *  with its answer. */
export function askingPlayerClick(): number {
  return pending > 0 ? -1 : changes
}

/** What Python says it is: `player_state`'s `click`, asked for when
 *  `askingPlayerClick` gave `asked`. An answer asked for before a change
 *  made here, or while one was on its way, says what was before it, and
 *  is not shown over it. */
export function heardPlayerClick(click: boolean, asked: number) {
  if (asked !== changes || pending > 0) return
  show(click)
}

/** Turns it on or off, here at once and then in Python; put back as it was
 *  should Python refuse. Done once Python has answered, with whether it did. */
export async function setPlayerClick(next: boolean): Promise<{ ok: boolean; error?: string }> {
  const was = on
  changes += 1
  pending += 1
  show(next)
  try {
    const res = await api().player_set_click(next)
    if (!res.ok) show(was)
    return res
  } catch {
    show(was)
    return { ok: false }
  } finally {
    pending -= 1
  }
}

/** Whether the click plays with the take, as shown now. */
export function playerClickOn(): boolean {
  return on
}

/** Whether the click plays with the take. */
export function usePlayerClick(): boolean {
  return useSyncExternalStore(subscribe, playerClickOn)
}
