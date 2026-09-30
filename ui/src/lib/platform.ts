/**
 * The one thing the interface needs to know about the machine it is on: a
 * Mac's hand goes to ⌘ where everyone else's goes to Ctrl, and a list of
 * keys that says Ctrl there is wrong.
 */
export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

/** The key held with the wheel to zoom a take, as this machine writes it. */
export const ZOOM_KEY = IS_MAC ? "⌘" : "Ctrl"
