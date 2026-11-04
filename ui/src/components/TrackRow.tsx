import { Check, Trash2, TriangleAlert } from "lucide-react"
import { ChannelsIcon } from "@/components/ChannelsIcon"
import { Button } from "@/components/ui/button"
import { Meter } from "@/components/ui/meter"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { WholeTip, useCut } from "@/components/ui/whole"
import { IconPicker } from "@/components/IconPicker"
import { NameField } from "@/components/NameField"
import { END_COLUMN, END_WORD, ModeSwitch } from "@/components/midi/ModeSwitch"
import { NotesCheck } from "@/components/midi/NotesCheck"
import { PortPicker } from "@/components/midi/PortPicker"
import type { MidiPorts, RecordMode, Track } from "@/lib/api"
import { meterReach } from "@/lib/levels"
import { modeOf, recordsAudio, recordsNotes } from "@/lib/midi"
import { lineText, type PortLine } from "@/lib/midiPorts"
import { cn } from "@/lib/utils"

/**
 * One musician's row in the start screen's tracks group: who it is and what
 * it records on its top line, then a line for each thing it records, the
 * input and the MIDI port, each with the check's meter at its end. Those
 * lines start under the name and end under the switch, so the meters line up
 * under it in the end column.
 *
 * The row only draws: the screen works out what the check heard and what is
 * the matter with the port, by the track's place in the band, and is told of
 * every change.
 */
