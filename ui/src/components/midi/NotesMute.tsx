import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * M on a lane of notes, pressed for good (Alex, 2026-11-04, pick A): the app
 * never plays notes, and a pressed M says so where every track says it is
 * silent, with no words on the plate. It looks pressed and a press does
 * nothing; the tip says why. It is faded as a control that is off is (Alex,
 * 2026-11-04), so it does not read as a button to press. It stands where a
 * track's M does, and S's place beside it is left empty, so the column of M
 * lines up down the lanes.
 */
export function NotesMute({ name, missing = false }: { name: string; missing?: boolean }) {
  const why = missing ? "Not connected, no .mid saved" : "Saved as .mid, not played here"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span data-notes-mute className="flex">
          <Toggle
            variant="outline"
            size="lane"
            tone="mute"
            pressed
            onPressedChange={() => {}}
            aria-disabled
            aria-label={`${name}: ${why}`}
            className="cursor-default font-semibold opacity-50"
          >
            M
          </Toggle>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span aria-hidden>{why}</span>
      </TooltipContent>
    </Tooltip>
  )
}
