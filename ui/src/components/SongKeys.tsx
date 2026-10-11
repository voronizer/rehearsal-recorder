import { Kbd } from "@/components/ui/kbd"
import { cn } from "@/lib/utils"

/**
 * ↑ and ↓ at the right of the Next take label: they pick the song before
 * or after (issue #12 step 8, K5). Hidden while a take is open, when they
 * are the strip's; hidden, not taken away, so the field does not move.
 */
export function SongKeys({ hidden = false }: { hidden?: boolean }) {
  return (
    <span
      data-song-keys
      title="↑ ↓ the song before or after"
      aria-hidden
      className={cn(
        "flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground",
        hidden && "invisible"
      )}
    >
      <Kbd>↑</Kbd>
      <Kbd>↓</Kbd>
      <span>song</span>
    </span>
  )
}
