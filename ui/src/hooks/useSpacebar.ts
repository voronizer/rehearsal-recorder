import { useEffect, useRef } from "react"

/** Somebody is writing, so the keyboard is theirs letter by letter. */
function isTyping(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  return (el as HTMLElement).isContentEditable
}

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
  if (isTyping(el)) return true
  return el.closest('[role="dialog"]') !== null
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

    // Escape belongs to the topmost thing on screen, and while a dialog is
    // open that is the dialog's. Deciding that takes both phases of the same
    // keydown, for two different reasons.
    //
    // The decision has to be made first, in the capture phase, because Radix
    // closes its dialog on this very keydown without stopping it. By the time
    // the event has finished travelling, the dialog may be unmounted with
    // focus back on the button that opened it — so a check made then sees no
    // dialog and lets Escape climb a rung it should not have: closing the
    // player's key list also asked to throw the take away.
    //
    // The acting has to be last, in the bubble phase on window, because a
    // dialog this handler opens goes on screen while the same keydown is
    // still travelling — and Radix's newly mounted layer then closes it
    // again. On screen that is a flicker and a screen that will not leave:
    // Escape on a rehearsal with takes in it never got to ask.
    let claimed = false

    const onCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      claimed =
        document.querySelector('[role="dialog"]') !== null ||
        keyIsClaimed(document.activeElement)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (claimed) return
      handlerRef.current()
    }

    window.addEventListener("keydown", onCapture, true)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onCapture, true)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [enabled])
}

/**
 * One more key for a button that had none: Home to the start, M to mark,
 * R to repeat. `key` is compared with `KeyboardEvent.key`, case-insensitive,
 * so R works with Caps Lock on. The same rules as Space: nothing while
 * typing or behind a dialog, nothing with Ctrl/Cmd/Alt held — those belong
 * to the system — and nothing on a slider, where Home already means "to the
 * bottom of this slider".
 */
export function useKey(key: string, handler: () => void, enabled = true) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase() || e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      if (keyIsClaimed(el)) return
      if (el?.getAttribute("role") === "slider") return
      e.preventDefault()
      handlerRef.current()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [key, enabled])
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

/** What a person can land on with the keyboard. */
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * Moving between a dialog's controls with the keyboard — done here rather
 * than left to the browser, because the browser the app actually runs in
 * does not do it.
 *
 * Chromium moves focus to the next button on Tab whatever the system says.
 * WebKit follows macOS "keyboard navigation", which is off unless somebody
 * turned it on, and the app's window on a Mac is WebKit: there Tab took
 * focus out of the page altogether, so a confirmation opened with Escape
 * could be read but not answered without reaching for the mouse. The keydown
 * does arrive in the page — only the browser's own response to it is
 * missing — so this supplies the response.
 *
 * The arrows do the same thing between the controls, which suits a question
 * with two answers better than Tab does, and they are also the half of this
 * a well-behaved browser cannot hide: a test in Chromium sees Tab work
 * whether or not this hook exists, and sees the arrows only if it does.
 */
export function useDialogFocusKeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const arrow = e.key === "ArrowLeft" || e.key === "ArrowRight"
      if (e.key !== "Tab" && !arrow) return
      if (e.ctrlKey || e.metaKey || e.altKey) return

      // The topmost dialog, which is the last one opened: a confirmation
      // raised from inside another dialog owns the keyboard while it stands.
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]')
      const dialog = dialogs[dialogs.length - 1]
      if (!dialog) return

      const el = document.activeElement
      // In a name field the arrows are how you move along what you typed.
      // Tab never is — it is how you leave the field.
      if (arrow && isTyping(el)) return

      const stops = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter(
        (n) =>
          !n.hasAttribute("disabled") &&
          n.tabIndex !== -1 &&
          n.getClientRects().length > 0
      )
      if (stops.length === 0) return

      e.preventDefault()
      // Radix moves focus itself at the ends of its list. With every Tab
      // taken here, letting it act too would move focus twice.
      e.stopPropagation()

      const back = e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)
      const at = el instanceof HTMLElement ? stops.indexOf(el) : -1
      const next =
        at === -1 ? 0 : (at + (back ? -1 : 1) + stops.length) % stops.length
      stops[next].focus()
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])
}
