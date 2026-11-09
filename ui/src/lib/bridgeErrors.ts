import { useSyncExternalStore } from "react"

/**
 * Calls into Python that raised instead of answering.
 *
 * pywebview turns an exception in a Python method into a rejected promise,
 * and no screen was written to expect one: saving a take and renaming both
 * failed on Windows by the button dimming and nothing else happening. `api()`
 * now reports every such failure here, and so does the start, one report per
 * problem it met; `ErrorBar` shows them all. A problem raised in the page
 * itself comes through `reportPageError`, which also writes it to crash.log.
 *
 * Every report stays until the person puts them away, newest last. Keeping
 * only the latest let a second problem at start hide the first. One that is
 * already there word for word (same call, same exception, same message) is
 * not listed twice: a call that fails each time it is made says so once.
 *
 * The list holds the first `KEPT` and counts the rest, each one once. The
 * first is the one to keep in view: in a cascade it is the cause and the
 * rest are echoes, and a problem at start must not be pushed out by what
 * follows. A list that is full stops changing, and only the count moves, so
 * a call that keeps failing in new words (the recording screen asks for the
 * levels every 70 ms) does not keep drawing a longer list there.
 */
export type BridgeError = {
  method: string
  /** The Python exception's class, e.g. "UnicodeEncodeError". */
  name: string
  message: string
}

/** How many reports the bar lists; the rest it counts. */
export const KEPT = 20

/**
 * How many of the uncounted ones are told apart by their words. Past this,
 * each further report counts, repeat or not, so a call failing in new words
 * for hours does not keep every one of them in memory.
 */
export const TOLD_APART = 1000

// Replaced, never changed in place: useSyncExternalStore compares snapshots
// by identity, and the bar draws again only when this is a new list.
let errors: readonly BridgeError[] = []
// The reports past the first KEPT: how many, and the words of each.
let more = 0
const counted = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/** Same call, same exception, same message. */
export const keyOf = (e: BridgeError) => `${e.method}\n${e.name}\n${e.message}`

const asError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

/**
 * Lists or counts a problem. True when it is new and told apart from the
 * rest: listed, or counted for the first time while the count still tells
 * reports apart. A repeat, and any report past `TOLD_APART`, is false.
 */
export function reportBridgeError(method: string, error: unknown): boolean {
  const e = asError(error)
  const report = { method, name: e.name || "Error", message: e.message }
  console.error(`[bridge] ${method} failed:`, e)
  const key = keyOf(report)
  if (errors.some((had) => keyOf(had) === key)) return false
  let told = true
  if (errors.length < KEPT) {
    errors = [...errors, report]
  } else {
    if (counted.has(key)) return false
    if (counted.size < TOLD_APART) counted.add(key)
    else told = false
    more += 1
  }
  emit()
  return told
}

/**
 * A problem raised in the page itself, such as a notice's callback that
 * threw: on the bar like any other, and written to crash.log, which it would
 * not reach otherwise (Python logs only what raised in Python). Sent once,
 * when the bar lists or first counts it, so a flood in the page cannot flood
 * the log; past `TOLD_APART` nothing more is sent.
 *
 * Straight through the bridge, not `api()`: a send that fails would be one
 * more report, and so on. A send that fails is let go.
 */
export function reportPageError(where: string, error: unknown) {
  const e = asError(error)
  if (!reportBridgeError(where, e)) return
  try {
    const bridge = typeof window === "undefined" ? undefined : window.pywebview?.api
    if (typeof bridge?.log_problem !== "function") return
    Promise.resolve(bridge.log_problem(where, e.name || "Error", e.message, e.stack ?? "")).catch(
      () => {}
    )
  } catch {
    // The bridge went away, or threw before answering: the bar has it.
  }
}

export function dismissBridgeErrors() {
  if (errors.length === 0) return
  errors = []
  more = 0
  counted.clear()
  emit()
}

/** The first `KEPT` reports, oldest first. */
export function getBridgeErrors(): readonly BridgeError[] {
  return errors
}

/** How many more were said after the list was full, each once. */
export function getMoreBridgeErrors(): number {
  return more
}

/** The line under the list: where the whole of each problem is written. */
export function whereTheRestIs(more: number): string {
  return more > 0
    ? `and ${more} more; all of them are in ~/.rehearsal-recorder/crash.log.`
    : "The full error is in ~/.rehearsal-recorder/crash.log."
}

export function subscribeBridgeErrors(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export function useBridgeErrors(): readonly BridgeError[] {
  return useSyncExternalStore(subscribeBridgeErrors, getBridgeErrors)
}

export function useMoreBridgeErrors(): number {
  return useSyncExternalStore(subscribeBridgeErrors, getMoreBridgeErrors)
}
