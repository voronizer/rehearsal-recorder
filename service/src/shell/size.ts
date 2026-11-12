import { createContext, useContext, useSyncExternalStore } from "react"

/** The window's width: a phone, a small window, a computer's. */
export type Size = "phone" | "narrow" | "wide"

/** Below this many px the window is a phone's; both columns' Sidebars take it as `mobileBelow`. */
export const PHONE_BELOW = 500

/** From this many px an open panel stands beside the page and narrows it, which keeps at least 324 px; below, it lies over the page. */
export const PUSH_FROM = 820

// The same line the Sidebar draws (ui/src/components/ui/sidebar.tsx), so at
// a width with a fraction (a zoomed page) the frame and its columns agree.
const PHONE = `(max-width: ${PHONE_BELOW - 0.02}px)`
const WIDE = "(min-width: 1100px)"
const PUSH = `(min-width: ${PUSH_FROM}px)`

const subscribe = (change: () => void) => {
  const queries = [PHONE, PUSH, WIDE].map((q) => window.matchMedia(q))
  for (const q of queries) q.addEventListener("change", change)
  return () => queries.forEach((q) => q.removeEventListener("change", change))
}

const read = (): Size => (window.matchMedia(PHONE).matches ? "phone" : window.matchMedia(WIDE).matches ? "wide" : "narrow")

/** Whether the window is wide enough for an open panel to stand beside the page (`PUSH_FROM`). */
export const usePushes = () => useSyncExternalStore(subscribe, () => window.matchMedia(PUSH).matches)

/** The page's room, where it is not the window's: beside an open panel on a wide window, a narrow one's (shell/Shell.tsx). */
export const PageRoom = createContext<Size | null>(null)

/**
 * Two columns on a computer, one under another in a small window, a menu
 * behind ☰ on a phone. Inside the page, the page's room; the frame, its
 * columns and the panel go by the window.
 */
export const useSize = () => {
  const room = useContext(PageRoom)
  const own = useSyncExternalStore(subscribe, read)
  return room ?? own
}
