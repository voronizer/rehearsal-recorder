import { useSyncExternalStore } from "react"

/** A computer's window, 768 px and wider: the songs stay in a column on the left. */
const WIDE = "(min-width: 768px)"

const subscribe = (change: () => void) => {
  const query = window.matchMedia(WIDE)
  query.addEventListener("change", change)
  return () => query.removeEventListener("change", change)
}

export const useWide = () => useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches)
