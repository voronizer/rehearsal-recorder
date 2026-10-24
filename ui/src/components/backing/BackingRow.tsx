import { useEffect, useRef, useState } from "react"
import { Play, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Whole } from "@/components/ui/whole"
import type { MetronomeState } from "@/lib/api"
import { rowLine } from "@/lib/backing"
import { formatMMSS } from "@/lib/format"
import { instrument } from "@/lib/instruments"
import { cn } from "@/lib/utils"

const BackingGlyph = instrument("backing").Glyph

/** How long the volume waits after a key press before it is sent, in ms,
 *  as the click's: the arrows step it, and it is sent where they stop. */
const VOLUME_SETTLE_MS = 400

/**
 * The backing track's switch, at the start of its row: whether Record plays
 * it, and during a take whether it is still heard. Its icon as a toggle,
 * grey when on as every switch is (F2), as the metronome's switch has it.
 */
export function BackingSwitch({
  on,
  onChange,
  disabled = false,
}: {
  on: boolean
  onChange: (on: boolean) => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <Toggle
        asChild
        size="icon-row"
        aria-label="Backing track in takes"
        pressed={on}
        onPressedChange={onChange}
        disabled={disabled}
        className="not-data-[state=on]:text-muted-foreground"
      >
        <TooltipTrigger>
          <BackingGlyph />
        </TooltipTrigger>
      </Toggle>
      <TooltipContent>
        <span aria-hidden>Backing track in takes</span>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * How loud the backing track is heard, one level for every song: the shared
 * slider, sent when it is let go, once the keys stop when it is stepped with
 * them. The take records the file whatever the level. A level still waiting
 * when the slider goes is sent then.
 */
export function BackingVolume({
  value,
  onVolume,
  disabled = false,
  percent = false,
  className,
}: {
  value: number
  onVolume: (volume: number) => void
  disabled?: boolean
  /** The level in figures after it, as Settings has it. */
  percent?: boolean
  className?: string
}) {
  const [sliding, setSliding] = useState<number | null>(null)
  const byKeys = useRef(false)
  const settle = useRef(0)
  const pending = useRef<number | null>(null)
  const send = useRef(onVolume)
  useEffect(() => {
    send.current = onVolume
  })
  useEffect(
    () => () => {
      window.clearTimeout(settle.current)
      if (pending.current !== null) send.current(pending.current)
    },
    []
  )
  const shown = sliding ?? value
  const commit = (volume: number) => {
    window.clearTimeout(settle.current)
    pending.current = volume
    const done = () => {
      pending.current = null
      setSliding(null)
      send.current(volume)
    }
    if (byKeys.current) settle.current = window.setTimeout(done, VOLUME_SETTLE_MS)
    else done()
  }
  const slider = (
    <Slider
      aria-label="Backing track volume"
      aria-valuetext={`${Math.round(shown * 100)}%`}
      min={0}
      max={1}
      step={0.01}
      value={[shown]}
      disabled={disabled}
      onPointerDown={() => (byKeys.current = false)}
      onKeyDown={() => (byKeys.current = true)}
      onValueChange={([v]) => setSliding(v)}
      onValueCommit={([v]) => commit(v)}
      className={percent ? "min-w-0 flex-1" : className}
    />
  )
  if (!percent) return slider
  return (
    <div className={cn("flex items-center gap-4", className)}>
      {slider}
      <span className="tnum w-10 shrink-0 text-right text-sm text-muted-foreground">
        {Math.round(shown * 100)}%
      </span>
    </div>
  )
}

/**
 * The file's name, cut to the room there is and whole in the shared tip,
 * and its length; while it is heard, how far it has got: "0:12 / 3:42",
 * which stops at its length while a take plays on past its end. The time
 * keeps its own width, so the name gives way as it grows and nothing after
 * it moves. Dimmed while the switch is off.
 */
export function BackingFile({
  name,
  seconds,
  position,
  dim,
}: {
  name: string
  /** Its length; null when its copy is missing. */
  seconds: number | null
  /** Where it is heard now, or null while it is still. */
  position: number | null
  dim: boolean
}) {
  return (
    <span
      data-backing-row-file
      className={cn("flex min-w-0 flex-1 items-baseline gap-1.5 text-sm", dim && "text-muted-foreground")}
    >
      <Whole data-backing-name text={name} className="min-w-0 truncate" />
      {seconds !== null && (
        <span data-backing-time className="tnum shrink-0 text-muted-foreground">
          {position !== null
            ? `${formatMMSS(Math.min(position, seconds))} / ${formatMMSS(seconds)}`
            : formatMMSS(seconds)}
        </span>
      )}
    </span>
  )
}

/** What the row says in place of a file: for a free take, and for a song
 *  with none, where it is added. In the status line's size, on two lines
 *  where one is short of room, both within the row's 32 px. */
export function BackingRowLine({ text }: { text: string }) {
  return (
    <Whole
      data-backing-row-line
      text={text}
      className="line-clamp-2 min-w-0 flex-1 text-xs leading-4 text-muted-foreground"
    />
  )
}

/**
 * The backing track's row on the rehearsal screen, under the metronome's
 * (backing-track spec Part 5, the Q5 mockup's A): the switch, the next
 * take's song's file and its length, the volume and ▶, which plays the file
 * from its start, alone, to hear it and set the level. A song with none and
 * a free take say so in the file's place, with nothing to switch. There is
 * no gear: its output is behind the metronome's (B7). It calls nothing
 * itself, so a still picture of it needs only its props.
 *
 * `name` is the next take's name as typed, for a title no song has yet.
 */
export function BackingRow({
  state,
  name,
  onSwitch,
  onVolume,
  onPlay,
}: {
  state: MetronomeState
  name: string
  onSwitch: (on: boolean) => void
  onVolume: (volume: number) => void
  /** ▶ or ■, by whether it plays. */
  onPlay: () => void
}) {
  const b = state.backing
  const line = rowLine(state, name)
  const song = line === null ? b.song : null
  const playing = song !== null && b.playing
  const label = playing ? "Stop the backing track" : "Play the backing track"
  return (
    <section aria-label="Backing track" className="flex h-8 min-w-0 items-center gap-1.5">
      <BackingSwitch on={song !== null && b.on} onChange={onSwitch} disabled={song === null} />
      {song === null ? (
        <BackingRowLine text={line ?? ""} />
      ) : (
        <>
          <BackingFile
            name={song.name}
            seconds={song.seconds}
            position={playing ? b.position_sec : null}
            dim={!b.on}
          />
          <BackingVolume value={b.volume} onVolume={onVolume} className="w-24 shrink-0" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon-row"
                aria-label={label}
                disabled={song.missing}
                onClick={onPlay}
                className="shrink-0"
              >
                {playing ? <Square className="fill-current" /> : <Play className="fill-current" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <span aria-hidden>{playing ? label : "Play the backing track, to hear it and set its level"}</span>
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </section>
  )
}
