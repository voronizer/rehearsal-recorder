import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** At or above this the track is at full scale where the playhead stands. */
const CLIP_THRESHOLD = 0.97

/**
 * One track's controls, beside its lane: the name, mute and solo, a fader,
 * and under it how loud that track is coming out.
 *
 * The level is measured in Python, in the mix, after this track's gain — so
 * it is what came out, not what is on disk, and mute and solo are already in
 * it. The interface reads it with the same poll that moves the playhead,
 * several times a second.
 *
 * This was first built from the waveform peaks instead, which cost nothing
 * and was useless: those bars cover a fraction of a second each on a long
 * take, so the meter changed about twice a second and showed the loudest
 * moment of each bar rather than the moment you were in. A meter that cannot
 * follow the music is not a meter.
 *
 * It reads zero when nothing is playing, which is what a meter at rest does.
 */
export function LaneControls({
  name,
  muted,
  soloed,
  dimmed,
  volume,
  level,
  onToggleMute,
  onToggleSolo,
  onVolume,
  onVolumeCommit,
}: {
  name: string
  muted: boolean
  soloed: boolean
  /** Muted, or another track is soloed — either way, silent. */
  dimmed: boolean
  volume: number
  /** 0..1, already through the fader and the mute. */
  level: number
  onToggleMute: () => void
  onToggleSolo: () => void
  onVolume: (value: number) => void
  onVolumeCommit: () => void
}) {
  const clipping = level >= CLIP_THRESHOLD

  return (
    <div className="flex h-full flex-col justify-center gap-4 rounded-lg border bg-card px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            dimmed && "text-muted-foreground"
          )}
        >
          {name}
        </span>
        <Button
          variant={muted ? "default" : "outline"}
          size="icon-sm"
          aria-pressed={muted}
          aria-label={`Mute ${name}`}
          onClick={onToggleMute}
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
          aria-label={`Solo ${name}`}
          onClick={onToggleSolo}
          className="shrink-0 font-semibold"
        >
          S
        </Button>
      </div>

      {/* The fader and the meter are one block — what comes out and how much
          of it — so they sit tight together and stand away from the name and
          its buttons above, rather than everything being equally spaced and
          reading as one crowded stack. */}
      <div className="flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onVolume(Number(e.target.value))}
          onPointerUp={onVolumeCommit}
          onKeyUp={onVolumeCommit}
          aria-label={`${name} volume`}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
        />

        {/* Green rather than the fader's blue: a meter must not look like
            something you can take hold of. */}
        <div
          role="meter"
          aria-label={`${name} level`}
          aria-valuenow={Math.round(level * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          data-clipping={clipping || undefined}
          className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-[width] duration-75",
              clipping ? "bg-destructive" : "bg-signal"
            )}
            style={{ width: `${Math.min(100, Math.max(0, level * 100))}%` }}
          />
        </div>
      </div>
    </div>
  )
}
