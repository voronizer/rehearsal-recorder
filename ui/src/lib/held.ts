import { useEffect, useRef } from "react"

/**
 * What a dialog shows while it closes. Closing clears the state that said
 * what it was about (the take to delete, the marker being written), so the
 * title and the text would empty while the dialog is still fading out. This
 * is the last thing that was asked, until something new is.
 */
export function held<T>(last: T, current: T | null | undefined): T {
  return current ?? last
}

/**
 * `current` while it is something, else the last that was: for a dialog's
 * title, text or subject, which the caller sets to null on close. `initial`
 * is what shows if nothing was ever asked.
 *
 * The last is kept in a ref, written once drawn, so `current` may be a new
 * object on every draw (a text built from the state) without drawing again.
 */
export function useHeld<T>(current: T | null | undefined, initial: T): T {
  const last = useRef(initial)
  const shown = held(last.current, current)
  useEffect(() => {
    last.current = shown
  })
  return shown
}
