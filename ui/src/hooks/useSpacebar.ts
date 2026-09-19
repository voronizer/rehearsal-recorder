import { useEffect, useRef } from "react"

/**
 * Space = the main action of the current screen, so nobody has to hunt for
 * the mouse mid-rehearsal. It stays out of the way while someone is typing,
 * and does not fight a focused button (space already presses that).
 */
export function useSpacebar(handler: () => void, enabled = true) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return
      const el = document.activeElement as HTMLElement | null
      if (el) {
        const tag = el.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        if (el.isContentEditable) return
        if (tag === "BUTTON" || tag === "A") return
      }
      e.preventDefault()
      handlerRef.current()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}

const SKIP_SECONDS = 10

/**
 * Arrow keys scrub anywhere on a player screen, not only when the seek bar
 * has focus — so you can listen and scrub without aiming the mouse.
 */
export function usePlayerKeys(skip: (delta: number) => void, enabled = true) {
  const skipRef = useRef(skip)
  skipRef.current = skip

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      const el = document.activeElement as HTMLElement | null
      if (el) {
        const tag = el.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        if (el.isContentEditable) return
        // On the volume slider and the seek bar the arrows mean their own thing
        if (el.getAttribute("role") === "slider") return
      }
      e.preventDefault()
      skipRef.current(e.key === "ArrowRight" ? SKIP_SECONDS : -SKIP_SECONDS)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}
