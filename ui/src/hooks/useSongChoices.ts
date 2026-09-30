import { useEffect, useState } from "react"
import { api, type SongChoices } from "@/lib/api"

/**
 * The songs a take can be named after, fetched while `enabled`: what its
 * rehearsal played and every other song in the library. `folder` left out
 * is the rehearsal in progress; `takeNumber` is the take being named.
 * `version` is anything that changes when the rehearsal's takes do, for a
 * list that stays on screen while they are renamed and added to.
 */
export function useSongChoices(
  enabled: boolean,
  folder?: string | null,
  takeNumber?: number | null,
  version?: string
): SongChoices | null {
  const [choices, setChoices] = useState<SongChoices | null>(null)
  useEffect(() => {
    if (!enabled) return
    let current = true
    api()
      .song_choices(folder ?? null, takeNumber ?? null)
      .then((c) => current && setChoices(c))
      // Without them the name is typed, as it always was.
      .catch(() => current && setChoices(null))
    return () => {
      current = false
    }
  }, [enabled, folder, takeNumber, version])
  return enabled ? choices : null
}
