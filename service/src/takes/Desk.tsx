import { LaneControls } from "@/components/LaneControls"
import type { MultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import type { TakePage } from "../api"

/** On a phone: a row per track as РЭХА's desk draws it, its name, its level, M and S; no wave. */
export function Desk({ take, player }: { take: TakePage; player: MultitrackPlayer }) {
  return (
    <div data-desk className="flex flex-col gap-1">
      {take.tracks.map((t) => {
        const muted = player.isMuted(t.name)
        const soloed = player.isSoloed(t.name)
        return (
          <div key={t.position} data-desk-row={t.name} className="h-14 rounded-lg bg-card">
            <LaneControls
              name={t.name}
              icon={t.icon ?? undefined}
              channels={1}
              muted={muted}
              soloed={soloed}
              dimmed={muted || (player.hasSolo && !soloed)}
              volume={player.getVolume(t.name)}
              levels={player.getLevels(t.name)}
              onToggleMute={() => player.toggleMute(t.name)}
              onToggleSolo={() => player.toggleSolo(t.name)}
              onVolume={(v) => player.setVolume(t.name, v)}
              onVolumeCommit={player.persistVolumes}
            />
          </div>
        )
      })}
    </div>
  )
}
