import { Metronome } from "lucide-react"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * The metronome's switch, at the start of its row: whether Record clicks,
 * and during a take whether it still does. The metronome's own icon as a
 * toggle, grey when on as every switch is (F2), never the accent; off, the
 * icon is grey. Its line under the row says what off means.
 */
export function ClickSwitch({
  on,
  onChange,
  disabled = false,
}: {
  on: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      {/* The Toggle round the tip's trigger, not the other way: the
          Toggle's on or off is then the one the button says. */}
      <Toggle
        asChild
        size="icon-row"
        aria-label="Click in takes"
        pressed={on}
        onPressedChange={onChange}
        disabled={disabled}
        className="not-data-[state=on]:text-muted-foreground"
      >
        <TooltipTrigger>
          <Metronome />
        </TooltipTrigger>
      </Toggle>
      <TooltipContent>
        <span aria-hidden>Click in takes</span>
      </TooltipContent>
    </Tooltip>
  )
}
