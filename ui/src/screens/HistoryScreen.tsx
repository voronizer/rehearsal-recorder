import { useEffect, useState } from "react"
import { FolderOpen, Library, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Shell, EmptyState } from "@/components/Shell"
import { RehearsalRow } from "@/components/RehearsalRow"
import { TakeStrip, liveTake } from "@/components/TakeStrip"
import { TakePlayer } from "@/components/TakePlayer"
import { ConfirmDialog, PromptDialog } from "@/components/ConfirmDialog"
import { ShareDialog } from "@/components/ShareDialog"
import { MarkerDialog } from "@/components/MarkerDialog"
import { useTakeStripPlayer } from "@/hooks/useTakeStripPlayer"
import { useEscape, usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  type Marker,
  type MarkerKind,
  type RehearsalDetail,
  type RehearsalSummary,
  type Take,
} from "@/lib/api"
import {
  formatBytes,
  formatDateHuman,
  formatDuration,
  songsLabel,
  takesLabel,
} from "@/lib/format"
import { canBePutBack, goPlural, goesTo } from "@/lib/deletion"

/**
 * When it was, how long it ran and what it weighs:
 * "18 Sep 2026, 19:00 · 42 min · 1.2 GB". Under half a minute there is no
 * honest number of minutes to give, so that part is left out — rounding it
 * to "0 min" would be worse than saying nothing.
 */
function subtitleOf(r: RehearsalSummary): string {
  const parts = [formatDateHuman(r.created_at)]
  if (r.total_duration_sec >= 30) {
    parts.push(formatDuration(r.total_duration_sec / 60))
  }
  parts.push(formatBytes(r.disk_bytes))
  return parts.join(" · ")
}

/** "9 takes, 1.2 GB" — what deleting a rehearsal takes away and gives back. */
function takesAndSize(r: RehearsalSummary | null): string {
  if (!r) return takesLabel(0)
  return `${takesLabel(r.take_count)}, ${formatBytes(r.disk_bytes)}`
}

/**
 * History: past rehearsals and their takes. Read from disk, so it survives a
 * restart of the app.
 */
