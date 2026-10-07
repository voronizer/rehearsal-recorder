import { useEffect } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Cloud,
  CloudCheck,
  Music2,
  Pencil,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/Shell"
import { cn } from "@/lib/utils"
import { formatDayIn } from "@/lib/format"
import { StarButton } from "@/components/StarButton"
import { SongTab, type TabGo } from "@/components/SongTab"
import { useKey } from "@/hooks/useSpacebar"
import { useRowEdges } from "@/hooks/useRowEdges"
import { lastPlayed, neighbour, songTabs, type SongTab as Tab } from "@/lib/songTabs"
import type { SongGo, Take } from "@/lib/api"

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

/** "Take 2 Polyn 2", ", starred" when it is, then the status if there is one.
 *  The status has to come after the "Take N name" the tests and screen
 *  readers both key off, not replace it. */
export function takeButtonLabel(take: Take, status: string | null): string {
  const base = `Take ${take.take_number} ${take.name}${take.starred ? ", starred" : ""}`
  return status ? `${base} — ${status}` : base
}

/**
 * The evening's songs as one scrolling row of tabs, a take with no song a
 * tab of its own, opening out into a column of goes under each. It does not
 * wrap: a rehearsal with thirty songs would otherwise push the player off
 * the screen, and the player is the thing you came for.
 */
export function TakeStrip({
  takes,
  selected,
  folder,
  across,
  expanded,
  onExpandedChange,
  onSelect,
  onGo,
  onRename,
  onShare,
  onDelete,
  onStar,
  cloudStates,
  emptyHint,
}: {
  takes: Take[]
  selected: Take | null
  /** The rehearsal the open go is in, when `across` brings goes from
   *  others. */
  folder?: string
  /** Every go at the open song, by time, when the player was opened from
   *  the song's page; otherwise the song's goes are this evening's. */
  across?: SongGo[]
  /** Whether the tabs are opened out into columns of their goes. */
  expanded: boolean
  onExpandedChange: (open: boolean) => void
  /** Another song, or a take with no song: opened from its start. */
  onSelect: (take: Take) => void
  /** Another go at the open song, with the rehearsal it is in when it comes
   *  from `across`. */
  onGo: (take: Take, folder?: string) => void
  onRename?: (take: Take) => void
  onShare?: (take: Take) => void
  onDelete?: (take: Take) => void
  onStar?: (take: Take, starred: boolean) => void
  cloudStates?: Record<number, "queued" | "working">
  emptyHint?: string
}) {
  const live = liveTake(takes, selected)
  const isShared = Boolean(live?.cloud?.mix || live?.cloud?.tracks)
  const tabs = songTabs(takes)
  // A go here is in this rehearsal when it carries no folder, or this one.
  const isOpenGo = (go: TabGo) =>
    live !== null &&
    go.take.take_number === live.take_number &&
    (go.folder === undefined || go.folder === folder)
  // The open song's goes from its page: this rehearsal's read as they are
  // now from `takes`, since the page's copies can be older than a star or a
  // mark made here.
  const goesOf = (tab: Tab, open: boolean): TabGo[] => {
    if (!(open && across?.length && tab.song)) return tab.takes.map((take) => ({ take }))
    const several = new Set(across.map((g) => g.folder)).size > 1
    return across.map((g) => ({
      take:
        g.folder === folder
          ? (takes.find((t) => t.take_number === g.take.take_number) ?? g.take)
          : g.take,
      folder: g.folder,
      day: several ? formatDayIn(g.created_at) : undefined,
    }))
  }

  const openTab = live && tabs.find((t) => t.takes.some((x) => x.take_number === live.take_number))
  // ↑ and ↓: the previous and next go at the open song, in the order its
  // column lists them. Nothing at either end, nor on a take with no song.
  const step = (dir: -1 | 1) => {
    if (!openTab?.song) return
    const goes = goesOf(openTab, true)
    const go = neighbour(goes, goes.findIndex(isOpenGo), dir)
    if (go) onGo(go.take, go.folder)
  }
  useKey("ArrowUp", () => step(-1), live !== null)
  useKey("ArrowDown", () => step(1), live !== null)

  const { ref: rowRef, row, page, reveal } = useRowEdges("[data-tab][aria-current='true']")

  // The strip doesn't wrap (see the note below), so on a rehearsal with many
  // songs the one just picked can land outside the visible row: this keeps
  // the vertical budget fixed without also hiding the tab. A rename can move
  // the open go to another song's tab, so that counts as a pick too. The
  // hook has to run before the empty-state return below, or the count of
  // hooks called would change between an empty and a non-empty rehearsal.
  const openKey = openTab ? openTab.key : null
  useEffect(() => {
    const tab = row?.querySelector<HTMLElement>("[data-tab][aria-current='true']")
    if (tab) reveal(tab)
  }, [row, reveal, selected?.take_number, folder, openKey])

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
    <div
      role="group"
      aria-label="Take strip"
      className={cn("flex gap-2", expanded ? "items-start" : "items-center")}
    >
      <button
        type="button"
        aria-expanded={expanded}
        title="Every song's goes"
        onClick={(e) => {
          onExpandedChange(!expanded)
          e.currentTarget.blur()
        }}
        className={cn(
          "-ml-2 flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-xs tracking-wide text-muted-foreground uppercase hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
          expanded && "mt-4"
        )}
      >
        Songs
        {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      <div className="relative flex min-w-0 flex-1">
        <div
          ref={rowRef}
          className={cn(
            "peer/row flex min-w-0 flex-1 gap-1 overflow-x-auto border-b",
            expanded ? "items-stretch" : "items-end"
          )}
        >
          {tabs.map((tab) => {
            const open = tab === openTab
            const goes = goesOf(tab, open)
            const shown = open
              ? (goes.find(isOpenGo) ?? { take: live! })
              : goes[goes.length - 1]
            return (
              <SongTab
                key={tab.key}
                tabKey={tab.key}
                song={tab.song}
                goes={goes}
                shown={shown}
                open={open}
                expanded={expanded}
                isOpenGo={isOpenGo}
                cloudStates={cloudStates}
                onPick={() => onSelect(lastPlayed(tab))}
                onRow={(go) => (open ? onGo(go.take, go.folder) : onSelect(go.take))}
                onToggle={() => onExpandedChange(!expanded)}
              />
            )
          })}
        </div>
        <Edge side="before" onPage={() => page(-1)} />
        <Edge side="after" onPage={() => page(1)} />
      </div>

      {live && (
        <div className={cn("flex shrink-0 items-center gap-1", expanded && "mt-4")}>
          {onStar && <StarButton take={live} onStar={onStar} />}
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

/** A round ‹ or › at an end of the strip that has more songs past it: a
 *  screenful that way. Shown only while the row says there is more that way
 *  (`useRowEdges`). On the line of the tabs' names, as the Songs button and
 *  the take's buttons are, so it stays put when the strip opens out. */
function Edge({ side, onPage }: { side: "before" | "after"; onPage: () => void }) {
  const name = side === "before" ? "Earlier songs" : "Later songs"
  const Icon = side === "before" ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      aria-label={name}
      title={name}
      onClick={(e) => {
        onPage()
        // Space would press it again rather than play.
        e.currentTarget.blur()
      }}
      className={cn(
        "absolute top-7.5 z-10 hidden size-7.5 place-items-center rounded-full border bg-card text-foreground shadow-md hover:bg-accent",
        side === "before"
          ? "-left-1 peer-data-[before]/row:grid"
          : "-right-1 peer-data-[after]/row:grid"
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
}
