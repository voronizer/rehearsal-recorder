import { useSyncExternalStore } from "react"
import { api, type KeyKind, type Settings } from "@/lib/api"
import { dismiss, notify } from "@/lib/notices"

/**
 * Which of the app's single keys work, as Settings › Keys sets them:
 * Space and Esc ("space"), and the player's keys ("player"): the arrows,
 * Home, M, R, ? and T, which taps a tempo. Python keeps both with the other
 * settings, and App reads them when it starts. Until then, and for a
 * setting Python does not have, the keys are on.
 *
 * Off, the hooks in hooks/useSpacebar.ts do nothing with those keys, and the
 * browser does what it does anywhere: Space presses the focused button, the
 * arrows move along a field. Ctrl+Z (⌘Z on a Mac) and Esc in a dialog or a
 * text field always work.
 */
let on: Record<KeyKind, boolean> = { space: true, player: true }
const listeners = new Set<() => void>()

/** The notice a switch that could not be saved leaves. */
export const KEYS_SAID = "keys"

function set(next: Record<KeyKind, boolean>) {
  on = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Whether these keys work now. The key hooks ask it at each keydown. */
export function keysOn(kind: KeyKind): boolean {
  return on[kind]
}

/** The same, for a screen that draws the keys on its buttons. */
export function useKeysOn(kind: KeyKind): boolean {
  return useSyncExternalStore(subscribe, () => on[kind])
}

/** What Python keeps, from get_settings: only false turns keys off. */
export function loadKeys(settings: Partial<Pick<Settings, "space_keys" | "player_keys">>) {
  set({ space: settings.space_keys !== false, player: settings.player_keys !== false })
}

/**
 * Turns these keys on or off. It is in force at once, then saved; when Python
 * refuses, the keys are put back as they were and an error notice says why.
 */
export async function switchKeys(kind: KeyKind, value: boolean) {
  dismiss(KEYS_SAID)
  const was = on[kind]
  set({ ...on, [kind]: value })
  const res = await api().save_keys(kind, value)
  if (res.ok) return
  set({ ...on, [kind]: was })
  notify({ key: KEYS_SAID, kind: "error", text: res.error ?? "Could not change the keys" })
}
