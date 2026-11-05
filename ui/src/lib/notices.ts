import { useSyncExternalStore } from "react"
import { reportPageError } from "@/lib/bridgeErrors"

/**
 * Things that happened, said in the corner of the window.
 *
 * A message about something that happened used to be a line in the middle of
 * the screen that raised it, and a line that appears pushes everything under
 * it down — then, when it times out, lets it jump back up. A notice is drawn
 * over the screen by `Notices` and moves nothing. Something that is *true* —
 * a track waiting for an input, a card that is not connected — is not a
 * notice; it stays where it is for as long as it holds.
 *
 * - done: an action succeeded. Goes after DONE_MS.
 * - warning: it worked, but not as asked. Stays until closed.
 * - error: it did not work. Stays until closed — the ErrorBar exists because
 *   two failures went unseen, and a message that leaves by itself is how.
 *
 * A notice can carry one action, such as Undo. It is for something done at
 * once that can still be taken back, so it stays ACTION_MS whatever its kind:
 * long enough to notice and reach for. `onGone` is the other end of the same
 * thing: it runs when the notice leaves without its action, timed out or
 * closed or replaced, and that is the moment the thing is let go for good.
 * ⌘Z (Ctrl+Z elsewhere) runs the newest notice's Undo, see
 * hooks/useUndoKey.ts. An action with nothing to take back, such as See on
 * the songs the band changed, says `undo: false`: ⌘Z passes it by.
 *
 * `key` is the slot a notice takes: a new one with the same key replaces the
 * old, so a retry that works replaces the failure it retried. A screen uses
 * one key for what its actions say. Timers belong to a notice's `id`, never
 * its key, so a success's time cannot end the failure that replaced it.
 */
export type NoticeKind = "done" | "warning" | "error"

export type NoticeAction = {
  label: string
  run: () => void
  /** false: nothing to take back, so no ⌘Z beside it and none runs it. */
  undo?: false
}

export type Notice = {
  id: number
  key: string
  kind: NoticeKind
  text: string
  action?: NoticeAction
  /** Runs once when the notice leaves without its action having run. */
  onGone?: () => void
}

export const DONE_MS = 4000
export const ACTION_MS = 10000
export const MAX_NOTICES = 3

/** How long a notice stays, or null for as long as it is not closed. */
export function lifetime(n: Notice): number | null {
  if (n.action) return ACTION_MS
  return n.kind === "done" ? DONE_MS : null
}

/**
 * A notice's time, `ms` long, then `onDone`. `run` starts it, or lets it go
 * on; `stop` pauses it and keeps what is left. The pointer over a notice
 * stops it, and leaving runs it on from there, so somebody reading gets the
 * rest of the time and not all of it again (spec C4).
 */
export function countdown(ms: number, onDone: () => void) {
  let left = ms
  let since = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    run() {
      if (timer !== null) return
      since = Date.now()
      timer = setTimeout(() => {
        timer = null
        onDone()
      }, left)
    },
    stop() {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
      left = Math.max(0, left - (Date.now() - since))
    },
  }
}

let current: Notice[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

/**
 * Runs a notice's callback. One that throws is said on the error bar, and
 * written to crash.log, and goes no further: the corner stays as it was left,
 * the callbacks after it still run, and whoever raised or closed the notice
 * is not the one that fails.
 */
function call(what: string, callback: () => void) {
  try {
    callback()
  } catch (e) {
    reportPageError(what, e)
  }
}

/**
 * Makes `next` the list, tells the screens, and only then calls `onGone` for
 * each notice that is no longer in it, so a callback that raises another
 * notice finds the store as it will stay. A notice leaves the list once, so
 * its `onGone` runs once.
 */
function commit(next: Notice[]) {
  const gone = current.filter((c) => !next.includes(c))
  current = next
  emit()
  for (const n of gone) if (n.onGone) call("a notice's onGone", n.onGone)
}

/**
 * At most MAX_NOTICES stay. The newest is always said; room is made with
 * the oldest notice that has no action, so an error or a "done" does not
 * push out an Undo still in its time: an Undo that goes lets go for good of
 * what it would have brought back. An Undo makes room only when every other
 * notice up has an action too.
 */
function trimmed(list: Notice[]): Notice[] {
  const out = [...list]
  while (out.length > MAX_NOTICES) {
    const plain = out.findIndex((c, i) => !c.action && i < out.length - 1)
    out.splice(plain >= 0 ? plain : 0, 1)
  }
  return out
}

export function notify(n: Omit<Notice, "id">) {
  const notice: Notice = { ...n, id: nextId++ }
  commit(trimmed([...current.filter((c) => c.key !== n.key), notice]))
}

export function dismiss(key: string) {
  if (!current.some((c) => c.key === key)) return
  commit(current.filter((c) => c.key !== key))
}

export function dismissNotice(id: number) {
  if (!current.some((c) => c.id === id)) return
  commit(current.filter((c) => c.id !== id))
}

/**
 * Runs a notice's action. The notice is off the list before the action
 * starts (an action that raises its own notice, "could not undo", sees the
 * list as it will be), and its `onGone` never runs: the action has dealt with
 * what it was for.
 */
export function runAction(id: number) {
  const notice = current.find((c) => c.id === id)
  if (!notice?.action) return
  current = current.filter((c) => c !== notice)
  emit()
  call("a notice's action", notice.action.run)
}

/** Runs the newest Undo there is, whatever came after it; false when no
 *  notice has one. */
export function undoLatest(): boolean {
  const newest = current.findLast((c) => c.action && c.action.undo !== false)
  if (!newest) return false
  runAction(newest.id)
  return true
}

export function getNotices(): Notice[] {
  return current
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    getNotices
  )
}
