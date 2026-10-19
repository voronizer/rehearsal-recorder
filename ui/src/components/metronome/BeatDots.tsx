import type { Signature } from "@/lib/api"
import { accentOf, perBar } from "@/lib/metronome"
import { cn } from "@/lib/utils"

/**
 * The beat, a dot for each click of a bar, the accented ones larger: the
 * first of a bar, and in 6/8 the fourth too, where 6/8's six sit in two
 * groups of three. The click heard now is lit in the accent, as what plays
 * is, and goes dark with no fade: the dots are a reading, as a meter is
 * (F11), so they keep lighting while a take records and under Reduce motion.
 *
 * The box keeps the room six dots take, so a song in another signature
 * moves nothing after it. A picture: the line beside it says it in words.
 */
export function BeatDots({
  signature,
  lit,
  className,
}: {
  signature: Signature
  /** The click lit now, by its place in the bar from 0, or null. */
  lit: number | null
  className?: string
}) {
  const sixEight = signature === "6/8"
  return (
    <div
      data-beat-dots
      aria-hidden
      className={cn(
        "flex w-[3.625rem] shrink-0 items-center",
        sixEight ? "gap-[3px]" : "gap-1.5",
        className
      )}
    >
      {Array.from({ length: perBar(signature) }, (_, i) => (
        <span
          key={i}
          data-dot
          data-lit={lit === i ? "" : undefined}
          className={cn(
            "shrink-0 rounded-full",
            accentOf(signature, i) > 0 ? "size-2" : "size-1.5",
            // The second three of 6/8 a group of their own: 6 px between.
            sixEight && i === 3 && "ml-[3px]",
            lit === i ? "bg-primary" : "bg-muted-foreground/30"
          )}
        />
      ))}
    </div>
  )
}
