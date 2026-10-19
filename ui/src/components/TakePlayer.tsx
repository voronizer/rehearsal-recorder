import { useEffect, useState, type CSSProperties } from "react"
import {
  CircleAlert,
  Flag,
  Pencil,
  Pause,
  Play,
  Repeat,
  SkipBack,
  TriangleAlert,
  Undo2,
  Redo2,
  X,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { LabelDot } from "@/components/ui/mark"
import { Spinner } from "@/components/ui/spinner"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { WholeTip, useCut } from "@/components/ui/whole"
import { Timeline } from "@/components/Timeline"
import { PlayerKeys } from "@/components/PlayerKeys"
import { useAfter } from "@/hooks/useAfter"
import { useTakeDrift } from "@/hooks/useTakeDrift"
import { useKey } from "@/hooks/useSpacebar"
import { cn } from "@/lib/utils"
import { useKeysOn } from "@/lib/keys"
import { formatMMSS } from "@/lib/format"
import { labelLook, labelOf, markText, useLabels } from "@/lib/labels"
import { rise } from "@/lib/motion"
import { playLabel, SPINNER_AFTER_MS } from "@/lib/playLook"
import { api, type Marker, type MissingNotes, type NotesFile, type TakeNotes } from "@/lib/api"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import type { DriftTake } from "@/lib/drift"

const SKIP_SECONDS = 10
/** A region shorter than this is a slip of the mouse, not an intention. */
const MIN_CROP_SEC = 1
/** A region this close to covering the whole take has nothing to remove. */
const WHOLE_TAKE_SLACK_SEC = 0.05

/**
 * What take_notes read back from a take's .mid files, by track name: asked
 * once for each take opened, and not again to zoom or play, since the notes
 * of a whole take come at once. A track whose port never appeared has no
 * file, and is asked about in the same call for its icon alone.
 *
 * A take is opened again exactly when its lists are new ones: a rename or a
 * crop hands back fresh copies, with the files moved or rewritten. An answer
 * is kept with the lists it was for, so a take opened since never shows the
 * one before's notes while its own are on their way. A read that fails is an
 * answer too: an error for each lane, which the lane says.
 */
function useTakeNotes(notes?: NotesFile[], missing?: MissingNotes[]) {
  const [read, setRead] = useState<{
    notes?: NotesFile[]
    missing?: MissingNotes[]
    byName: Map<string, TakeNotes>
  } | null>(null)
  useEffect(() => {
    const files = [
      ...(notes ?? []).map((n) => ({ name: n.name, file: n.file })),
      ...(missing ?? []).map((m) => ({ name: m.name, file: null })),
    ]
    if (files.length === 0) return
    let alive = true
    api()
      .take_notes(files)
      .then((answers) => {
        if (alive) setRead({ notes, missing, byName: new Map(answers.map((a) => [a.name, a])) })
      })
      .catch(() => {
        // The bar has said what went wrong. Each lane says it too, in place
        // of the spinner it waited with, and the take still plays.
        if (alive)
          setRead({
            notes,
            missing,
            byName: new Map<string, TakeNotes>(
              files.map((f) => [f.name, { name: f.name, error: "Could not read the notes" }]),
            ),
          })
      })
    return () => {
      alive = false
    }
  }, [notes, missing])
  return read && read.notes === notes && read.missing === missing ? read.byName : null
}

/**
 * The take player: shared transport, A–B repeat, listening markers, and the
 * `Timeline` beneath them — the ruler, the per-track lanes with their
 * waveform/volume/M-S, and the loop band all live there now. The same
 * component right after recording and when listening back to old takes.
 */
export function TakePlayer({
  player,
  take = null,
  notes,
  notesMissing,
  markers = [],
  onAddMarker,
  onEditMarker,
  onRemoveMarker,
  onCrop,
  canCrop = true,
  spaceKey = false,
  goKeys = false,
  status,
  rising = false,
}: {
  player: MultitrackPlayer
  /** The take's click: its tempo, its signature, and whether it was
   *  recorded to the click, for Master's button and stripes; and its files
   *  and song, for the band's tempo along Master's lane. */
  take?: DriftTake | null
  /** The take's .mid files, drawn under their audio or in lanes of their
   *  own; and the tracks that took notes and got none. A take from before
   *  MIDI has neither. */
  notes?: NotesFile[]
  notesMissing?: MissingNotes[]
  /** Saved listening markers, in order. */
  markers?: Marker[]
  onAddMarker?: (seconds: number) => void
  onEditMarker?: (marker: Marker) => void
  onRemoveMarker?: (seconds: number) => void
  /** Trim the take down to the region, at once: the take as it was can be
   *  had back with the notice's Undo. Absent where that is not offered. */
  onCrop?: (startSec: number, endSec: number) => void
  /** False while a crop is already running. Rewriting eight long tracks takes
   *  real seconds, and a second click is not a no-op: Python re-reads the now
   *  shorter take and cuts it again. */
  canCrop?: boolean
  /** What the player's line says while a crop of this take runs — how far
   *  along it is. Set only while there is something to say: a line that
   *  is there but empty would keep the warning from being heard. */
  status?: React.ReactNode
  /** Space plays and pauses on this screen. On the review screen it saves
   *  the take instead, and Play must not claim it. */
  spaceKey?: boolean
  /** ↑ and ↓ go to the song's other goes: the take strip is above. */
  goKeys?: boolean
  /** Its groups rise in as the screen comes up, the transport and then the
   *  take, 40 ms apart (F10): on Review, which opens on the player. Where a
   *  take is opened in a screen already up, it is simply there. */
  rising?: boolean
}) {
  const notesRead = useTakeNotes(notes, notesMissing)
  const drift = useTakeDrift(take)
  // The same rule the timeline draws by: one end set reaches to the take's
  // own start or end.
  const { region, duration } = player
  const band =
    region.a !== null || region.b !== null
      ? { a: region.a ?? 0, b: region.b ?? duration }
      : null
  const lost = band ? duration - (band.b - band.a) : 0
  const tooShort = band === null || band.b - band.a < MIN_CROP_SEC
  const cropRegionOk = !tooShort && lost > WHOLE_TAKE_SLACK_SEC

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Transport
        player={player}
        spaceKey={spaceKey}
        goKeys={goKeys}
        markers={markers}
        onAddMarker={onAddMarker}
        onEditMarker={onEditMarker}
        className={cn(rising && "animate-rise")}
        style={rising ? rise(0) : undefined}
      />

      <PlayerLine error={player.loadError} status={status} warning={player.outputWarning} />

      {/* The take is one group, 24 px apart inside it. The line above holds
          that room itself, so it has no gap round it. */}
      <div
        className={cn("flex min-h-0 flex-1 flex-col gap-6", rising && "animate-rise")}
        style={rising ? rise(1) : undefined}
      >
        <Timeline
          player={player}
          take={take}
          drift={drift}
          markers={markers}
          notes={notes}
          notesMissing={notesMissing}
          notesRead={notesRead}
          crop={
            onCrop
              ? {
                  onClick: () => band && onCrop(band.a, band.b),
                  enabled: cropRegionOk && canCrop && !player.loading,
                  // A disabled button cannot be hovered, so a tip on it would
                  // never reach anybody while it matters. The reason has to
                  // be on screen, beside the button it explains. The two
                  // reasons are opposite mistakes, and the advice for one is
                  // no help at all with the other.
                  whyOff: cropRegionOk
                    ? undefined
                    : tooShort
                      ? "at least a second to crop"
                      : "that is the whole take",
                }
              : undefined
          }
        />

        {markers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Marks</span>
            {markers.map((m) => (
              <MarkChip
                key={m.at}
                marker={m}
                onSeek={player.seek}
                onEdit={onEditMarker}
                onRemove={onRemoveMarker}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** One thing said in the line, whole in a tip when it is cut. The tip is on
 *  the line itself, and cut, the line is a Tab stop too, so the keyboard
 *  reaches the whole of it as the pointer does. The ring is round the line
 *  and not the words: the words are cut at their own box, which would clip a
 *  ring drawn outside them. A tip's trigger takes over the data-slot of what
 *  it is put on, which the Alert's own look does not use. */
function Said({ variant, text }: { variant: "warning" | "destructive"; text: string }) {
  const [ref, cut] = useCut<HTMLSpanElement>()
  const Icon = variant === "destructive" ? CircleAlert : TriangleAlert
  return (
    <WholeTip cut={cut} text={text}>
      <Alert
        size="line"
        variant={variant}
        tabIndex={cut ? 0 : undefined}
        className="rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon />
        <AlertDescription>
          <span ref={ref} className="block truncate">
            {text}
          </span>
        </AlertDescription>
      </Alert>
    </WholeTip>
  )
}

/**
 * The one line the player keeps for what it has to say (B4), between the
 * transport and the map: always there, 24 px tall, empty until something
 * comes. So nothing under it moves when a crop starts or the output goes
 * quiet. One thing at a time: a take that did not load, since its lanes
 * never come; else how far a crop is; else the output's warning.
 */
export function PlayerLine({
  error,
  status,
  warning,
}: {
  error: string | null
  status: React.ReactNode
  warning: string | null
}) {
  return (
    <div data-player-line className="flex h-6 shrink-0 items-center">
      {error ? (
        <Said variant="destructive" text={error} />
      ) : status ? (
        status
      ) : warning ? (
        <Said variant="warning" text={warning} />
      ) : null}
    </div>
  )
}

/**
 * A marker of the take: its time, which goes there, and its label and note,
 * which open the marker. Words too long for the room are cut, and show whole
 * in a tip.
 */
function MarkChip({
  marker,
  onSeek,
  onEdit,
  onRemove,
}: {
  marker: Marker
  onSeek: (at: number) => void
  onEdit?: (marker: Marker) => void
  onRemove?: (at: number) => void
}) {
  const labels = useLabels()
  const label = labelOf(labels, marker.label_id)
  const words = markText(label, marker.note)
  const [wordsRef, cut] = useCut<HTMLSpanElement>()
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border bg-card py-0.5 pr-1 pl-2.5",
        labelLook(label.colour).chip
      )}
    >
      <LabelDot colour={label.colour} />
      <Button
        type="button"
        variant="ghost"
        size="icon-tiny"
        onClick={() => onSeek(marker.at)}
        className="tnum w-auto px-1 text-xs"
      >
        {formatMMSS(marker.at)}
      </Button>
      <WholeTip cut={cut} text={words}>
        <Button
          type="button"
          variant="ghost"
          size="icon-tiny"
          onClick={() => onEdit?.(marker)}
          className="w-auto min-w-0 shrink px-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <span ref={wordsRef} className="truncate">
            {words}
          </span>
        </Button>
      </WholeTip>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon-tiny"
          onClick={() => onEdit(marker)}
          aria-label={`Edit mark at ${formatMMSS(marker.at)}`}
          className="text-muted-foreground hover:text-foreground"
        >
          <Pencil />
        </Button>
      )}
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-tiny"
          onClick={() => onRemove(marker.at)}
          aria-label={`Remove mark at ${formatMMSS(marker.at)}`}
          className="rounded-full text-muted-foreground hover:text-destructive"
        >
          <X />
        </Button>
      )}
    </span>
  )
}

