import type * as React from "react"
import type { Label, LabelColour } from "@/lib/api"
import { Button, OPENS } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useCut, WholeTip } from "@/components/ui/whole"
import { formatClock, formatMMSS } from "@/lib/format"
import { labelLook, markText } from "@/lib/labels"
import { cn } from "@/lib/utils"

/*
  A mark's pieces (C8): its label's colour as a dot, its note line, and its
  tick on a take's bar. The dot is drawn in five sizes in eleven places today
  and the note line three ways (Last time, a rehearsal's overview, a song's
  page); each place moves onto these as its screen is redone.

  The dot and the tick are pictures of the label, which the line says in
  words, so a screen reader skips them. The dot is 8 px, a step of the
  spacing scale, round; the tick is 3 px wide, with the small corner.
*/

function LabelDot({ colour, className }: { colour: LabelColour; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="label-dot"
      className={cn("size-2 shrink-0 rounded-full", labelLook(colour).dot, className)}
    />
  )
}

/**
 * One mark as a line: the dot, where it is in the take, the take when the
 * line is read away from it, then its label and what was written. The
 * words are cut at the end of the room; the dot and the time never are. Its
 * text size is the caller's. It does nothing when pressed: a place that
 * opens or plays the take at the mark puts it in its button and says so
 * with `opens`, which draws its words as words that open (OPENS).
 *
 * `variant="service"` is the band service's line (C2): the note alone, or
 * the label's name when nothing is written; the label is told by the dot,
 * which names it in a tip, and the time runs to hours as the service's
 * clock does. `wrap`: the words go on to more lines instead of being cut,
 * the dot and the time on the first. `onPress`: the words are the line's
 * button, which does it, with no look of its own; cut short, they show
 * whole in a tip (B6).
 */
function MarkLine({
  label,
  at,
  note,
  take,
  opens = false,
  variant = "default",
  wrap = false,
  onPress,
  className,
}: {
  label: Label
  /** Where in the take, in seconds. */
  at: number
  note: string
  /** The take it is on (its TakeTitle), where the line is not under it. */
  take?: React.ReactNode
  opens?: boolean
  variant?: "default" | "service"
  wrap?: boolean
  onPress?: () => void
  className?: string
}) {
  const service = variant === "service"
  const text = service ? note.trim() || label.name : markText(label, note)
  const [ref, cut] = useCut<HTMLButtonElement>()
  const dot = <LabelDot colour={label.colour} />
  const words = onPress ? (
    <WholeTip cut={cut} text={text}>
      <Button
        ref={ref}
        variant="ghost"
        onClick={onPress}
        className={cn(
          "block h-auto min-w-0 shrink rounded-sm border-0 p-0 text-left text-[length:inherit] font-normal hover:bg-transparent dark:hover:bg-transparent",
          wrap ? "whitespace-normal" : "truncate"
        )}
      >
        {text}
      </Button>
    </WholeTip>
  ) : opens ? (
    <span className={OPENS}>{text}</span>
  ) : (
    text
  )
  return (
    <span data-note className={cn("flex min-w-0 gap-2", wrap ? "items-baseline" : "items-center", className)}>
      {service ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex">{dot}</span>
          </TooltipTrigger>
          <TooltipContent>{label.name}</TooltipContent>
        </Tooltip>
      ) : (
        dot
      )}
      <span className="tnum shrink-0 text-muted-foreground">{service ? formatClock(at) : formatMMSS(at)}</span>
      {/* A button among the words is a box of its own, cut or wrapped in its room. */}
      <span className={cn("min-w-0", onPress ? "flex" : !wrap && "truncate")}>
        {take != null && <span className="shrink-0 text-muted-foreground">{take} · </span>}
        {words}
      </span>
    </span>
  )
}

/**
 * A mark on a take's bar: one tick, 3 px wide, where in the take it fell.
 * `at` is that place as a percent of the bar, which the bar works out (it
 * keeps a mark off the very ends). The bar is its positioned parent; how far
 * the tick runs up and down is the caller's, in `className`.
 *
 * It is drawn in the label's colour and says which in `data-mark-colour`.
 */
function MarkTick({
  colour,
  at,
  className,
}: {
  colour: LabelColour
  /** Where along the bar, as a percent of its width. */
  at: number
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-slot="mark-tick"
      data-mark-colour={colour}
      className={cn("absolute w-[3px] rounded-sm", labelLook(colour).dot, className)}
      style={{ left: `${at}%` }}
    />
  )
}

export { LabelDot, MarkLine, MarkTick }
