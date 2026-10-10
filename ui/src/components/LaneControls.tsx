import { Volume1, Volume2, VolumeX } from "lucide-react"
import { InstrumentIcon } from "@/components/InstrumentIcon"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** At or above this the track is at full scale where the playhead stands. */
const CLIP_THRESHOLD = 0.97

/**
 * A fader over its own meter. One control instead of two bars: the thumb
 * reads as the ceiling you set, the green as how close the sound is getting
 * to it, and the gap between them as the headroom left. Two separate bars
 * could not say that; side by side they only invited being mistaken for each
 * other.
 *
 * The slider stays a native range input, so it keeps its keyboard
 * behaviour; only its track is made transparent so the meter shows through,
 * which means the thumb has to be drawn here rather than left to the engine.
 *
 * A stereo track's meter is in two along its length, left above right, the
 * way the setup screen's check draws it: one bar for the louder side would
 * hide a side that went quiet.
 */
function MeteredFader({
  name,
  volume,
  levels,
  channels = 1,
  onVolume,
  onVolumeCommit,
}: {
  /** What the fader and the meter are called: "Guitar volume", "Guitar level". */
  name: string
  volume: number
  /** One per channel, 0..1. */
  levels: number[]
  /** How many bars to draw, whatever is playing: two for a stereo file,
   *  even while nothing plays and no level has come. */
  channels?: number
  onVolume: (value: number) => void
  onVolumeCommit: () => void
}) {
  const sides = Array.from({ length: channels > 1 ? 2 : 1 }, (_, i) => levels[i] ?? 0)
  const level = Math.max(0, ...sides)
  const clipping = level >= CLIP_THRESHOLD
  const split = sides.length > 1

  return (
    <div className="relative h-4 w-full">
      <div
        role="meter"
        aria-label={`${name} level`}
        aria-valuenow={Math.round(level * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        data-clipping={clipping || undefined}
        className={cn(
          "absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-muted",
          split ? "h-2" : "h-1.5"
        )}
      >
        {sides.map((side, i) => (
          <div
            key={i}
            data-fill
            className={cn(
              "absolute left-0 transition-[width] duration-75",
              !split && "rounded-full",
              side >= CLIP_THRESHOLD ? "bg-destructive" : "bg-signal"
            )}
            style={{
              width: `${Math.min(100, Math.max(0, side * 100))}%`,
              top: split && i === 1 ? "calc(50% + 0.5px)" : 0,
              bottom: split && i === 0 ? "calc(50% + 0.5px)" : 0,
            }}
          />
        ))}
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
        aria-valuetext={`${Math.round(volume * 100)}%`}
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
  )
}

/**
 * One track's controls, beside its lane: its icon and name, whether it is one
 * channel or two, mute and solo, a fader, and under it how loud that track is
 * coming out.
 *
 * Mono or stereo is read from the file, not from how the band is set up
 * today: a take recorded before the keyboard went stereo is still one
 * channel.
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
 *
 * A track that records its notes too is one card of two halves: these
 * controls above, and its notes' plate (midi/NotesPlate) below, under a
 * dashed line.
 */
export function LaneControls({
  name,
  icon,
  paired = false,
  channels,
  muted,
  soloed,
  dimmed,
  volume,
  levels,
  onToggleMute,
  onToggleSolo,
  onVolume,
  onVolumeCommit,
}: {
  name: string
  /** The band's icon for this name; none draws the neutral one. */
  icon?: string
  /** The upper half of the track's card: its notes' plate is under it. */
  paired?: boolean
  /** In the file: 1, 2, or 0 when it could not be read. */
  channels: number
  muted: boolean
  soloed: boolean
  /** Muted, or another track is soloed — either way, silent. */
  dimmed: boolean
  volume: number
  /** One per channel, 0..1, already through the fader and the mute. */
  levels: number[]
  onToggleMute: () => void
  onToggleSolo: () => void
  onVolume: (value: number) => void
  onVolumeCommit: () => void
}) {
  return (
    <div
      data-plate={name}
      className={cn(
        "flex h-full flex-col justify-center gap-2.5 rounded-lg border bg-card px-3.5 py-2",
        paired && "rounded-b-none border-b-0"
      )}
    >
      <div className="flex items-center gap-2.5">
        <InstrumentIcon icon={icon} className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-sm", dimmed && "text-muted-foreground")}>
            {name}
          </span>
          {channels > 0 && (
            <span className="text-[11px] leading-3.5 text-muted-foreground">
              {channels > 1 ? "Stereo" : "Mono"}
            </span>
          )}
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

      {/* A track's level cannot overtake its thumb: what comes out is the
          source's peak times the fader, and a peak cannot exceed full
          scale. */}
      <MeteredFader
        name={name}
        volume={volume}
        levels={levels}
        channels={channels}
        onVolume={onVolume}
        onVolumeCommit={onVolumeCommit}
      />
    </div>
  )
}

/** A speaker that says roughly how loud: off, low, high. */
export function VolumeIcon({ volume, className }: { volume: number; className?: string }) {
  if (volume === 0) return <VolumeX className={className} aria-hidden />
  if (volume < 0.5) return <Volume1 className={className} aria-hidden />
  return <Volume2 className={className} aria-hidden />
}

/**
 * The whole mix, under the tracks, the way a desk ends in its master strip:
 * how loud the take plays, and how loud all of it is coming out.
 *
 * For listening only. The faders above are the band's balance, and the copy
 * sent to the cloud is mixed from them; turning all of them down to make the
 * room quieter lost that balance and changed the cloud copy. This changes
 * neither, and the next take opens at it.
 *
 * Unlike a track's, this level can pass the thumb and turn red: tracks that
 * are each short of full scale can add up past it, and that is clipped on
 * the way out.
 */
export function MasterControls({
  volume,
  level,
  onVolume,
  onVolumeCommit,
  className,
}: {
  volume: number
  /** 0..1, the whole mix after this fader, as it goes out. */
  level: number
  onVolume: (value: number) => void
  onVolumeCommit: () => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col justify-center gap-3 rounded-lg border bg-card px-3.5 py-2.5",
        className
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <VolumeIcon volume={volume} className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">Master</span>
        <span className="tnum text-xs text-muted-foreground">
          {Math.round(volume * 100)}%
        </span>
      </div>
      <MeteredFader
        name="Master"
        volume={volume}
        levels={[level]}
        onVolume={onVolume}
        onVolumeCommit={onVolumeCommit}
      />
    </div>
  )
}
