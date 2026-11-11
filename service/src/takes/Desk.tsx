import { InstrumentIcon } from "@/components/InstrumentIcon"
import { LaneControls, MasterControls } from "@/components/LaneControls"
import { MidiGlyph } from "@/components/midi/MidiGlyph"
import { NotesMute } from "@/components/midi/NotesMute"
import { LanePlate } from "@/components/ui/lane-plate"
import { Whole } from "@/components/ui/whole"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import type { NotesFile } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { TakePage } from "../api"
import { notesAlone } from "./player/lanes"

const ROW = "h-14 rounded-lg"

/**
 * On a phone: a row per track as РЭХА's desk draws it, its name, its level,
 * M and S; no wave. After the name, one ring says a mono file and two a
 * stereo one, whose level is in two bars, left above right; the MIDI sign
 * after them says the track recorded its notes too. A track that recorded
 * notes alone has a row of its own after the tracks of sound, with M
 * pressed for good (NotesMute) where theirs is, its name greyed as a
 * track's is while another track is soloed. The take's Backing track comes
 * after them, in a dashed frame and with no fill, as in the player, and
 * Master is the last row, as on a desk.
 *
 * Each row is there from the start, so nothing moves; what is in it comes
 * once the player has read the files, so the rings are never added to a
 * row already drawn.
 */
export function Desk({ take, player, notes }: { take: TakePage; player: MultitrackPlayer; notes: NotesFile[] }) {
  const withNotes = new Set(notes.map((n) => n.name))
  // A take that could not be opened still has its rows, with no rings.
  const ready = player.media.length > 0 || player.loadError !== null
  const band = take.tracks.filter((t) => t.kind !== "backing")
  const backing = take.tracks.filter((t) => t.kind === "backing")
  const track = (t: TakePage["tracks"][number]) => {
    const muted = player.isMuted(t.name)
    const soloed = player.isSoloed(t.name)
    const media = player.media.find((m) => m.name === t.name)
    const isBacking = t.kind === "backing"
    return (
      <div key={t.position} data-desk-row={t.name} className={cn(ROW, !isBacking && "bg-card")}>
        {ready && (
          <LaneControls
            name={t.name}
            icon={media?.icon ?? t.icon ?? undefined}
            backing={isBacking}
            midi={withNotes.has(t.name)}
            channels={media ? (media.channels ?? media.peaks.length) : 0}
            muted={muted}
            soloed={soloed}
            dimmed={muted || (player.hasSolo && !soloed)}
            volume={player.getVolume(t.name)}
            levels={player.getLevels(t.name)}
            onToggleMute={() => player.toggleMute(t.name)}
            onToggleSolo={() => player.toggleSolo(t.name)}
            onVolume={(v) => player.setVolume(t.name, v)}
            onVolumeCommit={player.persistVolumes}
          />
        )}
      </div>
    )
  }
  return (
    <div data-desk className="flex flex-col gap-1">
      {band.map(track)}
      {notesAlone(take, notes).map((n) => (
        <div
          key={n.file}
          data-desk-row={n.name}
          data-desk-notes
          data-dimmed={player.hasSolo || undefined}
          className={cn(ROW, "bg-card")}
        >
          {/* As a track's plate: the name on its line, and under it what the notes are. */}
          {ready && (
            <LanePlate grouped className="gap-1">
              <div className="flex h-4 items-center gap-2">
                <InstrumentIcon icon={n.icon} className="size-4 shrink-0 text-muted-foreground" />
                <Whole
                  text={n.name}
                  reach
                  className={cn("min-w-0 flex-1 truncate text-sm leading-4", player.hasSolo && "text-muted-foreground")}
                />
                <MidiGlyph className="size-4 shrink-0 text-muted-foreground" />
              </div>
              {/* M pressed for good where the other rows have their M. */}
              <div className="flex h-5 items-center justify-end">
                <span className="flex w-[2.875rem] shrink-0">
                  <NotesMute name={n.name} />
                </span>
              </div>
            </LanePlate>
          )}
        </div>
      ))}
      {backing.map(track)}
      <div className={cn(ROW, "bg-card")}>
        <MasterControls
          grouped
          volume={player.master}
          level={player.masterLevel}
          onVolume={player.setMaster}
          onVolumeCommit={player.persistMaster}
        />
      </div>
    </div>
  )
}