export function HistoryScreen({ onBack }: { onBack: () => void }) {
  const [rehearsals, setRehearsals] = useState<RehearsalSummary[] | null>(null)
  const [opened, setOpened] = useState<RehearsalDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Something slow enough to click twice by mistake is running. So far that
  // is only a crop, which rewrites every track of the take.
  const [busy, setBusy] = useState(false)
  const [takeToDelete, setTakeToDelete] = useState<Take | null>(null)
  const [takeToRename, setTakeToRename] = useState<Take | null>(null)
  const [takeToShare, setTakeToShare] = useState<Take | null>(null)
  const [markerEdit, setMarkerEdit] = useState<{
    take: Take
    marker: Marker
  } | null>(null)
  const [rehearsalToDelete, setRehearsalToDelete] =
    useState<RehearsalSummary | null>(null)
  const [rehearsalToRename, setRehearsalToRename] =
    useState<RehearsalSummary | null>(null)
  const [renamingOpened, setRenamingOpened] = useState(false)
  const { selected, select, reselect, player } = useTakeStripPlayer()

  const refresh = async () => setRehearsals(await api().list_rehearsals())

  useEffect(() => {
    void refresh()
  }, [])

  useSpacebar(player.toggle, selected !== null)
  usePlayerKeys(player.skip, selected !== null)
  // Escape peels one layer at a time: the open take first, then the rehearsal
  // it was in, then history itself — the same ladder the back button climbs,
  // one rung per press.
  useEscape(() => (selected ? select(null) : back()))

  const open = async (summary: RehearsalSummary) => {
    const res = await api().get_rehearsal(summary.folder)
    if (!res.ok) {
      setError(res.error ?? "Could not open the rehearsal")
      return
    }
    select(null)
    setOpened(res)
  }

  const reopen = async (folder: string) => {
    const fresh = await api().get_rehearsal(folder)
    if (fresh.ok) setOpened(fresh)
  }

  const back = () => {
    player.pause()
    if (opened) {
      select(null)
      setOpened(null)
      void refresh()
    } else {
      onBack()
    }
  }

  const deleteTake = async (take: Take) => {
    if (!opened) return
    player.pause()
    const res = await api().delete_take(opened.folder, take.take_number)
    if (!res.ok) {
      setError(res.error ?? "Could not delete the take")
      return
    }
    if (selected?.take_number === take.take_number) reselect(null)
    await reopen(opened.folder)
  }

  const renameTake = async (take: Take, name: string) => {
    if (!opened) return
    const res = await api().rename_take(opened.folder, take.take_number, name)
    if (!res.ok) {
      setError(res.error ?? "Could not rename the take")
      return
    }
    // The take folder moved with the name, so point the player at the fresh
    // paths. That is a new `tracks` identity, so the open effect underneath
    // tears down and reopens from zero — the take stays selected and on
    // screen, but playback and the A–B region do not survive this.
    if (selected?.take_number === take.take_number && res.take) reselect(res.take)
    await reopen(opened.folder)
  }

  // Python let go of the files before rewriting them, so the take has to be
  // opened again; the fresh `tracks` array is what tells the player that.
  // Rewriting eight long tracks takes real seconds, so the screen is busy
  // while it runs: a second Crop would cut the take the first one made.
  const cropTake = async (take: Take, from: number, to: number) => {
    if (!opened || busy) return
    setBusy(true)
    setError(null)
    player.pause()
    const res = await api().crop_take(opened.folder, take.take_number, from, to)
    setBusy(false)
    if (!res.ok) {
      setError(res.error ?? "Could not crop the take")
      return
    }
    if (res.take) reselect(res.take)
    await reopen(opened.folder)
    // The crop itself went through — only the sweep of the original is what
    // failed — so this adds to the success path rather than standing in for it.
    if (res.error) {
      setError(
        `The take was cropped, but the original could not be moved out of the way (${res.error})${
          res.location ? `, and is still at ${res.location}` : ""
        }.`
      )
    }
  }

  const renameRehearsal = async (folder: string, name: string) => {
    const res = await api().rename_rehearsal(folder, name)
    if (!res.ok) {
      setError(res.error ?? "Could not rename the rehearsal")
      return
    }
    if (selected && res.takes) {
      const fresh = res.takes.find(
        (t) => t.take_number === selected.take_number
      )
      if (fresh) reselect(fresh)
    }
    await refresh()
    return res.folder
  }

  const renameOpenedRehearsal = async (name: string) => {
    if (!opened) return
    // Renaming moves the folder, so reopen on the new path.
    const folder = await renameRehearsal(opened.folder, name)
    if (folder) await reopen(folder)
  }

  const deleteRehearsal = async (r: RehearsalSummary) => {
    player.pause()
    const res = await api().delete_rehearsal(r.folder)
    if (!res.ok) {
      setError(res.error ?? "Could not delete the rehearsal")
      return
    }
    await refresh()
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
    kind: MarkerKind
  ) => {
    if (!opened) return
    await api().update_take_marker(opened.folder, take.take_number, at, note, kind)
    await reopen(opened.folder)
  }

  const removeMarker = async (take: Take, seconds: number) => {
    if (!opened) return
    await api().remove_take_marker(opened.folder, take.take_number, seconds)
    await reopen(opened.folder)
  }

  if (opened) {
    return (
      <Shell
        subtitle={formatDateHuman(opened.created_at)}
        title={opened.name}
        onBack={back}
        headerAction={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Rename rehearsal"
            onClick={() => setRenamingOpened(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil />
          </Button>
        }
      >
        <div className="flex w-full flex-col gap-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate font-mono">{opened.folder}</span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <TakeStrip
            takes={opened.takes}
            selected={selected}
            onSelect={select}
            onRename={setTakeToRename}
            onShare={setTakeToShare}
            onDelete={setTakeToDelete}
            emptyHint="Nothing was kept from this rehearsal, or every take since got deleted."
          />

          {selected ? (
            <TakePlayer
              player={player}
              markers={liveTake(opened.takes, selected)?.markers ?? []}
              onAddMarker={(sec) => addMarker(selected, sec)}
              onEditMarker={(marker) => setMarkerEdit({ take: selected, marker })}
              onRemoveMarker={(sec) => removeMarker(selected, sec)}
              onCrop={(from, to) => void cropTake(selected, from, to)}
              canCrop={!busy}
            />
          ) : (
            opened.takes.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Pick a take to listen back to it.
              </p>
            )
          )}
        </div>

        <ConfirmDialog
          open={takeToDelete !== null}
          onOpenChange={(open) => !open && setTakeToDelete(null)}
          title={`Delete “${takeToDelete?.name ?? ""}”?`}
          description={`The take and all its tracks ${goPlural()}. ${canBePutBack()}`}
          onConfirm={() => {
            if (takeToDelete) void deleteTake(takeToDelete)
            setTakeToDelete(null)
          }}
        />

        <PromptDialog
          open={takeToRename !== null}
          onOpenChange={(open) => !open && setTakeToRename(null)}
          title="Rename take"
          label="The folder on disk is renamed too."
          initialValue={takeToRename?.name ?? ""}
          onSubmit={(name) => {
            if (takeToRename) void renameTake(takeToRename, name)
            setTakeToRename(null)
          }}
        />

        <MarkerDialog
          marker={markerEdit?.marker ?? null}
          onOpenChange={(open) => !open && setMarkerEdit(null)}
          onSave={(at, note, kind) => {
            if (markerEdit) void saveMarker(markerEdit.take, at, note, kind)
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

        <PromptDialog
          open={renamingOpened}
          onOpenChange={setRenamingOpened}
          title="Rename rehearsal"
          label="The folder keeps its date and gets the new name."
          initialValue={opened.name}
          onSubmit={(name) => void renameOpenedRehearsal(name)}
        />
      </Shell>
    )
  }

  return (
    <Shell title="Rehearsal history" onBack={back}>
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {error && <p className="text-sm text-destructive">{error}</p>}

        {rehearsals === null && (
          <p className="text-sm text-muted-foreground">Reading the folder…</p>
        )}

        {rehearsals?.length === 0 && (
          <EmptyState
            icon={<Library className="size-6" />}
            title="No past rehearsals yet"
            hint="Every rehearsal where you saved at least one take shows up here."
          />
        )}

        {rehearsals?.map((r) => (
          <RehearsalRow
            key={r.folder}
            name={r.name}
            subtitle={subtitleOf(r)}
            songsText={songsLabel(r.songs)}
            takesText={takesLabel(r.take_count)}
            onClick={() => open(r)}
            onRename={() => setRehearsalToRename(r)}
            onDelete={() => setRehearsalToDelete(r)}
          />
        ))}
      </div>

      <ConfirmDialog
        open={rehearsalToDelete !== null}
        onOpenChange={(open) => !open && setRehearsalToDelete(null)}
        title={`Delete “${rehearsalToDelete?.name ?? ""}”?`}
        description={`The whole folder, with all its takes (${takesAndSize(
          rehearsalToDelete
        )}), ${goesTo()}. ${canBePutBack()}`}
        onConfirm={() => {
          if (rehearsalToDelete) void deleteRehearsal(rehearsalToDelete)
          setRehearsalToDelete(null)
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
