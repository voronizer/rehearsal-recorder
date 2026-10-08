import { useEffect, useSyncExternalStore } from "react"
import { api, type SongSet } from "@/lib/api"

/**
 * The band's sets, and the one Start rehearsal plays by (issue #12 step 8,
 * S1–S2), one copy for the start screen and Settings › Sets: a set made or
 * renamed in one is the same in the other at once.
 *
 * Read afresh whenever a screen that shows them opens. The choice is kept
 * in the config across restarts (`next_set`); one whose set was deleted
 * since is no set.
 */

type State = { sets: SongSet[]; chosen: number | null }

let state: State = { sets: [], chosen: null }
// The read under way, so Start can wait for it rather than send no set
// while it is still on its way.
let reading: Promise<void> = Promise.resolve()
const listeners = new Set<() => void>()

function put(next: State) {
  state = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Reads the sets and the choice again. */
export function loadSets(): Promise<void> {
  reading = (async () => {
    try {
      const [sets, cfg] = await Promise.all([api().list_sets(), api().get_settings()])
      put({ sets, chosen: cfg.next_set ?? null })
    } catch {
      /* the bridge blinked — what was read before stands */
    }
  })()
  return reading
}

const valid = ({ sets, chosen }: State) =>
  chosen !== null && sets.some((s) => s.id === chosen) ? chosen : null

/** The set Start plays by, once the read under way is in. */
export async function chosenSet(): Promise<number | null> {
  await reading
  return valid(state)
}

/** Chooses the set Start plays by (null: play freely) and keeps it. */
export function chooseSet(id: number | null) {
  put({ ...state, chosen: id })
  void api().save_next_set(id)
}

/** What a change to the sets answered: the sets as they are now. */
export function setsChanged(sets: SongSet[]) {
  put({ ...state, sets })
}

export function useSets(): {
  sets: SongSet[]
  chosen: number | null
  choose: (id: number | null) => void
  replace: (sets: SongSet[]) => void
} {
  const now = useSyncExternalStore(subscribe, () => state)
  useEffect(() => {
    void loadSets()
  }, [])
  return { sets: now.sets, chosen: valid(now), choose: chooseSet, replace: setsChanged }
}
