import { useSyncExternalStore } from "react"

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
 * `key` is the slot a notice takes: a new one with the same key replaces the
 * old, so a retry that works replaces the failure it retried. A screen uses
 * one key for what its actions say. Timers belong to a notice's `id`, never
 * its key, so a success's time cannot end the failure that replaced it.
 */
export type NoticeKind = "done" | "warning" | "error"

export type Notice = { id: number; key: string; kind: NoticeKind; text: string }

export const DONE_MS = 4000
export const MAX_NOTICES = 3

let current: Notice[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function notify(n: { key: string; kind: NoticeKind; text: string }) {
  const notice = { ...n, id: nextId++ }
  current = [...current.filter((c) => c.key !== n.key), notice].slice(
    -MAX_NOTICES
  )
  emit()
}

export function dismiss(key: string) {
  if (!current.some((c) => c.key === key)) return
  current = current.filter((c) => c.key !== key)
  emit()
}

export function dismissNotice(id: number) {
  if (!current.some((c) => c.id === id)) return
  current = current.filter((c) => c.id !== id)
  emit()
}

export function useNotices(): Notice[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => listeners.delete(onChange)
    },
    () => current
  )
}
