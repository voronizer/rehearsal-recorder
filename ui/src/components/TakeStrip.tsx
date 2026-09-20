import { useState } from "react"
import { Cloud, CloudCheck, Music2, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/Shell"
import { useMultitrackPlayer } from "@/hooks/useMultitrackPlayer"
import { cn } from "@/lib/utils"
import { MARKER_KINDS } from "@/lib/markers"
import { formatMMSS } from "@/lib/format"
import type { Take } from "@/lib/api"

export function useTakeStripPlayer() {
  const [selected, setSelected] = useState<Take | null>(null)
  const player = useMultitrackPlayer(
    selected?.tracks ?? null,
    selected?.duration_sec ?? 0
  )

  // Nothing is open until somebody picks a take: opening a rehearsal should
  // not start reading audio files nobody asked for. Once one is open it
  // stays open — with a strip there is nothing to gain by emptying the
  // player, and the old rows only closed because they had to make room.
  const select = (take: Take | null) => setSelected(take)

  // After a rename the take's files have moved, so the player has to be
  // pointed at the fresh paths.
  const reselect = (take: Take | null) => setSelected(take)

  return { selected, select, reselect, player }
}

/**
 * The takes of a rehearsal as one scrolling row. It does not wrap: a
 * rehearsal with thirty takes would otherwise push the player off the screen,
 * and the player is the thing you came for.
 */
export function TakeStrip({
  takes,
  selected,
  onSelect,
  onRename,
  onShare,
  onDelete,
  cloudStates,
  emptyHint,
}: {
  takes: Take[]
  selected: Take | null
  onSelect: (take: Take) => void
  onRename?: (take: Take) => void
  onShare?: (take: Take) => void
  onDelete?: (take: Take) => void
  cloudStates?: Record<number, "queued" | "working">
  emptyHint?: string
}) {
  if (takes.length === 0) {
    return (
      <EmptyState
        icon={<Music2 className="size-6" />}
        title="No takes yet"
        hint={emptyHint}
      />
    )
  }

  const isShared = Boolean(selected?.cloud?.mix || selected?.cloud?.tracks)

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs tracking-wide text-muted-foreground uppercase">
        Takes
      </span>

      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
        {takes.map((take) => {
          const open = selected?.take_number === take.take_number
          // A pending upload is something to notice at a glance, not
          // something you have to open the take to find out — the old rows
          // showed it unconditionally, and a pill collapsing that away would
          // be a silent regression, not a simplification.
          const cloudState = cloudStates?.[take.take_number]
          return (
            <button
              key={take.take_number}
              type="button"
              aria-label={`Take ${take.take_number} ${take.name}`}
              aria-current={open ? "true" : undefined}
              onClick={(e) => {
                onSelect(take)
                // Otherwise focus stays on the pill and Space picks it again
                // instead of starting playback.
                e.currentTarget.blur()
              }}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                open
                  ? "border-primary bg-primary/15"
                  : "bg-card hover:bg-accent/50"
              )}
            >
              <span className="tnum text-[11px] text-muted-foreground">
                {String(take.take_number).padStart(2, "0")}
              </span>
              <span className="max-w-40 truncate">{take.name}</span>
              {MARKER_KINDS.filter((k) =>
                take.markers?.some((m) => m.kind === k.kind)
              ).map((k) => (
                <span
                  key={k.kind}
                  title={k.label}
                  className={cn("size-1.5 shrink-0 rounded-full", k.dot)}
                />
              ))}
              <span className="tnum text-[11px] text-muted-foreground">
                {formatMMSS(take.duration_sec)}
              </span>
              {cloudState && (
                <span className="text-[11px] text-muted-foreground">
                  {cloudState === "working"
                    ? "Copying to the cloud"
                    : "Waiting for the cloud"}
                </span>
              )}
              {!cloudState && take.cloud_error && (
                <span className="text-[11px] text-destructive" title={take.cloud_error}>
                  Not in the cloud
                </span>
              )}
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="flex shrink-0 items-center gap-1">
          {onRename && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename take ${selected.name}`}
              onClick={() => onRename(selected)}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil />
            </Button>
          )}
          {onShare && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                isShared
                  ? `Cloud copies of ${selected.name}`
                  : `Copy ${selected.name} to the cloud`
              }
              title={
                isShared ? "In the cloud folder" : "Copy this take to the cloud folder"
              }
              onClick={() => onShare(selected)}
              className={cn(
                isShared
                  ? "text-signal hover:text-signal"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {isShared ? <CloudCheck /> : <Cloud />}
            </Button>
          )}
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete take ${selected.name}`}
              onClick={() => onDelete(selected)}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
