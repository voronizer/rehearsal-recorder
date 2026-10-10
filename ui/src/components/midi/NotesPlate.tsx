import { InstrumentIcon } from "@/components/InstrumentIcon"
import { MidiGlyph } from "@/components/midi/MidiGlyph"
import { cn } from "@/lib/utils"

/**
 * The plate beside a lane of notes: what the notes are, the port they came
 * from, and that they are for a DAW. Nothing to mute, solo or turn up: the
 * app never plays them.
 *
 * Paired, it is the lower half of a Both track's card, under its audio plate
 * and a dashed line, and says MIDI with the MIDI sign: the name and the icon
 * are on the half above. On its own, for a track that records MIDI only, it
 * has the track's icon and name.
 *
 * Its height is what it holds: the lane beside it grows to it. A long name
 * or port goes onto more lines rather than losing its end.
 */
export function NotesPlate({
  name,
  icon,
  port,
  paired = false,
  missing = false,
}: {
  name: string
  /** The band's icon for the track; none draws the neutral one. */
  icon?: string
  /** The name of the port the notes came from, or were to come from. */
  port: string
  /** The lower half of the track's card, under its audio. */
  paired?: boolean
  /** The port was not there the whole take, and no .mid was saved. */
  missing?: boolean
}) {
  return (
    <div
      data-notes-plate={name}
      data-paired={paired || undefined}
      data-missing={missing || undefined}
      className={cn(
        "flex h-full flex-col justify-center gap-2 rounded-lg border bg-card px-3.5 py-2",
        paired && "rounded-t-none [border-top-style:dashed]"
      )}
    >
      <div className="flex items-center gap-2.5">
        {paired ? (
          <MidiGlyph className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <InstrumentIcon icon={icon} className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm leading-4 [overflow-wrap:anywhere]">
            {paired ? "MIDI" : name}
          </span>
          {port && (
            <span className="text-[11px] leading-3.5 text-muted-foreground [overflow-wrap:anywhere]">
              {port}
            </span>
          )}
        </span>
      </div>
      <span className="text-[11px] leading-3.5 text-muted-foreground">
        {missing ? "Not connected, no .mid saved" : "Saved as .mid, not played here"}
      </span>
    </div>
  )
}
