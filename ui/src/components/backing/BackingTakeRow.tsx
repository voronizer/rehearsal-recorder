import { BackingFile, BackingRowLine, BackingSwitch, BackingVolume } from "@/components/backing/BackingRow"
import type { MetronomeState } from "@/lib/api"
import { rowLine } from "@/lib/backing"

/**
 * The backing track's row while a take records, where it was on the
 * rehearsal screen, under the metronome's (backing-track spec Part 5): the
 * switch, the file with how far it has got, "1:12 / 3:42", and the volume.
 * There is no ▶. The switch and the volume change what is heard; the take
 * keeps the file as it was placed. A take that records without it (the
 * switch off at Record, its output not there) has nothing to switch, and
 * its file is dimmed.
 */
export function BackingTakeRow({
  state,
  onSwitch,
  onVolume,
}: {
  state: MetronomeState
  onSwitch: (on: boolean) => void
  onVolume: (volume: number) => void
}) {
  const b = state.backing
  // During a take the next take's name is the take's own, a song's or not.
  const line = rowLine(state, state.song?.title ?? "")
  const song = line === null ? b.song : null
  return (
    <section aria-label="Backing track" className="flex h-8 min-w-0 items-center gap-1.5">
      <BackingSwitch on={song !== null && b.playing && b.on} onChange={onSwitch} disabled={!b.playing} />
      {song === null ? (
        <BackingRowLine text={line ?? ""} />
      ) : (
        <>
          <BackingFile
            name={song.name}
            seconds={song.seconds}
            position={b.playing ? b.position_sec : null}
            dim={!b.playing || !b.on}
          />
          <BackingVolume value={b.volume} onVolume={onVolume} className="w-24 shrink-0" />
        </>
      )}
    </section>
  )
}
