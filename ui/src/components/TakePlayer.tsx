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
import { Waveform } from "@/components/Waveform"
import { cn } from "@/lib/utils"
import { formatMMSS } from "@/lib/format"
import { markerStyle } from "@/lib/markers"
import type { Marker } from "@/lib/api"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"

const SKIP_SECONDS = 10

/**
 * The take player: shared transport, A–B repeat, listening markers, and one
 * row per track with its waveform, volume and M/S. The same component right
 * after recording and when listening back to old takes.
 */
export function TakePlayer({
  player,
  compact = false,
  markers = [],
  onAddMarker,
  onEditMarker,
  onRemoveMarker,
}: {
  player: MultitrackPlayer
  compact?: boolean
  /** Saved listening markers, in order. */
  markers?: Marker[]
  onAddMarker?: (seconds: number) => void
  onEditMarker?: (marker: Marker) => void
  onRemoveMarker?: (seconds: number) => void
}) {
  const { media, duration, position, markers: abMarkers } = player

  // The region is shown on the waveform as soon as one mark is set, before
  // the repeat itself is switched on.
  const region =
    abMarkers.a !== null || abMarkers.b !== null
      ? { a: abMarkers.a ?? 0, b: abMarkers.b ?? duration }
      : null

  return (
    <div className="flex flex-col gap-3">
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

      <div className={cn("flex flex-col", compact ? "gap-1.5" : "gap-2")}>
        {media.map((m) => {
          const muted = player.isMuted(m.name)
          const soloed = player.isSoloed(m.name)
          const dimmed = muted || (player.hasSolo && !soloed)
          return (
            <div
              key={m.name}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card px-4",
                compact ? "py-2" : "py-3"
              )}
            >
              <div className="w-32 shrink-0">
                <div
                  className={cn(
                    "truncate text-sm",
                    dimmed && "text-muted-foreground"
                  )}
                >
                  {m.name}
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={player.getVolume(m.name)}
                  onChange={(e) =>
                    player.setVolume(m.name, Number(e.target.value))
                  }
                  onPointerUp={player.persistVolumes}
                  onKeyUp={player.persistVolumes}
                  aria-label={`${m.name} volume`}
                  className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
              </div>

              <Waveform
                peaks={m.peaks}
                duration={duration}
                position={position}
                loop={region}
                markers={markers}
                dimmed={dimmed}
                onSeek={player.seek}
                className={cn(
                  "flex-1",
                  compact ? "h-9" : "h-12",
                  dimmed && "opacity-60"
                )}
              />

              <Button
                variant={muted ? "default" : "outline"}
                size="icon-sm"
                aria-pressed={muted}
                aria-label={`Mute ${m.name}`}
                onClick={() => player.toggleMute(m.name)}
                className={cn(
                  "shrink-0 font-semibold",
                  muted && "bg-warn text-warn-foreground hover:bg-warn/90"
                )}
              >
                M
              </Button>
              <Button
                variant={soloed ? "default" : "outline"}
                size="icon-sm"
                aria-pressed={soloed}
                aria-label={`Solo ${m.name}`}
                onClick={() => player.toggleSolo(m.name)}
                className="shrink-0 font-semibold"
              >
                S
              </Button>
            </div>
          )
        })}
      </div>

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
  const { markers: abMarkers, looping, position, duration } = player

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
            abMarkers.a !== null || abMarkers.b !== null
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
        >
          A{abMarkers.a !== null ? ` ${formatMMSS(abMarkers.a)}` : ""}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={player.markB}
          disabled={player.loading}
          title="End of the loop region — at the current position"
        >
          B{abMarkers.b !== null ? ` ${formatMMSS(abMarkers.b)}` : ""}
        </Button>
        {(abMarkers.a !== null || abMarkers.b !== null) && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={player.clearMarkers}
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
