import { useSyncExternalStore } from "react"
import { api } from "@/lib/api"
import { dismiss, notify } from "@/lib/notices"

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
 *  a new song. Whether it was forgotten; if not, a notice says so and
 *  nothing changes. */
export async function forgetSongName(name: string): Promise<boolean> {
  dismiss("song-names")
  const res = await api().forget_song_name(name)
  if (!res.ok) {
    notify({
      key: "song-names",
      kind: "error",
      text: res.error ? `Could not forget ${name}: ${res.error}` : `Could not forget ${name}`,
    })
    return false
  }
  version++
  for (const l of listeners) l()
  return true
}
