import { useState } from "react"
import {
  ChevronDown,
  Cloud,
  CloudCheck,
  Music2,
  Pencil,
  Play,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { TakePlayer } from "@/components/TakePlayer"
import { EmptyState } from "@/components/Shell"
import {
  useMultitrackPlayer,
  type MultitrackPlayer,
} from "@/hooks/useMultitrackPlayer"
import { cn } from "@/lib/utils"
import { MARKER_KINDS } from "@/lib/markers"
import { formatMMSS } from "@/lib/format"
import type { Marker, Take } from "@/lib/api"

/**
 * A list of takes where any of them can be expanded and listened to on the
 * spot. This used to be a separate screen; now listening lives where you are
 * already looking at the take — both in a rehearsal and in history.
 */
export function useTakeListPlayer() {
  const [selected, setSelected] = useState<Take | null>(null)
  const player = useMultitrackPlayer(
    selected?.tracks ?? null,
    selected?.duration_sec ?? 0
  )

  // Clicking the open take closes it again.
  const select = (take: Take | null) => {
    setSelected((prev) =>
      prev && take && prev.take_number === take.take_number ? null : take
    )
  }

  // After a rename the take's files have moved, so the player has to be
  // pointed at the fresh paths — without closing, which is what select()
  // would do for the take that is already open.
  const reselect = (take: Take | null) => setSelected(take)

  return { selected, select, reselect, player }
}

export function TakeList({
  takes,
  selected,
  onSelect,
  onRename,
  onShare,
  onDelete,
  onAddMarker,
  onEditMarker,
  onRemoveMarker,
  player,
  emptyHint,
}: {
  takes: Take[]
  selected: Take | null
  onSelect: (take: Take) => void
  onRename?: (take: Take) => void
  onShare?: (take: Take) => void
  onDelete?: (take: Take) => void
  onAddMarker?: (take: Take, seconds: number) => void
  onEditMarker?: (take: Take, marker: Marker) => void
  onRemoveMarker?: (take: Take, seconds: number) => void
  player: MultitrackPlayer
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

  return (
    <div className="flex flex-col gap-2">
      {takes.map((take) => {
        const isOpen = selected?.take_number === take.take_number
        const isShared = Boolean(take.cloud?.mix || take.cloud?.tracks)
        return (
          <div
            key={take.take_number}
            className={cn(
              "overflow-hidden rounded-xl border bg-card transition-colors",
              isOpen && "border-primary/40"
            )}
          >
            <div className="flex items-center">
              <button
                type="button"
                onClick={(e) => {
                  onSelect(take)
                  // Otherwise focus stays on the row and Space collapses the
                  // take instead of starting playback.
                  e.currentTarget.blur()
                }}
                aria-expanded={isOpen}
                className="flex flex-1 items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="tnum w-8 shrink-0 text-sm text-muted-foreground">
                  {String(take.take_number).padStart(2, "0")}
                </span>
                <span className="flex-1 truncate text-sm font-medium">
                  {take.name}
                </span>
                {take.markers && take.markers.length > 0 && (
                  <span className="flex shrink-0 items-center gap-1">
                    {/* One dot per kind present, so the row says at a glance
                        whether this take has problems or is the good one. */}
                    {MARKER_KINDS.filter((k) =>
                      take.markers?.some((m) => m.kind === k.kind)
                    ).map((k) => (
                      <span
                        key={k.kind}
                        title={k.label}
                        className={cn("size-1.5 rounded-full", k.dot)}
                      />
                    ))}
                    <span className="tnum text-xs text-muted-foreground">
                      {take.markers.length}
                    </span>
                  </span>
                )}
                <span className="tnum shrink-0 text-sm text-muted-foreground">
                  {formatMMSS(take.duration_sec)}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {isOpen ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </span>
              </button>

              {onRename && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Rename take ${take.name}`}
                  onClick={() => onRename(take)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <Pencil />
                </Button>
              )}
              {onShare && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={
                    isShared ? `Cloud copies of ${take.name}` : `Copy ${take.name} to the cloud`
                  }
                  title={
                    isShared
                      ? "In the cloud folder"
                      : "Copy this take to the cloud folder"
                  }
                  onClick={() => onShare(take)}
                  className={cn(
                    "shrink-0",
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
                  aria-label={`Delete take ${take.name}`}
                  onClick={() => onDelete(take)}
                  className="mr-3 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 />
                </Button>
              )}
            </div>

            {isOpen && (
              <div className="border-t bg-background/40 px-5 py-4">
                <TakePlayer
                  player={player}
                  compact
                  markers={take.markers ?? []}
                  onAddMarker={
                    onAddMarker ? (sec) => onAddMarker(take, sec) : undefined
                  }
                  onEditMarker={
                    onEditMarker ? (m) => onEditMarker(take, m) : undefined
                  }
                  onRemoveMarker={
                    onRemoveMarker ? (sec) => onRemoveMarker(take, sec) : undefined
                  }
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A rehearsal row in history. */
export function RehearsalRow({
  name,
  date,
  takesText,
  onClick,
  onRename,
  onDelete,
}: {
  name: string
  date: string
  takesText: string
  onClick: () => void
  onRename?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="flex items-center rounded-xl border bg-card">
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center gap-4 rounded-l-xl px-5 py-4 text-left transition-colors hover:bg-accent/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="tnum mt-0.5 text-xs text-muted-foreground">{date}</div>
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">{takesText}</span>
        <ChevronDown className="size-4 shrink-0 -rotate-90 text-muted-foreground" />
      </button>
      {onRename && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Rename rehearsal ${name}`}
          onClick={onRename}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <Pencil />
        </Button>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete rehearsal ${name}`}
          onClick={onDelete}
          className="mr-3 shrink-0 text-muted-foreground hover:text-destructive"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  )
}
