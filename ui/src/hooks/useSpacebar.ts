import { useEffect, useRef } from "react"

/** Inputs nobody types into. A fader is an INPUT too, and the shortcuts used
 *  to go dead the moment one was touched. */
const NOT_TYPED = new Set(["range", "checkbox", "radio", "button", "submit", "reset"])

/** Somebody is writing, so the keyboard is theirs letter by letter. */
function isTyping(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === "INPUT") return !NOT_TYPED.has((el as HTMLInputElement).type)
  if (tag === "TEXTAREA" || tag === "SELECT") return true
  return (el as HTMLElement).isContentEditable
}

/** A fader or the seek bar, where the arrows and Home mean their own thing. */
function isSlider(el: Element | null): boolean {
  if (!el) return false
  if (el.getAttribute("role") === "slider") return true
  return el.tagName === "INPUT" && (el as HTMLInputElement).type === "range"
}

/** What Space presses by itself when it has focus. */
const PRESSED_BY_SPACE =
  'button, a[href], input[type="checkbox"], input[type="radio"], ' +
  '[role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"]'

/** What is on top of the screen and has the keyboard while it is open: a
 *  dialog, or the list of a dropdown. */
const LAYERS = '[role="dialog"], [role="listbox"], [role="menu"]'

// The element the mouse last put focus on, or null when the keyboard did.
let pointerFocused: Element | null = null
let pointerWasLast = false
let watchingFocus = false

/**
 * Remembers whether focus arrived by mouse or by keyboard.
 *
 * A button or a fader clicked with the mouse keeps focus in Chromium — the
 * browser the app runs in on Windows — and the screen's keys then went to
 * it: Space pressed Check signal again instead of starting the rehearsal,
 * and after a fader was touched no shortcut worked at all. `:focus-visible`
 * looks like the answer and is not: Chromium turns it on for a
 * mouse-focused button as soon as any key goes down, this one included.
 *
 * Focus that comes back to an element that already had it — the window
 * switched away from and back to — keeps what it was: the keys that switched
 * away were not aimed at the button.
 *
 * Escape in a text field is taken here too, for every screen, including
 * those with nothing else for Escape to do: see stepOutOfField.
 */
function watchFocus() {
  if (watchingFocus) return
  watchingFocus = true
  window.addEventListener("pointerdown", () => (pointerWasLast = true), true)
  window.addEventListener(
    "keydown",
    (e) => {
      pointerWasLast = false
      stepOutOfField(e)
    },
    true
  )
  window.addEventListener(
    "focusin",
    (e) => {
      if (e.target === pointerFocused) return
      pointerFocused = pointerWasLast ? (e.target as Element) : null
    },
    true
  )
}

// The Escape that last took somebody out of a text field.
let steppedOut: KeyboardEvent | null = null

/**
 * Escape in a text field leaves the field, and that is all it does — then
 * Space and Escape are the screen's again. Letters, Space and the arrows in
 * a field stay the field's: that is typing.
 *
 * Leaving rather than acting at once, because of the screen where a field
 * matters most: a take is named on the review screen, whose Escape asks to
 * throw the take away. Name, Escape, Space saves it. Blurring is also what
 * a click elsewhere does, so a field that keeps what was typed when it
 * loses focus keeps it here too.
 *
 * Called from the window listener above and from useEscape, whichever the
 * keydown reaches first; the second finds it already done.
 */
function stepOutOfField(e: KeyboardEvent): boolean {
  if (e === steppedOut) return true
  if (e.key !== "Escape") return false
  const el = document.activeElement
  if (!isTyping(el) || document.querySelector(LAYERS)) return false
  ;(el as HTMLElement).blur()
  steppedOut = e
  return true
}

/**
 * Lets go of focus the mouse left behind, and says whether it did. Clicking a
 * button does not make the screen's keys that button's; a field is the
 * exception, since clicking into one is choosing to type in it.
 */
function letGoOfLeftover(el: Element | null): boolean {
  if (!(el instanceof HTMLElement) || el !== pointerFocused) return false
  if (isTyping(el)) return false
  el.blur()
  return true
}

/**
 * True when the focused element has already claimed the keyboard for its own
 * purpose, so none of the shortcuts below should fire. Typing is the obvious
 * case; a dialog is the one that is easy to miss, because Radix closes it on
 * Escape without stopping the keydown from reaching these window listeners,
 * and `ConfirmDialog`/`ShareDialog` have no input to focus — Radix focuses
 * the dialog *content* instead, a plain `DIV` that a tag-only check waves
 * through. An open dropdown is the same: its arrows and Space pick from it.
 * One rule here, shared by every hook below, instead of three copies that
 * drift apart.
 */
function keyIsClaimed(el: Element | null): boolean {
  if (!el) return false
  if (isTyping(el)) return true
  return el.closest(LAYERS) !== null
}

/**
 * Space = the main action of the current screen, so nobody has to hunt for
 * the mouse mid-rehearsal. It stays out of the way while someone is typing.
 *
 * A button reached with the keyboard keeps Space, which is how a keyboard
 * presses it. One the mouse clicked does not: its focus is left over, not
 * chosen, so it is let go — before the browser presses it, which it does on
 * release — and Space does what it does everywhere else.
 */
export function useSpacebar(handler: () => void, enabled = true) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return
    watchFocus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return
      const el = document.activeElement
      if (keyIsClaimed(el)) return
      if (!letGoOfLeftover(el) && el?.matches(PRESSED_BY_SPACE)) return
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
    watchFocus()

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

    //
    // A button the mouse left focus on claims nothing: Escape was never a
    // button's key. A text field it leaves first, and only that.
    const onCapture = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      claimed =
        stepOutOfField(e) ||
        document.querySelector(LAYERS) !== null ||
        keyIsClaimed(document.activeElement)
    }

    // Taken on the way, too: whatever handled this Escape between the two
    // phases and said so with preventDefault. A label being dragged in
    // Settings › Marks is put back where it was on Escape, and dnd-kit, which
    // drags it, says so that way and stops nothing — so Escape put the label
    // back and left Settings as well.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      if (claimed || e.defaultPrevented) return
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
 * to the system — and nothing on a slider reached with the keyboard, where
 * Home already means "to the bottom of this slider". One the mouse only
 * dragged is let go, as a clicked button is for Space.
 */
export function useKey(key: string, handler: () => void, enabled = true) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return

    watchFocus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== key.toLowerCase() || e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const el = document.activeElement
      if (keyIsClaimed(el)) return
      if (!letGoOfLeftover(el) && isSlider(el)) return
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
 * has focus — so you can listen and scrub without aiming the mouse. A fader
 * the mouse dragged is let go; one reached with Tab keeps its arrows.
 */
export function usePlayerKeys(skip: (delta: number) => void, enabled = true) {
  const skipRef = useRef(skip)
  skipRef.current = skip

  useEffect(() => {
    if (!enabled) return
    watchFocus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      const el = document.activeElement
      if (keyIsClaimed(el)) return
      // On the volume slider and the seek bar the arrows mean their own thing
      if (!letGoOfLeftover(el) && isSlider(el)) return
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
      if (arrow && (isTyping(el) || isSlider(el))) return

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
