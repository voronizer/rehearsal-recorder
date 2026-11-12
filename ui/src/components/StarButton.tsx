import { Star } from "lucide-react"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Take } from "@/lib/api"

/**
 * ★ on a take: one click puts it on, another takes it off, without asking,
 * since it is as easy to take off as to put on. Filled on a starred take.
 * Where it sits decides when an empty one shows; the overview shows it under
 * the mouse, as it shows Rename and Delete. What it does is said in a tip.
 *
 * It says what it will ask for, not "toggle": the click sends the opposite
 * of what this take says now, so two quick clicks on a stale row ask for
 * the same thing twice rather than undoing each other.
 *
 * The shared Toggle, with no fill when on: the filled star says it.
 */
export function StarButton({
  take,
  onStar,
  className,
}: {
  take: Take
  onStar: (take: Take, starred: boolean) => void
  className?: string
}) {
  const starred = take.starred ?? false
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="icon-row"
          aria-label={`Star ${take.name}`}
          pressed={starred}
          onPressedChange={(on) => onStar(take, on)}
          // Its own on or off, where the tip's trigger would put its own state.
          data-state={starred ? "on" : "off"}
          className={cn(
            "text-muted-foreground not-data-[state=on]:hover:text-foreground dark:not-data-[state=on]:hover:bg-accent/50",
            "data-[state=on]:bg-transparent data-[state=on]:text-signal data-[state=on]:hover:bg-accent dark:data-[state=on]:hover:bg-accent/50",
            className
          )}
        >
          <Star className={cn(starred && "fill-current")} />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>{starred ? "Starred. Click to take the star off" : "Star this take"}</TooltipContent>
    </Tooltip>
  )
}
