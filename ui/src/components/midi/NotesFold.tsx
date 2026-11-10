import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { motionOff } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * The arrow after a lane of notes' M, where a track has S, that opens the
 * notes and folds them again (Alex, 2026-11-10: a bare grey chevron, as on
 * History's song days, SongLadder). It points right while they are folded and
 * down while they are open. Its name stays "Drums notes" either way, and
 * aria-expanded says which; no tip, as the chevron says it.
 */
export function NotesFold({ name, open, onToggle }: { name: string; open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-tiny"
      data-notes-fold
      aria-label={`${name} notes`}
      aria-expanded={open}
      onClick={onToggle}
      className="size-5 rounded-sm text-muted-foreground"
    >
      <ChevronRight className={cn("size-3.5", !motionOff() && "transition-transform", open && "rotate-90")} />
    </Button>
  )
}
