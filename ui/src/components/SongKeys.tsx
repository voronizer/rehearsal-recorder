import { Kbd } from "@/components/ui/kbd"
import { useKeysOn } from "@/lib/keys"

/**
 * ↑ and ↓ at the right of the Next take label: they pick the song before
 * or after (issue #12 step 8, K5). While a take is open they are the
 * strip's, and the take's marks have the panel. With the player's keys off
 * in Settings › Keys they are not there at all.
 */
export function SongKeys() {
  const on = useKeysOn("player")
  if (!on) return null
  return (
    <span data-song-keys aria-hidden className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd>
      <span>song</span>
    </span>
  )
}
