import { Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Take } from "@/lib/api"

/**
 * ★ on a take: one click puts it on, another takes it off, without asking,
 * since it is as easy to take off as to put on. Filled on a starred take.
 * Where it sits decides when an empty one shows; the overview shows it under
 * the mouse, as it shows Rename and Delete.
 *
 * It says what it will ask for, not "toggle": the click sends the opposite
 * of what this take says now, so two quick clicks on a stale row ask for
 * the same thing twice rather than undoing each other.
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
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Star ${take.name}`}
      aria-pressed={starred}
      title={starred ? "Starred. Click to take the star off" : "Star this take"}
      onClick={() => onStar(take, !starred)}
      className={cn(
        starred
          ? "text-signal hover:text-signal"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      <Star className={cn(starred && "fill-current")} />
    </Button>
  )
}
