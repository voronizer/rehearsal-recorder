import { useEffect, useState } from "react"
import {
  Flag,
  Loader2,
  Pencil,
  Pause,
  Play,
  Repeat,
  SkipBack,
  Undo2,
  Redo2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Timeline } from "@/components/Timeline"
import { ConfirmDialog } from "@/components/ConfirmDialog"
import { PlayerKeys } from "@/components/PlayerKeys"
import { useKey } from "@/hooks/useSpacebar"
import { canBePutBack, goesTo } from "@/lib/deletion"
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { labelLook, labelOf, markText, useLabels } from "@/lib/labels"
import { api, type Marker, type MissingNotes, type NotesFile, type TakeNotes } from "@/lib/api"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"

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
 * one before's notes while its own are on their way.
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
        /* the bar has said so; the lanes stay empty and the take still plays */
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
}: {
  player: MultitrackPlayer
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
  /** Trim the take down to the region. Absent where that is not offered. */
  onCrop?: (startSec: number, endSec: number) => void
  /** False while a crop is already running. Rewriting eight long tracks takes
   *  real seconds, and a second click is not a no-op: Python re-reads the now
   *  shorter take and cuts it again. */
  canCrop?: boolean
  /** A line of its own above the player's warnings — how far along a crop
   *  of this take is. */
  status?: React.ReactNode
  /** Space plays and pauses on this screen. On the review screen it saves
   *  the take instead, and Play must not claim it. */
  spaceKey?: boolean
  /** ↑ and ↓ go to the song's other goes: the take strip is above. */
  goKeys?: boolean
}) {
  const labels = useLabels()
  const [cropping, setCropping] = useState(false)
  const notesRead = useTakeNotes(notes, notesMissing)
  // The same rule the timeline draws by: one end set reaches to the take's
  // own start or end.
  const { region, duration } = player
  const band =
    region.a !== null || region.b !== null
      ? { a: region.a ?? 0, b: region.b ?? duration }
      : null
  const lost = band ? duration - (band.b - band.a) : 0
  const lostMarkers = band
    ? markers.filter((m) => m.at < band.a || m.at > band.b).length
    : 0
  const tooShort = band === null || band.b - band.a < MIN_CROP_SEC
  const cropRegionOk = !tooShort && lost > WHOLE_TAKE_SLACK_SEC

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Transport
        player={player}
        spaceKey={spaceKey}
        goKeys={goKeys}
        markers={markers}
        onAddMarker={onAddMarker}
        onEditMarker={onEditMarker}
      />

      {status}

      {player.outputWarning && !player.loadError && (
        <div className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
          {player.outputWarning}
        </div>
      )}

      {player.loadError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {player.loadError}
        </div>
      )}

      <Timeline
        player={player}
        markers={markers}
        notes={notes}
        notesMissing={notesMissing}
        notesRead={notesRead}
        crop={
          onCrop
            ? {
                onClick: () => setCropping(true),
                enabled: cropRegionOk && canCrop && !player.loading,
                // The two reasons the button can be off are opposite
                // mistakes, and the advice for one is no help at all with
                // the other.
                title: cropRegionOk
                  ? "Keep only this part of the take"
                  : tooShort
                    ? "Mark at least a second of the take to keep"
                    : "Mark a shorter part of the take to keep",
                // And the title never reaches anybody while it matters: a
                // disabled button cannot be hovered. The reason has to be
                // on screen, beside the button it explains.
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
          <span className="text-xs text-muted-foreground">Markers</span>
          {markers.map((m) => {
            const label = labelOf(labels, m.label_id)
            const look = labelLook(label.colour)
            return (
              <span
                key={m.at}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card py-0.5 pr-1 pl-2.5",
                  look.chip
                )}
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", look.dot)} />
                <button
                  type="button"
                  onClick={() => player.seek(m.at)}
                  className="tnum shrink-0 text-xs hover:text-primary"
                  title="Jump to this marker"
                >
                  {formatMMSS(m.at)}
                </button>
                <button
                  type="button"
                  onClick={() => onEditMarker?.(m)}
                  className="truncate text-xs text-muted-foreground hover:text-foreground"
                  title={markText(label, m.note)}
                >
                  {markText(label, m.note)}
                </button>
                {onEditMarker && (
                  <button
                    type="button"
                    onClick={() => onEditMarker(m)}
                    aria-label={`Edit marker at ${formatMMSS(m.at)}`}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
                {onRemoveMarker && (
                  <button
                    type="button"
                    onClick={() => onRemoveMarker(m.at)}
                    aria-label={`Remove marker at ${formatMMSS(m.at)}`}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={cropping}
        onOpenChange={setCropping}
        title={
          band
            ? `Keep only ${formatMMSS(band.a)} – ${formatMMSS(band.b)}?`
            : "Keep only this part?"
        }
        description={`The rest of the take — ${formatMMSS(lost)} — ${goesTo()}${
          lostMarkers > 0
            ? `, and ${lostMarkers} ${
                lostMarkers === 1 ? "marker" : "markers"
              } outside it go with it`
            : ""
        }. ${canBePutBack()}`}
        confirmLabel="Crop"
        cancelLabel="Keep it all"
        onConfirm={() => band && onCrop?.(band.a, band.b)}
      />
    </div>
  )
}

function Transport({
  player,
  markers,
  onAddMarker,
  onEditMarker,
  spaceKey,
  goKeys,
}: {
  player: MultitrackPlayer
  spaceKey: boolean
  goKeys: boolean
  markers: Marker[]
  onAddMarker?: (seconds: number) => void
  onEditMarker?: (marker: Marker) => void
}) {
  const { looping, position, duration, region } = player
  // The same rule the timeline draws by: one end set reaches to the take's
  // own start or end.
  const loopBand =
    region.a !== null || region.b !== null
      ? { a: region.a ?? 0, b: region.b ?? duration }
      : null

  // A marker within a second of the cursor counts as "this one".
  const nearby = markers.find((m) => Math.abs(m.at - position) < 1)
  const mark = () =>
    nearby !== undefined ? onEditMarker?.(nearby) : onAddMarker?.(position)

  // The arrows are usePlayerKeys, bound by each screen; these three belong
  // to buttons that only exist here, so they are bound where the buttons are.
  useKey("Home", player.restart, !player.loading)
  useKey("m", mark, !!onAddMarker && !player.loading)
  useKey("r", player.toggleLoop, !player.loading)

  return (
    <div
      role="toolbar"
      aria-label="Transport"
      className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3"
    >
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={player.restart}
        aria-label="To start"
        aria-keyshortcuts="Home"
        title="To start"
        disabled={player.loading}
      >
        <SkipBack />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => player.skip(-SKIP_SECONDS)}
        aria-label={`Back ${SKIP_SECONDS} seconds`}
        aria-keyshortcuts="ArrowLeft"
        disabled={player.loading}
      >
        <Undo2 />
      </Button>

      <Button
        size="icon-lg"
        className="rounded-full"
        onClick={player.toggle}
        disabled={player.loading || !!player.loadError}
        aria-label={player.playing ? "Pause" : "Play"}
        aria-keyshortcuts={spaceKey ? "Space" : undefined}
      >
        {player.loading ? (
          <Loader2 className="animate-spin" />
        ) : player.playing ? (
          <Pause />
        ) : (
          <Play />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => player.skip(SKIP_SECONDS)}
        aria-label={`Forward ${SKIP_SECONDS} seconds`}
        aria-keyshortcuts="ArrowRight"
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
      <Button
        variant={looping ? "default" : "outline"}
        size="sm"
        onClick={player.toggleLoop}
        disabled={player.loading}
        aria-pressed={looping}
        aria-label="Repeat"
        aria-keyshortcuts="R"
        title={loopBand ? "Loop the marked stretch" : "Loop the whole take"}
        className={cn(looping && "bg-warn text-warn-foreground hover:bg-warn/90")}
      >
        <Repeat />
        Repeat
      </Button>

      <div className="ml-auto flex items-center gap-1.5">
        {onAddMarker && (
          <Button
            variant={nearby !== undefined ? "default" : "outline"}
            size="sm"
            onClick={mark}
            disabled={player.loading}
            aria-label={nearby !== undefined ? "Edit marker" : "Add marker"}
            aria-keyshortcuts="M"
            title={
              nearby !== undefined
                ? "There is already a marker here — open it"
                : "Mark this spot and say what happened"
            }
          >
            <Flag />
            {nearby !== undefined ? "Open mark" : "Mark"}
          </Button>
        )}

        <PlayerKeys spaceKey={spaceKey} goKeys={goKeys} />
      </div>
    </div>
  )
}
