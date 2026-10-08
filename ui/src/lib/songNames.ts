import { useSyncExternalStore } from "react"
import { api } from "@/lib/api"

/**
 * Songs' old names forgotten, counted, so every list of songs on screen
 * (useSongChoices) is read again: a name forgotten from a name field must
 * stop leading to its song in that very field.
 */
let version = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** How many times an old name has been forgotten since the app started. */
export function useSongNamesVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}

/** Forgets an old name of a song (api.forget_song_name): typed again, it is
 *  a new song. Whether Python had it. */
export async function forgetSongName(name: string): Promise<boolean> {
  const res = await api().forget_song_name(name)
  version++
  for (const l of listeners) l()
  return res.ok
}
