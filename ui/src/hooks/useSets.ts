import { useEffect, useSyncExternalStore } from "react"
import { onBandChanges } from "@/lib/activity"
import { api, type SongSet } from "@/lib/api"
import { withSongBack } from "@/lib/setSongs"

/**
 * The band's sets, and the one Start rehearsal plays by (issue #12 step 8,
 * S1–S2), one copy for the start screen and Settings › Sets: a set made or
 * renamed in one is the same in the other at once.
 *
 * Read afresh whenever a screen that shows them opens, and when the band
 * service may have changed them: a check brought what the band changed, or
 * the service would not take a name (onBandChanges). The choice is kept
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

/**
 * Puts a song taken out of a set back in it, the Undo of its notice: into
 * the set as Python has it now, which may have changed since, before the
 * song that came after it (lib/setSongs withSongBack). Whatever screen is
 * open, the sets here follow. Returns why it could not, or null.
 */
export async function putSongBack(
  setId: number,
  title: string,
  at: number,
  next: string | null
): Promise<string | null> {
  const set = (await api().list_sets()).find((s) => s.id === setId)
  if (!set) return "its set was deleted"
  const titles = withSongBack(set.songs.map((s) => s.title), title, at, next)
  const res = await api().update_set(setId, null, titles)
  if (!res.ok) return res.error ?? "Could not change the set"
  if (res.sets) setsChanged(res.sets)
  return null
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
    return onBandChanges(() => void loadSets())
  }, [])
  return { sets: now.sets, chosen: valid(now), choose: chooseSet, replace: setsChanged }
}
