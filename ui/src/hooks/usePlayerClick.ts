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

/** What Python says it is: `player_state`'s `click`. */
export function heardPlayerClick(click: boolean) {
  if (click === on) return
  on = click
  emit()
}

/** Turns it on or off, here at once and then in Python; put back as it was
 *  should Python refuse. Done once Python has answered, with whether it did. */
export async function setPlayerClick(next: boolean): Promise<{ ok: boolean; error?: string }> {
  const was = on
  heardPlayerClick(next)
  try {
    const res = await api().player_set_click(next)
    if (!res.ok) heardPlayerClick(was)
    return res
  } catch {
    heardPlayerClick(was)
    return { ok: false }
  }
}

/** Whether the click plays with the take. */
export function usePlayerClick(): boolean {
  return useSyncExternalStore(subscribe, () => on)
}