export function TrackRow({
  n,
  track,
  inputs,
  waiting,
  checking,
  level,
  signal,
  ports,
  portWarn,
  portNote,
  notes,
  onChange,
  onMode,
  onStereo,
  onRemove,
}: {
  /** Its place in the band, from 1, which its controls are named by. */
  n: number
  track: Track
  /** How many inputs the interface has. */
  inputs: number
  /** It records sound and has no input to record it from. */
  waiting: boolean
  /** The check is running, so the meters show; their room is kept while not. */
  checking: boolean
  /** What the check last heard from its input, each side as Python sends it. */
  level: number[]
  /** Every side of its input has sent something since the check began. */
  signal: boolean
  /** The MIDI ports the system lists; null until they have first been read. */
  ports: MidiPorts | null
  /** The picker's warning edge: no port picked, or the one picked is away. */
  portWarn: boolean
  /** What its port line says beside the picker, or null for nothing. */
  portNote: PortLine | null
  /** What the check hears from its port; null while it has not opened it. */
  notes: { seen: boolean; vel: number } | null
  onChange: (patch: Partial<Track>) => void
  onMode: (mode: RecordMode) => void
  onStereo: () => void
  onRemove: () => void
}) {
  return (
    <div
      data-track-row
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-t px-6 py-4"
    >
      {/* Who it is and what it records. A long name goes onto a second line
          rather than losing its end (D5). */}
      <IconPicker
        label={`Track ${n} icon`}
        name={track.name || `track ${n}`}
        value={track.icon}
        onChange={(icon) => onChange({ icon })}
      />
      <div className="flex min-w-0 items-start gap-3">
        <NameField
          label={`Track ${n} name`}
          placeholder="Track name"
          value={track.name}
          onChange={(name) => onChange({ name })}
        />
        <ModeSwitch label={`Track ${n} records`} value={modeOf(track)} onChange={onMode} />
      </div>
      <Button
        variant="ghost"
        size="icon-row"
        aria-label={`Remove track ${track.name}`}
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>

      {/* Under the name, a line for each thing it records, the check's meter
          at the end. The meter's place is kept while nothing is checked, so
          a check moves nothing. */}
      {recordsAudio(track) && (
        <div className="col-start-2 flex items-center gap-3">
          <Select
            value={waiting ? "" : String(track.channel ?? "")}
            onValueChange={(v) => onChange({ channel: Number(v) })}
          >
            <SelectTrigger
              size="sm"
              aria-label={`Track ${n} input`}
              className={cn("w-32", waiting && "border-warn/60 text-muted-foreground")}
            >
              <SelectValue placeholder="No input" />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: inputs }, (_, c) => c + 1)
                // A stereo track takes the input after its own, so the last
                // input is not somewhere it can start.
                .filter((c) => !track.stereo || c < inputs)
                .map((c) => (
                  <SelectItem key={c} value={c.toString()}>
                    {track.stereo ? `Inputs ${c}–${c + 1}` : `Input ${c}`}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          {/* The Toggle round the tip's trigger, not the other way: the
              Toggle's on or off is then the one the button says. */}
          <Tooltip>
            <Toggle
              asChild
              variant="outline"
              size="icon-row"
              pressed={!!track.stereo}
              onPressedChange={onStereo}
              aria-label={`Track ${n} in stereo`}
            >
              <TooltipTrigger>
                <ChannelsIcon stereo={!!track.stereo} />
              </TooltipTrigger>
            </Toggle>
            <TooltipContent>
              {track.stereo
                ? "Stereo: two adjacent inputs, written as one stereo file"
                : "Mono. Press for stereo: two adjacent inputs, written as one stereo file"}
            </TooltipContent>
          </Tooltip>

          <div data-check-slot="signal" className={cn("ml-auto flex shrink-0", END_COLUMN)}>
            <div className={cn("flex flex-1 items-center gap-2", !checking && "invisible")}>
              {/* One bar, split along its length for a stereo track: left
                  above, right below. A dead half of a pair has to be visible
                  here or the check has not done its job. In dB, as on the
                  recording screen and the desk. */}
              <Meter
                data-meter={track.name}
                sides={level.map(meterReach)}
                tone="signal"
                className="flex-1"
              />
              {signal ? (
                <span className={cn("flex items-center gap-1 text-xs text-signal", END_WORD)}>
                  <Check className="size-3" />
                  signal
                </span>
              ) : (
                <span className={cn("text-xs text-muted-foreground", END_WORD)}>silent</span>
              )}
            </div>
          </div>
        </div>
      )}

      {recordsNotes(track) && (
        <div className="col-start-2 flex items-center gap-3">
          <PortPicker
            label={`Track ${n} MIDI port`}
            value={track.midi_port}
            ports={ports}
            counting={checking}
            warn={portWarn}
            onChange={(port) => onChange({ midi_port: port })}
          />
          {portNote ? (
            // Drawn afresh when a name comes into it or leaves it, so that
            // what is cut is measured on what is there.
            <PortNote key={portNote.who ? "who" : "words"} line={portNote} />
          ) : (
            // What the check hears from the port is said only for a port it
            // opened: one picked since says nothing until the next check.
            <div
              data-check-slot="notes"
              className={cn("ml-auto grid shrink-0 items-center", END_COLUMN)}
            >
              <NotesCheck
                seen={notes?.seen ?? false}
                vel={notes?.vel ?? 0}
                className={cn("col-start-1 row-start-1", !notes && "invisible")}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * What is the matter with a track's port, beside its picker. It takes the
 * check's room at the line's end too, and keeps to the two lines the
 * picker's height has room for, so it moves no row as it comes or goes (B4).
 * The picker leaves it room for its own words in two lines. Another track's
 * name in it has at most half a line, and gives way there, so the words
 * round it are always read; cut, the sentence is whole in its tip on hover
 * and keyboard focus (B6). A screen reader reads it whole either way.
 */
function PortNote({ line }: { line: PortLine }) {
  const [words, cutWords] = useCut<HTMLSpanElement>()
  const [who, cutWho] = useCut<HTMLSpanElement>()
  const cut = cutWords || cutWho
  return (
    <WholeTip cut={cut} text={lineText(line)}>
      <p
        role="status"
        data-port-note
        tabIndex={cut ? 0 : undefined}
        className="flex min-w-0 flex-1 items-start gap-1 rounded-sm text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <TriangleAlert className="mt-px size-3.5 shrink-0 text-warn" />
        <span ref={words} data-cut={cutWords || undefined} className="line-clamp-2 min-w-0">
          {line.before}
          {line.who && (
            <span
              ref={who}
              data-who
              data-cut={cutWho || undefined}
              className="inline-block max-w-1/2 truncate align-top"
            >
              {line.who}
            </span>
          )}
          {line.after}
        </span>
      </p>
    </WholeTip>
  )
}
