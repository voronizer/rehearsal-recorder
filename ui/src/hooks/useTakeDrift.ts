import { useEffect, useState, useSyncExternalStore } from "react"
import { api } from "@/lib/api"
import { DEFAULT_TOLERANCE, type DriftTake, type DriftTolerance, type DriftView, type TakeDrift } from "@/lib/drift"

/** How long a count Record stopped waits before it is asked for again, in
 *  ms: Python says "recording" until the take is over. */
const AGAIN_MS = 2000

/**
 * The band's tempo through a take for Master's drift line (drift spec Part
 * 4): asked once for each take opened, and kept with what it was asked
 * about, the take's files, length and meter. A refresh of the screen hands
 * over the same take afresh and asks nothing; a rename or a crop moves or
 * rewrites the files, or changes the length, and is asked again. A take
 * opened since never shows the one before's line while its own is on its
 * way. Python keeps its last answers, so opening a take again is instant.
 *
 * `counting` is true while the answer is on its way. A bridge that fails is
 * an answer too, with nothing to draw: the lane then shows what it showed
 * before the drift line. A count Record stopped is asked for again while the
 * take stays open, once the take is over.
 */
export function useTakeDrift(take: DriftTake | null | undefined): DriftView {
  const key = take?.tracks?.length
    ? JSON.stringify({
        tracks: take.tracks.map((t) => ({ name: t.name, file: t.file })),
        notes: (take.notes ?? []).map((n) => ({ name: n.name, file: n.file })),
        meter: {
          tempo: take.tempo ?? null,
          signature: take.signature ?? null,
          click: take.click === true,
          song: take.song ?? null,
        },
        length: take.duration_sec ?? null,
      })
    : null
  const [read, setRead] = useState<{ key: string; answer: TakeDrift } | null>(null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!key) return
    const { tracks, notes, meter } = JSON.parse(key)
    let alive = true
    const failed = () => {
      if (alive) setRead({ key, answer: { ok: false } })
    }
    try {
      api()
        .take_drift(tracks, notes, meter)
        .then((answer) => {
          if (alive) setRead({ key, answer })
        })
        .catch(failed)
    } catch {
      // No bridge yet, as in the showcase: nothing to draw.
      queueMicrotask(failed)
    }
    return () => {
      alive = false
    }
  }, [key, tries])
  const mine = read && read.key === key ? read.answer : null
  const stopped = mine !== null && !mine.ok && mine.why === "recording"
  useEffect(() => {
    if (!stopped) return
    const again = setTimeout(() => setTries((n) => n + 1), AGAIN_MS)
    return () => clearTimeout(again)
  }, [stopped, read])
  return { answer: mine, counting: key !== null && mine === null }
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
