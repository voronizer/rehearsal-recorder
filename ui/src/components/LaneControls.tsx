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

      {/* One control instead of two bars. The level cannot overtake the
          thumb — what comes out is the source's peak times the fader, and a
          peak cannot exceed full scale — so the thumb reads as the ceiling
          you set, the green as how close the track is getting to it, and the
          gap between them as the headroom left. Two separate bars could not
          say that; side by side they only invited being mistaken for each
          other.

          The slider stays a native range input, so it keeps its keyboard
          behaviour; only its track is made transparent so the meter shows
          through, which means the thumb has to be drawn here rather than
          left to the engine. */}
      <div className="relative h-4 w-full">
        <div
          role="meter"
          aria-label={`${name} level`}
          aria-valuenow={Math.round(level * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          data-clipping={clipping || undefined}
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full transition-[width] duration-75",
              clipping ? "bg-destructive" : "bg-signal"
            )}
            style={{ width: `${Math.min(100, Math.max(0, level * 100))}%` }}
          />
        </div>

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
          className={cn(
            "absolute inset-0 w-full cursor-pointer appearance-none bg-transparent",
            "focus-visible:outline-none",
            "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary",
            "[&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-card",
            "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:border-0",
            "[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary"
          )}
        />
      </div>
    </div>
  )
}
