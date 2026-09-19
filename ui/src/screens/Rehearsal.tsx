import { useState } from "react"
import { Circle, FolderOpen, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Shell, SpaceHint } from "@/components/Shell"
import { TakeList, useTakeListPlayer } from "@/components/TakeList"
import { ConfirmDialog, PromptDialog } from "@/components/ConfirmDialog"
import { ShareDialog } from "@/components/ShareDialog"
import { MarkerDialog } from "@/components/MarkerDialog"
import { usePlayerKeys, useSpacebar } from "@/hooks/useSpacebar"
import {
  api,
  type Marker,
  type MarkerKind,
  type SessionState,
  type Take,
} from "@/lib/api"
import { takesLabel } from "@/lib/format"
import { canBePutBack, goPlural } from "@/lib/deletion"

/**
 * The rehearsal hub: what has been recorded, and a big button to record more.
 * Any saved take plays right here, expanding in its row.
 */
export function Rehearsal({
  session,
  onStartTake,
  onFinished,
  onChanged,
}: {
  session: Extract<SessionState, { active: true }>
  onStartTake: (takeNumber: number, takeName: string) => void
  onFinished: (folder: string, takeCount: number) => void
  onChanged: () => void
}) {
  const { selected, select, reselect, player } = useTakeListPlayer()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<Take | null>(null)
  const [toRename, setToRename] = useState<Take | null>(null)
  const [toShare, setToShare] = useState<Take | null>(null)
  const [markerEdit, setMarkerEdit] = useState<{
    take: Take
    marker: Marker
  } | null>(null)
  const [renamingRehearsal, setRenamingRehearsal] = useState(false)

  const startTake = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    player.pause()
    const res = await api().start_take()
    setBusy(false)
    if (!res.ok || res.take_number == null) {
      setError(res.error ?? "Could not start the take")
      return
    }
    onStartTake(res.take_number, session.next_take_name)
  }

  // While a take is expanded Space drives the player — otherwise it would
  // start a new take in the middle of listening.
  useSpacebar(selected ? player.toggle : startTake, !busy)
  usePlayerKeys(player.skip, selected !== null)

  const finish = async () => {
    player.pause()
    const res = await api().finish_rehearsal()
    if (!res.ok) {
      setError(res.error ?? "Could not finish the rehearsal")
      return
    }
    onFinished(res.folder ?? session.folder, res.take_count ?? 0)
  }

  const deleteTake = async (take: Take) => {
    player.pause()
    const res = await api().delete_take(session.folder, take.take_number)
    if (!res.ok) {
      setError(res.error ?? "Could not delete the take")
      return
    }
    if (selected?.take_number === take.take_number) reselect(null)
    onChanged()
  }

  const renameTake = async (take: Take, name: string) => {
    const res = await api().rename_take(session.folder, take.take_number, name)
    if (!res.ok) {
      setError(res.error ?? "Could not rename the take")
      return
    }
    // The take folder moved with the name, so point the player at the fresh
    // paths — without closing it, since someone may be listening right now.
    if (selected?.take_number === take.take_number && res.take) reselect(res.take)
    onChanged()
  }

  const renameRehearsal = async (name: string) => {
    const res = await api().rename_rehearsal(session.folder, name)
    if (!res.ok) {
      setError(res.error ?? "Could not rename the rehearsal")
      return
    }
    // The whole folder moved, so every take's paths changed with it.
    if (selected && res.takes) {
      const fresh = res.takes.find(
        (t) => t.take_number === selected.take_number
      )
      if (fresh) reselect(fresh)
    }
    onChanged()
  }

  // Dropping a marker opens its note straight away: the thought about what
  // just went wrong lasts about five seconds. Playback carries on.
  const addMarker = async (take: Take, seconds: number) => {
    const res = await api().add_take_marker(session.folder, take.take_number, seconds)
    onChanged()
    const fresh = res.markers?.find((m) => Math.abs(m.at - seconds) < 0.02)
    setMarkerEdit(fresh ? { take, marker: fresh } : null)
  }

  const saveMarker = async (
    take: Take,
    at: number,
    note: string,
    kind: MarkerKind
  ) => {
    await api().update_take_marker(session.folder, take.take_number, at, note, kind)
    onChanged()
  }

  const removeMarker = async (take: Take, seconds: number) => {
    await api().remove_take_marker(session.folder, take.take_number, seconds)
    onChanged()
  }

  return (
    <Shell
      subtitle="Rehearsal"
      title={
        <span className="inline-flex items-center gap-2">
          {session.name}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Rename rehearsal"
            onClick={() => setRenamingRehearsal(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            <Pencil />
          </Button>
        </span>
      }
      headerAction={
        <div className="flex items-center gap-3">
          <Badge variant="outline">{takesLabel(session.takes.length)}</Badge>
          <Button variant="ghost" onClick={finish}>
            Finish
          </Button>
        </div>
      }
      footer={
        <div className="flex flex-col items-center gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button
            size="xl"
            variant="destructive"
            onClick={startTake}
            disabled={busy}
          >
            <Circle className="fill-current" />
            Record take {session.next_take_number}
          </Button>
          <SpaceHint>
            {selected ? "play / pause" : `records “${session.next_take_name}”`}
          </SpaceHint>
        </div>
      }
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="truncate font-mono">{session.folder}</span>
        </div>

        <TakeList
          takes={session.takes}
          selected={selected}
          onSelect={select}
          onRename={setToRename}
          onShare={setToShare}
          onDelete={setToDelete}
          onAddMarker={addMarker}
          onEditMarker={(take, marker) => setMarkerEdit({ take, marker })}
          onRemoveMarker={removeMarker}
          player={player}
          emptyHint="Hit Record or press Space — takes show up here and can be played straight away."
        />

        <p className="text-xs text-muted-foreground">
          Same tracks as at the start of the rehearsal:{" "}
          {session.tracks.map((t) => t.name).join(", ")}.
        </p>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Delete “${toDelete?.name ?? ""}”?`}
        description={`The take and all its tracks ${goPlural()}. ${canBePutBack()}`}
        onConfirm={() => {
          if (toDelete) void deleteTake(toDelete)
          setToDelete(null)
        }}
      />

      <PromptDialog
        open={toRename !== null}
        onOpenChange={(open) => !open && setToRename(null)}
        title="Rename take"
        label="The folder on disk is renamed too."
        initialValue={toRename?.name ?? ""}
        onSubmit={(name) => {
          if (toRename) void renameTake(toRename, name)
          setToRename(null)
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
        take={toShare}
        folder={session.folder}
        onOpenChange={(open) => !open && setToShare(null)}
        onDone={onChanged}
      />

      <PromptDialog
        open={renamingRehearsal}
        onOpenChange={setRenamingRehearsal}
        title="Rename rehearsal"
        label="The folder keeps its date and gets the new name."
        initialValue={session.name}
        onSubmit={(name) => void renameRehearsal(name)}
      />
    </Shell>
  )
}
