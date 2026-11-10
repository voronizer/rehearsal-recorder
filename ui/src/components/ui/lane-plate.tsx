import * as React from "react"
import { cn } from "@/lib/utils"

/*
  The plate beside a track's lane (C6): the audio track's, the notes' and the
  master's are this one box, 12 px across and 8 above and below, with no
  frame; what it holds, and the gap between, is the caller's. On its own it
  is a card: the card's fill and 12 px corners, as the master's plate is.
  `grouped`, it is a plate in a row of the player's lanes group (Timeline),
  as a track's and its notes' are: it has no fill and no corners of its own,
  and the grey behind it is Timeline's (PlateGrey), round a track and its
  notes together.

  At 56 px a plate has room for a name of 16 px and under it a row of 20 (the
  fader, with M and S after it), 2 apart on the grey and 4 elsewhere, so a
  lane's plate is exactly as tall as its lane.
*/
function LanePlate({
  grouped = false,
  className,
  children,
  ...div
}: React.ComponentProps<"div"> & { grouped?: boolean }) {
  return (
    <div
      data-slot="lane-plate"
      className={cn(
        "flex h-full flex-col justify-center px-3 py-2",
        !grouped && "rounded-lg bg-card",
        className
      )}
      {...div}
    >
      {children}
    </div>
  )
}

export { LanePlate }
