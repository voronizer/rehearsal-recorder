import { InstrumentIcon } from "@/components/InstrumentIcon"
import { MidiGlyph } from "@/components/midi/MidiGlyph"
import { NotesFold } from "@/components/midi/NotesFold"
import { NotesMute } from "@/components/midi/NotesMute"
import { LanePlate } from "@/components/ui/lane-plate"
import { Whole } from "@/components/ui/whole"
import { cn } from "@/lib/utils"

/** The least a notes plate is tall, and so the row it is in: room for the
 *  lane beside it to name six drum rows, 0.875rem each (NotesLane's
 *  LABEL_MIN_REM), between the lane's own 3 px above and below them, and for
 *  the well round the lane. Its own two rows, as a track's plate has them,
 *  take 56 at the scale of 1, which would leave the drums' rows unnamed; a
 *  lane of notes is not so short that a kit cannot be read.
 *
 *  The rows' names are 12 px text, so they grow and shrink with the scale, and
 *  six of them are 5.25rem. The rest is not rem, whatever the scale:
 *  - beside a Both track's notes, right under their audio, 10 px: the lane's
 *    own 3 and 3, the 1 px line under the audio, and the group's 3 below.
 *    That is 94 at the scale of 1;
 *  - beside a MIDI-only track's, a row of their own, 12 px: the lane's own 3
 *    and 3, and the group's 3 above and 3 below. That is 96.
 *  Folded, the row is a strip and the plate has no least height
 *  (Timeline's NOTES_STRIP). */
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
 * the player's lanes group. Paired, it is the row under a Both track's audio,
 * on the same grey, with no name or icon: those are on the row above (Alex,
 * 2026-11-10 12:53Z). On its own, for a track that records MIDI only, it has
 * the track's icon and name. Either way the MIDI sign stands right before M.
 *
 * In the player (`fold`) the arrow after M opens the notes and folds them
 * (NotesFold), and the line stays near the plate's top, open or folded, so
 * the arrow does not move under the pointer (12:55Z). Folded, the port is
 * left out: the strip has no room for it.
 *
 * Open, its height is what it holds, and no less than MIN_HEIGHT: the lane
 * beside it grows to it, less the room round it. A long name or port is cut
 * to its line, and whole in the shared tip on hover and, once cut, on
 * keyboard focus (Whole's reach): the plate has no room to give it a second
 * line.
 */
export function NotesPlate({
  name,
  icon,
  port,
  paired = false,
  missing = false,
  fold,
}: {
  name: string
  /** The band's icon for the track; none draws the neutral one. */
  icon?: string
  /** The name of the port the notes came from, or were to come from. */
  port: string
  /** The row under the track's audio, on the same grey. */
  paired?: boolean
  /** The port was not there the whole take, and no .mid was saved. */
  missing?: boolean
  /** In the player: whether the notes are open, and the id of the lane the
   *  arrow opens. The Collapsible round both is the caller's (Timeline). */
  fold?: { open: boolean; controls: string }
}) {
  const folded = fold !== undefined && !fold.open
  return (
    <LanePlate
      data-notes-plate={name}
      data-paired={paired || undefined}
      data-missing={missing || undefined}
      grouped
      className={cn(
        "gap-1",
        // The line 2 px under the row's top under a track, 6 alone: where it
        // is folded, so opening moves nothing on it.
        fold && cn("justify-start", paired ? "pt-0.5" : "pt-1.5", folded && "pb-0")
      )}
      style={{ minHeight: folded ? undefined : paired ? MIN_HEIGHT.paired : MIN_HEIGHT.alone }}
    >
      {/* M where a track's M is, in the same column, though on the name's
          row, and the arrow where its S is: the port under them keeps the
          plate's whole width. */}
      <div className="flex h-5 items-center gap-2">
        {paired ? (
          <span className="flex-1" />
        ) : (
          <>
            <InstrumentIcon icon={icon} className="size-4 shrink-0 text-muted-foreground" />
            <Whole
              text={name}
              reach
              data-plate-name={name}
              className="min-w-0 flex-1 truncate text-sm leading-4"
            />
          </>
        )}
        <span role="img" aria-label="MIDI" className="flex shrink-0">
          <MidiGlyph className="size-4 text-muted-foreground" />
        </span>
        <span className="flex w-[2.875rem] shrink-0 gap-1.5">
          <NotesMute name={name} missing={missing} />
          {fold && <NotesFold name={name} open={fold.open} controls={fold.controls} />}
        </span>
      </div>
      {port && !folded && <Whole text={port} reach className="truncate text-xs leading-4 text-muted-foreground" />}
    </LanePlate>
  )
}
