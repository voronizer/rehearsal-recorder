import { useSyncExternalStore } from "react"
import { api } from "@/lib/api"

/**
 * How loud takes play back: one level for the whole app, kept by Python as
 * master_volume and applied to every take it opens.
 *
 * Two handles turn it: the master fader under a take's tracks, and the
 * speaker in the header, which is there wherever a take can be played from
 * a row without opening it. The level is held here once and both read it.
 * Two copies are how a fader and an icon come to disagree.
 *
 * What the mix measures coming out after this level is kept here too, so
 * the header's slider has the same meter as the fader.
 */
let volume = 1
let level = 0
const listeners = new Set<() => void>()

// The take open in Python, if there is one: where a level turned now goes.
let toPlayer: ((volume: number) => void) | null = null
// Somebody turned it before the kept level came back from Python, and what
// they set stands.
let turned = false
let loading: Promise<void> | null = null

function emit() {
  for (const l of listeners) l()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** 0..1, how loud takes play. */
export function useListeningVolume(): number {
  return useSyncExternalStore(subscribe, () => volume)
}

/** 0..1, the whole mix as it last went out; 0 while nothing plays. */
export function useMixLevel(): number {
  return useSyncExternalStore(subscribe, () => level)
}

/** What Python says: the level a take opened at, the mix it measured. */
export function heard(state: { volume?: number; level?: number }) {
  const v = state.volume ?? volume
  const l = state.level ?? level
  if (v === volume && l === level) return
  volume = v
  level = l
  emit()
}

/** Somebody moved a handle: here at once, and in the take open, if any. */
export function turnListeningVolume(v: number) {
  turned = true
  heard({ volume: v })
  toPlayer?.(v)
}

/** Let go: kept for the next take and the next run. */
export function keepListeningVolume() {
  void api().save_master_volume(volume)
}

/**
 * A take is open in Python, and `send` gives it a level. Returns what to
 * call when it closes, which only lets go if no other take took its place.
 */
export function playerOpened(send: (volume: number) => void): () => void {
  toPlayer = send
  return () => {
    if (toPlayer === send) toPlayer = null
  }
}

/** Asks Python for the kept level once a run, so the header has it before
 *  anything has played. */
export function loadListeningVolume(): Promise<void> {
  loading ??= (async () => {
    try {
      const s = await api().get_settings()
      if (!turned && typeof s.master_volume === "number") heard({ volume: s.master_volume })
    } catch {
      // It stays at full until a take opens and Python says otherwise.
      loading = null
    }
  })()
  return loading
}
