import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CollapsibleTrigger } from "@/components/ui/collapsible"
import { motionOff } from "@/lib/motion"
import { cn } from "@/lib/utils"

/**
 * The arrow after a lane of notes' M, where a track has S, that opens the
 * notes and folds them again (Alex, 2026-11-10: a bare grey chevron, as on
 * History's song days, SongLadder). It points right while they are folded and
 * down while they are open. Its name stays "Drums notes" either way, and
 * aria-expanded says which; no tip, as the chevron says it.
 *
 * It is the trigger of the shared Collapsible round the notes' row
 * (Timeline). Folded, the lane stays as a strip, so it is no
 * CollapsibleContent: `controls` names the lane.
 */
export function NotesFold({ name, open, controls }: { name: string; open: boolean; controls: string }) {
  return (
    <CollapsibleTrigger asChild aria-controls={controls}>
      <Button
        variant="ghost"
        size="icon-tiny"
        data-notes-fold
        aria-label={`${name} notes`}
        className="size-5 rounded-sm text-muted-foreground"
      >
        <ChevronRight className={cn("size-3.5", !motionOff() && "transition-transform", open && "rotate-90")} />
      </Button>
    </CollapsibleTrigger>
  )
}
