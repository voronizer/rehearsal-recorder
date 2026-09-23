import { useEffect, useRef } from "react"
import { Cloud, CloudCheck, Music2, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/Shell"
import { cn } from "@/lib/utils"
import { MARKER_KINDS } from "@/lib/markers"
import { formatMMSS } from "@/lib/format"
import type { Take } from "@/lib/api"

/**
 * `selected` is the take object captured at click time, kept only so the
 * player has a stable identity to open and does not reopen on every poll.
 * Everything that can go stale after that click — a new marker, a rename, a
 * cloud share — lands on the `takes` array, not on that captured copy. This
 * is what a real backend forces on you (every call deserializes its own
 * fresh JSON), so anything that renders a field of the open take should read
 * it from here, not from `selected` directly.
 */
export function liveTake(takes: Take[], selected: Take | null): Take | null {
  if (!selected) return null
  return takes.find((t) => t.take_number === selected.take_number) ?? selected
}

/**
 * The takes of a rehearsal as one scrolling row. It does not wrap: a
 * rehearsal with thirty takes would otherwise push the player off the screen,
 * and the player is the thing you came for.
 */
/**
 * A pending upload or an error, in words — something to notice at a glance,
 * not something you have to open the take to find out. Shared by the pills
 * and the rehearsal overview's chips, which stand in for the pills while no
 * take is open.
 */
export function takeCloudStatus(
  take: Take,
  cloudState?: "queued" | "working"
): string | null {
  if (cloudState) {
    return cloudState === "working" ? "Copying to the cloud" : "Waiting for the cloud"
  }
  return take.cloud_error ? "Not in the cloud" : null
}

/** "Take 2 Polyn 2", then the status if there is one. The status has to come
 *  after the "Take N name" the tests and screen readers both key off, not
 *  replace it. */
export function takeButtonLabel(take: Take, status: string | null): string {
  const base = `Take ${take.take_number} ${take.name}`
  return status ? `${base} — ${status}` : base
}

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
  const openPillRef = useRef<HTMLButtonElement | null>(null)

  // The strip doesn't wrap (see the note below), so on a rehearsal with many
  // takes the one you just picked can land outside the visible row — this is
  // what keeps the vertical budget fixed without also hiding the take. The
  // hook has to run before the empty-state return below, or the count of
  // hooks called would change between an empty and a non-empty rehearsal.
  useEffect(() => {
    openPillRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [selected?.take_number])

  if (takes.length === 0) {
    return (
      <EmptyState
        icon={<Music2 className="size-6" />}
        title="No takes yet"
        hint={emptyHint}
      />
    )
  }

  const live = liveTake(takes, selected)
  const isShared = Boolean(live?.cloud?.mix || live?.cloud?.tracks)

  return (
    <div role="group" aria-label="Take strip" className="flex items-center gap-2">
      <span className="shrink-0 text-xs tracking-wide text-muted-foreground uppercase">
        Takes
      </span>

      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
        {takes.map((take) => {
          const open = selected?.take_number === take.take_number
          const cloudState = cloudStates?.[take.take_number]
          // The old rows showed this unconditionally, and a pill collapsing
          // it away would be a silent regression, not a simplification.
          const statusText = takeCloudStatus(take, cloudState)
          return (
            <button
              key={take.take_number}
              ref={open ? openPillRef : undefined}
              type="button"
              aria-label={takeButtonLabel(take, statusText)}
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
              {take.markers && take.markers.length > 0 && (
                <span className="flex shrink-0 items-center gap-1">
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
                    {take.markers.length}
                  </span>
                </span>
              )}
              <span className="tnum text-[11px] text-muted-foreground">
                {formatMMSS(take.duration_sec)}
              </span>
              {statusText && (
                <span
                  className={cn(
                    "text-[11px]",
                    cloudState ? "text-muted-foreground" : "text-destructive"
                  )}
                  title={cloudState ? undefined : take.cloud_error}
                >
                  {statusText}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {live && (
        <div className="flex shrink-0 items-center gap-1">
          {onRename && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Rename take ${live.name}`}
              onClick={() => onRename(live)}
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
                  ? `Cloud copies of ${live.name}`
                  : `Copy ${live.name} to the cloud`
              }
              title={
                isShared ? "In the cloud folder" : "Copy this take to the cloud folder"
              }
              onClick={() => onShare(live)}
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
              aria-label={`Delete take ${live.name}`}
              onClick={() => onDelete(live)}
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
