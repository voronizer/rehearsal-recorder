import { useEffect, useRef, useState } from "react"
import { FolderOpen, Library, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Shell, EmptyState } from "@/components/Shell"
import { RehearsalList } from "@/components/RehearsalList"
import { TakeStrip, liveTake } from "@/components/TakeStrip"
import { RehearsalOverview } from "@/components/RehearsalOverview"
import { RunningLine } from "@/components/RunningLine"
import { TakePlayer } from "@/components/TakePlayer"
import { ConfirmDialog, PromptDialog, RenameTakeDialog } from "@/components/ConfirmDialog"
import { ShareDialog } from "@/components/ShareDialog"
import { MarkerDialog } from "@/components/MarkerDialog"
import { useSongChoices } from "@/hooks/useSongChoices"
import { useTakeStripPlayer } from "@/hooks/useTakeStripPlayer"
import { useEscape, useKey, usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  type Marker,
  type RehearsalDetail,
  type RehearsalSummary,
  type Take,
} from "@/lib/api"
import {
  croppedButNotSwept,
  formatBytes,
  formatDateHuman,
  formatDay,
  formatDuration,
  formatWhen,
  takesLabel,
} from "@/lib/format"
import {
  canBePutBack,
  goPlural,
  goesTo,
  rehearsalCloudToo,
  takeCloudToo,
} from "@/lib/deletion"
import { useCloudSettled, useRunning, watching } from "@/lib/activity"
import { dismiss, notify } from "@/lib/notices"

/** "9 takes, 1.2 GB" — what deleting a rehearsal takes away and gives back. */
function takesAndSize(r: RehearsalSummary | null): string {
  if (!r) return takesLabel(0)
  return `${takesLabel(r.take_count)}, ${formatBytes(r.disk_bytes)}`
}

/** "5 rehearsals · 2 h 24 min played · 5.0 GB", over the whole list. */
function allOf(rehearsals: RehearsalSummary[]): string {
  const seconds = rehearsals.reduce((sum, r) => sum + r.total_duration_sec, 0)
  const bytes = rehearsals.reduce((sum, r) => sum + r.disk_bytes, 0)
  const parts = [
    rehearsals.length === 1 ? "1 rehearsal" : `${rehearsals.length} rehearsals`,
  ]
  if (seconds >= 30) parts.push(`${formatDuration(seconds / 60)} played`)
  parts.push(formatBytes(bytes))
  return parts.join(" · ")
}

// What an action here said — one slot, so each says over the last.
const SAID = "history"

/**
 * History: past rehearsals and their takes. Read from disk, so it survives a
 * restart of the app.
 *
 * The list and the rehearsal chosen in it are on screen together: the list
 * down the left, the chosen one's overview beside it, with ↑ and ↓ to go
 * through them. It used to be a list that opened a rehearsal in its place,
 * so looking for the evening that had the good Vesna meant opening them one
 * after another. A take opened from the overview has the whole window, as
 * the player needs it, and Escape brings the list back.
 *
 * `initialFolder` is the rehearsal to show first, when the setup screen sent
 * somebody here for one; otherwise it is the newest.
 */
