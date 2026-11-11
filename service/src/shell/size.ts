import { useSyncExternalStore } from "react"

/** The window's width: a phone, a small window, a computer's. */
export type Size = "phone" | "narrow" | "wide"

/** Below this many px the window is a phone's; both columns' Sidebars take it as `mobileBelow`. */
export const PHONE_BELOW = 500

// The same line the Sidebar draws (ui/src/components/ui/sidebar.tsx), so at
// a width with a fraction (a zoomed page) the frame and its columns agree.
const PHONE = `(max-width: ${PHONE_BELOW - 0.02}px)`
const WIDE = "(min-width: 1100px)"

const subscribe = (change: () => void) => {
  const queries = [PHONE, WIDE].map((q) => window.matchMedia(q))
  for (const q of queries) q.addEventListener("change", change)
  return () => queries.forEach((q) => q.removeEventListener("change", change))
}

const read = (): Size => (window.matchMedia(PHONE).matches ? "phone" : window.matchMedia(WIDE).matches ? "wide" : "narrow")

/** Two columns on a computer, one under another in a small window, a menu behind ☰ on a phone. */
export const useSize = () => useSyncExternalStore(subscribe, read)
