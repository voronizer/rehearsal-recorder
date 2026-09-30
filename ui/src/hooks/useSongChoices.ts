import { useEffect, useState } from "react"
import { api, type SongChoices } from "@/lib/api"

/**
 * The songs a take can be named after, fetched while `enabled`: what its
 * rehearsal played and every other song in the library. `folder` left out
 * is the rehearsal in progress; `takeNumber` is the take being named.
 */
export function useSongChoices(
  enabled: boolean,
  folder?: string | null,
  takeNumber?: number | null
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
  }, [enabled, folder, takeNumber])
  return enabled ? choices : null
}
