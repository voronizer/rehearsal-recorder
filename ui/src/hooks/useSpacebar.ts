import { useEffect, useRef } from "react"

/**
 * True when the focused element has already claimed the keyboard for its own
 * purpose, so none of the shortcuts below should fire. Typing is the obvious
 * case; a dialog is the one that is easy to miss, because Radix closes it on
 * Escape without stopping the keydown from reaching these window listeners,
 * and `ConfirmDialog`/`ShareDialog` have no input to focus — Radix focuses
 * the dialog *content* instead, a plain `DIV` that a tag-only check waves
 * through. One rule here, shared by every hook below, instead of three
 * copies that drift apart.
 */
function keyIsClaimed(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  if ((el as HTMLElement).isContentEditable) return true
  if (el.closest('[role="dialog"]')) return true
  return false
}

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
      const el = document.activeElement
      if (keyIsClaimed(el)) return
      if (el && (el.tagName === "BUTTON" || el.tagName === "A")) return
      e.preventDefault()
      handlerRef.current()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}

/**
 * Escape means one level up, and each screen decides what its level is: the
 * open take first, then the rehearsal it was in, then the screen itself. It
 * never climbs past a decision — it will not end a rehearsal, stop a
 * recording, or throw a take away without asking — because a key pressed by
 * accident should cost nothing that cannot be got back.
 */
export function useEscape(handler: () => void, enabled = true) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      // Escape belongs to the topmost thing on screen, which is the dialog's
      // to close while one is open — see keyIsClaimed above.
      if (keyIsClaimed(document.activeElement)) return
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
      const el = document.activeElement
      if (keyIsClaimed(el)) return
      // On the volume slider and the seek bar the arrows mean their own thing
      if (el?.getAttribute("role") === "slider") return
      e.preventDefault()
      skipRef.current(e.key === "ArrowRight" ? SKIP_SECONDS : -SKIP_SECONDS)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}
