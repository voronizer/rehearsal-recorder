import { useEffect, useSyncExternalStore } from "react"
import { api } from "@/lib/api"

/**
 * A take's wave as the lists draw it (api.take_shapes): 120 values in 0..1,
 * at each moment the loudest of its tracks, scaled to its own loudest. [] is
 * a take with nothing to draw, which its row draws flat.
 */
export type Shape = number[]

/** How many takes one call asks for. A wave not made yet reads every file of
 *  its take, so a few at a time lets each row's come in as it is made. */
const AT_ONCE = 4

// Every wave asked for since the app opened, by its take and its length: a
// crop makes it another take, and its wave is asked for again.
const known = new Map<string, Shape>()
const waiting: { key: string; folder: string; take_number: number }[] = []
const asked = new Set<string>()
const listeners = new Set<() => void>()
let running = false

const keyOf = (folder: string, take: { take_number: number; duration_sec: number }) =>
  `${folder}#${take.take_number}@${take.duration_sec}`

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

async function run() {
  if (running) return
  running = true
  try {
    while (waiting.length) {
      const now = waiting.splice(0, AT_ONCE)
      let shapes: (Shape | null)[] = []
      try {
        const res = await api().take_shapes(
          now.map(({ folder, take_number }) => ({ folder, take_number }))
        )
        if (res.ok) shapes = res.shapes
      } catch {
        /* no bridge, or it blinked: these are drawn flat */
      }
      now.forEach(({ key }, i) => {
        known.set(key, shapes[i] ?? [])
        asked.delete(key)
      })
      listeners.forEach((l) => l())
    }
  } finally {
    running = false
  }
}

/**
 * The wave of a take in the rehearsal at `folder`, or null until it is in.
 * Asked for once; the rows on screen together, a few at a time, in the
 * order they were drawn. Without a folder there is nothing to ask by.
 */
export function useShape(
  folder: string | undefined,
  take: { take_number: number; duration_sec: number }
): Shape | null {
  const key = folder ? keyOf(folder, take) : null
  const shape = useSyncExternalStore(subscribe, () => (key ? (known.get(key) ?? null) : null))
  useEffect(() => {
    if (!key || !folder || known.has(key) || asked.has(key)) return
    asked.add(key)
    waiting.push({ key, folder, take_number: take.take_number })
    // After this render's other rows have put theirs in too.
    queueMicrotask(() => void run())
  }, [key, folder, take.take_number])
  return shape
}