function Transport({
  player,
  markers,
  onAddMarker,
  onEditMarker,
  spaceKey,
  goKeys,
  className,
  style,
}: {
  player: MultitrackPlayer
  spaceKey: boolean
  goKeys: boolean
  markers: Marker[]
  onAddMarker?: (seconds: number) => void
  onEditMarker?: (marker: Marker) => void
  className?: string
  style?: CSSProperties
}) {
  const { looping, position, duration } = player

  // A marker within a second of the cursor counts as "this one".
  const nearby = markers.find((m) => Math.abs(m.at - position) < 1)
  const mark = () =>
    nearby !== undefined ? onEditMarker?.(nearby) : onAddMarker?.(position)

  // The arrows are usePlayerKeys, bound by each screen; these three belong
  // to buttons that only exist here, so they are bound where the buttons are.
  useKey("Home", player.restart, !player.loading)
  useKey("m", mark, !!onAddMarker && !player.loading)
  useKey("r", player.toggleLoop, !player.loading)
  // A button says its key only while Settings › Keys has it on.
  const playsOnSpace = useKeysOn("space") && spaceKey
  const playerKeys = useKeysOn("player")
  const key = (name: string) => (playerKeys ? name : undefined)
  // Play keeps its triangle for the first second of a take opening (B5).
  const slow = useAfter(player.loading, SPINNER_AFTER_MS)

  return (
    <div
      role="toolbar"
      aria-label="Transport"
      className={cn("flex flex-wrap items-center gap-3 rounded-xl bg-card px-6 py-4", className)}
      style={style}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-row"
            onClick={player.restart}
            aria-label="To start"
            aria-keyshortcuts={key("Home")}
            disabled={player.loading}
          >
            <SkipBack />
          </Button>
        </TooltipTrigger>
        {/* Only the button's own name again: for the eyes, not read out twice. */}
        <TooltipContent>
          <span aria-hidden>To start</span>
        </TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="icon-row"
        onClick={() => player.skip(-SKIP_SECONDS)}
        aria-label={`Back ${SKIP_SECONDS} seconds`}
        aria-keyshortcuts={key("ArrowLeft")}
        disabled={player.loading}
      >
        <Undo2 />
      </Button>

      {/* Play stays on for a take that could not be loaded: pressed, as
          Space is, it loads the take again and plays it. Its name then is
          the one a take's ▶ has on the other pages, with "the take" for
          the take's own name, which this button does not carry. */}
      <Button
        size="player"
        className="rounded-full"
        onClick={player.toggle}
        disabled={player.loading}
        aria-label={
          player.loadError
            ? playLabel("failed", "the take")
            : player.playing
              ? "Pause"
              : "Play"
        }
        aria-keyshortcuts={playsOnSpace ? "Space" : undefined}
      >
        {slow ? <Spinner after={0} /> : player.playing ? <Pause /> : <Play />}
      </Button>

      <Button
        variant="ghost"
        size="icon-row"
        onClick={() => player.skip(SKIP_SECONDS)}
        aria-label={`Forward ${SKIP_SECONDS} seconds`}
        aria-keyshortcuts={key("ArrowRight")}
        disabled={player.loading}
      >
        <Redo2 />
      </Button>

      <span className="tnum text-sm">
        {formatMMSS(position)}
        <span className="text-muted-foreground"> / {formatMMSS(duration)}</span>
      </span>

      {/* Repeat is part of how the take plays, so it sits with the playing,
          by the time. Clear and Crop are not here: they are about the
          region, and sit under its times on the timeline. */}
      <Toggle
        variant="outline"
        pressed={looping}
        onPressedChange={() => player.toggleLoop()}
        disabled={player.loading}
        aria-label="Repeat"
        aria-keyshortcuts={key("R")}
      >
        <Repeat />
        Repeat
      </Toggle>

      <div className="ml-auto flex items-center gap-1.5">
        {onAddMarker && (
          <Button
            variant="outline"
            size="row"
            onClick={mark}
            disabled={player.loading}
            aria-label={nearby !== undefined ? "Open mark" : "Add mark"}
            aria-keyshortcuts={key("M")}
          >
            <Flag />
            {/* One width whichever it says: nothing beside it moves, and the
                row does not wrap as the playhead nears a mark (B4). */}
            <span className="grid">
              <span className={cn("col-start-1 row-start-1", nearby !== undefined && "invisible")}>
                Mark
              </span>
              <span className={cn("col-start-1 row-start-1", nearby === undefined && "invisible")}>
                Open mark
              </span>
            </span>
          </Button>
        )}

        <PlayerKeys spaceKey={playsOnSpace} goKeys={goKeys} />
      </div>
    </div>
  )
}
