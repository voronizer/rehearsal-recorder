import { useSyncExternalStore } from "react"

/**
 * Calls into Python that raised instead of answering.
 *
 * pywebview turns an exception in a Python method into a rejected promise,
 * and no screen was written to expect one: Save take and renaming both
 * failed on Windows by the button dimming and nothing else happening. `api()`
 * now reports every such failure here, and `ErrorBar` shows the latest.
 */
export type BridgeError = {
  method: string
  /** The Python exception's class, e.g. "UnicodeEncodeError". */
  name: string
  message: string
}

let current: BridgeError | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function reportBridgeError(method: string, error: unknown) {
  const e = error instanceof Error ? error : new Error(String(error))
  current = { method, name: e.name || "Error", message: e.message }
  console.error(`[bridge] ${method} failed:`, e)
  emit()
}

export function dismissBridgeError() {
  current = null
  emit()
}

export function useBridgeError(): BridgeError | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => current
  )
}
