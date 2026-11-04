import { InstrumentIcon } from "@/components/InstrumentIcon"
import { MidiGlyph } from "@/components/midi/MidiGlyph"
import { NotesMute } from "@/components/midi/NotesMute"
import { LanePlate } from "@/components/ui/lane-plate"
import { Whole } from "@/components/ui/whole"

/** The least a notes plate is tall, and so the row it is in: room for the
 *  lane beside it to name six drum rows, 0.875rem each (NotesLane's
 *  LABEL_MIN_REM), between the lane's own 3 px above and below them, and for
 *  the well round the lane. Its own two rows, as a track's plate has them,
 *  take 56 at the scale of 1, which would leave the drums' rows unnamed; a
 *  lane of notes is not so short that a kit cannot be read.
 *
 *  The rows' names are 12 px text, so they grow and shrink with the scale, and
 *  six of them are 5.25rem. The rest is not rem, whatever the scale:
 *  - beside a Both track's notes, which share their audio's well, 10 px: the
 *    lane's own 3 and 3, the 1 px line under the audio, and the well's 3
 *    below. That is 94 at the scale of 1;
 *  - beside a MIDI-only track's, on a well of its own, 12 px: the lane's own
 *    3 and 3, and the well's 3 above and 3 below. That is 96. */
const MIN_HEIGHT = {
  paired: "calc(5.25rem + 10px)",
  alone: "calc(5.25rem + 12px)",
}

/**
 * The plate beside a lane of notes: what the notes are, the port they came
 * from, and M pressed for good (NotesMute), since the app never plays them.
 * No fader and no S: nothing to turn up or solo.
 *
 * It is the audio plate (ui/lane-plate) with other things in it, a row of
 * the player's lanes group on the group's fill. Paired, it is the row under a
 * Both track's audio, and says MIDI with the MIDI sign: the name and the icon
 * are on the row above. On its own, for a track that records MIDI only, it
 * has the track's icon and name.
 *
 * Its height is what it holds, and no less than MIN_HEIGHT: the lane beside it
 * grows to it, less its well. A long name or port is cut to its line, and
 * whole in the shared tip on hover and, once cut, on keyboard focus (Whole's
 * reach): the plate has no room to give it a second line.
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
  /** The row under the track's audio, its notes sharing the audio's well. */
  paired?: boolean
  /** The port was not there the whole take, and no .mid was saved. */
  missing?: boolean
}) {
  return (
    <LanePlate
      data-notes-plate={name}
      data-paired={paired || undefined}
      data-missing={missing || undefined}
      grouped
      className="gap-1"
      style={{ minHeight: paired ? MIN_HEIGHT.paired : MIN_HEIGHT.alone }}
    >
      {/* M where a track's M is, in the same column, though on the name's
          row: the port under it keeps the plate's whole width. */}
      <div className="flex h-5 items-center gap-2">
        {paired ? (
          <MidiGlyph className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <InstrumentIcon icon={icon} className="size-4 shrink-0 text-muted-foreground" />
        )}
        <Whole
          text={paired ? "MIDI" : name}
          reach
          data-plate-name={paired ? "MIDI" : name}
          className="min-w-0 flex-1 truncate text-sm leading-4"
        />
        <span className="flex w-[2.875rem] shrink-0">
          <NotesMute name={name} missing={missing} />
        </span>
      </div>
      {port && <Whole text={port} reach className="truncate text-xs leading-4 text-muted-foreground" />}
    </LanePlate>
  )
}
