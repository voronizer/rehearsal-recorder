import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { MasterControls, VolumeIcon } from "@/components/LaneControls"
import {
  keepListeningVolume,
  loadListeningVolume,
  turnListeningVolume,
  useListeningVolume,
  usePlaybackMuted,
  useMixLevel,
} from "@/lib/listening"

/**
 * How loud takes play, from the header of every screen a take can be played
 * on. A take played from a row (Last time, a rehearsal's overview) has no
 * player on screen, and the master fader under a take's tracks was the only
 * way to turn it down. When playback goes out through the audio interface,
 * the Mac's own volume keys often do nothing, so this is the only level
 * there is.
 *
 * It is the master fader itself, behind a speaker: the same level, the same
 * meter, kept the same way. It can be set before anything plays, and the
 * next take opens at it.
 */
export function ListeningVolume() {
  const volume = useListeningVolume()
  const muted = usePlaybackMuted()
  // Opened with the mouse, focus stays on the speaker, so once the slider
  // is shut Space is the screen's again: hooks/useSpacebar lets go of a
  // button the mouse left focus on. With the slider focused on opening,
  // Escape handed focus back to the speaker as if the keyboard had put it
  // there, and Space opened the slider again instead of playing. Opened
  // from the keyboard, focus goes to the slider, so the arrows turn it.
  const byPointer = useRef(false)

  useEffect(() => {
    void loadListeningVolume()
  }, [])

  return (
    <Popover>
      {/* How loud, in the shared tip beside the gear's: the button's name
          says what it is, the tip what it is set to. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Playback volume"
              aria-description={muted ? "Playback muted" : undefined}
              onPointerDown={() => (byPointer.current = true)}
              onKeyDown={() => (byPointer.current = false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <VolumeIcon volume={muted ? 0 : volume} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{muted ? "Playback muted" : `Playback volume ${Math.round(volume * 100)}%`}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        aria-label="Playback volume"
        className="w-64 p-0"
        onOpenAutoFocus={(e) => {
          if (byPointer.current) e.preventDefault()
        }}
      >
        <Level />
      </PopoverContent>
    </Popover>
  )
}

/** Only drawn while the slider is out, so the meter moving does not redraw
 *  the header. */
function Level() {
  return (
    <MasterControls
      volume={useListeningVolume()}
      level={useMixLevel()}
      onVolume={turnListeningVolume}
      onVolumeCommit={keepListeningVolume}
      className="border-0 bg-transparent"
    />
  )
}
