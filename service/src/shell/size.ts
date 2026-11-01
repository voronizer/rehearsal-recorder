import { useSyncExternalStore } from "react"

/** The window's width: a phone, a small window, a computer's. */
export type Size = "phone" | "narrow" | "wide"

const PHONE = "(max-width: 499px)"
const WIDE = "(min-width: 1100px)"

const subscribe = (change: () => void) => {
  const queries = [PHONE, WIDE].map((q) => window.matchMedia(q))
  for (const q of queries) q.addEventListener("change", change)
  return () => queries.forEach((q) => q.removeEventListener("change", change))
}

const read = (): Size => (window.matchMedia(PHONE).matches ? "phone" : window.matchMedia(WIDE).matches ? "wide" : "narrow")

/** Two columns on a computer, one under another in a small window, a menu behind ☰ on a phone. */
export const useSize = () => useSyncExternalStore(subscribe, read)