export function HistoryScreen({
  onBack,
  initialFolder,
}: {
  onBack: () => void
  initialFolder?: string
}) {
  const [rehearsals, setRehearsals] = useState<RehearsalSummary[] | null>(null)
  const [current, setCurrent] = useState<string | null>(initialFolder ?? null)
  const [opened, setOpened] = useState<RehearsalDetail | null>(null)
  // Something slow enough to click twice by mistake is running. So far that
  // is only a crop, which rewrites every track of the take.
  const [busy, setBusy] = useState(false)
  const [takeToDelete, setTakeToDelete] = useState<Take | null>(null)
  const [takeToRename, setTakeToRename] = useState<Take | null>(null)
  const renameChoices = useSongChoices(
    takeToRename !== null,
    opened?.folder,
    takeToRename?.take_number
  )
  const [takeToShare, setTakeToShare] = useState<Take | null>(null)
  const [markerEdit, setMarkerEdit] = useState<{
    take: Take
    marker: Marker
  } | null>(null)
  const [rehearsalToDelete, setRehearsalToDelete] =
    useState<RehearsalSummary | null>(null)
  const [rehearsalToRename, setRehearsalToRename] =
    useState<RehearsalSummary | null>(null)
  const [rehearsalToForget, setRehearsalToForget] =
    useState<RehearsalSummary | null>(null)
  const {
    selected,
    cued,
    select,
    close,
    uncue,
    reselect,
    forget,
    openAt,
    playInOverview,
    player,
  } = useTakeStripPlayer()
  const cropping = useRunning(
    "crop",
    (e) => e.folder === opened?.folder && e.take_number === selected?.take_number
  )

  /**
   * Reads the list again, and keeps the chosen rehearsal chosen — or `want`,
   * after a rename moved it or a delete took it away. One no longer there
   * gives way to the newest.
   */
  const refresh = async (want?: string | null) => {
    const list = await api().list_rehearsals()
    setRehearsals(list)
    setCurrent((c) => {
      const pick = want !== undefined ? want : c
      return pick && list.some((r) => r.folder === pick) ? pick : (list[0]?.folder ?? null)
    })
    return list
  }

  useEffect(() => {
    void refresh()
  }, [])

  const summary = rehearsals?.find((r) => r.folder === current) ?? null
  // Whether the chosen one can be read: not until the list says it is there.
  const readable = summary !== null && !summary.missing

  // The chosen rehearsal, read in full. An answer that comes back after
  // another was chosen — ↓ held down the list — is dropped. One that cannot
  // be read is not asked for; what is on screen goes by `current`, so an
  // answer about another rehearsal is never shown under this one's name.
  const asked = useRef(0)
  useEffect(() => {
    const ticket = ++asked.current
    if (!current || !readable) return
    void (async () => {
      const res = await api().get_rehearsal(current)
      if (ticket !== asked.current) return
      if (!res.ok) {
        setOpened(null)
        notify({ key: SAID, kind: "error", text: res.error ?? "Could not open the rehearsal" })
        return
      }
      dismiss(SAID)
      setOpened(res)
    })()
  }, [current, readable])

  // Read again after a change to it, unless another has been chosen since.
  const currentRef = useRef(current)
  useEffect(() => {
    currentRef.current = current
  }, [current])
  const reopen = async (folder: string) => {
    const fresh = await api().get_rehearsal(folder)
    if (fresh.ok && folder === currentRef.current) setOpened(fresh)
  }

  // The chosen one in the list stays in view as ↑ and ↓ go past the edge.
  useEffect(() => {
    if (!current) return
    const item = document.querySelector(`[data-rehearsal="${CSS.escape(current)}"]`)
    item?.scrollIntoView({ block: "nearest" })
  }, [current])

  /** Another rehearsal, from the list. What was playing stops: it belongs
   *  to the one being left. */
  const choose = (folder: string) => {
    if (folder === current) return
    close()
    setOpened(null)
    setCurrent(folder)
  }

  const step = (delta: number) => {
    if (!rehearsals?.length) return
    const at = rehearsals.findIndex((r) => r.folder === current)
    const next = rehearsals[Math.min(rehearsals.length - 1, Math.max(0, at + delta))]
    if (next) choose(next.folder)
  }
  useKey("ArrowUp", () => step(-1), selected === null)
  useKey("ArrowDown", () => step(1), selected === null)

  // A copy to the cloud started here runs in the background now; when one of
  // this rehearsal's finishes, its take says so without anyone reopening it.
  useCloudSettled((e) => {
    if (opened && e.folder === opened.folder) void reopen(opened.folder)
  })

  // A take playing in the overview has the keys as much as an open one.
  const inHand = selected !== null || cued !== null
  useSpacebar(player.toggle, inHand)
  usePlayerKeys(player.skip, inHand)

  const back = () => {
    if (selected) {
      select(null)
      return
    }
    player.pause()
    onBack()
  }
  // Escape peels one layer at a time: the open take first, then a take
  // playing in the overview, then history itself — the same ladder the back
  // button climbs, one rung per press.
  useEscape(() => (selected ? select(null) : cued ? uncue() : back()))

  const deleteTake = async (take: Take) => {
    if (!opened) return
    dismiss(SAID)
    player.pause()
    const res = await api().delete_take(opened.folder, take.take_number)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not delete the take" })
      return
    }
    forget(take.take_number)
    await reopen(opened.folder)
    void refresh()
  }

  const renameTake = async (take: Take, name: string) => {
    if (!opened) return
    dismiss(SAID)
    const res = await api().rename_take(opened.folder, take.take_number, name)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not rename the take" })
      return
    }
    // The take folder moved with the name, so point the player at the fresh
    // paths. That is a new `tracks` identity, so the open effect underneath
    // tears down and reopens from zero — the take stays selected and on
    // screen, but playback and the A–B region do not survive this.
    if (res.take) reselect(res.take)
    await reopen(opened.folder)
    void refresh()
  }

  // Python let go of the files before rewriting them, so the take has to be
  // opened again; the fresh `tracks` array is what tells the player that.
  // Rewriting eight long tracks takes real seconds, so the screen is busy
  // while it runs: a second Crop would cut the take the first one made.
  const cropTake = async (take: Take, from: number, to: number) => {
    if (!opened || busy) return
    setBusy(true)
    dismiss(SAID)
    player.pause()
    const res = await watching(api().crop_take(opened.folder, take.take_number, from, to))
    setBusy(false)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not crop the take" })
      return
    }
    if (res.take) reselect(res.take)
    await reopen(opened.folder)
    void refresh()
    // The crop itself went through — only the sweep of the original is what
    // failed — so this adds to the success path rather than standing in for it.
    if (res.error) {
      notify({
        key: SAID,
        kind: "warning",
        text: croppedButNotSwept(res.error, res.location),
      })
    }
  }

  // Renaming moves the folder, so the chosen one follows it to its new path,
  // and is read again from there.
  const renameRehearsal = async (folder: string, name: string) => {
    dismiss(SAID)
    const res = await api().rename_rehearsal(folder, name)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not rename the rehearsal" })
      return
    }
    const held = selected ?? cued
    if (held && res.takes) {
      const fresh = res.takes.find((t) => t.take_number === held.take_number)
      if (fresh) reselect(fresh)
    }
    await refresh(folder === current ? (res.folder ?? folder) : undefined)
  }

  // The one after it takes its place on the right, or the one before when it
  // was the last.
  const neighbourOf = (folder: string): string | null => {
    const list = rehearsals ?? []
    const at = list.findIndex((r) => r.folder === folder)
    const rest = list.filter((r) => r.folder !== folder)
    return rest[Math.min(Math.max(at, 0), rest.length - 1)]?.folder ?? null
  }

  const deleteRehearsal = async (r: RehearsalSummary) => {
    dismiss(SAID)
    player.pause()
    const next = neighbourOf(r.folder)
    const res = await api().delete_rehearsal(r.folder)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not delete the rehearsal" })
      return
    }
    if (r.folder === current) close()
    await refresh(r.folder === current ? next : undefined)
  }

  // For a rehearsal whose folder went missing: point it at where the folder
  // is now, or, if it was really deleted, drop it from history and leave
  // whatever is on disk — there is nothing here to delete.
  const locateRehearsal = async (r: RehearsalSummary) => {
    dismiss(SAID)
    const res = await api().choose_rehearsal_folder(r.folder)
    if (res.cancelled) return
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not locate the rehearsal's folder" })
      return
    }
    await refresh(res.folder ?? r.folder)
  }

  const forgetRehearsal = async (r: RehearsalSummary) => {
    dismiss(SAID)
    const next = neighbourOf(r.folder)
    const res = await api().forget_rehearsal(r.folder)
    if (!res.ok) {
      notify({ key: SAID, kind: "error", text: res.error ?? "Could not remove the rehearsal from history" })
      return
    }
    await refresh(r.folder === current ? next : undefined)
  }

  // Dropping a marker opens its note straight away: the thought about what
  // just went wrong lasts about five seconds. Playback carries on.
  const addMarker = async (take: Take, seconds: number) => {
    if (!opened) return
    const res = await api().add_take_marker(opened.folder, take.take_number, seconds)
    await reopen(opened.folder)
    const fresh = res.markers?.find((m) => Math.abs(m.at - seconds) < 0.02)
    setMarkerEdit(fresh ? { take, marker: fresh } : null)
  }

  const saveMarker = async (
    take: Take,
    at: number,
    note: string,
    labelId: number
  ) => {
    if (!opened) return
    await api().update_take_marker(opened.folder, take.take_number, at, note, labelId)
    await reopen(opened.folder)
    void refresh()
  }

  const starTake = async (take: Take, starred: boolean) => {
    if (!opened) return
    await api().set_take_star(opened.folder, take.take_number, starred)
    await reopen(opened.folder)
    void refresh()
  }

  const removeMarker = async (take: Take, seconds: number) => {
    if (!opened) return
    await api().remove_take_marker(opened.folder, take.take_number, seconds)
    await reopen(opened.folder)
    void refresh()
  }

  const takeDialogs = opened && (
    <>
      <ConfirmDialog
        open={takeToDelete !== null}
        onOpenChange={(open) => !open && setTakeToDelete(null)}
        title={`Delete “${takeToDelete?.name ?? ""}”?`}
        description={`The take and all its tracks ${goPlural()}.${takeCloudToo(
          takeToDelete
        )} ${canBePutBack()}`}
        onConfirm={() => {
          if (takeToDelete) void deleteTake(takeToDelete)
          setTakeToDelete(null)
        }}
      />

      <RenameTakeDialog
        take={takeToRename}
        choices={renameChoices}
        onOpenChange={(open) => !open && setTakeToRename(null)}
        onSubmit={(name) => {
          if (takeToRename) void renameTake(takeToRename, name)
        }}
      />

      <MarkerDialog
        marker={markerEdit?.marker ?? null}
        onOpenChange={(open) => !open && setMarkerEdit(null)}
        onSave={(at, note, labelId) => {
          if (markerEdit) void saveMarker(markerEdit.take, at, note, labelId)
        }}
        onDelete={(at) => {
          if (markerEdit) void removeMarker(markerEdit.take, at)
        }}
      />

      <ShareDialog
        take={takeToShare}
        folder={opened.folder}
        onOpenChange={(open) => !open && setTakeToShare(null)}
        onDone={() => void reopen(opened.folder)}
      />
    </>
  )

  // A take open in the player: the whole window, the way it always had it.
  if (opened && selected) {
    return (
      <Shell
        playback
        subtitle={formatDateHuman(opened.created_at)}
        title={opened.name}
        onBack={back}
      >
        <div className="flex w-full flex-col gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate font-mono">{opened.folder}</span>
          </div>
          <TakeStrip
            takes={opened.takes}
            selected={selected}
            onSelect={select}
            onRename={setTakeToRename}
            onShare={setTakeToShare}
            onDelete={setTakeToDelete}
            onStar={starTake}
            emptyHint="Nothing was kept from this rehearsal, or every take since got deleted."
          />
          <TakePlayer
            player={player}
            markers={liveTake(opened.takes, selected)?.markers ?? []}
            onAddMarker={(sec) => addMarker(selected, sec)}
            onEditMarker={(marker) => setMarkerEdit({ take: selected, marker })}
            onRemoveMarker={(sec) => removeMarker(selected, sec)}
            onCrop={(from, to) => void cropTake(selected, from, to)}
            spaceKey
            canCrop={!busy}
            status={<RunningLine entry={cropping} label="Cropping" />}
          />
        </div>
        {takeDialogs}
      </Shell>
    )
  }

  const empty = rehearsals?.length === 0

  return (
    <Shell
      playback
      title="Rehearsal history"
      onBack={back}
      backKey
      headerAction={
        rehearsals && rehearsals.length > 0 ? (
          <span className="hidden text-xs text-muted-foreground lg:block">
            {allOf(rehearsals)}
          </span>
        ) : undefined
      }
      className={empty || rehearsals === null ? undefined : "flex overflow-hidden p-0"}
    >
      {rehearsals === null && (
        <p className="text-sm text-muted-foreground">Reading the folder…</p>
      )}

      {empty && (
        <div className="mx-auto max-w-3xl">
          <EmptyState
            icon={<Library className="size-6" />}
            title="No past rehearsals yet"
            hint="Every rehearsal where you saved at least one take shows up here."
          />
        </div>
      )}

      {rehearsals && rehearsals.length > 0 && (
        <>
          <nav
            aria-label="Rehearsals"
            className="flex w-64 shrink-0 flex-col gap-3 overflow-y-auto border-r px-3 py-4 xl:w-80"
          >
            <RehearsalList rehearsals={rehearsals} current={current} onChoose={choose} />
            <p className="mt-auto flex items-center gap-1.5 px-3 pt-2 text-xs text-muted-foreground">
              <kbd className="rounded border border-current/30 px-1 font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border border-current/30 px-1 font-mono text-[10px]">↓</kbd>
              to go through them
            </p>
          </nav>

          <section
            aria-label={summary?.name ?? "Rehearsal"}
            className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5"
          >
            {summary && (
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1">
                    <h2 className="truncate text-xl leading-tight font-semibold">
                      {summary.name}
                    </h2>
                    {!summary.missing && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Rename rehearsal ${summary.name}`}
                        onClick={() => setRehearsalToRename(summary)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil />
                      </Button>
                    )}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="shrink-0">
                      {formatDay(summary.created_at).split(" ")[0]}{" "}
                      {formatDateHuman(summary.created_at)}
                    </span>
                    <span aria-hidden>·</span>
                    <FolderOpen className="size-3.5 shrink-0" />
                    <span className="truncate font-mono">{summary.folder}</span>
                  </div>
                </div>
                {!summary.missing && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete rehearsal ${summary.name}`}
                    onClick={() => setRehearsalToDelete(summary)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            )}

            {summary?.missing && (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed px-5 py-4">
                <p className="text-sm">
                  <span className="font-medium">Not found on disk.</span>{" "}
                  <span className="text-muted-foreground">
                    Its folder was deleted, renamed outside the app, or is on a
                    drive that is not plugged in. Recorded {formatWhen(summary.created_at)}.
                  </span>
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => void locateRehearsal(summary)}>
                    Locate folder…
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRehearsalToForget(summary)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Remove from history
                  </Button>
                </div>
              </div>
            )}

            {readable && opened?.folder === current && (
              opened.takes.length > 0 ? (
                <RehearsalOverview
                  takes={opened.takes}
                  songs={opened.songs ?? []}
                  playback={
                    cued && {
                      take: cued.take_number,
                      playing: player.playing,
                      loading: player.loading,
                      position: player.position,
                      duration: player.duration,
                    }
                  }
                  onPlay={playInOverview}
                  onOpen={select}
                  onOpenAt={openAt}
                  onRename={setTakeToRename}
                  onStar={starTake}
                  onShare={setTakeToShare}
                  onDelete={setTakeToDelete}
                />
              ) : (
                <EmptyState
                  title="No takes"
                  hint="Nothing was kept from this rehearsal, or every take since got deleted."
                />
              )
            )}
          </section>
        </>
      )}

      {takeDialogs}

      <ConfirmDialog
        open={rehearsalToDelete !== null}
        onOpenChange={(open) => !open && setRehearsalToDelete(null)}
        title={`Delete “${rehearsalToDelete?.name ?? ""}”?`}
        description={`The whole folder, with all its takes (${takesAndSize(
          rehearsalToDelete
        )}), ${goesTo()}.${rehearsalCloudToo(
          rehearsalToDelete?.in_cloud,
          rehearsalToDelete?.take_count
        )} ${canBePutBack()}`}
        onConfirm={() => {
          if (rehearsalToDelete) void deleteRehearsal(rehearsalToDelete)
          setRehearsalToDelete(null)
        }}
      />

      <ConfirmDialog
        open={rehearsalToForget !== null}
        onOpenChange={(open) => !open && setRehearsalToForget(null)}
        title={`Remove “${rehearsalToForget?.name ?? ""}” from history?`}
        description="Only the entry goes — there is nothing on disk to delete. If the folder turns up again, it will not come back by itself."
        confirmLabel="Remove"
        onConfirm={() => {
          if (rehearsalToForget) void forgetRehearsal(rehearsalToForget)
          setRehearsalToForget(null)
        }}
      />

      <PromptDialog
        open={rehearsalToRename !== null}
        onOpenChange={(open) => !open && setRehearsalToRename(null)}
        title="Rename rehearsal"
        label="The folder keeps its date and gets the new name."
        initialValue={rehearsalToRename?.name ?? ""}
        onSubmit={(name) => {
          if (rehearsalToRename)
            void renameRehearsal(rehearsalToRename.folder, name)
          setRehearsalToRename(null)
        }}
      />
    </Shell>
  )
}
