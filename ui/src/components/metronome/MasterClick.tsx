import { Metronome } from "lucide-react"
import { MeterText } from "@/components/metronome/NoteGlyph"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useErrorNotice } from "@/hooks/useErrorNotice"
import { setPlayerClick, usePlayerClick } from "@/hooks/usePlayerClick"
import { clickOf, type TakeClick } from "@/lib/metronome"

/** The notice a refusal is said in. */
const SAID = "player-click"

/**
 * The click with the take, in Master's plate after its name (spec Part 8,
 * Q11 D): the metronome's icon as the 20 px lane toggle M and S are, so
 * the plate keeps its 56 px, and grey when on as every switch is. Pressed,
 * the player plays the click with the take, in step with its count-in, at
 * the metronome's volume under Master's. It stays as it was left from one
 * take to the next, and is off when the app starts (`usePlayerClick`).
 *
 * A take recorded without the click has none to play: the toggle is
 * disabled, and its tip says why. The tip's trigger is the box round the
 * toggle, which a pointer still reaches while the toggle is disabled.
 */
export function MasterClick({ take }: { take: TakeClick | null }) {
  const meter = clickOf(take)
  const on = usePlayerClick()
  const sayError = useErrorNotice(SAID)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-master-click className="-my-0.5 flex shrink-0">
          <Toggle
            variant="outline"
            size="lane"
            aria-label="Click with the take"
            pressed={meter !== null && on}
            disabled={meter === null}
            onPressedChange={async (next) => {
              const res = await setPlayerClick(next)
              if (!res.ok) sayError(res.error ?? "Could not switch the click")
            }}
            className="not-data-[state=on]:text-muted-foreground"
          >
            <Metronome className="size-3.5" />
          </Toggle>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {meter ? (
          <>
            Click with the take: <MeterText tempo={meter.tempo} signature={meter.signature} />
          </>
        ) : (
          "This take was recorded without the click"
        )}
      </TooltipContent>
    </Tooltip>
  )
}
