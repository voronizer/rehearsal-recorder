import { ChevronDown, Gauge, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAfter } from "@/hooks/useAfter"
import { formatPercent } from "@/lib/format"
import { SPINNER_AFTER_MS } from "@/lib/playLook"
import { cn } from "@/lib/utils"

/*
  How fast a take plays, in its own key: the band service's, beside Repeat
  on a take's page and in the bar at the bottom (#105). РЭХА has none.

  One button with the speed on it; a press opens the speeds (Alex's pick A,
  2026-11-15 14:14Z). While not 100% it is grey, as Repeat is when pressed
  (Alex's pick A, 15:08Z). The number keeps the room of "100%", so the row
  does not move as the speed changes (B4).
*/

/** The speeds in the list, half to one and a half (Alex, 2026-11-15 14:09Z). */
const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5]

/** The look of Toggle's "on", here on an outline Button, whose own dark fill would win without the `dark:` pair. */
const LIT = "bg-selected text-foreground hover:bg-selected dark:bg-selected dark:hover:bg-selected"

const FAILED = "The speed could not load. Pick it again."

export function SpeedButton({
  value,
  onChange,
  bare = false,
  busy = false,
  failed = false,
  disabled = false,
}: {
  /** 1 as recorded. */
  value: number
  onChange: (rate: number) => void
  /** The phone's bar: the number alone, no icon or arrow, and no tip. */
  bare?: boolean
  /** What keeps the key is loading: from the second on, a spinner (B5). */
  busy?: boolean
  /** It could not load: the take went back to 100%, and the button says so until the next pick (Alex, 15:10Z). */
  failed?: boolean
  disabled?: boolean
}) {
  const spinning = useAfter(busy, SPINNER_AFTER_MS)
  const sign = failed ? (
    <TriangleAlert className="text-warn" />
  ) : spinning ? (
    <Spinner after={0} />
  ) : bare ? null : (
    <Gauge />
  )
  const shown = formatPercent(value)
  const button = (
    <DropdownMenuTrigger asChild>
      <Button
        variant="outline"
        size="row"
        disabled={disabled}
        className={cn("tnum gap-1 px-2.5", value !== 1 && LIT)}
        aria-label={`Speed ${shown}`}
        aria-description={failed ? FAILED : undefined}
      >
        {sign}
        <span className="grid text-center">
          <span className="invisible col-start-1 row-start-1" aria-hidden>
            100%
          </span>
          <span className="col-start-1 row-start-1">{shown}</span>
        </span>
        {!bare && <ChevronDown className="size-3.5 opacity-60" />}
      </Button>
    </DropdownMenuTrigger>
  )
  return (
    <DropdownMenu>
      {bare ? (
        button
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>{failed ? FAILED : "Speed, in the same key"}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent align="end" className="w-32">
        <DropdownMenuRadioGroup value={String(value)} onValueChange={(v) => onChange(Number(v))}>
          {SPEEDS.map((s) => (
            <DropdownMenuRadioItem key={s} value={String(s)} className="tnum">
              {formatPercent(s)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
