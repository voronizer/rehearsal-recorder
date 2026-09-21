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
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { markerStyle } from "@/lib/markers"
import type { Marker } from "@/lib/api"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"

const SKIP_SECONDS = 10

/**
 * The take player: shared transport, A–B repeat, listening markers, and the
 * `Timeline` beneath them — the ruler, the per-track lanes with their
 * waveform/volume/M-S, and the loop band all live there now. The same
 * component right after recording and when listening back to old takes.
 */
export function TakePlayer({
  player,
  markers = [],
  onAddMarker,
  onEditMarker,
  onRemoveMarker,
}: {
  player: MultitrackPlayer
  /** Saved listening markers, in order. */
  markers?: Marker[]
  onAddMarker?: (seconds: number) => void
  onEditMarker?: (marker: Marker) => void
  onRemoveMarker?: (seconds: number) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Transport
        player={player}
        markers={markers}
        onAddMarker={onAddMarker}
        onEditMarker={onEditMarker}
      />

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

      <Timeline player={player} markers={markers} />

      {markers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Markers</span>
          {markers.map((m) => {
            const style = markerStyle(m.kind)
            return (
              <span
                key={m.at}
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card py-0.5 pr-1 pl-2.5",
                  style.chip
                )}
              >
                <span className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
                <button
                  type="button"
                  onClick={() => player.seek(m.at)}
                  className="tnum shrink-0 text-xs hover:text-primary"
                  title="Jump to this marker"
                >
                  {formatMMSS(m.at)}
                </button>
                {m.note && (
                  <button
                    type="button"
                    onClick={() => onEditMarker?.(m)}
                    className="truncate text-xs text-muted-foreground hover:text-foreground"
                    title={m.note}
                  >
                    {m.note}
                  </button>
                )}
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
    </div>
  )
}

function Transport({
  player,
  markers,
  onAddMarker,
  onEditMarker,
}: {
  player: MultitrackPlayer
  markers: Marker[]
  onAddMarker?: (seconds: number) => void
  onEditMarker?: (marker: Marker) => void
}) {
  const { looping, position, duration } = player

  // A marker within a second of the cursor counts as "this one".
  const nearby = markers.find((m) => Math.abs(m.at - position) < 1)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={player.restart}
        aria-label="To start"
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
        disabled={player.loading}
      >
        <Redo2 />
      </Button>

      <span className="tnum text-sm">
        {formatMMSS(position)}
        <span className="text-muted-foreground"> / {formatMMSS(duration)}</span>
      </span>

      {onAddMarker && (
        <Button
          variant={nearby !== undefined ? "default" : "outline"}
          size="sm"
          onClick={() =>
            nearby !== undefined
              ? onEditMarker?.(nearby)
              : onAddMarker(position)
          }
          disabled={player.loading}
          aria-label={nearby !== undefined ? "Edit marker" : "Add marker"}
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

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          variant={looping ? "default" : "outline"}
          size="sm"
          onClick={player.toggleLoop}
          disabled={player.loading}
          aria-pressed={looping}
          aria-label="Repeat"
          title={
            player.region.a !== null || player.region.b !== null
              ? "Loop the A–B region"
              : "Loop the whole take"
          }
          className={cn(looping && "bg-warn text-warn-foreground hover:bg-warn/90")}
        >
          <Repeat />
          Repeat
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={player.markA}
          disabled={player.loading}
          title="Start of the loop region — at the current position"
          className="tnum"
        >
          A{player.region.a !== null ? ` ${formatMMSS(player.region.a)}` : ""}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={player.markB}
          disabled={player.loading}
          title="End of the loop region — at the current position"
          className="tnum"
        >
          B{player.region.b !== null ? ` ${formatMMSS(player.region.b)}` : ""}
        </Button>
        {(player.region.a !== null || player.region.b !== null) && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={player.clearRegion}
            aria-label="Clear A and B"
            title="Clear the region — repeat will loop the whole take"
          >
            <X />
          </Button>
        )}
      </div>
    </div>
  )
}
