import { BackingFile, BackingSwitch, BackingVolume } from "@/components/backing/BackingRow"
import type { MetronomeState } from "@/lib/api"

/**
 * The backing track's row while a take records, where it was on the
 * rehearsal screen, under the metronome's (backing-track spec Part 5): the
 * switch, the file with how far it has got, "1:12 / 3:42", and the volume.
 * There is no ▶. The switch and the volume change what is heard; the take
 * keeps the file as it was placed. A take that records without it (the
 * switch off at Record, its output not there) has nothing to switch, and
 * its file is dimmed, as it is while its output has gone mid-take. Only for
 * a take with a file: of a song without one, or a free take, nothing is
 * said mid-take (owner's pick B, 2026-11-02), and there is no row.
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
  const song = b.free ? null : b.song
  if (song === null) return null
  return (
    <section aria-label="Backing track" className="flex h-8 min-w-0 items-center gap-1.5">
      <BackingSwitch on={b.playing && b.on} onChange={onSwitch} disabled={!b.playing} />
      <BackingFile
        name={song.name}
        seconds={song.seconds}
        position={b.playing ? b.position_sec : null}
        dim={!b.playing || !b.on || b.output_missing !== null}
      />
      <BackingVolume value={b.volume} onVolume={onVolume} className="w-24 shrink-0" />
    </section>
  )
}
