import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** At or above this the track is at full scale where the playhead stands. */
const CLIP_THRESHOLD = 0.97

/**
 * One track's controls, beside its lane: the name, mute and solo, a fader,
 * and how loud the track is where the playhead is standing.
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
    <div className="flex h-full items-stretch gap-3 rounded-lg border bg-card px-3.5 py-3">
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5">
        <span
          className={cn("truncate text-sm", dimmed && "text-muted-foreground")}
        >
          {name}
        </span>
        <div className="flex items-center gap-2">
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
      </div>

      {/* Native vertical rendering rather than a rotated horizontal one: a
          rotation moves the hit area away from the picture and the drag ends
          up going the wrong way under a trackpad. `writing-mode` is how this
          is done now; the WebKit property behind it is for the older engine
          this app still meets on macOS. */}
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
        className="w-4 shrink-0 cursor-pointer accent-primary"
        style={{
          writingMode: "vertical-lr",
          direction: "rtl",
          WebkitAppearance: "slider-vertical",
          height: "100%",
        }}
      />

      <div
        role="meter"
        aria-label={`${name} level`}
        aria-valuenow={Math.round(level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        data-clipping={clipping || undefined}
        className="relative w-1.5 shrink-0 overflow-hidden rounded-full bg-muted"
      >
        {/* Green rather than the fader's blue, and no grip: two blue bars
            side by side read as two faders, and a meter must not look like
            something you can take hold of. Green already means "this is
            fine" everywhere else in here. */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 rounded-full transition-[height] duration-75",
            clipping ? "bg-destructive" : "bg-signal"
          )}
          style={{ height: `${Math.min(100, Math.max(0, level * 100))}%` }}
        />
      </div>
    </div>
  )
}
