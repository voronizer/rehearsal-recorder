import { useEffect } from "react"
import { isTyping } from "@/hooks/useSpacebar"
import { undoLatest } from "@/lib/notices"
import { system, type System } from "@/lib/platform"

/** A letter of the Latin alphabet, which a layout typed on purpose. */
const LATIN_LETTER = /^[a-z]$/i

/**
 * Whether this key press is the system's Undo: ⌘Z on the Mac, Ctrl+Z
 * everywhere else, and nothing else (Shift makes it Redo; Alt is another
 * key altogether, and on Windows AltGr is Ctrl+Alt).
 *
 * The Z is found by its letter, or by its place when the letter is not a
 * Latin one: on a Russian or Belarusian layout the Z key reads "я", and
 * Undo should not need a switch of layout. A Latin letter wins over the
 * place — on AZERTY the Z position types W, and ⌘W is not Undo.
 */
export function isUndoKey(
  e: {
    key: string
    code?: string
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    altKey: boolean
  },
  s: System
): boolean {
  if (e.shiftKey || e.altKey) return false
  const held = s === "mac" ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
  if (!held) return false
  if (e.key.toLowerCase() === "z") return true
  return !LATIN_LETTER.test(e.key) && e.code === "KeyZ"
}

/**
 * ⌘Z or Ctrl+Z takes back the newest thing a notice offers to take back
 * (see lib/notices.ts), from whichever screen is open.
 *
 * It stands down wherever Undo already means something else: a text field
 * undoes its own typing, an open dialog has the keyboard, and during a take
 * nothing is touched. And it does not repeat: a key held down must not walk
 * back through every removal on screen.
 */
export function useUndoKey() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isUndoKey(e, system()) || e.repeat) return
      if (isTyping(document.activeElement)) return
      if (document.querySelector('[role="dialog"]')) return
      if (document.documentElement.hasAttribute("data-recording")) return
      if (undoLatest()) e.preventDefault()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
}
