import { useSyncExternalStore } from "react"

/**
 * The one place that knows which system the interface is on, and what that
 * system calls things: a Mac's hand goes to ⌘ where everyone else's goes to
 * Ctrl, Finder is Explorer on Windows, and the Trash is the Recycle Bin. A
 * list of keys that says Ctrl on a Mac is wrong.
 *
 * It can be told which system to be, so the showcase can show both.
 */
export type System = "mac" | "windows" | "other"

let told: System | null = null
const listeners = new Set<() => void>()

function fromNavigator(): System {
  // No navigator under node (the tests): nothing to go by.
  if (typeof navigator === "undefined") return "other"
  const p = navigator.platform ?? ""
  if (/Mac|iPhone|iPad/.test(p)) return "mac"
  if (/Win/.test(p)) return "windows"
  return "other"
}

/** The system we are on: the one we were told to be, else the navigator's. */
export function system(): System {
  return told ?? fromNavigator()
}

/** Be this system from now on; null goes back to the navigator's. */
export function setSystem(s: System | null) {
  told = s
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The system, for a component that shows its words: it is drawn again when
 *  setSystem changes it. Pass the result to words(). */
export function useSystem(): System {
  return useSyncExternalStore(subscribe, system)
}

export type Words = {
  /** The key held with the wheel to zoom a take. */
  mod: "⌘" | "Ctrl"
  undoKey: "⌘Z" | "Ctrl+Z"
  fileManager: "Finder" | "Explorer" | "file manager"
  /** The button that opens a rehearsal's folder, in the words of the system
   *  it opens in. */
  folderButton: "Show in Finder" | "Show in Explorer" | "Open folder"
  trash: "the Trash" | "the Recycle Bin"
}

const MAC: Words = {
  mod: "⌘",
  undoKey: "⌘Z",
  fileManager: "Finder",
  folderButton: "Show in Finder",
  trash: "the Trash",
}

const WINDOWS: Words = {
  mod: "Ctrl",
  undoKey: "Ctrl+Z",
  fileManager: "Explorer",
  folderButton: "Show in Explorer",
  trash: "the Recycle Bin",
}

const OTHER: Words = {
  mod: "Ctrl",
  undoKey: "Ctrl+Z",
  fileManager: "file manager",
  folderButton: "Open folder",
  trash: "the Trash",
}

/** What this system calls things. A component passes useSystem() so it is
 *  drawn again if the system changes; other code leaves the argument out. */
export function words(s: System = system()): Words {
  return s === "mac" ? MAC : s === "windows" ? WINDOWS : OTHER
}
