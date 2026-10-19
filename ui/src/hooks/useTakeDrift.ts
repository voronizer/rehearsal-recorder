import { useEffect, useState, useSyncExternalStore } from "react"
import { api } from "@/lib/api"
import { DEFAULT_TOLERANCE, type DriftTake, type DriftTolerance, type DriftView, type TakeDrift } from "@/lib/drift"

/**
 * The band's tempo through a take for Master's drift line (drift spec Part
 * 4): asked once for each take opened, as its notes are (`useTakeNotes`),
 * and kept with the lists it was for. A rename or a crop hands back fresh
 * lists, with the files moved or rewritten, and is asked again; a take
 * opened since never shows the one before's line while its own is on its
 * way. Python keeps its last answers, so opening a take again is instant.
 *
 * `counting` is true while the answer is on its way. A bridge that fails is
 * an answer too, with nothing to draw: the lane then shows what it showed
 * before the drift line.
 */
export function useTakeDrift(take: DriftTake | null | undefined): DriftView {
  const tracks = take?.tracks
  const notes = take?.notes
  const tempo = take?.tempo ?? null
  const signature = take?.signature ?? null
  const click = take?.click === true
  const song = take?.song ?? null
  const [read, setRead] = useState<{ tracks: unknown; notes: unknown; answer: TakeDrift } | null>(null)
  useEffect(() => {
    if (!tracks?.length) return
    let alive = true
    const failed = () => {
      if (alive) setRead({ tracks, notes, answer: { ok: false } })
    }
    try {
      api()
        .take_drift(
          tracks.map((t) => ({ name: t.name, file: t.file })),
          (notes ?? []).map((n) => ({ name: n.name, file: n.file })),
          { tempo, signature, click, song }
        )
        .then((answer) => {
          if (alive) setRead({ tracks, notes, answer })
        })
        .catch(failed)
    } catch {
      // No bridge yet, as in the showcase: nothing to draw.
      queueMicrotask(failed)
    }
    return () => {
      alive = false
    }
  }, [tracks, notes, tempo, signature, click, song])
  const mine = read && read.tracks === tracks && read.notes === notes ? read.answer : null
  return { answer: mine, counting: Boolean(tracks?.length) && mine === null }
}

/**
 * Settings › Metronome's "Drift shown past", for every player at once: read
 * from the settings when a player first asks, and told of a change by the
 * settings that made it (`driftToleranceChanged`), so a line already drawn
 * turns amber in more or fewer places without counting again.
 */
let tolerance: DriftTolerance = DEFAULT_TOLERANCE
let asked = false
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  if (!asked) {
    asked = true
    try {
      api()
        .get_settings()
        .then((s) => driftToleranceChanged(s.drift_tolerance ?? DEFAULT_TOLERANCE))
        .catch(() => {
          // The bar has said why; the default stands.
          asked = false
        })
    } catch {
      // No bridge yet, as in the showcase: the default stands.
      asked = false
    }
  }
  return () => {
    listeners.delete(onChange)
  }
}

export function driftToleranceChanged(next: DriftTolerance) {
  if (next === tolerance) return
  tolerance = next
  emit()
}

export function useDriftTolerance(): DriftTolerance {
  return useSyncExternalStore(subscribe, () => tolerance)
}
